// server/tool/index.js —— 工具注册表 + 分发器

import * as fileTools from './file.js';
import * as shellTools from './shell.js';
import { requestApproval, makeRequestId } from '../approval.js';

// 只读工具：不碰文件系统写入，不执行命令
// system_info 只读进程信息，也放这里
export const READONLY_TOOLS = new Set([
  'list_dir',
  'read_file',
  'web_search',
  'fetch_url',
  'system_info',
]);

// 写/执行工具：危险，需要审批
export const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'delete_path',
  'run_command',
]);

const registry = {
  list_dir: fileTools.list_dir,
  read_file: fileTools.read_file,
  write_file: fileTools.write_file,
  run_command: shellTools.run_command,
  system_info: shellTools.system_info,
};

export function getToolDefinitions() {
  return [
    ...fileTools.definitions,
    ...shellTools.definitions,
  ];
}

async function runTool(fn, args, context) {
  try {
    const result = await fn(args, context);
    return { ok: true, result: String(result) };
  } catch (err) {
    return { ok: false, result: err.message || String(err) };
  }
}

export async function executeTool(name, args, context) {
  const fn = registry[name];
  if (!fn) {
    return { ok: false, result: '未知工具：' + name };
  }

  const mode = context?.config?.permissionMode || 'auto';
  const ws = context?.ws;
  const alwaysAllowed = context?.alwaysAllowed || new Set();

  if (mode === 'ask') {
    return { ok: false, result: 'ask 模式已禁用所有工具，AI 只能对话' };
  }

  if (mode === 'agent') {
    return await runTool(fn, args, context);
  }

  let needApproval = false;
  if (READONLY_TOOLS.has(name)) {
    needApproval = (mode === 'work');
  } else if (WRITE_TOOLS.has(name)) {
    needApproval = (mode === 'auto' || mode === 'work');
  } else {
    needApproval = true;
  }

  if (!needApproval) {
    return await runTool(fn, args, context);
  }

  if (alwaysAllowed.has(name)) {
    return await runTool(fn, args, context);
  }

  if (!ws || ws.readyState !== ws.OPEN) {
    return { ok: false, result: '无法发起审批：连接已断开' };
  }

  const requestId = makeRequestId();
  const detail =
    'AI 想要执行：' + name + '\n\n' +
    '参数：\n' + JSON.stringify(args, null, 2);

  const { decision } = await requestApproval(ws, {
    requestId,
    kind: 'permission',
    title: '权限请求',
    detail,
    tool: name,
  });

  if (decision === 'deny') {
    return { ok: false, result: '用户拒绝了此操作' };
  }
  if (decision === 'allow_always') {
    alwaysAllowed.add(name);
  }
  return await runTool(fn, args, context);
}
