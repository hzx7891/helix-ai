// Helix 迷你 Markdown 渲染器：支持常用语法，流式安全

// 把 HTML 特殊字符转义，防止 XSS
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 行内语法：粗体、斜体、删除线、行内代码、链接
function renderInline(text) {
  let out = escapeHtml(text);

  // 行内代码先处理，因为代码里的 * 不该被当成粗体
  const codeSlots = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    codeSlots.push(code);
    return `\u0000CODE${codeSlots.length - 1}\u0000`;
  });

  // 图片 ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    return `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;">`;
  });

  // 链接 [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // 粗体 **text**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // 斜体 *text*
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // 删除线 ~~text~~
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 把代码放回去
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => {
    return `<code>${codeSlots[Number(i)]}</code>`;
  });

  return out;
}

// 把 Markdown 渲染成 HTML
export function renderMarkdown(source) {
  const text = String(source || '');
  const lines = text.split('\n');
  const html = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines = [];
  let listType = null; // 'ul' | 'ol' | null

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  }

  function flushCode() {
    const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
    const code = escapeHtml(codeLines.join('\n'));
    html.push(`<pre><code${langClass}>${code}</code></pre>`);
    codeLines = [];
    codeLang = '';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块围栏 ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        closeList();
        inCodeBlock = true;
        codeLang = fence[1] || '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 空行
    if (line.trim() === '') {
      closeList();
      continue;
    }

    // 分割线 --- / *** / ___
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line.trim())) {
      closeList();
      html.push('<hr>');
      continue;
    }

    // 标题 # ~ ######
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    // 引用 >
    if (/^>\s?/.test(line)) {
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    // 无序列表 - * +
    const ulMatch = line.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${renderInline(ulMatch[1])}</li>`);
      continue;
    }

    // 有序列表 1. 2. 3.
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    // 表格：识别 | a | b | 这种行
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 收集这一组表格行
      const tableLines = [line];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) {
        i += 1;
        tableLines.push(lines[i]);
      }
      html.push(renderTable(tableLines));
      continue;
    }

    // 普通段落
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  // 流式安全：还没闭合的代码块也要渲染出来
  if (inCodeBlock && codeLines.length > 0) {
    flushCode();
  }
  closeList();

  return html.join('\n');
}

// 表格渲染
function renderTable(rows) {
  if (rows.length < 2) {
    return `<p>${renderInline(rows[0] || '')}</p>`;
  }

  function splitRow(row) {
    return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  }

  const header = splitRow(rows[0]);
  const separator = splitRow(rows[1]);

  // 第二行必须是 ---|--- 这种形式才认作表格
  const isTable = separator.every((c) => /^:?-+:?$/.test(c));
  if (!isTable) {
    return `<p>${renderInline(rows[0])}</p>`;
  }

  const bodyRows = rows.slice(2).map(splitRow);

  let html = '<table><thead><tr>';
  for (const cell of header) {
    html += `<th>${renderInline(cell)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const row of bodyRows) {
    html += '<tr>';
    for (const cell of row) {
      html += `<td>${renderInline(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}
