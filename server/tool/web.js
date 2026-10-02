// server/tool/web.js —— 联网工具：web_search / fetch_url
//
// 只读，无审批，无第三方依赖，Node 内置 fetch。
//
// 搜索引擎：Bing（cn.bing.com，国内可达）。
// 关键坑：Bing 的外链是包装过的（bing.com/ck/a?...&u=a1<base64url>），
//         必须解码 u 参数才能拿到真 URL，否则返回的全是垃圾链接。

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;
const MAX_HTML_CHARS = 20000;
const MAX_SEARCH_RESULTS = 5;
const MAX_SNIPPET_CHARS = 300;
const MAX_LINKS = 80;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 ' +
  'Helix/0.4';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...((options && options.headers) || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res, maxBytes) {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        try { await reader.cancel(); } catch {}
        break;
      }
    }
  } finally {
    try { reader.releaseLock && reader.releaseLock(); } catch {}
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return merged.subarray(0, maxBytes);
}

function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ');
  s = s.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/?(p|div|section|article|header|footer|main|aside|nav)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/?h[1-6]\b[^>]*>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<tr\b[^>]*>/gi, '\n');
  s = s.replace(/<\/tr>/gi, '');
  s = s.replace(/<(td|th)\b[^>]*>/gi, ' | ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&apos;/g, "'");
  s = s.replace(/&hellip;/g, '…');
  s = s.replace(/&mdash;/g, '—');
  s = s.replace(/&ndash;/g, '–');
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; }
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; }
  });
  s = s.replace(/[ \t\f\v]+/g, ' ');
  s = s.replace(/[ \t]+$/gm, '');
  s = s.replace(/^[ \t]+/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  const t = htmlToText(m[1]).trim();
  return t.length > 200 ? t.slice(0, 200) + '…' : t;
}

function extractLinks(html, baseUrl) {
  const seen = new Set();
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.length < MAX_LINKS) {
    let href = (m[1] || m[2] || m[3] || '').trim();
    if (!href) continue;
    if (href.startsWith('#')) continue;
    if (/^(javascript|mailto|tel|data|blob):/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!abs.startsWith('http')) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    let text = htmlToText(m[4] || '').trim().replace(/\s+/g, ' ');
    if (text.length > 100) text = text.slice(0, 100) + '…';
    out.push({ url: abs, text: text || '(无文字)' });
  }
  return out;
}

// ---------------------------------------------------------------
// Bing 链接解码（关键修复）
// ---------------------------------------------------------------
// Bing 的外链长这样：
//   https://www.bing.com/ck/a?!&&p=...&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8...
// u= 参数去掉开头 "a1"，剩下的是 base64url 编码的真 URL。
// 不处理的话，AI 拿到的"链接"全是 bing.com 的跳转页。

function decodeBingLink(href) {
  if (!href) return '';
  try {
    const abs = href.startsWith('//') ? 'https:' + href : href;
    const u = new URL(abs);
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /^\/ck\/a/.test(u.pathname)) {
      let raw = u.searchParams.get('u') || '';
      if (raw.startsWith('a1')) raw = raw.slice(2);
      // base64url → base64
      raw = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (raw.length % 4 !== 0) raw += '=';
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
    return abs;
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------
// Bing 搜索结果解析
// ---------------------------------------------------------------
// 每条结果大致：
//   <li class="b_algo">
//     <h2><a href="...">标题</a></h2>
//     <div class="b_caption"><p>摘要...</p></div>
//   </li>
// 先抓所有 <h2><a>，再往后找最近的 <p> 作为摘要。

function parseBing(html) {
  const out = [];
  const seen = new Set();

  const re = /<h2[^>]*>[\s\S]*?<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi;
  let m;

  while ((m = re.exec(html)) !== null && out.length < MAX_SEARCH_RESULTS) {
    const url = decodeBingLink(m[1]);
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    // 跳过 Bing / Microsoft 自己的链接
    if (/^https?:\/\/([^/]*\.)?(bing|microsoft|msn)\.com\//i.test(url)) continue;
    if (seen.has(url)) continue;

    const title = htmlToText(m[2]).trim();
    if (!title) continue;

    // 摘要：从 </h2> 往后 2500 字符内找第一个 <p>
    const tailStart = m.index + m[0].length;
    const tail = html.slice(tailStart, tailStart + 2500);
    let snippet = '';
    const pMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(tail);
    if (pMatch) {
      snippet = htmlToText(pMatch[1]).trim();
    } else {
      const dMatch = /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(tail);
      if (dMatch) snippet = htmlToText(dMatch[1]).trim();
    }

    if (snippet.length > MAX_SNIPPET_CHARS) {
      snippet = snippet.slice(0, MAX_SNIPPET_CHARS) + '…';
    }

    seen.add(url);
    out.push({ title, url, snippet });
  }

  return out;
}

// ---------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------

export const definitions = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '用搜索引擎（Bing）搜信息，返回前 5 条结果（标题 + 链接 + 摘要）。\n' +
        '适合：找最新版本号、查报错、找官方文档地址。\n' +
        '不需要 API Key。支持 Bing 的 site:、filetype: 等运算符。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词。中英文都支持。',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        '抓取一个 URL。三种模式：\n' +
        '  mode="text"（默认）：HTML 剥成纯文本，适合读文章/文档。\n' +
        '  mode="html"：返回原始 HTML 源码，适合找 <meta>、JSON-LD、\n' +
        '              内嵌 <script> 里的数据（相当于 F12 → 查看源码）。\n' +
        '  mode="links"：列出页面上所有 <a> 链接。想"点"某个链接时，\n' +
        '               先用这个模式拿到 URL，再用 mode="text" 抓它。\n' +
        '长页面用 offset 参数"往下滚"：第一次读 offset=0，\n' +
        '看到尾巴上提示 "还有 N 字符" 就带 offset=<上次末尾> 再来一次。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '网页地址，必须以 http:// 或 https:// 开头。',
          },
          mode: {
            type: 'string',
            enum: ['text', 'html', 'links'],
            description: '抓取模式，默认 text。',
          },
          offset: {
            type: 'integer',
            description: '从第几个字符开始返回（默认 0）。用于分页读长内容。',
          },
        },
        required: ['url'],
      },
    },
  },
];

// ---------------------------------------------------------------
// web_search —— 走 Bing
// ---------------------------------------------------------------

export async function web_search(args, context) {
  const query = args && args.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('缺少 query 参数，或者不是字符串');
  }

  // cn.bing.com 国内更稳；safeSearch=Off 减少过滤
  const url =
    'https://cn.bing.com/search?q=' +
    encodeURIComponent(query.trim()) +
    '&setlang=zh-CN&mkt=zh-CN&safeSearch=Off';

  let res;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Referer': 'https://cn.bing.com/',
        },
      },
      DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('搜索超时（15 秒），可能是网络问题，稍后再试');
    }
    throw new Error('搜索请求失败：' + (err && err.message ? err.message : String(err)));
  }

  if (!res.ok) {
    throw new Error(`搜索服务返回 HTTP ${res.status}，可能被限流，等一会儿再试`);
  }

  const html = await res.text();
  const results = parseBing(html);

  if (!results.length) {
    // 检测是不是撞上了 Bing 的验证页
    const looksLikeChallenge =
      /captcha|verify|人机验证|verify you are human/i.test(html) &&
      html.length < 60000;
    return (
      `搜索「${query}」没有返回结果。可能原因：\n` +
      (looksLikeChallenge
        ? '1. Bing 返回了人机验证页（换个网络或等几分钟再试）\n'
        : '1. 关键词太冷门\n') +
      '2. 搜索服务临时限流\n' +
      '3. 网络被拦截'
    );
  }

  const lines = [`搜索「${query}」，共 ${results.length} 条：`, ''];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------
// fetch_url —— 抓网页
// ---------------------------------------------------------------

export async function fetch_url(args, context) {
  const rawUrl = args && args.url;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('缺少 url 参数，或者不是字符串');
  }

  const mode = (args && args.mode) || 'text';
  if (mode !== 'text' && mode !== 'html' && mode !== 'links') {
    throw new Error(`mode 只能是 text / html / links，收到的是：${mode}`);
  }

  // offset 兼容字符串和数字（有些模型会把整数输出成字符串）
  const rawOffset = args && args.offset;
  const n = Number(rawOffset);
  const offset = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL 格式不对：' + rawUrl);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http:// 和 https://，不支持 ' + parsed.protocol);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      rawUrl.trim(),
      {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5',
        },
      },
      DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('抓取超时（15 秒）：' + rawUrl);
    }
    throw new Error('抓取失败：' + (err && err.message ? err.message : String(err)));
  }

  if (!res.ok) {
    throw new Error(`目标返回 HTTP ${res.status}：${rawUrl}`);
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const isText =
    ct.includes('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct === '';
  if (!isText) {
    throw new Error(`不支持的内容类型：${ct || '未知'}（只能抓文本/HTML/JSON/XML）`);
  }

  const buf = await readLimited(res, MAX_FETCH_BYTES);
  const body = buf.toString('utf-8');

  const looksLikeHtml =
    ct.includes('html') || /<html[\s>]/i.test(body.slice(0, 2000));
  const title = looksLikeHtml ? extractTitle(body) : '';
  const finalUrl = res.url || rawUrl.trim();

  if (mode === 'links') {
    if (!looksLikeHtml) {
      return `（这不是 HTML 页面，没有链接可列）内容类型：${ct || '未知'}`;
    }
    const links = extractLinks(body, finalUrl);
    if (!links.length) {
      return `页面上没有找到可用链接。\n标题：${title || '(无)'}\n来源：${finalUrl}`;
    }
    const lines = [
      title ? `标题：${title}` : null,
      `来源：${finalUrl}`,
      `共 ${links.length} 条链接：`,
      '',
    ].filter(Boolean);
    links.forEach((l, i) => {
      lines.push(`${i + 1}. ${l.text}`);
      lines.push(`   ${l.url}`);
    });
    return lines.join('\n');
  }

  if (mode === 'html') {
    const total = body.length;
    const chunk = body.slice(offset, offset + MAX_HTML_CHARS);
    const parts = [];
    if (title) parts.push(`标题：${title}`);
    parts.push(`来源：${finalUrl}`);
    parts.push(`内容类型：${ct || '未知'}`);
    parts.push(`源码总长：${total} 字符`);
    parts.push('');
    parts.push(chunk || '(空)');
    if (offset + chunk.length < total) {
      parts.push('');
      parts.push(
        `[已显示 ${offset}-${offset + chunk.length} / ${total}。` +
        `继续带 offset=${offset + chunk.length} 再调一次]`
      );
    }
    return parts.join('\n');
  }

  let fullText;
  if (looksLikeHtml) {
    fullText = htmlToText(body);
  } else {
    fullText = body;
  }

  const total = fullText.length;
  const chunk = fullText.slice(offset, offset + MAX_TEXT_CHARS);

  const parts = [];
  if (title) parts.push(`标题：${title}`);
  parts.push(`来源：${finalUrl}`);
  if (total > MAX_TEXT_CHARS || offset > 0) {
    parts.push(`正文长度：${total} 字符`);
  }
  parts.push('');
  parts.push(chunk || '(页面没有可读文字)');
  if (offset + chunk.length < total) {
    parts.push('');
    parts.push(
      `[已显示 ${offset}-${offset + chunk.length} / ${total}。` +
      `想看后面就带 offset=${offset + chunk.length} 再调一次]`
    );
  }
  return parts.join('\n');
}
