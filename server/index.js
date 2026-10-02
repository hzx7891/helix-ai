// Helix 后端入口

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, saveConfig, redactConfig } from './config.js';
import { streamChat } from './llm.js';
import { getToolDefinitions, executeTool } from './tool/index.js';
import { resolveApproval, cancelAll } from './approval.js';
import { fetchBalance } from './balance.js';
import { getToolStats, getRecentCalls, resetAudit } from './tool/index.js';
import * as session from './session.js';
import * as tasks from './tasks.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', 'public');
const VERSION = '0.0.1';
const MAX_TOOL_ROUNDS = 10;

function placeholderPage() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Helix</title></head>' +
    '<body><h1>Helix 后端已启动</h1></body></html>';
}

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function sendError(ws, message, code) {
  sendJson(ws, { type: 'error', message: message, code: code || 'UNKNOWN' });
}

export function startServer(options) {
  const port = options.port;
  const token = options.token;

  return new Promise(function (resolve, reject) {
    const app = express();
    app.use(express.json({ limit: '5mb' }));

    app.get('/api/health', function (req, res) {
      res.json({ ok: true, version: VERSION, uptime: process.uptime() });
    });

    app.get('/api/config', async function (req, res) {
      try { res.json(redactConfig(await loadConfig())); }
      catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/config', async function (req, res) {
      try {
        const next = await saveConfig(req.body || {});
        res.json(redactConfig(next));
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/balance', async function (req, res) {
      try {
        const config = await loadConfig();
        res.json(await fetchBalance(config));
      } catch (err) {
        res.json({ supported: false, reason: err.message });
      }
    });

    app.get('/api/stats', function (req, res) {
      try { res.json(getToolStats()); }
      catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/audit', function (req, res) {
      try {
        const limit = parseInt(req.query.limit, 10) || 50;
        res.json({ records: getRecentCalls(limit) });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/audit/reset', function (req, res) {
      try { resetAudit(); res.json({ ok: true }); }
      catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/session/list', async function (req, res) {
      try { res.json({ sessions: await session.listSessions() }); }
      catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/session/load/:name', async function (req, res) {
      try { res.json(await session.loadSession(req.params.name)); }
      catch (err) { res.status(404).json({ error: err.message }); }
    });

    app.post('/api/session/delete/:name', async function (req, res) {
      try {
        await session.deleteSession(req.params.name);
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 查任务快照（刷新后前端来问）
    app.get('/api/task/:id', function (req, res) {
      const snap = tasks.getSnapshot(req.params.id);
      if (!snap) return res.status(404).json({ error: '任务不存在或已过期' });
      res.json(snap);
    });

    // 中止任务（刷新后也能中止）
    app.post('/api/task/:id/abort', function (req, res) {
      tasks.abortTask(req.params.id);
      res.json({ ok: true });
    });

    app.use(express.static(PUBLIC_DIR));

    app.get('/', function (req, res) {
      const indexFile = join(PUBLIC_DIR, 'index.html');
      if (existsSync(indexFile)) res.sendFile(indexFile);
      else res.type('html').send(placeholderPage());
    });

    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', function (req, socket, head) {
      let url;
      try { url = new URL(req.url, 'http://127.0.0.1:' + port); }
      catch (e) { socket.destroy(); return; }

      if (url.pathname !== '/ws') { socket.destroy(); return; }
      if (url.searchParams.get('token') !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, function (ws) {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', async function (ws) {
      const config = await loadConfig();

      sendJson(ws, {
        type: 'ready',
        model: config.model || null,
        workspace: config.workspace || null,
      });

      const history = [];
      let currentAbort = null;
      const alwaysAllowed = new Set();

      async function handleUserMessage(text, wireHistory, clientMsgId) {
        if (currentAbort) {
          sendError(ws, '上一条还没回答完，请先等一会儿', 'BUSY');
          return;
        }

        const freshConfig = await loadConfig();
        if (!freshConfig.apiKey) {
          sendError(ws, '还没有填 API Key，请到设置里配置', 'INVALID_API_KEY');
          sendJson(ws, { type: 'done', reason: 'error' });
          return;
        }

        // 建任务（如果前端带了 ID）
        let task = null;
        if (clientMsgId) {
          task = tasks.createTask(clientMsgId, ws);
        }

        // 前端带了完整历史：用它替换本地的
        if (Array.isArray(wireHistory) && wireHistory.length > 0) {
          history.length = 0;
          history.push({
            role: 'system',
            content: freshConfig.systemPrompt || '你是一个本地 AI 助手。',
          });
          for (const m of wireHistory) {
            if (!m || !m.role) continue;
            if (m.role !== 'user' && m.role !== 'assistant') continue;
            history.push({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : '',
            });
          }
          const last = history[history.length - 1];
          if (!last || last.role !== 'user' || last.content !== text) {
            history.push({ role: 'user', content: text });
          }
        } else {
          if (history.length === 0) {
            history.push({
              role: 'system',
              content: freshConfig.systemPrompt || '你是一个本地 AI 助手。',
            });
          }
          history.push({ role: 'user', content: text });
        }

        currentAbort = new AbortController();
        if (task) task.abort = currentAbort;

        const toolDefs = getToolDefinitions();
        const toolContext = {
          workspace: freshConfig.workspace,
          config: freshConfig,
          ws: ws,
          alwaysAllowed: alwaysAllowed,
        };

        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            let assistantText = '';
            const result = await streamChat({
              config: freshConfig,
              messages: history,
              tools: toolDefs,
              signal: currentAbort.signal,
              onDelta: function (chunk) {
                assistantText += chunk;
                if (task) tasks.appendDelta(clientMsgId, chunk);
                sendJson(ws, { type: 'assistant_delta', text: chunk });
              },
              onReasoning: function (chunk) {
                if (task) tasks.appendReasoning(clientMsgId, chunk);
                sendJson(ws, { type: 'reasoning_delta', text: chunk });
              },
            });
            const toolCalls = result.toolCalls;

            if (toolCalls.length === 0) {
              if (assistantText) {
                history.push({ role: 'assistant', content: assistantText });
              }
              break;
            }

            history.push({
              role: 'assistant',
              content: assistantText || null,
              tool_calls: toolCalls.map(function (tc) {
                return {
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.arguments || '{}' },
                };
              }),
            });

            for (const tc of toolCalls) {
              let args = {};
              let argsOk = true;
              try { args = JSON.parse(tc.arguments || '{}'); }
              catch (e) { argsOk = false; }

              if (!argsOk) {
                sendJson(ws, {
                  type: 'tool_start',
                  callId: tc.id,
                  name: tc.name,
                  args: tc.arguments,
                });
                const msg = '参数不是合法 JSON，无法执行';
                sendJson(ws, { type: 'tool_end', callId: tc.id, ok: false, result: msg });
                if (task) tasks.pushTool(clientMsgId, {
                  callId: tc.id, name: tc.name, args: tc.arguments,
                  status: 'fail', result: msg,
                });
                history.push({ role: 'tool', tool_call_id: tc.id, content: msg });
                continue;
              }

              sendJson(ws, {
                type: 'tool_start',
                callId: tc.id,
                name: tc.name,
                args: args,
              });
              if (task) tasks.pushTool(clientMsgId, {
                callId: tc.id, name: tc.name, args: args,
                status: 'running', result: '',
              });

              const toolResult = await executeTool(tc.name, args, toolContext);
              const ok = toolResult.ok;
              const rtext = toolResult.result;

              sendJson(ws, {
                type: 'tool_end',
                callId: tc.id,
                ok: ok,
                result: rtext,
              });
              if (task) tasks.updateTool(clientMsgId, tc.id, {
                status: ok ? 'ok' : 'fail',
                result: rtext,
              });

              history.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: rtext,
              });
            }
          }

          try { await session.saveSession(history); }
          catch (e) { console.error('[session] 保存失败：', e.message); }

          sendJson(ws, { type: 'done', reason: 'complete' });
          if (task) tasks.finishTask(clientMsgId, 'complete');
        } catch (err) {
          if (err.code === 'ABORTED') {
            sendJson(ws, { type: 'done', reason: 'aborted' });
            if (task) tasks.finishTask(clientMsgId, 'aborted');
          } else {
            sendError(ws, err.message, err.code || 'UNKNOWN');
            sendJson(ws, { type: 'done', reason: 'error' });
            if (task) tasks.finishTask(clientMsgId, 'error', err.message);
          }
        } finally {
          currentAbort = null;
        }
      }

      ws.on('message', async function (data) {
        let msg;
        try { msg = JSON.parse(data.toString()); }
        catch (e) { return; }

        if (msg.type === 'user_message') {
          await handleUserMessage(
            String(msg.text || ''),
            msg.history,
            msg.clientMsgId
          );
        } else if (msg.type === 'approval') {
          resolveApproval(msg.requestId, msg.decision, msg.answer);
        } else if (msg.type === 'abort') {
          if (currentAbort) currentAbort.abort();
        }
      });

      ws.on('close', function () { cancelAll(); });
      ws.on('error', function (err) {
        console.error('WebSocket 出错：', err.message);
      });
    });

    server.on('error', function (err) { reject(err); });

    server.listen(port, '127.0.0.1', function () {
      resolve({ port: port, workspace: null });
    });
  });
}
