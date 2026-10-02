// server/tool/whoami.js —— 身份工具
//
// 让 AI 清楚知道"自己是谁"。
//
// 为什么要这么直白？
//   系统提示词说"你是 Helix"，AI 就信自己是 Helix，被问
//   "你是 DeepSeek 吗"它会说"不知道"。原因是提示词和
//   事实矛盾，它无从判断。
//   这个工具的作用就是给出"铁证"：你跑在什么工具里、
//   你底层是哪个模型、调用地址是什么。

const HELIX_VERSION = '0.4.0';

// 服务商识别表：baseUrl 里的关键词 → 显示名
const PROVIDER_TABLE = [
  { key: 'deepseek.com', name: 'DeepSeek' },
  { key: 'api.openai.com', name: 'OpenAI' },
  { key: 'openai.com', name: 'OpenAI（兼容）' },
  { key: 'moonshot.cn', name: '月之暗面 Kimi' },
  { key: 'dashscope.aliyuncs.com', name: '阿里通义千问' },
  { key: 'bigmodel.cn', name: '智谱 GLM' },
  { key: 'volces.com', name: '字节豆包' },
  { key: 'siliconflow.cn', name: '硅基流动' },
  { key: 'anthropic.com', name: 'Anthropic' },
  { key: 'generativelanguage.googleapis.com', name: 'Google Gemini' },
];

function detectProvider(baseUrl) {
  if (!baseUrl) return null;
  const u = String(baseUrl).toLowerCase();
  for (const p of PROVIDER_TABLE) {
    if (u.includes(p.key)) return p.name;
  }
  return null;
}

// 从 baseUrl 抽个"看得懂的域名"，用于显示
function hostOf(baseUrl) {
  if (!baseUrl) return '';
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

const TOOL_LIST = [
  { name: 'list_dir',       desc: '列出目录内容' },
  { name: 'read_file',      desc: '读取文件内容' },
  { name: 'write_file',     desc: '写入文件（需审批）' },
  { name: 'run_command',    desc: '执行命令（需审批）' },
  { name: 'system_info',    desc: '查询当前系统环境' },
  { name: 'web_search',     desc: '搜索网络信息' },
  { name: 'fetch_url',      desc: '抓取网页内容' },
  { name: 'render_preview', desc: '在预览面板渲染 HTML' },
  { name: 'ask_user',       desc: '向用户提问' },
  { name: 'whoami',         desc: '查看自己的身份信息（就是这个）' },
];

const MODE_LABEL = {
  ask:   'ask（纯问答，禁用工具）',
  auto:  'auto（只读放行，写/执行需审批）',
  work:  'work（所有工具调用都要审批）',
  agent: 'agent（完全自主，不弹审批）',
};

export const definitions = [
  {
    type: 'function',
    function: {
      name: 'whoami',
      description:
        '查看你自己的真实身份。包括：你运行在什么工具里、\n' +
        '你的底层模型是哪家公司的哪个模型、通过什么地址调用、\n' +
        '工作目录、权限模式、可用工具清单。\n' +
        '重要：当用户问"你是谁"、"你是 DeepSeek 吗"、"你是\n' +
        '什么模型"这类问题时，先调这个工具，按返回的事实回答，\n' +
        '不要凭系统提示词里的"你是 Helix"就否认底层身份。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

export async function whoami(args, context) {
  const config = context?.config || {};
  const workspace = context?.workspace || '(未设置)';
  const mode = config.permissionMode || 'auto';
  const baseUrl = config.baseUrl || '';
  const model = config.model || '(未配置)';
  const provider = detectProvider(baseUrl);
  const host = hostOf(baseUrl);

  const lines = [];

  lines.push('【你的真实身份】');
  lines.push('');
  lines.push('· 你运行在：Helix（螺旋）—— 一个开源、本地优先的');
  lines.push('  AI Agent 工作台，MIT 协议，不是 AI 公司。');
  lines.push('· 你的底层模型：' +
    (provider ? provider + ' 的 ' + model : model + '（服务商未识别）'));
  lines.push('· 调用地址：' + (baseUrl || '(未配置)'));
  if (host) lines.push('· 域名：' + host);
  lines.push('· API Key：' + ((config.hasKey || (config.apiKey && config.apiKey.length > 0)) ? '已配置（内容对你不可见）' : '未配置'));
  lines.push('');
  lines.push('【被问"你是谁"时的正确回答】');
  if (provider) {
    lines.push('你说：我是运行在 Helix 工具里的 ' + provider + ' 模型（' + model + '）。');
    lines.push('Helix 本身不是 AI，它是一个让你（模型）能读写文件、');
    lines.push('执行命令、联网的本地工具壳。');
    lines.push('');
    lines.push('如果用户问"你是 DeepSeek 吗"，根据上面的服务商判断：');
    if (provider === 'DeepSeek') {
      lines.push('  → 是的，你的底层模型确实来自 DeepSeek。不要否认。');
    } else {
      lines.push('  → 不是。你的底层模型来自 ' + provider + '。');
    }
  } else {
    lines.push('服务商未识别。你只能告诉用户：我运行在 Helix 里，');
    lines.push('底层模型是 ' + model + '，调用地址是 ' + (baseUrl || '未配置'));
    lines.push('。具体是哪家公司，我不能瞎猜。');
  }
  lines.push('');
  lines.push('【不要做的事】');
  lines.push('· 不要说"我是 Helix 开发的 AI"——Helix 不开发 AI。');
  lines.push('· 不要凭系统提示词里"你是 Helix"就否认底层模型身份。');
  lines.push('· 不确定就调这个工具，按返回的事实说话。');
  lines.push('');
  lines.push('【运行环境】');
  lines.push('· 工作目录：' + workspace);
  lines.push('· 权限模式：' + (MODE_LABEL[mode] || mode));
  lines.push('· Helix 版本：v' + HELIX_VERSION);
  lines.push('');
  lines.push('【可用工具（共 ' + TOOL_LIST.length + ' 个）】');
  for (const t of TOOL_LIST) {
    lines.push('  · ' + t.name + ' —— ' + t.desc);
  }
  lines.push('');
  lines.push('【提醒】');
  lines.push('你的训练知识有截止日期。遇到"最新版本"、"最近');
  lines.push('发生了什么"这类问题，先用 web_search 或 fetch_url');
  lines.push('查，不要凭记忆猜。');

  return lines.join('\n');
}
