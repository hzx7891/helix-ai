#!/usr/bin/env node
// chat.mjs —— Helix 终端客户端
//
// 为什么需要它：
//   通过远程桌面用浏览器聊 Helix，等于把「流式文本」编码成
//   「实时视频」再传回来。远程桌面为了省带宽会降帧、丢帧，
//   本来丝滑的逐字输出就变成一阵一阵地跳。
//   这个客户端只传文本，不走任何画面编码，延迟降到最低。
//
// 依赖：Node.js 22+（内置全局 WebSocket，无需 npm install）
//
// 用法：
//   node chat.mjs wss://xxx.trycloudflare.com <token>
//   node chat.mjs http://127.0.0.1:3000 <token>
//
// 退出：Ctrl+C

import readline from 'node:readline';

const [, , baseArg, tokenArg] = process.argv;

if (!baseArg || !tokenArg) {
  console.error('');
  console.error('用法：node chat.mjs <地址> <token>');
  console.error('');
  console.error('示例：');
  console.error('  node chat.mjs wss://abc-xyz.trycloudflare.com 1a2b3c4d...');
  console.error('  node chat.mjs http://127.0.0.1:3000 1a2b3c4d...');
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------
// 把用户给的各种写法统一成 ws(s)://.../ws?token=...
// ---------------------------------------------------------------
function buildWsUrl(base, token) {
  let b = String(base).replace(/\/+$/, '');
  let scheme;
  let host;

  if (b.startsWith('wss://')) {
    scheme = 'wss'; host = b.slice(6);
  } else if (b.startsWith('ws://')) {
    scheme = 'ws'; host = b.slice(5);
  } else if (b.startsWith('https://')) {
    scheme = 'wss'; host = b.slice(8);
  } else if (b.startsWith('http://')) {
    scheme = 'ws'; host = b.slice(7);
  } else {
    scheme = 'wss'; host = b;
  }

  return `${scheme}://${host}/ws?token=${encodeURIComponent(token)}`;
}

const wsUrl = buildWsUrl(baseArg, tokenArg);

// ---------------------------------------------------------------
// 输出辅助
// ---------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

let atLineStart = true;

// 流式输出：维护「当前行是否为空」，方便需要时补换行
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

// ---------------------------------------------------------------
// 输入：readline
// ---------------------------------------------------------------
let rl = null;
let pendingApproval = null; // 有审批时，输入被解释成 y/n/a
let waitingReply = false;

function prompt() {
  ensureNewline();
  process.stdout.write(`${C.green}你 > ${C.reset}`);
}

// ---------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------
sys(`连接 ${wsUrl.replace(/token=[^&]+/, 'token=***')} ...`);

let ws;
try {
  ws = new WebSocket(wsUrl);
} catch (err) {
  console.error(`${C.red}地址无效：${err.message}${C.reset}`);
  process.exit(1);
}

ws.addEventListener('open', () => {
  // 等服务端 ready 消息再提示输入
});

ws.addEventListener('error', () => {
  sys(`${C.red}连接出错。检查地址、token，以及隧道是否还在运行。${C.reset}`);
});

ws.addEventListener('close', (ev) => {
  ensureNewline();
  if (ev.code === 4001 || ev.code === 1008) {
    sys(`${C.red}token 无效，连接被拒绝。${C.reset}`);
  } else {
    sys(`${C.yellow}连接已断开（code ${ev.code}）。${C.reset}`);
  }
  process.exit(0);
});

// ---------------------------------------------------------------
// 消息处理
// ---------------------------------------------------------------
ws.addEventListener('message', (ev) => {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }

  switch (msg.type) {
    case 'ready': {
      sys(`已连接 · 模型 ${msg.model || '(未配置)'} · 工作目录 ${msg.workspace || '(未设置)'}`);
      sys('输入消息回车发送，Ctrl+C 退出。');
      waitingReply = false;
      prompt();
      break;
    }

    case 'assistant_delta':
      streamOut(msg.text);
      break;

    case 'reasoning_delta':
      // 思考过程用暗色，避免和正文混淆
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
        // ask_user：AI 反过来提问，直接回一行文本
        process.stdout.write(`${C.magenta}AI 问你：${C.reset}${msg.title || ''}\n`);
        if (msg.detail) process.stdout.write(`${C.dim}${msg.detail}${C.reset}\n`);
        pendingApproval = { requestId: msg.requestId, kind: 'question' };
        process.stdout.write(`${C.green}回答 > ${C.reset}`);
      } else {
        process.stdout.write(`\n${C.yellow}${C.bold}【需要授权】${C.reset}${msg.title || ''}\n`);
        if (msg.detail) process.stdout.write(`${C.dim}${msg.detail}${C.reset}\n`);
        pendingApproval = { requestId: msg.requestId, kind: 'permission' };
        process.stdout.write(
          `${C.green}y${C.reset}=本次允许  ` +
          `${C.green}a${C.reset}=始终允许  ` +
          `${C.red}n${C.reset}=拒绝  > `
        );
      }
      break;
    }

    case 'preview':
      ensureNewline();
      sys(`[预览内容已生成 ${msg.html?.length ?? 0} 字符，终端无法渲染，可忽略]`);
      break;

    case 'balance':
      if (msg.supported && msg.balance) {
        sys(`余额：${JSON.stringify(msg.balance)}`);
      }
      break;

    case 'done':
      ensureNewline();
      waitingReply = false;
      if (msg.reason && msg.reason !== 'complete') {
        sys(`[结束：${msg.reason}]`);
      }
      prompt();
      break;

    case 'error':
      ensureNewline();
      sys(`${C.red}错误：${msg.message}${C.reset}`);
      waitingReply = false;
      prompt();
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------
// 读一行输入
// ---------------------------------------------------------------
rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false, // 自己控制提示符，避免和流式输出打架
});

rl.on('line', (line) => {
  const text = line.trim();

  // ---- 正在等审批 ----
  if (pendingApproval) {
    const pa = pendingApproval;

    if (pa.kind === 'question') {
      pendingApproval = null;
      ws.send(JSON.stringify({
        type: 'approval',
        requestId: pa.requestId,
        decision: 'allow',
        answer: line,
      }));
      ensureNewline();
      return;
    }

    const lower = text.toLowerCase();
    if (!['y', 'yes', 'a', 'always', 'n', 'no'].includes(lower)) {
      process.stdout.write(`${C.yellow}请输入 y / a / n：${C.reset}`);
      return;
    }

    pendingApproval = null;
    const decision = (lower === 'a' || lower === 'always')
      ? 'allow_always'
      : (lower === 'n' || lower === 'no')
        ? 'deny'
        : 'allow';

    ws.send(JSON.stringify({ type: 'approval', requestId: pa.requestId, decision }));
    ensureNewline();
    return;
  }

  // ---- 空行忽略 ----
  if (!text) {
    prompt();
    return;
  }

  // ---- 本地命令 ----
  if (text === '/quit' || text === '/exit') {
    ws.close();
    process.exit(0);
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

  if (ws.readyState !== ws.OPEN) {
    sys('连接已断开');
    return;
  }

  ensureNewline();
  process.stdout.write(`${C.cyan}AI > ${C.reset}`);
  waitingReply = true;
  ws.send(JSON.stringify({ type: 'user_message', text }));
});

rl.on('close', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  if (waitingReply) {
    ws.send(JSON.stringify({ type: 'abort' }));
    ensureNewline();
    sys('已中断');
    waitingReply = false;
    prompt();
  } else {
    ensureNewline();
    process.exit(0);
  }
});
