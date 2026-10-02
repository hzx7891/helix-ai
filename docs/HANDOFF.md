# Helix 项目交接文档（完整版）

> **给所有 AI 协作者**：请完整读完这份文档，再开始任何工作。
> 这份文档包含你需要的全部背景，不需要向用户询问项目背景。
> 用户是一个 11 岁六年级学生，请严格遵守第十二节的沟通规则。

**文档版本**：v1.0
**最后更新**：2026-10-01
**当前项目版本**：v0.4.0

---

## 目录

1. 项目是什么
2. 为什么做这个
3. 协作者画像
4. 已锁定的技术决策
5. 安全红线
6. 目录结构
7. 前后端分工
8. WebSocket 协议
9. HTTP 接口
10. 配置字段详解
11. 权限模式详解
12. 工具清单详解
13. 审批流程时序
14. 错误码清单
15. 当前进度
16. 开发顺序
17. 已知问题与 Bug 库
18. 沟通规则
19. AI 交付格式
20. 术语表
21. 不要做的事
22. P0/P1/P2 判断标准
23. 版本与提交规范
24. 常见问题 FAQ

---

## 一、项目是什么

**名称**：Helix（螺旋）
**仓库**：https://github.com/hzx7891/helix-ai
**所有者**：hzx7891
**CLI 命令**：`helix`
**包名**：`helix-ai`
**启动方式**：`npx helix-ai`
**协议**：MIT
**一句话定位**：本地优先的 AI Agent 工作台

**用户体验目标**：
1. 用户在终端输入 `npx helix-ai`
2. 后端启动，自动打开浏览器
3. 浏览器地址形如 `http://127.0.0.1:3000/?token=xxx`
4. 在 WebUI 配置 API Key、模型、工作目录
5. 然后就能聊天，AI 可以调用工具（读写文件、跑命令、搜网页、渲染预览、反问用户）
6. 所有操作都在用户自己电脑上完成

**参考对象**：DSH（DeepSeek Shell）

**核心理念**：
- **本地优先**：API Key、配置、聊天记录、工作文件全部只存本地
- **不上云**：第一版不做登录、不做同步、不接 Supabase
- **安全**：危险操作必须审批；文件操作不能逃出工作目录
- **开源免费**：MIT 协议，npx 一键跑
- **高度可定制**：系统提示词、工具、模型、工作目录都能改

---

## 二、为什么做这个

**协作者的目标**：
1. 做出一个自己每天都能用的 AI Agent 工具
2. 学会 Node.js、WebSocket、AI 工具调用、权限设计
3. 上传到 GitHub，让别人也能用
4. 不奢求上 Trending，只希望有真实用户觉得有用

**他的原话**：
> "我觉得做这个有需要吗？人家为什么会用我这个？有 open code、dsh、cloud code。"
> "就算现在我整个仓库的 star 还是 0，而且唯一的还是我点的。"

**这个项目对他的意义不是"打败竞品"，而是**：
- 学会真本事
- 做出一个自己每天打开的工具
- 有一个真实项目放在 GitHub 上

**作为 AI 你应该做的**：
- 时不时鼓励他，但不要过度吹捧
- 他不需要虚假的赞美，他需要看到每一步的真实进展
- 每完成一步，明确告诉他"这一步真的做了什么"

---

## 三、协作者画像

**年龄**：11 岁，六年级上册

**时间安排**：
- 周一到周五：中午回家吃饭、下午上学
- 只有周末和国庆等假期能开发
- 每次开发时间有限，不能一次做太多

**技术水平**：
- **会**：注册 GitHub、创建仓库、提交 commit、用 github.dev（网页版 VS Code）、用 GitHub 网页上的铅笔图标编辑文件、一次上传一个文件、看懂一点 JavaScript
- **不会**：本地终端、npm install、git clone、独立写完整逻辑、后端、WebSocket、异步编程、用云端 VSCode 的终端、用 Codespaces

**他已明确表示**：
- 主要在手机上用 Termux 测试（已装 Node v26.4.0 + git + npm）
- 也可以在 github.dev 上编辑文件

**他已有的项目经验**：
1. **StarryChat**（github.com/hzx7891/starrychat）
   - 基于 Supabase + GitHub OAuth 的在线聊天室
   - 已部署到 GitHub Pages（hzx7891.github.io/starrychat/）
   - 功能：注册登录、建房间、发文字/图片/文件、@ai 问答、私聊、视频通话、消息搜索、深浅主题切换
   - 已配：404 页面、隐私政策、社区规则、站点地图
2. **starrychat-hzx**：WebSocket 版聊天室
3. **hzx7891.github.io**：个人博客
4. **starrychat-android**：Android 版客户端

**说明**：他有真实项目经验，懂 OAuth 登录流程、实时数据库、前端部署。但都是在 AI 帮助下完成的，不是独立手写。他能理解"功能是什么"，但不太理解"代码怎么实现"。

**他踩过的坑（来自 StarryChat 的经验，直接影响 Helix 设计）**：
- 图片存 base64 会占大量数据库空间
- 消息列表没有分页会越加载越慢
- 免费版 Supabase 在多用户 + 图片场景下扛不住

**这些经验直接影响 Helix 的设计**：
- 纯本地、不上云
- 工具结果要截断
- 聊天记录要分页（后续版本）

---

## 四、已锁定的技术决策（不得擅自更改）

### 4.1 后端技术栈

- Node.js 20+，ESM 模块（`package.json` 里写 `"type": "module"`）
- Express：HTTP 服务 + 托管 `public/` 静态文件
- ws：WebSocket 通信
- **只允许这两个依赖：express、ws**
- HTTP 请求用 Node 18+ 内置的 `fetch`，不装 axios
- 不引入 TypeScript、不引入构建工具、不引入 ORM、不引入数据库
- 不引入 monorepo（不要 turbo.json、不要 packages/）

### 4.2 前端技术栈

- 原生 HTML + CSS + JavaScript
- 不使用 React / Vue / Svelte / 任何框架
- 不使用 CDN 上的第三方库
- 不使用构建工具（Vite / Webpack 一律不上）
- 依赖只有浏览器自带 API（WebSocket、fetch、DOM）
- **前端是单文件 `public/index.html`**（含样式 + 逻辑 + Markdown 渲染器）

### 4.3 存储方案

- 配置：`~/.helix/config.json`（权限 0600）
- 聊天记录：浏览器 localStorage（第一版）
- 后端不持久化聊天记录
- 不接 Supabase，不做云同步，不做登录
- localStorage 存界面偏好（主题、预览开关、会话列表）

### 4.4 为什么不上云（已讨论并决定，不要推翻）

曾讨论过用 Supabase 做云同步，最终决定不做，原因：

1. API Key 绝对不能上云，上云就等于泄露
2. 免费版 Supabase 在多用户 + 图片场景下扛不住（StarryChat 已经踩过这个坑）
3. 加登录、token 刷新、离线同步、冲突处理会大幅增加复杂度
4. Helix 的定位就是"本地优先"，上云反而违背定位
5. 第一版应该先跑通"能聊天、能读文件"，云同步是第二阶段的事

**如果以后真要做云同步，方案是**：
- 设计成 BYOS（Bring Your Own Supabase）
- 用户自己填 Supabase 地址和 anonKey
- 默认关闭，永远不主动上传
- 只同步文字，不同步图片和文件
- 分页拉取、工具结果截断、压缩存储

### 4.5 端口与地址

- 默认端口 3000，被占用时自动 +1 直到找到空端口
- 启动时生成随机 token，打印到终端
- 访问地址：`http://127.0.0.1:<port>/?token=<token>`
- WebSocket：`ws://127.0.0.1:<port>/ws?token=<token>`
- token 错误时 WebSocket 立即断开（close code 4001）

### 4.6 数据存放位置

| 数据 | 存放位置 |
|------|---------|
| API Key、模型、工作目录、系统提示词 | `~/.helix/config.json` |
| 聊天记录 | 浏览器 localStorage |
| 界面偏好 | 浏览器 localStorage |
| 工作区文件 | 用户硬盘，AI 直接读写，不复制、不上传 |
| 预览内容 | 内存，通过 WebSocket 推给浏览器，不持久化 |
| 模型余额 | 实时查询，不存储 |

---

## 五、安全红线（每次提交前自检）

- [ ] API Key 不会出现在任何发给前端的数据里
- [ ] 文件操作无法逃出 workspace（用 `path.resolve` 判断前缀）
- [ ] 命令执行禁止 `shell: true` 拼接字符串（用 `spawn` + 参数数组）
- [ ] `run_command` 超时 30 秒，输出上限 100KB
- [ ] `write_file` / `edit_file` / `run_command` 默认触发审批
- [ ] 配置写入 `~/.helix/config.json`，权限 0600
- [ ] `.gitignore` 必须排除 `config.json`、`.env`、`node_modules`、`.helix`

**六条铁律（不能破）**：

1. **Key 只进不出**：API Key 可以写入配置文件，但绝不能出现在任何 HTTP 响应、WebSocket 消息、日志、错误信息里。前端只能拿到 `hasKey: true/false`。
2. **路径必须在 workspace 内**：所有文件操作必须用 `path.resolve(workspace, userPath)` 解析，然后检查结果是否以 workspace 开头。不在里面就拒绝。
3. **命令不能拼字符串**：用 `spawn(command, args, {shell: false})`，绝不用 `exec` 或 `spawn(command, {shell: true})`。
4. **危险操作必须审批**：写文件、改文件、删文件、跑命令，都要经过审批流程。
5. **配置文件权限 0600**：`chmod` 之后只有本用户能读写。
6. **前端不直接触碰 Key**：前端只通过 `POST /api/config` 提交一次，之后所有请求都不带 Key。

---

## 六、目录结构（严格按此）（看到此文档，必须读每个文件）

```
helix-ai/
├── README.md                # 项目介绍
├── LICENSE                  # MIT
├── .gitignore               # 排除 node_modules、config.json、.env、.helix
├── package.json             # "type": "module"、bin、dependencies
├── bin/
│   └── helix.js             # npx 入口：启动 server，打开浏览器
├── server/
│   ├── index.js             # 启动 HTTP + WebSocket，托管 public/
│   ├── llm.js               # 调用 AI 模型，流式返回
│   ├── config.js            # 读写 ~/.helix/config.json
│   ├── approval.js          # 权限审批调度
│   ├── balance.js           # 模型余额查询
│   └── tool/                # ⚠️ 单数 tool，不是 tools
│       ├── index.js         # 工具注册表
│       ├── file.js          # list_dir / read_file / write_file / edit_file / delete_path
│       ├── shell.js         # run_command
│       └── web.js           # web_search / fetch_url
├── public/
│   └── index.html           # 前端单文件（含样式 + 逻辑 + Markdown 渲染）
└── docs/
    ├── HANDOFF.md           # 本文件
    ├── CONTRACT.md          # 前后端接口契约
    └── CHANGELOG.md         # 版本变更记录
```

### 文件职责速查

| 文件 | 职责 | 谁负责 |
|------|------|--------|
| `bin/helix.js` | 找空闲端口、生成 token、启动后端、打开浏览器 | 后端 AI |
| `server/index.js` | Express + WebSocket 服务、托管 public/ | 后端 AI |
| `server/config.js` | 读写配置、Key 脱敏、权限 0600 | 后端 AI |
| `server/llm.js` | 调用模型、流式返回、工具调用循环 | 后端 AI |
| `server/approval.js` | 审批请求调度（前后端往返） | 后端 AI |
| `server/balance.js` | 查询模型余额 | 后端 AI |
| `server/tool/index.js` | 工具注册表 + 分发 | 后端 AI |
| `server/tool/file.js` | 文件操作工具 | 后端 AI |
| `server/tool/shell.js` | 命令执行工具 | 后端 AI |
| `server/tool/web.js` | 搜索和抓取工具 | 后端 AI |
| `public/index.html` | 全部前端 | 前端 AI |

---

## 七、前后端分工（重要）

**前端负责人**：另一个 AI（通过另一个对话窗口）
- 只改 `public/` 目录
- 负责界面、样式、Markdown 渲染、快捷键、localStorage、会话管理、预览面板
- 用户把前端代码贴到 github.dev

**后端负责人**：当前正在读这份文档的 AI
- 只改 `server/`、`bin/`、`package.json`
- 负责启动、配置、模型调用、工具执行、权限审批、WebSocket 服务
- 用户把代码贴到 github.dev

**两侧不能越界改对方的文件。**

需要改动交界处（协议）时：
1. 先在这个对话里说明
2. 等对方确认
3. 才能动

**擅自发明 WebSocket 消息类型 = 后端静默丢弃，前端要自己检查。**

---

## 八、WebSocket 协议（锁定）

### 8.1 连接

- 地址：`ws://127.0.0.1:<port>/ws?token=<token>`
- token 错误时：立即关闭，close code = 4001
- 连接成功后，服务端**立即**发一条 `ready` 消息

### 8.2 客户端 → 服务端（只有 3 种）

```json
{ "type": "user_message", "text": "帮我看看当前文件夹" }

{ "type": "approval", "requestId": "req_abc123", "decision": "allow" | "allow_always" | "deny", "answer": "仅 kind=question 时的文字回答" }

{ "type": "abort" }
```

**注意**：
- `user_message` 的 `text` 是用户输入的完整文本
- `approval` 的 `decision` 只有三个合法值：`allow`、`allow_always`、`deny`
- `answer` 只在 `kind=question` 时存在
- `abort` 没有其他字段

### 8.3 服务端 → 客户端（只有 10 种）

```json
1. { "type": "ready", "model": "deepseek-flash", "workspace": "/path" }
2. { "type": "assistant_delta", "text": "我来帮你查看" }
3. { "type": "reasoning_delta", "text": "用户想知道目录内容" }
4. { "type": "tool_start", "callId": "call_x", "name": "list_dir", "args": {"path": "."} }
5. { "type": "tool_end", "callId": "call_x", "ok": true, "result": "..." }
6. { "type": "approval_request", "requestId": "req_x", "kind": "permission" | "question", "title": "...", "detail": "...", "tool": "run_command" }
7. { "type": "preview", "html": "<!DOCTYPE html>..." }
8. { "type": "balance", "supported": true, "balance": {...} }
9. { "type": "done", "reason": "complete" | "aborted" | "error" }
10. { "type": "error", "message": "...", "code": "INVALID_API_KEY" }
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `callId` | 每次工具调用唯一，前后端靠它配对 |
| `requestId` | 每次审批请求唯一，前后端靠它配对 |
| `kind` | `permission`（权限类）或 `question`（提问类） |
| `tool` | 触发审批的工具名，可空 |
| `reason` | `complete` 正常结束 / `aborted` 用户中止 / `error` 出错 |
| `code` | 错误码，见第十四节 |

### 8.4 时序示例：一次工具调用

```
前端                          后端
 |                             |
 |-- user_message ------------>|
 |                             |  调用模型
 |<-- assistant_delta ---------|  （流式）
 |<-- reasoning_delta ---------|
 |<-- tool_start --------------|  （AI 想调用 list_dir）
 |                             |  执行工具
 |<-- tool_end ----------------|  （返回结果）
 |                             |  把结果塞回模型
 |<-- assistant_delta ---------|  （AI 继续回复）
 |<-- done --------------------|
 |                             |
```

### 8.5 时序示例：一次审批

```
前端                          后端
 |                             |
 |-- user_message ------------>|
 |                             |  AI 想跑命令
 |<-- approval_request --------|  （kind=permission）
 |                             |  等待
 |-- approval (allow) -------->|
 |                             |  执行命令
 |<-- tool_end ----------------|
 |<-- assistant_delta ---------|
 |<-- done --------------------|
```

---

## 九、HTTP 接口

### 9.1 GET /api/health

**用途**：健康检查，前端"测试连接"按钮用。

**请求**：无参数

**响应**：
```json
{
  "ok": true,
  "version": "0.0.1",
  "uptime": 123.45
}
```

### 9.2 GET /api/config

**用途**：读配置，Key 脱敏。

**响应**：
```json
{
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-flash",
  "workspace": "/home/user/project",
  "systemPrompt": "...",
  "permissionMode": "auto",
  "temperature": 0.7,
  "maxTokens": 4096,
  "cmdTimeout": 30,
  "hasKey": true
}
```

**注意**：永远不返回 `apiKey` 原文，只有 `hasKey`（布尔）。

### 9.3 POST /api/config

**用途**：更新配置。

**请求体**：可包含任意字段（除了 `hasKey`）

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-flash",
  "workspace": "/home/user/project",
  "systemPrompt": "...",
  "permissionMode": "work",
  "temperature": 0.7,
  "maxTokens": 4096,
  "cmdTimeout": 30
}
```

**响应**：脱敏后的完整配置（同 GET）

**关键行为**：
- **空字符串不覆盖已有值**（防止前端空输入框把配置抹掉）
- `apiKey` 只有非空时才更新
- 保存后 `chmod 0600`

### 9.4 GET /api/balance

**用途**：查询模型余额。

**响应（支持时）**：
```json
{
  "supported": true,
  "balance": {
    "total": 12.34,
    "currency": "CNY"
  }
}
```

**响应（不支持时）**：
```json
{ "supported": false }
```

---

## 十、配置字段详解

配置文件路径：`~/.helix/config.json`

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | string | `""` | API Key，只写不读 |
| `baseUrl` | string | `https://api.deepseek.com/v1` | 模型服务地址 |
| `model` | string | `deepseek-flash` | 模型名称 |
| `workspace` | string | `process.cwd()` | AI 可操作的工作目录 |
| `systemPrompt` | string | （见下） | 系统提示词 |
| `permissionMode` | string | `ask` | 权限模式 |
| `temperature` | number | `0.7` | 模型温度 |
| `maxTokens` | number | `4096` | 最大输出 token |
| `cmdTimeout` | number | `30` | 命令超时秒数 |

**默认系统提示词**：

```
你是一个本地 AI 助手，可以调用工具帮助用户。回答用中文，简洁清楚。
```

**关键规则**：
- `workspace` 是所有文件操作的根，AI 不能逃出这个目录
- `permissionMode` 只有 4 个合法值：`ask` / `auto` / `work` / `agent`
- 配置写入时必须 `chmod 0600`
- 保存时**空字符串不覆盖已有值**
- ---

## 十一、权限模式详解

### 11.1 四种模式

| 模式 | 只读工具 | 写/执行工具 | 典型用途 |
|------|---------|------------|---------|
| `ask` | ❌ 全部禁用 | ❌ 全部禁用 | 纯聊天，问问题 |
| `auto` | ✅ 直接放行 | ⚠️ 弹窗审批 | 日常开发（推荐） |
| `work` | ⚠️ 弹窗审批 | ⚠️ 弹窗审批 | 处理重要仓库 |
| `agent` | ✅ 直接放行 | ✅ 直接放行 | 完全信任，自动化 |

### 11.2 什么算"只读工具"

- `list_dir`
- `read_file`
- `web_search`
- `fetch_url`

### 11.3 什么算"写/执行工具"

- `write_file`
- `edit_file`
- `delete_path`
- `run_command`

### 11.4 特殊工具（永远需要用户交互）

- `ask_user` —— 无论什么模式，都会弹窗（因为它的目的就是问用户）
- `render_preview` —— 无论什么模式，都不弹窗（它只是把 HTML 推给前端预览，不碰文件系统）

### 11.5 模式切换

用户在前端点一下切换模式：
1. 前端更新本地状态
2. 前端通过 `POST /api/config` 把 `permissionMode` 传给后端
3. 后端更新运行时状态

**注意**：不能用 WebSocket 的 `set_mode` 消息。契约里没有这个类型。

### 11.6 "始终允许"

用户在审批弹窗里点「始终允许」时：
- 后端把该工具名加入本次运行的"白名单"
- 之后该工具的调用**不再弹窗**
- 白名单只在**本次运行**有效，重启后清空
- 前端在设置页显示白名单内容

---

## 十二、工具清单详解

### 12.1 list_dir

```json
{
  "name": "list_dir",
  "description": "List directory contents. Returns file names, sizes, and types.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Directory path relative to workspace. Use '.' for current."
      }
    },
    "required": ["path"]
  }
}
```

**返回格式**（示例）：
```
./
  src/          (目录)
    index.js    (1.2 KB)
    utils.js    (800 B)
  package.json  (450 B)
  README.md     (2.1 KB)
```

**安全**：path 必须解析后仍在 workspace 内。

### 12.2 read_file

```json
{
  "name": "read_file",
  "description": "Read file content. Max 100KB, truncates beyond.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path relative to workspace."
      }
    },
    "required": ["path"]
  }
}
```

**返回**：文件内容字符串。超过 100KB 时截断，末尾加 `\n[truncated]`。

**安全**：必须解析后仍在 workspace 内。

### 12.3 write_file

```json
{
  "name": "write_file",
  "description": "Write content to file. Creates if not exists. Requires approval.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "content": { "type": "string" }
    },
    "required": ["path", "content"]
  }
}
```

**触发审批**。

### 12.4 edit_file

```json
{
  "name": "edit_file",
  "description": "Replace exact text in file. oldText must match exactly once. Requires approval.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "oldText": { "type": "string" },
      "newText": { "type": "string" }
    },
    "required": ["path", "oldText", "newText"]
  }
}
```

**规则**：`oldText` 必须**精确匹配一次**。0 次或多次匹配都报错。

**触发审批**。

### 12.5 delete_path

```json
{
  "name": "delete_path",
  "description": "Delete file or directory. Requires approval.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": { "type": "string" }
    },
    "required": ["path"]
  }
}
```

**触发审批**。

### 12.6 run_command

```json
{
  "name": "run_command",
  "description": "Run shell command. Requires approval. Timeout 30s. Output limit 100KB.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "Command to execute."
      },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Command arguments as array. Do NOT use shell syntax."
      }
    },
    "required": ["command"]
  }
}
```

**实现**：
```javascript
spawn(command, args || [], {
  cwd: workspace,
  shell: false,        // ⚠️ 必须 false
  timeout: 30000,
});
```

**输出**：合并 stdout + stderr，超过 100KB 截断。

**触发审批**。

### 12.7 web_search

```json
{
  "name": "web_search",
  "description": "Search the web. Returns top 5 results (title + URL + snippet).",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    },
    "required": ["query"]
  }
}
```

**实现**：第一版用 DuckDuckGo HTML 端点，不用 API Key。

**返回**：
```
1. 标题
   https://example.com/...
   摘要文字...

2. 标题
   ...
```

### 12.8 fetch_url

```json
{
  "name": "fetch_url",
  "description": "Fetch URL and convert to plain text. Max 8000 chars.",
  "parameters": {
    "type": "object",
    "properties": {
      "url": { "type": "string" }
    },
    "required": ["url"]
  }
}
```

**实现**：
1. fetch URL
2. 去掉 `<script>` / `<style>`
3. 把 HTML 标签换成空格
4. 合并空白
5. 截断 8000 字符

### 12.9 render_preview

```json
{
  "name": "render_preview",
  "description": "Render HTML in the preview panel.",
  "parameters": {
    "type": "object",
    "properties": {
      "html": {
        "type": "string",
        "description": "Full HTML document to preview."
      }
    },
    "required": ["html"]
  }
}
```

**实现**：通过 WebSocket 推 `{type: "preview", html}` 给前端。

**不触发审批**。

### 12.10 ask_user

```json
{
  "name": "ask_user",
  "description": "Ask the user a question. Use when you need clarification.",
  "parameters": {
    "type": "object",
    "properties": {
      "question": { "type": "string" }
    },
    "required": ["question"]
  }
}
```

**实现**：通过 WebSocket 推 `{type: "approval_request", kind: "question", ...}`。

**永远弹窗**。

---

## 十三、审批流程时序（详细）

### 13.1 权限类审批

**触发**：AI 调用 `write_file` / `edit_file` / `delete_path` / `run_command`

**后端**：
```javascript
// 1. 检查权限模式
if (mode === 'agent') return executeDirectly();
if (mode === 'auto' && isReadOnlyTool(tool)) return executeDirectly();
if (mode === 'ask') throw new Error('工具在 ask 模式禁用');
if (alwaysAllowed.has(tool)) return executeDirectly();

// 2. 生成 requestId
const requestId = 'req_' + randomHex(8);

// 3. 推给前端
ws.send(JSON.stringify({
  type: 'approval_request',
  requestId,
  kind: 'permission',
  title: '权限请求',
  detail: 'AI 想要执行：' + tool + '\n参数：' + JSON.stringify(args, null, 2),
  tool,
}));

// 4. 等待前端回复（Promise）
const decision = await waitForApproval(requestId);

// 5. 根据 decision 处理
if (decision === 'deny') throw new Error('用户拒绝');
if (decision === 'allow_always') alwaysAllowed.add(tool);
return executeDirectly();
```

**前端**：
```javascript
// 收到 approval_request 时：
showApprovalModal({
  title, detail,
  buttons: [
    { text: '拒绝', decision: 'deny' },
    { text: '本次允许', decision: 'allow' },
    { text: '始终允许', decision: 'allow_always' },
  ]
});

// 用户点击后：
ws.send(JSON.stringify({
  type: 'approval',
  requestId,
  decision,
}));
```

### 13.2 提问类审批

**触发**：AI 调用 `ask_user`

**后端**：
```javascript
const requestId = 'req_' + randomHex(8);
ws.send(JSON.stringify({
  type: 'approval_request',
  requestId,
  kind: 'question',
  title: '需要你的输入',
  detail: question,
}));
const { answer } = await waitForApproval(requestId);
return answer;  // 把用户的回答当工具结果返回给 AI
```

**前端**：显示 textarea + 提交按钮，用户输入后通过 `approval` 消息回传 `answer`。

### 13.3 超时处理

- 审批等待超过 5 分钟 → 自动拒绝，AI 收到 `{ok: false, result: "用户未响应，已超时"}`
- 用户中断（点停止）→ 所有 pending 审批取消

---

## 十四、错误码清单

| code | 说明 | 前端显示 |
|------|------|---------|
| `INVALID_API_KEY` | API Key 错误 | "API Key 无效，请检查设置" |
| `NO_API_KEY` | 未配置 API Key | "请先在设置里填 API Key" |
| `MODEL_NOT_FOUND` | 模型名错误 | "模型名错误，请检查设置" |
| `RATE_LIMIT` | 请求过快 | "请求过快，请稍后重试" |
| `QUOTA_EXCEEDED` | 额度用尽 | "账户额度不足" |
| `NETWORK_ERROR` | 网络错误 | "网络连接失败" |
| `PATH_OUTSIDE_WORKSPACE` | 路径越界 | "文件路径超出工作目录" |
| `TOOL_NOT_FOUND` | 工具不存在 | "AI 调用了未知工具" |
| `APPROVAL_TIMEOUT` | 审批超时 | "审批超时" |
| `USER_ABORTED` | 用户中止 | （不显示错误，正常结束） |
| `UNKNOWN` | 其他 | 显示原始 message |

---

## 十五、当前进度

### ✅ 已完成

- `README.md` —— 项目介绍
- `LICENSE` —— MIT
- `.gitignore` —— 排除敏感文件
- `package.json` —— 依赖和入口
- `bin/helix.js` —— 启动入口，找端口、开浏览器
- `server/index.js` —— HTTP + WebSocket 服务
- `server/config.js` —— 读写配置，Key 脱敏
- `server/llm.js` —— 调用模型，流式返回（已跑通 DeepSeek）
- `public/index.html` —— 完整前端（单文件，163 KB，含样式 + 逻辑 + Markdown 渲染）

### ⏳ 待做（按顺序）

1. `server/tool/index.js` —— 工具注册表
2. `server/tool/file.js` —— 文件工具（list_dir、read_file、write_file、edit_file、delete_path）
3. `server/tool/shell.js` —— 命令工具（run_command）
4. `server/tool/web.js` —— 联网工具（web_search、fetch_url）
5. `server/approval.js` —— 权限审批调度
6. `server/balance.js` —— 余额查询
7. `server/llm.js` 改造 —— 支持工具调用循环
8. v1.0.0 发布

### 📋 尚未实现但已规划

- `render_preview` 工具
- `ask_user` 工具
- 语音朗读（前端已做，用 Web Speech API）
- 一键启动脚本 `start.bat`（Windows）
- Token 用量显示
- 四模式完整支持

---

## 十六、开发顺序（严格按此，每步可独立测试）

| 步骤 | 文件 | 验收标准 | commit 建议 |
|------|------|---------|------------|
| 0 | README + LICENSE + .gitignore | 仓库主页清晰，Key 不会上传 | 初始化仓库 |
| 1 | package.json + bin/helix.js + server/index.js | npx 能启动，浏览器打开 | 搭建后端骨架 |
| 2 | server/config.js + config 接口 | 能读写配置，Key 脱敏 | 实现配置读写 |
| 3 | WebSocket 握手 + ready | 浏览器连上收到 ready | 实现 WebSocket 连接 |
| 4 | server/llm.js + 最简对话 | 流式回答，Markdown 渲染 | 接入 AI 模型 |
| 5 | server/tool/index.js + file.js | AI 能列目录、读文件 | 实现工具系统 |
| 6 | server/approval.js | 写文件触发审批 | 实现权限审批 |
| 7 | server/tool/shell.js | 命令执行、超时、审批 | 实现命令执行 |
| 8 | server/tool/web.js | 搜索、抓网页 | 实现联网 |
| 9 | render_preview + ask_user | 预览面板出现内容 | 实现预览和提问 |
| 10 | GET /api/balance | 显示余额 | 实现余额查询 |
| 11 | 打包发布 v0.1.0 | npx 一条命令跑起来 | 发布 v0.1.0 |

**每完成一步，AI 要告诉用户**：
1. 这一步做了什么
2. 怎么测试它
3. 下一步做什么
4. 建议的 commit 信息（中文，一句话）

---

## 十七、已知问题与 Bug 库

### 17.1 前端 bug（待修）

**Bug #1：设置保存时空字符串覆盖有效配置**

- **现象**：用户在设置页保存时，如果 Base URL 输入框是空的，`baseUrl` 被存成 `""`
- **原因**：前端把空字符串原样发给后端
- **修复**：前端改成"值为空时跳过该字段，不放进 payload"
- **后端兜底**：`saveConfig` 里加空字符串过滤（已在最新版实现）

**Bug #2：placeholder 颜色太接近真实输入**

- **现象**：深色主题下，占位提示和真实输入看起来一样
- **修复**：placeholder 颜色调浅（`opacity: 0.5` 或更浅的灰）

**Bug #3：前端有未定义的消息类型 `set_mode`**

- **现象**：`public/index.html` 里有 `sendSocket({ type: 'set_mode', ... })`
- **原因**：前端 AI 自己发明的，不在契约里
- **修复**：前端删掉这两行（权限模式已通过 `POST /api/config` 传递）

### 17.2 后端 bug（暂无）

### 17.3 环境问题

**Termux 上 Node.js 版本很新（v26.4.0）**
- 不代表所有用户都这么新
- 后端代码要用 Node 20+ 兼容的语法
- 不要用 Node 21+ 才有的新特性

**github.dev 没有终端**
- 用户只能贴文件，不能运行
- 真正测试在 Termux 或本地终端

---

## 十八、沟通规则（必须遵守）

### 18.1 语言

- **用中文**
- 遇到术语先用一句话解释
- 例：
  > WebSocket 就像两人打电话，一直通着；HTTP 就像写信，发一封收一封。
  > 工具调用就像你让助手去拿文件，他回来告诉你文件里写了什么。
  > 权限审批就像家长同意，孩子要做危险的事之前必须先问一声。

### 18.2 交付节奏

- **一次只给一个文件**
- 不要一次给多个，他会跟不上
- 每个文件说清楚：放哪、干什么、怎么测试、下一步、commit 信息

### 18.3 教学方式

- 不假设他会命令行
- 所有操作按"点哪里、贴哪里"讲
- 遇到报错：
  1. 让他贴完整错误信息
  2. 用一句话解释错误是什么意思
  3. 告诉他改哪个文件、改哪一行
  4. 不要一次性改三个地方，先改最可能的那一个

### 18.4 鼓励方式

- 不过度吹捧
- 他不需要虚假的赞美
- 他看到真实进展就好
- 例：
  > 你今天跑通了本地 AI Agent 的完整链路，这是真实的进展。
  > 你不是在指挥 AI 写代码，你是在做真正的工程活。

### 18.5 判断取舍

- 如果他想加新功能，先判断这是 P0 / P1 / P2 哪个阶段
- 如果是 P1 / P2，告诉他：
  > 这个很好，但我们先记在 `docs/idea.md` 里，等第一版跑通再加。
- 不要让他分心

### 18.6 如果他犹豫

用现实判断：
- "第一版不做这个" 比 "你可以试试" 更有用
- 给他一个最小的、5 分钟能做完的任务

### 18.7 如果他遇到 bug

1. 让他把完整错误信息贴给你
2. 用一句话解释错误是什么意思
3. 告诉他改哪个文件、改哪一行
4. 不要一次性改三个地方，先改最可能的那一个

---

## 十九、AI 交付格式

每次给一个文件时，用这个格式：

```
─────────────────────────────
【第 N 步】文件名：xxx
─────────────────────────────
放在哪：具体路径
作用：一句话说明
─────────────────────────────
完整代码：
（代码块，可整段复制）
─────────────────────────────
怎么测试：在 github.dev 里做什么操作，
          看到什么效果算成功
下一步：下一步该建哪个文件
commit 建议：「完成 xxx」
─────────────────────────────
```

**注意**：
- 代码块必须能整段复制（不要插入解释）
- 代码里的注释要清楚
- 中文注释解释"为什么"，英文注释解释"是什么"

---

## 二十、术语表

| 术语 | 一句话解释 |
|------|-----------|
| API Key | 你的钥匙，能让程序用你的模型账号 |
| Base URL | 模型服务的网址 |
| WebSocket | 两人打电话，一直通着 |
| HTTP | 写信，发一封收一封 |
| Token | AI 的计费单位，也是它的"记忆块" |
| 流式 | AI 一个字一个字往外吐 |
| 工具调用 | AI 让你帮它拿东西 |
| 审批 | 危险操作前先问一声 |
| Workspace | AI 能操作的目录 |
| Markdown | 一种轻量的排版语法 |
| ESM | JavaScript 的模块规范，用 import/export |
| CJS | 老式 JavaScript 模块，用 require |
| 依赖 | 别人写好的代码库，你引用它 |
| npx | 临时下载并运行一个 npm 包 |
| npm | Node.js 的包管理器 |
| 端口 | 电脑上不同服务的门牌号 |
| token（认证） | 临时的通行证 |
| 脱敏 | 把敏感信息遮掉 |
| 沙盒 | 隔离的、安全的环境 |
| 预览 | 把 HTML 显示在侧边面板里 |
| 缓存命中 | 复用之前算过的结果，省钱又快 |

---

## 二十一、不要做的事

- 不接 Supabase
- 不做登录系统
- 不做云同步
- 不做多人协作
- 不做移动端 App
- 不做浏览器插件
- 不做 Electron / Tauri 桌面应用
- 不引入 TypeScript
- 不引入构建工具（Vite / Webpack）
- 不引入 ORM
- 不引入数据库
- 不引入 monorepo
- 不擅自发明 WebSocket 消息类型
- 不改契约里的字段名
- 不把 API Key 发到前端
- 不在代码里硬编码 API Key
- 不用 `shell: true` 拼命令
- 不用 `exec` 执行命令
- 不让文件操作逃出 workspace

---

## 二十二、P0 / P1 / P2 判断标准

**P0 —— 第一版必须做出来的**
- npx 启动、浏览器自动打开
- WebUI 设置页
- 聊天 + 流式回答 + Markdown 渲染
- 10 个工具调用
- 权限审批弹窗
- 4 种权限模式
- 右侧预览面板
- 余额查询
- 中断按钮

**P1 —— 第二阶段**
- 聊天记录保存到后端
- 会话列表、切换历史
- 自定义搜索引擎
- 外挂识图模型
- Git 平台自动化
- AI 浏览器（能打开网页、点击、截图）

**P2 —— 第三阶段**
- 实时预览双向编辑
- 多服务商切换
- HTTPS 隧道
- 多用户会话隔离

**判断规则**：
- 用户提出新想法 → 先问"这是哪个阶段"
- 如果是 P1 / P2 → 记进 `docs/idea.md`，不实现
- 如果是 P0 → 看它是否阻塞当前正在做的步骤
- 阻塞 → 先做；不阻塞 → 记下来，做完当前的再做

---

## 二十三、版本与提交规范

### 23.1 版本号

- 格式：`主版本.次版本.修订号`
- 当前：`v0.0.1`
- 改动协议：+0.0.1
- 完成 P0：升到 `v1.0.0`

### 23.2 commit 信息

- **中文**，一句话
- 格式：动词 + 对象
- 例：
  - 「初始化仓库」
  - 「搭建后端骨架」
  - 「实现配置读写」
  - 「实现 WebSocket 连接」
  - 「接入 AI 模型，实现流式对话」
  - 「实现工具系统与文件读取」
  - 「实现权限审批」
  - 「实现命令执行」
  - 「实现联网搜索与网页抓取」
  - 「实现预览渲染与用户提问」
  - 「实现余额查询」
  - 「发布 v0.1.0」

### 23.3 仓库操作流程

用户的日常操作：

1. 在 GitHub 打开 `helix-ai` 仓库
2. 按键盘 `.` 进入 github.dev
3. 在左侧文件树里新建/编辑文件
4. 把 AI 给的代码粘进去
5. 在源代码管理面板写 commit 信息
6. 点 Commit & Push

**注意**：
- github.dev **没有终端**
- 不能运行 npm install
- 不能运行后端
- 真正的测试要在 Termux 或本地终端

---

## 二十四、常见问题 FAQ

**Q：为什么不一次给我多个文件？**

A：用户是 11 岁孩子，一次只跟得上一个文件。多个文件会让他迷失，粘贴时容易漏掉或贴错。

**Q：为什么后端只能有两个依赖？**

A：降低复杂度，减少安装失败的可能。用户不一定有稳定的网络环境。

**Q：为什么不用 TypeScript？**

A：用户看不懂 TS 语法。用原生 JS，他能看懂的代码更利于他理解。

**Q：为什么前端不用框架？**

A：不用构建工具，代码贴进去就能跑。用户在 github.dev 里没有终端，跑不了 build。

**Q：为什么不上云？**

A：见第 4.4 节。API Key 不能上云，免费版扛不住，复杂度太高。

**Q：为什么 AI 只能操作用户的 workspace？**

A：安全。不能让 AI 随意读写用户电脑上任何位置的文件。

**Q：为什么命令执行禁止 shell: true？**

A：防止命令注入。如果 AI 说 `run_command("rm -rf /")`，用 shell 拼接会直接执行。用参数数组则安全得多。

**Q：为什么配置文件要 0600 权限？**

A：API Key 存在里面。0600 表示只有本用户能读写，其他用户看不到。

**Q：如果 AI 想加一个消息类型怎么办？**

A：先说明，等对方（前端或后端）确认，加入契约，再实现。不能自己发明。

**Q：如果用户报错，我应该先改哪里？**

A：先改最可能的那一处。不要一次改三个地方，因为改多了你不知道哪个起了作用。

**Q：如果用户说"我想放弃"怎么办？**

A：
1. 不要虚假鼓励
2. 用事实说话：
   - 你已经做出了 StarryChat
   - 你已经设计了 Helix 的品牌图标
   - 你已经写好了完整的技术方案
   - 你只是还没开始写第一行代码
3. 给他一个最小的、5 分钟能做完的任务
4. 让他重新感受"我能做出来"

**Q：如果用户想加 P1 / P2 的功能怎么办？**

A：告诉他"这个很好，但我们先记在 `docs/idea.md` 里，等第一版跑通再加"。不要让他分心。

**Q：如何验证我写的代码是对的？**

A：让用户在 Termux 里跑：
```bash
cd ~/helix-ai
node bin/helix.js
```
然后在手机浏览器打开 `http://127.0.0.1:3000/?token=xxx`。

**Q：如果改动涉及前后端两侧怎么办？**

A：
1. 在这个对话里说明改动
2. 让用户把改动转达给另一个对话窗口的 AI
3. 两侧都改完，再测试
4. 测试通过，双方版本号 +0.0.1

**Q：如果用户提到"契约"是什么？**

A：本文件第八、九节的 WebSocket 消息协议和 HTTP 接口。是前后端双方都必须遵守的规则。

**Q：如果用户问"缓存命中率"是什么？**

A：用考试比喻：
> 想象你考试时带了一张小抄（缓存）。老师问一道题，如果你小抄上有现成答案，直接抄（命中），又快又省力。如果小抄上没有，你得当场翻书重新算（未命中），又慢又费劲。
> 在 AI 里，缓存命中就是"你发的问题，AI 之前已经算过一遍了"，直接复用，速度快，价格只有未命中的十分之一。

**Q：如果用户问"Token 利用率"是什么？**

A：
> Token 是 AI 的"计费字数"。你对 AI 说的每句话、AI 回你的每句话，都要按 Token 收费。
> "把 Token 利用率压缩到极致"就是"想办法少花钱"。
> 具体做法：截断工具结果、限制聊天历史、优先用浏览器本地能力（如 TTS）。

**Q：如果用户问"我们和竞品比怎么样"？**

A：老实回答：
- 现有工具如 OpenCode、Cursor、Claude Code 都很强，Star 数很高
- Helix 的差异化在于：**完全本地、开源免费、代码能看懂、中文友好、npx 一键跑**
- 不和它们正面竞争，只在一个小点上更懂用户
- 第一版只求"能跑通"，不追求对标

---

## 结尾

**这份文档是项目的总纲。每次开新对话，第一句话就是：**

> 请先读 https://raw.githubusercontent.com/hzx7891/helix-ai/main/docs/HANDOFF.md 再开始工作。

**文档会随项目进展更新。修改文档后，把版本号 +0.1。**

**当前文档版本：v1.0**

**END OF HANDOFF**

