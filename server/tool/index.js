// server/tool/index.js —— 工具注册表 + 分发器
//
// 设计要点：
//   1. 权限三分：只读 / 写 / 特殊（绕过通用审批）
//   2. 执行超时：任何工具卡住都有兜底，AI 不会被挂死
//   3. 返回结构化：字符串直通，其它走 JSON（不再有 [object Object]）
//   4. 开发期自检：注册表 / 定义 / 权限集 三者一致性
//   5. 未知工具给近似建议：AI 打错字不至于原地瞎猜
//   6. 审计 + 限流：所有调用落环形缓冲，高频工具软限流
//
// 依赖 audit.js。所有路径都会记录，成功/失败/拒绝都能查。

import * as fileTools from './file.js';
import * as shellTools from './shell.js';
import * as webTools from './web.js';
import * as uiTools from './ui.js';
import * as whoamiTools from './whoami.js';
import { requestApproval, makeRequestId } from '../approval.js';
import * as audit from './audit.js';

const isDev = process.env.NODE_ENV !== 'production';

// 单个工具执行的最长时间。超时后 AI 会收到"执行超时"，
// 而不是一直挂在那里。注意：这不会真的杀掉底层操作
// （fetch 靠自己 AbortController，子进程看 shell.js 自己的实现），
// 但至少能让 agent loop 继续往下走。
const TOOL_TIMEOUT_MS = 60000;

// 审批弹窗里最多显示多少字符的参数。写文件那种长内容
// 直接塞进弹窗会撑爆 UI，也容易让用户看不清重点。
const MAX_APPROVAL_DETAIL_CHARS = 4000;

// ---------------------------------------------------------------
// 权限分类
// ---------------------------------------------------------------

// 只读：不写文件、不执行命令、不改外部状态
export const READONLY_TOOLS = new Set([
  'list_dir',
  'read_file',
  'system_info',
  'web_search',
  'fetch_url',
  'whoami',
]);

// 写/执行：危险，需要审批
export const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'delete_path',
  'run_command',
]);

// 特殊：不走通用审批流程
//   render_preview —— 永远放行（它自己会推 preview 消息）
//   ask_user       —— 自己会发 question 类型的弹窗
export const SPECIAL_TOOLS = new Set([
  'render_preview',
  'ask_user',
]);

// ---------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------

const registry = {
  // file
  list_dir: fileTools.list_dir,
  read_file: fileTools.read_file,
  write_file: fileTools.write_file,
  // shell
  run_command: shellTools.run_command,
  system_info: shellTools.system_info,
  // web
  web_search: webTools.web_search,
  fetch_url: webTools.fetch_url,
  // ui
  render_preview: uiTools.render_preview,
  ask_user: uiTools.ask_user,
  // identity
  whoami: whoamiTools.whoami,
};

export function getToolDefinitions() {
  return [
    ...fileTools.definitions,
    ...shellTools.definitions,
    ...webTools.definitions,
    ...uiTools.definitions,
    ...whoamiTools.definitions,
  ];
}

// ---------------------------------------------------------------
// 开发期自检
// ---------------------------------------------------------------
// 只在非 production 跑。发现问题只 warn，不阻断启动。

if (isDev) {
  try {
    const defNames = new Set(
      getToolDefinitions()
        .map((d) => d?.function?.name)
        .filter(Boolean)
    );
    const regNames = new Set(Object.keys(registry));

    const missing = [...defNames].filter((n) => !regNames.has(n));
    const extra = [...regNames].filter((n) => !defNames.has(n));
    if (missing.length) {
      console.warn('[tool] 有定义但没注册（AI 会一直拿到"未知工具"）：', missing);
    }
    if (extra.length) {
      console.warn('[tool] 注册了但没定义（AI 看不见，等于白写）：', extra);
    }

    const groups = [
      ['READONLY_TOOLS', READONLY_TOOLS],
      ['WRITE_TOOLS', WRITE_TOOLS],
      ['SPECIAL_TOOLS', SPECIAL_TOOLS],
    ];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const [nameA, setA] = groups[i];
        const [nameB, setB] = groups[j];
        const overlap = [...setA].filter((n) => setB.has(n));
        if (overlap.length) {
          console.warn(`[tool] ${nameA} 与 ${nameB} 有重叠：`, overlap);
        }
      }
    }

    const classified = new Set([
      ...READONLY_TOOLS,
      ...WRITE_TOOLS,
      ...SPECIAL_TOOLS,
    ]);
    const unclassified = [...regNames].filter((n) => !classified.has(n));
    if (unclassified.length) {
      console.warn(
        '[tool] 这些工具没归到任何权限集合（默认走审批）：',
        unclassified
      );
    }
  } catch (err) {
    console.warn('[tool] 自检失败（不影响运行）：', err && err.message);
  }
}

// ---------------------------------------------------------------
// 未知工具时的近似名建议
// ---------------------------------------------------------------
// AI 偶尔会打错字（read_file → read_fil / readfile）。
// 给它一个编辑距离最近的候选，比让它瞎猜强。

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // 删除
        curr[j - 1] + 1,    // 插入
        prev[j - 1] + cost  // 替换
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function suggestToolName(name) {
  const lower = String(name).toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const candidate of Object.keys(registry)) {
    const d = editDistance(lower, candidate.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  if (best && bestDist <= Math.max(2, Math.floor(best.length / 3))) {
    return best;
  }
  return null;
}

// ---------------------------------------------------------------
// 执行辅助
// ---------------------------------------------------------------

function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} 执行超时（${ms}ms）`)),
      ms
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer)
  );
}

function stringifyResult(result) {
  if (typeof result === 'string') return result;
  if (result === undefined || result === null) return '';
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// 把参数压缩成审批弹窗能承受的形式。
function formatArgsForApproval(args) {
  let json;
  try {
    json = JSON.stringify(args, null, 2);
  } catch {
    json = String(args);
  }
  if (json.length <= MAX_APPROVAL_DETAIL_CHARS) return json;
  return (
    json.slice(0, MAX_APPROVAL_DETAIL_CHARS) +
    `\n\n...（参数共 ${json.length} 字符，已截断显示前 ${MAX_APPROVAL_DETAIL_CHARS}）`
  );
}

// 真正执行一个工具，包超时、包审计。
// 所有"工具函数被调用"的路径最终都走这里。
async function runTool(name, fn, args, context) {
  const start = Date.now();
  try {
    const result = await withTimeout(
      Promise.resolve().then(() => fn(args, context)),
      TOOL_TIMEOUT_MS,
      name
    );
    const text = stringifyResult(result);
    const ms = Date.now() - start;
    if (isDev) console.log(`[tool] ${name} ok ${ms}ms`);
    audit.record({
      name,
      args,
      ok: true,
      reason: 'ok',
      ms,
      truncatedResult: text,
    });
    return { ok: true, result: text, ms };
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err?.message || String(err);
    if (isDev) console.log(`[tool] ${name} fail ${ms}ms: ${msg}`);
    audit.record({
      name,
      args,
      ok: false,
      reason: 'error',
      ms,
      truncatedResult: msg,
    });
    return { ok: false, result: msg, reason: 'error', ms };
  }
}

// ---------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------

export async function executeTool(name, args, context) {
  const fn = registry[name];

  // ---- 未知工具 ----
  if (!fn) {
    const sug = suggestToolName(name);
    const msg = sug
      ? `未知工具：${name}。你是不是想用「${sug}」？`
      : `未知工具：${name}`;
    audit.record({
      name: String(name),
      args,
      ok: false,
      reason: 'unknown_tool',
      ms: 0,
      truncatedResult: msg,
    });
    return { ok: false, reason: 'unknown_tool', result: msg };
  }

  const mode = context?.config?.permissionMode || 'auto';
  const ws = context?.ws;
  const alwaysAllowed = context?.alwaysAllowed || new Set();

  // ---- ask 模式禁所有工具 ----
  if (mode === 'ask') {
    const msg = 'ask 模式已禁用所有工具，AI 只能对话';
    audit.record({
      name,
      args,
      ok: false,
      reason: 'mode_blocked',
      ms: 0,
      truncatedResult: msg,
    });
    return { ok: false, reason: 'mode_blocked', result: msg };
  }

  // ---- 限流 ----
  // 对会打外部服务的工具做软限流。
  // 命中时返回"稍等 X 秒"，不是抛错（抛错会被重试，更糟）。
  const rate = audit.checkRate(name);
  if (!rate.allowed) {
    const sec = Math.ceil(rate.retryAfterMs / 1000);
    const msg =
      `工具 ${name} 触发限流（${rate.windowMs / 1000} 秒内最多 ${rate.limit} 次）。` +
      `请等约 ${sec} 秒再试，或改用其它方式。`;
    audit.record({
      name,
      args,
      ok: false,
      reason: 'rate_limited',
      ms: 0,
      truncatedResult: msg,
    });
    return {
      ok: false,
      reason: 'rate_limited',
      result: msg,
      retryAfterMs: rate.retryAfterMs,
    };
  }

  // ---- 特殊工具：绕过通用审批 ----
  if (SPECIAL_TOOLS.has(name)) {
    return await runTool(name, fn, args, context);
  }

  // ---- agent 模式：全部放行 ----
  if (mode === 'agent') {
    return await runTool(name, fn, args, context);
  }

  // ---- 判断这个工具要不要审批 ----
  let needApproval = false;
  if (READONLY_TOOLS.has(name)) {
    needApproval = (mode === 'work');
  } else if (WRITE_TOOLS.has(name)) {
    needApproval = (mode === 'auto' || mode === 'work');
  } else {
    // 没归类的工具：保守起见一律审批
    needApproval = true;
  }

  if (!needApproval) {
    return await runTool(name, fn, args, context);
  }

  if (alwaysAllowed.has(name)) {
    return await runTool(name, fn, args, context);
  }

  // ---- 需要审批 ----
  if (!ws || ws.readyState !== ws.OPEN) {
    const msg = '无法发起审批：连接已断开';
    audit.record({
      name,
      args,
      ok: false,
      reason: 'no_connection',
      ms: 0,
      truncatedResult: msg,
    });
    return { ok: false, reason: 'no_connection', result: msg };
  }

  const requestId = makeRequestId();
  const detail =
    'AI 想要执行：' + name + '\n\n' +
    '参数：\n' + formatArgsForApproval(args);

  const { decision } = await requestApproval(ws, {
    requestId,
    kind: 'permission',
    title: '权限请求',
    detail,
    tool: name,
  });

  if (decision === 'deny') {
    const msg = '用户拒绝了此操作';
    audit.record({
      name,
      args,
      ok: false,
      reason: 'user_denied',
      ms: 0,
      truncatedResult: msg,
    });
    return { ok: false, reason: 'user_denied', result: msg };
  }

  if (decision === 'allow_always') {
    alwaysAllowed.add(name);
  }

  return await runTool(name, fn, args, context);
}

// ---------------------------------------------------------------
// 审计接口转发
// ---------------------------------------------------------------
// 上层（HTTP /stats、调试命令）可以直接从这里拿。
export const getToolStats = audit.getStats;
export const getRecentCalls = audit.getRecent;
export const resetAudit = audit.reset;
