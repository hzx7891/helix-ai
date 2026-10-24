// Helix 配置：读写 ~/.helix/config.json，支持多 Profile，API Key 只进不出

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const HELIX_DIR = join(homedir(), '.helix');
const CONFIG_PATH = join(HELIX_DIR, 'config.json');

const DEFAULT_PROFILE = {
  id: 'p-default',
  name: '默认配置',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

const DEFAULT_CONFIG = {
  activeProfileId: DEFAULT_PROFILE.id,
  profiles: [{ ...DEFAULT_PROFILE }],
  workspace: process.cwd(),
  systemPrompt: '你是一个本地 AI 助手，可以调用工具帮助用户。回答用中文，简洁清楚。',
  permissionMode: 'ask',
  temperature: 0.7,
  maxTokens: 4096,
  cmdTimeout: 30,
  useAiTitle: false,
};

// 核心：升级旧版结构到新版结构，并拍平当前激活的 Profile 以兼容旧代码
function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    raw = {};
  }

  let config = { ...DEFAULT_CONFIG };

  // 如果是全新配置（没有 profiles，也没有 apiKey）
  if (!raw.profiles && !raw.apiKey && !raw.model) {
    return {
      ...config,
      apiKey: DEFAULT_PROFILE.apiKey,
      baseUrl: DEFAULT_PROFILE.baseUrl,
      model: DEFAULT_PROFILE.model,
    };
  }

  // 如果已经是新版结构
  if (Array.isArray(raw.profiles)) {
    config = { ...config, ...raw };
    if (!config.profiles.length) {
      config.profiles = [{ ...DEFAULT_PROFILE }];
    }
    if (!config.activeProfileId || !config.profiles.find(p => p.id === config.activeProfileId)) {
      config.activeProfileId = config.profiles[0].id;
    }
    // 确保每个 profile 都有必备字段
    config.profiles = config.profiles.map((p, i) => ({
      id: p.id || `p-${i}-${Date.now()}`,
      name: p.name || `AI 配置 ${i + 1}`,
      apiKey: p.apiKey || '',
      baseUrl: p.baseUrl || DEFAULT_PROFILE.baseUrl,
      model: p.model || DEFAULT_PROFILE.model,
    }));
  } else {
    // 旧版结构升级：提取顶层的 apiKey、baseUrl、model
    const migratedProfile = {
      id: 'p-default',
      name: '默认配置 (已升级)',
      apiKey: raw.apiKey || '',
      baseUrl: raw.baseUrl || DEFAULT_PROFILE.baseUrl,
      model: raw.model || DEFAULT_PROFILE.model,
    };

    config.profiles = [migratedProfile];
    config.activeProfileId = migratedProfile.id;

    // 把旧版的其他全局字段（如 workspace、systemPrompt）复制过来
    for (const key of Object.keys(raw)) {
      if (key !== 'apiKey' && key !== 'baseUrl' && key !== 'model') {
        config[key] = raw[key];
      }
    }
  }

  // 🌟 关键一步：把当前激活的 Profile 字段“拍平”到外层
  // 这样老的 llm.js 和前端代码直接读 config.apiKey 依然能正常工作
  const active = config.profiles.find(p => p.id === config.activeProfileId) || config.profiles[0];
  config.apiKey = active.apiKey;
  config.baseUrl = active.baseUrl;
  config.model = active.model;

  return config;
}

// 读取配置。文件不存在就返回默认值
export async function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return migrateConfig({});
    }
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return migrateConfig(parsed);
  } catch (err) {
    console.error('读取配置失败：', err.message);
    return migrateConfig({});
  }
}

// 保存配置。支持同时保存全局配置和 profiles 数组
export async function saveConfig(partial) {
  const current = await loadConfig();
  let next = { ...current };

  if (!partial) partial = {};

  // 1. 处理全局字段覆盖（不在 profiles 里的）
  for (const [key, value] of Object.entries(partial)) {
    if (key === 'profiles' || key === 'activeProfileId') continue;
    // 特别处理：如果是旧版前端传来了顶层的 apiKey/model，稍后我们会把它塞进 Profile
    if (key === 'apiKey' || key === 'baseUrl' || key === 'model') continue;
    
    if (value === '' || value === null || value === undefined) continue;
    next[key] = value;
  }

  // 2. 如果前端直接传了 profiles（全量替换）
  if (Array.isArray(partial.profiles)) {
    next.profiles = partial.profiles.map((p, i) => {
      // 如果没传 apiKey，用原来的 apiKey 兜底（防止留空输入框把 Key 抹掉）
      const existing = current.profiles.find(x => x.id === p.id);
      let apiKey = p.apiKey;
      if ((apiKey === '' || apiKey === undefined) && existing && existing.apiKey) {
        apiKey = existing.apiKey;
      }
      return {
        id: p.id || `p-${i}-${Date.now()}`,
        name: p.name || `AI 配置 ${i + 1}`,
        apiKey: apiKey || '',
        baseUrl: p.baseUrl || DEFAULT_PROFILE.baseUrl,
        model: p.model || DEFAULT_PROFILE.model,
      };
    });
    if (!next.profiles.length) next.profiles = [{ ...DEFAULT_PROFILE }];
  }

  if (partial.activeProfileId) {
    next.activeProfileId = partial.activeProfileId;
  }

  // 确保 activeProfileId 是有效的
  if (!next.profiles.find(p => p.id === next.activeProfileId)) {
    next.activeProfileId = next.profiles[0].id;
  }

  // 3. 兼容旧版前端的保存请求（只传了顶层的 apiKey/model）
  if (partial.apiKey !== undefined || partial.model !== undefined || partial.baseUrl !== undefined) {
    const active = next.profiles.find(p => p.id === next.activeProfileId) || next.profiles[0];
    if (partial.apiKey && partial.apiKey.trim() !== '') active.apiKey = partial.apiKey;
    if (partial.model && partial.model.trim() !== '') active.model = partial.model;
    if (partial.baseUrl && partial.baseUrl.trim() !== '') active.baseUrl = partial.baseUrl;
  }

  // 4. 准备写入文件（写入前必须删掉拍平的冗余字段，保持配置文件结构干净）
  const toSave = { ...next };
  delete toSave.apiKey;
  delete toSave.baseUrl;
  delete toSave.model;

  if (!existsSync(HELIX_DIR)) {
    await mkdir(HELIX_DIR, { recursive: true });
  }

  await writeFile(CONFIG_PATH, JSON.stringify(toSave, null, 2), 'utf-8');

  try { await chmod(CONFIG_PATH, 0o600); } catch {}

  return next;
}

// 脱敏版本：遍历所有 Profile，剔除 apiKey
export function redactConfig(config) {
  const safeProfiles = config.profiles.map(p => {
    const { apiKey, ...rest } = p;
    return {
      ...rest,
      hasKey: Boolean(apiKey && apiKey.length > 0)
    };
  });

  // 顶层也做一个脱敏兜底
  const { apiKey, baseUrl, model, profiles, ...rest } = config;
  const active = profiles.find(p => p.id === config.activeProfileId) || profiles[0];

  return {
    ...rest,
    profiles: safeProfiles,
    hasKey: Boolean(active && active.apiKey),
    // 方便旧版前端依然能显示当前激活的模型名
    model: active ? active.model : '',
    baseUrl: active ? active.baseUrl : ''
  };
}