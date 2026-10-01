// Helix 前端主逻辑：WebSocket 连接、消息渲染、设置、审批、预览

import { renderMarkdown } from './markdown.js';

const token = new URLSearchParams(location.search).get('token') || '';
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;

const SUGGESTIONS = [
  '帮我看看当前文件夹里有什么文件',
  '在预览面板画一个圆形，居中显示',
  '帮我写一个 Python 快速排序',
  '执行命令看一下 Node 版本',
  '搜索一下最新的 Node.js 版本',
];

const $ = (id) => document.getElementById(id);

const els = {
  status: $('status'),
  modelChip: $('model-chip'),
  permissionChip: $('permission-chip'),
  balanceChip: $('balance-chip'),
  previewToggle: $('preview-toggle'),
  settingsToggle: $('settings-toggle'),
  messages: $('messages'),
  composer: $('composer'),
  input: $('input'),
  sendBtn: $('send-btn'),
  abortBtn: $('abort-btn'),
  previewPane: $('preview-pane'),
  previewFrame: $('preview-frame'),
  previewClose: $('preview-close'),
  settingsDrawer: $('settings-drawer'),
  settingsClose: $('settings-close'),
  settingsSave: $('settings-save'),
  cfgApiKey: $('cfg-apiKey'),
  cfgBaseUrl: $('cfg-baseUrl'),
  cfgModel: $('cfg-model'),
  cfgWorkspace: $('cfg-workspace'),
  cfgPermissionMode: $('cfg-permissionMode'),
  cfgSystemPrompt: $('cfg-systemPrompt'),
  approvalModal: $('approval-modal'),
  approvalTitle: $('approval-title'),
  approvalDetail: $('approval-detail'),
  approvalAnswer: $('approval-answer'),
  approvalDeny: $('approval-deny'),
  approvalAllowOnce: $('approval-allow-once'),
  approvalAllowAlways: $('approval-allow-always'),
  approvalSubmit: $('approval-submit'),
};

let ws = null;
const messages = [];
let currentAssistantId = null;
let streaming = false;
let pendingApproval = null;

function genId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function setStatus(kind, text) {
  els.status.className = `status status-${kind}`;
  els.status.textContent = text;
}

// ───── 连接 ─────

function connect() {
  setStatus('connecting', '连接中…');
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setStatus('ready', '已连接');
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    setStatus('error', '已断开');
    setTimeout(connect, 2000);
  });

  ws.addEventListener('error', () => {
    setStatus('error', '连接出错');
  });
}

function sendToServer(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ───── 服务端消息处理 ─────

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ready':
      if (msg.model) els.modelChip.textContent = msg.model;
      break;
    case 'assistant_delta':
      appendAssistantDelta(msg.text);
      break;
    case 'reasoning_delta':
      appendReasoningDelta(msg.text);
      break;
    case 'tool_start':
      addToolToCurrent(msg.callId, msg.name, msg.args);
      break;
    case 'tool_end':
      updateToolInCurrent(msg.callId, msg.ok, msg.result);
      break;
    case 'approval_request':
      showApproval(msg);
      break;
    case 'preview':
      showPreview(msg.html);
      break;
    case 'balance':
      showBalance(msg);
      break;
    case 'done':
      endStreaming(msg.reason);
      break;
    case 'error':
      showError(msg.message);
      break;
  }
}

// ───── 空状态 ─────

function renderEmptyState() {
  els.messages.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'empty-state';

  const logo = document.createElement('div');
  logo.className = 'empty-logo';
  logo.textContent = '🧬';

  const title = document.createElement('h2');
  title.className = 'empty-title';
  title.textContent = '你好，我是 Helix';

  const sub = document.createElement('p');
  sub.className = 'empty-sub';
  sub.textContent = '本地优先的 AI Agent 工作台。试试问我：';

  const wrap = document.createElement('div');
  wrap.className = 'suggestions';
  for (const s of SUGGESTIONS) {
    const btn = document.createElement('button');
    btn.className = 'suggestion';
    btn.textContent = s;
    btn.addEventListener('click', () => {
      els.input.value = s;
      els.input.focus();
      autoResize();
    });
    wrap.appendChild(btn);
  }

  box.appendChild(logo);
  box.appendChild(title);
  box.appendChild(sub);
  box.appendChild(wrap);
  els.messages.appendChild(box);
}

function clearEmptyState() {
  const empty = els.messages.querySelector('.empty-state');
  if (empty) empty.remove();
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// ───── 消息元素 ─────

function createMessageElement(id, role) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  wrap.dataset.id = id;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '你' : '🧬';

  const body = document.createElement('div');
  body.className = 'message-body';

  const reasoning = document.createElement('div');
  reasoning.className = 'message-reasoning';
  reasoning.hidden = true;

  const text = document.createElement('div');
  text.className = 'message-text';

  body.appendChild(reasoning);
  body.appendChild(text);

  wrap.appendChild(avatar);
  wrap.appendChild(body);
  return wrap;
}

function addUserMessage(text) {
  const id = genId('msg');
  messages.push({ id, role: 'user', text, tools: [], streaming: false });

  const el = createMessageElement(id, 'user');
  el.querySelector('.message-text').textContent = text;

  els.messages.appendChild(el);
  scrollToBottom();
}

function startAssistantMessage() {
  const id = genId('msg');
  const msg = { id, role: 'assistant', text: '', reasoning: '', tools: [], streaming: true };
  messages.push(msg);
  currentAssistantId = id;

  const el = createMessageElement(id, 'assistant');
  els.messages.appendChild(el);
  scrollToBottom();
  return msg;
}

function getCurrentMessage() {
  return messages.find((m) => m.id === currentAssistantId) || null;
}

function getCurrentEl() {
  return els.messages.querySelector(`.message[data-id="${currentAssistantId}"]`);
}

function appendAssistantDelta(chunk) {
  let msg = getCurrentMessage();
  if (!msg) msg = startAssistantMessage();
  msg.text += chunk;
  const el = getCurrentEl();
  if (!el) return;
  el.querySelector('.message-text').innerHTML = renderMarkdown(msg.text);
  scrollToBottom();
}

function appendReasoningDelta(chunk) {
  let msg = getCurrentMessage();
  if (!msg) msg = startAssistantMessage();
  msg.reasoning = (msg.reasoning || '') + chunk;
  const el = getCurrentEl();
  if (!el) return;
  const reasoningEl = el.querySelector('.message-reasoning');
  reasoningEl.hidden = false;
  reasoningEl.textContent = msg.reasoning;
  scrollToBottom();
}

// ───── 工具卡片 ─────

function addToolToCurrent(callId, name, args) {
  let msg = getCurrentMessage();
  if (!msg) msg = startAssistantMessage();
  msg.tools.push({
    callId,
    name,
    args: typeof args === 'string' ? args : JSON.stringify(args, null, 2),
    status: 'running',
    result: '',
  });

  const el = getCurrentEl();
  if (!el) return;
  renderTools(el, msg.tools);
  scrollToBottom();
}

function updateToolInCurrent(callId, ok, result) {
  const msg = getCurrentMessage();
  if (!msg) return;
  const tool = msg.tools.find((t) => t.callId === callId);
  if (!tool) return;
  tool.status = ok ? 'ok' : 'fail';
  tool.result = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  const el = getCurrentEl();
  if (!el) return;
  renderTools(el, msg.tools);
}

function renderTools(messageEl, tools) {
  messageEl.querySelectorAll('.tool-card').forEach((n) => n.remove());

  const textEl = messageEl.querySelector('.message-text');
  const fragment = document.createDocumentFragment();

  for (const tool of tools) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.callId = tool.callId;

    const header = document.createElement('div');
    header.className = 'tool-card-header';

    const arrow = document.createElement('span');
    arrow.className = 'tool-card-arrow';
    arrow.textContent = '▶';

    const nameEl = document.createElement('span');
    nameEl.className = 'tool-card-name';
    nameEl.textContent = tool.name;

    const statusEl = document.createElement('span');
    statusEl.className = `tool-card-status ${tool.status}`;
    statusEl.textContent =
      tool.status === 'running' ? '运行中' :
      tool.status === 'ok' ? '完成' : '失败';

    header.appendChild(arrow);
    header.appendChild(nameEl);
    header.appendChild(statusEl);

    const body = document.createElement('div');
    body.className = 'tool-card-body';

    const argsLabel = document.createElement('div');
    argsLabel.className = 'tool-card-label';
    argsLabel.textContent = '参数';

    const argsPre = document.createElement('pre');
    argsPre.className = 'tool-card-pre';
    argsPre.textContent = tool.args || '{}';

    body.appendChild(argsLabel);
    body.appendChild(argsPre);

    if (tool.status !== 'running') {
      const resultLabel = document.createElement('div');
      resultLabel.className = 'tool-card-label';
      resultLabel.textContent = '结果';

      const resultPre = document.createElement('pre');
      resultPre.className = 'tool-card-pre';
      resultPre.textContent = tool.result || '（空）';

      body.appendChild(resultLabel);
      body.appendChild(resultPre);
    }

    header.addEventListener('click', () => card.classList.toggle('open'));

    card.appendChild(header);
    card.appendChild(body);
    fragment.appendChild(card);
  }

  messageEl.querySelector('.message-body').insertBefore(fragment, textEl);
}

// ───── 审批弹窗 ─────

function showApproval(msg) {
  pendingApproval = msg.requestId;

  if (msg.kind === 'question') {
    els.approvalTitle.textContent = msg.title || 'AI 想问你';
    els.approvalDetail.hidden = true;
    els.approvalAnswer.hidden = false;
    els.approvalAnswer.value = '';
    els.approvalDeny.hidden = true;
    els.approvalAllowOnce.hidden = true;
    els.approvalAllowAlways.hidden = true;
    els.approvalSubmit.hidden = false;
    setTimeout(() => els.approvalAnswer.focus(), 50);
  } else {
    els.approvalTitle.textContent = msg.title || '需要审批';
    els.approvalDetail.textContent = msg.detail || '';
    els.approvalDetail.hidden = false;
    els.approvalAnswer.hidden = true;
    els.approvalDeny.hidden = false;
    els.approvalAllowOnce.hidden = false;
    els.approvalAllowAlways.hidden = false;
    els.approvalSubmit.hidden = true;
  }

  els.approvalModal.hidden = false;
}

function closeApproval() {
  els.approvalModal.hidden = true;
  pendingApproval = null;
}

function respondApproval(decision, answer = '') {
  if (!pendingApproval) return;
  sendToServer({
    type: 'approval',
    requestId: pendingApproval,
    decision,
    answer,
  });
  closeApproval();
}

// ───── 预览 ─────

function showPreview(html) {
  els.previewFrame.srcdoc = html;
  els.previewPane.hidden = false;
}

// ───── 余额 ─────

function showBalance(msg) {
  if (!msg.supported) {
    els.balanceChip.hidden = true;
    return;
  }
  els.balanceChip.hidden = false;
  els.balanceChip.textContent = '—';
}

// ───── 错误 ─────

function showError(text) {
  const el = document.createElement('div');
  el.className = 'message assistant';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '!';

  const body = document.createElement('div');
  body.className = 'message-body';

  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.style.color = 'var(--error)';
  textEl.textContent = text;

  body.appendChild(textEl);
  el.appendChild(avatar);
  el.appendChild(body);
  els.messages.appendChild(el);
  scrollToBottom();
}

// ───── 发送与中断 ─────

function startStreaming() {
  streaming = true;
  els.sendBtn.disabled = true;
  els.abortBtn.hidden = false;
}

function endStreaming(reason) {
  streaming = false;
  els.sendBtn.disabled = false;
  els.abortBtn.hidden = true;
  const msg = getCurrentMessage();
  if (msg) msg.streaming = false;
  currentAssistantId = null;
  els.input.focus();
}

function sendMessage() {
  const text = els.input.value.trim();
  if (!text || streaming) return;

  clearEmptyState();
  addUserMessage(text);
  els.input.value = '';
  autoResize();
  startAssistantMessage();
  startStreaming();

  sendToServer({ type: 'user_message', text });
}

function abortStreaming() {
  if (streaming) {
    sendToServer({ type: 'abort' });
  }
}

// ───── 输入框自动高度 ─────

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
}

// ───── 设置抽屉 ─────

async function loadConfigToForm() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    els.cfgApiKey.value = '';
    els.cfgApiKey.placeholder = data.hasKey ? '已保存（留空则不修改）' : 'sk-...';
    els.cfgBaseUrl.value = data.baseUrl || '';
    els.cfgModel.value = data.model || '';
    els.cfgWorkspace.value = data.workspace || '';
    els.cfgPermissionMode.value = data.permissionMode || 'ask';
    els.cfgSystemPrompt.value = data.systemPrompt || '';
    if (data.model) els.modelChip.textContent = data.model;
    els.permissionChip.textContent = data.permissionMode || 'ask';
  } catch {
    // 忽略网络错误
  }
}

async function saveConfigFromForm() {
  const partial = {
    baseUrl: els.cfgBaseUrl.value.trim(),
    model: els.cfgModel.value.trim(),
    workspace: els.cfgWorkspace.value.trim(),
    permissionMode: els.cfgPermissionMode.value,
    systemPrompt: els.cfgSystemPrompt.value,
  };
  const key = els.cfgApiKey.value.trim();
  if (key) partial.apiKey = key;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    if (data.model) els.modelChip.textContent = data.model;
    els.permissionChip.textContent = data.permissionMode || 'ask';
    els.settingsDrawer.hidden = true;
  } catch (err) {
    alert('保存失败：' + err.message);
  }
}

// ───── 事件绑定 ─────

function bindEvents() {
  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  els.input.addEventListener('input', autoResize);
  els.abortBtn.addEventListener('click', abortStreaming);

  els.settingsToggle.addEventListener('click', async () => {
    await loadConfigToForm();
    els.settingsDrawer.hidden = false;
  });

  els.settingsClose.addEventListener('click', () => {
    els.settingsDrawer.hidden = true;
  });

  els.settingsSave.addEventListener('click', saveConfigFromForm);

  els.previewToggle.addEventListener('click', () => {
    els.previewPane.hidden = !els.previewPane.hidden;
  });

  els.previewClose.addEventListener('click', () => {
    els.previewPane.hidden = true;
  });

  els.approvalDeny.addEventListener('click', () => respondApproval('deny'));
  els.approvalAllowOnce.addEventListener('click', () => respondApproval('allow'));
  els.approvalAllowAlways.addEventListener('click', () => respondApproval('allow_always'));
  els.approvalSubmit.addEventListener('click', () => {
    respondApproval('allow', els.approvalAnswer.value);
  });
}

// ───── 启动 ─────

function boot() {
  renderEmptyState();
  bindEvents();
  connect();
}

boot();
