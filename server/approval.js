// server/approval.js —— 审批调度
//
// 做什么：AI 想执行危险操作时，这个文件负责"问用户"。
// 就像家长同意——孩子要做危险的事，先敲门问一声。
//
// 工作流程：
//   1. 后端调 requestApproval()，发一条审批请求给浏览器
//   2. 前端弹窗，用户点允许/拒绝/始终允许
//   3. 用户点击后，前端发 approval 消息回来
//   4. 后端 resolveApproval() 收到，把等待的 Promise 解开
//
// 关键：requestApproval 返回一个 Promise，await 它会"卡住"
// 直到用户回复或超时。这样后端代码写起来像同步的一样简单。

// 等待中的审批：requestId → { resolve, timer }
const pending = new Map();

// 超时时间：5 分钟。用户没反应就自动拒绝，免得永远卡住。
const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 发起一次审批，等用户回答。
 *
 * @param {WebSocket} ws     当前连接
 * @param {object} req       审批请求
 * @param {string} req.requestId   唯一 ID
 * @param {string} req.kind        'permission' 或 'question'
 * @param {string} req.title       标题
 * @param {string} req.detail      详细内容
 * @param {string} [req.tool]      触发审批的工具名
 * @returns {Promise<{decision, answer}>}
 */
export function requestApproval(ws, req) {
  return new Promise((resolve) => {
    // 1. 发消息给前端
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'approval_request',
        requestId: req.requestId,
        kind: req.kind,
        title: req.title,
        detail: req.detail,
        tool: req.tool || null,
      }));
    } else {
      // 连接断了，直接拒绝
      resolve({ decision: 'deny', answer: '' });
      return;
    }

    // 2. 设超时：5 分钟没反应，自动拒绝
    const timer = setTimeout(() => {
      pending.delete(req.requestId);
      resolve({ decision: 'deny', answer: '', timedOut: true });
    }, TIMEOUT_MS);

    // 3. 挂到 pending，等 resolveApproval 来解
    pending.set(req.requestId, { resolve, timer });
  });
}

/**
 * 用户回复了（前端发来 approval 消息时调用）。
 * @returns {boolean} 是否找到了对应的等待
 */
export function resolveApproval(requestId, decision, answer) {
  const entry = pending.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve({
    decision: decision || 'deny',
    answer: answer || '',
  });
  return true;
}

/**
 * 连接断开时，把所有等待中的审批全部拒绝。
 * 不然 Promise 会永远挂着，内存泄漏。
 */
export function cancelAll() {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.resolve({ decision: 'deny', answer: '', cancelled: true });
  }
  pending.clear();
}

// 生成短 ID，如 "req_a3f9b2c1"
export function makeRequestId() {
  return 'req_' + Math.random().toString(16).slice(2, 10);
}
