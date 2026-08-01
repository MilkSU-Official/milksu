# Coding Agent 与 Codex 能力对照

> 状态：Living document（2026-08-01）

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
| Goal / Plan 长任务 | `Partial`：`milksu_progress` 工具存在 | 独立的目标行、计划状态、暂停/继续/编辑和完成条件 | P0 |

### 2. Agent 执行与可靠性

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 读、搜、改、写文件 | `Verified`：Pi `read/edit/write/grep/find/ls` | 增加逐文件/逐块 diff 可视化和撤销 | P0 |
| Shell 与测试 | `Implemented`：`Project Auto` 支持常规开发命令、Shell 组合、Git 与网络并限制项目外写入；显式 `Full Access` 自动执行当前用户可运行的命令；Provider Key 不进入子进程 | 完成打包原生双模式验收；增加桌面逐次审批、后台进程列表、终端复用、退出码和端口状态 | P0 |
| 上下文压缩与持久会话 | `Implemented`：复用 Pi Session | UI 显示压缩/恢复事件；建立长任务回归 | P1 |
| LSP | `Partial`：固定插件并仅用于 Coding；仓库配置被 MilkSU 白名单覆盖，语言服务器进程不继承模型凭据 | 打包 Go/Vue/TypeScript Server；用 fixture 验证诊断，写修复必须显式展示 | P0 |
| Retry | `Partial`：固定插件并仅用于 Coding；保留瞬态错误分类，慢模型 watchdog 暂停 | 用可控瞬态失败与慢首 Token fixture 验证有界重试和停止后再启用 watchdog | P0 |
| Architecture | `Verified`：真实打包 App 中一键“架构图”自动读取项目、固定输出 JSON/HTML、9/9、0 error、0 warning，并在右侧安全预览；Archify 固定 commit 且只用于 Coding | 后续补“仓库变化后更新图”的独立回归 | P1 |
| 多 Agent | `Planned` | 子任务、状态、预算、独立工作区和主 Agent 汇总 | P1 |

### 3. Git 与代码审阅

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 分支、HEAD、ahead/behind | `Verified`：右侧环境面板只读展示 | 增加远端与 detached 状态说明 | P0 |
| 变更统计 | `Verified`：文件数、增删行、暂存/修改/未跟踪/冲突 | 点击进入文件级 diff | P0 |
| Diff 审阅与行级反馈 | `Planned` | 文件树、unified diff、行级反馈回流下一回合 | P0 |
| Stage / revert | `Planned` | 逐块和逐文件操作；破坏性操作前确认 | P1 |
| Commit / push / PR | `Planned` | 明确目标分支与远端；push 和 PR 属于外部副作用 | P0 |
| Worktree / Handoff | `Alternative` | 使用 Git worktree 为并行 Coding 任务隔离；不复制 Codex 私有 Handoff | P1 |

### 4. 权限与环境

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 工作区范围 | `Implemented`：文件工具二次校验路径/符号链接；Project Auto 保护 `.milksu` 并由 macOS 沙箱阻止项目外写入；Full Access 只能由用户显式选择 | 多根目录显式授权；原生包负向回归 | P0 |
| 命令与网络审批 | `Partial`：Plan/Go 与 Codex 风格 `请求批准 / 替我审批 / 完全访问权限` 已由后端真实执行；Ask 因无桌面同步审批协议暂按只读 | 增加逐工具审批；Browser、Computer Use 与外部产品副作用保持独立批准 | P0 |
| 环境信息 | `Implemented`：工作区、Git、模型、插件、工具、消息与工具记录 | 补后台进程、端口、浏览器、来源与变更详情 | P0 |
| Local Environment / Actions | `Planned` | 项目级 setup 和常用命令；固定配置、可见输出、可停止 | P1 |
| 集成终端 | `Planned` | 同一项目的可见终端与 Agent 后台进程，不隐藏 Shell 状态 | P1 |

### 5. 上下文、扩展与工具

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| Markdown 与代码块 | `Verified`：安全 Markdown、表格、列表、代码块和链接 | 增加代码高亮、复制与大输出折叠 | P0 |
| 文件与图片输入 | `Planned`：CTF 有材料入口，普通 Coding 尚无 | Composer 附件、图片预览、大小/类型/发送范围提示 | P0 |
| 固定 Skills / Extensions | `Verified`：关闭 ambient discovery，仅白名单加载 | UI 展示来源、版本、权限、启用范围与更新状态 | P0 |
| 用户插件管理 | `Planned` | 安装、审阅、启用、禁用、权限和版本锁定 | P1 |
| MCP | `Planned` | 按任务启用，展示服务器、工具、认证与副作用 | P1 |
| Browser / Chrome | `Partial`：CTF 有显式浏览器桥；Coding 尚未接入 | 独立于 CTF 的 Coding 浏览器工具和环境面板状态 | P1 |
| Computer Use | `Planned` | 可见会话、应用范围和逐次授权 | P2 |
| Web search | `Planned` | 与命令网络权限分离；结果带来源 | P1 |

### 6. 产物、自动化与外部运行时

| Codex 工作流 | MilkSU 当前状态 | 差距与验收 | 优先级 |
| --- | --- | --- | --- |
| 生成文件预览 | `Partial`：CTF Artifact 可预览；Coding 只显示路径 | 文本、Markdown、HTML、图片和常用文档预览 | P1 |
| Scheduled tasks | `Planned` | 仅在稳定任务模板、权限和隔离完成后进入 | P2 |
| Cloud/offload | `Excluded` | 当前产品坚持本机优先；未来可接外部 Runtime Adapter | — |
| Codex / Claude CLI 兼容 | `Alternative` | 作为可选 External Agent Runtime，不取代 Pi 默认引擎 | P2 |

## 分阶段交付

### C0：核心 Coding 可用

- 现有七个 Pi Coding tools、会话恢复和停止保持回归通过；
- 右侧环境信息不遮挡，工作区、Git、模型、插件、工具状态真实；
- Markdown、代码块、表格和链接全局统一渲染；
- Archify、LSP 调度器、Retry 分类器在打包 Sidecar 中通过正向 smoke，CTF 会话通过负向隔离；未打包语言服务器时必须明确显示 `Partial`；
- 新增后台进程、计划状态和文件级 diff 的只读视图。

### C1：日常 Git 与权限闭环

- Diff 审阅、stage、commit、push；
- Plan / Go 与 Request Approval / Project Auto / Full Access 权限；补齐 Ask 的桌面同步审批；
- 工作区外、网络、外部副作用具有独立批准；
- 项目 Actions 与后台进程可见、可停止、可恢复。

### C2：可扩展 Coding 平台

- 插件、Skill、MCP 的安装与权限中心；
- 多 Agent + worktree 隔离；
- Coding Browser、Computer Use、Web Search；
- 文件/图片输入与产物预览。

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

该样本证明当前 Coding 核心链路已可交付，也暴露出模型会受旧对话误导、需要“先验证当前状态再下结论”的真实弱点。后续已移除普通研发命令白名单并加入显式 Full Access，但这仍不证明桌面 Ask 审批、附件、MCP Browser、Computer Use、多 Agent、后台进程 UI 或 Git 发布闭环已经完成。

同日，真实打包 App 在上述项目会话中点击一次“架构图”，自动读取仓库、修复候选布局、
执行 Archify `validate` 与 `deliver`，生成固定 JSON/HTML；独立 CLI 复验为 9/9、
0 error、0 warning，右侧 iframe 成功显示 `about:srcdoc` 预览。过程中发现并修复了审阅
资源祖先目录不可遍历、项目内运行时临时目录被错误阻断两个真实权限缺陷。
