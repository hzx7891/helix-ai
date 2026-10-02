// server/session.js —— 会话持久化
//
// 每次 AI 回答完，把整段对话存到：
//   ~/.helix/sessions/<标题>/conversation.json   对话内容
//   ~/.helix/sessions/<标题>/tools.jsonl         工具调用日志（一行一条）
//
// 完全独立于前端 localStorage：那是浏览器里的，这是硬盘上的。
// 两边都存，互为备份。

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const SESSIONS_DIR = join(homedir(), '.helix', 'sessions');

// 把标题变成安全的文件夹名
function sanitizeName(name) {
  let s = String(name || '').trim();
  if (!s) s = '未命名';
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) s = '未命名';
  if (s.length > 60) s = s.slice(0, 60);
  return s;
}

// 从消息里抽标题：第一条用户消息前 20 字
export function titleFromMessages(messages) {
  if (!Array.isArray(messages)) return '未命名';
  for (const m of messages) {
    if (m && m.role === 'user' && typeof m.content === 'string') {
      const t = m.content.replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 20);
    }
  }
  return '未命名';
}

export async function saveSession(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;

  const title = titleFromMessages(messages);
  const safeName = sanitizeName(title);
  const folder = join(SESSIONS_DIR, safeName);

  await mkdir(folder, { recursive: true });

  const conversation = {
    name: title,
    savedAt: Date.now(),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      role: m.role,
      text: m.content || '',
      reasoning: m.reasoning || '',
      ts: m.ts,
      tools: m.tools || [],
    })),
  };
  await writeFile(
    join(folder, 'conversation.json'),
    JSON.stringify(conversation, null, 2),
    'utf-8'
  );

  // tools.jsonl —— 每行一个工具调用
  const lines = [];
  for (const m of messages) {
    if (!m || !Array.isArray(m.tools)) continue;
    for (const t of m.tools) {
      if (!t) continue;
      lines.push(JSON.stringify({
        ts: t.ts || Date.now(),
        name: t.name || 'unknown',
        status: t.status || 'unknown',
        args: t.args,
        result: typeof t.result === 'string' ? t.result.slice(0, 2000) : t.result,
      }));
    }
  }
  if (lines.length) {
    await writeFile(join(folder, 'tools.jsonl'), lines.join('\n') + '\n', 'utf-8');
  }

  return {
    name: title,
    folder: safeName,
    messageCount: messages.length,
    toolCount: lines.length,
  };
}

export async function listSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const raw = await readFile(join(SESSIONS_DIR, e.name, 'conversation.json'), 'utf-8');
      const data = JSON.parse(raw);
      out.push({
        folder: e.name,
        name: data.name || e.name,
        savedAt: data.savedAt || 0,
        messageCount: data.messageCount || 0,
      });
    } catch {}
  }
  out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return out;
}

export async function loadSession(folder) {
  const safeName = sanitizeName(folder);
  const file = join(SESSIONS_DIR, safeName, 'conversation.json');
  if (!existsSync(file)) throw new Error('对话不存在：' + safeName);
  return JSON.parse(await readFile(file, 'utf-8'));
}

export async function deleteSession(folder) {
  const safeName = sanitizeName(folder);
  const target = join(SESSIONS_DIR, safeName);
  if (!existsSync(target)) throw new Error('对话不存在：' + safeName);
  await rm(target, { recursive: true, force: true });
}

export function getSessionsDir() {
  return SESSIONS_DIR;
}
