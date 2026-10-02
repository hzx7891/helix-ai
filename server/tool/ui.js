// server/tool/ui.js —— 界面类工具：render_preview / ask_user
//
// 这两个工具比较特殊：
//   render_preview：不弹审批，直接往浏览器推 HTML
//   ask_user：      反过来问用户，走 question 类型的弹窗
//
// 它俩不走通用审批流程（tool/index.js 里会特殊处理）。

import { requestApproval, makeRequestId } from '../approval.js';

// 预览面板能接受的最大 HTML 体积
const MAX_PREVIEW_BYTES = 500 * 1024; // 500 KB

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
