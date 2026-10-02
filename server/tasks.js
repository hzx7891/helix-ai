// server/tasks.js —— 流式任务的"服务端快照"
//
// 为什么需要？
//   用户在 AI 正在回答时刷新页面：
//     · 前端只存了半截内容（甚至只有用户那条消息）
//     · 后端还在继续跑，但推给旧连接（已断开）都失败了
//   所以后端要维护一份"任务快照"，前端刷新后能来查。
//
// 生命周期：
//   createTask   —— 收到 user_message 时创建
//   append*      —— 流式过程中不断更新
//   finishTask   —— 完成/出错/中止后标记
//   5 分钟后自动清理

const tasks = new Map();
const KEEP_MS = 5 * 60 * 1000;

export function createTask(id, ws) {
  const task = {
    id: id,
    createdAt: Date.now(),
    finishedAt: null,
    ws: ws,
    status: 'running',
    text: '',
    reasoning: '',
    tools: [],
    errorMessage: null,
    doneReason: null,
    abort: null,
    cleanupTimer: null,
  };
  tasks.set(id, task);
  return task;
}

export function getTask(id) {
  return tasks.get(id);
}

export function appendDelta(id, text) {
  const t = tasks.get(id);
  if (t) t.text += text;
}

export function appendReasoning(id, text) {
  const t = tasks.get(id);
  if (t) t.reasoning += text;
}

export function pushTool(id, tool) {
  const t = tasks.get(id);
  if (t) t.tools.push(tool);
}

export function updateTool(id, callId, patch) {
  const t = tasks.get(id);
  if (!t) return;
  const tool = t.tools.find(function (x) { return x.callId === callId; });
  if (tool) Object.assign(tool, patch);
}

export function finishTask(id, reason, errorMessage) {
  const t = tasks.get(id);
  if (!t) return;
  t.status = reason === 'complete' ? 'done'
           : reason === 'aborted'  ? 'aborted'
           : 'error';
  t.doneReason = reason;
  t.errorMessage = errorMessage || null;
  t.finishedAt = Date.now();
  t.abort = null;

  if (t.cleanupTimer) clearTimeout(t.cleanupTimer);
  t.cleanupTimer = setTimeout(function () {
    tasks.delete(id);
  }, KEEP_MS);
}

export function abortTask(id) {
  const t = tasks.get(id);
  if (t && t.abort) {
    try { t.abort.abort(); } catch (e) {}
  }
}

export function getSnapshot(id) {
  const t = tasks.get(id);
  if (!t) return null;
  return {
    id: t.id,
    status: t.status,
    text: t.text,
    reasoning: t.reasoning,
    tools: t.tools,
    doneReason: t.doneReason,
    errorMessage: t.errorMessage,
    createdAt: t.createdAt,
    finishedAt: t.finishedAt,
  };
}
