# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-10
>
> 本页只回答“现在按什么目标继续做”：当前事实 + 下一条完成线。
> 实现事实以当前代码、测试、Git 历史和原生 App 验收为准。
> 旧覆盖台账、流水验收和历史 smoke 只留 Evidence / Git history，不堆进入口。

## 先读规则

1. 先读当前代码、测试、Git 状态、本文件、文档状态和当前系统，不按旧对话重复已闭环事项, 子功能实现后回写状态到本文档。
2. 仍是 pre-release；新能力直接实现干净模型，不为未发布旧设计写迁移、双写或兼容层。
3. 已工作的旧 schema 不在功能纵切中途返工；最终收口可集中做一次破坏性整理。
4. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
5. 只向 MilkSU 私有远端提交/推送/开 PR，不向引用的开源项目创建 PR。
6. 自动审批可减少无意义打断，但不能绕过付费、外部账户、Scope 扩大、路径边界、托管发布或不可逆操作。
7. CTF、CVE、Coding 是同级主工作区；同语义控件必须同规格。全局设置固定左下 rail；缺凭据或模块配置 CTA 跳到全局设置对应分类。
8. 非阻塞问题先记复现和影响；只有数据 / Credential / Scope / 私有远端 / Judge / 验收失真立即修。
9. 夜间/日间主题已可用：左下 rail 设置上方纯图标切换并本机持久化；日间模式的主工作区、桌面 chrome 与 rail 使用中性纯白底，绿色只保留给品牌、选中和状态反馈；后续只在 UI 巡检中扩样调色。
10. UI 巡检或视觉修复后，必须同步防回归测试与当前文档。
11. 模型与凭据保持普通入口：一个默认模型、一个模型来源、一个凭据区。默认日常模型 DeepSeek V4 Flash；TokenFlux 是一等中转站；不保留 fast/deep 角色路由，不接 Kimi/KouriChat 产品入口。
12. Coding 自举默认由外部 reviewer 操作真实打包 MilkSU：给略带模糊的人类需求，让 MilkSU 在隔离 worktree 内理解、修改和验证；reviewer 只查轨迹、diff、测试和边界，并通过产品 UI 要求返工。除非链路阻塞、安全/Scope 问题或用户明确要求，reviewer 不直接改功能代码。
13. 上游优先：平台/Pi → 固定可审阅 Skill/MCP/插件/CLI → 许可证兼容的最小上游机制 → 最小自有实现。一会话一个结果契约，除阻塞和安全外不靠连续微提示收口。
14. Coding Agent 的成熟机制要反哺 CTF/CVE：通用会话、浏览器、worktree、恢复和审阅优先复用上游；Challenge/Evidence/Judge、漏洞研究事实、领域采集与安全验证工作流由 MilkSU 持有。不能把“上游优先”误写成不发展自己的安全领域能力。

## 当前事实

- 阶段：**Post-M3 / M4 自举与隔离执行**。M4 不是未合并 PR，而是把 Coding 推进到“会话在隔离 worktree 内完成自然任务并交付”。
- M3 product-loop 已 squash merge（`108e0e3`，2026-08-05）；不要把它或旧分支当打开中的任务。
- Coding 工程底座已覆盖：Plan/Go、权限、附件、本地 OCR、LSP、Artifact Preview、隔离 Browser、后台任务恢复、Diff/Hunk、Git、PR 发布确认、worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离已落地：干净 Git 项目的首次 effectful 回合由 Agent 自动准备一个内部 writer；`.worktreeinclude` 用平台 CoW 复制 ignored 本地环境，submodule 按精确提交初始化，writer 不读写主依赖目录。用户不再选择或看到 worktree / writer；脏工作区和非 Git 任务保留原工作区并明确降级。
- **Grok 看图已通过**：打包 App 经 TokenFlux 真实 `grok-4.5` 原生 image input 看图成功；中文识别任务列表、进度胶囊和输入栏，且未调用工具。`grok-4.3` 仍为 text-only；text-only 模型继续走 OCR + 可选 auxiliary vision。
- **功能代码自举已有真实但仍不等于完整自治交付的纵切**：本批次完成 Agent 自动执行环境、运行中消息 steering/queue、Git 变更文件悬浮跳转、CTF/CVE 共享 Coding/Pi 上下文、Stable/Beta 身份与构建追踪；自动化测试和打包均通过。正式 Stable 已通过内部 Computer Use 核对干净 Beta 的分支、完整提交与追踪号，并完成真实 CTF/CVE 任务连续性、PiP 与返回路径验收。实现过程仍有 reviewer 直接收口，不能外推为 Coding Agent 已能全自治完成任意功能开发。
- Git 变更摘要现在可悬浮查看真实文件并点击打开“变更”；执行环境由 Agent 维护，不再暴露用户手工 writer 控件。自然会话中出现 Goal 与真实 Git diff 时的打包 App 悬浮纵切仍需补一条证据。
- Computer Use：用户选择外部可见 App/PID/Window 的不可变 Scope；Stable/Beta 独立产品名、Bundle ID、图标、数据目录、构建追踪和自我排除已落地。Stable → Beta 已完成版本核验、真实 click/scroll 与 CTF/CVE 连续性全程；右栏默认只保留目标、接入状态与一个主操作，权限、签名诊断和操作证据收进按需展开的“运行详情”。Browser 与 Computer Use 仍是分离权限面。
- Session Index / 相关历史：MilkSU 自有 `obelisk.sqlite` 已索引本机 Coding、CTF、CVE 会话，支持 FTS/LIKE 搜索、Credential 遮蔽和用户确认后引用到当前输入。完整图谱改为**按需生成的人类语义图**：当前 Pi/Provider 在无工具静默回合中，把有界的 user/assistant 历史、Obelisk Memory 摘要和正式 Evidence 摘要归纳成主题、决策、问题、能力、里程碑、证据和洞见；工具消息不进入材料，节点必须回溯真实来源，关系明确是模型推断。图谱不读取目标文档、不写 Memory、不自动进入 Agent 上下文，也没有“引用到输入”动作。CTF Memory 继续属于独立领域事实，不与历史索引混写。
- Composer `/` 已覆盖 Goal、Plan、Pi 会话动作、模型/权限、状态/Diff/Review、MCP、Browser Use 与 Computer Use；用户可见的 worktree / writer 入口已删除。Agent 运行时输入仍可发送：消息先通过 Pi steering 应用于下一次模型调用，并以队列卡片展示；只有真正 settled 才结束运行态。输入框左下“+”继续作为附件、Goal、Plan、浏览器、Browser/Computer Scope、已审核 Pi Skills 和项目 MCP 的统一入口。产品 UI 只使用“浏览器”，不暴露“沙箱浏览器”。
- 浏览器三面已分责：右栏“浏览器”是会话隔离的内置 Chromium；`/browser-use` 复用固定版 Playwright MCP 官方扩展，由用户在真实 Chrome/Edge 选择准确标签页；`/computer-use` 只列外部原生 App，浏览器窗口不进入该 Scope。NSSCTF/CTFshow 的 MilkSU 扩展继续作为领域 Bridge，不承担通用浏览器控制。
- **Chromium 桌面壳纵切已完成**：MilkSU.app 现由 Electron/Chromium 承载 Vue 产品表面和右栏 `WebContentsView`，Go 作为受管本地 Runtime 通过 JSONL RPC 提供应用服务。浏览器使用每会话独立 `session.fromPath`、默认拒绝页面权限，并经限定单一 Target 的 loopback CDP Proxy 交给固定 Playwright MCP。打包 App + TokenFlux `grok-4.5` 已只用浏览器完成三类真实任务：按页面提示点击取得 `flag{browser_agent_ok}`、填写并提交表单取得确定性回执、阅读 Electron 官方文档并归纳 `WebContentsView` 与旧 `BrowserView` 的关系。三次均在 Agent 开始后折叠右栏，任务仍继续，重新展开仍是同一页面与终态；未回退 Shell。裸域名会补全 HTTPS，普通文字会进入搜索。旧 Wails/CEF 生产链已直接删除，不保留兼容或双壳。
- 模型与凭据：单默认模型 + 单来源 + 单凭据区；DeepSeek V4 Flash 默认日常；TokenFlux 一等中转；Coding / CTF / sub-agent 共用当前 Provider 注册。
- CVE：学习/追踪 MVP 可用（多源同步、练习目录、本地 Compose 生命周期、资产验证、学习写回、Coding 接力）；正式事实只来自 Vuln Runtime。
- CTF：题库、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘、Memory 主链存在；真实 Judge 成功仍只有窄 Web 路径。
- CTF/CVE → Coding 已复用同一 Coding/Pi：交接只挂载草稿、不自动发送；右侧可折叠领域上下文保留题目/CVE、授权 Scope、材料、Evidence/Judge 或只读安全边界，并提供返回工作台。NSSCTF 附件或 Judge 未连接不再阻止用公开题面打开 Coding；附件缺失只作为材料警告。Beta Computer Use 已实测 P7591 与 CVE-2024-3400 的草稿交接和返回连续性；未运行 PoC、未提交 flag、未建立 Judge 成功事实。
- Runtime：Sidecar 恢复、Compaction、异常退出标记、后台长任务打包 App/WebView 恢复、预算和失败分类已有。
- UI：全局 rail 主题、设置、能力画像；能力画像支持移出延迟关闭与 Escape。Goal 与 Git 摘要位于输入框上方，Git 摘要可展开文件列表并跳到“变更”。Coding 顶部保留独立 Bottom Dock 和统一右栏；CTF/CVE 进入 Coding 后领域上下文可折叠/PiP，不再丢失原任务。Computer Use 使用紧凑任务面，诊断与证据默认折叠。Electron 窗口已避开 macOS 红黄绿按钮，Stable/Beta 使用正确名称与图标；设置页底部固定显示 branch、40 位 commit、clean/dirty、build time 和 tracking ID。
- 暂停/后置：Labs；CVE 纵深研究、真实漏洞复现、外部资产实验、披露；NYU safe-static 只是开发者 smoke，不是完整 CTF 成绩。

## 下一条完成线

| 优先级 | 主线 | 只认什么完成 |
| --- | --- | --- |
| P0 | Coding 自举闭环 | 自动 worktree、功能代码、测试、Beta 打包、运行中 steering/queue、Git 悬浮跳转与 Stable → Beta CTF/CVE 可见验收已有；下一条只认 Coding Agent 在一次自然功能任务中自行完成修改、测试、恢复与 Git 交付，并记录人工接管和越权拒绝。历史 fixture、单元测试和本批次 reviewer 直接收口不能替代。 |
| P0 | Session Index | 继续内置 MilkSU 自有历史索引；外部会话导入在有明确文件选择、确认和产品调用者前不进发行图。 |
| P0 | CVE 学习/追踪扩样 | 更多真实 CVE 验证同步、练习、研究档案、资产验证和学习写回；不做外部攻击、自动 PoC 或披露。 |
| P1 | Computer Use 扩样 | Calculator 之外再加 1–2 个真实 App/窗口、权限拒绝路径；稳定 Developer ID 后复检 TCC。不与 Browser 强行合并权限。 |
| P1 | 安全工具 MCP 常规能力 | 先在 Coding Agent 中接入 IDA Pro/idalib、Burp Suite、radare2、Ghidra、Semgrep 等固定版本、可审阅的安全工具 MCP，形成普通的安装、启用、健康检查、版本/Schema 审阅、Scope、审批与证据回执能力，而不是一次性 smoke。设置页管理已审阅服务，Composer “+”只选择已启用服务；是否进入 CTF/CVE 由后续用户监督的领域纵切单独决定。 |
| P1 | Chromium 壳扩样 | 已完成 macOS ARM64 Electron/Chromium 壳、地址/搜索、点击、表单、公开资料调研与折叠连续执行纵切；下一阶段只补 Windows 打包评估、下载/弹窗/权限负向矩阵、页面崩溃恢复和自动化更新，不恢复 CEF/Wails 双壳。 |
| P1 | MilkSU Beta 自举 | 双身份、数据目录、追踪、签名检查、自我排除、版本核验与 CTF/CVE 可见任务全程已完成；剩余 Developer ID 后的 TCC 复检与更广真实任务扩样。禁止稳定版控制自己或共享状态/权限。 |
| P1 | Memory 可信度 | 区分 user / agent / shared / imported 与 none / hint / copilot / delegated；Agent 代做不能抬高用户独立能力。 |
| P1 | Runtime Reliability | 自建安全 fixture：多轮、文件、命令、工具、重启、压缩、取消、预算、失败分类。 |
| P2 | 本地交付与发行 | RC 再做崩溃恢复、诊断、全新机器、Developer ID `.app`、DMG、公证、stapling、升级、性能和尺寸；Developer ID 先于外部分发与 Computer Use TCC 复检。不读取或迁移本机签名私钥/证书密码/Personal Vault。 |
| 持续 | 架构与 UI | 触碰即拆热点文件；不新开纯清债里程碑。UI 巡检后同步测试与当前文档。 |

推荐顺序：先用一次自然功能任务补齐 Coding Agent 自主修改/测试/恢复/Git 交付证据 → 再补 Chromium 与 Computer Use 负向/恢复扩样 → 并行推进安全工具 MCP 常规能力 → 最后加重 Memory / 发行 RC。安全工具是否进入 CTF/CVE 仍由用户监督的独立纵切决定。不恢复 `development-plan.md`，不把已删除 live smoke 嵌回产品启动链。

### 已完成纵切：相关历史人类语义图

- **实现**：固定 `@antv/g6@5.1.1` 仍只在完整“相关历史”切换图谱时懒加载；点击后才用当前 Pi/Provider 运行一次静默的 no-tools、Plan/read-only 归纳，不再保留确定性工具关系图或双路径 fallback。临时会话事件不进入产品会话流，完成后销毁且不持久化图谱。
- **材料**：最多 24 条脱敏来源；conversation 只取可见 user/assistant 文本并按会话限额，另可取 Obelisk Memory 摘要和有模块/时间归属的正式安全 Evidence。工具调用、工具结果和目标文档不作为图谱材料；项目筛选时无法证明项目归属的正式档案宁可省略。
- **模型与校验**：节点限于 topic、decision、milestone、capability、problem、evidence、insight；边限于 depends_on、enables、blocks、supports、validates、evolves_to、contrasts_with。模型输出经 JSON、枚举、数量、端点和 Source ID 校验；无真实来源的节点丢弃，Credential 在索引、Projection 与 UI 再遮蔽。
- **交互**：语义簇、重要度、状态和有向关系服务于人类阅读；支持拖动、缩放、适应视图、节点关系解释、来源摘要和来源会话回跳。列表仍可经用户确认引用，图谱本身不提供引用或回填。紧凑侧栏只保留列表，不加载 G6，也不耗模型额度。
- **真实验收**：重新打包并签名校验的 macOS App 使用 TokenFlux `grok-4.5` 生成 `Computer Use` 图（10 节点/11 关系）和 `MCP` 图（11 节点/12 关系）；前者归纳 Calculator 窄切片、会话接通缺口、Browser 分离、Compaction 边界和安全运行时，后者归纳 Playwright MCP、local fixture、socket 路径和会话恢复边界。两图均无 Bash 工具中心；点击节点可见语义理由、真实会话来源并回跳，主聊天无临时生成消息。
- **边界**：这是给人看的瞬态历史认知图，不是新的 Agent Memory、目标解析器或执行知识图谱；关系只代表模型归纳，不建立 Judge、CVE 来源、Memory 或用户能力事实。

### 安全工具 MCP 常规能力队列

这是 Coding Agent 的常规能力接入队列，但不是默认捆绑或自动启用清单。每项先在 Coding 用受控
样本完成真实任务，通过审阅后才进入可安装/启用目录；是否进入 CTF/CVE 由用户后续单独决定。
未经审阅的社区 Server 只作为研究输入，不进入发行依赖图。

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
- 顶栏视觉统一、全局 rail 设置/主题/能力画像、字重与 Coding 字号层级、共享 Button label 规格；Coding 顶部独立 Bottom Dock 开关、右栏独立开关、Codex 式终端标签栏与精简空状态。
- Computer Use 外部 App Scope、权限检测、工具截图辅助视觉；Artifact Preview；后台任务跨重启恢复。
- CVE 多源同步/练习生命周期/学习写回/资产验证；Session Index 基础索引与确认写入。
- 相关历史人类语义图：Pi 无工具静默归纳、有界 Memory/会话/Evidence 摘要、Credential 遮蔽、来源回跳；图谱不引用、不回填 Agent。
- 模型与凭据普通入口、TokenFlux、移除 Kimi/KouriChat 与 fast/deep 路由。
- 假后端与无调用者外部导入清理；CTF Memory actor/assistance 持久化；worktree 写入边界与 `.worktreeinclude`/submodule。
- TokenFlux `grok-4.5` 打包 App 真看图（中文 UI 识别、无工具调用）。
- 真实 Grok 文档小纵切：自然提示 → writer 只改 Current 文档 → reviewer 返工（不含功能代码/测试/恢复/Git 交付）。
- M3 product-loop 合并。

## 领域完成线（摘要）

- **CVE**：只做学习/追踪。可扩多源缓存与练习闭环；后置未授权外部目标、批量扫描、自动 PoC、披露自动提交。
- **Memory**：可复用经验 ≠ 用户能力画像；用户独立能力只能来自显式用户操作或确认记录；推荐须能链到 Judge/提示/失败/确认材料。
- **Bench**：先自建 Runtime Reliability；NYU Outcome 后置到核心产品闭环稳定后的安全子集；safe-static 不是完整 CTF 成绩。

## 架构和文档规则

- 触碰 `CTFPage.vue`、`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、
  `internal/browsercap/manager.go`、CTF Runner/Recovery 时避免继续塞职责，能抽边界就抽。
- Electron Preload 只暴露窄 RPC/事件桥；Go Runtime 不依赖 Electron 类型；领域层不依赖桌面壳；Pi 不知道平台页面细节；Adapter 不判定学习成功或用户能力。
- 文档三层：Current 入口、Evidence 索引、Historical/Research。过程聊天、微提交、历史 smoke 清单不堆进入口。
