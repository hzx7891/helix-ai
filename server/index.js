// Helix 后端入口：启动 HTTP 服务 + WebSocket，托管 public/ 静态文件

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', 'public');
const VERSION = '0.0.1';

const MAX_TOOL_ROUNDS = 10;

function placeholderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Helix</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0c10;
      color: #e6e8ec;
      font-family: -apple-system, "Segoe UI", "PingFang SC", sans-serif;
    }
    .box { text-align: center; }
    .logo { font-size: 64px; margin-bottom: 16px; }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
    p { margin: 0; color: #8b939e; font-size: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="logo">🧬</div>
    <h1>Helix 后端已启动</h1>
    <p>前端界面还在开发中，请稍后回来查看。</p>
  </div>
</body>
</html>`;
}

function sendJson(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sendError(ws, message, code = 'UNKNOWN') {
  sendJson(ws, { type: 'error', message, code });
}

export function startServer({ port, token }) {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use(express.json({ limit: '5mb' }));

    app.get('/api/health', (req, res) => {
      res.json({
        ok: true,
        version: VERSION,
        uptime: process.uptime(),
      });
    });

    app.get('/api/config', async (req, res) => {
      try {
        const config = await loadConfig();
        res.json(redactConfig(config));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/config', async (req, res) => {
      try {
        const partial = req.body || {};
        const next = await saveConfig(partial);
        res.json(redactConfig(next));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.use(express.static(PUBLIC_DIR));

    app.get('/', (req, res) => {
      const indexFile = join(PUBLIC_DIR, 'index.html');
      if (existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.type('html').send(placeholderPage());
      }
    });

    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, `http://127.0.0.1:${port}`);
      } catch {
        socket.destroy();
        return;
      }

      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }

      if (url.searchParams.get('token') !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', async (ws) => {
      const config = await loadConfig();

      sendJson(ws, {
        type: 'ready',
        model: config.model || null,
        workspace: config.workspace || null,
      });

      const history = [];
      let currentAbort = null;
      const alwaysAllowed = new Set();

      async function handleUserMessage(text) {
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

        if (history.length === 0) {
          history.push({
            role: 'system',
            content: freshConfig.systemPrompt || '你是一个本地 AI 助手。',
          });
        }

        history.push({ role: 'user', content: text });

        currentAbort = new AbortController();

        const toolDefs = getToolDefinitions();
        const toolContext = {
          workspace: freshConfig.workspace,
          config: freshConfig,
          ws,
          alwaysAllowed,
        };

        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            let assistantText = '';
            const { toolCalls } = await streamChat({
              config: freshConfig,
              messages: history,
              tools: toolDefs,
              signal: currentAbort.signal,
              onDelta: (chunk) => {
                assistantText += chunk;
                sendJson(ws, { type: 'assistant_delta', text: chunk });
              },
              onReasoning: (chunk) => {
                sendJson(ws, { type: 'reasoning_delta', text: chunk });
              },
            });

            if (toolCalls.length === 0) {
              if (assistantText) {
                history.push({ role: 'assistant', content: assistantText });
              }
              break;
            }

            history.push({
              role: 'assistant',
              content: assistantText || null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: tc.arguments || '{}',
                },
              })),
            });

            for (const tc of toolCalls) {
              let args = {};
              let argsOk = true;
              try {
                args = JSON.parse(tc.arguments || '{}');
              } catch {
                argsOk = false;
              }

              if (!argsOk) {
                sendJson(ws, {
                  type: 'tool_start',
                  callId: tc.id,
                  name: tc.name,
                  args: tc.arguments,
                });
                const msg = '参数不是合法 JSON，无法执行';
                sendJson(ws, {
                  type: 'tool_end',
                  callId: tc.id,
                  ok: false,
                  result: msg,
                });
                history.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: msg,
                });
                continue;
              }

              sendJson(ws, {
                type: 'tool_start',
                callId: tc.id,
                name: tc.name,
                args,
              });

              const { ok, result } = await executeTool(tc.name, args, toolContext);

              sendJson(ws, {
                type: 'tool_end',
                callId: tc.id,
                ok,
                result,
              });

              history.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: result,
              });
            }
          }

          sendJson(ws, { type: 'done', reason: 'complete' });
        } catch (err) {
          if (err.code === 'ABORTED') {
            sendJson(ws, { type: 'done', reason: 'aborted' });
          } else {
            sendError(ws, err.message, err.code || 'UNKNOWN');
            sendJson(ws, { type: 'done', reason: 'error' });
          }
        } finally {
          currentAbort = null;
        }
      }

      ws.on('message', async (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === 'user_message') {
          await handleUserMessage(String(msg.text || ''));
        } else if (msg.type === 'approval') {
          resolveApproval(msg.requestId, msg.decision, msg.answer);
        } else if (msg.type === 'abort') {
          if (currentAbort) currentAbort.abort();
        }
      });

      ws.on('close', () => {
        cancelAll();
      });

      ws.on('error', (err) => {
        console.error('WebSocket 出错：', err.message);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, '127.0.0.1', () => {
      resolve({ port, workspace: null });
    });
  });
}
