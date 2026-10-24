(function(){
  try{
    var t = localStorage.getItem('helix_theme_v2');
    if(!t){
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', t);
  }catch(e){}
})();

/* ============================================================
   Helix · 前端主逻辑 v0.5
   - 终端改为内嵌于 run_command 工具卡片
   - 四套拟真皮肤：win10 / win11 / macos / termux
   - ANSI + \r 覆盖式渲染
   ============================================================ */
(function(){
'use strict';

/* ------------------------------------------------------------
   0. 常量
   ------------------------------------------------------------ */
const KEY = {
  theme: 'helix_theme_v2',
  ui: 'helix_ui_v2',
  sessions: 'helix_sessions_v2',
  current: 'helix_current_v2',
  pending: 'helix_pending_msg',
};

const DEFAULT_PROMPT = `你是 Helix，一个运行在用户本机的本地 AI Agent，工作环境是一个终端。

你拥有读取文件、执行命令、搜索网络等工具能力。涉及写入、删除、执行等危险操作时，需要先向用户申请授权。

回答要求：
- 默认使用简体中文，除非用户主动使用其他语言。
- 简洁直接，先给结论再给细节。
- 代码块标注语言，命令块标注 shell。
- 不确定的地方明确说明，不要编造。`;

const PROMPT_PRESETS = {
  default: DEFAULT_PROMPT,
  concise: `你是 Helix，本地 AI Agent。回答尽量简短：能一行说清就不要写三行。省略客套话、重复用户的话、以及"希望这能帮到你"之类的结尾。代码优先于解释。默认中文。`,
  teacher: `你是 Helix，一位耐心的技术讲师。回答时：
1. 先用一句话给出核心结论；
2. 再展开原理，配合类比帮助理解；
3. 给出可运行的最小示例；
4. 最后指出常见的坑。
使用简体中文，语气平实，避免居高临下。`,
  reviewer: `你是 Helix，负责代码审查。审查时按以下维度逐条检查：正确性、边界条件、并发安全、性能、可读性、命名、错误处理、测试覆盖。
每条问题标注严重级别（阻塞 / 建议 / 吹毛求疵），并给出可直接采用的修改代码。默认中文。`,
  architect: `你是 Helix，一位系统架构师。回答时先澄清需求与约束，再给出 2-3 个候选方案并列表对比（复杂度、成本、可维护性、扩展性），然后推荐一个并说明理由与放弃其他方案的原因。默认中文。`,
};

const MODE_META = {
  ask:   { label: 'ask',   desc: '只聊天，禁用一切工具' },
  auto:  { label: 'auto',  desc: '只读放行，写/执行需确认' },
  work:  { label: 'work',  desc: '所有工具调用都需确认' },
  agent: { label: 'agent', desc: '完全自主，不弹窗' },
};

const SHORTCUTS = [
  ['打开命令面板', ['Ctrl', 'K']],
  ['切换侧边栏', ['Ctrl', 'B']],
  ['在当前对话中查找', ['Ctrl', 'F']],
  ['切换预览面板', ['Ctrl', '\\']],
  ['打开设置', ['Ctrl', ',']],
  ['新建对话', ['Ctrl', 'N']],
  ['切换深浅主题', ['Ctrl', 'J']],
  ['聚焦输入框', ['Ctrl', 'L']],
  ['清空当前对话', ['Ctrl', 'Shift', 'K']],
  ['关闭弹窗 / 面板', ['Esc']],
];

/* ------------------------------------------------------------
   工具图标映射表
   ------------------------------------------------------------ */
const TOOL_ICON_MAP = {
  web_search: 'i-globe', search: 'i-globe', browse: 'i-globe',
  google: 'i-globe', baidu: 'i-globe',
  fetch_url: 'i-link', curl: 'i-link', wget: 'i-link', http_request: 'i-link',
  run_command: 'i-terminal', shell: 'i-terminal', exec: 'i-terminal',
  terminal: 'i-terminal', bash: 'i-terminal', powershell: 'i-terminal',
  read_file: 'i-eye', cat: 'i-eye', view: 'i-eye', open_file: 'i-eye',
  list_dir: 'i-folder', ls: 'i-folder', dir: 'i-folder', find_files: 'i-folder',
  write_file: 'i-edit', edit_file: 'i-edit', create_file: 'i-edit', append_file: 'i-edit',
  spawn_agent: 'i-bot', think: 'i-chip', memory: 'i-book',
};

function getToolIcon(name){
  if (!name) return 'i-wrench';
  const l = String(name).toLowerCase();
  if (TOOL_ICON_MAP[l]) return TOOL_ICON_MAP[l];
  const keys = Object.keys(TOOL_ICON_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys){
    if (l.indexOf(key) !== -1) return TOOL_ICON_MAP[key];
  }
  return 'i-wrench';
}

/* ------------------------------------------------------------
   1. 工具函数
   ------------------------------------------------------------ */
const $ = id => document.getElementById(id);

function uid(prefix){
  return (prefix || 'id') + '_' +
    Math.random().toString(36).slice(2, 9) +
    Date.now().toString(36).slice(-5);
}

function uuid(){
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'){
      return crypto.randomUUID();
    }
  } catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(id, cls){
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '"><use href="#' + id + '"/></svg>';
}

function clockTime(ts){
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function relativeTime(ts){
  const diff = Date.now() - ts;
  if (diff < 45e3) return '刚刚';
  if (diff < 36e5) return Math.floor(diff / 6e4) + ' 分钟前';
  if (diff < 864e5) return Math.floor(diff / 36e5) + ' 小时前';
  if (diff < 7 * 864e5) return Math.floor(diff / 864e5) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function copyText(text){
  if (navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

function downloadFile(name, content, mime){
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function debounce(fn, wait){
  let t = null;
  return function(){
    const args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), wait);
  };
}

/* ------------------------------------------------------------
   2. Toast
   ------------------------------------------------------------ */
const TOAST_ICON = {
  success: 'i-check', error: 'i-alert', warn: 'i-alert', info: 'i-info',
};

function toast(message, type, duration){
  type = type || 'info';
  duration = duration || 2800;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = icon(TOAST_ICON[type] || 'i-info') +
                 '<span class="toast-msg">' + esc(message) + '</span>';
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* ------------------------------------------------------------
   3. 状态
   ------------------------------------------------------------ */
const state = {
  sessions: [],
  currentId: null,
  messages: [],

  streaming: false,
  assistantId: null,
  abortFlag: false,

  socket: null,
  connected: false,
  offline: false,
  reconnectAttempts: 0,
  reconnectTimer: null,

  config: {
    model: '',
    workspace: '',
    permissionMode: 'auto',
    baseUrl: '',
    systemPrompt: DEFAULT_PROMPT,
    temperature: 0.7,
    maxTokens: 4096,
    cmdTimeout: 30,
    useAiTitle: false,
    activeProfileId: '',
    profiles: [],
    terminalSkin: 'skin-macos',
  },

  ui: {
    autoScroll: true,
    animations: true,
    autoPreview: true,
    fontSize: 14,
    lang: 'zh-CN',
  },

  previewOpen: false,
  previewHtml: '',
  attachments: [],
  allowed: new Set(),
  find: { query: '', matches: [], index: -1 },
  cmdk: { items: [], index: 0 },
  nodes: new Map(),
};

let editingProfileId = null;

/* ------------------------------------------------------------
   4. 元素引用
   ------------------------------------------------------------ */
const el = {
  appBody: $('appBody'),
  main: $('main'),
  sidebar: $('sidebar'),
  btnSidebar: $('btnSidebar'),
  brandBtn: $('brandBtn'),

  connPill: $('connPill'),
  connLabel: $('connLabel'),

  chipModel: $('chipModel'),
  modelLabel: $('modelLabel'),
  chipMode: $('chipMode'),
  modeLabel: $('modeLabel'),
  chipBalance: $('chipBalance'),
  balanceLabel: $('balanceLabel'),

  btnFind: $('btnFind'),
  btnCmd: $('btnCmd'),
  btnPreview: $('btnPreview'),
  btnTheme: $('btnTheme'),
  btnSettings: $('btnSettings'),

  sessionList: $('sessionList'),
  sessionFilter: $('sessionFilter'),
  btnNew: $('btnNew'),
  btnExport: $('btnExport'),
  btnImport: $('btnImport'),
  btnWipe: $('btnWipe'),

  findBar: $('findBar'),
  findInput: $('findInput'),
  findCount: $('findCount'),
  findPrev: $('findPrev'),
  findNext: $('findNext'),
  findClose: $('findClose'),

  chatScroll: $('chatScroll'),
  stream: $('stream'),
  jumpBtn: $('jumpBtn'),
  jumpBadge: $('jumpBadge'),

  composerBox: $('composerBox'),
  attachRow: $('attachRow'),
  promptInput: $('promptInput'),
  btnAttach: $('btnAttach'),
  btnMic: $('btnMic'),
  btnSend: $('btnSend'),
  tokenCount: $('tokenCount'),

  previewPane: $('previewPane'),
  previewGrip: $('previewGrip'),
  previewFrame: $('previewFrame'),
  previewEmpty: $('previewEmpty'),
  prevReload: $('prevReload'),
  prevOpen: $('prevOpen'),
  prevClose: $('prevClose'),

  scrim: $('scrim'),
  drawer: $('drawer'),
  drawerClose: $('drawerClose'),
  drawerCancel: $('drawerCancel'),
  drawerSave: $('drawerSave'),

  approvalModal: $('approvalModal'),
  approvalIcon: $('approvalIcon'),
  approvalTitle: $('approvalTitle'),
  approvalSub: $('approvalSub'),
  approvalBody: $('approvalBody'),
  approvalFoot: $('approvalFoot'),

  cmdk: $('cmdk'),
  cmdkInput: $('cmdkInput'),
  cmdkList: $('cmdkList'),

  ctxMenu: $('ctxMenu'),
  fileInput: $('fileInput'),
  importInput: $('importInput'),
  allowList: $('allowList'),
  kbdList: $('kbdList'),
};

/* ------------------------------------------------------------
   5. 主题
   ------------------------------------------------------------ */
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(KEY.theme, theme); } catch(e){}
  el.btnTheme.innerHTML = icon(theme === 'dark' ? 'i-moon' : 'i-sun');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d1117' : '#ffffff');
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ------------------------------------------------------------
   6. Markdown 渲染器
   ------------------------------------------------------------ */
const KEYWORDS = (
  'function,const,let,var,return,if,else,for,while,do,switch,case,break,continue,' +
  'class,extends,new,this,super,import,export,from,default,async,await,try,catch,' +
  'finally,throw,typeof,instanceof,in,of,delete,void,yield,static,get,set,' +
  'public,private,protected,readonly,interface,type,enum,implements,namespace,declare,' +
  'def,elif,lambda,None,True,False,self,print,import,from,as,with,raise,pass,global,nonlocal,' +
  'func,struct,impl,fn,pub,use,mod,match,where,let,mut,ref,' +
  'package,void,int,float,double,char,bool,String,Integer,' +
  'and,or,not,is,be,sealed,abstract,virtual,override,params'
).split(',').join('|');

function highlight(raw){
  const stash = [];
  const hold = html => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };

  let s = raw;

  s = s.replace(
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    m => hold('<span class="tok-str">' + esc(m) + '</span>')
  );
  s = s.replace(
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)/g,
    m => hold('<span class="tok-com">' + esc(m) + '</span>')
  );
  s = s.replace(
    /\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    m => hold('<span class="tok-num">' + m + '</span>')
  );
  s = s.replace(
    new RegExp('\\b(' + KEYWORDS + ')\\b', 'g'),
    m => hold('<span class="tok-key">' + m + '</span>')
  );
  s = s.replace(
    /\b([A-Za-z_$][\w$]*)(?=\s*\()/g,
    m => hold('<span class="tok-fn">' + m + '</span>')
  );

  s = esc(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
}

function codeBlock(lang, code){
  const l = (lang || 'text').toLowerCase();
  const body = highlight(code.replace(/\n$/, ''));
  return '<div class="code-block">' +
    '<div class="code-head">' +
      '<span class="code-lang">' + esc(l) + '</span>' +
      '<div class="code-actions">' +
        '<button class="code-btn" data-copy>' + icon('i-copy', 'icon-sm') + '复制</button>' +
      '</div>' +
    '</div>' +
    '<pre><code>' + body + '</code></pre>' +
  '</div>';
}

function inline(text){
  let s = esc(text);
  s = s.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return s;
}

function renderMarkdown(src){
  if (!src) return '';
  const parts = [];
  const fence = /```([a-zA-Z0-9_+-]*)[^\n]*\n?([\s\S]*?)```/g;
  let last = 0, m;

  while ((m = fence.exec(src)) !== null){
    if (m.index > last) parts.push({ t: 'md', v: src.slice(last, m.index) });
    parts.push({ t: 'code', lang: m[1], v: m[2] });
    last = fence.lastIndex;
  }
  if (last < src.length) parts.push({ t: 'md', v: src.slice(last) });

  return parts.map(p => {
    if (p.t === 'code') return codeBlock(p.lang, p.v);
    return mdToHtml(p.v);
  }).join('');
}

function mdToHtml(src){
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length){
    const line = lines[i];

    if (!line.trim()){ i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h){
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inline(h[2].trim()) + '</h' + lv + '>');
      i++;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*>/.test(line)){
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])){
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>');
      continue;
    }

    if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])){
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()){
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = '<table><thead><tr>';
      head.forEach(c => { t += '<th>' + inline(c) + '</th>'; });
      t += '</tr></thead><tbody>';
      rows.forEach(r => {
        t += '<tr>';
        for (let k = 0; k < head.length; k++){
          t += '<td>' + inline(r[k] == null ? '' : r[k]) + '</td>';
        }
        t += '</tr>';
      });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)){
      const res = parseList(lines, i);
      out.push(res.html);
      i = res.next;
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() &&
           !/^(#{1,6})\s/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) &&
           !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) &&
           !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])){
      buf.push(lines[i]);
      i++;
    }
    if (buf.length){
      out.push('<p>' + inline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>');
    } else {
      i++;
    }
  }

  return out.join('');
}

function splitRow(line){
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
}

function parseList(lines, start){
  const items = [];
  let i = start;
  const ordered = /^\s*\d+\.\s+/.test(lines[i]);
  const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;

  while (i < lines.length && re.test(lines[i])){
    let content = re.exec(lines[i])[1];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !re.test(lines[i]) &&
           !/^(#{1,6})\s/.test(lines[i]) &&
           !/^\s*>/.test(lines[i])){
      content += '\n' + lines[i].trim();
      i++;
    }
    items.push(content);
  }

  const tag = ordered ? 'ol' : 'ul';
  let html = '<' + tag + '>';
  items.forEach(raw => {
    const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(raw);
    if (task){
      const on = task[1].toLowerCase() === 'x';
      html += '<li class="md-task"><span class="box' + (on ? ' on' : '') + '"></span>' +
              '<span>' + inline(task[2]) + '</span></li>';
    } else {
      html += '<li>' + inline(raw) + '</li>';
    }
  });
  html += '</' + tag + '>';

  return { html: html, next: i };
}

/* ------------------------------------------------------------
   7. 会话持久化
   ------------------------------------------------------------ */
function loadStore(){
  try {
    state.sessions = JSON.parse(localStorage.getItem(KEY.sessions) || '[]');
  } catch(e){ state.sessions = []; }

  try {
    const ui = JSON.parse(localStorage.getItem(KEY.ui) || '{}');
    Object.assign(state.ui, ui);
  } catch(e){}

  state.currentId = (function(){
    try { return localStorage.getItem(KEY.current); } catch(e){ return null; }
  })();

  if (!Array.isArray(state.sessions)) state.sessions = [];

  if (!state.currentId || !state.sessions.some(s => s.id === state.currentId)){
    state.currentId = state.sessions[0] ? state.sessions[0].id : null;
  }
}

function saveStore(){
  try {
    localStorage.setItem(KEY.sessions, JSON.stringify(state.sessions.slice(0, 80)));
    localStorage.setItem(KEY.current, state.currentId || '');
  } catch(e){
    try {
      state.sessions = state.sessions.slice(0, 20);
      localStorage.setItem(KEY.sessions, JSON.stringify(state.sessions));
    } catch(e2){}
  }
}

function ensureCurrentSession(){
  if (state.currentId){
    const exists = state.sessions.some(x => x.id === state.currentId);
    if (exists) return state.currentId;
  }
  const s = {
    id: uuid(),
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.sessions.unshift(s);
  state.currentId = s.id;
  saveStore();
  renderSessionList();
  return s.id;
}

function persistSession(){
  if (!state.messages.length) return;

  let s = state.sessions.find(x => x.id === state.currentId);
  if (!s){
    s = {
      id: state.currentId || uuid(),
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    state.sessions.unshift(s);
    state.currentId = s.id;
  }

  s.messages = state.messages.map(m => ({
    id: m.id,
    role: m.role,
    text: m.text,
    reasoning: m.reasoning,
    tools: m.tools,
    ts: m.ts,
    clientMsgId: m.clientMsgId,
  }));
  s.updatedAt = Date.now();

  if (!s.aiTitleGenerated){
    const firstUser = state.messages.find(m => m.role === 'user');
    if (firstUser) s.title = firstUser.text.replace(/\s+/g, ' ').trim().slice(0, 40) || '新对话';
  }

  saveStore();
  renderSessionList();
}

/* ------------------------------------------------------------
   8. 会话列表渲染
   ------------------------------------------------------------ */
function renderSessionList(){
  const q = el.sessionFilter.value.trim().toLowerCase();
  const list = state.sessions
    .filter(s => !q || (s.title || '').toLowerCase().indexOf(q) !== -1)
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!list.length){
    el.sessionList.innerHTML =
      '<div class="side-empty">' +
        icon('i-message') +
        '<div>' + (q ? '没有匹配的对话' : '还没有对话<br>点击上方「新建对话」开始') + '</div>' +
      '</div>';
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 864e5;
  const weekStart = todayStart - 6 * 864e5;

  const groups = { 今天: [], 昨天: [], 最近七天: [], 更早: [] };
  list.forEach(s => {
    const t = s.updatedAt || 0;
    if (t >= todayStart) groups['今天'].push(s);
    else if (t >= yesterdayStart) groups['昨天'].push(s);
    else if (t >= weekStart) groups['最近七天'].push(s);
    else groups['更早'].push(s);
  });

  let html = '';
  Object.keys(groups).forEach(name => {
    const arr = groups[name];
    if (!arr.length) return;
    html += '<div class="side-group">' + icon('i-chev-down', 'icon-sm') + name + '</div>';
    arr.forEach(s => {
      const active = s.id === state.currentId ? ' active' : '';
      html +=
        '<div class="session-item' + active + '" data-id="' + esc(s.id) + '">' +
          icon('i-message') +
          '<span class="session-title">' + esc(s.title || '新对话') + '</span>' +
          '<span class="session-time">' + esc(relativeTime(s.updatedAt || Date.now())) + '</span>' +
          '<button class="session-del" data-del="' + esc(s.id) + '" aria-label="删除会话">' +
            icon('i-x', 'icon-sm') +
          '</button>' +
        '</div>';
    });
  });

  el.sessionList.innerHTML = html;

  el.sessionList.querySelectorAll('.session-item').forEach(node => {
    node.addEventListener('click', e => {
      if (e.target.closest('[data-del]')) return;
      switchSession(node.dataset.id);
    });
  });
  el.sessionList.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteSession(btn.dataset.del);
    });
  });
}

function updateSessionTitle(id, newTitle){
  if (!id || !newTitle) return;
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;

  s.title = String(newTitle).trim() || s.title;
  s.updatedAt = Date.now();
  s.aiTitleGenerated = true;

  saveStore();
  renderSessionList();
}

function switchSession(id){
  if (id === state.currentId) return;
  persistSession();
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;

  state.currentId = id;
  state.messages = (s.messages || []).map(m => ({
    id: m.id || uid('m'),
    role: m.role,
    text: m.text || '',
    reasoning: m.reasoning || '',
    tools: m.tools || [],
    ts: m.ts || Date.now(),
    streaming: false,
    clientMsgId: m.clientMsgId,
  }));

  state.nodes.clear();
  state.assistantId = null;
  state.streaming = false;
  state.abortFlag = false;
  updateSendButton();

  el.stream.innerHTML = '';
  renderMessages();
  renderSessionList();
  saveStore();
  scrollToBottom(true);
}

function newSession(silent){
  persistSession();

  const s = {
    id: uuid(),
    title: '新对话',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.sessions.unshift(s);
  state.currentId = s.id;
  state.messages = [];
  state.nodes.clear();
  state.assistantId = null;
  state.streaming = false;
  state.abortFlag = false;
  state.attachments = [];
  renderAttachments();
  updateSendButton();

  el.stream.innerHTML = '';
  renderEmptyState();
  renderSessionList();
  saveStore();
  el.promptInput.focus();

  if (!silent) toast('已创建新对话', 'success', 1600);
  if (window.innerWidth <= 900) closeSidebar();
}

function deleteSession(id){
  const idx = state.sessions.findIndex(x => x.id === id);
  if (idx === -1) return;
  state.sessions.splice(idx, 1);

  if (state.currentId === id){
    state.currentId = state.sessions[0] ? state.sessions[0].id : null;
    if (state.currentId) switchSession(state.currentId);
    else {
      state.messages = [];
      state.nodes.clear();
      el.stream.innerHTML = '';
      renderEmptyState();
    }
  }
  saveStore();
  renderSessionList();
  toast('已删除会话', 'info', 1600);
}

/* ------------------------------------------------------------
   9. 消息渲染
   ------------------------------------------------------------ */
function renderMessages(){
  if (!state.messages.length){
    renderEmptyState();
    return;
  }
  el.stream.innerHTML = '';
  state.messages.forEach(m => appendMessageNode(m));
}

function appendMessageNode(msg){
  const node = document.createElement('article');
  node.className = 'msg msg--' + msg.role;
  node.dataset.id = msg.id;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.innerHTML = msg.role === 'user' ? icon('i-user') : icon('i-sparkle');

  const main = document.createElement('div');
  main.className = 'msg-main';

  const head = document.createElement('div');
  head.className = 'msg-head';
  head.innerHTML =
    '<span class="msg-author">' + (msg.role === 'user' ? '你' : 'Helix') + '</span>' +
    (msg.role === 'assistant' ? '<span class="msg-badge">agent</span>' : '') +
    '<time class="msg-time">' + esc(clockTime(msg.ts || Date.now())) + '</time>';

  const body = document.createElement('div');
  body.className = 'msg-body';

  main.appendChild(head);
  main.appendChild(body);
  node.appendChild(avatar);
  node.appendChild(main);

  el.stream.appendChild(node);
  state.nodes.set(msg.id, node);

  paintMessage(msg);
  return node;
}

function paintMessage(msg){
  const node = state.nodes.get(msg.id);
  if (!node) return;
  const body = node.querySelector('.msg-body');

  const openTools = new Set();
  const openTasks = new Set();
  const openReasoning = new Set();

  body.querySelectorAll('.tool-card').forEach(c => {
    if (c.dataset.call && !c.classList.contains('collapsed')){
      openTools.add(c.dataset.call);
    }
  });
  body.querySelectorAll('.task-block').forEach(c => {
    if (c.dataset.call && !c.classList.contains('collapsed')){
      openTasks.add(c.dataset.call);
    }
  });
  body.querySelectorAll('.reasoning').forEach((r, i) => {
    if (!r.classList.contains('collapsed')){
      openReasoning.add(i);
    }
  });

  let html = '';

  if (msg.reasoning && msg.reasoning.trim()){
    html +=
      '<div class="reasoning' + (msg.streaming ? '' : ' collapsed') + '">' +
        '<div class="reasoning-head">' +
          icon('i-chip') +
          '<span>思考过程</span>' +
          icon('i-chev-down', 'caret') +
        '</div>' +
        '<div class="reasoning-body">' + esc(msg.reasoning) + '</div>' +
      '</div>';
  }

  if (msg.tools && msg.tools.length){
    var lastTaskIdx = -1;
    for (var ti = 0; ti < msg.tools.length; ti++){
      if (msg.tools[ti] && msg.tools[ti].name === 'update_tasks'){
        lastTaskIdx = ti;
      }
    }
    for (var tj = 0; tj < msg.tools.length; tj++){
      var toolItem = msg.tools[tj];
      if (!toolItem) continue;
      if (toolItem.name === 'update_tasks'){
        if (tj === lastTaskIdx){
          html += renderTaskBlock(toolItem);
        }
      } else {
        html += renderToolCard(toolItem);
      }
    }
  }

  if (msg.text && msg.text.length){
    if (msg.role === 'user'){
      const parsed = extractUserMessageParts(msg.text);
      if (parsed.body){
        html += '<div class="md">' + renderMarkdown(parsed.body) + '</div>';
      }
      if (parsed.files.length){
        html += renderAttachCards(parsed.files);
      }
    } else {
      html += '<div class="md">' + renderMarkdown(msg.text) + '</div>';
    }
    if (msg.streaming) html += '<span class="caret"></span>';
  } else if (msg.streaming){
    if ((!msg.tools || !msg.tools.length) && !msg.reasoning){
      html += '<div class="typing"><i></i><i></i><i></i></div>';
    } else {
      html += '<span class="caret"></span>';
    }
  }

  if (!msg.streaming){
    html += '<div class="msg-tools">';
    if (msg.role === 'assistant'){
      html +=
        '<button class="tool-btn" data-act="copy" data-id="' + msg.id + '">' +
          icon('i-copy', 'icon-sm') + '复制</button>' +
        '<button class="tool-btn" data-act="speak" data-id="' + msg.id + '">' +
          icon('i-volume', 'icon-sm') + '朗读</button>' +
        '<button class="tool-btn" data-act="regen" data-id="' + msg.id + '">' +
          icon('i-refresh', 'icon-sm') + '重新生成</button>' +
        '<button class="tool-btn danger" data-act="del" data-id="' + msg.id + '">' +
          icon('i-trash', 'icon-sm') + '删除</button>';
    } else {
      html +=
        '<button class="tool-btn" data-act="copy" data-id="' + msg.id + '">' +
          icon('i-copy', 'icon-sm') + '复制</button>' +
        '<button class="tool-btn" data-act="edit" data-id="' + msg.id + '">' +
          icon('i-edit', 'icon-sm') + '编辑</button>' +
        '<button class="tool-btn" data-act="retry" data-id="' + msg.id + '">' +
          icon('i-refresh', 'icon-sm') + '重发</button>' +
        '<button class="tool-btn danger" data-act="del" data-id="' + msg.id + '">' +
          icon('i-trash', 'icon-sm') + '删除</button>';
    }
    html += '</div>';
  }

  body.innerHTML = html;

  if (openTools.size){
    body.querySelectorAll('.tool-card').forEach(c => {
      if (c.dataset.call && openTools.has(c.dataset.call)){
        c.classList.remove('collapsed');
      }
    });
  }
  if (openTasks.size){
    body.querySelectorAll('.task-block').forEach(c => {
      if (c.dataset.call && openTasks.has(c.dataset.call)){
        c.classList.remove('collapsed');
      }
    });
  }
  if (openReasoning.size){
    body.querySelectorAll('.reasoning').forEach((r, i) => {
      if (openReasoning.has(i)){
        r.classList.remove('collapsed');
      }
    });
  }

  bindMessageActions(node);
  bindCodeCopy(node);
  bindToolToggle(node);
  bindTaskToggle(node);
  bindReasoningToggle(node);
  bindMsgFileToggles(node);
  bindInlineTermToggles(node);
}

/* ==== 用户消息文件卡片（保持原样） ==== */
(function injectMsgFileStyle(){
  if (document.getElementById("helix-msg-files-style")) return;
  const s = document.createElement("style");
  s.id = "helix-msg-files-style";
  s.textContent = [
    ".msg-files{display:flex;flex-direction:column;gap:6px;margin-top:8px}",
    ".msg-file{border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--canvas-default);overflow:hidden;transition:border-color .15s}",
    ".msg-file:hover{border-color:var(--border-strong)}",
    ".msg-file-head{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;user-select:none;font-size:12.5px;transition:background .12s}",
    ".msg-file.no-body .msg-file-head{cursor:default}",
    ".msg-file.no-body .msg-file-head:hover{background:transparent}",
    ".msg-file-head:hover{background:var(--canvas-subtle)}",
    ".msg-file-head .icon{color:var(--fg-muted);flex-shrink:0}",
    ".msg-file-name{font-family:var(--font-mono);font-size:12px;color:var(--fg-default);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}",
    ".msg-file-size{font-family:var(--font-mono);font-size:11px;color:var(--fg-subtle);flex-shrink:0}",
    ".msg-file-caret{transition:transform .15s;color:var(--fg-subtle)}",
    ".msg-file.open .msg-file-caret{transform:rotate(90deg)}",
    ".msg-file-body{margin:0;padding:10px 12px;border-top:1px solid var(--border-muted);background:var(--canvas-inset);font-family:var(--font-mono);font-size:12px;line-height:1.6;color:var(--fg-muted);white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}",
    ".msg-file-body[hidden]{display:none}"
  ].join("\n");
  document.head.appendChild(s);
})();

function extractUserMessageParts(text){
  const files = [];
  let body = String(text || "");

  body = body.replace(
    /=== 文件 ([^\n]+?) ===\n([\s\S]*?)\n=== 文件结束 ===/g,
    function(_, name, content){
      files.push({ name: name.trim(), size: null, content: content });
      return "";
    }
  );

  body = body.replace(
    /\[附件\] ([^\n]+?)\s*\(([^)]+)\)/g,
    function(_, name, size){
      files.push({ name: name.trim(), size: size.trim(), content: null });
      return "";
    }
  );

  body = body.replace(/\n{3,}/g, "\n\n").trim();

  return { body: body, files: files };
}

function renderAttachCards(files){
  if (!files || !files.length) return "";
  const cards = files.map(function(f){
    const hasContent = !!(f.content && f.content.length);
    const LIMIT = 500;
    const shown = hasContent
      ? (f.content.length > LIMIT
          ? f.content.slice(0, LIMIT) + "\n...（已省略 " + (f.content.length - LIMIT) + " 字符）"
          : f.content)
      : "";
    const sizeText = f.size || (hasContent
      ? (f.content.length > 1024
          ? (f.content.length / 1024).toFixed(1) + " KB"
          : f.content.length + " B")
      : "");

    return "<div class=\"msg-file" + (hasContent ? "" : " no-body") + "\">" +
      "<div class=\"msg-file-head\">" +
        icon("i-file", "icon-sm") +
        "<span class=\"msg-file-name\">" + esc(f.name) + "</span>" +
        (sizeText ? "<span class=\"msg-file-size\">" + esc(sizeText) + "</span>" : "") +
        (hasContent ? icon("i-chev-right", "icon-sm msg-file-caret") : "") +
      "</div>" +
      (hasContent ? "<pre class=\"msg-file-body\" hidden>" + esc(shown) + "</pre>" : "") +
    "</div>";
  }).join("");
  return "<div class=\"msg-files\">" + cards + "</div>";
}

function bindMsgFileToggles(root){
  root.querySelectorAll(".msg-file-head").forEach(function(head){
    if (head.dataset.bound) return;
    head.dataset.bound = "1";
    head.addEventListener("click", function(){
      const card = head.closest(".msg-file");
      if (!card || card.classList.contains("no-body")) return;
      card.classList.toggle("open");
      const body = card.querySelector(".msg-file-body");
      if (body) body.hidden = !card.classList.contains("open");
    });
  });
}

/* ==== 任务清单块（保持原样） ==== */
(function injectTaskBlockStyle(){
  if (document.getElementById("helix-task-block-style")) return;
  var s = document.createElement("style");
  s.id = "helix-task-block-style";
  s.textContent = [
    ".task-block{margin:10px 0;border:1px solid var(--border-default);border-radius:var(--radius-md);background:var(--canvas-default);overflow:hidden;box-shadow:var(--shadow-xs);transition:border-color .15s}",
    ".task-block:hover{border-color:var(--border-default)}",
    ".task-head{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;font-size:12.5px;background:var(--canvas-subtle);border-bottom:1px solid var(--border-muted);transition:background .12s}",
    ".task-head:hover{background:var(--canvas-default)}",
    ".task-head .icon{width:13px;height:13px;color:var(--fg-muted);flex-shrink:0}",
    ".task-title{font-weight:600;color:var(--fg-default);font-size:12.5px;white-space:nowrap}",
    ".task-count{font-family:var(--font-mono);font-size:11px;color:var(--fg-subtle);white-space:nowrap}",
    ".task-caret{margin-left:auto;transition:transform .15s;color:var(--fg-subtle)}",
    ".task-block.collapsed .task-caret{transform:rotate(-90deg)}",
    ".task-block.collapsed .task-body{display:none}",
    ".task-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;border:1px solid var(--border-default);font-family:var(--font-mono);font-size:11px;color:var(--fg-muted);flex-shrink:0;white-space:nowrap}",
    ".task-badge.running{color:var(--accent-fg);border-color:var(--accent-emphasis)}",
    ".task-badge.ok{color:var(--success-fg);border-color:var(--success-fg)}",
    ".task-badge.fail{color:var(--danger-fg);border-color:var(--danger-fg)}",
    ".task-body{display:flex;flex-direction:column;gap:4px;padding:9px 13px 11px}",
    ".task-row{display:flex;align-items:flex-start;gap:8px;padding:2px 0;font-size:12.6px;line-height:1.6}",
    ".task-sym{font-family:var(--font-mono);font-size:12px;font-weight:600;flex-shrink:0;min-width:28px}",
    ".task-text{flex:1;min-width:0;word-break:break-word;color:var(--fg-default)}",
    ".task-row.task-todo .task-sym{color:var(--fg-subtle)}",
    ".task-row.task-todo .task-text{color:var(--fg-muted)}",
    ".task-row.task-doing .task-sym{color:var(--accent-fg)}",
    ".task-row.task-doing .task-text{color:var(--fg-default)}",
    ".task-row.task-done .task-sym{color:var(--success-fg)}",
    ".task-row.task-done .task-text{color:var(--fg-muted);text-decoration:line-through}",
    ".task-row.task-failed .task-sym{color:var(--danger-fg)}",
    ".task-row.task-failed .task-text{color:var(--danger-fg)}",
    ".task-row.task-cancelled .task-sym{color:var(--fg-subtle)}",
    ".task-row.task-cancelled .task-text{color:var(--fg-subtle);text-decoration:line-through}",
    ".task-row.task-waiting .task-sym{color:var(--done-fg)}",
    ".task-row.task-waiting .task-text{color:var(--fg-muted)}",
    ".task-row.task-warning .task-sym{color:var(--attention-fg)}",
    ".task-row.task-warning .task-text{color:var(--attention-fg)}"
  ].join("");
  document.head.appendChild(s);
})();

var TASK_STATUS_META = {
  todo:      { sym: '[ ]', cls: 'todo' },
  doing:     { sym: '[.]', cls: 'doing' },
  done:      { sym: '[\u221a]', cls: 'done' },
  failed:    { sym: '[X]', cls: 'failed' },
  cancelled: { sym: '[-]', cls: 'cancelled' },
  waiting:   { sym: '[?]', cls: 'waiting' },
  warning:   { sym: '[!]', cls: 'warning' }
};

function parseTaskArgs(args){
  var obj = args;
  if (typeof obj === 'string'){
    try { obj = JSON.parse(obj); } catch(e){ return []; }
  }
  if (!obj || typeof obj !== 'object') return [];

  var list = obj.tasks;
  if (!Array.isArray(list)) return [];

  var out = [];
  for (var i = 0; i < list.length; i++){
    var item = list[i];
    if (!item || typeof item !== 'object') continue;
    var text = item.text == null ? '' : String(item.text);
    var status = item.status == null ? 'todo' : String(item.status);
    if (!TASK_STATUS_META[status]) status = 'todo';
    out.push({ text: text, status: status });
  }
  return out;
}

function renderTaskBlock(tool){
  var tasks = parseTaskArgs(tool.args);
  var total = tasks.length;
  var doneCount = 0;
  for (var i = 0; i < total; i++){
    if (tasks[i].status === 'done') doneCount++;
  }

  var running = tool.status === 'running';
  var badge;
  if (running){
    badge = '<span class="task-badge running"><span class="spinner"></span>进行中</span>';
  } else if (tool.status === 'fail'){
    badge = '<span class="task-badge fail">' + doneCount + '/' + total + '</span>';
  } else {
    badge = '<span class="task-badge ok">' + doneCount + '/' + total + '</span>';
  }

  var rows = '';
  for (var j = 0; j < total; j++){
    var task = tasks[j];
    var meta = TASK_STATUS_META[task.status] || TASK_STATUS_META.todo;
    rows +=
      '<div class="task-row task-' + meta.cls + '">' +
        '<span class="task-sym">' + esc(meta.sym) + '</span>' +
        '<span class="task-text">' + esc(task.text) + '</span>' +
      '</div>';
  }
  if (!rows){
    rows = '<div class="task-row task-todo">' +
             '<span class="task-sym">[ ]</span>' +
             '<span class="task-text">（暂无任务）</span>' +
           '</div>';
  }

  return '<div class="task-block" data-call="' + esc(tool.callId || '') + '">' +
    '<div class="task-head">' +
      icon('i-check') +
      '<span class="task-title">任务清单</span>' +
      '<span class="task-count">' + total + ' 项</span>' +
      icon('i-chev-down', 'task-caret') +
      badge +
    '</div>' +
    '<div class="task-body">' + rows + '</div>' +
  '</div>';
}

function bindTaskToggle(root){
  var heads = root.querySelectorAll('.task-head');
  for (var i = 0; i < heads.length; i++){
    (function(head){
      if (head.dataset.bound) return;
      head.dataset.bound = '1';
      head.addEventListener('click', function(){
        var block = head.closest('.task-block');
        if (block) block.classList.toggle('collapsed');
      });
    })(heads[i]);
  }
}

/* ------------------------------------------------------------
   9.5 内嵌终端：渲染与样式
   ------------------------------------------------------------ */
function injectInlineTermStyle(){
  if (document.getElementById('helix-inline-term-style')) return;

  var css = [
    /* wrapper */
    '.inline-terminal-wrapper{display:none;flex-direction:column;margin:10px 0 0;overflow:hidden;font-variant-ligatures:none;',
    'transition:border-color .15s ease,box-shadow .15s ease}',
    '.inline-terminal-wrapper.show{display:flex !important}',
    '.tool-card.collapsed .inline-terminal-wrapper.show{display:flex !important}',

    /* header 通用 */
    '.inline-terminal-wrapper .term-header{display:flex;align-items:center;flex-shrink:0;user-select:none;position:relative;',
    'font-size:11.5px;line-height:1;letter-spacing:.01em}',
    '.inline-terminal-wrapper .term-header .term-title{flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.72}',

    /* body */
    '.inline-terminal-wrapper .term-body{flex:1;min-height:80px;max-height:320px;overflow-y:auto;overflow-x:hidden;',
    'padding:10px 12px 12px;white-space:pre-wrap;word-break:break-all;tab-size:4;font-size:12.5px;line-height:1.55;',
    'font-variant-ligatures:none}',
    '.inline-terminal-wrapper .term-body::-webkit-scrollbar{width:8px}',
    '.inline-terminal-wrapper .term-body::-webkit-scrollbar-track{background:transparent}',
    '.inline-terminal-wrapper .term-body::-webkit-scrollbar-thumb{border-radius:4px;background:rgba(255,255,255,.16)}',
    '.inline-terminal-wrapper .term-body::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}',
    '.inline-terminal-wrapper .term-cmdline{white-space:pre-wrap;word-break:break-all;margin-bottom:2px}',
    '.inline-terminal-wrapper .term-prompt{font-weight:600;user-select:none}',
    '.inline-terminal-wrapper .term-output{white-space:pre-wrap;word-break:break-all}',
    '.inline-terminal-wrapper .term-line{min-height:1.55em;white-space:pre-wrap}',
    '.inline-terminal-wrapper .term-line-error{color:#ff5f57 !important}',

    /* 工具头部按钮 */
    '.btn-inline-term{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;',
    'border:1px solid transparent;border-radius:5px;background:transparent;color:var(--fg-subtle,#8b949e);cursor:pointer;',
    'flex-shrink:0;transition:background .12s,color .12s,border-color .12s}',
    '.btn-inline-term:hover{background:var(--canvas-subtle,#21262d);color:var(--fg-default,#e6edf3);border-color:var(--border-default,#30363d)}',
    '.btn-inline-term.active{color:var(--accent-fg,#58a6ff);background:rgba(31,111,235,.12);border-color:rgba(31,111,235,.35)}',
    '.btn-inline-term .icon{width:14px;height:14px}',

    /* ANSI 颜色 */
    '.ansi-bold{font-weight:700}',
    '.ansi-dim{opacity:.6}',
    '.ansi-italic{font-style:italic}',
    '.ansi-underline{text-decoration:underline}',
    '.ansi-fg-30{color:#6e7681}.ansi-fg-31{color:#ff7b72}.ansi-fg-32{color:#3fb950}.ansi-fg-33{color:#d29922}',
    '.ansi-fg-34{color:#58a6ff}.ansi-fg-35{color:#bc8cff}.ansi-fg-36{color:#39c5cf}.ansi-fg-37{color:#b1bac4}',
    '.ansi-fg-90{color:#8b949e}.ansi-fg-91{color:#ffa198}.ansi-fg-92{color:#56d364}.ansi-fg-93{color:#e3b341}',
    '.ansi-fg-94{color:#79c0ff}.ansi-fg-95{color:#d2a8ff}.ansi-fg-96{color:#56d4dd}.ansi-fg-97{color:#f0f6fc}',
    '.ansi-bg-40{background:#6e7681}.ansi-bg-41{background:#ff7b72}.ansi-bg-42{background:#3fb950}.ansi-bg-43{background:#d29922}',
    '.ansi-bg-44{background:#58a6ff}.ansi-bg-45{background:#bc8cff}.ansi-bg-46{background:#39c5cf}.ansi-bg-47{background:#b1bac4}',

    /* ============ macOS ============ */
    '.inline-terminal-wrapper.skin-macos{background:#1e1e1e;border-radius:10px;',
    'box-shadow:0 10px 28px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.06);',
    'font-family:Menlo,Monaco,"SF Mono","Cascadia Mono",Consolas,monospace;color:#e6e6e6}',
    '.inline-terminal-wrapper.skin-macos .term-header{height:32px;padding:0 12px;background:rgba(45,45,45,.82);',
    '-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);',
    'border-bottom:1px solid rgba(0,0,0,.35)}',
    '.inline-terminal-wrapper.skin-macos .traffic-lights{display:flex;align-items:center;gap:8px;flex-shrink:0}',
    '.inline-terminal-wrapper.skin-macos .traffic-lights i{width:12px;height:12px;border-radius:50%;display:inline-block;',
    'box-shadow:inset 0 1px 2px rgba(255,255,255,.42),inset 0 -1px 1px rgba(0,0,0,.12),0 .5px 1px rgba(0,0,0,.25);',
    'transition:filter .12s}',
    '.inline-terminal-wrapper.skin-macos .traffic-lights:hover i{filter:brightness(1.08)}',
    '.inline-terminal-wrapper.skin-macos .tl-close{background:#ff5f57;border:.5px solid #e0443e}',
    '.inline-terminal-wrapper.skin-macos .tl-min{background:#febc2e;border:.5px solid #dfa123}',
    '.inline-terminal-wrapper.skin-macos .tl-max{background:#28c840;border:.5px solid #1aab29}',
    '.inline-terminal-wrapper.skin-macos .term-prompt{color:#28c840}',
    '.inline-terminal-wrapper.skin-macos .term-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16)}',

    /* ============ Win11 ============ */
    '.inline-terminal-wrapper.skin-win11{background:#0c0c0c;border-radius:8px;border:1px solid #333;',
    'box-shadow:0 8px 24px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04);',
    'font-family:"Cascadia Mono","Cascadia Code",Consolas,"Microsoft YaHei UI",monospace;color:#cccccc}',
    '.inline-terminal-wrapper.skin-win11 .term-header{height:36px;padding:6px 8px 0;background:#1f1f1f;',
    'border-bottom:1px solid #2b2b2b;display:flex;align-items:flex-end}',
    '.inline-terminal-wrapper.skin-win11 .term-tabs{display:flex;align-items:flex-end;gap:2px;flex:1;min-width:0}',
    '.inline-terminal-wrapper.skin-win11 .term-tab{display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;',
    'border-radius:8px 8px 0 0;font-size:11.5px;color:#b9b9b9;white-space:nowrap;max-width:220px;flex-shrink:1;min-width:0;',
    'position:relative;cursor:default}',
    '.inline-terminal-wrapper.skin-win11 .term-tab.active{background:#0c0c0c;color:#e6e6e6}',
    '.inline-terminal-wrapper.skin-win11 .term-tab.active::before{content:"";position:absolute;left:8px;right:8px;top:0;',
    'height:2px;border-radius:0 0 2px 2px;background:#0078d4}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-ico{display:inline-flex;flex-shrink:0;color:#4cc2ff}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-ico .icon{width:13px;height:13px}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-x{opacity:.5;font-size:14px;line-height:1;flex-shrink:0;margin-left:2px}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-add{width:24px;height:24px;display:flex;align-items:center;justify-content:center;',
    'border-radius:5px;color:#9a9a9a;font-size:16px;line-height:1;flex-shrink:0;margin-bottom:3px;cursor:default}',
    '.inline-terminal-wrapper.skin-win11 .term-tab-add:hover{background:#2b2b2b;color:#ddd}',
    '.inline-terminal-wrapper.skin-win11 .term-prompt{color:#ffffff;font-weight:400}',
    '.inline-terminal-wrapper.skin-win11 .term-body{color:#cccccc}',
    '.inline-terminal-wrapper.skin-win11 .term-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14)}',

    /* ============ Win10 PowerShell ============ */
    '.inline-terminal-wrapper.skin-win10{background:#012456;border-radius:4px;',
    'box-shadow:0 8px 22px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06);',
    'font-family:Consolas,"Lucida Console","Courier New",monospace;color:#eeedf0}',
    '.inline-terminal-wrapper.skin-win10 .term-header{height:26px;padding:0 10px;background:#0a1f4a;',
    'border-bottom:1px solid #001a3d;font-size:11px;color:#b9c8e6;letter-spacing:.02em}',
    '.inline-terminal-wrapper.skin-win10 .term-header .term-title{text-align:left;opacity:.8}',
    '.inline-terminal-wrapper.skin-win10 .term-prompt{color:#eeedf0;font-weight:600}',
    '.inline-terminal-wrapper.skin-win10 .term-output .term-line-error,',
    '.inline-terminal-wrapper.skin-win10 .term-output .term-line-error span{color:#ff5f57 !important}',
    '.inline-terminal-wrapper.skin-win10 .term-body::-webkit-scrollbar-thumb{background:#2a5a9c}',

    /* ============ Termux ============ */
    '.inline-terminal-wrapper.skin-termux{background:#000;border-radius:0;',
    'box-shadow:0 6px 18px rgba(0,0,0,.6),inset 0 0 0 1px #0f2a0c;',
    'font-family:"Termux","DejaVu Sans Mono","Liberation Mono",Consolas,monospace;color:#4af626}',
    '.inline-terminal-wrapper.skin-termux .term-header{height:0;padding:0;overflow:hidden;border:none;background:transparent}',
    '.inline-terminal-wrapper.skin-termux .term-title{display:none}',
    '.inline-terminal-wrapper.skin-termux .term-prompt{color:#4af626;font-weight:600}',
    '.inline-terminal-wrapper.skin-termux .term-body{color:#4af626}',
    '.inline-terminal-wrapper.skin-termux .term-body::-webkit-scrollbar-thumb{background:rgba(74,246,38,.22)}',

    /* 移动端 */
    '@media (max-width:900px){',
    '.inline-terminal-wrapper .term-body{max-height:260px;font-size:12px}',
    '}'
  ].join('');

  var s = document.createElement('style');
  s.id = 'helix-inline-term-style';
  s.textContent = css;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------
   9.6 内嵌终端：ANSI + \r 单元格渲染
   ------------------------------------------------------------ */
function removeStylePrefix(arr, prefix){
  for (var i = arr.length - 1; i >= 0; i--){
    if (arr[i].indexOf(prefix) === 0) arr.splice(i, 1);
  }
}

function applySgrCodes(seq, style){
  var codes = seq ? seq.split(';').filter(Boolean).map(Number) : [0];
  if (!codes.length) codes = [0];

  for (var i = 0; i < codes.length; i++){
    var c = codes[i];
    if (c === 0){ style.length = 0; }
    else if (c === 1){ if (style.indexOf('ansi-bold') === -1) style.push('ansi-bold'); }
    else if (c === 2){ if (style.indexOf('ansi-dim') === -1) style.push('ansi-dim'); }
    else if (c === 3){ if (style.indexOf('ansi-italic') === -1) style.push('ansi-italic'); }
    else if (c === 4){ if (style.indexOf('ansi-underline') === -1) style.push('ansi-underline'); }
    else if (c >= 30 && c <= 37){
      removeStylePrefix(style, 'ansi-fg');
      style.push('ansi-fg-' + c);
    } else if (c >= 90 && c <= 97){
      removeStylePrefix(style, 'ansi-fg');
      style.push('ansi-fg-' + c);
    } else if (c >= 40 && c <= 47){
      removeStylePrefix(style, 'ansi-bg');
      style.push('ansi-bg-' + c);
    } else if (c >= 100 && c <= 107){
      removeStylePrefix(style, 'ansi-bg');
      style.push('ansi-bg-' + c);
    }
  }
}

/* 核心：把原始流解析为行 × 单元格，\r 回到行首覆盖，\n 换行。 */
function parseAnsiCells(raw){
  var lines = [[]];
  var col = 0;
  var style = [];
  var i = 0;
  var n = raw.length;

  while (i < n){
    var c = raw[i];

    if (c === '\x1b' && raw[i + 1] === '['){
      var j = i + 2;
      while (j < n && raw[j] !== 'm' && raw[j] !== 'K' && raw[j] !== 'H' && raw[j] !== 'J') j++;
      if (j < n && raw[j] === 'm'){
        applySgrCodes(raw.slice(i + 2, j), style);
      }
      i = (j < n) ? j + 1 : n;
      continue;
    }

    if (c === '\r'){ col = 0; i++; continue; }
    if (c === '\n'){ lines.push([]); col = 0; i++; continue; }
    if (c === '\b'){ if (col > 0) col--; i++; continue; }

    if (c === '\t'){
      var next = col + (4 - (col % 4));
      while (col < next){
        lines[lines.length - 1][col] = { ch: ' ', cls: style.slice() };
        col++;
      }
      i++;
      continue;
    }

    lines[lines.length - 1][col] = { ch: c, cls: style.slice() };
    col++;
    i++;
  }

  return lines;
}

function cellsLineToHtml(cells){
  if (!cells || !cells.length) return '';
  var max = cells.length - 1;
  while (max >= 0 && !cells[max]) max--;
  if (max < 0) return '';

  var html = '';
  var buf = '';
  var curCls = null;

  for (var i = 0; i <= max; i++){
    var cell = cells[i] || { ch: ' ', cls: [] };
    var cls = cell.cls.join(' ');
    if (cls !== curCls){
      if (buf){
        html += curCls ? '<span class="' + curCls + '">' + buf + '</span>' : buf;
      }
      buf = '';
      curCls = cls;
    }
    buf += esc(cell.ch);
  }
  if (buf){
    html += curCls ? '<span class="' + curCls + '">' + buf + '</span>' : buf;
  }
  return html || '&nbsp;';
}

function lineHasError(cells){
  if (!cells || !cells.length) return false;
  var text = '';
  for (var i = 0; i < cells.length; i++){
    if (cells[i] && cells[i].ch) text += cells[i].ch;
  }
  return /\[错误\]|error|失败|fatal/i.test(text);
}

function renderTerminalStream(raw, skin){
  if (!raw) return '';
  var view = raw.length > 400000 ? raw.slice(-400000) : raw;
  var lines = parseAnsiCells(view);
  var start = Math.max(0, lines.length - 1500);
  var html = '';

  for (var i = start; i < lines.length; i++){
    var cells = lines[i];
    var err = lineHasError(cells);
    html += '<div class="term-line' + (err ? ' term-line-error' : '') + '">' +
      cellsLineToHtml(cells) +
    '</div>';
  }
  return html;
}

function trimTerminalDom(out){
  if (!out) return;
  var lines = out.querySelectorAll('.term-line');
  var max = 1500;
  if (lines.length > max){
    for (var i = 0; i < lines.length - max; i++){
      out.removeChild(lines[i]);
    }
  }
}

/* ------------------------------------------------------------
   9.7 内嵌终端：皮肤、命令、HTML
   ------------------------------------------------------------ */
function detectTerminalSkin(platform, osRelease){
  var p = String(platform || '').toLowerCase();
  var os = String(osRelease || '');

  if (p === 'win32' || p === 'windows' || p === 'windows_nt'){
    var m = os.match(/10\.0\.(\d+)/);
    var build = m ? parseInt(m[1], 10) : 0;
    return build >= 22000 ? 'skin-win11' : 'skin-win10';
  }
  if (p === 'android') return 'skin-termux';
  if (p === 'linux') return 'skin-macos';
  return 'skin-macos';
}

function getTerminalSkin(){
  return state.config.terminalSkin || 'skin-macos';
}

function shellPromptFor(skin){
  if (skin === 'skin-win10') return 'PS C:\\Users\\Helix>';
  if (skin === 'skin-win11') return '>';
  return '$';
}

function extractCommand(tool){
  var a = tool.args;
  if (typeof a === 'string'){
    try { a = JSON.parse(a); } catch(e){ return String(a || '').trim(); }
  }
  if (!a || typeof a !== 'object') return '';

  var cmd = a.command || a.cmd || a.script || a.commandline || '';
  var extra = a.args;
  if (Array.isArray(cmd)) cmd = cmd.join(' ');

  if (extra != null && extra !== cmd){
    if (Array.isArray(extra)) extra = extra.join(' ');
    if (typeof extra === 'object') extra = JSON.stringify(extra);
    extra = String(extra);
  } else {
    extra = '';
  }

  return String(cmd || '') + (extra ? ' ' + extra : '');
}

function renderTerminalHeader(skin){
  if (skin === 'skin-termux') return '';

  if (skin === 'skin-macos'){
    return '<div class="term-header term-header-macos">' +
      '<div class="traffic-lights">' +
        '<i class="tl-close"></i><i class="tl-min"></i><i class="tl-max"></i>' +
      '</div>' +
      '<span class="term-title">helix — zsh</span>' +
    '</div>';
  }

  if (skin === 'skin-win11'){
    return '<div class="term-header term-header-win11">' +
      '<div class="term-tabs">' +
        '<div class="term-tab active">' +
          '<span class="term-tab-ico">' + icon('i-terminal', 'icon-sm') + '</span>' +
          '<span class="term-tab-label">Windows PowerShell</span>' +
          '<span class="term-tab-x">×</span>' +
        '</div>' +
        '<div class="term-tab-add">+</div>' +
      '</div>' +
    '</div>';
  }

  return '<div class="term-header term-header-win10">' +
    '<span class="term-title">Windows PowerShell</span>' +
  '</div>';
}

function buildInlineTerminalHtml(tool, skin, data){
  var open = !!tool.terminalOpen;
  var cmd = extractCommand(tool);
  var prompt = shellPromptFor(skin);

  return '<div class="inline-terminal-wrapper ' + skin + (open ? ' show' : '') + '" ' +
      'data-call="' + esc(tool.callId || '') + '" style="' + (open ? '' : 'display:none') + '">' +
    renderTerminalHeader(skin) +
    '<div class="term-body">' +
      '<div class="term-cmdline">' +
        '<span class="term-prompt">' + esc(prompt) + '</span> ' +
        '<span class="term-cmd">' + esc(cmd) + '</span>' +
      '</div>' +
      '<div class="term-output">' + renderTerminalStream(data, skin) + '</div>' +
    '</div>' +
  '</div>';
}

function renderInlineTerminal(tool, skin){
  var data = tool.terminalData || '';
  var key = skin + ':' + data.length + ':' + (tool.terminalOpen ? 1 : 0) +
            ':' + data.slice(-24);
  if (tool._termCache && tool._termCache.key === key){
    return tool._termCache.html;
  }
  var html = buildInlineTerminalHtml(tool, skin, data);
  tool._termCache = { key: key, html: html };
  return html;
}

/* ------------------------------------------------------------
   9.8 内嵌终端：工具卡片渲染
   ------------------------------------------------------------ */
function renderToolCard(tool){
  var map = { running: '执行中', ok: '已完成', fail: '失败' };
  var spin = tool.status === 'running' ? '<span class="spinner"></span>' : '';
  var args = tool.args
    ? (typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2))
    : '';
  var result = tool.result || '';
  var toolIcon = getToolIcon(tool.name);
  var isCmd = tool.name === 'run_command';

  var btnTerm = isCmd
    ? '<button class="btn-inline-term' + (tool.terminalOpen ? ' active' : '') + '" type="button" ' +
        'data-call="' + esc(tool.callId || '') + '" title="展开 / 折叠终端">' +
        icon('i-terminal', 'icon-sm') +
      '</button>'
    : '';

  var termHtml = isCmd ? renderInlineTerminal(tool, getTerminalSkin()) : '';

  return '<div class="tool-card collapsed" data-call="' + esc(tool.callId || '') + '">' +
    '<div class="tool-head">' +
      '<span class="tool-ico">' + icon(toolIcon) + '</span>' +
      '<span class="tool-name">' + esc(tool.name || 'tool') + '</span>' +
      icon('i-chev-down', 'tool-caret') +
      btnTerm +
      '<span class="tool-status ' + tool.status + '">' + spin + (map[tool.status] || '') + '</span>' +
    '</div>' +
    (args ?
      '<div class="tool-section"><span class="label">参数</span>' + esc(args) + '</div>' : '') +
    (result ?
      '<div class="tool-section result"><span class="label">结果</span>' + esc(result) + '</div>' : '') +
    termHtml +
  '</div>';
}

function findToolByCallId(callId){
  if (!callId) return null;
  for (var i = 0; i < state.messages.length; i++){
    var tools = state.messages[i].tools;
    if (!tools) continue;
    for (var j = 0; j < tools.length; j++){
      if (tools[j] && tools[j].callId === callId) return tools[j];
    }
  }
  return null;
}

function bindInlineTermToggles(root){
  root.querySelectorAll('.btn-inline-term').forEach(function(btn){
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();

      var callId = btn.dataset.call;
      var tool = findToolByCallId(callId);
      var wrapper = root.querySelector('.inline-terminal-wrapper[data-call="' + callId + '"]');
      if (!tool || !wrapper) return;

      var open = !wrapper.classList.contains('show');
      wrapper.classList.toggle('show', open);
      wrapper.style.display = open ? '' : 'none';
      tool.terminalOpen = open;
      btn.classList.toggle('active', open);

      if (open){
        var out = wrapper.querySelector('.term-output');
        if (out){
          out.innerHTML = renderTerminalStream(tool.terminalData || '', getTerminalSkin());
          trimTerminalDom(out);
        }
        var body = wrapper.querySelector('.term-body');
        if (body) body.scrollTop = body.scrollHeight;
      }
      persistSession();
    });
  });
}

/* ------------------------------------------------------------
   10. 流式消息
   ------------------------------------------------------------ */
function currentAssistant(){
  let msg = state.messages.find(m => m.id === state.assistantId);
  if (!msg){
    msg = {
      id: uid('a'),
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      ts: Date.now(),
      streaming: true,
    };
    state.messages.push(msg);
    state.assistantId = msg.id;
    clearEmptyState();
    appendMessageNode(msg);
  }
  return msg;
}

function appendDelta(text){
  const msg = currentAssistant();
  msg.text += text;
  paintMessage(msg);
  autoFollow();
}

function appendReasoning(text){
  const msg = currentAssistant();
  msg.reasoning = (msg.reasoning || '') + text;
  paintMessage(msg);
  autoFollow();
}

function onToolStart(m){
  const msg = currentAssistant();
  msg.tools.push({
    callId: m.callId,
    name: m.name,
    args: m.args,
    status: 'running',
    result: '',
    terminalData: '',
    terminalOpen: false,
  });
  paintMessage(msg);
  autoFollow();
}

function onToolEnd(m){
  const msg = currentAssistant();
  const t = msg.tools.find(x => x.callId === m.callId);
  if (t){
    t.status = m.ok ? 'ok' : 'fail';
    t.result = m.result || '';
  }
  paintMessage(msg);
  autoFollow();
}

/* ------------------------------------------------------------
   10.5 内嵌终端：接管 terminal_output
   ------------------------------------------------------------ */
function onTerminalOutput(m){
  var callId = m.callId;
  if (!callId) return;

  var tool = findToolByCallId(callId);
  if (!tool) return;

  var text = m.text == null ? '' : String(m.text);

  tool.terminalData = (tool.terminalData || '') + text;
  if (tool.terminalData.length > 800000){
    tool.terminalData = tool.terminalData.slice(-800000);
  }
  tool._termCache = null;

  var wrapper = el.stream.querySelector(
    '.inline-terminal-wrapper[data-call="' + callId + '"]'
  );
  if (!wrapper || !wrapper.classList.contains('show')) return;

  var out = wrapper.querySelector('.term-output');
  var body = wrapper.querySelector('.term-body');
  if (!out) return;

  var near = body ? (body.scrollHeight - body.scrollTop - body.clientHeight <= 48) : true;

  if (tool._termRaf) cancelAnimationFrame(tool._termRaf);
  tool._termRaf = requestAnimationFrame(function(){
    tool._termRaf = null;
    if (!wrapper.isConnected || !wrapper.classList.contains('show')) return;

    out.innerHTML = renderTerminalStream(tool.terminalData || '', getTerminalSkin());
    trimTerminalDom(out);

    if (near && body) body.scrollTop = body.scrollHeight;
  });
}

/* ------------------------------------------------------------
   10.6 皮肤切换后重应用
   ------------------------------------------------------------ */
function reapplyTerminalSkin(){
  var skin = getTerminalSkin();
  var wrappers = el.stream.querySelectorAll('.inline-terminal-wrapper');
  if (!wrappers.length) return;

  wrappers.forEach(function(w){
    w.classList.remove('skin-macos', 'skin-win10', 'skin-win11', 'skin-termux');
    w.classList.add(skin);

    var callId = w.dataset.call;
    var tool = findToolByCallId(callId);
    if (!tool) return;

    var oldHeader = w.querySelector('.term-header');
    var newHeaderHtml = renderTerminalHeader(skin);
    if (oldHeader){
      if (newHeaderHtml){
        oldHeader.outerHTML = newHeaderHtml;
      } else {
        oldHeader.remove();
      }
    } else if (newHeaderHtml){
      w.insertAdjacentHTML('afterbegin', newHeaderHtml);
    }

    var promptEl = w.querySelector('.term-prompt');
    if (promptEl) promptEl.textContent = shellPromptFor(skin);

    var out = w.querySelector('.term-output');
    if (out){
      out.innerHTML = renderTerminalStream(tool.terminalData || '', skin);
      trimTerminalDom(out);
    }
    tool._termCache = null;
  });
}

function finishStream(){
  stopPolling();
  const msg = state.messages.find(m => m.id === state.assistantId);
  if (msg){
    msg.streaming = false;
    paintMessage(msg);
  }
  state.assistantId = null;
  state.streaming = false;
  state.abortFlag = false;
  updateSendButton();
  clearPending();
  persistSession();
}

function onStreamError(message){
  stopPolling();
  const msg = currentAssistant();
  msg.text += (msg.text ? '\n\n' : '') + '> ⚠️ ' + message;
  msg.streaming = false;
  paintMessage(msg);
  state.assistantId = null;
  state.streaming = false;
  state.abortFlag = false;
  updateSendButton();
  clearPending();
  toast(message, 'error');
  persistSession();
}

/* ------------------------------------------------------------
   11. 发送 / 中止 / 重生成
   ------------------------------------------------------------ */
function buildWireHistory(){
  const out = [];
  for (let i = 0; i < state.messages.length; i++){
    const m = state.messages[i];
    if (!m) continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (!m.text) continue;
    out.push({ role: m.role, content: m.text });
  }
  return out;
}

function updateSendButton(){
  if (state.streaming){
    el.btnSend.classList.add('stop');
    el.btnSend.innerHTML = icon('i-stop') + '<span>停止</span>';
  } else {
    el.btnSend.classList.remove('stop');
    el.btnSend.innerHTML = icon('i-send') + '<span>发送</span>';
  }
}

function sendMessage(){
  const text = el.promptInput.value.trim();
  if (!text || state.streaming) return;

  ensureCurrentSession();

  const attachments = state.attachments.slice();
  let fullText = text;
  if (attachments.length){
    const parts = attachments.map(a => {
      if (a.content){
        return '=== 文件 ' + a.name + ' ===\n' + a.content + '\n=== 文件结束 ===';
      }
      return '[附件] ' + a.name + ' (' + a.size + ')';
    });
    fullText += '\n\n' + parts.join('\n\n');
  }

  const userMsg = {
    id: uid('u'),
    role: 'user',
    text: fullText,
    reasoning: '',
    tools: [],
    ts: Date.now(),
    streaming: false,
  };
  state.messages.push(userMsg);
  clearEmptyState();
  appendMessageNode(userMsg);

  el.promptInput.value = '';
  state.attachments = [];
  renderAttachments();
  autoResize();
  scrollToBottom(true);

  state.streaming = true;
  state.assistantId = null;
  state.abortFlag = false;
  updateSendButton();

  const clientMsgId = uid('cm');
  const ok = sendSocket({
    type: 'user_message',
    text: fullText,
    clientMsgId: clientMsgId,
    history: buildWireHistory(),
    sessionId: state.currentId,
    useAiTitle: state.config.useAiTitle || false,
  });

  if (ok){
    try {
      localStorage.setItem(KEY.pending, JSON.stringify({
        clientMsgId: clientMsgId,
        ts: Date.now(),
      }));
    } catch(e){}
  } else {
    runOfflineDemo(fullText);
  }

  persistSession();
}

function abortStream(){
  state.abortFlag = true;
  sendSocket({ type: 'abort' });

  const pending = readPending();
  if (pending && pending.clientMsgId){
    fetch('/api/task/' + encodeURIComponent(pending.clientMsgId) + '/abort', {
      method: 'POST',
    }).catch(() => {});
  }

  finishStream();
  toast('已中止生成', 'info', 1600);
}

function regenerate(){
  if (state.streaming){ toast('正在生成中，请稍候', 'warn'); return; }

  let lastUser = null;
  for (let i = state.messages.length - 1; i >= 0; i--){
    if (state.messages[i].role === 'user'){ lastUser = state.messages[i]; break; }
  }
  if (!lastUser){ toast('没有可重新生成的内容', 'warn'); return; }

  ensureCurrentSession();

  let cut = state.messages.indexOf(lastUser) + 1;
  state.messages.slice(cut).forEach(m => {
    const node = state.nodes.get(m.id);
    if (node) node.remove();
    state.nodes.delete(m.id);
  });
  state.messages = state.messages.slice(0, cut);

  state.streaming = true;
  state.assistantId = null;
  updateSendButton();

  const clientMsgId = uid('cm');
  const ok = sendSocket({
    type: 'user_message',
    text: lastUser.text,
    clientMsgId: clientMsgId,
    history: buildWireHistory(),
    sessionId: state.currentId,
    useAiTitle: state.config.useAiTitle || false,
  });
  if (ok){
    try {
      localStorage.setItem(KEY.pending, JSON.stringify({
        clientMsgId: clientMsgId,
        ts: Date.now(),
      }));
    } catch(e){}
  } else {
    runOfflineDemo(lastUser.text);
  }
  persistSession();
}

function resend(msg){
  if (state.streaming){ toast('正在生成中，请稍候', 'warn'); return; }
  const idx = state.messages.indexOf(msg);
  if (idx === -1) return;

  ensureCurrentSession();

  state.messages.slice(idx).forEach(m => {
    const node = state.nodes.get(m.id);
    if (node) node.remove();
    state.nodes.delete(m.id);
  });
  state.messages = state.messages.slice(0, idx);

  state.streaming = true;
  state.assistantId = null;
  updateSendButton();

  const clientMsgId = uid('cm');
  const ok = sendSocket({
    type: 'user_message',
    text: msg.text,
    clientMsgId: clientMsgId,
    history: buildWireHistory(),
    sessionId: state.currentId,
    useAiTitle: state.config.useAiTitle || false,
  });
  if (ok){
    try {
      localStorage.setItem(KEY.pending, JSON.stringify({
        clientMsgId: clientMsgId,
        ts: Date.now(),
      }));
    } catch(e){}
  } else {
    runOfflineDemo(msg.text);
  }
  persistSession();
}

/* ------------------------------------------------------------
   11.5 未完成任务恢复
   ------------------------------------------------------------ */
let pollTimer = null;
let pollRetries = 0;

function readPending(){
  try {
    return JSON.parse(localStorage.getItem(KEY.pending) || 'null');
  } catch(e){
    return null;
  }
}

function clearPending(){
  try { localStorage.removeItem(KEY.pending); } catch(e){}
}

function stopPolling(){
  if (pollTimer){
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollRetries = 0;
}

async function restorePendingTask(){
  const pending = readPending();
  if (!pending || !pending.clientMsgId) return;

  if (pending.ts && Date.now() - pending.ts > 6 * 60 * 1000){
    clearPending();
    return;
  }

  try {
    const res = await fetch('/api/task/' + encodeURIComponent(pending.clientMsgId));
    if (res.status === 404){
      clearPending();
      return;
    }
    if (!res.ok) return;
    const snap = await res.json();
    applyTaskSnapshot(snap);
  } catch(e){}
}

function applyTaskSnapshot(snap){
  if (!snap || !snap.id) return;

  let msg = state.messages.find(m => m.clientMsgId === snap.id);
  const isNew = !msg;

  if (!msg){
    msg = {
      id: uid('a'),
      role: 'assistant',
      text: '',
      reasoning: '',
      tools: [],
      ts: snap.createdAt || Date.now(),
      streaming: true,
      clientMsgId: snap.id,
    };
    state.messages.push(msg);
    clearEmptyState();
    appendMessageNode(msg);
    if (isNew) scrollToBottom(false);
  }

  msg.text = snap.text || '';
  msg.reasoning = snap.reasoning || '';
  msg.tools = Array.isArray(snap.tools) ? snap.tools.map(t => ({
    callId: t.callId,
    name: t.name,
    args: t.args,
    status: t.status || 'ok',
    result: t.result || '',
    terminalData: t.terminalData || '',
    terminalOpen: !!t.terminalOpen,
  })) : [];
  msg.streaming = snap.status === 'running';

  paintMessage(msg);
  autoFollow();

  if (snap.status === 'running'){
    state.streaming = true;
    state.assistantId = msg.id;
    updateSendButton();
    schedulePoll(snap.id);
  } else {
    state.streaming = false;
    state.assistantId = null;
    updateSendButton();
    stopPolling();

    if (snap.status === 'error' && snap.errorMessage){
      toast(snap.errorMessage, 'error');
    } else if (snap.status === 'aborted'){
      toast('任务已中止', 'info', 1800);
    }

    clearPending();
    persistSession();
  }
}

function schedulePoll(taskId, isRetry){
  if (pollTimer){
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (!isRetry) pollRetries = 0;

  pollTimer = setTimeout(async () => {
    pollTimer = null;
    try {
      const res = await fetch('/api/task/' + encodeURIComponent(taskId));

      if (res.status === 404){
        clearPending();
        state.streaming = false;
        state.assistantId = null;
        updateSendButton();
        return;
      }
      if (!res.ok){
        pollRetries++;
        if (pollRetries < 30) schedulePoll(taskId, true);
        return;
      }
      pollRetries = 0;
      const snap = await res.json();
      applyTaskSnapshot(snap);
    } catch(e){
      pollRetries++;
      if (pollRetries < 30) schedulePoll(taskId, true);
    }
  }, 800);
}

/* ------------------------------------------------------------
   12. 离线演示（内嵌终端版）
   ------------------------------------------------------------ */
function runOfflineDemo(prompt){
  const lower = prompt.toLowerCase();
  let text = '';
  const tools = [];
  let preview = null;

  const looksLikeHtml = /预览|html|页面|画一个|渲染|preview|circle|圆形|动画/.test(lower);
  const looksLikeCommand = /执行|命令|terminal|shell|运行|版本|node|npm|python/.test(lower);

  if (looksLikeHtml){
    tools.push({
      callId: uid('call'),
      name: 'render_preview',
      args: JSON.stringify({ target: 'preview_panel' }, null, 2),
      status: 'running',
      result: '',
      terminalData: '',
      terminalOpen: false,
    });
    preview = buildDemoHtml();
    text =
      '好的，已经把一个渐变圆形的演示页面渲染到右侧预览面板了。\n\n' +
      '页面结构大致如下：\n\n' +
      '```html\n' +
      '<div class="stage">\n' +
      '  <div class="orb"></div>\n' +
      '</div>\n' +
      '```\n\n' +
      '关键点：\n\n' +
      '1. 用 `radial-gradient` 制造球体高光，比纯线性渐变更像一个球；\n' +
      '2. `@keyframes breathe` 里只改 `transform` 和 `box-shadow`，避免触发重排；\n' +
      '3. 外层容器用 `place-items:center` 做居中，比绝对定位更稳。\n\n' +
      '需要我再加上鼠标跟随或者粒子效果吗？';
  } else if (looksLikeCommand){
    tools.push({
      callId: uid('call'),
      name: 'run_command',
      args: JSON.stringify({ command: 'node -v && npm -v', cwd: state.config.workspace || '~' }, null, 2),
      status: 'running',
      result: '',
      terminalData: '',
      terminalOpen: true,
    });
    text =
      '我先看一下当前环境里装了哪些运行时。\n\n' +
      '```bash\n' +
      '# 检查 Node 与 npm\n' +
      'node -v && npm -v\n' +
      '```\n\n' +
      '如果你需要我实际执行这条命令，请把权限模式切换为 **auto** 或以上，' +
      '然后在弹窗里点「本次允许」。';
  } else {
    text =
      '我目前运行在 **离线演示模式**，没有连上后端服务，' +
      '所以这里给你一个结构化的回复示例。\n\n' +
      '### 当前状态\n\n' +
      '- 会话数据保存在浏览器 `localStorage`\n' +
      '- 消息渲染、搜索、导出等前端能力**完全可用**\n' +
      '- 只有真正调用模型和工具的那一步需要后端\n\n' +
      '### 怎么恢复\n\n' +
      '启动 Helix 后端后刷新页面即可，连接状态会从 `离线演示` 变成 `已连接`。\n\n' +
      '> 你刚才说的是：' + prompt.slice(0, 80) + '\n\n' +
      '---\n\n' +
      '顺便一提，可以试试按 <kbd>Ctrl</kbd> + <kbd>K</kbd> 打开命令面板，' +
      '或者点右上角的调色板图标换主题。';
  }

  state.streaming = true;
  state.abortFlag = false;
  updateSendButton();

  const assistant = currentAssistant();

  let step = 0;
  const REASON =
    '用户的问题需要判断意图。\n' +
    '先看关键词：' + (looksLikeHtml ? '涉及 HTML / 预览' :
                        looksLikeCommand ? '涉及命令执行' : '属于普通问答') + '。\n' +
    '离线演示模式下，我不调用真实后端，直接生成一段结构化的示例回复。';

  let ri = 0;
  const reasonTimer = setInterval(() => {
    if (state.abortFlag){ clearInterval(reasonTimer); return; }
    ri += 6;
    assistant.reasoning = REASON.slice(0, ri);
    paintMessage(assistant);
    autoFollow();
    if (ri >= REASON.length){
      clearInterval(reasonTimer);
      startTools();
    }
  }, 26);

  function startTools(){
    if (!tools.length){ startText(); return; }
    const tool = tools[0];
    assistant.tools.push(tool);
    paintMessage(assistant);
    autoFollow();

    setTimeout(() => {
      if (state.abortFlag) return;
      tool.status = 'ok';
      if (looksLikeHtml){
        tool.result = '已渲染 1280×720 预览画布';
        if (preview) showPreview(preview);
      } else {
        tool.result = '命令已排队等待授权';
        tool.terminalData =
          'v20.10.0\n' +
          '10.2.3\n';
      }
      paintMessage(assistant);
      startText();
    }, 700);
  }

  function startText(){
    let ci = 0;
    const timer = setInterval(() => {
      if (state.abortFlag){ clearInterval(timer); return; }
      ci += 4;
      assistant.text = text.slice(0, ci);
      paintMessage(assistant);
      autoFollow();
      if (ci >= text.length){
        clearInterval(timer);
        finishStream();
      }
    }, 16);
  }
}

function buildDemoHtml(){
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{height:100vh;display:grid;place-items:center;' +
      'background:radial-gradient(circle at 50% 40%,#1b2233,#0b0e14 70%);' +
      'font-family:system-ui,-apple-system,sans-serif;overflow:hidden}' +
    '.stage{position:relative;display:grid;place-items:center}' +
    '.orb{width:190px;height:190px;border-radius:50%;' +
      'background:radial-gradient(circle at 34% 30%,#9fc4ff,#3b6fe0 45%,#6a3fd0 100%);' +
      'box-shadow:0 0 70px rgba(90,140,255,.55),inset -18px -22px 50px rgba(0,0,0,.35);' +
      'animation:breathe 4.2s ease-in-out infinite}' +
    '.ring{position:absolute;width:250px;height:250px;border-radius:50%;' +
      'border:1px dashed rgba(140,170,255,.28);' +
      'animation:spin 22s linear infinite}' +
    '.ring::after{content:"";position:absolute;top:-4px;left:50%;width:8px;height:8px;' +
      'border-radius:50%;background:#9fc4ff;transform:translateX(-50%);' +
      'box-shadow:0 0 14px #9fc4ff}' +
    '.cap{position:absolute;bottom:-64px;left:50%;transform:translateX(-50%);' +
      'color:#8ea3c9;font-size:12px;letter-spacing:.22em;text-transform:uppercase;' +
      'white-space:nowrap}' +
    '@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.055)}}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '</style></head><body>' +
      '<div class="stage">' +
        '<div class="ring"></div>' +
        '<div class="orb"></div>' +
        '<div class="cap">Helix Preview</div>' +
      '</div>' +
    '</body></html>';
}

/* ------------------------------------------------------------
   13. 输入框 / 附件 / 语音
   ------------------------------------------------------------ */
function autoResize(){
  const ta = el.promptInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 260) + 'px';
}

el.promptInput.addEventListener('input', autoResize);
el.promptInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    sendMessage();
  }
});
el.btnSend.addEventListener('click', () => {
  if (state.streaming) abortStream();
  else sendMessage();
});

const TEXT_EXT = ['txt','md','markdown','json','js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','java','c','h','cpp','hpp','cs','php','swift','kt','html','htm','css','scss','sass','less','xml','yaml','yml','toml','ini','conf','env','csv','tsv','log','sh','bash','zsh','fish','bat','ps1','sql','vue','svg'];

function isTextFile(name, type){
  if (type && /^text\//i.test(type)) return true;
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return false;
  return TEXT_EXT.indexOf(m[1]) !== -1;
}

const ATTACH_MAX_READ = 200 * 1024;
const ATTACH_MAX_KEEP = 50 * 1024;

async function buildAttachment(file){
  const a = {
    name: file.name,
    size: file.size > 1048576
      ? (file.size / 1048576).toFixed(1) + ' MB'
      : (file.size / 1024).toFixed(1) + ' KB',
    sizeRaw: file.size,
  };

  if (!isTextFile(file.name, file.type)) return a;

  if (file.size > ATTACH_MAX_READ){
    a.name = a.name + '（文件过大，未读取）';
    return a;
  }

  try {
    let content = await file.text();
    if (content.length > ATTACH_MAX_KEEP){
      content = content.slice(0, ATTACH_MAX_KEEP) +
        '\n\n[内容已截断，原文件 ' + file.size + ' 字节]';
      a.truncated = true;
    }
    a.content = content;
  } catch(e){}

  return a;
}

function renderAttachments(){
  el.attachRow.innerHTML = state.attachments.map((a, i) =>
    '<span class="attach">' +
      icon('i-file', 'icon-sm') +
      esc(a.name) +
      (a.content ? '<span style="color:var(--success-fg);font-weight:600;margin-left:2px" title="已读取内容">✓</span>' : '') +
      '<button data-rm="' + i + '" aria-label="移除附件">' + icon('i-x', 'icon-sm') + '</button>' +
    '</span>'
  ).join('');

  el.attachRow.querySelectorAll('[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.attachments.splice(+btn.dataset.rm, 1);
      renderAttachments();
    });
  });
}

el.btnAttach.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  for (const f of files){
    state.attachments.push(await buildAttachment(f));
  }
  renderAttachments();
  e.target.value = '';
});

el.composerBox.addEventListener('dragover', e => {
  e.preventDefault();
  el.composerBox.style.borderColor = 'var(--accent-emphasis)';
});
el.composerBox.addEventListener('dragleave', () => {
  el.composerBox.style.borderColor = '';
});
el.composerBox.addEventListener('drop', async e => {
  e.preventDefault();
  el.composerBox.style.borderColor = '';
  const files = Array.from(e.dataTransfer.files || []);
  for (const f of files){
    state.attachments.push(await buildAttachment(f));
  }
  if (files.length) {
    renderAttachments();
    toast('已添加 ' + files.length + ' 个附件', 'success', 1600);
  }
});

el.btnMic.addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ toast('当前浏览器不支持语音输入', 'warn'); return; }

  const rec = new SR();
  rec.lang = 'zh-CN';
  rec.continuous = false;
  rec.interimResults = false;

  el.btnMic.classList.add('is-on');
  toast('请开始说话…', 'info', 1800);

  rec.onresult = e => {
    const t = e.results[0][0].transcript;
    el.promptInput.value += (el.promptInput.value ? ' ' : '') + t;
    autoResize();
  };
  rec.onerror = () => {
    el.btnMic.classList.remove('is-on');
    toast('语音识别失败', 'error');
  };
  rec.onend = () => el.btnMic.classList.remove('is-on');

  try { rec.start(); }
  catch(e){ el.btnMic.classList.remove('is-on'); }
});

/* ------------------------------------------------------------
   14. 滚动跟随
   ------------------------------------------------------------ */
let unreadCount = 0;
let stickToBottom = true;
let programmaticScroll = false;
let followRaf = null;

function nearBottom(threshold){
  const s = el.chatScroll;
  const t = threshold == null ? 180 : threshold;
  return s.scrollHeight - s.scrollTop - s.clientHeight <= t;
}

function jumpToBottomInternal(smooth){
  if (smooth){
    programmaticScroll = true;
    el.chatScroll.scrollTo({
      top: el.chatScroll.scrollHeight,
      behavior: 'smooth',
    });
    setTimeout(() => { programmaticScroll = false; }, 650);
  } else {
    programmaticScroll = true;
    el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }
}

function autoFollow(){
  if (!state.ui.autoScroll) return;

  if (!stickToBottom){
    if (state.streaming){
      unreadCount++;
      el.jumpBadge.textContent = String(unreadCount);
      el.jumpBadge.hidden = false;
      el.jumpBtn.hidden = false;
    }
    return;
  }

  if (followRaf) return;
  followRaf = requestAnimationFrame(() => {
    followRaf = null;
    if (!stickToBottom) return;
    jumpToBottomInternal(false);
  });
}

function scrollToBottom(smooth){
  stickToBottom = true;
  unreadCount = 0;
  el.jumpBadge.hidden = true;
  el.jumpBtn.hidden = true;

  if (smooth){
    jumpToBottomInternal(true);
  } else {
    requestAnimationFrame(() => jumpToBottomInternal(false));
  }
}

el.chatScroll.addEventListener('scroll', () => {
  if (programmaticScroll) return;

  const atBottom = nearBottom(80);
  stickToBottom = atBottom;

  if (atBottom){
    el.jumpBtn.hidden = true;
    unreadCount = 0;
    el.jumpBadge.hidden = true;
  } else {
    el.jumpBtn.hidden = false;
  }
}, { passive: true });

el.jumpBtn.addEventListener('click', () => scrollToBottom(true));

/* ------------------------------------------------------------
   15. 预览面板
   ------------------------------------------------------------ */
function showPreview(html){
  state.previewHtml = html || '';
  el.previewFrame.srcdoc = state.previewHtml;
  el.previewEmpty.style.display = 'none';

  if (!state.previewOpen && state.ui.autoPreview){
    state.previewOpen = true;
    el.main.classList.add('preview-on');
    el.btnPreview.classList.add('is-active');
  }
}

el.btnPreview.addEventListener('click', () => {
  state.previewOpen = !state.previewOpen;
  el.main.classList.toggle('preview-on', state.previewOpen);
  el.btnPreview.classList.toggle('is-active', state.previewOpen);
  if (!state.previewHtml) el.previewEmpty.style.display = 'flex';
  if (state.previewOpen && window.innerWidth <= 900) openScrim();
  else if (window.innerWidth <= 900) closeScrim();
});

el.prevClose.addEventListener('click', () => {
  state.previewOpen = false;
  el.main.classList.remove('preview-on');
  el.btnPreview.classList.remove('is-active');
  closeScrim();
});

el.prevReload.addEventListener('click', () => {
  if (state.previewHtml) el.previewFrame.srcdoc = state.previewHtml;
});

el.prevOpen.addEventListener('click', () => {
  if (!state.previewHtml){ toast('还没有可预览的内容', 'warn'); return; }
  const w = window.open('', '_blank');
  if (!w){ toast('浏览器拦截了新窗口', 'warn'); return; }
  w.document.open();
  w.document.write(state.previewHtml);
  w.document.close();
});

(function setupGrip(){
  let dragging = false;

  el.previewGrip.addEventListener('mousedown', e => {
    if (window.innerWidth <= 900) return;
    dragging = true;
    el.previewGrip.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = el.main.getBoundingClientRect();
    const w = Math.min(Math.max(rect.right - e.clientX, 300), rect.width - 320);
    document.documentElement.style.setProperty('--preview-w', w + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    el.previewGrip.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

/* ------------------------------------------------------------
   16. 侧栏 / 遮罩
   ------------------------------------------------------------ */
function openSidebar(){
  el.sidebar.classList.remove('collapsed');
  if (window.innerWidth <= 900){
    el.sidebar.classList.add('open');
    openScrim();
  }
}
function closeSidebar(){
  if (window.innerWidth <= 900){
    el.sidebar.classList.remove('open');
    closeScrim();
  } else {
    el.sidebar.classList.add('collapsed');
  }
}
function toggleSidebar(){
  if (window.innerWidth <= 900){
    if (el.sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  } else {
    el.sidebar.classList.toggle('collapsed');
  }
}
function openScrim(){ el.scrim.classList.add('on'); }
function closeScrim(){ el.scrim.classList.remove('on'); }

el.btnSidebar.addEventListener('click', toggleSidebar);
el.scrim.addEventListener('click', () => {
  closeSidebar();
  closeDrawer();
  if (state.previewOpen && window.innerWidth <= 900){
    state.previewOpen = false;
    el.main.classList.remove('preview-on');
    el.btnPreview.classList.remove('is-active');
  }
});

el.btnNew.addEventListener('click', () => {
  newSession();
  if (window.innerWidth > 900) el.promptInput.focus();
});

(function swipeGesture(){
  let startX = 0, startY = 0, tracking = false;

  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < 32 && window.innerWidth <= 900){
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    if (dx > 60 && dy < 60){
      openSidebar();
      tracking = false;
    }
  }, { passive: true });

  document.addEventListener('touchend', () => { tracking = false; }, { passive: true });
})();

/* ------------------------------------------------------------
   17. 设置抽屉
   ------------------------------------------------------------ */
let drawerSnapshot = null;

function captureDrawerSnapshot(){
  ensureAiTitleOption();
  const val = id => {
    const n = $(id);
    return n ? String(n.value == null ? '' : n.value) : '';
  };
  const chk = id => {
    const n = $(id);
    return n ? !!n.checked : false;
  };
  return JSON.stringify({
    workspace: val('cfgWorkspace'),
    baseUrl: val('cfgBaseUrl'),
    model: val('cfgModel'),
    systemPrompt: val('cfgSystemPrompt'),
    temperature: val('cfgTemperature'),
    maxTokens: val('cfgMaxTokens'),
    cmdTimeout: val('cfgCmdTimeout'),
    permMode: (document.querySelector('input[name="permMode"]:checked') || {}).value || '',
    useAiTitle: chk('cfgUseAiTitle'),
    lang: val('cfgLang'),
    fontSize: val('cfgFontSize'),
    autoScroll: chk('cfgAutoScroll'),
    animations: chk('cfgAnimations'),
    autoPreview: chk('cfgAutoPreview'),
    apiKey: val('cfgApiKey'),
  });
}

function openDrawer(){
  el.drawer.classList.add('on');
  openScrim();
  loadConfigToUI();
  drawerSnapshot = captureDrawerSnapshot();
}

function doCloseDrawer(){
  el.drawer.classList.remove('on');
  editingProfileId = null;
  drawerSnapshot = null;
  hideUnsavedDialog();
  if (!el.sidebar.classList.contains('open') &&
      !(state.previewOpen && window.innerWidth <= 900)) closeScrim();
}

function closeDrawer(force){
  if (!force && drawerSnapshot !== null){
    let dirty = false;
    try {
      dirty = captureDrawerSnapshot() !== drawerSnapshot;
    } catch(e){ dirty = false; }
    if (dirty){
      showUnsavedDialog();
      return;
    }
  }
  doCloseDrawer();
}

el.btnSettings.addEventListener('click', openDrawer);
el.drawerClose.addEventListener('click', () => closeDrawer());
el.drawerCancel.addEventListener('click', () => closeDrawer());

el.drawer.querySelectorAll('.dtab').forEach(tab => {
  tab.addEventListener('click', () => {
    el.drawer.querySelectorAll('.dtab').forEach(t => t.classList.remove('on'));
    el.drawer.querySelectorAll('.dpane').forEach(p => p.classList.remove('on'));
    tab.classList.add('on');
    const pane = el.drawer.querySelector('[data-pane="' + tab.dataset.tab + '"]');
    if (pane) pane.classList.add('on');
  });
});

(function injectUnsavedDialogStyle(){
  if (document.getElementById('helix-unsaved-style')) return;
  const s = document.createElement('style');
  s.id = 'helix-unsaved-style';
  s.textContent = [
    '.helix-unsaved-mask{position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;animation:huFade .14s ease-out}',
    '@keyframes huFade{from{opacity:0}to{opacity:1}}',
    '.helix-unsaved-panel{width:min(400px,100%);background:var(--canvas-overlay,#161b22);border:1px solid var(--border-default,#30363d);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.55);padding:18px 18px 14px;color:var(--fg-default,#e6edf3);animation:huPop .16s ease-out}',
    '@keyframes huPop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.helix-unsaved-title{font-size:15px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px}',
    '.helix-unsaved-title .icon{width:18px;height:18px;color:var(--attention-fg,#d29922)}',
    '.helix-unsaved-desc{font-size:13px;color:var(--fg-muted,#8b949e);line-height:1.6;margin-bottom:16px}',
    '.helix-unsaved-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    '.helix-unsaved-actions .btn{min-width:82px;justify-content:center}'
  ].join('\n');
  document.head.appendChild(s);
})();

function hideUnsavedDialog(){
  const m = document.getElementById('helixUnsavedDialog');
  if (m) m.remove();
}

function showUnsavedDialog(){
  hideUnsavedDialog();

  const mask = document.createElement('div');
  mask.id = 'helixUnsavedDialog';
  mask.className = 'helix-unsaved-mask';
  mask.innerHTML =
    '<div class="helix-unsaved-panel">' +
      '<div class="helix-unsaved-title">' +
        icon('i-alert') + '你有修改未保存' +
      '</div>' +
      '<div class="helix-unsaved-desc">' +
        '关闭设置面板前，是否保存当前修改？' +
      '</div>' +
      '<div class="helix-unsaved-actions">' +
        '<button class="btn" data-act="cancel" type="button">继续编辑</button>' +
        '<button class="btn danger" data-act="discard" type="button">放弃修改</button>' +
        '<button class="btn primary" data-act="save" type="button">' +
          icon('i-check') + '确认修改' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(mask);

  mask.addEventListener('click', e => {
    if (e.target === mask) hideUnsavedDialog();
  });
  mask.querySelector('[data-act="cancel"]').addEventListener('click', () => {
    hideUnsavedDialog();
  });
  mask.querySelector('[data-act="discard"]').addEventListener('click', () => {
    hideUnsavedDialog();
    doCloseDrawer();
  });
  mask.querySelector('[data-act="save"]').addEventListener('click', () => {
    hideUnsavedDialog();
    saveConfigFromUI();
  });
}

function ensureAiTitleOption(){
  if (document.getElementById('cfgUseAiTitle')) return;

  const pane = el.drawer.querySelector('[data-pane="general"]');
  if (!pane) return;

  const anchor = document.getElementById('cfgAutoPreview');
  const anchorLabel = anchor
    ? (anchor.closest('label') || anchor.parentNode)
    : null;

  const label = document.createElement('label');
  label.className = 'opt';
  label.setAttribute('data-helix-auto-title', '1');
  label.innerHTML =
    '<input type="checkbox" id="cfgUseAiTitle">' +
    '<span class="opt-txt">' +
      '<span class="opt-title">AI 自动生成标题</span>' +
      '<span class="opt-desc">在对话结束后，让模型根据内容自动命名</span>' +
    '</span>';

  if (anchorLabel && anchorLabel.parentNode === pane){
    if (anchorLabel.nextSibling){
      pane.insertBefore(label, anchorLabel.nextSibling);
    } else {
      pane.appendChild(label);
    }
  } else {
    pane.appendChild(label);
  }
}

function loadConfigToUI(){
  const c = state.config;
  $('cfgWorkspace').value = c.workspace || '';
  $('cfgSystemPrompt').value = c.systemPrompt || DEFAULT_PROMPT;
  $('cfgTemperature').value = c.temperature;
  $('cfgMaxTokens').value = c.maxTokens;
  $('cfgCmdTimeout').value = c.cmdTimeout;

  const targetP = editingProfileId
    ? (c.profiles || []).find(x => x.id === editingProfileId)
    : (c.profiles || []).find(x => x.id === c.activeProfileId);

  $('cfgModel').value = targetP ? (targetP.model || '') : (c.model || '');
  $('cfgBaseUrl').value = targetP ? (targetP.baseUrl || '') : (c.baseUrl || '');

  const apiKey = $('cfgApiKey');
  apiKey.value = '';
  const hasKey = targetP ? !!targetP.hasKey : !!c.hasKey;
  apiKey.placeholder = hasKey ? '已保存（留空则保持不变）' : 'sk-...';

  document.querySelectorAll('input[name="permMode"]').forEach(r => {
    r.checked = r.value === (c.permissionMode || 'auto');
  });

  $('cfgLang').value = state.ui.lang;
  $('cfgFontSize').value = String(state.ui.fontSize);
  $('cfgAutoScroll').checked = state.ui.autoScroll;
  $('cfgAnimations').checked = state.ui.animations;
  $('cfgAutoPreview').checked = state.ui.autoPreview;

  ensureAiTitleOption();
  const aiTitleEl = $('cfgUseAiTitle');
  if (aiTitleEl) aiTitleEl.checked = state.config.useAiTitle || false;

  renderAllowList();
  renderProfileManager();
}

function renderAllowList(){
  if (!state.allowed.size){
    el.allowList.innerHTML = '<span style="font-size:11.5px;color:var(--fg-subtle)">暂无</span>';
    return;
  }
  el.allowList.innerHTML = Array.from(state.allowed).map(t =>
    '<span class="attach" style="padding-right:8px">' + icon('i-check', 'icon-sm') + esc(t) + '</span>'
  ).join('');
}

function saveConfigFromUI(){
  ensureAiTitleOption();
  const aiTitleEl = $('cfgUseAiTitle');
  const useAiTitle = aiTitleEl ? !!aiTitleEl.checked : false;

  const modelVal = $('cfgModel').value.trim();
  const baseUrlVal = $('cfgBaseUrl').value.trim();
  const apiKeyVal = $('cfgApiKey').value.trim();

  const targetProfileId = editingProfileId || state.config.activeProfileId;
  const targetProfile = (state.config.profiles || []).find(x => x.id === targetProfileId);

  if (targetProfile){
    targetProfile.model = modelVal;
    targetProfile.baseUrl = baseUrlVal;
    if (apiKeyVal) targetProfile.hasKey = true;
  } else if (state.config.profiles && state.config.profiles.length){
    const active = state.config.profiles.find(x => x.id === state.config.activeProfileId);
    if (active){
      active.model = modelVal;
      active.baseUrl = baseUrlVal;
      if (apiKeyVal) active.hasKey = true;
    }
  }

  if (!targetProfileId || targetProfileId === state.config.activeProfileId){
    state.config.model = modelVal;
    state.config.baseUrl = baseUrlVal;
    if (apiKeyVal) state.config.hasKey = true;
    el.modelLabel.textContent = state.config.model || '未配置';
  }

  const payload = {
    workspace: $('cfgWorkspace').value.trim(),
    baseUrl: baseUrlVal,
    model: modelVal,
    systemPrompt: $('cfgSystemPrompt').value,
    temperature: parseFloat($('cfgTemperature').value) || 0.7,
    maxTokens: parseInt($('cfgMaxTokens').value, 10) || 4096,
    cmdTimeout: parseInt($('cfgCmdTimeout').value, 10) || 30,
    permissionMode: (document.querySelector('input[name="permMode"]:checked') || {}).value || 'auto',
    useAiTitle: useAiTitle,
    activeProfileId: state.config.activeProfileId,
    profiles: state.config.profiles,
    targetProfileId: targetProfileId,
  };
  if (apiKeyVal) payload.apiKey = apiKeyVal;

  state.config.workspace = payload.workspace;
  state.config.systemPrompt = payload.systemPrompt;
  state.config.temperature = payload.temperature;
  state.config.maxTokens = payload.maxTokens;
  state.config.cmdTimeout = payload.cmdTimeout;
  state.config.permissionMode = payload.permissionMode;
  state.config.useAiTitle = useAiTitle;

  state.ui.lang = $('cfgLang').value;
  state.ui.fontSize = parseInt($('cfgFontSize').value, 10) || 14;
  state.ui.autoScroll = $('cfgAutoScroll').checked;
  state.ui.animations = $('cfgAnimations').checked;
  state.ui.autoPreview = $('cfgAutoPreview').checked;

  applyUISettings();
  updateModeChip();

  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
  .then(cfg => {
    if (cfg && typeof cfg === 'object'){
      if (typeof cfg.hasKey === 'boolean') state.config.hasKey = cfg.hasKey;
      if (Array.isArray(cfg.profiles)) state.config.profiles = cfg.profiles;
      if (cfg.activeProfileId) state.config.activeProfileId = cfg.activeProfileId;
      if (cfg.profileHasKey && targetProfile) targetProfile.hasKey = true;
    }
    editingProfileId = null;
    toast('设置已保存', 'success');
  })
  .catch(() => {
    editingProfileId = null;
    toast('设置已保存在本地（后端未响应）', 'warn', 3000);
  });

  $('cfgApiKey').value = '';
  $('cfgApiKey').placeholder = state.config.hasKey ? '已保存（留空则保持不变）' : 'sk-...';
  doCloseDrawer();
}

el.drawerSave.addEventListener('click', saveConfigFromUI);

function applyUISettings(){
  document.body.style.fontSize = state.ui.fontSize + 'px';
  document.body.classList.toggle('no-anim', !state.ui.animations);
  try { localStorage.setItem(KEY.ui, JSON.stringify(state.ui)); } catch(e){}
}

el.drawer.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = PROMPT_PRESETS[btn.dataset.preset];
    if (preset){
      $('cfgSystemPrompt').value = preset;
      toast('已应用预设：' + btn.textContent.trim(), 'info', 1600);
    }
  });
});

$('btnResetPrompt').addEventListener('click', () => {
  $('cfgSystemPrompt').value = DEFAULT_PROMPT;
  toast('已恢复默认提示词', 'info', 1600);
});

$('btnExportPrompt').addEventListener('click', () => {
  downloadFile('helix-system-prompt.txt', $('cfgSystemPrompt').value);
});

$('btnTest').addEventListener('click', () => {
  toast('正在测试连接…', 'info', 1600);
  fetch('/api/health')
    .then(r => r.json())
    .then(j => {
      if (j && j.ok) toast('后端正常 · v' + (j.version || '?'), 'success');
      else toast('后端返回异常', 'error');
    })
    .catch(() => toast('无法连接到后端服务', 'error'));
});

$('btnResetAll').addEventListener('click', () => {
  if (!confirm('确定要重置全部本地数据吗？所有会话记录都会被删除，此操作不可撤销。')) return;
  try { localStorage.clear(); } catch(e){}
  location.reload();
});

/* ------------------------------------------------------------
   18. 权限模式
   ------------------------------------------------------------ */
function updateModeChip(){
  const mode = state.config.permissionMode || 'auto';
  el.modeLabel.textContent = MODE_META[mode] ? MODE_META[mode].label : mode;
  el.chipMode.className = 'chip mode-' + mode + ' mode-chip';
  el.chipMode.setAttribute('data-tip', '权限模式：' + (MODE_META[mode] ? MODE_META[mode].desc : mode) + '（点击切换）');
}

el.chipMode.addEventListener('click', () => {
  const order = ['ask', 'auto', 'work', 'agent'];
  const cur = state.config.permissionMode || 'auto';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  state.config.permissionMode = next;
  updateModeChip();
  fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionMode: next }) }).catch(() => {});
  toast('权限模式：' + next + ' · ' + MODE_META[next].desc, 'info', 2400);
});

/* ------------------------------------------------------------
   18.5 多 Profile 管理
   ------------------------------------------------------------ */
(function injectProfileStyle(){
  if (document.getElementById('helix-profile-style')) return;
  const s = document.createElement('style');
  s.id = 'helix-profile-style';
  s.textContent = [
    '.profile-menu{position:fixed;z-index:1300;min-width:250px;max-width:340px;background:var(--canvas-overlay,#161b22);border:1px solid var(--border-default,#30363d);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:6px;font-size:13px;animation:profileMenuIn .12s ease-out}',
    '@keyframes profileMenuIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}',
    '.profile-menu-head{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 8px;border-bottom:1px solid var(--border-muted,#21262d);margin-bottom:4px}',
    '.profile-menu-head span{font-size:11px;color:var(--fg-subtle,#8b949e);text-transform:uppercase;letter-spacing:.08em}',
    '.profile-menu-head button{background:none;border:none;color:var(--accent-fg,#58a6ff);cursor:pointer;font-size:11.5px;padding:3px 8px;border-radius:4px;transition:background .12s}',
    '.profile-menu-head button:hover{background:var(--canvas-subtle,#21262d)}',
    '.profile-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;color:var(--fg-default,#e6edf3);transition:background .12s}',
    '.profile-item:hover{background:var(--canvas-subtle,#21262d)}',
    '.profile-item.active{background:rgba(31,111,235,.14)}',
    '.profile-item .icon{width:14px;height:14px;color:var(--fg-muted,#8b949e);flex-shrink:0}',
    '.profile-item.active .icon{color:var(--accent-fg,#58a6ff)}',
    '.profile-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.profile-item-name{font-size:13px;font-weight:500;color:var(--fg-default,#e6edf3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.profile-item-model{font-family:var(--font-mono,monospace);font-size:11px;color:var(--fg-subtle,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.profile-empty{padding:16px 10px;text-align:center;color:var(--fg-subtle,#8b949e);font-size:12px}',
    '.profile-section{margin-bottom:14px;padding:10px;border:1px solid var(--border-default,#30363d);border-radius:8px;background:var(--canvas-subtle,#161b22)}',
    '.profile-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
    '.profile-section-title{font-size:12px;font-weight:600;color:var(--fg-default,#e6edf3);letter-spacing:.02em}',
    '.profile-list{display:flex;flex-direction:column;gap:6px}',
    '.profile-section-foot{margin-top:8px;display:flex;justify-content:flex-end}',
    '.profile-new{display:inline-flex;align-items:center;gap:5px;background:var(--canvas-default,#0d1117);border:1px dashed var(--border-default,#30363d);color:var(--accent-fg,#58a6ff);padding:5px 11px;border-radius:6px;cursor:pointer;font-size:12px;transition:border-color .15s,background .15s}',
    '.profile-new:hover{border-color:var(--accent-emphasis,#1f6feb);background:var(--canvas-subtle,#21262d)}',
    '.profile-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-muted,#21262d);border-radius:6px;background:var(--canvas-default,#0d1117);transition:border-color .15s,background .15s}',
    '.profile-row:hover{border-color:var(--border-default,#30363d)}',
    '.profile-row.active{border-color:var(--accent-emphasis,#1f6feb);background:rgba(31,111,235,.08)}',
    '.profile-row.editing{border-color:var(--attention-fg,#d29922);background:rgba(210,153,34,.08)}',
    '.profile-row .icon{width:14px;height:14px;color:var(--fg-muted,#8b949e);flex-shrink:0}',
    '.profile-row.active .icon{color:var(--accent-fg,#58a6ff)}',
    '.profile-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
    '.profile-row-name{font-size:12.5px;font-weight:500;color:var(--fg-default,#e6edf3);display:flex;align-items:center;gap:6px;overflow:hidden}',
    '.profile-row-name > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.profile-row-meta{font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--fg-subtle,#8b949e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.profile-row-badge{font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(31,111,235,.15);color:var(--accent-fg,#58a6ff);border:1px solid var(--accent-emphasis,#1f6feb);white-space:nowrap;flex-shrink:0;font-weight:500}',
    '.profile-row-badge.edit{background:rgba(210,153,34,.15);color:var(--attention-fg,#d29922);border-color:var(--attention-fg,#d29922)}',
    '.profile-row-btn{background:var(--canvas-default,#0d1117);border:1px solid var(--border-default,#30363d);color:var(--fg-default,#e6edf3);padding:3px 9px;border-radius:5px;cursor:pointer;font-size:11px;white-space:nowrap;transition:border-color .15s,color .15s,background .15s}',
    '.profile-row-btn:hover{border-color:var(--accent-emphasis,#1f6feb);color:var(--accent-fg,#58a6ff);background:var(--canvas-subtle,#21262d)}',
    '.profile-row-btn:disabled{opacity:.5;cursor:default}',
    '.profile-row-btn:disabled:hover{border-color:var(--border-default,#30363d);color:var(--fg-default,#e6edf3);background:var(--canvas-default,#0d1117)}',
    '.profile-row-btn.danger:hover{border-color:var(--danger-fg,#f85149);color:var(--danger-fg,#f85149)}',
    '.profile-row-btn.primary{border-color:var(--accent-emphasis,#1f6feb);color:var(--accent-fg,#58a6ff)}'
  ].join('\n');
  document.head.appendChild(s);
})();

let profileMenuEl = null;

function onDocClickForProfile(e){
  if (!profileMenuEl) return;
  if (profileMenuEl.contains(e.target)) return;
  if (el.chipModel.contains(e.target)) return;
  closeProfileMenu();
}

function closeProfileMenu(){
  if (profileMenuEl){
    profileMenuEl.remove();
    profileMenuEl = null;
    document.removeEventListener('mousedown', onDocClickForProfile, true);
    window.removeEventListener('resize', closeProfileMenu);
  }
}

function activateProfile(id){
  const p = (state.config.profiles || []).find(x => x.id === id);
  if (!p) return;

  state.config.activeProfileId = id;
  state.config.model = p.model || '';
  state.config.baseUrl = p.baseUrl || '';
  state.config.hasKey = !!p.hasKey;
  el.modelLabel.textContent = p.model || '未配置';

  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeProfileId: id }),
  }).catch(() => {});

  if (el.drawer && el.drawer.classList.contains('on')){
    editingProfileId = null;
    loadConfigToUI();
  }
}

function openProfileMenu(){
  closeProfileMenu();

  const profiles = state.config.profiles || [];
  if (!profiles.length){
    toast('暂无可用配置，请到设置中添加', 'info', 2200);
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'profile-menu';

  let html = '<div class="profile-menu-head">' +
    '<span>选择模型配置</span>' +
    '<button data-act="manage" type="button">管理</button>' +
  '</div>';

  profiles.forEach(p => {
    const isActive = p.id === state.config.activeProfileId;
    html += '<div class="profile-item' + (isActive ? ' active' : '') + '" data-pid="' + esc(p.id) + '">' +
      icon(isActive ? 'i-check' : 'i-chip') +
      '<div class="profile-item-main">' +
        '<span class="profile-item-name">' + esc(p.name || '未命名配置') + '</span>' +
        '<span class="profile-item-model">' + esc(p.model || '未设置模型') + '</span>' +
      '</div>' +
    '</div>';
  });

  menu.innerHTML = html;

  menu.querySelectorAll('.profile-item').forEach(node => {
    node.addEventListener('click', () => {
      const id = node.dataset.pid;
      const p = (state.config.profiles || []).find(x => x.id === id);
      activateProfile(id);
      closeProfileMenu();
      if (p) toast('已切换到：' + (p.name || '未命名配置'), 'success', 1600);
    });
  });

  const manageBtn = menu.querySelector('[data-act="manage"]');
  if (manageBtn){
    manageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeProfileMenu();
      openDrawer();
      setTimeout(() => {
        const tab = el.drawer.querySelector('[data-tab="model"]');
        if (tab) tab.click();
      }, 120);
    });
  }

  document.body.appendChild(menu);
  profileMenuEl = menu;

  const rect = el.chipModel.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
  const top = Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 8);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  setTimeout(() => {
    document.addEventListener('mousedown', onDocClickForProfile, true);
  }, 0);
  window.addEventListener('resize', closeProfileMenu);
}

el.chipModel.addEventListener('click', (e) => {
  e.stopPropagation();
  if (profileMenuEl) closeProfileMenu();
  else openProfileMenu();
});

function renderProfileManager(){
  const pane = el.drawer.querySelector('[data-pane="model"]');
  if (!pane) return;

  let section = pane.querySelector('.profile-section');
  if (!section){
    section = document.createElement('div');
    section.className = 'profile-section';
    if (pane.firstChild) pane.insertBefore(section, pane.firstChild);
    else pane.appendChild(section);
  }

  const profiles = state.config.profiles || [];
  const activeId = state.config.activeProfileId;

  let html = '<div class="profile-section-head">' +
    '<span class="profile-section-title">模型配置（' + profiles.length + '）</span>' +
  '</div>';

  if (!profiles.length){
    html += '<div class="profile-empty">暂无配置，点击下方「+ 新建配置」开始</div>';
  } else {
    html += '<div class="profile-list">';
    profiles.forEach(p => {
      const isActive = p.id === activeId;
      const isEditing = p.id === editingProfileId;
      const cls = 'profile-row' +
        (isActive ? ' active' : '') +
        (isEditing ? ' editing' : '');
      const metaParts = [];
      metaParts.push(p.model ? esc(p.model) : '未设置模型');
      if (p.baseUrl) metaParts.push(esc(p.baseUrl));
      html += '<div class="' + cls + '" data-pid="' + esc(p.id) + '">' +
        icon(isActive ? 'i-check' : 'i-chip') +
        '<div class="profile-row-main">' +
          '<span class="profile-row-name"><span>' + esc(p.name || '未命名配置') + '</span>' +
            (isActive ? '<span class="profile-row-badge">当前</span>' : '') +
            (isEditing ? '<span class="profile-row-badge edit">编辑中</span>' : '') +
          '</span>' +
          '<span class="profile-row-meta">' + metaParts.join(' · ') + '</span>' +
        '</div>' +
        '<button class="profile-row-btn" data-edit="' + esc(p.id) + '" type="button">编辑</button>' +
        '<button class="profile-row-btn primary" data-activate="' + esc(p.id) + '" type="button"' +
          (isActive ? ' disabled' : '') + '>' + (isActive ? '已激活' : '激活') + '</button>' +
        '<button class="profile-row-btn danger" data-del="' + esc(p.id) + '" type="button">删除</button>' +
      '</div>';
    });
    html += '</div>';
  }

  html += '<div class="profile-section-foot">' +
    '<button class="profile-new" data-act="new" type="button">' +
      icon('i-plus', 'icon-sm') + '新建配置' +
    '</button>' +
  '</div>';

  section.innerHTML = html;

  const newBtn = section.querySelector('[data-act="new"]');
  if (newBtn){
    newBtn.addEventListener('click', () => {
      if (!Array.isArray(state.config.profiles)) state.config.profiles = [];
      const id = 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const count = state.config.profiles.length + 1;
      state.config.profiles.push({
        id: id,
        name: '新配置 ' + count,
        hasKey: false,
        baseUrl: '',
        model: '',
      });
      editingProfileId = id;
      if ($('cfgModel')) $('cfgModel').value = '';
      if ($('cfgBaseUrl')) $('cfgBaseUrl').value = '';
      if ($('cfgApiKey')){
        $('cfgApiKey').value = '';
        $('cfgApiKey').placeholder = 'sk-...';
      }
      renderProfileManager();
      toast('已创建新配置，填写下方表单后点保存', 'info', 2200);
    });
  }

  section.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.edit;
      const p = (state.config.profiles || []).find(x => x.id === id);
      if (!p) return;
      editingProfileId = id;
      if ($('cfgModel')) $('cfgModel').value = p.model || '';
      if ($('cfgBaseUrl')) $('cfgBaseUrl').value = p.baseUrl || '';
      if ($('cfgApiKey')){
        $('cfgApiKey').value = '';
        $('cfgApiKey').placeholder = p.hasKey ? '已保存（留空则保持不变）' : 'sk-...';
      }
      renderProfileManager();
      if ($('cfgModel')){
        try { $('cfgModel').focus(); } catch(e){}
      }
    });
  });

  section.querySelectorAll('[data-activate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.activate;
      editingProfileId = null;
      activateProfile(id);
      toast('已激活配置', 'success', 1600);
    });
  });

  section.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del;
      const profiles = state.config.profiles || [];
      if (profiles.length <= 1){
        toast('至少保留一个配置', 'warn');
        return;
      }

      toast('o(^▽^)o 请点击确认', 'info', 2000);

      setTimeout(() => {
        if (!confirm('确定删除该配置？')) return;

        const idx = profiles.findIndex(x => x.id === id);
        if (idx === -1) return;
        const wasActive = state.config.activeProfileId === id;
        profiles.splice(idx, 1);

        if (wasActive){
          const next = profiles[0];
          if (next) activateProfile(next.id);
        }
        if (editingProfileId === id) editingProfileId = null;
        renderProfileManager();
        if (el.drawer.classList.contains('on')) loadConfigToUI();
        toast('已删除配置', 'info', 1600);
      }, 120);
    });
  });
}

/* ------------------------------------------------------------
   19. 余额
   ------------------------------------------------------------ */
function refreshBalance(){
  fetch('/api/balance')
    .then(r => r.json())
    .then(showBalance)
    .catch(() => { el.balanceLabel.textContent = '—'; });
}

function showBalance(data){
  if (!data || !data.supported || !data.balance){
    el.balanceLabel.textContent = '—';
    return;
  }
  const b = data.balance;
  const v = typeof b.total === 'number' ? b.total
          : typeof b.balance === 'number' ? b.balance
          : null;
  el.balanceLabel.textContent = v === null ? '—' : '¥' + v.toFixed(2);
}

el.chipBalance.addEventListener('click', refreshBalance);

/* ------------------------------------------------------------
   20. 审批弹窗
   ------------------------------------------------------------ */
let pendingApprovalId = null;

function showApproval(req){
  pendingApprovalId = req.requestId;
  el.approvalBody.innerHTML = '';
  el.approvalFoot.innerHTML = '';

  const isQuestion = req.kind === 'question';

  el.approvalIcon.className = 'modal-ico ' + (isQuestion ? 'info' : '');
  el.approvalIcon.innerHTML = icon(isQuestion ? 'i-question' : 'i-shield');
  el.approvalTitle.textContent = req.title || (isQuestion ? '需要你的输入' : '权限请求');
  el.approvalSub.textContent = req.tool ? 'tool: ' + req.tool : '';

  if (isQuestion){
    if (req.detail){
      const pre = document.createElement('pre');
      pre.textContent = req.detail;
      el.approvalBody.appendChild(pre);
    }
    const ta = document.createElement('textarea');
    ta.placeholder = '输入你的回答…';
    el.approvalBody.appendChild(ta);

    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = '取消';
    cancel.onclick = () => { respondApproval('deny'); closeApproval(); };

    const ok = document.createElement('button');
    ok.className = 'btn primary';
    ok.innerHTML = icon('i-check') + '提交回答';
    ok.onclick = () => { respondApproval('allow', ta.value); closeApproval(); };

    el.approvalFoot.appendChild(cancel);
    el.approvalFoot.appendChild(ok);
    setTimeout(() => ta.focus(), 60);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = req.detail || 'AI 想要执行以下操作，是否允许？';
    el.approvalBody.appendChild(pre);

    const deny = document.createElement('button');
    deny.className = 'btn danger';
    deny.innerHTML = icon('i-x') + '拒绝';
    deny.onclick = () => { respondApproval('deny'); closeApproval(); };

    const allow = document.createElement('button');
    allow.className = 'btn';
    allow.innerHTML = icon('i-check') + '本次允许';
    allow.onclick = () => { respondApproval('allow'); closeApproval(); };

    const always = document.createElement('button');
    always.className = 'btn primary';
    always.innerHTML = icon('i-shield') + '始终允许';
    always.onclick = () => {
      if (req.tool) state.allowed.add(req.tool);
      renderAllowList();
      respondApproval('allow_always');
      closeApproval();
    };

    el.approvalFoot.appendChild(deny);
    el.approvalFoot.appendChild(allow);
    el.approvalFoot.appendChild(always);
  }

  el.approvalModal.hidden = false;
}

function respondApproval(decision, answer){
  sendSocket({
    type: 'approval',
    requestId: pendingApprovalId,
    decision: decision,
    answer: answer,
  });
  pendingApprovalId = null;
}

function closeApproval(){
  el.approvalModal.hidden = true;
}

/* ------------------------------------------------------------
   21. 命令面板
   ------------------------------------------------------------ */
function buildCommands(){
  return [
    { group: '操作', ico: 'i-plus', title: '新建对话', desc: '开启一个全新的会话', kbd: ['Ctrl', 'N'], run: () => newSession() },
    { group: '操作', ico: 'i-settings', title: '打开设置', desc: '模型、权限、提示词', kbd: ['Ctrl', ','], run: openDrawer },
    { group: '操作', ico: 'i-sun', title: '切换主题', desc: '深色 / 浅色模式', kbd: ['Ctrl', 'J'], run: toggleTheme },
    { group: '操作', ico: 'i-panel', title: '切换预览面板', desc: '显示或隐藏右侧预览', kbd: ['Ctrl', '\\'], run: () => el.btnPreview.click() },
    { group: '操作', ico: 'i-search', title: '在当前对话中查找', desc: '高亮匹配的消息', kbd: ['Ctrl', 'F'], run: openFind },
    { group: '操作', ico: 'i-download', title: '导出全部会话', desc: '下载为 JSON 文件', run: exportAll },
    { group: '操作', ico: 'i-upload', title: '导入会话', desc: '从 JSON 文件恢复', run: () => el.importInput.click() },
    { group: '操作', ico: 'i-copy', title: '复制当前对话', desc: '以纯文本格式复制', run: copyConversation },
    { group: '操作', ico: 'i-file', title: '导出为 Markdown', desc: '当前会话转为 .md 文件', run: exportMarkdown },
    { group: '操作', ico: 'i-refresh', title: '重新生成上一条', desc: '重跑最后一次提问', run: regenerate },

    { group: '权限', ico: 'i-shield', title: '切换到 ask 模式', desc: '纯问答，禁用工具', run: () => setMode('ask') },
    { group: '权限', ico: 'i-shield', title: '切换到 auto 模式', desc: '只读放行，写操作确认', run: () => setMode('auto') },
    { group: '权限', ico: 'i-shield', title: '切换到 work 模式', desc: '所有工具调用都确认', run: () => setMode('work') },
    { group: '权限', ico: 'i-shield', title: '切换到 agent 模式', desc: '完全自主执行', run: () => setMode('agent') },

    { group: '危险', ico: 'i-trash', title: '清空当前对话', desc: '仅清除当前会话的消息', run: () => {
      if (!state.messages.length){ toast('当前对话已是空的', 'info'); return; }
      if (confirm('确定清空当前对话？')) {
        state.messages = [];
        state.nodes.clear();
        el.stream.innerHTML = '';
        renderEmptyState();
        persistSession();
      }
    }},
    { group: '危险', ico: 'i-alert', title: '清空全部会话', desc: '删除所有本地会话记录', run: () => {
      if (confirm('确定删除全部会话？此操作不可恢复。')){
        state.sessions = [];
        state.messages = [];
        state.nodes.clear();
        state.currentId = null;
        el.stream.innerHTML = '';
        renderEmptyState();
        saveStore();
        renderSessionList();
        toast('已清空全部会话', 'success');
      }
    }},
  ];
}

function setMode(mode){
  state.config.permissionMode = mode;
  updateModeChip();
  fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permissionMode: mode }) }).catch(() => {});
  toast('权限模式已切换为 ' + mode, 'success', 1800);
}

function copyConversation(){
  const text = state.messages.map(m => {
    const who = m.role === 'user' ? '你' : 'Helix';
    return who + '：\n' + (m.text || '');
  }).join('\n\n---\n\n');
  if (!text){ toast('当前对话为空', 'warn'); return; }
  copyText(text).then(() => toast('已复制当前对话', 'success'));
}

function exportMarkdown(){
  if (!state.messages.length){ toast('当前对话为空', 'warn'); return; }
  const cur = state.sessions.find(s => s.id === state.currentId);
  let md = '# ' + ((cur && cur.title) || 'Helix 对话') + '\n\n';
  md += '> 导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
  state.messages.forEach(m => {
    md += '## ' + (m.role === 'user' ? '你' : 'Helix') + '\n\n';
    if (m.reasoning) md += '<details><summary>思考过程</summary>\n\n' + m.reasoning + '\n\n</details>\n\n';
    if (m.tools && m.tools.length){
      m.tools.forEach(t => {
        md += '**工具 ' + t.name + '** (' + t.status + ')\n\n';
        if (t.args) md += '```json\n' + (typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2)) + '\n```\n\n';
        if (t.result) md += '```\n' + t.result + '\n```\n\n';
      });
    }
    md += (m.text || '') + '\n\n---\n\n';
  });
  downloadFile('helix-' + Date.now() + '.md', md, 'text/markdown;charset=utf-8');
  toast('已导出 Markdown', 'success');
}

function openCmdk(){
  el.cmdk.hidden = false;
  el.cmdkInput.value = '';
  state.cmdk.items = buildCommands().concat(
    state.sessions.slice(0, 8).map(s => ({
      group: '会话',
      ico: 'i-message',
      title: s.title || '新对话',
      desc: '切换到该会话 · ' + relativeTime(s.updatedAt || Date.now()),
      run: () => switchSession(s.id),
    }))
  );
  state.cmdk.index = 0;
  renderCmdk();
  setTimeout(() => el.cmdkInput.focus(), 40);
}

function closeCmdk(){
  el.cmdk.hidden = true;
}

function renderCmdk(){
  const q = el.cmdkInput.value.trim().toLowerCase();
  const items = q
    ? state.cmdk.items.filter(i =>
        i.title.toLowerCase().indexOf(q) !== -1 ||
        (i.desc || '').toLowerCase().indexOf(q) !== -1)
    : state.cmdk.items;

  if (!items.length){
    el.cmdkList.innerHTML = '<div class="cmdk-empty">没有找到匹配的命令</div>';
    return;
  }

  if (state.cmdk.index >= items.length) state.cmdk.index = 0;

  let html = '';
  let lastGroup = null;
  items.forEach((it, i) => {
    if (it.group !== lastGroup){
      html += '<div class="cmdk-group">' + esc(it.group || '命令') + '</div>';
      lastGroup = it.group;
    }
    html +=
      '<div class="cmdk-item' + (i === state.cmdk.index ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="cmdk-ico">' + icon(it.ico) + '</span>' +
        '<span class="cmdk-txt">' +
          '<span class="cmdk-t">' + esc(it.title) + '</span>' +
          (it.desc ? '<span class="cmdk-d">' + esc(it.desc) + '</span>' : '') +
        '</span>' +
        (it.kbd ? '<span class="cmdk-kbd">' + it.kbd.map(k => '<kbd>' + k + '</kbd>').join(' ') + '</span>' : '') +
      '</div>';
  });
  el.cmdkList.innerHTML = html;

  el.cmdkList.querySelectorAll('.cmdk-item').forEach(node => {
    node.addEventListener('click', () => runCmdkItem(items[+node.dataset.i]));
    node.addEventListener('mouseenter', () => {
      state.cmdk.index = +node.dataset.i;
      el.cmdkList.querySelectorAll('.cmdk-item').forEach(n => n.classList.remove('sel'));
      node.classList.add('sel');
    });
  });

  state.cmdk.current = items;
}

function runCmdkItem(item){
  if (!item) return;
  closeCmdk();
  try { item.run(); } catch(e){ toast('执行失败：' + e.message, 'error'); }
}

el.cmdkInput.addEventListener('input', () => {
  state.cmdk.index = 0;
  renderCmdk();
});
el.cmdkInput.addEventListener('keydown', e => {
  const items = state.cmdk.current || [];
  if (e.key === 'ArrowDown'){
    e.preventDefault();
    state.cmdk.index = (state.cmdk.index + 1) % Math.max(items.length, 1);
    renderCmdk();
    const sel = el.cmdkList.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp'){
    e.preventDefault();
    state.cmdk.index = (state.cmdk.index - 1 + items.length) % Math.max(items.length, 1);
    renderCmdk();
    const sel = el.cmdkList.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter'){
    e.preventDefault();
    runCmdkItem(items[state.cmdk.index]);
  } else if (e.key === 'Escape'){
    closeCmdk();
  }
});
el.cmdk.addEventListener('mousedown', e => {
  if (e.target === el.cmdk) closeCmdk();
});
el.btnCmd.addEventListener('click', openCmdk);

/* ------------------------------------------------------------
   22. 查找
   ------------------------------------------------------------ */
function openFind(){
  el.findBar.hidden = false;
  el.findInput.value = state.find.query || '';
  setTimeout(() => { el.findInput.focus(); el.findInput.select(); }, 40);
  runFind();
}
function closeFind(){
  el.findBar.hidden = true;
  clearFindHighlight();
}
function runFind(){
  const q = el.findInput.value.trim();
  state.find.query = q;
  clearFindHighlight();

  if (!q){
    state.find.matches = [];
    state.find.index = -1;
    el.findCount.textContent = '0 / 0';
    return;
  }

  const nodes = el.stream.querySelectorAll('.msg');
  const hits = [];
  nodes.forEach(n => {
    const body = n.querySelector('.msg-body');
    if (body && body.textContent.toLowerCase().indexOf(q.toLowerCase()) !== -1){
      hits.push(n);
    }
  });

  state.find.matches = hits;
  state.find.index = hits.length ? 0 : -1;
  updateFindCount();
  focusFindMatch();
}
function updateFindCount(){
  const total = state.find.matches.length;
  const cur = state.find.index >= 0 ? state.find.index + 1 : 0;
  el.findCount.textContent = cur + ' / ' + total;
}
function focusFindMatch(){
  state.find.matches.forEach(n => n.classList.remove('highlighted'));
  const node = state.find.matches[state.find.index];
  if (!node) return;
  node.classList.add('highlighted');
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearFindHighlight(){
  el.stream.querySelectorAll('.msg.highlighted').forEach(n => n.classList.remove('highlighted'));
}

el.findInput.addEventListener('input', runFind);
el.findNext.addEventListener('click', () => {
  if (!state.find.matches.length) return;
  state.find.index = (state.find.index + 1) % state.find.matches.length;
  updateFindCount();
  focusFindMatch();
});
el.findPrev.addEventListener('click', () => {
  if (!state.find.matches.length) return;
  state.find.index = (state.find.index - 1 + state.find.matches.length) % state.find.matches.length;
  updateFindCount();
  focusFindMatch();
});
el.findClose.addEventListener('click', closeFind);
el.findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter'){
    e.preventDefault();
    if (e.shiftKey) el.findPrev.click();
    else el.findNext.click();
  } else if (e.key === 'Escape'){
    closeFind();
  }
});
el.btnFind.addEventListener('click', openFind);

/* ------------------------------------------------------------
   23. 导入导出
   ------------------------------------------------------------ */
function exportAll(){
  persistSession();
  const payload = {
    app: 'helix',
    version: '0.5.0',
    exportedAt: new Date().toISOString(),
    sessions: state.sessions,
  };
  downloadFile('helix-sessions-' + Date.now() + '.json',
    JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('已导出 ' + state.sessions.length + ' 个会话', 'success');
}

el.btnExport.addEventListener('click', exportAll);
el.btnImport.addEventListener('click', () => el.importInput.click());

el.importInput.addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.sessions;
    if (!Array.isArray(incoming)) throw new Error('格式不正确');

    const existing = new Set(state.sessions.map(s => s.id));
    let added = 0;
    incoming.forEach(s => {
      if (s && s.id && !existing.has(s.id) && Array.isArray(s.messages)){
        state.sessions.push(s);
        added++;
      }
    });
    state.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    saveStore();
    renderSessionList();
    toast(added ? '已导入 ' + added + ' 个会话' : '没有新的会话可导入',
      added ? 'success' : 'info');
  } catch(err){
    toast('导入失败：' + err.message, 'error');
  }
  e.target.value = '';
});

el.btnWipe.addEventListener('click', () => {
  if (!confirm('确定删除全部会话吗？此操作不可恢复。')) return;
  state.sessions = [];
  state.messages = [];
  state.nodes.clear();
  state.currentId = null;
  el.stream.innerHTML = '';
  renderEmptyState();
  saveStore();
  renderSessionList();
  toast('已清空全部会话', 'success');
});

el.sessionFilter.addEventListener('input', debounce(renderSessionList, 120));

/* ------------------------------------------------------------
   24. 右键菜单
   ------------------------------------------------------------ */
function showCtx(x, y, items){
  el.ctxMenu.innerHTML = items.map((it, i) =>
    it === '-'
      ? '<div class="ctx-sep"></div>'
      : '<div class="ctx-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
          icon(it.ico || 'i-more') + '<span>' + esc(it.label) + '</span>' +
        '</div>'
  ).join('');

  el.ctxMenu.hidden = false;
  const rect = el.ctxMenu.getBoundingClientRect();
  el.ctxMenu.style.left = Math.min(x, window.innerWidth - rect.width - 12) + 'px';
  el.ctxMenu.style.top = Math.min(y, window.innerHeight - rect.height - 12) + 'px';

  el.ctxMenu.querySelectorAll('.ctx-item').forEach(node => {
    node.addEventListener('click', () => {
      const it = items[+node.dataset.i];
      hideCtx();
      if (it && it.run) it.run();
    });
  });
}
function hideCtx(){ el.ctxMenu.hidden = true; }

document.addEventListener('click', e => {
  if (!el.ctxMenu.hidden && !el.ctxMenu.contains(e.target)) hideCtx();
});

document.addEventListener('contextmenu', e => {
  const msgNode = e.target.closest('.msg');
  if (!msgNode) return;
  e.preventDefault();
  const msg = state.messages.find(m => m.id === msgNode.dataset.id);
  if (!msg) return;

  const items = [
    { ico: 'i-copy', label: '复制内容', run: () => copyText(msg.text).then(() => toast('已复制', 'success', 1400)) },
    { ico: 'i-volume', label: '朗读', run: () => speak(msg.text) },
  ];
  if (msg.role === 'assistant'){
    items.push({ ico: 'i-refresh', label: '重新生成', run: regenerate });
  } else {
    items.push({ ico: 'i-edit', label: '编辑并重发', run: () => {
      el.promptInput.value = msg.text;
      el.promptInput.focus();
      autoResize();
    }});
  }
  items.push('-');
  items.push({ ico: 'i-trash', label: '删除这条消息', danger: true, run: () => removeMessage(msg.id) });

  showCtx(e.clientX, e.clientY, items);
});

/* ------------------------------------------------------------
   25. 快捷键
   ------------------------------------------------------------ */
function renderShortcuts(){
  el.kbdList.innerHTML = SHORTCUTS.map(([label, keys]) =>
    '<div class="kbd-row">' +
      '<span>' + esc(label) + '</span>' +
      '<span class="kbd-combo">' + keys.map(k => '<kbd>' + k + '</kbd>').join('') + '</span>' +
    '</div>'
  ).join('');
}

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

  if (e.key === 'Escape'){
    if (document.getElementById('helixUnsavedDialog')){ hideUnsavedDialog(); return; }
    if (profileMenuEl){ closeProfileMenu(); return; }
    if (!el.cmdk.hidden){ closeCmdk(); return; }
    if (!el.approvalModal.hidden){ return; }
    if (!el.findBar.hidden){ closeFind(); return; }
    if (el.drawer.classList.contains('on')){ closeDrawer(); return; }
    if (el.sidebar.classList.contains('open')){ closeSidebar(); return; }
    if (!el.ctxMenu.hidden){ hideCtx(); return; }
    return;
  }

  if (!mod) return;

  const k = e.key.toLowerCase();

  if (k === 'k' && !e.shiftKey){ e.preventDefault(); openCmdk(); return; }
  if (k === 'k' && e.shiftKey){
    e.preventDefault();
    if (confirm('清空当前对话？')){
      state.messages = [];
      state.nodes.clear();
      el.stream.innerHTML = '';
      renderEmptyState();
      persistSession();
    }
    return;
  }
  if (k === 'b'){ e.preventDefault(); toggleSidebar(); return; }
  if (k === 'f'){ e.preventDefault(); openFind(); return; }
  if (e.key === '\\'){ e.preventDefault(); el.btnPreview.click(); return; }
  if (k === ','){ e.preventDefault(); openDrawer(); return; }
  if (k === 'j'){ e.preventDefault(); toggleTheme(); return; }
  if (k === 'n'){ e.preventDefault(); newSession(); return; }
  if (k === 'l' && !inInput){ e.preventDefault(); el.promptInput.focus(); return; }
});

/* ------------------------------------------------------------
   26. 品牌按钮 / 主题
   ------------------------------------------------------------ */
el.brandBtn.addEventListener('click', () => {
  if (state.messages.length){
    if (!confirm('返回欢迎页会保留当前会话，继续吗？')) return;
  }
  newSession(true);
});
el.brandBtn.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' '){
    e.preventDefault();
    el.brandBtn.click();
  }
});

el.btnTheme.addEventListener('click', toggleTheme);

/* ------------------------------------------------------------
   27. Token 估算
   ------------------------------------------------------------ */
setInterval(() => {
  const chars = state.messages.reduce((sum, m) =>
    sum + (m.text ? m.text.length : 0) + (m.reasoning ? m.reasoning.length : 0), 0);
  const approx = Math.ceil(chars / 2.6);
  el.tokenCount.textContent = approx
    ? '≈ ' + approx.toLocaleString('zh-CN') + ' tokens'
    : '';
}, 2000);

/* ------------------------------------------------------------
   28. 系统主题跟随
   ------------------------------------------------------------ */
(function watchSystemTheme(){
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = ev => {
    let hasUserChoice = false;
    try { hasUserChoice = !!localStorage.getItem(KEY.theme); } catch(e){}
    if (!hasUserChoice){
      applyTheme(ev.matches ? 'light' : 'dark');
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
})();

/* ------------------------------------------------------------
   29. 窗口尺寸变化
   ------------------------------------------------------------ */
window.addEventListener('resize', debounce(() => {
  if (window.innerWidth > 900){
    el.sidebar.classList.remove('open');
    if (!state.previewOpen) closeScrim();
    else if (!el.drawer.classList.contains('on')) closeScrim();
  } else {
    if (state.previewOpen) openScrim();
  }
}, 150));

/* ------------------------------------------------------------
   30. WebSocket
   ------------------------------------------------------------ */
function connect(){
  if (state.socket && (state.socket.readyState === WebSocket.OPEN ||
                       state.socket.readyState === WebSocket.CONNECTING)) return;

  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (!location.host || location.protocol === 'file:'){
    enterOfflineMode('本地文件模式');
    return;
  }

  setConn('pending', '连接中');

  let socket;
  try {
    socket = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(token));
  } catch (e){
    enterOfflineMode('无法建立连接');
    return;
  }
  state.socket = socket;

  socket.addEventListener('open', () => {
    state.connected = true;
    state.offline = false;
    state.reconnectAttempts = 0;
    setConn('ok', '已连接');
  });

  socket.addEventListener('close', ev => {
    state.connected = false;
    if (ev.code === 4001 || ev.code === 4003){
      setConn('err', '未授权');
      return;
    }
    setConn('err', '已断开');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    if (!state.connected) enterOfflineMode('连接失败');
  });

  socket.addEventListener('message', ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch(e){ return; }
    handleServerMessage(msg);
  });
}

function scheduleReconnect(){
  if (state.offline) return;
  clearTimeout(state.reconnectTimer);
  const delay = Math.min(1500 * Math.pow(1.6, state.reconnectAttempts++), 20000);
  state.reconnectTimer = setTimeout(() => {
    if (!state.connected && !state.offline) connect();
  }, delay);
}

function enterOfflineMode(reason){
  if (state.offline) return;
  state.offline = true;
  state.connected = false;
  setConn('pending', '离线演示');
  toast(reason + '，已切换为离线演示模式', 'warn', 3600);
}

function setConn(cls, text){
  el.connPill.className = 'conn-pill ' + cls;
  el.connLabel.textContent = text;
}

function sendSocket(payload){
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  state.socket.send(JSON.stringify(payload));
  return true;
}

function handleServerMessage(m){
  switch (m.type){
    case 'ready':
      if (m.model) { state.config.model = m.model; el.modelLabel.textContent = m.model; }
      if (m.workspace) state.config.workspace = m.workspace;
      if (typeof m.useAiTitle === 'boolean') state.config.useAiTitle = m.useAiTitle;

      if (m.activeProfileId) state.config.activeProfileId = m.activeProfileId;
      if (Array.isArray(m.profiles)) state.config.profiles = m.profiles;
      if (state.config.profiles && state.config.profiles.length){
        let active = state.config.profiles.find(x => x.id === state.config.activeProfileId);
        if (!active) active = state.config.profiles[0];
        if (!state.config.activeProfileId) state.config.activeProfileId = active.id;
        if (active){
          state.config.model = active.model || state.config.model;
          state.config.baseUrl = active.baseUrl || state.config.baseUrl;
          state.config.hasKey = !!active.hasKey;
          el.modelLabel.textContent = state.config.model || '未配置';
        }
      }

      state.config.terminalSkin = detectTerminalSkin(m.platform, m.osRelease);
      reapplyTerminalSkin();
      break;
    case 'assistant_delta':
      appendDelta(m.text);
      break;
    case 'reasoning_delta':
      appendReasoning(m.text);
      break;
    case 'tool_start':
      onToolStart(m);
      break;
    case 'tool_end':
      onToolEnd(m);
      break;
    case 'approval_request':
      showApproval(m);
      break;
    case 'preview':
      showPreview(m.html);
      break;
    case 'balance':
      showBalance(m);
      break;
    case 'done':
      finishStream();
      break;
    case 'title_update':
      updateSessionTitle(m.sessionId, m.title);
      break;
    case 'terminal_output':
      onTerminalOutput(m);
      break;
    case 'error':
      onStreamError(m.message || '发生未知错误');
      break;
  }
}

/* ------------------------------------------------------------
   31. 语音
   ------------------------------------------------------------ */
let speakingUtterance = null;

function speak(text){
  if (!('speechSynthesis' in window)){
    toast('当前浏览器不支持语音朗读', 'warn');
    return;
  }
  const synth = window.speechSynthesis;
  if (synth.speaking){
    synth.cancel();
    return;
  }
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~\-]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;

  const u = new SpeechSynthesisUtterance(clean.slice(0, 4000));
  u.lang = 'zh-CN';
  u.rate = 1.05;
  u.pitch = 1;
  u.onend = () => { speakingUtterance = null; };
  u.onerror = () => { speakingUtterance = null; };
  speakingUtterance = u;
  synth.speak(u);
}

/* ------------------------------------------------------------
   32. 消息操作 / 空状态
   ------------------------------------------------------------ */
function bindMessageActions(node){
  node.querySelectorAll('[data-act]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, btn.dataset.id));
  });
}

function bindCodeCopy(root){
  root.querySelectorAll('[data-copy]').forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const pre = btn.closest('.code-block').querySelector('pre code');
      if (!pre) return;
      copyText(pre.textContent);
      const old = btn.innerHTML;
      btn.innerHTML = icon('i-check', 'icon-sm') + '已复制';
      setTimeout(() => { btn.innerHTML = old; }, 1400);
    });
  });
}

function bindToolToggle(root){
  root.querySelectorAll('.tool-head').forEach(head => {
    if (head.dataset.bound) return;
    head.dataset.bound = '1';
    head.addEventListener('click', () => {
      head.closest('.tool-card').classList.toggle('collapsed');
    });
  });
}

function bindReasoningToggle(root){
  root.querySelectorAll('.reasoning-head').forEach(head => {
    if (head.dataset.bound) return;
    head.dataset.bound = '1';
    head.addEventListener('click', () => {
      head.closest('.reasoning').classList.toggle('collapsed');
    });
  });
}

function handleMessageAction(action, id){
  const msg = state.messages.find(m => m.id === id);
  if (!msg) return;

  switch (action){
    case 'copy':
      copyText(msg.text).then(() => toast('已复制到剪贴板', 'success', 1500));
      break;
    case 'speak':
      speak(msg.text);
      break;
    case 'regen':
      regenerate();
      break;
    case 'edit':
      el.promptInput.value = msg.text;
      el.promptInput.focus();
      autoResize();
      break;
    case 'retry':
      resend(msg);
      break;
    case 'del':
      removeMessage(id);
      break;
  }
}

function removeMessage(id){
  const idx = state.messages.findIndex(m => m.id === id);
  if (idx === -1) return;
  state.messages.splice(idx, 1);
  const node = state.nodes.get(id);
  if (node) node.remove();
  state.nodes.delete(id);
  persistSession();
  if (!state.messages.length) renderEmptyState();
  toast('已删除消息', 'info', 1500);
}

const SUGGESTIONS = [
  { ico: 'i-folder', t: '浏览当前目录', d: '看看工作目录里有哪些文件', q: '帮我列出当前工作目录下的文件结构' },
  { ico: 'i-code', t: '写一段快速排序', d: 'Python 实现，带中文注释', q: '用 Python 写一个快速排序，加上详细的中文注释' },
  { ico: 'i-terminal', t: '检查环境版本', d: '执行命令查看 Node 版本', q: '执行命令看一下当前环境里的 Node 和 npm 版本' },
  { ico: 'i-sparkle', t: '画个预览图', d: '在预览面板渲染 HTML', q: '在预览面板渲染一个居中的渐变圆形，带轻微呼吸动画' },
  { ico: 'i-book', t: '读一下 README', d: '总结项目在做什么', q: '读一下 README.md，用三句话总结这个项目' },
  { ico: 'i-globe', t: '查最新版本', d: '搜索某个工具的最新版', q: '搜索一下 Vite 当前最新的稳定版本号' },
  { ico: 'i-branch', t: '解释这段代码', d: '逐行说明它在做什么', q: '我贴一段代码给你，帮我逐行解释它在做什么，说人话' },
  { ico: 'i-shield', t: '审查安全风险', d: '检查依赖与配置', q: '帮我检查这个项目的依赖里有没有已知的安全风险' },
];

function renderEmptyState(){
  el.stream.innerHTML =
    '<div class="empty">' +
      '<svg class="empty-mark" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<linearGradient id="emA" x1="18" y1="6" x2="46" y2="58" gradientUnits="userSpaceOnUse">' +
            '<stop stop-color="#1f6feb"/><stop offset="1" stop-color="#a371f7"/>' +
          '</linearGradient>' +
          '<linearGradient id="emB" x1="46" y1="6" x2="18" y2="58" gradientUnits="userSpaceOnUse">' +
            '<stop stop-color="#58a6ff"/><stop offset="1" stop-color="#d2a8ff"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<path d="M32 7C18.5 7 18.5 24 32 24s13.5 17 0 17-13.5 17 0 17" ' +
          'stroke="url(#emA)" stroke-width="6.2" stroke-linecap="round" opacity=".5"/>' +
        '<path d="M32 7c13.5 0 13.5 17 0 17S18.5 41 32 41s13.5 17 0 17" ' +
          'stroke="url(#emB)" stroke-width="6.2" stroke-linecap="round"/>' +
      '</svg>' +
      '<h1>今天想让 Helix 做什么？</h1>' +
      '<p>本地优先的 AI Agent 工作台 · 会话数据只存在你的浏览器里</p>' +
      '<div class="empty-tags">' +
        '<span class="empty-tag">文件读写</span>' +
        '<span class="empty-tag">命令执行</span>' +
        '<span class="empty-tag">网页搜索</span>' +
        '<span class="empty-tag">HTML 预览</span>' +
        '<span class="empty-tag">多轮推理</span>' +
      '</div>' +
      '<div class="suggest-grid">' +
        SUGGESTIONS.map(s =>
          '<button class="suggest" data-q="' + esc(s.q) + '">' +
            '<span class="suggest-ico">' + icon(s.ico) + '</span>' +
            '<span class="suggest-txt">' +
              '<span class="suggest-t">' + esc(s.t) + '</span>' +
              '<span class="suggest-d">' + esc(s.d) + '</span>' +
            '</span>' +
          '</button>'
        ).join('') +
      '</div>' +
    '</div>';

  el.stream.querySelectorAll('.suggest').forEach(btn => {
    btn.addEventListener('click', () => {
      el.promptInput.value = btn.dataset.q;
      el.promptInput.focus();
      autoResize();
    });
  });
}

function clearEmptyState(){
  const node = el.stream.querySelector('.empty');
  if (node) node.remove();
}

/* ------------------------------------------------------------
   33. 启动
   ------------------------------------------------------------ */
function boot(){
  let theme;
  try { theme = localStorage.getItem(KEY.theme); } catch(e){}
  if (!theme){
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light' : 'dark';
  }
  applyTheme(theme);

  loadStore();
  applyUISettings();

  if (state.currentId){
    const s = state.sessions.find(x => x.id === state.currentId);
    if (s){
      state.messages = (s.messages || []).map(m => ({
        id: m.id || uid('m'),
        role: m.role,
        text: m.text || '',
        reasoning: m.reasoning || '',
        tools: m.tools || [],
        ts: m.ts || Date.now(),
        streaming: false,
        clientMsgId: m.clientMsgId,
      }));
    }
  }

  renderSessionList();

  if (state.messages.length) renderMessages();
  else renderEmptyState();

  renderShortcuts();
  renderAttachments();
  updateModeChip();
  updateSendButton();
  autoResize();

  el.modelLabel.textContent = state.config.model || '未配置';

  injectInlineTermStyle();

  fetch('/api/config').then(r => r.json()).then(cfg => {
    if (cfg && typeof cfg === 'object') {
      Object.assign(state.config, cfg);
      if (state.config.model) el.modelLabel.textContent = state.config.model;
      ensureAiTitleOption();
      const aiTitleEl = $('cfgUseAiTitle');
      if (aiTitleEl) aiTitleEl.checked = state.config.useAiTitle || false;
    }
  }).catch(() => {});

  connect();
  refreshBalance();

  restorePendingTask();

  if (window.innerWidth <= 900){
    el.sidebar.classList.add('collapsed');
  }

  setTimeout(() => {
    if (!state.connected && !state.offline) connect();
  }, 1500);
}

window.Helix = {
  state: state,
  toast: toast,
  newSession: newSession,
  exportAll: exportAll,
  openCmdk: openCmdk,
  openProfileMenu: openProfileMenu,
  activateProfile: activateProfile,
  findToolByCallId: findToolByCallId,
  detectTerminalSkin: detectTerminalSkin,
};

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();