# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-09
>
> 本页只回答“现在按什么目标继续做”：当前事实 + 下一条完成线。
> 实现事实以当前代码、测试、Git 历史和原生 App 验收为准。
> 旧覆盖台账、流水验收和历史 smoke 只留 Evidence / Git history，不堆进入口。

## 先读规则

1. 先读当前代码、测试、Git 状态、本文件、文档状态和当前系统，不按旧对话重复已闭环事项。
2. 仍是 pre-release；新能力直接实现干净模型，不为未发布旧设计写迁移、双写或兼容层。
3. 已工作的旧 schema 不在功能纵切中途返工；最终收口可集中做一次破坏性整理。
4. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
5. 只向 MilkSU 私有远端提交/推送/开 PR，不向引用的开源项目创建 PR。
6. 自动审批可减少无意义打断，但不能绕过付费、外部账户、Scope 扩大、路径边界、托管发布或不可逆操作。
7. CTF、CVE、Coding 是同级主工作区；同语义控件必须同规格。全局设置固定左下 rail；缺凭据或模块配置 CTA 跳到全局设置对应分类。
8. 非阻塞问题先记复现和影响；只有数据 / Credential / Scope / 私有远端 / Judge / 验收失真立即修。
9. 夜间/日间主题已可用：左下 rail 设置上方纯图标切换并本机持久化；后续只在 UI 巡检中扩样调色。
10. UI 巡检或视觉修复后，必须同步防回归测试与当前文档。
11. 模型与凭据保持普通入口：一个默认模型、一个模型来源、一个凭据区。默认日常模型 DeepSeek V4 Flash；TokenFlux 是一等中转站；不保留 fast/deep 角色路由，不接 Kimi/KouriChat 产品入口。
12. Coding 自举默认由外部 reviewer 操作真实打包 MilkSU：给略带模糊的人类需求，让 MilkSU 在隔离 worktree 内理解、修改和验证；reviewer 只查轨迹、diff、测试和边界，并通过产品 UI 要求返工。除非链路阻塞、安全/Scope 问题或用户明确要求，reviewer 不直接改功能代码。
13. 上游优先：平台/Pi → 固定可审阅 Skill/MCP/插件/CLI → 许可证兼容的最小上游机制 → 最小自有实现。一会话一个结果契约，除阻塞和安全外不靠连续微提示收口。
14. Coding Agent 的成熟机制要反哺 CTF/CVE：通用会话、浏览器、worktree、恢复和审阅优先复用上游；Challenge/Evidence/Judge、漏洞研究事实、领域采集与安全验证工作流由 MilkSU 持有。不能把“上游优先”误写成不发展自己的安全领域能力。

## 当前事实

- 阶段：**Post-M3 / M4 自举与隔离执行**。M4 不是未合并 PR，而是把 Coding 推进到“会话在隔离 worktree 内完成自然任务并交付”。
- M3 product-loop 已 squash merge（`108e0e3`，2026-08-05）；不要把它或旧分支当打开中的任务。
- Coding 工程底座已覆盖：Plan/Go、权限、附件、本地 OCR、LSP、Artifact Preview、隔离 Browser、后台任务恢复、Diff/Hunk、Git、PR 发布确认、worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离已落地：注册 writer 与主 Agent 文件/终端同写入边界；`.worktreeinclude` 用平台 CoW 复制 ignored 本地环境；已初始化 submodule 按精确提交初始化；writer 不读写主依赖目录。**交互仍是用户在协作面板显式准备**；会话不会自动拥有执行 worktree。
- **Grok 看图已通过**：打包 App 经 TokenFlux 真实 `grok-4.5` 原生 image input 看图成功；中文识别任务列表、进度胶囊和输入栏，且未调用工具。`grok-4.3` 仍为 text-only；text-only 模型继续走 OCR + 可选 auxiliary vision。
- **真实 Grok 自举小纵切已跑通一段**：自然提示 → 注册 writer 只改三份 Current 文档 → reviewer 指出事实错误 → 同会话完成返工。**尚未覆盖**功能代码修改、测试、恢复和 Git 交付；不要写成自举完全未开始。
- **实测缺口**：Goal/输入框上方的 Git 变更摘要看不到 writer worktree 的三文件改动；变更投影仍偏主工作区视角，不足以审阅隔离执行结果。
- Computer Use：用户选择外部可见 App/PID/Window 的不可变 Scope、打包 App 启停、Calculator observe/click、text-only 主模型下的工具截图辅助视觉已有切片。Browser 与 Computer Use 仍是分离权限面。
- Composer `/` 已覆盖 Goal、Plan、Pi 会话动作、模型/权限、状态/Diff/Review、worktree、MCP、Browser Use 与 Computer Use；Go 是未开启 Plan 时的默认状态，不再单设 `/go`。输入框左下“+”是统一的当前任务能力入口：附件、Goal、Plan、沙箱浏览器、Browser Use、Computer Use、运行时投影的已审核 Pi Skills（当前固定 frontend-visual-qa / archify）和项目 MCP。Skill 直接复用 Pi `/skill:name` 展开，Browser/Computer 与 Skill 都先成为可删除的内联状态，不会因选择而直接发送；沙箱浏览器和项目 MCP 只打开已有管理面。Plan/Go 不再占一个常驻下拉，审批位于左侧，模型位于右侧。
- 浏览器三面已分责：右栏“沙箱浏览器”管理会话隔离的专用 Chrome；`/browser-use` 复用固定版 Playwright MCP 官方扩展，由用户在真实 Chrome/Edge 选择准确标签页；`/computer-use` 只列外部原生 App，浏览器窗口不进入该 Scope。NSSCTF/CTFshow 的 MilkSU 扩展继续作为领域 Bridge，不承担通用浏览器控制。
- 右栏沙箱浏览器当前仍是独立 Chrome 窗口 + CDP/Playwright，并非内嵌 Chromium。目标形态是右栏可直接交互的 Chromium View；不得用截图坐标层、iframe 或普通外部 Chrome 窗口冒充完成。
- 模型与凭据：单默认模型 + 单来源 + 单凭据区；DeepSeek V4 Flash 默认日常；TokenFlux 一等中转；Coding / CTF / sub-agent 共用当前 Provider 注册。
- CVE：学习/追踪 MVP 可用（多源同步、练习目录、本地 Compose 生命周期、资产验证、学习写回、Coding 接力）；正式事实只来自 Vuln Runtime。
- CTF：题库、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘、Memory 主链存在；真实 Judge 成功仍只有窄 Web 路径。
- Runtime：Sidecar 恢复、Compaction、异常退出标记、后台长任务打包 App/WebView 恢复、预算和失败分类已有。
- UI：全局 rail 主题、设置、能力画像；Coding Goal 从 Composer `/` 进入，Goal 与 Git 摘要使用一致的圆角胶囊并位于输入框上方。WebView 无假后端。
- 暂停/后置：Labs；CVE 纵深研究、真实漏洞复现、外部资产实验、披露；NYU safe-static 只是开发者 smoke，不是完整 CTF 成绩。

## 下一条完成线

| 优先级 | 主线 | 只认什么完成 |
| --- | --- | --- |
| P0 | 会话自动 worktree | 新建/恢复 Coding 任务时会话自动拥有一个隔离 writer（含 `.worktreeinclude` 与精确 submodule）；日常修改默认写该 worktree，不必先点协作面板。Goal/输入框上方 Git 摘要与变更投影须包含活跃 writer 的真实 diff，而不是只看主工作区。sub-agent 仍是可选有界并行，不与执行环境混成同一入口。 |
| P0 | Coding 自举自然任务 | 在已跑通的文档小纵切之上，补齐功能代码、测试、预览/Computer Use 或 Browser 验证、恢复、Git 交付；记录人工接管、越权拒绝和失败恢复。历史 fixture / fake-provider smoke 与纯文档小纵切都不能单独代替。 |
| P0 | Session Index | 继续内置 MilkSU 自有历史索引；外部会话导入在有明确文件选择、确认和产品调用者前不进发行图。 |
| P0 | CVE 学习/追踪扩样 | 更多真实 CVE 验证同步、练习、研究档案、资产验证和学习写回；不做外部攻击、自动 PoC 或披露。 |
| P1 | Computer Use 扩样 | Calculator 之外再加 1–2 个真实 App/窗口、权限拒绝路径；稳定 Developer ID 后复检 TCC。不与 Browser 强行合并权限。 |
| P1 | 安全 MCP 试点 | 在 Coding 中先接入并验收一批固定版本、可审阅的安全工具 MCP；先通过只读分析、Scope、凭据、工具清单、重启与证据回执，再决定是否晋升到 CTF/CVE。设置页负责安装/启用/健康检查，Composer “+”只选择已经通过审阅的服务。 |
| P1 | 内嵌沙箱浏览器 | macOS ARM64 先用官方 CEF 二进制/示例做有界原型：右栏原生 Chromium View、独立 profile、用户直接交互、Agent 共用同一会话/CDP；同时通过 CEF helper/framework/resources、签名与打包验收。先验证最小 NSView/Wails 适配，不以换掉整个 Wails 壳或引入第二套 GUI 框架开局。 |
| P1 | MilkSU Beta 自举 | 稳定版只从源码构建并启动另一份 `MilkSU Beta`；使用不同产品名、图标标记、Bundle ID、数据目录与 TCC 身份，再由稳定版 Computer Use 操作 Beta。禁止稳定版控制自己或让两份 App 共享状态/权限。 |
| P1 | CTF 六赛道 | Web / Pwn / Reverse / Crypto / Forensics / Misc 各至少一题 Judge-verified，并保留完整证据包。 |
| P1 | Memory 可信度 | 区分 user / agent / shared / imported 与 none / hint / copilot / delegated；Agent 代做不能抬高用户独立能力。 |
| P1 | Runtime Reliability | 自建安全 fixture：多轮、文件、命令、工具、重启、压缩、取消、预算、失败分类。 |
| P2 | 本地交付与发行 | RC 再做崩溃恢复、诊断、全新机器、Developer ID `.app`、DMG、公证、stapling、升级、性能和尺寸；Developer ID 先于外部分发与 Computer Use TCC 复检。不读取或迁移本机签名私钥/证书密码/Personal Vault。 |
| 持续 | 架构与 UI | 触碰即拆热点文件；不新开纯清债里程碑。UI 巡检后同步测试与当前文档。 |

推荐顺序：先会话自动 worktree（含 writer 变更投影）→ 用稳定版构建/操作隔离的 MilkSU Beta，把真实 Grok 自举从文档小纵切扩到功能代码/测试/恢复/Git 交付 → 并行做内嵌沙箱浏览器原型和 Computer Use 扩样 → 将验证过的 Scope/证据/恢复机制迁入 CTF/CVE 领域纵切 → 最后加重 Memory / 发行 RC。不恢复 `development-plan.md`，不把已删除 live smoke 嵌回产品启动链。

### 安全 MCP 候选队列

这不是默认安装清单。每项先在 Coding 用受控样本完成真实任务，再进入 CTF/CVE；未经审阅的
社区 Server 只作为研究输入，不进入发行依赖图。

1. **IDA Pro / idalib**：优先评估 [mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp) 当前的
   Codex Plugin + `idalib` MCP 路径，不接它准备弃用的旧 GUI MCP。验收一个 crackme：函数/交叉引用读取、
   有确认的重命名/注释、报告与重启恢复；默认禁止补丁和任意脚本。
2. **Burp Suite**：评估 [PortSwigger/mcp-server](https://github.com/PortSwigger/mcp-server)。第一阶段只读
   Proxy/Repeater 历史和请求详情；任何发送、扫描、配置修改都必须绑定准确授权目标与显式效果确认，
   不因 Server 已连接就获得互联网攻击权限。
3. **radare2**：评估 radareorg 的 [radare2-mcp](https://github.com/radareorg/radare2-mcp)，优先使用其
   read-only、sandbox lock 与工具 allowlist，作为开源逆向基线和 IDA 结果交叉验证，不开放 raw r2 命令。
4. **Ghidra**：在 [13bm/GhidraMCP](https://github.com/13bm/GhidraMCP) 与
   [LaurieWired/GhidraMCP](https://github.com/LaurieWired/GhidraMCP) 之间做一次上游审阅，不同时保留两套。
   比较版本钉定、localhost/auth、路径约束、写工具拆分、分页、重启和测试；它们都不是 NSA/Ghidra 官方组件。
5. **Semgrep**：评估官方 Semgrep MCP/Plugin，先用本地样本验证 SAST、依赖与 secrets 结果回执；需要账号
   或云端上传的能力必须单独授权，不能把仓库内容或发现自动发往外部服务。

共同准入门槛：固定 commit/release 与许可证；工具描述和 schema 哈希可审阅；默认 localhost/stdio、
最小环境变量和工作区根；读写/执行/联网效果分类；凭据不进模型上下文；Server 更新后重新审阅；保留一项
真实成功任务和一项越权拒绝回执。MilkSU 不为这些工具复制协议层，只维护安装状态、选择、Scope、审批与证据。

## 不要重复打开

仅在新复现或测试失败时重开：

- Archify；Coding 基础理解/测试/审阅/修复/总结；Plan/Go 与三档权限；附件、本地 OCR、视觉降级。
- Coding Browser 隔离与 Playwright MCP；LSP；Git Diff/Hunk/stage/commit/push/PR 确认发布。
- 顶栏视觉统一、全局 rail 设置/主题/能力画像、字重与 Coding 字号层级、共享 Button label 规格。
- Computer Use 外部 App Scope、权限检测、工具截图辅助视觉；Artifact Preview；后台任务跨重启恢复。
- CVE 多源同步/练习生命周期/学习写回/资产验证；Session Index 基础索引与确认写入。
- 模型与凭据普通入口、TokenFlux、移除 Kimi/KouriChat 与 fast/deep 路由。
- 假后端与无调用者外部导入清理；CTF Memory actor/assistance 持久化；worktree 写入边界与 `.worktreeinclude`/submodule。
- TokenFlux `grok-4.5` 打包 App 真看图（中文 UI 识别、无工具调用）。
- 真实 Grok 文档小纵切：自然提示 → writer 只改 Current 文档 → reviewer 返工（不含功能代码/测试/恢复/Git 交付）。
- M3 product-loop 合并。

## 领域完成线（摘要）

- **CTF**：六赛道各至少一题真实 Judge-verified；证据含题面、轨迹、候选、Judge、提示依赖、恢复、复盘/Memory。Tool Builder / Strategist 至少各一次跨赛道自然闭环。
- **CVE**：只做学习/追踪。可扩多源缓存与练习闭环；后置未授权外部目标、批量扫描、自动 PoC、披露自动提交。
- **Memory**：可复用经验 ≠ 用户能力画像；用户独立能力只能来自显式用户操作或确认记录；推荐须能链到 Judge/提示/失败/确认材料。
- **Bench**：先自建 Runtime Reliability；NYU Outcome 后置到六赛道稳定后的安全子集；safe-static 不是完整 CTF 成绩。

## 架构和文档规则

- 触碰 `CTFPage.vue`、`app.go`、`bridge-policy.js`、`internal/browsercap/manager.go`、CTF Runner/Recovery 时避免继续塞职责，能抽边界就抽。
- Wails 只做桌面调用和 DTO；领域层不依赖 Wails；Pi 不知道平台页面细节；Adapter 不判定学习成功或用户能力。
- 文档三层：Current 入口、Evidence 索引、Historical/Research。过程聊天、微提交、历史 smoke 清单不堆进入口。
