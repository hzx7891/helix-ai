// server/tool/whoami.js —— 身份工具
//
// 让 AI 能"知道自己是谁"：模型名、调用地址、工作目录、
// 权限模式、可用工具清单、Helix 版本号。
//
// 为什么单独做这个工具？
//   用户可能会改系统提示词、或者模型服务商换了，
//   如果把这些信息硬塞进提示词，用户删掉提示词就丢了。
//   做成工具，AI 随时能问，用户改不掉。

const HELIX_VERSION = '0.4.0';

// 可用工具清单：手动维护，跟 tool/index.js 里的 registry 保持一致
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
        '查看你自己的身份信息：正在用哪个模型、通过什么地址调用、\n' +
        '工作目录在哪、当前权限模式、有哪些工具可用、Helix 版本号。\n' +
        '当你需要向用户说明"我是谁"或"我能做什么"时，先调这个。',
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

  const lines = [];

  lines.push('你是 Helix（螺旋），一个本地优先的 AI Agent 工作台。');
  lines.push('');
  lines.push('—— 模型身份 ——');
  lines.push('模型名：' + (config.model || '(未配置)'));
  lines.push('调用地址：' + (config.baseUrl || '(未配置)'));
  lines.push('API Key：' + (config.hasKey ? '已配置（内容对你不可见）' : '未配置'));
  lines.push('');
  lines.push('—— 运行环境 ——');
  lines.push('工作目录：' + workspace);
  lines.push('权限模式：' + (MODE_LABEL[mode] || mode));
  lines.push('Helix 版本：v' + HELIX_VERSION);
  lines.push('');
  lines.push('—— 可用工具（共 ' + TOOL_LIST.length + ' 个）——');
  for (const t of TOOL_LIST) {
    lines.push('  · ' + t.name + ' —— ' + t.desc);
  }
  lines.push('');
  lines.push('—— 提醒 ——');
  lines.push('你的知识有截止日期，遇到"最新版本"、"最近发生了什么"这类问题，');
  lines.push('先用 web_search 或 fetch_url 查，不要凭记忆猜。');

  return lines.join('\n');
}
