// server/tool/ui.js —— 界面类工具：render_preview / ask_user / update_tasks
//
// 这三个工具比较特殊：
//   render_preview：不弹审批，直接往浏览器推 HTML
//   ask_user：      反过来问用户，走 question 类型的弹窗
//   update_tasks：  不弹审批，更新任务清单块
//
// 它们不走通用审批流程（tool/index.js 里会特殊处理）。

import { requestApproval, makeRequestId } from '../approval.js';

// 预览面板能接受的最大 HTML 体积
const MAX_PREVIEW_BYTES = 500 * 1024; // 500 KB

// 任务清单：最多几条、每条文字多长
const MAX_TASKS = 50;
const MAX_TASK_TEXT = 200;

// status → 符号（给 AI 看的结果里用）
const STATUS_SYMBOL = {
  todo:      '[ ]',
  doing:     '[.]',
  done:      '[√]',
  failed:    '[X]',
  cancelled: '[-]',
  waiting:   '[?]',
  warning:   '[!]',
};

const VALID_STATUS = new Set(Object.keys(STATUS_SYMBOL));

// ---------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------

export const definitions = [
  {
    type: 'function',
    function: {
      name: 'render_preview',
      description:
        '把一段 HTML 渲染到浏览器右侧的预览面板。\n' +
        '适合：给用户看图表、demo 页面、可视化效果、排版原型。\n' +
        '传入完整的 HTML 文档（含 <style>），不要只给片段。\n' +
        '会直接在预览面板里显示，不会弹窗、不写文件。',
      parameters: {
        type: 'object',
        properties: {
          html: {
            type: 'string',
            description:
              '完整的 HTML 文档字符串。建议包含 <!DOCTYPE html>、<style>。\n' +
              '上限 500KB。',
          },
        },
        required: ['html'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        '向用户提问，等待用户输入答案。\n' +
        '适合：信息不足需要澄清、让用户在多个方案里选一个、\n' +
        '     需要用户提供额外参数（比如"你想删哪个文件？"）。\n' +
        '用户会看到一个输入框，答案会作为工具结果返回给你。\n' +
        '注意：无论当前是什么权限模式，这个工具都会弹窗。',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '要问用户的问题。尽量具体，一次只问一个。',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tasks',
      description:
        '更新当前对话的任务清单，让用户看到你"到哪一步了"。\n' +
        '适合：干多步长任务时，列个清单实时更新进度。\n' +
        '每次调用必须传入完整清单（不是增量），后端会整体替换上一版。\n' +
        'status 只能用这 7 个值：\n' +
        '  todo      —— 待办       [ ]\n' +
        '  doing     —— 进行中     [.]\n' +
        '  done      —— 已完成     [√]\n' +
        '  failed    —— 失败       [X]\n' +
        '  cancelled —— 已取消     [-]\n' +
        '  waiting   —— 等用户回答 [?]\n' +
        '  warning   —— 警告/高风险 [!]\n' +
        '建议用法：开始长任务前先列一次（全部 todo），\n' +
        '每完成一步就重新调用一次，更新对应条目的 status。',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: '完整任务清单。每次传入全量，不是增量。',
            items: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: '任务描述，一句话，不超过 200 字。',
                },
                status: {
                  type: 'string',
                  enum: [
                    'todo',
                    'doing',
                    'done',
                    'failed',
                    'cancelled',
                    'waiting',
                    'warning',
                  ],
                  description: '任务状态，只能填上面 7 个值之一。',
                },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
];

// ---------------------------------------------------------------
// render_preview —— 推 HTML 到预览面板
// ---------------------------------------------------------------

export async function render_preview(args, context) {
  const html = args && args.html;

  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('缺少 html 参数，或者不是字符串');
  }

  const bytes = Buffer.byteLength(html, 'utf-8');
  if (bytes > MAX_PREVIEW_BYTES) {
    throw new Error(
      `HTML 太大（${(bytes / 1024).toFixed(1)} KB），上限 500KB。` +
      '请精简后再试。'
    );
  }

  const ws = context && context.ws;
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error('无法渲染预览：浏览器连接已断开');
  }

  ws.send(JSON.stringify({
    type: 'preview',
    html,
  }));

  return `已渲染到预览面板（${(bytes / 1024).toFixed(1)} KB）。`;
}

// ---------------------------------------------------------------
// ask_user —— 反向提问
// ---------------------------------------------------------------
// 走 approval 系统的 question 类型，前端会弹一个输入框。

export async function ask_user(args, context) {
  const question = args && args.question;

  if (typeof question !== 'string' || !question.trim()) {
    throw new Error('缺少 question 参数，或者不是字符串');
  }

  const ws = context && context.ws;
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error('无法提问：浏览器连接已断开');
  }

  const requestId = makeRequestId();
  const { decision, answer } = await requestApproval(ws, {
    requestId,
    kind: 'question',
    title: '需要你的输入',
    detail: question.trim(),
    tool: 'ask_user',
  });

  if (decision === 'deny') {
    return '用户取消了提问（可能是超时或点了取消）';
  }

  const reply = (answer || '').trim();
  if (!reply) {
    return '用户提交了空回答';
  }

  return '用户的回答：' + reply;
}

// ---------------------------------------------------------------
// update_tasks —— 更新任务清单
// ---------------------------------------------------------------
// 不弹审批。前端识别工具名 update_tasks，把它渲染成任务块。
// 这里只负责：校验参数 + 返回一份人类可读的清单给模型看。

export async function update_tasks(args) {
  const tasks = args && args.tasks;

  if (!Array.isArray(tasks)) {
    throw new Error('缺少 tasks 参数，或者不是数组');
  }
  if (tasks.length === 0) {
    throw new Error('tasks 不能是空数组（要清空就用别的说法告诉用户）');
  }
  if (tasks.length > MAX_TASKS) {
    throw new Error(`任务太多（${tasks.length} 条），上限 ${MAX_TASKS} 条`);
  }

  const cleaned = tasks.map((t, i) => {
    const n = i + 1;
    if (!t || typeof t !== 'object') {
      throw new Error(`第 ${n} 个任务不是对象`);
    }

    const text = typeof t.text === 'string' ? t.text.trim() : '';
    if (!text) {
      throw new Error(`第 ${n} 个任务缺少 text`);
    }
    if (text.length > MAX_TASK_TEXT) {
      throw new Error(
        `第 ${n} 个任务文字太长（${text.length} 字，上限 ${MAX_TASK_TEXT}）`
      );
    }

    const status = t.status;
    if (typeof status !== 'string' || !VALID_STATUS.has(status)) {
      throw new Error(
        `第 ${n} 个任务 status 不合法：${JSON.stringify(status)}。` +
        `只能是 ${[...VALID_STATUS].join(' / ')}`
      );
    }

    return { text, status };
  });

  // 拼一份可读清单，回给模型（也方便你调试看日志）
  const lines = cleaned.map(
    t => `${STATUS_SYMBOL[t.status]} ${t.text}`
  );

  // 简单统计，让模型知道还剩几步没完成
  const pending = cleaned.filter(
    t => t.status === 'todo' || t.status === 'doing' || t.status === 'waiting'
  ).length;
  const finished = cleaned.filter(
    t => t.status === 'done' || t.status === 'cancelled'
  ).length;

  return (
    `任务清单已更新（共 ${cleaned.length} 条，` +
    `已完成/取消 ${finished} 条，未完成 ${pending} 条）：\n` +
    lines.join('\n')
  );
}