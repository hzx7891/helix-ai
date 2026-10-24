// server/session.js —— 终极会话持久化模块
// 
// 架构设计：
// 1. 每个对话拥有一个唯一的 UUID 文件夹，彻底解决同名冲突问题。
// 2. 文件夹内部结构：
//    ~/.helix/sessions/<uuid>/
//      ├── meta.json       - 元数据（包含标题、创建时间、更新时间、消息数等）
//      ├── title.txt       - 纯文本标题（方便直接用文本编辑器看，满足需求）
//      ├── history.json    - 清洗后的纯净聊天记录
//      └── tool_logs.jsonl - 工具调用的详细流水账
// 3. 彻底兼容旧数据读取，但新数据全部采用 UUID 隔离。
// 4. 预留了 AI 自动生成标题的接口开关（默认通过 meta.json 记录）。

import { 
  mkdir, 
  writeFile, 
  readFile, 
  readdir, 
  rm, 
  stat, 
  access 
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------
// 全局配置
// ---------------------------------------------------------

// 会话存储的根目录
const SESSIONS_DIR = join(homedir(), '.helix', 'sessions');

// 允许的文件夹名称正则（只允许字母、数字、连字符）
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------
// 基础工具函数
// ---------------------------------------------------------

/**
 * 确保根目录存在
 */
async function ensureBaseDir() {
  try {
    if (!existsSync(SESSIONS_DIR)) {
      await mkdir(SESSIONS_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[session] 无法创建会话根目录:', err);
  }
}

/**
 * 清理非法的标题字符，作为备用兜底（虽然现在文件夹名用 UUID 了，但标题本身也要干净）
 */
export function sanitizeTitle(title) {
  let s = String(title || '').trim();
  if (!s) return '新对话';
  // 替换掉可能破坏 JSON 或截断显示的字符
  s = s.replace(/[\n\r\t]/g, ' ');
  // 过滤掉一些控制字符
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  // 限制长度
  if (s.length > 50) {
    s = s.slice(0, 50) + '...';
  }
  return s;
}

/**
 * 从消息列表中提取第一句话作为默认标题
 */
export function extractTitleFromMessages(messages) {
  if (!Array.isArray(messages)) return '新对话';
  for (const m of messages) {
    if (m && m.role === 'user' && typeof m.content === 'string') {
      const text = m.content.replace(/\s+/g, ' ').trim();
      // 如果是 / 开头的命令，跳过
      if (text && !text.startsWith('/')) {
        return sanitizeTitle(text);
      }
    }
  }
  return '新对话';
}

/**
 * 生成一个唯一的会话 ID (UUID)
 */
export function generateSessionId() {
  return randomUUID();
}

// ---------------------------------------------------------
// 核心业务逻辑
// ---------------------------------------------------------

/**
 * 创建新会话文件夹
 * @param {string} [initialTitle] 初始标题
 * @returns {Promise<{id: string, title: string}>}
 */
export async function createSession(initialTitle) {
  await ensureBaseDir();
  const id = generateSessionId();
  const title = sanitizeTitle(initialTitle || '新对话');
  const folder = join(SESSIONS_DIR, id);

  // 1. 创建目录
  await mkdir(folder, { recursive: true });

  // 2. 写入 meta.json
  const meta = {
    id,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 0,
    useAiTitle: false, // 预留：是否让 AI 生成标题
  };
  await writeFile(join(folder, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  // 3. 写入 title.txt
  await writeFile(join(folder, 'title.txt'), title, 'utf-8');

  // 4. 初始化空的 history.json 和 tool_logs.jsonl
  await writeFile(join(folder, 'history.json'), JSON.stringify([], null, 2), 'utf-8');
  await writeFile(join(folder, 'tool_logs.jsonl'), '', 'utf-8');

  return { id, title };
}

/**
 * 保存会话（更新已有的会话）
 * @param {string} id 会话 UUID
 * @param {Array} messages 完整的 OpenAI 格式历史记录
 * @param {Object} [options] 额外选项
 */
export async function saveSession(id, messages, options = {}) {
  if (!Array.isArray(messages)) return;
  
  // 如果没传 id（旧版兼容），动态生成一个
  let sessionId = id;
  if (!sessionId || !UUID_REGEX.test(sessionId)) {
    const oldTitle = extractTitleFromMessages(messages);
    const created = await createSession(oldTitle);
    sessionId = created.id;
  }

  const folder = join(SESSIONS_DIR, sessionId);
  
  // 确保目录存在，防止被手动删除了
  if (!existsSync(folder)) {
    await mkdir(folder, { recursive: true });
  }

  // 1. 更新 meta.json 和 title.txt
  const metaPath = join(folder, 'meta.json');
  let meta = {
    id: sessionId,
    title: extractTitleFromMessages(messages),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: messages.length,
    useAiTitle: false,
  };

  try {
    if (existsSync(metaPath)) {
      const oldRaw = await readFile(metaPath, 'utf-8');
      const oldMeta = JSON.parse(oldRaw);
      // 保留创建时间和原有的标题（除非用户或 AI 主动改了标题）
      meta = {
        ...oldMeta,
        ...meta,
        title: options.newTitle ? sanitizeTitle(options.newTitle) : oldMeta.title,
        createdAt: oldMeta.createdAt || Date.now(),
      };
    }
  } catch (e) {
    // 忽略读取损坏的 meta.json
  }

  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  await writeFile(join(folder, 'title.txt'), meta.title, 'utf-8');

  // 2. 写入 history.json（清洗格式）
  const cleanHistory = messages.map((m) => ({
    role: m.role || 'unknown',
    text: m.content || '',
    reasoning: m.reasoning || '',
    ts: m.ts || Date.now(),
    // 如果有工具调用，也保留在 history 里，方便前端回显
    tool_calls: m.tool_calls || undefined,
    tool_call_id: m.tool_call_id || undefined
  }));
  await writeFile(
    join(folder, 'history.json'),
    JSON.stringify(cleanHistory, null, 2),
    'utf-8'
  );

  // 3. 解析工具日志，写入 tool_logs.jsonl
  const toolLogs = [];
  let pendingTools = {};

  for (const m of messages) {
    // AI 发起工具调用
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (!tc.id) continue;
        pendingTools[tc.id] = {
          ts: Date.now(),
          name: tc.function?.name || 'unknown',
          args: tc.function?.arguments || '{}',
          status: 'running',
          result: '',
        };
      }
    }
    // 工具执行结果返回
    else if (m.role === 'tool' && m.tool_call_id) {
      const t = pendingTools[m.tool_call_id];
      if (t) {
        t.status = 'ok';
        t.result = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        toolLogs.push(t);
        delete pendingTools[m.tool_call_id];
      }
    }
  }

  // 记录未完成的工具（被中断）
  for (const id in pendingTools) {
    pendingTools[id].status = 'aborted';
    toolLogs.push(pendingTools[id]);
  }

  if (toolLogs.length > 0) {
    // 采用追加模式（a）还是覆盖模式（w）？为了防止日志丢失，采用追加
    // 但为了避免重复，这里我们采用覆盖（w），每次全量生成日志文件
    const lines = toolLogs.map(t => JSON.stringify(t));
    await writeFile(
      join(folder, 'tool_logs.jsonl'),
      lines.join('\n') + '\n',
      'utf-8'
    );
  }
}

/**
 * 获取所有会话列表
 */
export async function listSessions() {
  await ensureBaseDir();
  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const out = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // 严格校验文件夹名是否为 UUID，过滤掉以前旧的“中文标题”文件夹
    if (!UUID_REGEX.test(e.name)) continue;

    try {
      const metaPath = join(SESSIONS_DIR, e.name, 'meta.json');
      if (!existsSync(metaPath)) continue;

      const raw = await readFile(metaPath, 'utf-8');
      const data = JSON.parse(raw);
      
      out.push({
        id: data.id || e.name,
        title: data.title || '未命名',
        createdAt: data.createdAt || 0,
        updatedAt: data.updatedAt || 0,
        messageCount: data.messageCount || 0,
        useAiTitle: data.useAiTitle || false,
      });
    } catch {
      // 忽略损坏的文件夹
    }
  }
  
  // 按更新时间倒序
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/**
 * 读取特定会话的完整数据
 */
export async function loadSession(id) {
  if (!id || !UUID_REGEX.test(id)) throw new Error('无效的会话 ID');
  
  const folder = join(SESSIONS_DIR, id);
  const metaPath = join(folder, 'meta.json');
  const histPath = join(folder, 'history.json');

  if (!existsSync(histPath)) throw new Error('会话不存在');

  try {
    const metaRaw = await readFile(metaPath, 'utf-8');
    const histRaw = await readFile(histPath, 'utf-8');
    
    const meta = JSON.parse(metaRaw);
    const messages = JSON.parse(histRaw);

    return {
      meta,
      messages
    };
  } catch (err) {
    throw new Error('读取会话数据失败：' + err.message);
  }
}

/**
 * 删除特定会话
 */
export async function deleteSession(id) {
  if (!id || !UUID_REGEX.test(id)) throw new Error('无效的会话 ID');
  
  const folder = join(SESSIONS_DIR, id);
  if (!existsSync(folder)) return;

  await rm(folder, { recursive: true, force: true });
}

/**
 * 更新标题（供 AI 生成标题或用户手动修改使用）
 */
export async function updateSessionTitle(id, newTitle) {
  if (!id || !UUID_REGEX.test(id)) throw new Error('无效的会话 ID');
  
  const folder = join(SESSIONS_DIR, id);
  const metaPath = join(folder, 'meta.json');
  
  if (!existsSync(metaPath)) throw new Error('会话不存在');

  const title = sanitizeTitle(newTitle);
  const raw = await readFile(metaPath, 'utf-8');
  const meta = JSON.parse(raw);
  
  meta.title = title;
  meta.updatedAt = Date.now();
  // 如果明确传入，可以标记为使用了 AI 标题
  meta.useAiTitle = true;

  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  await writeFile(join(folder, 'title.txt'), title, 'utf-8');
  
  return title;
}