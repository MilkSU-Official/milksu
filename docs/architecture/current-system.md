# 当前系统与分层

> Current。2026-10-15。不安排任务。发行回执见 [当前开发目标](/developer/current-objectives)。产品 UI 只写在 `AGENTS.md`。

本工作树 Desktop JSONL 进程是 TypeScript Runtime：

```text
React → Electron Preload / Desktop RPC → TypeScript Runtime → Pi sidecar | Agent
```

本工作树 Desktop 已走 TypeScript Runtime。已发行安装包在本 PR 合进 `main` 并发版之前仍是 Go Application Service。

Electron 主窗口跑产品 renderer。右栏浏览器是同壳的会话隔离 `WebContentsView`。Runtime 不拥有 GUI，也不拥有通用模型循环。Pi 拥有嵌入会话、压缩和工具循环。其余 Agent 由用户添加、各自命名，经 ACP 接入（含原 DSH）。MilkSU 持有桌面授权、凭据、CVE / 实验室领域事实。操作系统层在 Runtime 进程内：C/ObjC N-API、`node-pty`、fengari、`dbus-next`、Electron `hostCall`。

嵌入内核只有 Pi（`@earendil-works/pi-coding-agent` 1.1.0）。其余 Agent：设置 → 运行时和输入栏都可以添加多个（Codex / Claude Code / ACP），各自填名称、命令、参数、环境变量，经 ACP 接入；协议不支持的能力在 UI 上灰掉并写一句原因。安装包默认不带这份命令。`MILKSU_DSH_COMMAND` 是这条路径的内部原型。

一次用户发送生成一个 `traceId`，RPC、Runtime 日志、Pi sidecar、ACP 子进程、研究 worker 都带上。

Pi / Agent sidecar 按内核 + 工作区路径各起一条进程，cwd 就是该工作区。ACP Agent 再按 Agent id 分开，同一工作区里两个命名 Agent 不共用进程。ACP 的 IPC 路径用工作区加 Agent id 的 hash，不用 Runtime 主进程 PID。DSH 的 `--patch`、`--profile acp` 和 `DSH_HOME` 只在命令是 DeepSeek Harness 时加上。Codex、Claude Code 和通用 ACP 不带这些参数。handoff 带目标 `acpAgentId`；切回 Pi 时清掉。删除会话发 `destroy_session`。该工作区没有剩下的会话时停掉这条 sidecar。闲置退出不广播 `engine.stopped`。sidecar、看板娘和插件 MCP 用 Desktop 的 Electron 产品二进制起进程时设 `ELECTRON_RUN_AS_NODE=1`。二进制文件名是 `node` 时不加这项。

Agent sidecar 的 `MILKSU_DSH_PI_AI_ROUTES` 由 Runtime 合成。账户中转、个人 TokenFlux key、以及指向 `https://tokenflux.dev/v1` 的自定义中转都会挂上 `providers.tokenflux`。自定义中转还会用自己的 provider id 再挂一条同样的路由。模型表读 `data/services/model-catalog/tokenflux.json`，带思考档位。TokenFlux 路由带 `compat.supportsDeveloperRole: false`，pi-ai 发 `system`。官方 DeepSeek key 仍走 `llm-deepseek`。

Browser Use 当前标签扩展从 `MILKSU_ROOT`、`MILKSU_RESOURCES`、仓库根查找 `browserextension/manifest.json`。打包 extraResources 复制这份目录。sidecar cwd 排在最后。

`SaveSettingsCmd` 广播 `settings-changed`。renderer 收到后重载设置。输入栏的 Agent 选项随命令出现。

## 桌面执行表面

| 表面 | 对象 | 边界 |
| --- | --- | --- |
| 浏览器 | 会话隔离 `WebContentsView` | 不是用户 Chrome |
| Browser Use | 用户选定的 Chrome/Edge 标签 | 不拿整个 Profile |
| Computer Use | macOS/Windows 可见窗口；Linux 仅 GNOME Portal | 动作后台 AX 优先，无 AX 节点走像素，前台只兜单个动作。Hyprland/Xorg 不可用 |
| 研究浏览器 | Deep Research 的 Research tab（内存 partition + 回环 egress 代理） | 只读公网研究，无 Cookie 无登录态，不是用户 Chrome；私网与特殊段 fail-closed |

面板折叠不停止 Session。

Deep Research：Pi 会话走 durable 工作流；经 ACP 接入的 Agent 用轻量 Skill。

## 数据放哪

产物在各系统文档目录 `MilkSU/{Coding,CVE,Lab}`。Runtime、凭据、Obelisk、浏览器 Profile 在用户配置目录（默认 `~/.milksu`）。

用户长期记忆全应用一份，只记这个人。某个 CVE、某次实验室作业的结论留在该作业里，不进长期记忆。仓库规矩留在项目里。Obelisk 只存其他会话的原文，供看板娘按当前这句话检索。

配置：一份 `config/settings.json` 加一份 secret store（钥匙串 / sqlite）。命名 Agent 写在 `acp_agents` 与 `default_acp_agent_id`。读盘时把旧 `acp_agent` / `acp_guest` 迁进列表，落盘不再双写 `acp_agent`。环境变量只认 `MILKSU_HOME`（及别名 `MILKSU_APPDATA_DIR`）。本机探测（工具、路径）每次启动重算，不当成持久真相。Darwin 钥匙串：产品 home `~/.milksu` 用 service `dev.milksu.app.credentials`；其它 `MILKSU_HOME` 带 hash 后缀。测试不得写入产品钥匙串。addon 不可用时回退 sqlite。

会话：一份会话记录（元数据 + 投影），原文由当前内核保存（Pi JSONL / 未来 `pi-durable`；经 ACP 接入的 Agent 按协议）。前端列表、搜索索引、用量都从这份投影读。旧记录上的 `workspaceHome: "ctf"` 读成 Coding。

TokenFlux 只走 `https://tokenflux.dev/v1`。Provider Key 不进 renderer、模型上下文、日志或文档。

## 入口

| 做什么 | 从哪读 |
| --- | --- |
| 桌面壳 | `desktop/main.cjs`、`desktop/preload.cjs` |
| TypeScript Runtime | `runtime/`（Desktop JSONL 宿主；全部 renderer RPC） |
| N-API | `desktop/native/`（钥匙串、窗口列表；Electron TCC 走 `hostCall`） |
| Pi | `sidecar/pi/bridge.js` |
| Agent | `sidecar/dsh/`（ACP 适配器） |
| 看板娘 | `runtime/src/companion/`、`sidecar/companion/` |
| CVE | `runtime/src/vuln/` |
| 实验室 | `runtime/src/envbroker/`、`app/src/components/LabPage.tsx` |
| Deep Research | `runtime/src/research/` |
| 打包 | `scripts/package-sidecar.mjs`、`scripts/package-electron.mjs`、`scripts/lib/desktop-native.mjs`（三端 `node-pty`；Windows `windows-windows.node`） |
| 发版 | [三端打包与发版流程](/developer/release-process) |
| 产品回归 | [产品回归循环](/developer/product-regression-loop) |
