#!/usr/bin/env node
// Helix 启动入口：找端口、生成 token、启动后端、打开浏览器

import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { startServer } from '../server/index.js';

const DEFAULT_PORT = 3000;
const MAX_PORT_TRIES = 100;

// 找一个没被占用的端口，从 startPort 开始往上试
function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;

    function tryPort() {
      if (tries >= MAX_PORT_TRIES) {
        reject(new Error(`从 ${startPort} 开始试了 ${MAX_PORT_TRIES} 个端口都被占用了`));
        return;
      }

      const tester = createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          port += 1;
          tries += 1;
          tryPort();
        } else {
          reject(err);
        }
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port, '127.0.0.1');
    }

    tryPort();
  });
}

// 根据操作系统打开浏览器
function openBrowser(url) {
  const os = platform();
  let command;

  if (os === 'darwin') {
    command = `open "${url}"`;
  } else if (os === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.log('没能自动打开浏览器，请手动复制上面的地址访问。');
    }
  });
}

async function main() {
  try {
    const port = await findAvailablePort(DEFAULT_PORT);
    const token = randomBytes(16).toString('hex');

    const serverInfo = await startServer({ port, token });
    const actualPort = serverInfo.port || port;
    const url = `http://127.0.0.1:${actualPort}/?token=${token}`;

    console.log('');
    console.log('🧬 Helix 已启动');
    console.log(`   地址：${url}`);
    console.log(`   工作目录：${serverInfo.workspace || '未设置'}`);
    console.log('');
    console.log('   按 Ctrl+C 停止');
    console.log('');

    openBrowser(url);
  } catch (err) {
    console.error('启动失败：', err.message);
    process.exit(1);
  }
}

main();
