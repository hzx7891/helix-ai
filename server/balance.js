// --- BALANCE_JS_START ---

const TIMEOUT_MS = 10000;

function detectProvider(baseUrl) {
  const u = baseUrl.toLowerCase();
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('openai.com')) return 'openai';
  if (u.includes('moonshot.cn')) return 'moonshot';
  if (u.includes('dashscope.aliyuncs.com')) return 'qwen';
  if (u.includes('bigmodel.cn')) return 'zhipu';
  return 'unknown';
}

export async function fetchBalance(config) {
  if (!config || !config.apiKey) {
    return { supported: false, reason: '还没配置 API Key' };
  }

  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return { supported: false, reason: '还没配置 Base URL' };
  }

  const provider = detectProvider(baseUrl);

  if (provider === 'deepseek') {
    return await fetchDeepSeekBalance(baseUrl, config.apiKey);
  }

  return {
    supported: false,
    reason: '暂不支持查询 ' + provider + ' 的余额',
  };
}

async function fetchDeepSeekBalance(baseUrl, apiKey) {
  const url = baseUrl + '/user/balance';

  const controller = new AbortController();
  const timer = setTimeout(function(){ controller.abort(); }, TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      return { supported: true, reason: '查询超时' };
    }
    return { supported: true, reason: '查询失败：' + (err && err.message ? err.message : String(err)) };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) return { supported: true, reason: 'API Key 无效' };
    if (res.status === 404) return { supported: true, reason: '该服务商不支持余额查询' };
    return { supported: true, reason: '接口返回 HTTP ' + res.status };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { supported: true, reason: '返回的内容不是合法 JSON' };
  }

  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
  if (!infos.length) {
    return { supported: true, reason: '接口没有返回余额信息' };
  }

  const info = infos.find(function(x){ return x.currency === 'CNY'; }) || infos[0];
  const total = parseFloat(info.total_balance);

  if (!Number.isFinite(total)) {
    return { supported: true, reason: '余额字段无法解析' };
  }

  return {
    supported: true,
    balance: {
      total: total,
      currency: info.currency || 'CNY',
      granted: parseFloat(info.granted_balance) || 0,
      toppedUp: parseFloat(info.topped_up_balance) || 0,
      available: Boolean(data.is_available),
    },
  };
}

// --- BALANCE_JS_END ---
