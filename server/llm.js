// Helix 模型调用：和 OpenAI 兼容接口通信，流式返回

const REQUEST_TIMEOUT_MS = 120000;

// 把 HTTP 错误码翻译成人话
function friendlyError(status, rawMessage) {
  if (status === 401) {
    return { code: 'INVALID_API_KEY', message: 'API Key 不对，请到设置里检查' };
  }
  if (status === 402) {
    return { code: 'NO_BALANCE', message: '账户余额不足' };
  }
  if (status === 404) {
    return { code: 'MODEL_NOT_FOUND', message: '模型名或 Base URL 不对' };
  }
  if (status === 429) {
    return { code: 'RATE_LIMIT', message: '请求太频繁，等一会儿再试' };
  }
  return { code: 'REQUEST_FAILED', message: rawMessage || `请求失败（${status}）` };
}

/**
 * 调用模型，流式返回。
 *
 * @param {object} options
 * @param {object} options.config     配置（含 apiKey、baseUrl、model）
 * @param {Array}  options.messages   聊天记录（OpenAI 格式）
 * @param {Array}  options.tools      工具定义（可选）
 * @param {Function} options.onDelta      收到正文增量
 * @param {Function} options.onReasoning  收到思考过程增量（可选）
 * @param {AbortSignal} options.signal    中断信号
 * @returns {Promise<{toolCalls: Array}>}
 */
export async function streamChat({
  config,
  messages,
  tools,
  onDelta,
  onReasoning,
  signal,
}) {
  if (!config.apiKey) {
    const err = new Error('还没有填 API Key');
    err.code = 'INVALID_API_KEY';
    throw err;
  }

  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  // 超时控制：如果太久没反应，自动中断
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  // 把外部的 signal 和超时信号合在一起
  const combinedSignal = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const abortErr = new Error('已中断');
      abortErr.code = 'ABORTED';
      throw abortErr;
    }
    const netErr = new Error(`连不上模型服务：${err.message}`);
    netErr.code = 'NETWORK_ERROR';
    throw netErr;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const rawText = await response.text().catch(() => '');
    let message = rawText;
    try {
      const parsed = JSON.parse(rawText);
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // 不是 JSON，就用原文
    }
    const friendly = friendlyError(response.status, message);
    const err = new Error(friendly.message);
    err.code = friendly.code;
    throw err;
  }

  // 读取 SSE 流
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 工具调用是分片传过来的，需要按 index 拼起来
  const toolCallsByIndex = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 每条消息以 \n\n 分隔，但可能被切开，所以用行来拆
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 最后一段可能不完整，留到下一轮

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // 正文
        if (delta.content) {
          onDelta?.(delta.content);
        }

        // 思考过程（DeepSeek R1 等模型会有）
        if (delta.reasoning_content) {
          onReasoning?.(delta.reasoning_content);
        }

        // 工具调用
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsByIndex[idx]) {
              toolCallsByIndex[idx] = { id: '', name: '', arguments: '' };
            }
            if (tc.id) toolCallsByIndex[idx].id = tc.id;
            if (tc.function?.name) toolCallsByIndex[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallsByIndex[idx].arguments += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  const toolCalls = Object.values(toolCallsByIndex).filter((tc) => tc.name);
  return { toolCalls };
}

// 把多个 AbortSignal 合成一个：任意一个触发，结果就触发
function anySignal(signals) {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
