// Helix 后端入口：启动 HTTP 服务 + WebSocket，托管 public/ 静态文件

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, saveConfig, redactConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', 'public');
const VERSION = '0.0.1';

// 临时页面：public/index.html 还没写好的时候，先给浏览器看这个
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

export function startServer({ port, token }) {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use(express.json({ limit: '5mb' }));

    // 健康检查
    app.get('/api/health', (req, res) => {
      res.json({
        ok: true,
        version: VERSION,
        uptime: process.uptime(),
      });
    });

    // 读取配置（Key 脱敏）
    app.get('/api/config', async (req, res) => {
      try {
        const config = await loadConfig();
        res.json(redactConfig(config));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // 保存配置
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

      ws.send(JSON.stringify({
        type: 'ready',
        model: config.model || null,
        workspace: config.workspace || null,
      }));

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        console.log('收到前端消息：', msg.type);
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
