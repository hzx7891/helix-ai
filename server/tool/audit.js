// server/tool/audit.js —— 工具调用审计 + 限流
//
// 两个职责：
//   1. 审计：所有工具调用落一个环形缓冲，失败/拒绝/限流都记
//   2. 限流：对打外部服务的工具做软限流，防止 AI 疯狂请求
//
// 为什么内存里存而不是写文件？
//   第一版不上数据库，重启就清空。要持久化是 P1 的事。

// ---------------------------------------------------------------
// 审计缓冲
// ---------------------------------------------------------------

// 最多记多少条。超了丢最老的。
const MAX_RECORDS = 500;

// 单条记录里，结果最多存多少字符。太长的截断。
const MAX_RESULT_CHARS = 400;

const records = [];
let seq = 0;

/**
 * 记一条工具调用。
 *
 * @param {object} entry
 * @param {string} entry.name             工具名
 * @param {object} entry.args             参数（会被安全序列化）
 * @param {boolean} entry.ok              成功/失败
 * @param {string} entry.reason           ok / error / user_denied / unknown_tool /
 *                                        mode_blocked / rate_limited / no_connection
 * @param {number} entry.ms               耗时（毫秒）
 * @param {string} [entry.truncatedResult] 结果或错误信息（会被截断）
 */
export function record(entry) {
  const item = {
    id: ++seq,
    ts: Date.now(),
    name: String(entry.name || 'unknown'),
    ok: Boolean(entry.ok),
    reason: entry.reason || (entry.ok ? 'ok' : 'error'),
    ms: Number.isFinite(entry.ms) ? entry.ms : 0,
    args: safeArgs(entry.args),
    result: truncate(entry.truncatedResult, MAX_RESULT_CHARS),
  };

  records.push(item);
  if (records.length > MAX_RECORDS) {
    // 一次丢一批，避免每加一条都 shift
    records.splice(0, records.length - MAX_RECORDS);
  }
}

// 参数可能很大（比如 write_file 的 content），也可能有循环引用。
// 这里做两件事：安全序列化 + 截断。
function safeArgs(args) {
  if (args === undefined || args === null) return null;
  try {
    const json = JSON.stringify(args);
    if (json.length <= 300) {
      return JSON.parse(json);
    }
    return { _truncated: true, _preview: json.slice(0, 300) };
  } catch {
    return { _unserializable: String(args).slice(0, 300) };
  }
}

function truncate(s, limit) {
  if (s === undefined || s === null) return '';
  const str = String(s);
  if (str.length <= limit) return str;
  return str.slice(0, limit) + `\n…（共 ${str.length} 字符，已截断）`;
}

// ---------------------------------------------------------------
// 查询接口
// ---------------------------------------------------------------

/**
 * 拿最近的 N 条记录（默认 50）。
 * 倒序返回（最新在前）。
 */
export function getRecent(limit) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), MAX_RECORDS);
  return records.slice(-n).reverse();
}

/**
 * 统计信息：总数、按工具分、按结果分。
 */
export function getStats() {
  const byTool = {};
  const byReason = {};
  let okCount = 0;

  for (const r of records) {
    byTool[r.name] = (byTool[r.name] || 0) + 1;
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    if (r.ok) okCount++;
  }

  return {
    total: records.length,
    ok: okCount,
    fail: records.length - okCount,
    byTool,
    byReason,
    oldestTs: records.length ? records[0].ts : null,
    newestTs: records.length ? records[records.length - 1].ts : null,
  };
}

/**
 * 清空记录（调试用）。
 */
export function reset() {
  records.length = 0;
  seq = 0;
}

// ---------------------------------------------------------------
// 限流
// ---------------------------------------------------------------
// 简单滑窗：每个工具维护一个时间戳数组，超窗口的丢掉，数一数剩多少。
//
// 为什么只对某些工具限流？
//   list_dir 一秒跑 100 次也没关系（本地磁盘）。
//   web_search 一秒跑 100 次会被 Bing 封 IP，要限。
//   fetch_url 同理。
//   run_command 有可能真把系统跑死，也要限。

const RATE_LIMITS = {
  web_search: { windowMs: 30_000, limit: 10 }, // 30 秒最多 10 次
  fetch_url:  { windowMs: 30_000, limit: 20 }, // 30 秒最多 20 次
  run_command: { windowMs: 10_000, limit: 5 }, // 10 秒最多 5 次
};

// 每个工具的调用时间戳列表
const rateBuckets = new Map();

/**
 * 检查某个工具是否被限流。
 *
 * @param {string} name 工具名
 * @returns {{allowed: boolean, retryAfterMs?: number, limit?: number, windowMs?: number}}
 */
export function checkRate(name) {
  const cfg = RATE_LIMITS[name];
  if (!cfg) return { allowed: true };

  const now = Date.now();
  let bucket = rateBuckets.get(name);
  if (!bucket) {
    bucket = [];
    rateBuckets.set(name, bucket);
  }

  // 丢掉过期的
  const cutoff = now - cfg.windowMs;
  while (bucket.length && bucket[0] < cutoff) {
    bucket.shift();
  }

  if (bucket.length >= cfg.limit) {
    const oldest = bucket[0];
    const retryAfterMs = Math.max(0, oldest + cfg.windowMs - now);
    return {
      allowed: false,
      retryAfterMs,
      limit: cfg.limit,
      windowMs: cfg.windowMs,
    };
  }

  bucket.push(now);
  return { allowed: true };
}

/**
 * 清空限流计数器（调试用）。
 */
export function resetRate() {
  rateBuckets.clear();
}
