# 🧬 Helix

**本地优先的 AI Agent 工作台 · v0.6.0**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-helix--ai--cn-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/helix-ai-cn)
[![Version](https://img.shields.io/badge/version-0.6.0-ff69b4)](https://github.com/hzx7891/helix-ai)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)
[![Made with ❤️](https://img.shields.io/badge/Made%20with-%E2%9D%A4%EF%B8%8F-red.svg)](https://github.com/hzx7891/helix-ai)

一条命令启动，在浏览器里和 AI 聊天。  
AI 可以读写你电脑上的文件、执行命令、搜索网页、渲染预览、在终端里跑给你看。  
**所有数据留在本地。**

> **v0.6.0 史诗级重构**：多模型热切换、极客 CLI 客户端、内嵌拟真终端、UUID 会话隔离、AI 自动标题、任务块、流式体验三大 Bug 修复。  
> 这是 Helix 迄今为止最硬核的一个版本。

---

## 目录

- [这是什么](#这是什么)
- [为什么做 Helix](#为什么做-helix)
- [特性一览](#特性一览)
- [安装](#安装)
- [快速开始](#快速开始)
- [首次使用](#首次使用)
- [界面介绍](#界面介绍)
  - [顶栏](#顶栏)
  - [左侧边栏](#左侧边栏)
  - [中间对话区](#中间对话区)
  - [右侧预览面板](#右侧预览面板)
  - [设置抽屉](#设置抽屉)
  - [命令面板](#命令面板)
  - [查找栏](#查找栏)
- [多模型配置（Profiles）](#多模型配置profiles)
- [CLI 客户端](#cli-客户端)
- [内置工具](#内置工具)
- [工具详解](#工具详解)
  - [list_dir](#list_dir)
  - [read_file](#read_file)
  - [write_file](#write_file)
  - [edit_file](#edit_file)
  - [delete_path](#delete_path)
  - [run_command](#run_command)
  - [system_info](#system_info)
  - [web_search](#web_search)
  - [fetch_url](#fetch_url)
  - [render_preview](#render_preview)
  - [ask_user](#ask_user)
  - [whoami](#whoami)
  - [update_tasks](#update_tasks)
- [权限模式](#权限模式)
- [审批流程](#审批流程)
- [安全与隐私](#安全与隐私)
  - [六条铁律](#六条铁律)
  - [关于上传](#关于上传)
- [数据存放位置](#数据存放位置)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [文件职责速查](#文件职责速查)
- [WebSocket 协议锁定](#websocket-协议锁定)
- [HTTP 接口](#http-接口)
- [配置文件](#配置文件)
- [会话存储](#会话存储)
- [系统提示词](#系统提示词)
- [快捷键](#快捷键)
- [路线图](#路线图)
- [性能与体积](#性能与体积)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [协议](#协议)

---

## 这是什么

Helix 是一个**本地优先**的 AI Agent 工作台。

在终端输入：

```bash
npx helix-ai-cn
```

它会：

1. 在你电脑上启动一个小型后端（Node.js）
2. 自动打开浏览器
3. 让你在网页里配置 API Key、模型、工作目录
4. 然后就能和 AI 聊天，并让 AI 调用工具

和普通聊天机器人的区别：**Helix 里的 AI 能动手。**

它可以列目录、读文件、写文件、跑命令、搜网页、抓网页、在右侧面板渲染 HTML、在工具卡片里展开一个**真实的拟真终端**、向你提问、查询自己的身份、维护任务清单。

**默认情况下，每一次“写入”和“执行”，它都会先问你一句。**（`agent` 模式除外，见 [权限模式](#权限模式)。）

**v0.6.0 更进一步**：你可以在设置里无限添加模型配置（Profiles），顶部菜单一键热切换；也可以在终端里直接用 CLI 客户端聊天，纯文本流式输出，带跨会话记忆。浏览器不再是唯一入口。

---

## 为什么做 Helix

市面上已经有 OpenCode、DSH、Claude Code 这类工具。  
Helix 不打算正面打败谁，它只想把几件小事做好。

### 本地优先

API Key 存在 `~/.helix/config.json`，聊天记录存在 `~/.helix/sessions/<uuid>/`，工作文件留在你自己的硬盘上。没有登录，没有同步，没有云端存储。断网也能用（配合本地模型时）。

### 不上云

第一版没有登录，没有同步，不接 Supabase。没有 Helix 的服务器。所有请求都是从你的电脑直接发往你配置的模型服务商，中间没有任何中转。

### 安全边界

文件操作不能逃出工作目录。命令执行禁止 `shell: true` 拼接字符串。危险操作必须经过你同意。

### 开源免费

MIT 协议。源代码全部公开。npx 一行启动，不装任何额外东西。

### 极致轻量

npm 发布包 **122.7 kB**，解压后 **440.3 kB**，运行时只有 2 个依赖（express + ws）。没有框架，没有构建工具，没有 CDN。CLI 客户端同样零额外依赖。

### 终端原生

v0.6.0 新增 `run.mjs` 和 `chat.mjs`。在 Termux 或任何终端里，不需要浏览器，直接流式聊天。AI 执行命令时，工具卡片里展开的拟真终端让整个过程像在看本地 Terminal。

### 高度可定制

系统提示词、工具、模型、工作目录都能改。工具注册表是开放的，加一个工具只需要写一个文件。多模型配置随便加，热切换不重启。

### 中文友好

界面和文档默认中文。没有机翻的尴尬。

---

## 特性一览

- ✅ **流式对话** — AI 的回答一个字一个字往外吐，实时渲染 Markdown
- ✅ **多模型热切换** — 🆕 无限添加 Profiles（DeepSeek / Kimi / OpenAI / Ollama…），顶部菜单一键切换，每个对话独立绑定，无需重启
- ✅ **极客 CLI 客户端** — 🆕 `run.mjs` / `chat.mjs`，终端里自动拉起后端并连接 WebSocket，纯文本流式输出，带跨会话记忆
- ✅ **内嵌拟真终端** — 🆕 AI 执行 `run_command` 时，工具卡片里展开真实终端，支持 ANSI 颜色、进度条覆盖，4 套拟真皮肤
- ✅ **任务块** — 🆕 AI 干长任务时列出清单，实时打勾，进度一目了然
- ✅ **AI 自动标题** — 🆕 第一轮对话结束，后台模型静默总结 4-8 字主题，更新到侧边栏
- ✅ **UUID 会话隔离** — 🆕 每个会话独立 UUID 文件夹，`meta.json` / `history.json` / `tool_logs.jsonl` 三文件分离，彻底解决同名冲突
- ✅ **流式体验修复** — 🆕 修复滚动条强制拽回、卡片折叠弹回、页面疯狂闪烁三大恶性 Bug
- ✅ **工具调用** — AI 可以调用 13 个内置工具，覆盖文件、命令、联网、界面、身份、任务
- ✅ **权限审批** — 危险操作弹窗确认，三档决定：拒绝 / 本次允许 / 始终允许
- ✅ **4 种权限模式** — `ask` / `auto` / `work` / `agent`
- ✅ **右侧预览面板** — AI 生成的 HTML 直接渲染，可拖拽调宽
- ✅ **会话持久化** — 保存在 `~/.helix/sessions/<uuid>/`，重启不丢
- ✅ **刷新恢复** — 刷新页面后，未完成的任务自动恢复
- ✅ **附件读取** — 上传文本文件，内容自动拼进消息
- ✅ **审计与限流** — 所有工具调用留档，防止 AI 疯狂请求
- ✅ **余额查询** — 支持 DeepSeek 的余额接口
- ✅ **模型无锁定** — 兼容任意 OpenAI 协议接口，随时切换
- ✅ **跨平台** — Windows / macOS / Linux / Termux 一致体验
- ✅ **中文界面** — 默认中文，没有语言障碍

---

## 安装

### 方式一：npx（推荐，无需安装）

```bash
npx helix-ai-cn
```

启动后终端会打印一个地址：

```text
🧬 Helix 已启动
   地址：http://127.0.0.1:3000/?token=xxxxxxxx
   工作目录：/your/workspace

   按 Ctrl+C 停止
```

浏览器会自动打开。如果没有，手动复制地址访问。

### 方式二：git clone（适合想改代码的）

```bash
git clone https://github.com/hzx7891/helix-ai.git
cd helix-ai
npm install
node bin/helix.js
```

### 方式三：源码运行

如果你已经 clone 过：

```bash
cd helix-ai
node bin/helix.js
```

### 方式四：CLI 模式（v0.6.0 新增）

不想开浏览器？直接在终端里聊：

```bash
# 启动 CLI 聊天客户端（自动拉起后端 + 连接 WebSocket）
node chat.mjs

# 或者只拉起后端，用 run.mjs 做其他事
node run.mjs
```

- `run.mjs` — 启动器。检查本地是否已有 Helix 后端，没有就自动拉起（随机空闲端口），生成 token，连接 WebSocket，保持会话。
- `chat.mjs` — 基于 `run.mjs` 的交互式聊天客户端。纯文本流式输出，工具调用可见，审批内联，支持 `/new`、`/sessions`、`/load`、`/profile`、`/mode`、`/exit` 等 Slash 命令。

Termux 用户尤其推荐：不用开浏览器，内存压力小，纯终端体验。

### 系统要求

- **Node.js 20 或更高**
- 支持 Windows / macOS / Linux / Termux（Android）
- 任意现代浏览器（Chrome / Edge / Firefox / Safari）——CLI 模式不需要浏览器

### 检查 Node 版本

```bash
node -v
```

如果低于 20，请去 [nodejs.org](https://nodejs.org) 下载新版。

---

## 快速开始

复制，粘贴，回车。三步。

```bash
# 1. 启动
npx helix-ai-cn

# 2. 打开浏览器（通常会自动打开）
# 地址类似 http://127.0.0.1:3000/?token=xxxxx

# 3. 设置里填入 API Key、Base URL、模型名，保存
```

然后就可以开始对话了。

### 🆕 终端党快速通道（CLI）

不想开浏览器？两条命令，直接在终端里聊：

```bash
# 1. 克隆或 npx 安装后，进入项目目录
cd helix-ai

# 2. 启动 CLI 聊天客户端（会自动拉起后端）
node chat.mjs
```

`chat.mjs` 会自动完成以下事情：

1. 检查本地是否已有 Helix 后端在跑
2. 没有就自动拉起（随机空闲端口）
3. 连接 WebSocket
4. 进入交互式聊天界面

纯文本流式输出，工具调用可见，审批内联，支持跨会话记忆。Termux、SSH、无图形界面环境首选。

---

## 首次使用

1. 点右上角 **⚙️ 设置**
2. 在「模型」标签页添加你的第一个 **Profile**：
   - **名称** — 给这个配置起个名字，比如 `DeepSeek`
   - **API Key** — 你的模型服务商密钥
   - **Base URL** — 兼容 OpenAI 协议的接口地址
   - **模型名称** — 例如 `deepseek-chat`、`gpt-4o-mini`、`qwen-max`
3. 设置 **工作目录** — AI 能操作的根目录
4. 保存

然后就可以在输入框里说话了。

想加第二个模型？点「添加配置」，填 Kimi 或 OpenAI，保存。顶部菜单一键切换。

### 试试这几句

- 「列出当前目录下的文件结构」
- 「读一下 README.md，用三句话总结」
- 「用 Python 写一个快速排序，带中文注释」
- 「在预览面板渲染一个呼吸的渐变球」
- 「搜一下 Vite 当前最新的稳定版本号」
- 「你运行在什么系统上？」
- 「跑一下 npm test，把输出展示在终端里」
- 「帮我规划一个 5 步的重构任务清单」

---

## 界面介绍

### 顶栏

左边是 logo、连接状态。右边依次是：

- **模型选择器** — 🆕 显示当前 Profile 名称，点开下拉菜单，列出所有已配置的模型，**一键热切换**。切换后当前对话立刻使用新模型，无需重启，无需刷新。
- **权限模式** — 点一下循环切换
- **余额** — 点一下刷新
- **查找 / 命令面板 / 预览 / 主题 / 设置** — 五个图标按钮

### 左侧边栏

- **新建对话** — 开一个新会话（自动生成 UUID）
- **筛选框** — 按标题搜索会话
- **会话列表** — 按时间分组（今天 / 昨天 / 最近七天 / 更早）。🆕 开启「AI 自动标题」后，第一轮对话结束会自动显示 4-8 字主题，不再是一长串用户消息。
- **导出 / 导入 / 清空** — 三个底部按钮

### 中间对话区

- **消息流** — 用户消息、AI 回答、思考过程、工具卡片、🆕 任务卡片、🆕 终端卡片
- **输入框** — 支持多行，Enter 发送，Shift+Enter 换行
- **附件按钮** — 上传文本文件（会读取内容）
- **语音输入** — 用浏览器语音识别
- **发送 / 停止** — 一个按钮切换

🆕 **流式体验修复**：滚动条不再被强制拽回底部，卡片折叠不再弹回，页面不再疯狂闪烁。长回答读起来终于不打架了。

### 右侧预览面板

- **自动打开** — 当 AI 调用 `render_preview` 时
- **手动开关** — 顶栏预览图标
- **可拖拽宽度** — 桌面端支持
- **刷新 / 新窗口打开 / 关闭** — 三个按钮

### 设置抽屉

七个标签页（🆕 新增「模型配置」）：

1. **通用** — 工作目录、界面语言、正文字号、🆕 AI 自动标题开关、行为开关
2. **模型配置（Profiles）** — 🆕 无限添加模型配置，每个配置独立保存 API Key / Base URL / 模型名；支持重命名、删除、设为默认；支持测试连接
3. **权限** — 权限模式单选、已放行工具列表、命令超时
4. **提示词** — 系统提示词编辑、5 个快速预设、导出、恢复默认
5. **快捷键** — 显示所有快捷键列表
6. **终端皮肤** — 🆕 选择内嵌终端外观：macOS / Win11 / Win10 / Termux，可跟随系统自动匹配
7. **关于** — 版本号、仓库地址、开源协议、重置全部数据

### 命令面板

快捷键 Ctrl+K。内置命令：

- 新建对话
- 打开设置
- 🆕 切换模型（列出所有 Profiles）
- 切换主题
- 切换预览面板
- 在当前对话中查找
- 导出全部会话
- 导入会话
- 复制当前对话
- 导出为 Markdown
- 重新生成上一条
- 切换到 ask / auto / work / agent 模式
- 🆕 切换终端皮肤
- 清空当前对话 / 清空全部会话

### 查找栏

快捷键 Ctrl+F。输入关键词，显示匹配数量，Enter 下一个，Shift+Enter 上一个。

---

## 多模型配置（Profiles）

> v0.6.0 核心卖点之一。告别“改 Key 重启”的原始时代。

### 什么是 Profile

一个 Profile 就是一套完整的模型配置：

```json
{
  "id": "deepseek-1",
  "name": "DeepSeek",
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com/v1",
  "model": "deepseek-chat"
}
```

你可以添加任意多个。比如：

- `DeepSeek` — 日常开发，便宜大碗
- `Kimi` — 长文本阅读
- `OpenAI GPT-4o` — 复杂推理
- `Ollama 本地` — 断网可用

### 如何切换

**方式一：顶栏菜单**

点顶栏的模型名称 → 下拉列表 → 点一下目标 Profile。当前对话立刻切换。

**方式二：命令面板**

Ctrl+K → 输入「切换模型」→ 选择目标 Profile。

**方式三：CLI**

在 `chat.mjs` 里输入 `/profile kimi` 切换。

### 每个对话独立绑定

切换 Profile 只影响**当前对话**。新开的对话会使用你设置的默认 Profile。历史对话保留它当时使用的模型记录，不会因为全局切换而混乱。

### 配置文件结构

```json
{
  "profiles": [
    { "id": "deepseek-1", "name": "DeepSeek", "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat" },
    { "id": "kimi-1", "name": "Kimi", "apiKey": "sk-...", "baseUrl": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k" }
  ],
  "activeProfileId": "deepseek-1",
  "workspace": "/home/user/project",
  "systemPrompt": "你是一个本地 AI 助手...",
  "permissionMode": "auto",
  "temperature": 0.7,
  "maxTokens": 4096,
  "cmdTimeout": 30,
  "autoTitle": true,
  "terminalSkin": "auto"
}
```

**安全规则不变**：API Key 只进不出，前端只能拿到 `hasKey: true/false`。

---

## CLI 客户端

> v0.6.0 重大更新。Termux 党、SSH 党、终端原教旨主义者的福音。

### 为什么做 CLI

浏览器很好，但有时候你就是在 Termux 里，或者 SSH 到一台没有图形界面的机器，或者单纯不想开浏览器。CLI 客户端让你在终端里完成一切。

### 两个文件

| 文件 | 作用 |
|------|------|
| `run.mjs` | 自动拉起后端（如果没启动）、生成 token、连接 WebSocket、保持会话 |
| `chat.mjs` | 基于 `run.mjs` 的交互式聊天客户端，纯文本流式输出 |

### 启动

```bash
node chat.mjs
```

它会：

1. 检查本地是否已有 Helix 后端在跑
2. 没有就自动拉起（随机空闲端口）
3. 连接 WebSocket
4. 进入交互式聊天界面

### 特性

- **纯文本流式输出** — 一个字符一个字符往外吐，和 WebUI 一样的体验
- **跨会话记忆** — 退出后重新进入，可以继续之前的会话（`/sessions` 查看，`/load <uuid>` 加载）
- **工具调用可见** — AI 调工具时终端里显示 `[tool] list_dir {"path":"."}`，结果回来显示 `[ok]` 或 `[fail]`
- **审批内联** — 需要审批时直接在终端里问 `允许执行？[y/N/a]`，`a` 表示始终允许
- **Slash 命令** — `/new`、`/sessions`、`/load`、`/profile`、`/mode`、`/exit`
- **ANSI 颜色** — 工具结果、错误信息、任务清单一目了然

### 示例会话

```text
$ node chat.mjs
🧬 Helix CLI · 已连接 ws://127.0.0.1:3000/ws
   模型：DeepSeek (deepseek-chat)
   工作目录：/home/user/project
   输入 /help 查看命令

> 帮我看看当前目录结构

[assistant] 我来列出当前目录。
[tool] list_dir {"path":"."}
[ok] src/  package.json  README.md
当前目录有 src/、package.json 和 README.md。src/ 下应该还有...

> 跑一下 npm test

[assistant] 执行 npm test。
[tool] run_command {"command":"npm","args":["test"]}
⚠️  需要审批：run_command npm test
允许执行？[y/N/a] y
[ok] PASS  tests/...
所有测试通过。
```

### Termux 友好

在 Android 的 Termux 里：

```bash
pkg install nodejs
npx helix-ai-cn --cli
```

或者直接：

```bash
node chat.mjs
```

没有浏览器卡顿，没有内存压力，纯终端体验。

---

## 内置工具

| 工具 | 作用 | 需要审批 | v0.6.0 |
|------|------|:--------:|:------:|
| `list_dir` | 列出目录内容 | — | |
| `read_file` | 读取文件（上限 100 KB） | — | |
| `write_file` | 写入文件（创建或覆盖） | ✅ | |
| `edit_file` | 精确替换文件中的文本 | ✅ | |
| `delete_path` | 删除文件或目录 | ✅ | |
| `run_command` | 执行 shell 命令（内嵌终端视图） | ✅ | 🆕 终端 |
| `system_info` | 查询运行环境 | — | |
| `web_search` | 用 Bing 搜索网页 | — | |
| `fetch_url` | 抓取网页并转为纯文本 | — | |
| `render_preview` | 在右侧面板渲染 HTML | — | |
| `ask_user` | 反过来问用户问题 | 永远弹窗 | |
| `whoami` | 查询自己的身份 | — | |
| `update_tasks` | 更新任务清单 | — | 🆕 |

---

## 工具详解

### list_dir

列一层目录，不递归。返回文件名、大小、是不是目录。目录在前，文件在后，同类按字母排序。

```text
目录：src
  components/  (目录)
  utils/       (目录)
  index.js     (1.2 KB)
  router.js    (3.4 KB)
```

### read_file

读文本文件。上限 100 KB。超过会截断，末尾加 `[truncated]`。

### write_file

写文件。文件不存在就创建，已存在就覆盖。父目录不存在会自动建。

**会触发审批。**

### edit_file

精确替换文件中的文本。`oldText` 必须在文件中**精确出现一次**。

- 出现 0 次 → 报错“未找到”
- 出现多次 → 报错“匹配到多个位置”
- 恰好 1 次 → 替换成 `newText`

**会触发审批。**

### delete_path

删除文件或目录。删目录会递归删除里面所有东西。

**会触发审批。**

### run_command

> v0.6.0 最硬核的更新：**内嵌拟真终端**。

跑 shell 命令。命令和参数**分开传**：

```json
{
  "command": "ls",
  "args": ["-la"]
}
```

**不能**写成一整句 `"ls -la"`。这是为了防止命令注入。

**规则**：

- 超时 30 秒（可配置）
- 输出上限 100 KB
- 敏感环境变量（带 `KEY`、`TOKEN`、`SECRET`、`PASSWORD` 的）会被过滤
- 超时会杀掉**整个进程树**，不只是父进程

**会触发审批。**

#### 🆕 内嵌拟真终端

AI 执行 `run_command` 时，工具卡片里不再只是一段干巴巴的文本。你可以**展开一个真实的终端窗口**，实时看到命令输出流式渲染。

- **实时流式渲染** — stdout / stderr 逐行推送到前端，像在看本地终端
- **ANSI 颜色** — 支持标准 ANSI 转义序列，`git diff`、`ls --color`、`npm` 的输出颜色正常显示
- **进度条覆盖** — 正确处理 `\r` 回车覆盖，`npm install` 的进度条不会变成一坨乱码
- **4 套拟真皮肤**：
  - 🍎 **macOS** — 红黄绿圆点，半透明标题栏，SF Mono 字体
  - 🪟 **Win11** — Tab 页签，圆角窗口，Fluent 风格
  - 🪟 **Win10** — PowerShell 深蓝背景，经典控制台
  - 📱 **Termux** — 荧光绿文字，黑底，极客感拉满
- **自动匹配** — 默认跟随你的操作系统；也可以在设置里手动锁定
- **可折叠** — 终端卡片默认收起，点一下展开，不打扰阅读

```text
┌─ 🍎 Terminal ─────────────────────────────┐
│ $ npm test                                 │
│ PASS  tests/unit.test.js                   │
│ PASS  tests/integration.test.js            │
│                                            │
│ Test Suites: 2 passed, 2 total             │
│ Tests:       14 passed, 14 total           │
│ Time:        3.421 s                       │
└────────────────────────────────────────────┘
```

### system_info

让 AI 知道运行环境：

- 操作系统（Termux / Windows / Linux / macOS）
- 平台标识
- Node 版本
- 工作目录
- 示例命令

**为什么重要**：Termux 上要用 `ls`，Windows 上要用 `dir`。AI 知道自己在哪里，才能选对命令。v0.6.0 的终端皮肤也会根据这个信息自动匹配。

### web_search

用 Bing 公开页面搜索。返回前 5 条结果的标题、链接、摘要。不需要 API Key。

**限流**：30 秒内最多 10 次。

### fetch_url

抓网页转纯文本。三种模式：

- **`text`（默认）** — 剥掉 HTML 标签，只留文字
- **`html`** — 原始源码，用于找 `<meta>`、JSON-LD、内嵌数据
- **`links`** — 列出页面所有 `<a>` 链接

支持 `offset` 分页参数，长页面可以分段读。

**限流**：30 秒内最多 20 次。

### render_preview

把 HTML 推给前端右侧预览面板。上限 500 KB。**不触发审批。**

### ask_user

反过来问用户问题。无论什么权限模式都会弹窗。

### whoami

让 AI 知道自己的身份：

- 模型名
- 服务商（DeepSeek / OpenAI / Kimi / 通义 等）
- 调用地址
- 🆕 当前 Profile 名称
- 工作目录
- 权限模式
- 可用工具清单
- Helix 版本号

**关键设计**：做成工具而不是写进系统提示词。因为用户可以改提示词，但工具清单走的是 API 的 `tools` 字段，用户改不掉。

### update_tasks

> v0.6.0 新增。AI 干长任务时的进度条。

AI 可以列出一个任务清单，并实时更新每一项的状态。前端渲染为任务卡片，每完成一项打一个勾。

```json
{
  "tasks": [
    { "id": "1", "text": "读取 package.json", "done": true },
    { "id": "2", "text": "分析依赖版本", "done": true },
    { "id": "3", "text": "升级 express 到最新版", "done": false },
    { "id": "4", "text": "运行测试验证", "done": false }
  ]
}
```

**不触发审批。** 它只是更新 UI 状态，不碰文件、不跑命令。

**为什么需要它**：长任务里，AI 说“我正在做 A、B、C”很容易让人迷失。任务卡片让进度可视化，你能一眼看到还剩几步。

---

## 权限模式

| 模式 | 只读工具 | 写/执行工具 | 用途 |
|------|:--------:|:-----------:|------|
| `ask` | ❌ 全部禁用 | ❌ 全部禁用 | 纯聊天，问问题 |
| `auto` | ✅ 直接放行 | ⚠️ 弹窗审批 | 日常开发（推荐） |
| `work` | ⚠️ 弹窗审批 | ⚠️ 弹窗审批 | 处理重要仓库 |
| `agent` | ✅ 直接放行 | ✅ 直接放行 | 完全信任，自动化 |

### 什么算只读工具

`list_dir`、`read_file`、`web_search`、`fetch_url`、`whoami`、`system_info`、`update_tasks`

### 什么算写/执行工具

`write_file`、`edit_file`、`delete_path`、`run_command`

### 特殊工具

- **`ask_user`** — 无论什么模式都弹窗
- **`render_preview`** — 无论什么模式都不弹窗
- **`update_tasks`** — 无论什么模式都不弹窗

### CLI 下的权限

CLI 客户端里，审批变成终端内联提问：

```text
⚠️  需要审批：run_command npm test
允许执行？[y/N/a]
```

`y` 本次允许，`N` 拒绝，`a` 始终允许（本次运行内）。

---

## 审批流程

### 触发条件

AI 调用 `write_file` / `edit_file` / `delete_path` / `run_command` 时。

### 流程

1. AI 想调工具 → 后端检查权限模式
2. 需要审批 → 生成 requestId → 通过 WebSocket 推给前端
3. 前端弹窗 → 用户点按钮 → 前端发 `approval` 消息回来
4. 后端收到 → 解开 Promise → 执行或拒绝

### 三个选项

- **拒绝** — 不执行
- **本次允许** — 执行这一次
- **始终允许** — 加入本次运行的白名单，之后不再弹窗，重启后清空

### 超时

等待超过 5 分钟 → 自动拒绝。

### 🆕 CLI 下的审批

CLI 客户端同样走 WebSocket 审批协议，只是渲染方式变成终端内联提问。`a` 选项对应 `allow_always`。

---

## 安全与隐私

### 六条铁律

1. **Key 只进不出** — API Key 绝不能出现在 HTTP 响应、WebSocket 消息、日志、错误信息里。前端只能拿到 `hasKey: true/false`。
2. **路径必须在 workspace 内** — 用 `path.resolve` + `path.relative` 判断。
3. **命令不能拼字符串** — 用 `spawn(command, args, {shell: false})`。
4. **危险操作必须审批**。
5. **配置文件权限 0600**。
6. **前端不直接触碰 Key**。

### 🆕 多模型下的 Key 安全

每个 Profile 的 `apiKey` 独立存储，读取时统一脱敏。切换 Profile 时前端只发 `profileId`，后端从配置文件里取真实 Key，Key 永远不经过前端。

### 关于上传

Helix 本身不会上传任何东西。

但需要说明：**当你把代码片段作为上下文发给模型时，这部分内容会随请求发送到你配置的模型服务商。** 这是任何 AI Agent 都绕不开的环节。

Helix 能保证的是：除了这个必要的模型请求之外，它不会把数据发给任何其他第三方，也没有埋点与遥测。

---

## 数据存放位置

| 数据 | 存放位置 |
|------|---------|
| API Key、模型、工作目录、系统提示词 | `~/.helix/config.json`（权限 0600） |
| 聊天记录 | `~/.helix/sessions/<uuid>/`（🆕 UUID 隔离） |
| 界面偏好 | 浏览器 `localStorage` |
| 工作区文件 | 你自己的硬盘，AI 直接读写，不复制、不上传 |
| 预览内容 | 内存，通过 WebSocket 推给浏览器，不持久化 |
| 模型余额 | 实时查询，不存储 |
| 🆕 终端输出 | 内存，通过 WebSocket 推给前端，不持久化 |
| 🆕 任务清单 | 随会话保存在 `history.json` 内 |

---

## 技术栈

### 后端

- Node.js 20+
- ESM 模块（`"type": "module"`）
- Express（HTTP 服务 + 静态文件托管）
- ws（WebSocket 通信）
- **仅此两个依赖**
- HTTP 请求用 Node 18+ 内置的 `fetch`

### 前端

- 原生 HTML + CSS + JavaScript
- 无框架（不用 React / Vue / Svelte）
- 无构建工具（不用 Vite / Webpack）
- 无 CDN 依赖
- 只使用浏览器自带 API（WebSocket、fetch、DOM）

### 🆕 CLI

- 纯 Node.js 脚本（`run.mjs` / `chat.mjs`）
- 不引入任何 CLI 框架（不用 commander / yargs / ink）
- 使用 Node 内置 `readline` + `ws`
- ANSI 颜色手动拼转义序列

### 存储

- 纯本地，不接数据库，不接 Supabase
- 配置：`~/.helix/config.json`
- 会话：`~/.helix/sessions/<uuid>/meta.json` + `history.json` + `tool_logs.jsonl`

---

## 目录结构

```text
helix-ai/
├── README.md
├── LICENSE                      # MIT
├── .gitignore
├── package.json
├── run.mjs                      # 🆕 CLI 启动器（拉起后端 + 连接 WS）
├── chat.mjs                     # 🆕 CLI 聊天客户端
├── bin/
│   └── helix.js                 # npx 入口
├── server/
│   ├── index.js                 # HTTP + WebSocket 服务
│   ├── llm.js                   # 调用模型，流式返回
│   ├── config.js                # 读写配置，Key 脱敏
│   ├── profiles.js              # 🆕 多模型配置管理
│   ├── approval.js              # 权限审批调度
│   ├── balance.js               # 余额查询
│   ├── session.js               # 会话持久化（UUID）
│   ├── tasks.js                 # 流式任务快照
│   └── tool/                    # ⚠️ 单数 tool
│       ├── index.js             # 工具注册表
│       ├── file.js              # 文件工具
│       ├── shell.js             # 命令工具 + 终端流
│       ├── web.js               # 联网工具
│       ├── ui.js                # 界面工具（预览 / 提问）
│       ├── tasks.js             # 🆕 任务块工具
│       ├── whoami.js            # 身份工具
│       └── audit.js             # 审计 + 限流
├── public/
│   ├── index.html               # HTML 骨架
│   ├── script.js                # 前端主逻辑
│   ├── style.css                # 样式
│   ├── markdown.js              # Markdown 渲染器
│   ├── terminal.js              # 🆕 内嵌终端渲染器
│   └── favicon.svg              # 图标
└── docs/
    ├── HANDOFF.md               # 交接文档
    └── idea.md                  # 想法池
```

---

## 文件职责速查

| 文件 | 职责 |
|------|------|
| `bin/helix.js` | 找空闲端口、生成 token、启动后端、打开浏览器 |
| `run.mjs` | 🆕 CLI 启动器：检查/拉起后端、连接 WebSocket |
| `chat.mjs` | 🆕 CLI 聊天客户端：交互式输入、流式渲染、内联审批 |
| `server/index.js` | Express + WebSocket 服务、托管 public/ |
| `server/config.js` | 读写配置、Key 脱敏、权限 0600 |
| `server/profiles.js` | 🆕 多模型配置 CRUD、切换、脱敏 |
| `server/llm.js` | 调用模型、流式返回、工具调用循环 |
| `server/approval.js` | 审批请求调度（前后端往返） |
| `server/balance.js` | 查询模型余额 |
| `server/session.js` | 会话持久化（UUID 文件夹） |
| `server/tasks.js` | 流式任务快照 |
| `server/tool/index.js` | 工具注册表 + 分发 |
| `server/tool/file.js` | 文件操作工具 |
| `server/tool/shell.js` | 命令执行工具 + 终端输出流 |
| `server/tool/web.js` | 搜索和抓取工具 |
| `server/tool/ui.js` | 预览和提问工具 |
| `server/tool/tasks.js` | 🆕 任务块工具 |
| `server/tool/whoami.js` | 身份查询工具 |
| `server/tool/audit.js` | 工具调用审计 + 限流 |
| `public/index.html` | 前端 HTML |
| `public/script.js` | 前端主逻辑 |
| `public/style.css` | 前端样式 |
| `public/markdown.js` | Markdown 渲染器 |
| `public/terminal.js` | 🆕 内嵌终端渲染器（4 套皮肤） |

---

## WebSocket 协议锁定

### 连接

```text
ws://127.0.0.1:<port>/ws?token=<token>
```

token 错误时立即关闭，close code = 4001。

### 客户端 → 服务端（只有 3 种）

```json
{ "type": "user_message", "text": "..." }
{ "type": "approval", "requestId": "req_xxx", "decision": "allow|allow_always|deny", "answer": "..." }
{ "type": "abort" }
```

### 服务端 → 客户端（v0.6.0 共 13 种）

**1. ready** — 连接成功

```json
{ "type": "ready", "model": "deepseek-chat", "workspace": "/path", "profile": "DeepSeek" }
```

**2. assistant_delta** — 正文流式增量

```json
{ "type": "assistant_delta", "text": "我来帮你看看" }
```

**3. reasoning_delta** — 思考过程流式增量

```json
{ "type": "reasoning_delta", "text": "用户想知道目录内容" }
```

**4. tool_start** — 工具开始执行

```json
{ "type": "tool_start", "callId": "call_x", "name": "list_dir", "args": {"path": "."} }
```

**5. tool_end** — 工具执行完毕

```json
{ "type": "tool_end", "callId": "call_x", "ok": true, "result": "..." }
```

**6. 🆕 terminal_chunk** — 终端流式输出（`run_command` 专用）

```json
{ "type": "terminal_chunk", "callId": "call_x", "stream": "stdout", "text": "PASS  tests/unit.test.js\n" }
```

`stream` 可选 `stdout` / `stderr`。前端渲染器负责解析 ANSI 转义和 `\r` 覆盖。

**7. 🆕 task_update** — 任务清单更新

```json
{
  "type": "task_update",
  "tasks": [
    { "id": "1", "text": "读取 package.json", "done": true },
    { "id": "2", "text": "分析依赖版本", "done": false }
  ]
}
```

**8. approval_request** — 请求审批

```json
{ "type": "approval_request", "requestId": "req_x", "kind": "permission|question", "title": "...", "detail": "...", "tool": "run_command" }
```

**9. preview** — 推预览内容

```json
{ "type": "preview", "html": "<!DOCTYPE html>..." }
```

**10. balance** — 余额信息

```json
{ "type": "balance", "supported": true, "balance": {...} }
```

**11. 🆕 title_update** — AI 自动标题更新

```json
{ "type": "title_update", "sessionId": "uuid-xxx", "title": "重构终端视图" }
```

**12. done** — 本次回答结束

```json
{ "type": "done", "reason": "complete|aborted|error" }
```

**13. error** — 错误

```json
{ "type": "error", "message": "...", "code": "INVALID_API_KEY" }
```

---

## HTTP 接口

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/config` | 读取配置（Key 脱敏） |
| POST | `/api/config` | 更新配置 |
| GET | `/api/balance` | 查询模型余额 |
| GET | `/api/stats` | 工具调用统计 |
| GET | `/api/audit` | 最近的工具调用记录 |
| POST | `/api/audit/reset` | 清空审计 |
| GET | `/api/session/list` | 列出所有会话 |
| GET | `/api/session/load/:uuid` | 读取某个会话（🆕 UUID） |
| POST | `/api/session/delete/:uuid` | 删除某个会话（🆕 UUID） |
| GET | `/api/task/:id` | 查询流式任务快照 |
| POST | `/api/task/:id/abort` | 中止流式任务 |
| 🆕 GET | `/api/profiles` | 列出所有 Profiles（Key 脱敏） |
| 🆕 POST | `/api/profiles` | 添加 / 更新 Profile |
| 🆕 DELETE | `/api/profiles/:id` | 删除 Profile |
| 🆕 POST | `/api/profiles/switch` | 切换当前 Profile |
| 🆕 GET | `/api/profiles/:id/test` | 测试 Profile 连接 |

---

## 配置文件

路径：`~/.helix/config.json`

```json
{
  "profiles": [
    {
      "id": "deepseek-1",
      "name": "DeepSeek",
      "apiKey": "sk-...",
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat"
    },
    {
      "id": "kimi-1",
      "name": "Kimi",
      "apiKey": "sk-...",
      "baseUrl": "https://api.moonshot.cn/v1",
      "model": "moonshot-v1-8k"
    }
  ],
  "activeProfileId": "deepseek-1",
  "workspace": "/home/user/project",
  "systemPrompt": "你是一个本地 AI 助手...",
  "permissionMode": "auto",
  "temperature": 0.7,
  "maxTokens": 4096,
  "cmdTimeout": 30,
  "autoTitle": true,
  "terminalSkin": "auto"
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `profiles` | array | `[]` | 🆕 多模型配置列表 |
| `activeProfileId` | string | `""` | 🆕 当前激活的 Profile ID |
| `workspace` | string | `process.cwd()` | AI 可操作的工作目录 |
| `systemPrompt` | string | （见下） | 系统提示词 |
| `permissionMode` | string | `auto` | 权限模式 |
| `temperature` | number | `0.7` | 模型温度 |
| `maxTokens` | number | `4096` | 最大输出 token |
| `cmdTimeout` | number | `30` | 命令超时秒数 |
| `autoTitle` | boolean | `true` | 🆕 AI 自动生成会话标题 |
| `terminalSkin` | string | `auto` | 🆕 终端皮肤：`auto` / `macos` / `win11` / `win10` / `termux` |

**关键规则**：

- 保存时**空字符串不覆盖已有值**
- 写入后 `chmod 0600`
- **API Key 只进不出**
- 🆕 Profile 的 `apiKey` 同样只进不出

---

## 会话存储

v0.6.0 起，每个会话独立 UUID 文件夹，彻底解决同名冲突：

```text
~/.helix/sessions/
  └── 550e8400-e29b-41d4-a716-446655440000/
      ├── meta.json        # 元数据（标题、模型、Profile、时间戳）
      ├── history.json     # 完整对话
      └── tool_logs.jsonl  # 每行一条工具调用日志
```

### meta.json

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "重构终端视图",
  "profileId": "deepseek-1",
  "model": "deepseek-chat",
  "createdAt": "2025-06-01T10:00:00Z",
  "updatedAt": "2025-06-01T10:30:00Z"
}
```

### 🆕 AI 自动标题

开启 `autoTitle` 后，第一轮对话结束，后端会静默调用一次模型（低 token），总结 4-8 字主题，写入 `meta.json`，并通过 WebSocket 推送 `title_update`。侧边栏立刻更新，不打断对话。

### 🆕 UUID 隔离的好处

- 两个对话可以叫同一个名字，不会互相覆盖
- 导入 / 导出按 UUID 精确操作
- CLI 和 WebUI 共享同一套会话（`/load <uuid>`）
- 会话文件结构清晰，方便脚本处理

---

## 系统提示词

默认：

```text
你是一个本地 AI 助手，可以调用工具帮助用户。回答用中文，简洁清楚。
```

用户可以在设置页改。

五个预设：默认 / 极简回答 / 教学讲解 / 代码审查 / 架构设计。

🆕 v0.6.0 的系统提示词里会额外注入：

- 当前 Profile 名称和模型名
- 终端皮肤偏好（让 AI 知道输出环境）
- `update_tasks` 的使用提示（长任务建议列清单）

---

## 快捷键

| 操作 | 快捷键 |
|------|-------|
| 打开命令面板 | `Ctrl + K` |
| 切换侧边栏 | `Ctrl + B` |
| 在当前对话中查找 | `Ctrl + F` |
| 切换预览面板 | `Ctrl + \` |
| 打开设置 | `Ctrl + ,` |
| 新建对话 | `Ctrl + N` |
| 切换深浅主题 | `Ctrl + J` |
| 聚焦输入框 | `Ctrl + L` |
| 清空当前对话 | `Ctrl + Shift + K` |
| 🆕 切换模型（Profiles） | `Ctrl + Shift + M` |
| 🆕 切换终端皮肤 | `Ctrl + Shift + T` |
| 关闭弹窗 / 面板 | `Esc` |

> 注：如果你的 Markdown 渲染器对表格里的反斜杠处理异常，可把 `Ctrl + \` 改为 `Ctrl + 反斜杠` 或 `Ctrl + Backslash`。

---

## 路线图

### P0 — 第一版 ✅ 已完成（v0.5.0）

- [x] `npx helix-ai-cn` 启动，自动打开浏览器
- [x] WebUI 设置：API Key、Base URL、模型、工作目录、系统提示词
- [x] 聊天：流式回答，实时 Markdown 渲染
- [x] 12 个内置工具
- [x] 权限审批弹窗
- [x] 4 种权限模式
- [x] 右侧预览面板
- [x] 模型余额查询
- [x] 中断按钮
- [x] 会话持久化
- [x] 刷新后恢复未完成任务
- [x] 附件读取文本内容
- [x] 工具调用审计 + 限流

### P1 — 第二阶段 ✅ 已完成（v0.6.0）

- [x] 多模型配置（Profiles）热切换
- [x] 极客 CLI 客户端（`run.mjs` / `chat.mjs`）
- [x] 内嵌拟真终端（4 套皮肤 + ANSI + 进度条覆盖）
- [x] AI 自动生成标题
- [x] UUID 严格会话隔离持久化
- [x] 流式输出体验极致优化（修复滚动条拽回 / 卡片弹回 / 页面闪烁）
- [x] 任务块（`update_tasks`）
- [x] 前端启动时主动拉配置
- [x] 余额自动刷新
- [x] 终端视图（实时看 AI 跑命令）
- [x] 终端皮肤系统（macOS / Win11 / Win10 / Termux）
- [x] workspace 可配置
- [x] 审批优化（批量 / 范围授权 / 会话白名单）
- [x] 前后端会话打通
- [x] Markdown 渲染器升级

### P2 — 第三阶段

- [ ] 云 Agent 部署
- [ ] AI 浏览器集成
- [ ] 多服务商切换 UI（更细粒度的路由）
- [ ] HTTPS 隧道
- [ ] 实时预览双向编辑
- [ ] 插件系统

### 明确不做

- ❌ 不接 Supabase
- ❌ 不做用户登录
- ❌ 不做云同步
- ❌ 不做多人协作
- ❌ 不做移动端 App
- ❌ 不做浏览器插件
- ❌ 不打包 Electron / Tauri
- ❌ 不引入 TypeScript
- ❌ 不引入构建工具
- ❌ 不引入数据库 / ORM

---

## 性能与体积

- **npm 发布包**：122.7 kB
- **解压后**：440.3 kB
- **加 node_modules**：约 3.2 MB
- **依赖数量**：2 个（express、ws）
- **CLI 额外依赖**：0 个
- **内嵌终端额外依赖**：0 个（手写 ANSI 解析）

> v0.6.0 新增了这么多功能，发布包只涨了约 35.7 kB。没有引入任何新的运行时依赖。

---

## 常见问题

**Q：Helix 和 ChatGPT 有什么区别？**

A：ChatGPT 在云端，Helix 在你电脑上。Helix 的 AI 能读写你的文件、跑命令、看网页，而且 API Key 不出本地。

**Q：会上传我的代码吗？**

A：不会。只有你主动让 AI 调用的内容，才会发给你配置的模型服务商。文件本身不会被上传到任何 Helix 的服务器——因为 Helix 没有服务器。

**Q：支持哪些模型？**

A：任何兼容 OpenAI Chat Completions 协议的接口：

- DeepSeek（`https://api.deepseek.com/v1`）
- OpenAI（`https://api.openai.com/v1`）
- Ollama（`http://localhost:11434/v1`）
- 通义千问、智谱、Kimi 等
- 各类兼容中转服务

🆕 而且可以同时配置多个，热切换。

**Q：多模型配置切换会丢历史吗？**

A：不会。每个对话独立绑定 Profile，历史记录里保存了当时使用的模型。切换只影响当前对话的后续请求。

**Q：CLI 模式需要浏览器吗？**

A：不需要。`chat.mjs` 纯终端运行，自动拉起后端并连接 WebSocket。Termux 上体验极佳。

**Q：内嵌终端和真实终端有区别吗？**

A：它渲染的是 `run_command` 的实时输出流，支持 ANSI 颜色和 `\r` 覆盖。它不是完整的 PTY，不能交互式输入（比如 `vim`），但看命令输出、进度条、彩色日志完全够用。

**Q：为什么叫 Helix？**

A：Helix 是螺旋。对话和工具在 Agent 循环里反复缠绕，像 DNA 双螺旋。

**Q：为什么只有两个依赖？**

A：依赖越多，攻击面越大、安装越慢、长期维护越难。v0.6.0 加了这么多功能，依然只有 express 和 ws。

**Q：能在手机上跑吗？**

A：可以，通过 Termux。🆕 而且现在有 CLI 客户端，手机上不用开浏览器也能聊。

**Q：Windows 上能跑吗？**

A：可以。Helix 只依赖 Node.js 运行时，不依赖任何平台特定二进制。🆕 内嵌终端还专门做了 Win10 / Win11 皮肤。

**Q：AI 自动标题会额外花钱吗？**

A：会调用一次低 token 的模型请求，成本极低。可以在设置里关掉。

**Q：UUID 会话文件夹能手动改吗？**

A：可以。`meta.json` 里的 `title` 随便改，侧边栏会读取。但不要改 `id`，那是索引键。

---

## 贡献

欢迎提 Issue 和 Pull Request。

**如果你是第一次参与开源**，可以从 `good first issue` 开始。

代码风格原则：

- 保持简洁
- 不引入不必要的依赖
- 注释解释“为什么”（中文），而不是“是什么”（英文）
- 🆕 终端渲染相关的代码请附带 ANSI 测试用例

---

## 协议

MIT © [hzx7891](https://github.com/hzx7891)

---

<div align="center">

🧬 **Helix** · 本地优先的 AI Agent 工作台

**v0.6.0** · 多模型 · CLI · 拟真终端 · UUID 会话

[GitHub](https://github.com/hzx7891/helix-ai) · [npm](https://www.npmjs.com/package/helix-ai-cn) · [Issues](https://github.com/hzx7891/helix-ai/issues)

</div>