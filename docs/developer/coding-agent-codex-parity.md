# Coding Agent 与 Codex 能力对照

> 状态：Living document（2026-08-02）

## 目标

MilkSU Coding 的北极星不是“能调用模型的聊天框”，而是让用户在日常本地开发中获得尽可能接近 Codex 的完整工作体验：

- Agent 能理解项目、修改文件、执行命令并验证结果；
- 用户始终看得到工作区、进程、权限、Git 变更、计划和工具活动；
- 长任务可以恢复、停止、继续和拆分；
- 成熟通用能力优先复用 Pi Extension、Skill 与 MCP；
- MilkSU 自研集中在 CTF Harness、Judge、Evidence、Recovery 和教学闭环。

“接近 Codex”按**可完成的工作流和用户控制能力**验收，不复制 OpenAI 私有服务、账户体系或云端基础设施。无法等价的能力必须标记为替代实现。

官方能力基线来自 Codex 当前文档：

- [Best practices](https://learn.chatgpt.com/guides/best-practices)
- [Projects and chats](https://learn.chatgpt.com/docs/projects)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Local environments](https://learn.chatgpt.com/docs/environments/local-environment)
- [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Skills & Plugins](https://learn.chatgpt.com/docs/plugins)

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `Verified` | 已有自动化测试和至少一次真实打包/界面验收 |
| `Implemented` | 已接线且有单元测试，仍欠真实用户任务验收 |
| `Partial` | 只覆盖了该能力的一部分 |
| `Planned` | 已确定产品边界，尚未实现 |
| `Alternative` | 不复制 Codex 原实现，使用 MilkSU/Pi 的等价路径 |
| `Excluded` | 不属于本地 Coding 产品，当前不做 |

## 能力矩阵

### 1. 项目与任务

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 本地项目与工作目录 | `Verified`：原生目录选择；首条消息后锁定目录 | 支持多根目录；清楚展示主目录与附加目录 | P1 |
| 独立任务与最近历史 | `Verified`：独立 Conversation、搜索、删除、用户数据目录持久化；Coding 任务按仓库折叠，未绑定仓库的任务归入临时沙盒，CTF 角色会话不混入 Coding | 增加重命名、置顶、归档和恢复入口；未来复用 Pi Session Snap / Query / Handoff，而不是再造一套归档引擎 | P1 |
| 会话恢复 | `Verified`：Pi SessionManager 与 Conversation ID 恢复 | 增加“从上次中断继续”的明确状态和恢复摘要 | P0 |
| `AGENTS.md` 项目指令 | `Partial`：加载工作区根目录 `AGENTS.md` | 支持更近目录优先的嵌套规则并展示已加载来源 | P0 |
| Goal / Plan 长任务 | `Partial`：first-party `milksu_progress` 与固定 `pi-goal` 已接入，Composer/右侧栏提供目标入口 | 补计划步骤视图、暂停/继续/编辑和完成条件 | P0 |

### 2. Agent 执行与可靠性

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 读、搜、改、写文件 | `Verified`：Pi `read/edit/write/grep/find/ls` | 增加逐文件/逐块 diff 可视化和撤销 | P0 |
| Shell 与测试 | `Verified`：`Project Auto` 支持常规开发命令、Shell 组合、Git 与网络并限制项目外写入；显式 `Full Access` 自动执行当前用户可运行的命令；Provider Key 不进入子进程；右侧“终端”包含多会话项目 PTY，支持 stdin、实时输出、resize、停止和退出状态；同页保留按 Conversation 隔离的后台任务、PID、端口和有界日志 | 增加跨应用重启终端恢复、复制/查找与更大输出压力样本 | P0 |
| 上下文压缩与持久会话 | `Implemented`：复用 Pi Session | UI 显示压缩/恢复事件；建立长任务回归 | P1 |
| LSP | `Partial`：固定插件并仅用于 Coding；仓库配置被 MilkSU 白名单覆盖，语言服务器进程不继承模型凭据 | 打包 Go/Vue/TypeScript Server；用 fixture 验证诊断，写修复必须显式展示 | P0 |
| Retry | `Alternative`：当前固定清单不再加载 `pi-retry`，模型/Provider 的重试语义保持在 Pi 边界，MilkSU 只处理可见失败与恢复 | 用可控瞬态失败与慢首 Token fixture 验证现有 Pi/Provider 行为；不增加第二个自研重试循环 | P1 |
| Architecture | `Verified`：真实打包 App 中一键“架构图”自动读取项目、固定输出 JSON/HTML、9/9、0 error、0 warning，并在右侧安全预览；Archify 固定 commit 且只用于 Coding | 后续补“仓库变化后更新图”的独立回归 | P1 |
| 日常产品动作 | `Verified`：同一真实打包 App 会话已连续完成理解项目、运行测试、审阅变更、修复失败和生成总结；动作自动选择 Plan/Go 与权限，不向用户追问内部参数；测试先复现 `6 !== 4`，修复后 `3 passed / 0 failed` | 增加不同语言、较大仓库和中断恢复样本；保持每个结论均可追溯到工具或桌面 Git 证据 | P0 |
| 多 Agent | `Planned` | 子任务、状态、预算、独立工作区和主 Agent 汇总 | P1 |

### 3. Git 与代码审阅

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 分支、HEAD、ahead/behind | `Verified`：右侧环境面板只读展示 | 增加远端与 detached 状态说明 | P0 |
| 变更统计 | `Verified`：文件数、增删行、暂存/修改/未跟踪/冲突 | 增加远端过滤和大型仓库分页 | P0 |
| Diff 审阅与行级反馈 | `Verified / Partial`：右侧独立变更页展示文件列表、暂存/工作区 unified diff、截断状态；一键审阅使用桌面 Git Adapter 的有界可信快照，不要求模型执行 Git 或解析 `.git`；真实回归正确识别一行除数回归 | 增加行级评论回流、逐块审阅和大型/二进制 Diff 样本 | P0 |
| Stage / revert | `Verified / Partial`：右侧变更页支持逐文件及全部 stage/unstage、未暂存文件丢弃；本地临时 Git 仓库完成原生 UI 回归 | 增加逐块操作；扩大未跟踪文件和冲突恢复样本 | P1 |
| Commit / push / PR | `Verified / Partial`：右侧变更页支持提交和当前分支 push，显示 upstream 与 ahead/behind；本地 bare remote 已完成原生 stage → commit → push 并核对远端 HEAD | 真实托管服务 push 继续使用用户已配置凭据；PR 创建与发布前确认仍待接入 | P0 |
| Worktree / Handoff | `Alternative` | 使用 Git worktree 为并行 Coding 任务隔离；不复制 Codex 私有 Handoff | P1 |

### 4. 权限与环境

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 工作区范围 | `Verified`：文件工具二次校验路径/符号链接；Project Auto 的 HOME/TMP/runtime 位于用户数据目录，不污染项目仓库；macOS 沙箱阻止项目外写入；旧 `.milksu` 目录继续受保护并从 Git 面板隐藏；Full Access 只能由用户显式选择 | 多根目录显式授权；为旧项目提供可审阅的遗留目录清理入口 | P0 |
| 命令与网络审批 | `Verified / Partial coverage`：Plan/Go 与 Codex 风格 `请求批准 / 替我审批 / 完全访问权限` 已由后端真实执行；Ask 会暂停单次 `bash/edit/write` 或后台/MCP 副作用，桌面展示参数并等待批准/拒绝；Coding Browser 每次 MCP 工具调用同样单独批准 | Computer Use、托管平台 push/PR 等外部产品副作用继续保持独立批准并补原生负向样本 | P0 |
| 环境信息 | `Verified`：工作区、Git、模型、固定扩展、工具、消息、工具记录、项目 MCP 和能力摘要集中在右侧；变更、终端、架构图和浏览器使用同一个右侧页面选择器，不再挤占 Composer | 补扩展版本、来源与更新状态 | P0 |
| Local Environment / Actions | `Planned` | 项目级 setup 和常用命令；固定配置、可见输出、可停止 | P1 |
| 集成终端 | `Verified / Partial persistence`：右侧独立“终端”页使用 `@xterm/xterm + creack/pty` 提供多会话项目 Shell，支持 stdin、实时输出、resize、停止、输出恢复与退出状态；原生 App 已验证 zsh 输入和项目 `pwd`。后台任务页继续复用固定 `pi-better-background-tasks`，展示 PID、端口、日志和停止动作 | 增加跨应用重启后的可恢复交互会话、终端重命名、复制/查找与 Windows/Linux Adapter | P1 |

### 5. 上下文、扩展与工具

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| Markdown 与代码块 | `Verified`：安全 Markdown、表格、列表、代码块和链接 | 增加代码高亮、复制与大输出折叠 | P0 |
| 文件与图片输入 | `Verified / Partial vision`：Composer 可选择文件/图片并复制到用户数据目录，引用随会话持久化；纯文本模型走本地 OCR 或配置的视觉路由 | 补图片/文档预览；明确区分 OCR 文本与语义视觉，无法读取时不得猜测 | P0 |
| 固定 Skills / Extensions | `Verified`：关闭 ambient discovery，仅白名单加载 | UI 展示来源、版本、权限、启用范围与更新状态 | P0 |
| 用户插件管理 | `Planned` | 安装、审阅、启用、禁用、权限和版本锁定 | P1 |
| MCP | `Implemented / Partial`：固定 `pi-mcp-adapter` 只在普通 Coding opt-in；项目 `.mcp.json` 经过 schema、digest、选择列表和本地 stdio 沙箱校验；每次连接/工具/Auth 仍走桌面批准 | 增加更多真实 MCP Server 验收、OAuth UX、活动/停止状态和错误恢复 | P1 |
| Browser / Chrome | `Verified / isolated profile`：右侧浏览器页显式启动/停止会话隔离的专用 Chrome；固定 Playwright MCP 通过瞬态 loopback 描述符接入 Pi，不读取用户日常 Profile；真实打包 App 已完成 snapshot → type → click → snapshot，并回读 `MILKSU-BROWSER-OK` | 增加多页面、下载、失败恢复和长时间任务样本；需要用户已登录状态的场景继续使用独立授权的 Chrome Bridge，而不扩大此隔离 Profile | P1 |
| Computer Use | `Planned` | 可见会话、应用范围和逐次授权 | P2 |
| Web search | `Planned` | 与命令网络权限分离；结果带来源 | P1 |

### 6. 产物、自动化与外部运行时

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 后台任务 | `Verified runtime + native product flow`：固定 `pi-better-background-tasks` 支持启动、查询、停止和恢复事件；右侧终端页展示 Conversation 隔离的状态、PID、监听端口、有界日志、退出码与停止动作；原生 App 已真实启动 `127.0.0.1:18876` 并停止，端口随后关闭 | 增加多进程压力和跨应用重启恢复；交互式输入已经由独立 PTY Host 承担 | P0 |
| 生成文件预览 | `Partial`：CTF Artifact 与 Archify HTML 可预览；普通 Coding 主要显示路径和 Diff | 文本、Markdown、HTML、图片和常用文档预览 | P1 |
| Scheduled tasks | `Planned` | 仅在稳定任务模板、权限和隔离完成后进入 | P2 |
| Cloud/offload | `Excluded` | 当前产品坚持本机优先；未来可接外部 Runtime Adapter | — |
| Codex / Claude CLI 兼容 | `Alternative` | 作为可选 External Agent Runtime，不取代 Pi 默认引擎 | P2 |

## 分阶段交付

### C0：核心 Coding 可用

- 现有七个 Pi Coding tools、会话恢复和停止保持回归通过；
- 右侧环境信息不遮挡，工作区、Git、模型、插件、工具状态真实；
- Markdown、代码块、表格和链接全局统一渲染；
- Archify、LSP、Goal、后台任务与 MCP Adapter 在打包 Sidecar 中通过正向 smoke，CTF 会话通过负向隔离；未打包语言服务器时必须明确显示 `Partial`；
- 保持逐工具审批、附件输入、会话隔离 PTY/后台任务和文件级 Diff 回归；补终端跨应用重启恢复。

### C1：日常 Git 与权限闭环

- Diff 审阅、stage、commit、push；
- Plan / Go 与 Request Approval / Project Auto / Full Access 权限；保持 Ask 桌面单次审批回归；
- 工作区外、网络、外部副作用具有独立批准；
- 项目 Actions 与后台进程可见、可停止、可恢复。

### C2：可扩展 Coding 平台

- 插件、Skill、MCP 的安装与权限中心（项目 MCP 的 opt-in Adapter 已作为底座）；
- 多 Agent + worktree 隔离；
- Coding Browser 的多页面/下载/恢复加固、Computer Use、Web Search；
- 在已实现的文件/图片输入之上补完整产物预览。

## 发布门槛

每项从 `Implemented` 升到 `Verified` 必须同时满足：

1. 固定依赖版本、来源和许可证；
2. 权限面在 UI 可见；
3. 真实打包 Sidecar 或原生 App 验收；
4. 正向功能测试；
5. CTF Sidecar 负向隔离测试；
6. 中断、恢复和失败信息不让界面停在虚假运行态；
7. 外部写入、push、PR、浏览器提交等副作用在动作发生前获得明确授权。

## 2026-08-01 packaged delivery evidence

一个从零构造、非 Git 的 Node.js 报告 CLI fixture 在正式打包的 MilkSU 中完成了连续短提示交付：

1. Plan 模式读取 `README.md`、`AGENTS.md`、静态 JSON 与现有源码，不写文件；
2. 同一 Conversation 切到 Go + Project Auto 后实现 `src/report.js`、`src/cli.js` 和测试；
3. 修复打包 Node 权限继承后，Agent 自己执行 `npm test` 与 `npm run smoke`；
4. 用户指出旧消息中的临时 shim 已由外部删除，Agent 重新 `ls` 验证当前事实，没有继续依赖旧结论；
5. 用户追加 `items: null` 边界要求，Agent 修改实现、补测试，并将测试从 4/4 推进到 5/5；
6. 主验收进程在 Agent 外独立复跑测试与 smoke，结果一致。

该样本证明当前 Coding 核心链路已可交付，也暴露出模型会受旧对话误导、需要“先验证当前状态再下结论”的真实弱点。后续已移除普通研发命令白名单并加入显式 Full Access；当前交付门禁也已覆盖桌面 Ask 审批、附件引用、项目 MCP 选择、会话隔离的项目终端和后台任务生命周期。原生右栏已真实运行多会话 zsh PTY、验证项目 `pwd`，并启动、显示和停止带监听端口的后台进程；本地 Git 远端也完成 stage、commit、push 与远端 HEAD 核对；隔离 Coding Browser 已完成真实 Playwright MCP 页面交互。但这仍不证明 Computer Use、多 Agent、跨应用重启终端恢复或托管平台 PR 发布闭环已经完成。

同日，真实打包 App 在上述项目会话中点击一次“架构图”，自动读取仓库、修复候选布局、
执行 Archify `validate` 与 `deliver`，生成固定 JSON/HTML；独立 CLI 复验为 9/9、
0 error、0 warning，右侧 iframe 成功显示 `about:srcdoc` 预览。过程中发现并修复了审阅
资源祖先目录不可遍历、项目内运行时临时目录被错误阻断两个真实权限缺陷。
