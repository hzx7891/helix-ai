<div align="center">

# 🧬 Helix

**本地优先的 AI Agent 工作台**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)

一条命令启动，在浏览器里和 AI 聊天。  
AI 可以读写你电脑上的文件、执行命令、搜索网页、渲染预览。  
所有数据留在本地。

</div>

---

## 这是什么？

Helix（螺旋）是一个**本地优先**的 AI Agent 工作台。

在终端输入：

```bash
npx helix-ai
```

它会：

1. 在你的电脑上启动一个小型后端
2. 自动打开浏览器
3. 让你在网页里配置 API Key、模型、工作目录
4. 然后就可以和 AI 聊天，并让 AI 调用工具

和普通聊天机器人的区别：Helix 里的 AI **能动手**。  
它可以查看文件夹、读文件、写文件、跑命令、搜网页、在右侧预览 HTML。

---

## 为什么做 Helix？

市面上已经有 OpenCode、DSH、Claude Code 这样的工具。  
Helix 不想正面打败谁，它只想做好几件小事：

- **本地优先**：API Key、配置、聊天记录、工作文件都留在你自己的电脑上
- **不上云**：第一版没有登录、没有同步、不接 Supabase
- **安全**：危险操作必须经过你同意；文件操作不能逃出工作目录
- **开源免费**：MIT 协议，`npx` 一键运行
- **可定制**：系统提示词、工具、模型、工作目录都能改
- **中文友好**：界面和文档默认中文

---

## 第一版目标（v0.1.0）

- [ ] `npx helix-ai` 启动，自动打开浏览器
- [ ] WebUI 设置：API Key、Base URL、模型、工作目录、系统提示词
- [ ] 聊天：流式回答，实时 Markdown 渲染
- [ ] 工具调用：
  - [ ] `list_dir` 列目录
  - [ ] `read_file` 读文件
  - [ ] `write_file` 写文件（审批）
  - [ ] `edit_file` 精确替换（审批）
  - [ ] `delete_path` 删除（审批）
  - [ ] `run_command` 执行命令（审批，30 秒超时）
  - [ ] `web_search` 联网搜索
  - [ ] `fetch_url` 抓网页转纯文本
  - [ ] `render_preview` 渲染 HTML 预览
  - [ ] `ask_user` 向用户提问
- [ ] 权限审批弹窗：拒绝 / 本次允许 / 始终允许
- [ ] 权限模式：`ask` / `auto` / `readonly`
- [ ] 右侧预览面板
- [ ] 模型余额查询
- [ ] 中断按钮

> 当前状态：**开发中**。仓库正在从零搭建，README 会随着版本更新。

---

## 安全与隐私

Helix 的设计原则是：**你的电脑，你的数据。**

| 数据 | 存放位置 |
| --- | --- |
| API Key、模型、工作目录、系统提示词 | `~/.helix/config.json`（权限 0600） |
| 聊天记录 | 第一版只在内存，刷新即丢 |
| 界面偏好（主题、预览开关） | 浏览器 `localStorage` |
| 工作区文件 | 你自己的硬盘，AI 直接读写，不复制、不上传 |
| 预览内容 | 内存，通过 WebSocket 推给浏览器，不持久化 |

安全红线：

- API Key 不会出现在任何发给前端的数据里
- 文件操作不能逃出工作目录
- 命令执行禁止 `shell: true` 拼接字符串
- `run_command` 超时 30 秒，输出上限 100KB
- `write_file` / `edit_file` / `run_command` 默认触发审批
- 配置文件权限 0600
- `.gitignore` 排除 `config.json`、`.env`、`node_modules`、`.helix`

---

## 技术栈

**后端**

- Node.js 20+
- ESM 模块
- Express（HTTP 服务 + 静态文件）
- ws（WebSocket）
- 仅此两个依赖
- HTTP 请求用 Node 内置 `fetch`

**前端**

- 原生 HTML + CSS + JavaScript（ESM）
- 无框架、无构建工具、无 CDN 依赖
- 只使用浏览器自带 API

**存储**

- 纯本地，不接数据库，不接 Supabase
- 配置：`~/.helix/config.json`
- 聊天记录：第一版内存，后续版本 `~/.helix/sessions/*.json`

---

## 快速开始

> 开发中，以下命令将在 v0.1.0 发布后可用。

```bash
npx helix-ai
```

启动后终端会打印类似：

```text
Helix 已启动
打开：http://127.0.0.1:3000/?token=xxxxxxxx
```

浏览器会自动打开。如果没有，手动复制地址访问。

首次使用：

1. 点右上角「设置」
2. 填入 API Key、Base URL、模型
3. 选择工作目录
4. 保存，开始聊天

---

## 目录结构

```text
helix-ai/
├── README.md
├── LICENSE
├── .gitignore
├── package.json
├── bin/
│   └── helix.js             # npx 入口
├── server/
│   ├── index.js             # HTTP + WebSocket
│   ├── llm.js               # 调用 AI 模型
│   ├── config.js            # 读写 ~/.helix/config.json
│   ├── approval.js          # 权限审批
│   ├── balance.js           # 余额查询
│   └── tools/
│       ├── index.js         # 工具注册表
│       ├── file.js          # 文件工具
│       ├── shell.js         # 命令工具
│       └── web.js           # 搜索与抓取
├── public/
│   ├── index.html
│   ├── app.js
│   ├── markdown.js
│   ├── style.css
│   └── helix.svg
└── docs/
    ├── idea.md
    ├── CONTRACT.md
    └── CHANGELOG.md
```

---

## 路线图

**P0 — 第一版**

聊天、流式回答、工具调用、审批、预览、余额、中断。

**P1 — 第二阶段**

聊天记录保存、会话列表、自定义搜索引擎、外挂识图、Git 平台自动化、AI 浏览器。

**P2 — 第三阶段**

实时预览双向编辑、多服务商切换、HTTPS 隧道、多用户会话隔离。

**明确不做**

- 不接 Supabase
- 不做用户登录
- 不做云同步
- 不做多人协作
- 不做移动端 App
- 不做浏览器插件
- 不做桌面应用（不打包 Electron / Tauri）

---

## 常见问题

**Q：Helix 和 ChatGPT 有什么区别？**  
A：ChatGPT 在云端，Helix 在你电脑上。Helix 的 AI 能读写你的文件、跑命令、看网页，而且 API Key 不出本地。

**Q：会上传我的代码吗？**  
A：不会。只有你主动让 AI 调用的内容，才会发给你配置的模型服务商。文件本身不会被上传到 Helix 的服务器——因为 Helix 没有服务器。

**Q：支持哪些模型？**  
A：第一版支持 OpenAI 兼容接口。只要填对 Base URL 和模型名，DeepSeek、OpenAI、Ollama 等都可以尝试。

**Q：为什么叫 Helix？**  
A：Helix 是螺旋。对话和工具在 Agent 循环里反复缠绕，像 DNA 双螺旋。

---

## 贡献

欢迎提 Issue 和 Pull Request。  
如果你是第一次参与开源，可以从 `good first issue` 开始。

---

## 协议

MIT © hzx7891

---

<div align="center">

🧬 **Helix** · 本地优先的 AI Agent 工作台

</div>
