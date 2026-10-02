// server/tool/shell.js —— 命令执行工具 run_command
//
// 这是 Helix 里唯一能"真的动手"的工具，危险程度最高。
// 设计原则：宁可拒绝，不可放行。
//
// 安全铁律（文档第五节）：
//   1. 禁止 shell:true，禁止 exec
//   2. 必须用 spawn + 参数数组
//   3. 超时 30 秒
//   4. 输出上限 100KB
//   5. 触发审批（由 tool/index.js 统一处理）
//
// 但光靠这五条还不够。这个文件额外做了：
//   - 过滤敏感环境变量（防止 AI 跑 `env` 把 API Key 打印出来）
//   - 杀掉整个进程树（不只是父进程，不然子进程会变孤儿）
//   - 字节级截断（不是字符级，中文一个字符三字节）
//   - 友好的错误翻译（ENOENT 不说 "ENOENT"，说"命令不存在"）
//   - 平台识别（Termux / Windows / Linux / macOS）

import { spawn } from 'node:child_process';

// ---------------------------------------------------------------
// 常量
// ---------------------------------------------------------------

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_TIMEOUT_SEC = 600;
const MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB
const KILL_GRACE_MS = 2000; // SIGTERM 之后给 2 秒，再 SIGKILL

// ---------------------------------------------------------------
// 平台识别
// ---------------------------------------------------------------
// 用来告诉 AI "你现在在什么系统上"，好让它选对命令。
// 比如 Termux 上 ls -la 是对的，Windows 上得用 dir。

function detectPlatform() {
  // Termux 的标志：PREFIX 环境变量里带 com.termux
  if (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) {
    return {
      id: 'termux',
      name: 'Termux（Android）',
      family: 'unix',
      exampleCmd: 'ls',
    };
  }
  if (process.platform === 'win32') {
    return {
      id: 'windows',
      name: 'Windows',
      family: 'windows',
      exampleCmd: 'dir',
    };
  }
  if (process.platform === 'darwin') {
    return {
      id: 'macos',
      name: 'macOS',
      family: 'unix',
      exampleCmd: 'ls',
    };
  }
  return {
    id: 'linux',
    name: 'Linux',
    family: 'unix',
    exampleCmd: 'ls',
  };
}

// ---------------------------------------------------------------
// 环境变量过滤
// ---------------------------------------------------------------
// 为什么要过滤？
// 用户在 ~/.helix/config.json 里存了 API Key。虽然那个文件权限 0600，
// 但 process.env 里可能带着别的服务 Key（用户在 Termux 里 export 过）。
// 如果 AI 跑 `env` 或 `printenv`，这些就泄露了。
//
// 过滤规则：名字里带 api_key / secret / password / token 的，一律不给。
// 宁可错杀，不可放过。

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /private[_-]?key/i,
  /\btoken\b/i,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^DEEPSEEK_/,
  /^GEMINI_/,
  /^GOOGLE_/,
  /^AWS_/,
  /^AZURE_/,
  /^GITHUB_TOKEN$/,
  /^GH_TOKEN$/,
  /^NPM_TOKEN$/,
];

function isSensitiveKey(key) {
  return SENSITIVE_PATTERNS.some((re) => re.test(key));
}

function buildSafeEnv() {
  const safe = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (isSensitiveKey(key)) continue;
    safe[key] = value;
  }
  // 标记一下，AI 跑 env 时能看到这行，就知道被过滤过
  safe.HELIX_SANDBOXED = '1';
  return safe;
}

// ---------------------------------------------------------------
// 错误翻译
// ---------------------------------------------------------------
// 把 Node 的原始错误码，翻译成 AI 和人都能看懂的话。

function friendlySpawnError(err, command) {
  const code = err?.code;
  if (code === 'ENOENT') {
    return `命令不存在：${command}\n（当前平台上没有这个可执行文件，检查拼写，或看是不是没安装）`;
  }
  if (code === 'EACCES') {
    return `没有执行权限：${command}\n（文件存在，但不是可执行文件，或者权限不够）`;
  }
  if (code === 'EISDIR') {
    return `这是一个目录，不是可执行文件：${command}`;
  }
  if (code === 'ENOTDIR') {
    return `路径中有部分不是目录：${command}`;
  }
  if (code === 'EPERM') {
    return `系统拒绝了这个操作：${command}\n（可能是系统限制，或者需要 root）`;
  }
  if (code === 'EMFILE') {
    return `打开的文件太多，系统资源不足。等一下再试。`;
  }
  return `启动命令失败：${command}\n${err?.message || String(err)}`;
}

// ---------------------------------------------------------------
// 输出截断
// ---------------------------------------------------------------
// 按字节截断，不是按字符。因为中文一个字符占 3 字节，
// 按字符截断可能截出 300KB。

function truncateBytes(str, limitBytes) {
  const buf = Buffer.from(str, 'utf-8');
  if (buf.length <= limitBytes) {
    return { text: str, truncated: false, bytes: buf.length };
  }
  // 截断到 limitBytes 字节，再从后往前找合法的 utf-8 边界
  let cut = limitBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
  return {
    text: buf.subarray(0, cut).toString('utf-8'),
    truncated: true,
    bytes: buf.length,
  };
}

// ---------------------------------------------------------------
// 工具定义（给 AI 看的说明书）
// ---------------------------------------------------------------

export const definitions = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在用户的工作目录里执行一条命令，返回输出。需要用户审批。\n\n' +
        '用法要点：\n' +
        '1. 命令和参数要分开：command="ls"，args=["-la"]，不要写成一整句 "ls -la"。\n' +
        '2. 不要用 shell 语法（管道 |、重定向 >、&& 这些都不支持）。\n' +
        '3. 想连续跑多条命令，就多次调用这个工具。\n' +
        '4. 输出超过 100KB 会被截断，超时 30 秒会被强制终止。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的命令名（不带参数）。例如 "ls"、"node"、"git"。',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description:
              '命令参数列表。例如 ["-la"]、["--version"]、["commit", "-m", "fix"]。' +
              '不要包含命令本身，也不要用 shell 语法。',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description:
        '获取当前运行环境的信息：操作系统、Node 版本、工作目录、可用的 shell。' +
        '当你不确定用户用什么系统时，先调这个，再决定用什么命令。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// ---------------------------------------------------------------
// run_command —— 真正执行
// ---------------------------------------------------------------

export async function run_command(args, context) {
  const command = args?.command;
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('缺少 command 参数，或者不是字符串');
  }

  // 参数必须是一个数组。如果 AI 传了字符串，直接拒绝。
  // 为什么？因为字符串形式会诱导我们拼命令，就违反了安全铁律。
  let cmdArgs = args?.args;
  if (cmdArgs === undefined || cmdArgs === null) {
    cmdArgs = [];
  }
  if (!Array.isArray(cmdArgs)) {
    throw new Error('args 必须是数组，不能是字符串。例如 ["-la"] 而不是 "-la"');
  }
  // 每一项必须是字符串
  for (let i = 0; i < cmdArgs.length; i++) {
    if (typeof cmdArgs[i] !== 'string') {
      throw new Error(`args[${i}] 必须是字符串`);
    }
  }

  // 命令名不能包含空格，也不能包含路径分隔符
  // （防止 AI 传 "./evil.sh" 或者 "ls; rm -rf /"）
  if (/\s/.test(command) || command.includes('/') || command.includes('\\')) {
    throw new Error(
      'command 只能是命令名（如 ls、node、git），不能带空格或路径。' +
      '如果你想执行某个脚本，把脚本路径放到 args 里。'
    );
  }

  const workspace = context?.workspace || process.cwd();
  const timeoutSec = clampTimeout(context?.config?.cmdTimeout);
  const env = buildSafeEnv();

  const startedAt = Date.now();

  const result = await runProcess({
    command,
    args: cmdArgs,
    cwd: workspace,
    env,
    timeoutMs: timeoutSec * 1000,
  });

  const durationMs = Date.now() - startedAt;

  // 组装返回给 AI 的文本
  const parts = [];
  parts.push(`$ ${command}${cmdArgs.length ? ' ' + cmdArgs.join(' ') : ''}`);
  parts.push(`(工作目录：${workspace}，耗时 ${formatDuration(durationMs)})`);
  parts.push('');

  if (result.output) {
    const cut = truncateBytes(result.output, MAX_OUTPUT_BYTES);
    parts.push(cut.text);
    if (cut.truncated) {
      parts.push('');
      parts.push(`[输出被截断，原始大小 ${formatBytes(cut.bytes)}，只显示前 100KB]`);
    }
  } else {
    parts.push('(没有输出)');
  }

  if (result.timedOut) {
    parts.push('');
    parts.push(`[命令超时，已强制终止（超过 ${timeoutSec} 秒）]`);
  }

  if (result.exitCode !== null && result.exitCode !== 0 && !result.timedOut) {
    parts.push('');
    parts.push(`[退出码 ${result.exitCode}]`);
  }

  if (result.error) {
    parts.push('');
    parts.push(`[错误] ${result.error}`);
  }

  const text = parts.join('\n');

  // 命令失败时，抛出异常会让 tool/index.js 返回 {ok:false}
  // 但我们希望 AI 看到输出（哪怕失败），所以只在真正的启动错误时抛
  if (result.spawnFailed) {
    throw new Error(text);
  }

  return text;
}

// ---------------------------------------------------------------
// 底层：跑进程
// ---------------------------------------------------------------

function runProcess({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,       // ⚠️ 铁律：绝不能 true
        windowsHide: true,  // Windows 上不弹黑框
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // spawn 同步抛出（罕见），直接返回失败
      resolve({
        output: '',
        exitCode: null,
        timedOut: false,
        error: friendlySpawnError(err, command),
        spawnFailed: true,
      });
      return;
    }

    let output = '';
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let killed = false;
    let spawnError = null;
    let settled = false;

    // 收集输出。超过上限就不再往字符串里塞，但继续读（防止管道堵塞）
    function collect(chunk) {
      if (outputTruncated) return;
      const size = chunk.length;
      if (outputBytes + size > MAX_OUTPUT_BYTES * 2) {
        // 留 2 倍余量，最终再统一截断。
        // 为什么留余量？因为 stderr 和 stdout 可能交错，
        // 我们想保留原始顺序，统一在最后再按字节截。
        const remain = Math.max(0, MAX_OUTPUT_BYTES * 2 - outputBytes);
        output += chunk.subarray(0, remain).toString('utf-8');
        outputBytes = MAX_OUTPUT_BYTES * 2;
        outputTruncated = true;
        return;
      }
      output += chunk.toString('utf-8');
      outputBytes += size;
    }

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    // 超时定时器
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    function killTree(proc) {
      if (!proc || killed) return;
      killed = true;
      try {
        if (process.platform === 'win32') {
          // Windows 上 spawn 一个 taskkill 来杀整棵树
          spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          // Unix 上给进程组发 SIGTERM，2 秒后再 SIGKILL
          try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
          setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
          }, KILL_GRACE_MS).unref?.();
        }
      } catch {
        // 进程可能已经死了，忽略
      }
    }

    child.on('error', (err) => {
      spawnError = friendlySpawnError(err, command);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      resolve({
        output,
        exitCode: code,
        timedOut,
        error: spawnError,
        spawnFailed: Boolean(spawnError),
        signal,
      });
    });
  });
}

// ---------------------------------------------------------------
// system_info —— 让 AI 自查环境
// ---------------------------------------------------------------

export async function system_info(args, context) {
  const p = detectPlatform();
  const workspace = context?.workspace || process.cwd();

  const lines = [
    `操作系统：${p.name}`,
    `平台标识：${p.id}（family: ${p.family}）`,
    `Node 版本：${process.version}`,
    `工作目录：${workspace}`,
    `示例命令：${p.exampleCmd}`,
  ];

  if (p.family === 'unix') {
    lines.push('提示：这是类 Unix 系统，支持 ls / cat / grep / chmod 等命令。');
  } else if (p.family === 'windows') {
    lines.push('提示：这是 Windows 系统，常见命令有 dir / type / findstr。');
    lines.push('     PowerShell 命令也支持，但要注意转义。');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------

function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_SEC;
  return Math.min(Math.max(n, 1), MAX_TIMEOUT_SEC);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatDuration(ms) {
  if (ms < 1000) return ms + ' ms';
  return (ms / 1000).toFixed(2) + ' 秒';
}
