#!/usr/bin/env node
// run.mjs —— Helix 一键启动终端客户端
// 自动拉起后端，自动提取 token，直接开聊。退出时自动清理后端。

import { spawn } from 'node:child_process';
import readline from 'node:readline';

// 颜色辅助
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m'
};

let atLineStart = true;
function streamOut(text) {
  if (!text) return;
  process.stdout.write(text);
  atLineStart = text.endsWith('\n');
}
function ensureNewline() {
  if (!atLineStart) {
    process.stdout.write('\n');
    atLineStart = true;
  }
}
function sys(msg) {
  ensureNewline();
  process.stdout.write(`${C.dim}${msg}${C.reset}\n`);
}

// 1. 启动后端子进程
sys('正在启动 Helix 后端...');
const server = spawn('node', ['bin/helix.js'], { stdio: ['ignore', 'pipe', 'pipe'] });

let wsUrl = null;
let serverReady = false;

server.stdout.on('data', (data) => {
  const text = data.toString();
  
  // 从输出中提取 token 和端口
  // 假设输出格式包含: http://127.0.0.1:3000/?token=b639dab95b4c7d9f963977486f782327
  const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([a-zA-Z0-9]+)/);
  if (match && !serverReady) {
    const port = match[1];
    const token = match[2];
    wsUrl = `ws://127.0.0.1:${port}/ws?token=${token}`;
    serverReady = true;
    connectToServer();
  }
});

server.stderr.on('data', (data) => {
  process.stderr.write(`${C.red}[后端报错] ${data.toString()}${C.reset}`);
});

// 2. 连接 WebSocket
let ws = null;
let rl = null;
let pendingApproval = null;
let waitingReply = false;

function prompt() {
  ensureNewline();
  process.stdout.write(`${C.green}你 > ${C.reset}`);
}

function connectToServer() {
  sys('连接 WebSocket 中...');
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    // 等待服务端 ready 消息
  });

  ws.addEventListener('error', () => {
    sys(`${C.red}连接出错。检查后端是否正常。${C.reset}`);
  });

  ws.addEventListener('close', (ev) => {
    ensureNewline();
    sys(`${C.yellow}连接已断开（code ${ev.code}）。${C.reset}`);
    cleanupAndExit();
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'ready':
        sys(`已连接 · 模型 ${msg.model || '(未配置)'} · 工作目录 ${msg.workspace || '(未设置)'}`);
        sys('输入消息回车发送，Ctrl+C 退出。');
        waitingReply = false;
        prompt();
        break;

      case 'assistant_delta':
        streamOut(msg.text);
        break;

      case 'reasoning_delta':
        process.stdout.write(`${C.dim}${msg.text}${C.reset}`);
        atLineStart = false;
        break;

      case 'tool_start': {
        ensureNewline();
        const argText = JSON.stringify(msg.args ?? {});
        const short = argText.length > 120 ? argText.slice(0, 120) + '…' : argText;
        process.stdout.write(`${C.yellow}▶ ${msg.name}${C.reset} ${C.dim}${short}${C.reset}\n`);
        break;
      }

      case 'tool_end': {
        const mark = msg.ok ? `${C.green}✓` : `${C.red}✗`;
        const body = String(msg.result ?? '');
        const short = body.length > 200 ? body.slice(0, 200) + '…' : body;
        process.stdout.write(`${mark} ${C.dim}${short.replace(/\n/g, ' ⏎ ')}${C.reset}\n`);
        break;
      }

      case 'approval_request': {
        ensureNewline();
        if (msg.kind === 'question') {
          process.stdout.write(`${C.magenta}AI 问你：${C.reset}${msg.title || ''}\n`);
          if (msg.detail) process.stdout.write(`${C.dim}${msg.detail}${C.reset}\n`);
          pendingApproval = { requestId: msg.requestId, kind: 'question' };
          process.stdout.write(`${C.green}回答 > ${C.reset}`);
        } else {
          process.stdout.write(`\n${C.yellow}${C.bold}【需要授权】${C.reset}${msg.title || ''}\n`);
          if (msg.detail) process.stdout.write(`${C.dim}${msg.detail}${C.reset}\n`);
          pendingApproval = { requestId: msg.requestId, kind: 'permission' };
          process.stdout.write(`${C.green}y${C.reset}=本次允许  ${C.green}a${C.reset}=始终允许  ${C.red}n${C.reset}=拒绝  > `);
        }
        break;
      }

      case 'done':
        ensureNewline();
        waitingReply = false;
        if (msg.reason && msg.reason !== 'complete') sys(`[结束：${msg.reason}]`);
        prompt();
        break;

      case 'error':
        ensureNewline();
        sys(`${C.red}错误：${msg.message}${C.reset}`);
        waitingReply = false;
        prompt();
        break;
    }
  });
}

// 3. 输入处理
rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!serverReady) return; // 还没启动完
  const text = line.trim();

  if (pendingApproval) {
    const pa = pendingApproval;
    if (pa.kind === 'question') {
      pendingApproval = null;
      ws.send(JSON.stringify({ type: 'approval', requestId: pa.requestId, decision: 'allow', answer: line }));
      ensureNewline();
      return;
    }

    const lower = text.toLowerCase();
    if (!['y', 'yes', 'a', 'always', 'n', 'no'].includes(lower)) {
      process.stdout.write(`${C.yellow}请输入 y / a / n：${C.reset}`);
      return;
    }

    pendingApproval = null;
    const decision = (lower === 'a' || lower === 'always') ? 'allow_always'
                   : (lower === 'n' || lower === 'no') ? 'deny' : 'allow';
    ws.send(JSON.stringify({ type: 'approval', requestId: pa.requestId, decision }));
    ensureNewline();
    return;
  }

  if (!text) { prompt(); return; }

  if (text === '/quit' || text === '/exit') {
    cleanupAndExit();
    return;
  }
  if (text === '/abort') {
    ws.send(JSON.stringify({ type: 'abort' }));
    sys('已发送中断请求');
    return;
  }

  if (waitingReply) {
    sys('上一条还没回答完，稍等（输入 /abort 可中断）');
    prompt();
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    sys('连接已断开');
    return;
  }

  ensureNewline();
  process.stdout.write(`${C.cyan}AI > ${C.reset}`);
  waitingReply = true;
  ws.send(JSON.stringify({ type: 'user_message', text }));
});

// 4. 退出清理
function cleanupAndExit() {
  if (ws) ws.close();
  if (server) {
    sys('正在关闭后端...');
    server.kill('SIGINT'); // 给后端发中断信号，清理资源
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  if (waitingReply && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'abort' }));
    ensureNewline();
    sys('已中断任务');
    waitingReply = false;
    prompt();
  } else {
    cleanupAndExit();
  }
});