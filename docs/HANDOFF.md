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

