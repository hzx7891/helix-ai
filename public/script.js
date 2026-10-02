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
   Helix · 前端主逻辑 v0.4
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
   ------------------------------------------------------------
   根据工具名称自动匹配不同的 SVG 图标，不再全部显示扳手。
   匹配规则：先找完全匹配，再找包含匹配（比如 web_search_v2 也能匹配到 web_search）。
   ------------------------------------------------------------ */
const TOOL_ICON_MAP = {
  // 联网 / 搜索
  web_search: 'i-globe',
  search: 'i-globe',
  browse: 'i-globe',
  google: 'i-globe',
  baidu: 'i-globe',
  fetch_url: 'i-link',
  curl: 'i-link',
  wget: 'i-link',
  http_request: 'i-link',

  // 终端 / 命令
  run_command: 'i-terminal',
  shell: 'i-terminal',
  exec: 'i-terminal',
  terminal: 'i-terminal',
  bash: 'i-terminal',
  powershell: 'i-terminal',

  // 读取 / 查看
  read_file: 'i-eye',
  cat: 'i-eye',
  view: 'i-eye',
  open_file: 'i-eye',
  list_dir: 'i-folder',
  ls: 'i-folder',
  dir: 'i-folder',
  find_files: 'i-folder',

  // 写入 / 编辑
  write_file: 'i-edit',
  edit_file: 'i-edit',
  create_file: 'i-edit',
  append_file: 'i-edit',

  // 其他
  spawn_agent: 'i-bot',
  think: 'i-chip',
  memory: 'i-book',
};

function getToolIcon(name){
  if (!name) return 'i-wrench';
  const l = String(name).toLowerCase();
  // 1. 完全匹配
  if (TOOL_ICON_MAP[l]) return TOOL_ICON_MAP[l];
  // 2. 包含匹配（按 key 长度倒序，优先匹配更长的关键词）
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
  success: 'i-check',
  error: 'i-alert',
  warn: 'i-alert',
  info: 'i-info',
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

function persistSession(){
  if (!state.messages.length) return;

  let s = state.sessions.find(x => x.id === state.currentId);
  if (!s){
    s = {
      id: state.currentId || uid('sess'),
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

  const firstUser = state.messages.find(m => m.role === 'user');
  if (firstUser) s.title = firstUser.text.replace(/\s+/g, ' ').trim().slice(0, 40) || '新对话';

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
    id: uid('sess'),
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
    msg.tools.forEach(t => { html += renderToolCard(t); });
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

  bindMessageActions(node);
  bindCodeCopy(node);
  bindToolToggle(node);
  bindReasoningToggle(node);
  bindMsgFileToggles(node);
}

/* ==== 用户消息里的文件卡片（仅显示层，发送内容不变） ==== */

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

  /* 先抽 === 文件 xxx ===\n...\n=== 文件结束 === */
  body = body.replace(
    /=== 文件 ([^\n]+?) ===\n([\s\S]*?)\n=== 文件结束 ===/g,
    function(_, name, content){
      files.push({ name: name.trim(), size: null, content: content });
      return "";
    }
  );

  /* 再抽 [附件] name (size) */
  body = body.replace(
    /\[附件\] ([^\n]+?)\s*\(([^)]+)\)/g,
    function(_, name, size){
      files.push({ name: name.trim(), size: size.trim(), content: null });
      return "";
    }
  );

  /* 清理多余空行 */
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
/* ==== 用户消息文件卡片结束 ==== */

function renderToolCard(tool){
  const map = { running: '执行中', ok: '已完成', fail: '失败' };
  const spin = tool.status === 'running' ? '<span class="spinner"></span>' : '';
  const args = tool.args
    ? (typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2))
    : '';
  const result = tool.result || '';
  
  // ★ 使用 getToolIcon 根据工具名动态获取图标
  const toolIcon = getToolIcon(tool.name);

  return '<div class="tool-card collapsed" data-call="' + esc(tool.callId || '') + '">' +
    '<div class="tool-head">' +
      '<span class="tool-ico">' + icon(toolIcon) + '</span>' +
      '<span class="tool-name">' + esc(tool.name || 'tool') + '</span>' +
      icon('i-chev-down', 'tool-caret') +
      '<span class="tool-status ' + tool.status + '">' + spin + (map[tool.status] || '') + '</span>' +
    '</div>' +
    (args ?
      '<div class="tool-section"><span class="label">参数</span>' + esc(args) + '</div>' : '') +
    (result ?
      '<div class="tool-section result"><span class="label">结果</span>' + esc(result) + '</div>' : '') +
  '</div>';
}

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

/* ------------------------------------------------------------
   10. 空状态
   ------------------------------------------------------------ */
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
      '<h1>今天想让 Helix 做什么？' +
        '<span id="markDone" style="display:inline-block;width:0;height:0;overflow:hidden">' +
          '<!-- I can help with that -->' +
        '</span>' +
      '</h1>' +
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
   11. 语音
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
   12. WebSocket
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
    case 'error':
      onStreamError(m.message || '发生未知错误');
      break;
  }
}

/* ------------------------------------------------------------
   13. 流式消息
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
   14. 发送 / 中止 / 重生成
   ------------------------------------------------------------ */
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
  const ok = sendSocket({ type: 'user_message', text: lastUser.text, clientMsgId: clientMsgId });
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
  const ok = sendSocket({ type: 'user_message', text: msg.text, clientMsgId: clientMsgId });
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
   14.5 未完成任务恢复
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
  } catch(e){
  }
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
   15. 离线演示
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
      args: JSON.stringify({ cmd: 'node -v && npm -v', cwd: state.config.workspace || '~' }, null, 2),
      status: 'running',
      result: '',
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
    let ti = 0;
    const tool = tools[0];
    assistant.tools.push(tool);
    paintMessage(assistant);
    autoFollow();

    setTimeout(() => {
      if (state.abortFlag) return;
      tool.status = 'ok';
      tool.result = looksLikeHtml
        ? '已渲染 1280×720 预览画布'
        : '命令已排队等待授权';
      paintMessage(assistant);
      if (preview) showPreview(preview);
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
   16. 输入框
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

/* ------------------------------------------------------------
   附件读取 —— 文本文件自动读取内容
   ------------------------------------------------------------ */
const TEXT_EXT = ['txt','md','markdown','json','js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','java','c','h','cpp','hpp','cs','php','swift','kt','html','htm','css','scss','sass','less','xml','yaml','yml','toml','ini','conf','env','csv','tsv','log','sh','bash','zsh','fish','bat','ps1','sql','vue','svg'];

function isTextFile(name, type){
  if (type && /^text\//i.test(type)) return true;
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!m) return false;
  return TEXT_EXT.indexOf(m[1]) !== -1;
}

const ATTACH_MAX_READ = 200 * 1024;   /* 超过 200KB 不读 */
const ATTACH_MAX_KEEP = 50 * 1024;    /* 内容超过 50KB 截断 */

async function buildAttachment(file){
  const a = {
    name: file.name,
    size: file.size > 1048576
      ? (file.size / 1048576).toFixed(1) + ' MB'
      : (file.size / 1024).toFixed(1) + ' KB',
    sizeRaw: file.size,
  };

  /* 非文本文件：不读内容 */
  if (!isTextFile(file.name, file.type)) return a;

  /* 文件过大：不读，改名字 */
  if (file.size > ATTACH_MAX_READ){
    a.name = a.name + '（文件过大，未读取）';
    return a;
  }

  /* 读取内容 */
  try {
    let content = await file.text();
    if (content.length > ATTACH_MAX_KEEP){
      content = content.slice(0, ATTACH_MAX_KEEP) +
        '\n\n[内容已截断，原文件 ' + file.size + ' 字节]';
      a.truncated = true;
    }
    a.content = content;
  } catch(e){ /* 读取失败就当普通附件 */ }

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
   17. 滚动跟随
   ------------------------------------------------------------ */
let unreadCount = 0;

function nearBottom(){
  const s = el.chatScroll;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 180;
}

function autoFollow(){
  if (!state.ui.autoScroll) return;
  if (nearBottom()){
    requestAnimationFrame(() => { el.chatScroll.scrollTop = el.chatScroll.scrollHeight; });
  } else {
    unreadCount++;
    el.jumpBadge.textContent = String(unreadCount);
    el.jumpBadge.hidden = false;
    el.jumpBtn.hidden = false;
  }
}

function scrollToBottom(smooth){
  el.chatScroll.scrollTo({
    top: el.chatScroll.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
  unreadCount = 0;
  el.jumpBadge.hidden = true;
  el.jumpBtn.hidden = true;
}

el.chatScroll.addEventListener('scroll', () => {
  if (nearBottom()){
    el.jumpBtn.hidden = true;
    unreadCount = 0;
    el.jumpBadge.hidden = true;
  } else {
    el.jumpBtn.hidden = false;
  }
}, { passive: true });

el.jumpBtn.addEventListener('click', () => scrollToBottom(true));

/* ------------------------------------------------------------
   18. 预览面板
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
   19. 侧栏 / 遮罩
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
   20. 设置抽屉
   ------------------------------------------------------------ */
function openDrawer(){
  el.drawer.classList.add('on');
  openScrim();
  loadConfigToUI();
}
function closeDrawer(){
  el.drawer.classList.remove('on');
  if (!el.sidebar.classList.contains('open') &&
      !(state.previewOpen && window.innerWidth <= 900)) closeScrim();
}

el.btnSettings.addEventListener('click', openDrawer);
el.drawerClose.addEventListener('click', closeDrawer);
el.drawerCancel.addEventListener('click', closeDrawer);

el.drawer.querySelectorAll('.dtab').forEach(tab => {
  tab.addEventListener('click', () => {
    el.drawer.querySelectorAll('.dtab').forEach(t => t.classList.remove('on'));
    el.drawer.querySelectorAll('.dpane').forEach(p => p.classList.remove('on'));
    tab.classList.add('on');
    const pane = el.drawer.querySelector('[data-pane="' + tab.dataset.tab + '"]');
    if (pane) pane.classList.add('on');
  });
});

function loadConfigToUI(){
  const c = state.config;
  $('cfgWorkspace').value = c.workspace || '';
  $('cfgBaseUrl').value = c.baseUrl || '';
  $('cfgModel').value = c.model || '';
  $('cfgSystemPrompt').value = c.systemPrompt || DEFAULT_PROMPT;
  $('cfgTemperature').value = c.temperature;
  $('cfgMaxTokens').value = c.maxTokens;
  $('cfgCmdTimeout').value = c.cmdTimeout;

  const apiKey = $('cfgApiKey');
  apiKey.value = '';
  apiKey.placeholder = c.hasKey ? '已保存（留空则保持不变）' : 'sk-...';

  document.querySelectorAll('input[name="permMode"]').forEach(r => {
    r.checked = r.value === (c.permissionMode || 'auto');
  });

  $('cfgLang').value = state.ui.lang;
  $('cfgFontSize').value = String(state.ui.fontSize);
  $('cfgAutoScroll').checked = state.ui.autoScroll;
  $('cfgAnimations').checked = state.ui.animations;
  $('cfgAutoPreview').checked = state.ui.autoPreview;

  renderAllowList();
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
  const payload = {
    workspace: $('cfgWorkspace').value.trim(),
    baseUrl: $('cfgBaseUrl').value.trim(),
    model: $('cfgModel').value.trim(),
    systemPrompt: $('cfgSystemPrompt').value,
    temperature: parseFloat($('cfgTemperature').value) || 0.7,
    maxTokens: parseInt($('cfgMaxTokens').value, 10) || 4096,
    cmdTimeout: parseInt($('cfgCmdTimeout').value, 10) || 30,
    permissionMode: (document.querySelector('input[name="permMode"]:checked') || {}).value || 'auto',
  };

  const apiKey = $('cfgApiKey').value.trim();
  if (apiKey) payload.apiKey = apiKey;

  Object.assign(state.config, payload);
  state.config.hasKey = state.config.hasKey || !!apiKey;

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
      state.config.hasKey = !!cfg.hasKey;
    }
    toast('设置已保存', 'success');
  })
  .catch(() => {
    toast('设置已保存在本地（后端未响应）', 'warn', 3000);
  });

  $('cfgApiKey').value = '';
  $('cfgApiKey').placeholder = state.config.hasKey ? '已保存（留空则保持不变）' : 'sk-...';
  closeDrawer();
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
   21. 权限模式
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

el.chipModel.addEventListener('click', () => {
  openDrawer();
  setTimeout(() => {
    el.drawer.querySelector('[data-tab="model"]').click();
  }, 120);
});

/* ------------------------------------------------------------
   22. 余额
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
   23. 审批弹窗
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
   24. 命令面板
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
   25. 查找
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
   26. 导入导出
   ------------------------------------------------------------ */
function exportAll(){
  persistSession();
  const payload = {
    app: 'helix',
    version: '0.4.0',
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
   27. 右键菜单
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
   28. 快捷键
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
    if (!el.cmdk.hidden){ closeCmdk(); return; }
    if (!el.approvalModal.hidden){ return; }
    if (!el.findBar.hidden){ closeFind(); return; }
    if (el.drawer.classList.contains('on')){ closeDrawer(); return; }
    if (el.sidebar.classList.contains('open')){ closeSidebar(); return; }
    if (!el.ctxMenu.hidden){ hideCtx(); return; }
    if (state.streaming){ /* 不打断 */ }
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
   29. 品牌按钮 / 主题
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
   30. Token 估算
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
   31. 系统主题跟随
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
   32. 窗口尺寸变化
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

  connect();
  refreshBalance();

  /* 恢复未完成的任务（刷新前发出的消息） */
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
};

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();