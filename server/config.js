// Helix 配置：读写 ~/.helix/config.json，API Key 只进不出

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const HELIX_DIR = join(homedir(), '.helix');
const CONFIG_PATH = join(HELIX_DIR, 'config.json');

// 默认配置：第一次运行时用这个
const DEFAULT_CONFIG = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  workspace: process.cwd(),
  systemPrompt: '你是一个本地 AI 助手，可以调用工具帮助用户。回答用中文，简洁清楚。',
  permissionMode: 'ask', // ask | auto | readonly
};

// 读取配置。文件不存在就返回默认值
export async function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // 用默认值兜底，防止旧配置文件缺字段
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error('读取配置失败：', err.message);
    return { ...DEFAULT_CONFIG };
  }
}

// 保存配置。只覆盖传进来的字段，其他保持不变
export async function saveConfig(partial) {
  const current = await loadConfig();
  const next = { ...current, ...partial };

  // 确保 ~/.helix 目录存在
  if (!existsSync(HELIX_DIR)) {
    await mkdir(HELIX_DIR, { recursive: true });
  }

  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8');

  // 权限 0600：只有本用户能读写。Windows 上这行会静默失败，不影响使用
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Windows 不支持，忽略
  }

  return next;
}

// 脱敏版本：发给前端时用。绝不包含 apiKey 原文
export function redactConfig(config) {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    hasKey: Boolean(apiKey && apiKey.length > 0),
  };
}
