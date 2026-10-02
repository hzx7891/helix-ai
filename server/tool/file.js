// server/tool/file.js —— 文件工具：list_dir / read_file / write_file
//
// list_dir / read_file 是只读，不审批。
// write_file 会写文件，走审批流程。

import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';

const READ_LIMIT = 100 * 1024; // 100 KB

export const definitions = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出一个目录里有什么。返回文件名、大小、是不是目录。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目录路径，相对于工作目录。用 "." 表示当前目录。',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个文件的内容。最多 100KB，超过会截断并在末尾加 [truncated]。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，相对于工作目录。' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '把内容写入一个文件。文件不存在就创建，已存在就覆盖。会触发审批。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，相对于工作目录。' },
          content: { type: 'string', description: '要写入的文件内容。' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

/**
 * 把用户给的相对路径解析成绝对路径，并确保它落在 workspace 里面。
 * 越界就抛 PATH_OUTSIDE_WORKSPACE。
 */
function resolveSafe(workspace, userPath) {
  const base = resolve(workspace || process.cwd());
  const target = resolve(base, userPath || '.');
  const rel = relative(base, target);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    const err = new Error('路径超出工作目录：' + userPath);
    err.code = 'PATH_OUTSIDE_WORKSPACE';
    throw err;
  }
  return target;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export async function list_dir(args, context) {
  const target = resolveSafe(context.workspace, args?.path);

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new Error('目录不存在：' + (args?.path || '.'));
  }
  if (!info.isDirectory()) {
    throw new Error('这不是目录：' + (args?.path || '.'));
  }

  const entries = await readdir(target, { withFileTypes: true });

  const detailed = await Promise.all(
    entries.map(async (entry) => {
      const full = resolve(target, entry.name);
      let size = 0;
      let isDir = entry.isDirectory();
      try {
        const s = await stat(full);
        size = s.size;
        isDir = s.isDirectory();
      } catch {}
      return { name: entry.name, size, isDir };
    })
  );

  detailed.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (detailed.length === 0) return '(空目录)';

  const lines = detailed.map((d) => {
    if (d.isDir) return `${d.name}/  (目录)`;
    return `${d.name}  (${formatSize(d.size)})`;
  });

  return `目录：${args?.path || '.'}\n` + lines.join('\n');
}

export async function read_file(args, context) {
  const target = resolveSafe(context.workspace, args?.path);

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new Error('文件不存在：' + args?.path);
  }
  if (info.isDirectory()) {
    throw new Error('这是一个目录，不是文件：' + args?.path);
  }

  const buf = await readFile(target);

  if (buf.length > READ_LIMIT) {
    return buf.subarray(0, READ_LIMIT).toString('utf-8') + '\n[truncated]';
  }
  return buf.toString('utf-8');
}

/**
 * write_file —— 写文件。文件不存在就创建，已存在就覆盖。
 * 如果父目录不存在，会自动建。
 */
export async function write_file(args, context) {
  const target = resolveSafe(context.workspace, args?.path);

  if (typeof args?.content !== 'string') {
    throw new Error('缺少 content 参数，或 content 不是字符串');
  }

  // 目录不存在就建
  const parent = dirname(target);
  try {
    await mkdir(parent, { recursive: true });
  } catch {}

  // 检查目标是不是目录
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      throw new Error('这是一个目录，不能写入：' + args?.path);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const before = await readFile(target).catch(() => null);
  const existed = before !== null;

  await writeFile(target, args.content, 'utf-8');

  const lines = args.content.split('\n').length;
  const bytes = Buffer.byteLength(args.content, 'utf-8');

  if (existed) {
    return `已覆盖文件：${args.path}\n新大小：${formatSize(bytes)}，${lines} 行`;
  }
  return `已创建文件：${args.path}\n大小：${formatSize(bytes)}，${lines} 行`;
}
