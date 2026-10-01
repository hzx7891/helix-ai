/**
 * Helix Markdown 渲染器 · 契约 v1.0
 *
 * 导出：renderMarkdown(src: string): string
 * - 纯函数，无副作用
 * - 无 DOM / 网络访问
 * - 流式安全：未闭合 ``` 、表格、引用、列表都能正常渲染
 * - 转义所有用户输入，防 XSS
 * - 无第三方依赖
 */

const KEYWORDS = (
  'function,const,let,var,return,if,else,for,while,do,switch,case,break,continue,' +
  'class,extends,new,this,super,import,export,from,default,async,await,try,catch,' +
  'finally,throw,typeof,instanceof,in,of,delete,void,yield,static,get,set,' +
  'public,private,protected,readonly,interface,type,enum,implements,namespace,declare,' +
  'def,elif,lambda,None,True,False,self,print,as,with,raise,pass,global,nonlocal,' +
  'func,struct,impl,fn,pub,use,mod,match,where,mut,ref,' +
  'package,int,float,double,char,bool,String,Integer,Boolean,' +
  'and,or,not,is,be,sealed,abstract,virtual,override,params'
).split(',').join('|');

const KW_RE = new RegExp('\\b(' + KEYWORDS + ')\\b', 'g');

/* -----------------------------------------------------------
   转义
   ----------------------------------------------------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -----------------------------------------------------------
   代码高亮（纯字符串处理）
   ----------------------------------------------------------- */
function highlightCode(raw) {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return '\u0000' + (stash.length - 1) + '\u0000';
  };

  let s = String(raw);

  // 字符串
  s = s.replace(
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
    (m) => keep('<span class="tok-str">' + escapeHtml(m) + '</span>')
  );
  // 注释
  s = s.replace(
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)/g,
    (m) => keep('<span class="tok-com">' + escapeHtml(m) + '</span>')
  );
  // 数字
  s = s.replace(
    /\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    (m) => keep('<span class="tok-num">' + m + '</span>')
  );
  // 关键字
  s = s.replace(KW_RE, (m) => keep('<span class="tok-key">' + m + '</span>'));
  // 函数调用
  s = s.replace(
    /\b([A-Za-z_$][\w$]*)(?=\s*\()/g,
    (m) => keep('<span class="tok-fn">' + m + '</span>')
  );

  s = escapeHtml(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
}

function codeBlock(lang, code) {
  const l = (lang || 'text').toLowerCase();
  const body = highlightCode(String(code).replace(/\n$/, ''));
  return '<div class="code-block">' +
    '<div class="code-head">' +
      '<span class="code-lang">' + escapeHtml(l) + '</span>' +
      '<div class="code-actions">' +
        '<button type="button" class="code-btn" data-copy>' +
          '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-copy"/></svg>' +
          '<span>复制</span>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<pre><code>' + body + '</code></pre>' +
  '</div>';
}

/* -----------------------------------------------------------
   行内渲染
   ----------------------------------------------------------- */
function renderInline(text) {
  let s = escapeHtml(text);

  s = s.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 链接（过滤 javascript: 协议）
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = String(url).trim();
    if (/^\s*javascript:/i.test(u) || /^\s*data:/i.test(u)) return label;
    return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener noreferrer">' +
           label + '</a>';
  });

  // 自动链接
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (m, pre, url) => pre +
      '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'
  );

  return s;
}

/* -----------------------------------------------------------
   围栏切割（流式安全）
   ----------------------------------------------------------- */
function splitFences(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let lang = '';
  let codeBuf = [];
  let mdBuf = [];

  const flushMd = () => {
    if (mdBuf.length) {
      out.push({ kind: 'md', value: mdBuf.join('\n') });
      mdBuf = [];
    }
  };
  const flushCode = () => {
    out.push({ kind: 'code', lang: lang, value: codeBuf.join('\n') });
    codeBuf = [];
    lang = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^```([a-zA-Z0-9_+\-#.]*)\s*$/.exec(line);

    if (m) {
      if (!inCode) {
        flushMd();
        inCode = true;
        lang = m[1] || '';
        codeBuf = [];
      } else {
        flushCode();
        inCode = false;
      }
      continue;
    }

    if (inCode) codeBuf.push(line);
    else mdBuf.push(line);
  }

  // 流式安全：未闭合的围栏也要输出
  if (inCode) flushCode();
  flushMd();

  return out;
}

/* -----------------------------------------------------------
   块级渲染
   ----------------------------------------------------------- */
function splitTableRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim());
}

function isTableDivider(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line);
}

function renderList(lines, start) {
  const items = [];
  let i = start;
  const ordered = /^\s*\d+\.\s+/.test(lines[i]);
  const itemRe = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;

  while (i < lines.length && itemRe.test(lines[i])) {
    let content = itemRe.exec(lines[i])[1];
    i++;
    // 收集续行
    while (
      i < lines.length &&
      lines[i].trim() &&
      !itemRe.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      content += '\n' + lines[i].trim();
      i++;
    }
    items.push(content);
  }

  const tag = ordered ? 'ol' : 'ul';
  let html = '<' + tag + '>';

  for (const raw of items) {
    const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(raw);
    if (task) {
      const on = task[1].toLowerCase() === 'x';
      html +=
        '<li class="md-task">' +
          '<span class="box' + (on ? ' on' : '') + '"></span>' +
          '<span>' + renderInline(task[2]) + '</span>' +
        '</li>';
    } else {
      html += '<li>' + renderInline(raw) + '</li>';
    }
  }

  html += '</' + tag + '>';
  return { html: html, next: i };
}

function renderMdBlock(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lv = h[1].length;
      out.push('<h' + lv + '>' + renderInline(h[2].trim()) + '</h' + lv + '>');
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + renderMdBlock(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // 表格
    if (
      line.indexOf('|') !== -1 &&
      i + 1 < lines.length &&
      isTableDivider(lines[i + 1])
    ) {
      const head = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      let t = '<table><thead><tr>';
      for (const c of head) t += '<th>' + renderInline(c) + '</th>';
      t += '</tr></thead><tbody>';
      for (const r of rows) {
        t += '<tr>';
        for (let k = 0; k < head.length; k++) {
          t += '<td>' + renderInline(r[k] == null ? '' : r[k]) + '</td>';
        }
        t += '</tr>';
      }
      t += '</tbody></table>';
      out.push(t);
      continue;
    }

    // 列表
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const r = renderList(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }

    // 段落
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }

    if (buf.length) {
      out.push(
        '<p>' + renderInline(buf.join('\n')).replace(/\n/g, '<br>') + '</p>'
      );
    } else {
      i++;
    }
  }

  return out.join('');
}

/* -----------------------------------------------------------
   导出
   ----------------------------------------------------------- */
export function renderMarkdown(src) {
  if (typeof src !== 'string' || !src) return '';
  const parts = splitFences(src);
  let html = '';
  for (const p of parts) {
    if (p.kind === 'code') html += codeBlock(p.lang, p.value);
    else html += renderMdBlock(p.value);
  }
  return html;
}
