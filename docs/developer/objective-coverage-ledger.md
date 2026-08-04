# 当前目标覆盖台账

> 状态：Active / Product-loop sprint with coverage ledger
>
> 最近已推送代码基线：2026-08-05，`962e74f`
>
> 最近证据复核：2026-08-05，`962e74f` 完整 `npm run m3:release-check` 通过并重新生成
> `/Users/milksu/code/milksu/build/bin/MilkSU.app`；后续批次以本文件和提交记录为准
>
> 本文件不是发布说明。它把 `current-objectives.md` 的大项拆成可单独核对的细项，用于保持
> 全局位置。2026-08-03 起，短期执行入口切到
> [产品闭环冲刺](./product-loop-sprint.md)：先跑通一个完整 UI/UX + Coding 产品闭环，并补齐
> CVE 学习/追踪工作台骨架；Lab 只保留未来外部靶场辅助计划。本台账继续登记证据和缺口，
> 避免冲刺 smoke 被误写成全量完成。

## 计分与工作规则

每个细项暂时等权，只使用五档：

| 分值 | 含义 |
| ---: | --- |
| 0% | 未开始，或当前没有足够证据证明已经开始 |
| 25% | 已有设计、局部代码或局部记录，但还没有形成可验收纵切 |
| 50% | 工程实现与窄测试存在，尚缺真实场景验收 |
| 75% | 已有真实场景证据，但完整矩阵、跨项目或最终门槛尚未通过 |
| 100% | 该行定义的精确完成条件已经通过 |

规则：

1. 第一轮只读盘点与共同评估已经完成；当前短期执行入口是 `product-loop-sprint.md`，先跑通
   完整产品闭环，再回到 P0 → P1 → P2 细项覆盖。
2. 任何低于 100% 的行本身就是问题记录，行 ID 是稳定的问题编号。
3. 尚未实现的必要能力先形成最小可用纵切；非阻塞 Bug 和细节登记 `BUG-*` / `OBS-*` 后
   继续同层下一项。
4. 仅当问题阻断同层推进、威胁数据/Credential/Scope/私有远端硬边界，或使验收失真时立即
   修复。
5. 文档、按钮、单次 fixture 和代码存在都不能自动折算为真实验收。
6. “待用户条件”不是删除目标的理由；仍保留为 0% 或 75%，直到条件满足并实际执行。
7. 暂时等权是为了让分母透明，不代表所有项具有相同产品价值；共同评估时可以调整分组和
   权重，但不能为了提高百分比而移动完成线。

## 汇总

| 分组 | 细项数 | 当前分 | 完成度 |
| --- | ---: | ---: | ---: |
| Coding Agent 与高频替代能力 | 32 | 1,700 / 3,200 | **53%** |
| CTF 通用闭环与网络边界 | 15 | 550 / 1,500 | **37%** |
| Memory 与能力画像 | 11 | 500 / 1,100 | **45%** |
| Runtime Reliability 与 NYU Bench | 10 | 700 / 1,000 | **70%** |
| 架构约束 | 6 | 125 / 600 | **21%** |
| 本地数据安全与正式交付 | 15 | 600 / 1,500 | **40%** |
| 最终文档 | 2 | 75 / 200 | **38%** |
| **整体** | **91** | **4,250 / 9,100** | **47%** |

此前约 58% 的估值按大块综合判断，分母中没有逐项展开真实验收、跨项目、六赛道、RC 和
架构约束。第二轮证据复核又把没有原生 App 真实任务的 Vue/Go Code Action 从 75% 调到
50%；第三轮重复开发检查确认 Memory 已有当前题排除和相关/无关题排序自动化，将 `MEM-09`
从 25% 校准到 50%。第四轮确认 Computer Use 仍硬编码 MilkSU 自身，且纯文本模型没有
Computer Use 工具截图的辅助视觉回路，因此新增 `COD-31`；随后已补可见 App / 窗口选择、
不可变 Scope 和窄测试，将 `COD-15` 提到 50%；工具截图辅助视觉摘要已接入 Bridge
`tool_result` hook 并加缓存测试，将 `COD-31` 提到 50%；GUI 任务在 Computer Use 未启用时
不得绕用 Shell/IPC/截图目录的路由护栏已接入 Coding policy guidance，记入 `BUG-01` 进展，
但不折算为真实 App 验收；Coding delivery gate 已补 `runManifest` 和 `scoreboard`，将
`COD-30` 从 0% 调到 25%；Memory 召回已补推荐原因和 Judge/提示/步骤/失败证据链接，将
`MEM-08` 从 25% 调到 50%；本地交付基线已增加保守 pre-release 性能阈值和单机 support
matrix entry，将 `DEL-09` 从 25% 调到 50%；六赛道回归清单已补机器可校验 manifest 和
runbook，将 `CTF-12` 从 25% 调到 50%；Project MCP 已通过正式 adapter config 实际调用
allowlisted 本地项目 fixture 工具，将 `COD-28` 从 50% 调到 75%。45% 是当前细项口径的
基线；归档 Memory 后推荐召回和 Agent `MEMORY.md` 已同步刷新，将 `MEM-10` 从 25% 调到
50%。Obelisk 形态 Session Index 已按用户新 P0 口径新增为 `COD-32`，当前 MilkSU 自己
初始化 App data 下 `session-index/obelisk.sqlite`、索引 MilkSU 会话和工具调用、提供共享
“相关历史”入口，并已通过打包 App isolated smoke 完成真实搜索，调到 75%；2026-08-05 又
补 packaged Computer Use live smoke：真实 `build/bin/MilkSU.app` 内的 sidecar node、
`computer-use-proxy.cjs` 和 `cua-driver` 对外部 Calculator 窗口完成 observe → click 1 →
observe，保存 JSON 与前后截图证据，将 `COD-15` 调到 75%、`COD-16` 调到 50%；随后又补
packaged App facade live smoke，真实 `MilkSU.app` 进程通过 `ListCodingComputerUseTargets`
→ `StartCodingComputerUse` → `GetCodingComputerUseStatus` → descriptor → `StopCodingComputerUse`
启动并停止外部 Calculator 精确 PID/window 会话，报告 `build/test-results/computer-use-app-live.json`，
将 `COD-16` 调到 75%；打包 App artifact preview live smoke 用真实 `MilkSU.app` 进程从隔离
workspace 读取 Markdown、HTML、PNG，并拒绝 workspace escape、伪装 PNG 和 SVG，报告
`build/test-results/artifact-preview-live.json`，将 `COD-10` 调到 75%；随后真实 MilkSU UI 完成
Calculator 选择/启动/停止，并在同一隔离 App data 重启后确认旧 Scope 不会幽灵恢复，外部
Calculator 也由 Computer Use 完成 `2+3=5` 真实点击，将 `COD-15` 和 `COD-16` 调到 90%。
同日真实打包 MilkSU UI 在 CVE 设置页点击“四源同步”，对 `CVE-2024-3400` 显示 4/4 来源
成功，并在隔离 App data 下落盘 NVD、FIRST EPSS、CISA KEV 与 Vulhub snapshot，关闭
`DONE-CVE-04` 的真实 UI/Wails 公网同步缺口；随后真实打包 MilkSU UI 用系统目录选择器
绑定隔离 Coding workspace，手动打开 Markdown、HTML 和 PNG 产物，并在开发者验收详情中
记录用户可见验证，将 `COD-10` 调到 90%。同日真实打包 MilkSU UI 在隔离 App data 中完成
“相关历史 → 引用到输入 → 发送给 Coding Agent”链路，Agent 后续回复明确引用对应历史会话
和搜索 token，将 `COD-32` 调到 92%；随后又用相关历史中的 `OBS-21` 回归样本驱动定位并修复
重复脱敏标记问题，真实打包 App 验证“相关历史 → 引用到输入”不会再显示或带入
`redacted] redacted]` 污染文本，但本次仍不把它折算成完整 commit/push 自举交付；同日新增
显式 JSONL 跨历史导入器和 App/Wails facade，支持 `codex / claude / kimi / pi` 来源，真实
打包 App 导入 Codex fixture 后可搜索并保持脱敏，将 `COD-32` 调到 95%。
后续只使用同一张表比较变化。

### 分值分布

| 分值 | 细项数 | 解释 |
| ---: | ---: | --- |
| 100% | 8 | 行定义的精确门槛已经通过 |
| 75% | 21 | 已有真实证据，仍缺完整矩阵或最终 Gate |
| 50% | 32 | 工程实现和自动化存在，仍缺真实任务 |
| 25% | 8 | 只有局部纵切、设计或基础设施 |
| 0% | 22 | 未执行，或当前没有足够证据 |

### 0% / 25% 项的主要启动条件

这 34 项最容易被“为什么还不做”混淆，先按主要启动条件分类。分类不改变完成条件。

| 启动条件 | 数量 | 项目 |
| --- | ---: | --- |
| 用户提供本机条件或真实历史 | 6 | `COD-14`、`COD-16`、`COD-27`、`COD-29`、`COD-30`、`RUN-08` |
| 用户确认托管发布 | 2 | `COD-22`、`COD-25` |
| 授权真题、外部 Judge 或其轨迹 | 10 | `CTF-07`–`CTF-14`、`MEM-11`、`RUN-10` |
| 主 Agent 可独立准备 | 4 | `COD-24`、`MEM-08`、`MEM-10`、`DEL-09` |
| 触碰相关纵切时持续执行 | 5 | `ARC-01`–`ARC-05` |
| 产品完成后的最终/RC 收口 | 7 | `DEL-02`、`DEL-10`–`DEL-14`、`DOC-02` |

这里的“用户条件”不代表现在就应请求批准。先完成全局评估，再把确实要执行的项目集中成
少量用户验收批次。

## Coding Agent 与高频替代能力

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| COD-01 | 冷启动核对仓库、HEAD、工作区和指令 | 多次真实 MilkSU 任务已有记录 | 75% | 在最终自举任务中固定留存 |
| COD-02 | Vue、Go、TypeScript 普通跨文件修改 | 代码路径、测试和真实任务均存在 | 75% | 同一打包 App 自举任务覆盖三者 |
| COD-03 | 运行测试、构建、修复失败并复验 | deterministic delivery 与真实任务均有证据 | 75% | 最终打包 App 自举 Gate |
| COD-04 | TypeScript、Vue、Go Code Action | TypeScript 有既有真实验收；Vue/Go 为打包探针和负向测试 | 50% | 原生 App 真实应用 Vue + Go Action |
| COD-05 | 跨文件 Action 原子拒绝与超大 Diff 拒绝 | 自动化测试存在；`bridge-lsp.test.js` 覆盖超大 Diff 不请求审批、多文件/resource WorkspaceEdit 拒绝，以及 apply 阶段结果和已审阅 Diff 不一致时回滚原文 | 50% | 打包 App 负向真实验收 |
| COD-06 | “请求批准”覆盖所有能力入口 | Bridge/UI 自动化存在 | 50% | Browser、Computer Use、MCP、委托组合验收 |
| COD-07 | “替我审批”拦截无意义审批 | Browser 真实任务与策略测试存在；`bridge-auto-approval.test.js` 覆盖已选 Computer Use 的 observe/click/type 在 workspace-auto/full-auto 下不产生无意义审批，ask/read-only 仍逐次确认；`npm run test:project-mcp` 的实际 allowlisted `fixture_read` 调用确认 workspace-auto/full-auto 不产生无意义审批，ask/read-only 仍逐次确认 | 75% | Computer Use 与项目 MCP 真实任务 |
| COD-08 | “完全访问”仍保持硬边界 | 策略测试存在；Full Access 对本地/已选普通 MCP 可自动执行，但 GitHub/Linear/Jira/Slack 等外部账户写入仍要求确认；`bridge-background-process.test.js` 覆盖 Full Access 后台任务即使离开工作区，也不会继承宿主 Provider Key 或模型显式传入的 `*_API_KEY` env | 50% | 打包 App 越界负向验收 |
| COD-09 | 付费、账户授权、扩大 Scope、发布仍独立确认 | ImageGen、MCP、Endpoint、PR 测试存在；`bridge-auto-approval.test.js` 覆盖 OAuth、PR/Release 发布和托管外部账户写入在所有权限档下都不被自动批准 | 75% | 真实 Provider 与托管发布确认 |
| COD-10 | Markdown、HTML、图片产物预览 | Go/Vue 实现与安全测试存在；前端建议列表只展示工作区相对路径内的 Markdown、HTML 与图片产物，不再建议绝对路径或 `..` 逃逸形态；`CodingArtifactPreviewPanel.test.ts` 覆盖用户可见的 Markdown/HTML/图片建议入口、三种产物渲染、手输不安全或不支持路径会在前端拦截且不调用后端、Markdown/HTML 产物内容以及建议/标题/图片 alt 在渲染层脱敏 Provider Credential 形态、失败后清空旧预览；`desktop.test.ts` 锁住桌面 adapter 会把 `workspacePath` 与 `relativePath` 原样传给 Wails `GetCodingArtifactPreview`；2026-08-04 补 browser-preview 边界提示，预览环境不会伪造工作区产物内容或调用读取命令，而是引导用打包 App 做真实验收；2026-08-05 `MILKSU_ARTIFACT_PREVIEW_LIVE_SMOKE=1 npm run test:artifact-preview-live` 用真实 `build/bin/MilkSU.app` 从隔离 workspace 读取 Markdown、HTML、PNG，并拒绝 workspace escape、伪装 PNG 和 SVG，报告保存到 `build/test-results/artifact-preview-live.json`；同日真实打包 MilkSU UI 通过目录选择器绑定 `/private/tmp/milksu-artifact-ui-live.w7igPl/workspace`，在 Coding → 产物中手动预览 `reports/summary.md`、`reports/result.html` 和 `images/screenshot.png`，开发者验收详情记录“用户可见验证/真实 App 验收” | 90% | HTML WebView sandbox 原生负向验收归 `COD-11` |
| COD-11 | HTML 隔离、CSP、禁网、路径与大小限制 | `artifact_preview_test.go` 等自动化；`codingArtifact.test.ts` 覆盖外部资源剥离、CSP 和不安全建议路径过滤；`CodingArtifactPreviewPanel.test.ts` 覆盖 HTML 预览使用空 sandbox iframe、注入 `default-src 'none'` CSP，手输逃逸路径不会进入预览后端，并向用户显示无脚本/无网络说明 | 50% | 原生 WebView 负向验收 |
| COD-12 | 隔离 Browser 自动化与证据边界 | Browser integration 与 41 项窄测试通过 | 100% | — |
| COD-13 | MilkSU 项目前端视觉 QA 真实纵切 | `frontend-visual-qa-acceptance.md` | 100% | — |
| COD-14 | 用户授权的其他项目前端视觉 QA | 尚无项目与任务证据 | 0% | 用户提供一个授权前端项目 |
| COD-15 | Computer Use 选择当前可见 App / 窗口并生成不可变 Scope | Go Host 枚举可见窗口，前端选择，动态 session policy，descriptor/proxy 锁定 bundle、PID、window；能力摘要已显示真实 App、bundle、PID 和 window，不再写死 MilkSU 自身；Bridge descriptor 拒绝带换行或控制字符的 App 名称，避免污染不可变 Scope 提示；`codingPolicy.test.ts` 覆盖 UI 启动参数只来自用户选定的 PID/window pair，不因同名 App、同 PID 多窗口或同 windowId 不同 PID 漂移，覆盖 ChatPage 刷新可见窗口列表时优先保持当前选择、否则回到已启用会话精确目标、最后才退到第一个窗口，并锁住 Plan/read-only 即使已有目标也不能展示为可操作；`CodingComputerUsePanel.test.ts` 覆盖右侧栏展示外部 App 的 bundle/PID/window、重新检测、权限就绪后显示“可启动”而不是“未接入”、启动前仍不标成“已接入”、其他任务占用禁用、缺窗口显示“待选择窗口”和正式接入说明；`codingPolicy.test.ts` 覆盖能力列表中检测到窗口但未启动时提示进入 Browser/App 面板点击“启动可见会话”，不误写成已锁定；`desktop.test.ts` 覆盖 browser-preview 下 Computer Use 状态返回友好桌面运行时 fallback，不再裸露 unsupported command；Browser 渲染检查已在干净 `127.0.0.1:1421` 点击 Coding → Browser/App 并看到 fallback 文案；`1698e39` 在 Coding 产品闭环卡增加“Computer Use 快速接入”，Browser preview 验证点击后会打开“浏览器与 App”面板并显示 Computer Use 接入清单；2026-08-05 packaged proxy live smoke 用真实 `build/bin/MilkSU.app` sidecar node + `computer-use-proxy.cjs` + `cua-driver`，在外部 Calculator 精确 bundle/PID/window Scope 内完成 observe → click 1 → observe，并保存 JSON 与前后截图；packaged App facade live smoke 又用真实 `MilkSU.app` 进程列出外部 Calculator、按精确 PID/window 启动 session、验证 descriptor socket、再停止并清空 session；同日真实打包 MilkSU UI 使用隔离 App data 启动，在 Coding → 浏览器与 App 中选择 `计算器 · 计算器`，点击 `启动可见会话` 后状态变为 `已接入当前任务`，显示 `com.apple.calculator · PID 85601 · Window 61879`，再从 UI 点击停止回到 `可启动`；随后同一隔离 App data 重启 MilkSU，确认任务保留但旧 Calculator Scope 不会幽灵恢复为已接入，并用 Computer Use 对外部 Calculator 完成 `2+3=5` 真实点击；证据保存到 `build/test-results/computer-use-ui-live.json`、`build/test-results/computer-use-ui-live-after-start.png`、`build/test-results/computer-use-restart-live.json`、`build/test-results/computer-use-restart-live-calculator-operation.png` 和 `build/test-results/computer-use-restart-live-after-restart.png`；Go、Node、前端/Wails 构建通过 | 90% | 主模型消费截图完成真实任务 |
| COD-16 | Computer Use 一次性系统权限真实验收 | UI 已说明 App 管理不能替代辅助功能/屏幕录制，提供请求系统权限和重新检测入口；`1698e39` 增加从产品闭环卡直达权限/可见窗口接入面板的用户路径；2026-08-04 又把缺系统权限、待选择窗口、可启动和已接入分开展示，避免用户把“App 管理”或“已检测到窗口”误解成 Computer Use 已完成接入；2026-08-05 在用户已授权系统权限并放行本机拦截后，packaged proxy live smoke 成功读取外部 Calculator 窗口截图并执行点击；随后 `MILKSU_COMPUTER_USE_APP_LIVE_SMOKE=1 npm run test:computer-use-app-live` 用真实 `MilkSU.app` App facade 完成 list/start/status/descriptor/stop，报告保存到 `build/test-results/computer-use-app-live.json`，证明权限可支撑 App 层启动外部窗口会话；同日真实 MilkSU UI 点击验收显示辅助功能/屏幕录制按钮均 disabled 且状态可启动，说明当前授权支撑 UI 内外部窗口会话启动；随后同一隔离 App data 重启 MilkSU，按钮仍可读、会话回到 `可启动`，没有把旧 Calculator PID/window 当作仍授权会话 | 90% | MilkSU 设置面板重新检测 |
| COD-17 | Pi 持久会话、Compaction 与连续性 | fixture、事件投影和既有真实任务；`codingContinuity.test.ts` 覆盖任务删除时同步清理 ready/resumed、compacting、compactedAt 和 compaction errors，避免删除后的幽灵恢复/压缩状态；`codingContinuityPresentation.test.ts` 覆盖待连接、恢复、新会话、整理中和已整理状态的用户可见徽章、说明和整理按钮禁用原因；`agentRecovery.test.ts` 覆盖用户中断/取消、`context canceled`、`aborted`、上下文窗口过长、`context_length_exceeded` 和 token limit 等停止会被识别为可继续，同时用户发出新要求后不复用旧失败继续入口 | 75% | 完整 App 重启长上下文验收 |
| COD-18 | 重启后后台任务、PID、端口、日志和长任务恢复 | Sidecar fixture 与部分打包任务存在；`CodingTerminalPanel.test.ts` 覆盖恢复后的用户可见状态，展示 recovered 提示、PID、端口和日志 tail，并覆盖 browser-preview 下不会刷新/启动后台任务或把空列表伪装成真实 runtime；`bridge-background-view.test.js` 覆盖恢复投影把持久记录里的 `spawnPid` 映射为用户可见 PID，避免重启后进程号丢失；`desktop.test.ts` 锁住刷新、启动和停止后台任务时 conversation、workspace、命令、名称、executionMode 与 approvalPolicy 传给 Wails 的正式入口；2026-08-04 Browser preview 验证 Coding → 终端/测试 → 后台任务会明确提示真实命令、端口、日志和跨应用重启恢复必须在打包 App 中验收 | 50% | 跨 App 重启的真实长任务 |
| COD-19 | 旧 PTY 明确结束且审批跨重启过期 | 自动化测试存在；`bridge-approval.test.js` 覆盖 App/Sidecar 审批通道关闭时多个会话的 pending approval 全部以拒绝过期，旧 requestId 不能在重启后继续批准；`manager_test.go` 覆盖 Manager 关闭会让运行中的旧 PTY 发出 stopped 事件，且关闭后的 Manager 不能再启动看似可重连的新 PTY；`CodingTerminalPanel.test.ts` 覆盖空 Shell 列表时 UI 明确提示交互式 Shell 不跨 App 重启恢复、旧 PTY 已结束且不可重连，并引导后台长任务在“后台任务”恢复；browser-preview 下 Shell 视图明确只验证入口且不读取终端历史；`agentRecovery.test.ts` 覆盖 Coding/CTF 继续提示会明确禁止复用重启前审批状态，并要求扩大权限、Endpoint、应用窗口或外部发布时重新做有意义确认 | 50% | 原生 App 真实重启负向验收 |
| COD-20 | Diff、Hunk、stage、commit、push 日常闭环 | 代码、测试和历史真实验收完成；2026-08-04 补 browser-preview Git 交付边界提示，预览环境不再把“不能读取 Git 状态”误呈现成普通非 Git 仓库，并明确真实 Diff/Hunk、stage、commit、push 和 PR 确认需要打包 App | 100% | — |
| COD-21 | PR 预览、一次性确认和私有远端限制 | `pull_request_test.go` 覆盖一次性 token、过期、状态变化、私有 MilkSU 远端、窄 `gh pr create` 和读回验证；`CodingChangesPanel.test.ts` 覆盖 UI 先展示仓库/分支/提交/目标，再单独发布，不把内部 confirmation token 显示给用户，后端拒绝过期预览或错误文本回显 token 后清空旧确认并脱敏 token，异常 preview 若指向非 MilkSU 私有仓库则不会进入确认态或调用发布，并在重新准备 PR 时清掉上一轮成功结果，避免旧外部写入状态与新预览混淆；`desktop.test.ts` 覆盖 Wails adapter 会把 workspace、confirmation token、title 和 body 原样传给发布命令，省略标题/正文时只传空字符串而不是 `undefined` | 50% | 真实托管平台 Draft PR |
| COD-22 | 经确认发布 MilkSU 私有 Draft PR | 尚无本轮真实发布回执 | 0% | 在最终自举 Gate 中执行 |
| COD-23 | 多 Agent 独立 worktree、恢复和安全收尾 | Manager 与 Bridge 自动化存在；`bridge-collaboration.test.js` 覆盖并行和串行写入 Agent 都必须使用不同注册 writer worktree，Go Manager 覆盖恢复、集成后清理、脏 worktree/submodule 拒绝和中断准备安全收尾；`CodingCollaborationPanel.test.ts` 覆盖显式 2 writer 准备、集成后安全结束和中断准备后的有界清理；`desktop.test.ts` 覆盖 Wails adapter 会把 conversation、workspace 和 writer 数原样传给准备命令，省略 writer 数时默认为 1 | 50% | 真实有价值的协作任务 |
| COD-24 | 多 Agent 在真实任务中证明并行有用 | 尚无成功率与成本证据 | 0% | 选择自然可并行的任务验收 |
| COD-25 | 完整 “MilkSU develops MilkSU” Gate | 有多个局部自举任务；产品闭环冲刺期间已补 TopBar 一致性和显式 module 契约、CVE→Coding handoff、Computer Use 快速接入、CTF/CVE 路由保留契约、产品闭环卡生成恢复点入口、用户验收清单、合并状态投影、清单行内操作入口、待补任务 prompt、CVE 当前下一步摘要、原生 App 验收接力卡和多轮前端 test/build/Browser preview 证据；`86ee5d9` 通过完整 `npm run m3:release-check` 并重新生成本机 `MilkSU.app`；2026-08-04 在 compact 控件视觉收敛后再次运行最新 HEAD 的 `npm run m3:release-check`，先发现 Go 样式契约仍期待旧行高，修正后重跑通过并重新生成 `/Users/milksu/code/milksu/build/bin/MilkSU.app`，Coding delivery fixture 仍为 score 100、外部 Provider cost 0；随后 Coding 产品闭环卡新增“推荐小自举任务”复制入口，把低风险、用户可见、测试/build/Browser 验证、登记非阻塞问题、commit/push 和 Provider Key 边界写进下一轮 Agent prompt，并由 `CodingProductLoopPanel.test.ts` 与 Browser preview 证明入口可见；CVE 情报源刷新也改成可验证的本机快照复核与只读 Feed 导入接力，避免把静态样例误呈现成实时情报能力；最新在 Coding 合并状态卡下新增 `Coding 待补证明` 短列表，直接列出当前未完成验收项并提供面板/恢复入口，避免下一轮 Agent 或用户从长清单里猜缺口；2026-08-05 在 `962e74f` 再次执行完整 `npm run m3:release-check`，Go/vet/Node/Vitest/lint/build/sidecar smoke/Coding delivery/docs build/Wails build/codesign 均通过，并重新生成 `/Users/milksu/code/milksu/build/bin/MilkSU.app`；这覆盖了 packaged Computer Use App facade smoke 与 packaged artifact preview smoke 后的新 HEAD | 30% | 一次完整 Vue + Go、重启、交付、PR |
| COD-26 | ImageGen 文生图、参考图编辑和项目资产 | 受控工具、UI、测试与打包存在；ImageGen 审批详情只保留允许字段，并会脱敏 `Bearer` / `sk-*` 形态，防止模型把 `apiKey` 或 `Authorization` 等额外字段塞进用户审批卡 | 50% | 真实 Provider 生成 |
| COD-27 | 打包 App 真实 ImageGen Provider 与预览 | Provider 尚未在 App 内配置 | 0% | 用户自行配置后执行，不接触 Key |
| COD-28 | Project MCP 来源、版本、工具面与权限审阅 | Go/Vue/Bridge 实现和测试存在；`npm run test:project-mcp` 通过正式 `loadCodingMcpConfig`、固定 `.mcp.json` digest、sandbox wrapper、`env -i` 私有 HOME/TMPDIR、`hostConfigDiscovery=off`、MCP SDK `listTools/callTool` 实际调用本地项目 `fixture_read`，并输出 `workspaceAutoApprovalRequired=false` 作为自动审批契约证据 | 75% | 用户真实项目或高频 MCP 任务验收 |
| COD-29 | 高频 Plugin 候选完成真实任务 | 尚未由使用频率选出候选 | 0% | 先收集重复工作流与替代失败 |
| COD-30 | 代表任务成功率、接管、恢复、成本对照 | Coding delivery gate 已输出 `milksu-run-manifest/v1alpha1` 与 `milksu-agent-scoreboard/v1alpha1`，覆盖任务 ID、fixture digest、工具面、预算、人工介入、失败分类和未运行基线状态；共享 validator 已拒绝 `not-run` baseline 携带成绩、缺失败/介入证据、预算超限、隐私边界松动和 `passed=true` 但非满分等误报形态 | 25% | 从用户真实历史选择固定 20 项，运行 MilkSU 与裸 Codex/Pi 对照 |
| COD-31 | Computer Use 工具截图接入纯文本模型的辅助视觉回路 | Bridge `tool_result` hook 为 `milksu-computer-use/computer_use` 截图追加受控视觉摘要；辅助视觉缓存不保存原图；64 项 Node 窄测试、Go、前端 lint/build 通过 | 50% | 打包 App 中用纯文本主模型和真实辅助视觉完成外部窗口定位验收 |
| COD-32 | Obelisk 形态 Session Index / 相关历史 | 2026-08-04 用户将 Obelisk 提为当前 P0，并明确不接受外部 CLI 安装/检测路径。本批次新增 `internal/sessionindex`，MilkSU 在 App data 下初始化 `session-index/obelisk.sqlite`，使用 Obelisk 兼容 sessions/messages/tool_calls/tool_results/subagents/workflows/memories/FTS schema；`RefreshMilkSUConversations` 把 MilkSU 本机 Coding/CTF/CVE 会话、工具调用、时间、工作区和来源写入索引并统一脱敏；App/Wails 暴露 `GetSessionIndexStatus`、`RefreshSessionIndex`、`SearchSessionHistory`，查询前刷新 MilkSU 自己的会话索引；前端新增 `SessionHistoryPanel`，在 Coding 右侧栏、CVE 详情和 CTF 复盘侧栏展示“相关历史”，UI 不显示“事实源/正式档案/历史线索”等原则文案；`go test ./internal/sessionindex`、`TestAppSessionIndexRefreshesMilkSUOwnedHistory`、`TestSessionIndexPackagedSmokeRunsAppSearch`、`desktop.test.ts` 和 `SessionHistoryPanel.test.ts` 覆盖 schema、刷新、FTS/LIKE、脱敏、Wails adapter、浏览器预览空态和 UI 不泄露内部边界文案；2026-08-05 `node scripts/test-local-delivery-baseline.mjs` 使用独立 `MILKSU_INSTANCE_ID` 和隔离 HOME 启动真实 `build/bin/MilkSU.app`，预置本地会话，App 进程内完成 `SearchSessionHistory` 并输出 `sessionIndexSmoke.resultCount=2`、`source=milksu-coding`、`toolCallCount=1`、`gates.sessionIndexPackagedSearch=true`；同日 CVE 页面新增“记入笔记”确认动作，只有用户点击相关历史结果后才写入当前 CVE 研究笔记，并在展示/写入时脱敏 Provider Credential；Coding Chat 的相关历史新增“引用到输入”，用户确认后把脱敏历史摘要追加到输入框草稿，不直接发送给 Agent；CTF 复盘侧栏新增“引用到复盘”，用户确认后只追加到复盘草稿，保存 Memory 仍必须走原有复盘与保存记忆链路；同日用隔离 `MILKSU_APPDATA_DIR` 启动真实 `build/bin/MilkSU.app`，从 Coding 右侧相关历史搜索 `ArtifactPreviewQuotedSmoke`，点击“引用到输入”并发送，随后 Agent 回复明确提到 `History UI source for artifact preview` 和 `ArtifactPreviewQuotedSmoke`，会话 JSON 检查确认引用进入用户 prompt、Agent 消费该历史、fixture credential 原文未落盘，报告 `build/test-results/session-history-agent-consumption-live.json`，截图 `build/test-results/session-history-agent-consumption-live.png`；同日新增显式 JSONL 外部历史导入器、`ImportExternalSessionHistory` App facade 和 `import_external_session_history` bridge，支持 `codex / claude / kimi / pi` 来源；真实打包 App live smoke 导入 Codex fixture 后搜索命中 2 条结果，报告 `build/test-results/session-history-import-live.json` 证明 indexPath 在隔离 App data、fixture key 未泄漏且没有重复 redaction 标记 | 95% | 真实用户历史目录选择、Claude/Kimi/Pi 扩样、上游 Obelisk 许可证/NOTICE/ADR 收口；Coding 侧仍需用相关历史完成一次真实代码修改、测试、预览、commit/push 交付 |

## CTF 通用闭环与网络边界

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| CTF-01 | 动态 Endpoint 申请、逐条确认、不可变 Scope | 代码、UI、自动化和本机 HTTP 授权记录；`CTFEndpointAuthorization.test.ts` 覆盖 pending source/purpose、准入 Scope 和单独批准 Scope 的 Endpoint 授权展示会脱敏 Provider Credential 形态，同时 approve/deny 仍只提交原始 request ID | 75% | 真实远端 Web/Pwn 扩样本 |
| CTF-02 | HTTP 精确 Origin broker、禁重定向 | 自动化与本机精确 Endpoint 验收 | 75% | 真实 Web 题网络证据 |
| CTF-03 | TCP 与 SSH 分离的精确 `host:port` | 领域和策略自动化存在；`bridge-policy.test.js` 覆盖 SSH grant 只暴露 `ctf_ssh` 而不暴露 `ctf_socket`，即使模型传入 username/password/command 噪声字段也只读 Banner 且发送 0 字节 | 50% | 真实 Pwn TCP 与 SSH 各一次 |
| CTF-04 | 通用 Shell 默认无网络且不因 Scope 广开 | 策略与负向测试存在 | 50% | 打包 App 真实拒绝证据 |
| CTF-05 | Endpoint 不继承 Cookie、Token 或浏览器会话 | 隔离设计和自动化存在；`bridge-policy.test.js` 覆盖 `ctf_http` 收到 `Set-Cookie` 与 `WWW-Authenticate` 后，后续请求仍不自动携带 Cookie 或 Authorization ambient state | 50% | 真实跨能力负向验收 |
| CTF-06 | Web 真实 Judge-verified 完整闭环 | NSSCTF P3879 `correct=true` 记录 | 75% | 纳入固定六题回归清单 |
| CTF-07 | Pwn 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-08 | Reverse 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-09 | Crypto 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-10 | Forensics 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 独立于 Misc 的完整题目闭环 |
| CTF-11 | Misc 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 独立于 Forensics 的完整题目闭环 |
| CTF-12 | 六题固定回归清单 | `ctf-six-track-regression-manifest.json` 固定六个赛道 slot、统一 requiredEvidence、跨赛道 Tool Builder/Strategist 协作项和 Web/P3879 既有 `correct=true` 证据引用；`npm run test:ctf-six-track-regression` 校验六轴顺序、缺失赛道不得伪造 `correct=true`、已验证赛道必须有权威 Judge 与完整证据 refs；2026-08-04 CTF 默认桌面已可见六赛道 Judge 状态并明确 smoke 不等于完整 CTF 成绩 | 50% | 选定其余五赛道真实题目，补平台、题号、材料类型、验收日期和 Judge 回执 |
| CTF-13 | Solver 卡关 → Coding Tool Builder → Solver | Tool Workshop 代码与测试存在 | 25% | 真实自然卡关闭环 |
| CTF-14 | 重复失败 → 独立 Strategist → Solver | 角色与恢复基础存在 | 25% | 真实独立会话重规划闭环 |
| CTF-15 | Evidence、候选、Judge、Checkpoint、恢复和复盘主链 | 主链代码、测试及一题真实记录；`CTFSubmissionGate.test.ts` 覆盖 Agent 候选说明、格式 warning、Judge 回执 summary 和外部 Judge label 在提交/Judge UI 层脱敏 Provider Credential 形态，同时提交按钮行为不变；2026-08-04 CTF 会话 header 增加“返回题库不会结束当前会话”的用户可见说明，并由 `CTFWorkspaceHeader.test.ts`、App routing contract、workspace session routing 和 CTF navigation contract 覆盖返回题库、KeepAlive、resume point 与最近 Coding 会话回退；2026-08-05 Browser 真实渲染烟测点击 `CTF(P382/gift_F12)` → `CVE` → `Coding` → `CTF`，返回后仍显示 NSSCTF 题库、P382 题目详情和 CTF rail 选中，Console 无 error/warn | 80% | 在其余五赛道重复验证；打包原生 App 中运行中 Agent job 切换模块后继续解题的真实验收 |

## Memory 与能力画像

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| MEM-01 | `actor=user/agent/shared/imported` | 领域模型和归属测试存在 | 50% | 真实轨迹校准 |
| MEM-02 | `assistance=none/hint/copilot/delegated` | 领域模型和模式测试存在 | 50% | 真实轨迹校准 |
| MEM-03 | 用户独立步骤只来自显式用户记录 | 自动化拒绝反思/导入冒充 | 50% | 打包 App 真实操作证据 |
| MEM-04 | 模型猜测写入用户能力事实为 0 | 未知 actor fail closed 测试存在 | 50% | 36 条真实轨迹审计 |
| MEM-05 | Judge 正确性与用户贡献度独立 | 服务与投影测试存在 | 50% | 真实题目回执核对 |
| MEM-06 | Memory 与 Ability Profile 分离 | 数据结构和 UI 基础存在；`CTFMemoryRecall.test.ts` 覆盖旧题记忆同时展示正确性证据、贡献归属、推荐依据和证据链接，并在卡片内区分“用户独立能力证据”“协作经验和 Memory”“Agent Memory”，确认 Agent 代做/代理记忆不会显示成“用户完成 · 无协助”，且 legacy/imported 记忆文本和证据按钮会在 UI 层脱敏 Provider Credential 形态 | 50% | 用户侧可解释性验收 |
| MEM-07 | delegate 成功不增加独立完成 | 自动化测试存在；`CTFMemoryRecall.test.ts` 覆盖 Agent/delegate 记忆显示“可作为 Agent Memory，不增加用户独立完成计数”；`CTFTrainingArchive.test.ts` 覆盖 delegate/agent 报告在训练归档页显示“Agent 代做”“代理完成”和“用户独立步骤 0”，且不会误显示“用户完成”或“无协助”；训练回放事件和错误 UI 会脱敏 Provider Key 形态，避免归档查看时把运行错误误当可保存能力证据或泄漏凭据 | 50% | 真实 delegate 样本 |
| MEM-08 | 推荐理由链接 Judge、提示、步骤和失败 | `RecallForChallenge` 返回结构化推荐原因和证据链接；保存记忆时写入 judge/hint/step/failure refs；Agent `MEMORY.md` 与前端记忆卡展示可核对证据；`CTFMemoryRecall.test.ts` 覆盖结构化 recall evidence 会保留 `kind/id`，且缺少结构化 recall links 时回退展示底层 `evidenceRefs`；记忆证据项现在可聚焦/点击并向 CTF 页面发出 `inspectEvidence`，页面提示按当前题目证据、Judge 回执、提示和步骤记录重新核对，避免用户只能看到不可追溯的记忆摘要；`go test ./internal/ctf`、`go test ./...`、前端 lint/build 通过 | 50% | 用真实题目轨迹完成端到端可点击证据验收 |
| MEM-09 | 当前题排除、相关旧题优先、无关题负对照 | `RecallForChallenge` 与相关/无关/当前题自动化存在 | 50% | 跨真实题目的端到端召回对照 |
| MEM-10 | 删除/归档证据后画像与推荐同步 | 归档后 `RecallForChallenge` 不再返回停用记忆，现有 `GetCTFMemoryContext` 会同步重写 Agent workspace `MEMORY.md`，同源 job 重新保存会清空 archive 状态并重新进入召回；`go test ./internal/ctf` 通过 | 50% | 打包 App 中完成可点击归档、推荐消失、Agent 上下文刷新和 Ability Profile 同步验收 |
| MEM-11 | 36 条分层样本与跨题校准 | 尚未执行 | 0% | 6 赛道 × 3 模式 × 每组 2 条 |

## Runtime Reliability 与 NYU Bench

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| RUN-01 | 多轮规划、文件、命令和工具 fixture | deterministic delivery Gate | 100% | — |
| RUN-02 | Sidecar 重启恢复同一会话与后台 Watch | reliability 子报告 | 100% | — |
| RUN-03 | 完整 App 重启恢复 | 部分真实任务和生命周期基础；`codingContinuityPresentation.test.ts` 锁住恢复后用户可见的连续性状态，不把未连接、运行中、整理中、失败整理或旧整理时间误显示为可整理/已恢复 | 50% | 打包 App 长任务连续性 |
| RUN-04 | 正式 Pi Context Compaction | fixture 与专门测试通过 | 100% | — |
| RUN-05 | 超时、取消和继续响应 | fixture 与专门测试通过；`agentRecovery.test.ts` 覆盖无活动超时和网络/连接类失败会显示继续入口，`dial tcp`、`context deadline exceeded`、`i/o timeout`、`TLS handshake timeout` 等网络超时都可恢复，同时 API Key 缺失和模型不支持等配置错误不会误显示为可恢复；恢复提示会要求先核对断点和最近工具结果、不要重复已完成步骤，并明确不复用重启前审批状态 | 100% | — |
| RUN-06 | Token、工具、时长和成本预算 | 固定预算报告存在 | 75% | 真实 Provider 成本核对 |
| RUN-07 | 失败分类与统一 Reliability 报告 | 三类失败和报告 Gate 已通过 | 100% | — |
| RUN-08 | 打包 App 真实长任务恢复 | 只有局部任务证据；前端组件测试已锁住恢复后用户可见的任务状态、PID、端口和日志 tail；后台投影测试已锁住恢复记录的 `spawnPid` 不会在 UI 状态中丢失；桌面 adapter 测试已锁住后台任务 refresh/start/stop 的恢复与权限参数传递 | 25% | 用户可见的完整重启验收 |
| RUN-09 | NYU 安全准入与 safe-static smoke | one-shot 和两回合只读记录 | 50% | 仍不能称完整 Outcome |
| RUN-10 | NYU CTF Outcome Bench | 尚未在六赛道稳定后执行 | 0% | 人工准入子集与正式 Runtime |

## 架构约束

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| ARC-01 | 触碰即拆 `CTFPage.vue` | 已抽出多个组件，当前 2,997 行 | 25% | 后续纵切继续按职责拆分 |
| ARC-02 | 触碰即拆 `browsercap/manager.go` | 有专项测试，当前 1,967 行 | 25% | 扩 Browser/Judge 时拆 Adapter |
| ARC-03 | 触碰即拆 `bridge-policy.js` | 已抽策略模块，当前 2,080 行 | 25% | 后续网络/Computer Use 继续拆 |
| ARC-04 | 收敛 `app.go` 平台适配职责 | 当前 1,499 行，比目标快照更大 | 0% | 相关纵切迁出业务规则 |
| ARC-05 | 拆 CTF Runner/Recovery 与 Service | `service.go` 当前 967 行 | 0% | 修改恢复语义时拆分 |
| ARC-06 | Wails、领域、Pi、平台 Adapter 边界 | 架构测试和包边界部分存在 | 50% | 用后续纵切持续证明无反向依赖 |

## 本地数据安全与正式交付

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| DEL-01 | 五库编号迁移、事务、兼容检查与安全备份 | 代码、自动化和设置入口存在 | 75% | 最终结构收口后全新目录回归 |
| DEL-02 | Pre-release 旧 schema 一次性破坏性收口 | 按契约明确后置 | 0% | 产品纵切完成后集中执行 |
| DEL-03 | 上次启动/异常退出标记与恢复入口 | 打包 App lifecycle baseline 通过 | 75% | 真实异常退出人工验收 |
| DEL-04 | Sidecar、恢复、迁移、后台任务脱敏诊断 | 诊断包、UI 和离线错误测试存在 | 75% | 真实故障包审阅 |
| DEL-05 | 不保存正文、原始工具输出或 Credential | 多处边界测试存在；诊断包测试确认即使 `runtime/milksu.log` 含会话正文、原始工具输出和 Credential 形态，导出包也只包含脱敏 `diagnostics.json`，不复制日志文件；前端聊天错误、审批卡、CTF Endpoint 授权 UI、CTF 提交/Judge UI、CTF 训练归档 UI、CTF Memory Recall UI、Coding 产物预览 UI 和 Coding 后台任务/Shell 错误共用 `redactProviderCredentials`，`redaction.test.ts`、`useConversations.test.ts`、`ChatMessageItem.test.ts`、`CTFEndpointAuthorization.test.ts`、`CTFSubmissionGate.test.ts`、`CTFTrainingArchive.test.ts`、`CTFMemoryRecall.test.ts`、`CodingArtifactPreviewPanel.test.ts` 与 `CodingTerminalPanel.test.ts` 覆盖 Bearer、`sk-*`、`sess-*`、`*_API_KEY`、URL query `api_key`、`x-api-key`、`api-key` 和 header `x-api-key` 形态，并覆盖后台任务名称、命令、日志和错误进入 UI 前统一脱敏，避免不同入口规则漂移 | 50% | 完整诊断与本地文件审计 |
| DEL-06 | `1080×680` 最低窗口 | Browser 真实截图与布局审计 | 75% | 原生 App 全流程人工 QA |
| DEL-07 | 启动时间基线 | 隔离 HOME 打包 App 已测 | 75% | 多次冷启动和目标机器矩阵 |
| DEL-08 | RSS、前端 chunk、App/Sidecar 体积基线 | `local-delivery-baseline.md` | 75% | 多机器重复测量 |
| DEL-09 | 性能回归阈值与支持矩阵 | `test-local-delivery-baseline.mjs` 已加入 pre-release 启动、RSS、App/Sidecar/frontend 体积、最大 chunk 和进程数阈值；报告写出单机 support matrix entry；脚本语法检查与 threshold fixture 通过；真实 App baseline 因已有 MilkSU 进程未打断，待关闭后重跑 | 50% | 多台目标机器重复测量，冻结 RC 阈值和正式支持矩阵 |
| DEL-10 | 全新 macOS、无开发工具安装 | 尚未执行 | 0% | Release Candidate 机器验收 |
| DEL-11 | Developer ID Application 签名 | 当前仍允许 ad-hoc `-` | 0% | RC 签名身份与验证 |
| DEL-12 | Hardened Runtime 与 Entitlements | 尚无完成证据 | 0% | RC 配置和验收 |
| DEL-13 | Apple notarization 与 stapling | 尚无完成证据 | 0% | RC 公证回执 |
| DEL-14 | 签名升级、旧版升级与失败回滚 | 尚无完成证据 | 0% | RC 升级渠道和回滚 |
| DEL-15 | 离线/网络失败的可理解降级 | synthetic 离线模型失败已验收；`useConversations.test.ts` 覆盖聊天运行时 Provider/Agent 网络连接失败会显示可恢复的中文降级说明，并提示工作区、审批和恢复点已保留，同时不会把 URL query 或 header 里的 Provider Key 混入错误 UI | 50% | 打包 App 多入口真实离线验收 |

## 最终文档

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| DOC-01 | 开发期只保留测试、回执、验收记录和 ADR | 当前验收文档遵守此规则；`product-loop-sprint-acceptance.md` 已记录 `d4df0f8`、`42c392d`、`1698e39`、`eefa729`、`d23f7ff`、`18b50f0`、`b15782f`、`bbcbdc1`、`3a57d98`、`0393f85`、`c1af6d0`、`b61749e`、`498a515`、`86ee5d9`、`ac563ec`、`f7f579b`、`2da70e8`、`ada1494` 和 `58851ef` 的窄测、全量前端、Browser preview、M3 release check 与未证明范围 | 75% | 持续保持，不提前写完成声明 |
| DOC-02 | 最后统一更新架构、里程碑、状态和发布说明 | 按目标后置 | 0% | 所有产品与发行 Gate 通过后执行 |

## 横向观察记录

以下观察不是当前现场修复项：

| ID | 观察 | 处理 |
| --- | --- | --- |
| OBS-01 | `current-objectives.md` 中热点文件行数是旧快照；当前为 `2,997 / 1,967 / 2,080 / 1,499 / 967` | 保留原目标文字，本台账记录当前值；修复批次再决定是否更新 |
| OBS-02 | `challenge-intake-and-automation.md` 仍把部分已经落地的 Browser/Computer Use 写成 Planned | 留到最终统一文档收口，不在盘点期修 |
| OBS-03 | Plugin 已有审阅与选择基础，但没有由真实高频历史选出的候选，也没有实际工具成功率 | 保持 COD-29、COD-30 冻结 |
| OBS-04 | Computer Use 的代码边界已存在，但 macOS Accessibility 和 Screen Recording 是独立系统权限 | 等用户参与，不由自动审批绕过 |
| OBS-05 | safe-static 与 Reliability fixture 很强，但不等于六赛道或 NYU Outcome 成绩 | 分别由 CTF-06..11、RUN-10 保持未完成 |
| OBS-06 | Vue/Go Code Action 使用正式打包 LSP，但当前证据来自 probe，不是原生 App 真实任务 | `COD-04` 在第二轮由 75% 校准为 50%，不修改产品 |
| OBS-07 | Project MCP 已补本地项目 fixture 的实际 `fixture_read` 调用；仍不是用户真实项目或高频 MCP 任务 | `COD-28` 保持 75%，后续等真实任务再推进 |
| OBS-08 | 六赛道动态覆盖矩阵和 6/6 判定已存在；版本化 manifest 和校验脚本已补，但五个非 Web 赛道仍未选定真实题目 | `CTF-12` 保持 50%，后续真题验收时补满固定题目与回执 |
| OBS-09 | Memory 已自动验证当前题排除、相关旧题优先和无关题负对照 | `MEM-09` 从 25% 校准为 50%，仍缺真实轨迹 |
| OBS-10 | Memory 归档已经同步推荐召回和 Agent 上下文文件；Ability Profile 当前仍主要由训练信号/Judge 轨迹投影，不由 Memory 表直接驱动 | `MEM-10` 保持 50%，真实 App 归档和画像联动后再推进 |
| OBS-11 | Runtime 已能投影后台任务 PID、端口、日志并在 Sidecar 重启后恢复，缺口是完整 App 的用户可见长任务 | `RUN-08` 保持 25%，不重复实现 Sidecar 恢复 |
| OBS-12 | 本地交付报告已有单机启动、RSS、chunk 和包体测量；pre-release 阈值和单机 support matrix entry 已补，但没有多机 RC 矩阵 | `DEL-09` 保持 50%，RC 阶段重复测量后再冻结正式阈值 |
| OBS-13 | 打包 App 已能用隔离数据目录和隔离单实例锁启动第二个 MilkSU 进程，但 Computer Use 当前按 bundle/path 取到前台既有 MilkSU 窗口，无法精确选择同 bundle 的隔离 QA 窗口 | 不计入 `COD-15`/`COD-16` 完成；后续修复批次需要让 Computer Use/窗口选择能稳定绑定 bundle + PID + window |
| OBS-13 | macOS “App 管理”权限不等于 Computer Use 所需 Accessibility；截图可用也不代表 AX 可用；`CodingComputerUsePanel.test.ts` 已覆盖缺辅助功能/屏幕录制时启动禁用、可请求系统权限，并在 Computer Use 不可用时禁用请求按钮；2026-08-04 面板状态已区分缺系统权限、待选择窗口、可启动和已接入当前任务 | `COD-16` 仍需单独真实验收 Accessibility 与 Screen Recording |
| OBS-14 | `ChatPage.vue` 的 Computer Use UI 已抽为 `CodingComputerUsePanel.vue`，并有面板级测试覆盖外部 App/window 展示、启动按钮和其他任务占用禁用；`desktop.test.ts` 已锁住 `start_coding_computer_use` 会把用户选定的 `conversationId`、`targetPid`、`targetWindowId` 原样传给 Wails；ChatPage 刷新可见窗口列表的选择逻辑已抽为 `nextComputerUseTargetKey` 并测试，不因同名 App、同 PID 多窗口或同 windowId 不同 PID 漂移；2026-08-04 能力列表已用 `describePendingComputerUseCapability()` 区分不可用、缺权限、待窗口、待启动和 Plan/只读阻止，不再把所有未启动状态统一显示成“未接入”；browser-preview adapter 已给 Computer Use 状态/权限/targets 命令提供友好 fallback，Browser 渲染检查确认不再出现 `Unsupported browser-preview command`；仍缺整页 ChatPage 时序和打包 App 外部窗口真实验收 | 后续若建立 ChatPage 测试基架或做打包 App 外部窗口验收时补，不在当前批次深挖 |
| OBS-15 | `workspace-auto` 对未知或项目 MCP 目前只自动放行 read-like 工具；对经过用户审阅并固定 Scope 的本地 Project MCP 写工具仍可能产生重复审批 | 先不现场放宽，避免没有工具面/Scope 证据时扩大权限；等真实高频 Project MCP 候选确定后，为已审阅本地工具增加更精确的自动审批契约 |
| OBS-16 | 与裸 Pi Agent 相比，MilkSU 过去过早把大量精力投入权限、恢复、脱敏和文档边界，导致“能像裸 Harness 一样顺滑干活”的主链体感滞后 | 下一阶段优先真实可用闭环：Computer Use、Browser、Project MCP、Artifact Preview、ImageGen 和小型 MilkSU develops MilkSU；除 Key、Scope、私有远端、Judge/能力归因硬红线外，非阻塞细节先登记后修 |
| OBS-17 | 当前用户明确要求产品 UI/UX 上有完整闭环；CVE 作为一级菜单不能只停在暂停文档，至少要有学习/追踪工作台骨架、状态、安全边界和后续 Coding Agent 可接手任务；Lab 暂不实现 | 见 `product-loop-sprint.md`；MilkSU 已有 CTF 模块，当前冲刺不新接 CTFd；CVE 只做学习/追踪，不做红队 Agent、批量打靶或自动 PoC；`b15782f` 已让 CVE 列表直接展示研究任务、练习、接力和笔记闭环状态，减少用户必须点进详情才知道在研究什么的问题；`498a515` 补 CVE 待补任务 prompt，便于后续 Agent 只接未完成学习/追踪项；2026-08-04 又在 CVE 顶部 metrics 增加当前选中 CVE 的下一步行动摘要，按本地证据递进到建立研究任务、确认练习计划、交给 Coding、补用户笔记或复制证据摘要；随后补“本地练习启动前清单”和可复制启动前计划，让 ActiveMQ/Vulhub 匹配从静态卡片推进到可交给 Coding Agent 的安全启动前检查；最新又加入 Vulhub 只读目录匹配状态卡，记录固定 `aeaf657` 快照、默认未匹配原因和 ActiveMQ 已匹配证据；随后补 CVE→Coding→CVE 返回路径，Coding 顶栏显示 `CVE 接力` 和“返回 CVE”，Browser preview 证明即使 Agent runtime 不可用也不会丢来源；2026-08-04 顶部“当前下一步”状态卡新增可执行按钮，Browser preview 验证 ActiveMQ 可从 `建立` → `确认` → `交给 Coding` 递进，并保持不导入完整 catalog、不启动 Docker、不运行 PoC/exploit；随后把刷新按钮改成 `刷新 CVE 本机快照`，页面显示 `尚未复核`/`本机复核 rev` 和“下一步可交给 Coding Agent”的只读 Feed 导入计划，避免用户把 4–7 条内置快照误解成实时情报接入；给导入计划增加 `复制导入任务`，生成受限 prompt 要求只做只读 Feed/Catalog 导入，固定 source/revision/digest/失败原因，继续禁止 Docker、端口、漏洞触发输入、外部目标和 Provider Key；新增 `导入 JSON` 本地只读导入入口，支持用户粘贴对象/数组/items/vulnerabilities/cves/results 样本并生成本机追踪条目，Browser preview 验证导入后条目从 7 变 8 且仍显示 `尚未复核` / `刷新不会联网拉取 Feed`；最新又给导入结果增加可见结果条和 `撤销本次导入`，Browser preview 验证撤销后导入记录消失、计数回 7，且内置重复 CVE 不会被误删；2026-08-05 packaged CVE feed live smoke 用真实 `build/bin/MilkSU.app` 进程拉取 NVD `CVE-2024-3400`，保存来源、获取时间、snapshot 哈希/大小和 CRITICAL/10.0 等选中 CVE facts；同日 packaged CVE feed matrix smoke 用真实打包 App 为 `CVE-2023-46604` 同步 NVD、FIRST EPSS、CISA KEV 和 Vulhub practice catalog，保留四份 snapshot，并匹配 `activemq/CVE-2023-46604/docker-compose.yml`；Lab 后置为 HTB/TryHackMe/pwn.college 等外部靶场辅助与进度追踪计划 |

## 暂存缺陷

开发和真实验收新发现的非阻塞缺陷追加在这里，至少记录复现条件、影响范围、证据位置和建议
处理层。没有可复现证据时先记为 `OBS-*`，确认是产品缺陷后分配 `BUG-*`。

| ID | 问题 | 复现与证据 | 影响 | 计划处理层 |
| --- | --- | --- | --- | --- |
| BUG-01 | GUI 任务在 Computer Use 未接入时没有停下并引导启用能力，而是用 Full Access Shell 研究目标 App 的截图、数据目录和内部 IPC | 2026-08-03 MilkSU 临时沙盒对话“找到那个 codex 那个 App…”；环境面板显示 `Computer Use：未接入`，轨迹随后尝试 Accessibility、截图、`goals_1.sqlite` 和 Electron IPC，外部调用最终为 `no-client-found`；2026-08-03 已接入 Coding policy guidance，未启用时要求停下并提示开启可见 Computer Use，会明确禁止 bash、截图目录、SQLite、Electron IPC、私有协议和网络逆向作为 UI 控制替代；启用时提示不可变 app/window Scope；2026-08-03 修复前端能力摘要仍写“当前 MilkSU App”的旧文案，改为展示真实 target name、bundle、PID 和 window，并用 `codingPolicy.test.ts` 锁住；2026-08-03 前端能力预览与 Bridge 会话策略均补充“不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过可见会话 Scope”，并由 `codingPolicy.test.ts` 与 `bridge-policy.test.js` 锁住 | 浪费长时间上下文，绕开产品设计的可见应用 Scope，也让用户误以为 Computer Use 不可用 | 路由护栏与误导文案修复已落地；后续在打包 App 中做真实外部 App 操作验收，确认模型不再绕用 Shell/IPC |
| BUG-02 | `m3:release-check` 在进入实际检查前要求 `internal/computercap/session-policy.yaml` 被 Git 跟踪，但当前文件不存在且未被跟踪 | 2026-08-04 执行 `npm run m3:release-check`，脚本输出 `Required Computer Use source is not tracked by Git: internal/computercap/session-policy.yaml`；随后补入 `internal/computercap/session-policy.yaml` 作为打包 Cua Driver smoke policy，运行时仍由 `internal/computercap/manager.go` 按用户选择的 App 动态生成 per-session policy；同批次补齐 `package-sidecar.mjs` smoke fixture 的 `targetWindowId`；重新执行完整 `npm run m3:release-check` 通过并输出 `M3 engineering release checks passed.` | 合并前总检查门禁已恢复 | 已关闭；后续只在新的 `m3:release-check` 失败时重新登记 |
| BUG-03 | 从 CTF/CVE 回到 Coding 时，在没有 remembered Coding 会话的情况下可能恢复到会话数组里的第一个非 CTF 对话，而不是最近一次 Coding 对话 | 2026-08-04 用户反馈“从 CTF 切换到 CVE 后，再回去显示最顶部的对话，而不是最底部/最近的”；代码证据为 `selectCodingConversationId()` 曾依赖 `createdAt`/数组顺序，Coding 历史分组也只按 `createdAt` 排序，不能表达“旧会话刚刚继续过”；本批次新增 `conversationActivityAt()`，按最后消息 `timestamp`（否则退回 `createdAt`）统一驱动 Coding 恢复 fallback 与 sidebar 分组排序，并给“新建但未继续”和“旧会话最近继续”的场景增加回归测试；`eefa729` 进一步锁住 CTF/CVE 页面 KeepAlive、Chat 不被误缓存和 CTF resume point 合约；2026-08-05 Browser 真实渲染烟测覆盖 CTF → CVE → Coding → CTF，未复现丢失 CTF 工作台或恢复到错误 Chat | 模块切换打断用户的任务连续性，容易误以为解题或 Coding 会话丢失 | 自动化和 Browser 渲染烟测均已修复；若仍复现“最顶部/最底部”，优先补打包原生 App 中真实聊天滚动/会话选择证据 |
| OBS-18 | CTF Agent 对话、CTF 工作台和 CVE 页面之间的返回语义仍需产品决策：点击 CTF 是回最近题目工作台、直接回 Solver 对话，还是提供二者入口 | 2026-08-04 用户反馈“CTF 进入解题会话后返回题库/切换 CVE 体验怪”；当前已有 `CTFWorkspaceHeader` 的“返回题库”和 `selectCTFResumePoint()` 恢复最近 job，但模块级 rail 仍只表达一级模块，不表达“回 Agent 对话 / 回工作台”二选一；本批次先把 CTF Agent 对话顶栏从 `Coding` 改为 `CTF`，并在同一 TopBar 动作区增加“返回工作台”入口，避免 CTF 会话看起来属于 Coding 模块；`eefa729` 用 App routing 契约锁住 CTF/Vuln KeepAlive 和 CTF resume point，避免一级菜单切换时直接丢工作台状态；2026-08-04 又把 CTF workspace 顶部“返回题库”、正文“题库”、预算停止“返回题库”和空工作区“选择一道题”全部改为强返回列表路径，清理 NSSCTF/CTFshow 已选题并补 `CTFPageNavigationContract.test.ts`，避免退到半截题目详情页；2026-08-05 Browser 真实渲染烟测确认一级 rail 切出再切回时恢复到 CTF 工作台和 P382 详情，而不是空对话或错误模块 | 已修“返回题库不像返回”的最小体验问题；仍需决定模块级 rail 是否同时暴露“最近 Agent 对话 / 当前工作区 / 题库列表” | 最小体验修正已有前端 test/build 和 Browser 渲染烟测；后续只补打包原生 App + 运行中 Agent job 继续验收，再决定是否加模块内恢复条 |
| OBS-19 | CTF、CVE、Coding 顶栏模块标题已统一到 `WorkspaceModuleTopBar` → `WorkspaceTopBar` → `WorkspaceTopBarTitle`，主工作区 compact 表单控件也已开始收敛；页面内部二级标题、统计数字、卡片按钮和深层组件仍可能存在视觉系统不一致 | 2026-08-04 用户要求三个一级菜单同位置标题必须同一组件和同一大小；本批次新增 `WorkspaceTopBarTitle.vue`，由 `WorkspaceTopBar.vue` 统一调用；Browser preview `http://127.0.0.1:4185/` 依次验证 CTF/CVE/Coding 的 `[data-workspace-topbar-title]` 均为 `H1 + workspace-topbar__title`，渲染字号 `14px`、行高 `20px`、字重 `450`，顶栏 action 区 `14px`，console 无 warn/error；随后发现 CVE `Input size="sm"` 实际仍继承到 16px/12px 与 Select 不一致，本批次把 `Input`、`NativeSelect` 和 `SelectTrigger` 的 compact 字号/行高统一，并给 CTF 题库切换、CTFshow 搜索/筛选、CTF 手动导入、Endpoint 授权、CVE 新增追踪和资产表单补显式 `size="sm"`；Browser preview `http://127.0.0.1:4186/` 复验 CVE 表单 Select/Input 均为 `14px`、`20px`、`32px`；2026-08-04 再次用 `http://127.0.0.1:4188/` 验证 CTF/CVE/Coding 三个一级入口顶栏 title DOM/class 完全一致，并把 CVE 接力 topbar module 计算补成 `ctf / cve / coding` 三态；随后新增 `WorkspaceDetailTitle.vue`，让 NSSCTF、CTFshow 和 CVE 详情主标题复用同一个 `H2 + text-2xl` 规格，Browser preview `http://127.0.0.1:4189/` 验证 CVE 详情 `[data-workspace-detail-title]` 可见且无 console error/warn；CTF 解题会话 header 已复用 `WorkspaceTopBar` 并补“返回题库不会结束当前会话”的说明，避免进入会话后像另一个页面且不清楚返回语义；最新新增 `WorkspaceModuleTopBar.vue`，让 Coding、CTF 题库、CTF 解题会话和 CVE 顶栏不再各自传标题，而是由 `coding / ctf / cve` 模块键统一映射标题和槽位，窄测 5 files / 22 tests 与 production build 通过；2026-08-04 用户在 App 中确认设置入口位置已统一，本批次同步删除 Coding 左侧 context sidebar 底部 `设置` 事件管线，并由 `AppSidebar.test.ts` 锁住 CTF/CVE/Coding sidebars 内不再出现同名设置按钮 | 一级模块导航条、设置入口、主工作区常见表单控件、CTF 会话顶栏和 CTF/CVE 详情主标题不会再因为页面各自默认样式而明显漂移；内部组件视觉债仍会影响整体精致度 | 顶栏、设置入口、compact 表单控件、CTF 会话顶栏和 CTF/CVE 详情主标题已闭环；后续不要重复修同一项，除非有新的截图/测试失败/代码回归证据。Textarea、Tab、统计卡、表格行、深层按钮和原生窗口尺寸 QA 后续按 UI sweep 广度清单处理 |
| OBS-20 | CVE 设置页在隔离 App data 的真实 UI smoke 中仍混入旧默认 App data 的来源证据 | 2026-08-05 用 `MILKSU_APPDATA_DIR=/tmp/milksu-cve-ui-live.CjnNtr/app-data` 启动真实 `MilkSU.app`；同步前设置页已经显示 `/Users/milksu/Library/Application Support/com.milksu.app/vuln/feed-snapshots/...` 的旧 NVD/EPSS/KEV 来源证据；同步后新的四源 snapshot 正确落到隔离 app-data，但当前 CVE 来源证据仍同时展示旧默认路径；报告 `build/test-results/vuln-ui-feed-matrix-live.json` 的 `staleDefaultAppDataEvidenceVisibleBeforeSync` 与 `staleDefaultAppDataEvidenceStillMixedAfterSync` 均为 true | 不影响本轮证明“真实 UI/Wails 同步能落盘新 snapshot”，但会污染隔离 QA 和新机/多实例验收的证据判断 | 暂不现场深挖；后续存储/UI 收口时检查 Wails localStorage、前端缓存和 App data override 的边界，必要时把 CVE 来源证据迁出浏览器 localStorage 或按 App data/instance 隔离 |
| OBS-21 | 相关历史卡片中 API_KEY-shaped fixture 文本会被脱敏，但渲染出的 `[credential redacted]` 标记重复出现 | 2026-08-05 `session-history-agent-consumption-live` 真实 UI 验收中观察到重复标记；随后修复 TS UI redaction 与 Go Session Index redaction 的幂等/旧污染收敛，新增窄测；真实打包 `MilkSU.app` 用隔离 App data 搜索污染样本并点击“引用到输入”，报告 `build/test-results/session-history-redaction-idempotent-live.json` 显示 `historyCardNoDuplicate=true`、`quotedPromptNoDuplicate=true` | 已关闭；后续不要重复把“相关历史重复 redacted 标记”当作未修，除非新截图/测试显示不同形态回归 |

## 已闭环项防重复记录

这些条目用于阻止后续 Agent 把已经修完的体验问题反复当成新任务消费；只有出现新的可复现证据时才重新打开。

| ID | 已闭环项 | 验收/证据 | 后续规则 |
| --- | --- | --- | --- |
| DONE-UI-01 | CTF/CVE/Coding 顶栏标题和同级设置入口统一 | `WorkspaceModuleTopBar`/`WorkspaceTopBarTitle` 已统一标题；用户 2026-08-04 在 App 中确认设置入口位置已统一；sidebars 内重复 `设置` 按钮已删除并由 `AppSidebar.test.ts` 锁住 | 不再为“设置入口不统一”重复开任务；若新页面重新漂移，按 UI sweep 作为新证据登记 |
| DONE-UI-02 | 左下角重复 Logo/全局锚点移除 | `89e7ea8 fix: remove duplicate rail anchor` 删除 WorkspaceRail 的下方 CTF 能力入口，`AppSidebar.test.ts` 锁住 CTF/CVE 不再出现“查看 CTF 能力” | 不再重复处理“双 Logo”；若未来新增全局锚点，必须先说明其唯一导航职责 |
| DONE-UI-03 | Coding 右栏开发者验收与快捷按钮不再默认压迫普通用户 | `CodingProductLoopPanel.vue` 已把产品闭环后台放进默认折叠的 `details[aria-label="Coding 开发者验收后台"]`；快捷按钮使用 `min-w-0 max-w-full overflow-hidden` 和 label `truncate`，`CodingProductLoopPanel.test.ts` 锁住 CSS 契约；2026-08-05 Browser 在 `http://127.0.0.1:1420/` 右栏约 319px 宽度展开验证，`终端/测试`、`产物预览`、`Browser / Computer Use`、`Git 交付` 四个按钮均未越界，Console 无 error/warn | 不再重复修“Browser / Computer Use 和 Git 交付按钮文字叠在一起”；若新截图显示其他宽度/语言下溢出，作为 UI sweep 新证据处理 |
| DONE-M3-01 | 当前代码基线完整工程门禁通过 | 2026-08-05 在 `962e74f` 执行 `npm run m3:release-check`，覆盖 Go test/vet、Node tests、前端 Vitest/lint/build、Sidecar smoke、Coding delivery fixture、docs build、Wails build、ad-hoc codesign 验证和 `check-macos-signing.mjs`，最终输出 `M3 engineering release checks passed.` 并生成 `/Users/milksu/code/milksu/build/bin/MilkSU.app` | 不再重复质疑“当前 HEAD 能否编译/打包”；但这不等价于 COD-25 的完整自举任务、Developer ID 签名、公证、升级或外部 Beta 门禁 |
| DONE-COD-01 | 打包 App facade 能读取 Coding 的 Markdown、HTML 和图片产物预览 | `app_coding_artifact_preview_smoke.go` 新增只在 `MILKSU_CODING_ARTIFACT_PREVIEW_SMOKE_RESULT` 存在时运行的 App 内部 smoke；`scripts/test-packaged-artifact-preview-live.mjs` 新增 gated live smoke；2026-08-05 显式 `MILKSU_ARTIFACT_PREVIEW_LIVE_SMOKE=1 npm run test:artifact-preview-live` 使用真实 `build/bin/MilkSU.app` 进程从隔离 workspace 读取 `reports/summary.md`、`reports/result.html`、`images/screenshot.png`，并拒绝 `../outside.md`、伪装 PNG 和 SVG；报告保存到 `build/test-results/artifact-preview-live.json` | 不再把“打包 App 是否能读取三类 Coding 产物预览”作为未完成；原生 UI 手动打开由 `DONE-COD-02` 关闭，剩余缺口是 HTML WebView sandbox 的原生负向 |
| DONE-COD-02 | 真实打包 MilkSU UI 手动打开 Markdown、HTML 和图片产物预览 | 2026-08-05 用真实 `/Users/milksu/code/milksu/build/bin/MilkSU.app` 和隔离 `MILKSU_APPDATA_DIR=/tmp/milksu-artifact-ui-live.w7igPl/app-data` 启动 App；通过 Computer Use 点击 Coding → 选择项目目录，使用系统 `OpenDirectoryDialog` 的“前往文件夹”绑定 `/private/tmp/milksu-artifact-ui-live.w7igPl/workspace`；在右栏 `产物` 面板手动输入并预览 `reports/summary.md`、`reports/result.html` 和 `images/screenshot.png`；Markdown 显示标题 `MilkSU artifact preview live fixture` 和列表，HTML 在 `about:srcdoc` iframe 中显示标题 `MilkSU HTML artifact preview` 与正文，图片显示 `images/screenshot.png`；开发者验收详情显示 `用户可见验证：已预览 图片：images/screenshot.png` 和 `真实 App 验收：已打开产物预览：images/screenshot.png`；报告保存到 `build/test-results/artifact-ui-preview-live.json`，截图保存到 `build/test-results/artifact-ui-preview-live-markdown.png`、`artifact-ui-preview-live-html.png`、`artifact-ui-preview-live-image.png` 和 `artifact-ui-preview-live-loop-evidence.png` | 不再把“原生 UI 中能否由用户手动打开三类 Coding 产物预览并进入验收证据”作为未完成；HTML 无网络/CSP/sandbox 的原生负向仍归 `COD-11` |
| DONE-CVE-01 | App facade 与打包 App 的真实 NVD 单 CVE 下载、事实提取和原始快照持久化 | `app_vuln_live_test.go` 新增 `TestLiveAppFetchNVDCVEPersistsSnapshot`；默认跳过，显式 `MILKSU_LIVE_CVE_APP_SMOKE=1 go test . -run TestLiveAppFetchNVDCVEPersistsSnapshot -count=1 -v` 已真实访问 NVD `CVE-2024-3400`，验证 `retrievedAt`、App data 下 `vuln/feed-snapshots/nvd/*.json`、返回 body 与磁盘 body 一致、SHA-256 一致、文件权限 `0600`；2026-08-05 新增 `scripts/test-packaged-vuln-feed-live.mjs`，显式 `MILKSU_VULN_FEED_LIVE_SMOKE=1 npm run test:vuln-feed-live` 使用真实 `build/bin/MilkSU.app` 隔离进程拉取 NVD `CVE-2024-3400`，报告保存到 `build/test-results/vuln-feed-live.json`，snapshot 证据复制到 `build/test-results/vuln-feed-live-snapshot.json`，结果包含 `retrievedAt=2026-08-04T18:31:12Z`、`severity=CRITICAL`、`baseScore=10`、snapshot `sha256=ef863c16857bec109adf9b6006910468a94ea2791f4a4f51a218073712531b79`，且报告不包含原始 feed body | 不再把 “CVE 真实 NVD 下载、选中 CVE facts、来源时间和 App data snapshot” 视为未实现，也不要说 CVE 只有四条 mock；仍未证明完整 CVE 研究结果回写、Vulhub/Docker 启动/停止、GHSA/OSV/KEV 全源矩阵或真实资产验证 |
| DONE-CVE-02 | CVE 首页不再默认铺开情报源、导入和缓存维护台 | `VulnPage.vue` 默认只展示搜索、追踪列表、当前下一步、详情、练习/研究/资产/笔记闭环；Feed/NVD/EPSS/KEV/Vulhub 同步、导入和缓存证据集中到 `VulnerabilityIntelSettingsPanel.vue`；`VulnPage.test.ts` 覆盖默认首页不出现 `同步 NVD`、`同步 EPSS`、`导入 Feed`、`Feed 缓存状态`，点击统一设置后才出现这些维护项；2026-08-05 Browser 在 `http://127.0.0.1:1420/` 验证 CVE 首页无维护台、设置页包含同步/导入/缓存、关闭后回到列表与详情，Console 无 error/warn | 不再重复把“把 CVE 情报源/导入/缓存按钮塞进设置”作为未完成；后续只处理设置页内部密度、真实 Feed 源矩阵或练习环境生命周期 |
| DONE-CVE-03 | 打包 App 多源 CVE 情报与 Vulhub 练习目录匹配 | `app_vuln_feed_matrix_smoke.go` 和 `scripts/test-packaged-vuln-feed-matrix-live.mjs` 新增 gated live smoke；2026-08-05 显式 `MILKSU_VULN_FEED_MATRIX_LIVE_SMOKE=1 npm run test:vuln-feed-matrix-live` 使用真实 `build/bin/MilkSU.app` 隔离进程为 `CVE-2023-46604` 同步 NVD、FIRST EPSS、CISA KEV 和 Vulhub practice catalog，报告保存到 `build/test-results/vuln-feed-matrix-live.json`，四份 snapshot 证据复制到 `build/test-results/vuln-feed-matrix-live-nvd.json`、`build/test-results/vuln-feed-matrix-live-first-epss.json`、`build/test-results/vuln-feed-matrix-live-cisa-kev.json` 和 `build/test-results/vuln-feed-matrix-live-vulhub-practice-catalog.json`；结果包含 EPSS `0.996540000`、KEV 命中、Vulhub `activemq/CVE-2023-46604/docker-compose.yml`，且报告不包含原始 feed body 或 key 形态内容 | 不再把“CVE 是否能从多个真实源同步并匹配练习目录”作为未实现；仍未证明 Docker 生命周期、UI 内一键同步矩阵、GHSA/OSV、完整研究结果回写、资产验证或任何漏洞触发输入 |
| DONE-CVE-04 | CVE 设置页主入口能执行当前 CVE 四源同步矩阵并逐源留状态 | `VulnerabilityIntelSettingsPanel.vue` 的“同步当前 CVE”现在并发调用 NVD、FIRST EPSS、CISA KEV 和 Vulhub；同步后恢复用户原先选中的 CVE，逐源记录成功/失败，Vulhub 结果显示当前 CVE 是否匹配练习目录；`VulnPage.test.ts` 覆盖 NVD timeout 时 EPSS、KEV 和 Vulhub 仍成功留证据并显示 `3/4 个来源成功`、`当前 CVE 已匹配 pan-os/CVE-2024-3400`，且不出现 `Judge verified`；2026-08-05 Browser 在 `http://127.0.0.1:1420/` 验证 CVE 首页默认不显示 Feed 缓存台，打开设置后可见四源矩阵主按钮、单源重试按钮和缓存状态，Console 无 error/warn | 不再把“UI 内多源同步状态”作为未实现；真实打包 App UI/Wails 公网同步由 `DONE-CVE-05` 关闭，剩余仍是 Docker 生命周期、GHSA/OSV、完整研究结果回写或资产验证 |
| DONE-CVE-05 | 真实打包 MilkSU UI 点击 CVE 四源同步并落盘 snapshot | 2026-08-05 用真实 `/Users/milksu/code/milksu/build/bin/MilkSU.app` 和隔离 `MILKSU_APPDATA_DIR=/tmp/milksu-cve-ui-live.CjnNtr/app-data` 启动 App；通过 Computer Use 进入 CVE → 设置，点击 `同步当前 CVE 的 NVD、FIRST EPSS、CISA KEV 和 Vulhub`；UI 恢复后显示 `当前 CVE 情报矩阵同步完成：4/4 个来源成功`，当前 CVE `CVE-2024-3400` 的来源证据新增 NVD、FIRST EPSS、CISA KEV 原始快照，Vulhub catalog 显示 249 个候选且当前 CVE 未匹配；文件元数据确认隔离 app-data 下存在四份 snapshot：`vulhub-practice-catalog` 351156 bytes、`cisa-kev` 1574298 bytes、`first-epss` 202 bytes、`nvd` 14101 bytes；报告保存到 `build/test-results/vuln-ui-feed-matrix-live.json`，截图保存到 `build/test-results/vuln-ui-feed-matrix-live-after-sync.png` | 不再把“CVE 设置页真实点击四源同步是否会通过 Wails 访问公网并落盘来源时间/snapshot”作为未完成；剩余只看 Docker 启停/清理、GHSA/OSV、完整研究回写和资产验证 |
| DONE-CU-01 | 打包 Computer Use proxy 能在外部 App 精确窗口 Scope 内执行可见点击 | `scripts/test-packaged-computer-use-live.mjs` 新增 gated live smoke；2026-08-05 显式 `MILKSU_COMPUTER_USE_LIVE_SMOKE=1` 运行真实 `build/bin/MilkSU.app` sidecar node、`computer-use-proxy.cjs` 与 `cua-driver`，对 `com.apple.calculator` PID/window 完成 observe → click 1 → observe，报告保存到 `build/test-results/computer-use-live.json`，前后截图保存到 `build/test-results/computer-use-live-reset.png` 与 `build/test-results/computer-use-live-after.png`；after 截图显示 Calculator 显示区为 `1` | 不再把“packaged Computer Use proxy 是否能操作外部 App”当作未完成；UI 选择/启动和重启清理由 `DONE-CU-03`/`DONE-CU-04` 关闭，剩余只看主模型消费截图完成真实任务 |
| DONE-CU-02 | 打包 MilkSU App facade 能启动并停止外部 App 精确会话 | `app_coding_computer_use_smoke.go` 新增只在 `MILKSU_COMPUTER_USE_APP_SMOKE_RESULT` 存在时运行的 App 内部 smoke；`scripts/test-packaged-computer-use-app-live.mjs` 新增 gated live smoke；2026-08-05 显式 `MILKSU_COMPUTER_USE_APP_LIVE_SMOKE=1 npm run test:computer-use-app-live` 会自动打开 Calculator，并让真实 `build/bin/MilkSU.app` 进程完成 `ListCodingComputerUseTargets` → `StartCodingComputerUse` → `GetCodingComputerUseStatus` → descriptor socket 检查 → `StopCodingComputerUse`，报告保存到 `build/test-results/computer-use-app-live.json`，目标为 `com.apple.calculator` PID `85601` window `61879` | 不再把“Wails/App facade 是否能把用户选定外部 App 变成可用 Computer Use descriptor”作为未完成；UI 选择/启动和重启清理由 `DONE-CU-03`/`DONE-CU-04` 关闭，剩余只看主模型拿截图完成任务 |
| DONE-CU-03 | 真实 MilkSU UI 内选择 Calculator 并启动/停止可见会话 | 2026-08-05 重新打包当前 HEAD 的 `/Users/milksu/code/milksu/build/bin/MilkSU.app`，用隔离 `MILKSU_APPDATA_DIR=/tmp/milksu-cu-ui-live/app-data` 启动真实 App；通过 Computer Use 操作 MilkSU UI：CTF → Coding → 右栏 `浏览器与 App` → 目标下拉选择 `计算器 · 计算器` → 点击 `启动可见会话`；状态刷新后显示 `接入状态 已接入当前任务`、锁定 `com.apple.calculator · PID 85601 · Window 61879`，并可见 `停止可见会话`；随后从 UI 点击停止，状态回到 `可启动`。证据保存到 `build/test-results/computer-use-ui-live.json` 和 `build/test-results/computer-use-ui-live-after-start.png` | 不再把“MilkSU UI 内是否能选择/启动外部 App 可见会话”作为未完成；重启清理由 `DONE-CU-04` 关闭，剩余只看主模型消费截图完成真实 GUI 任务 |
| DONE-CU-04 | 打包 MilkSU 重启后不会幽灵恢复旧 Computer Use 会话 | 2026-08-05 用隔离 `MILKSU_APPDATA_DIR=/tmp/milksu-cu-restart-live.tiPNBu/app-data` 启动真实 `build/bin/MilkSU.app`，在 Coding → 浏览器与 App 中选择 `计算器 · 计算器` 并启动可见会话，before 文本包含 `接入状态 已接入当前任务`、`com.apple.calculator · PID 85601 · Window 61879` 和 `停止可见会话`；随后通过 Computer Use 直接操作外部 Calculator 完成 `2+3=5`，重启同一 App data 后回到 Coding → 浏览器与 App，任务 `计算器 可见会话` 仍保留，但详情页显示 `接入状态 可启动`，旧 Calculator PID/window 不再作为已接入 Scope；报告保存到 `build/test-results/computer-use-restart-live.json`，截图保存到 `build/test-results/computer-use-restart-live-calculator-operation.png` 和 `build/test-results/computer-use-restart-live-after-restart.png` | 不再把“Computer Use UI 启动后的 App 重启清理/权限一致性”作为未完成；剩余缺口是主模型在 MilkSU 任务内消费 Computer Use 截图并完成真实 GUI 小任务 |
| DONE-CTF-01 | CTF 工作台跨模块恢复浏览器烟测 | 2026-08-05 在 `http://127.0.0.1:1432/` 的真实渲染界面点击 CTF P382/gift_F12 工作台 → CVE → Coding → CTF，返回后仍显示 NSSCTF 列表、P382 详情、CTF rail 高亮，Console 无 error/warn | 不再把“CTF 一级菜单切回后空白/跳错模块”作为待修；剩余只登记打包原生 App + 运行中 Agent job 的继续验收 |
| DONE-OBELISK-01 | Obelisk 当前接入方向锁定为 MilkSU 内置核心能力 | `current-objectives.md` 与 `product-loop-sprint.md` 已把 Obelisk / Session Index 提为 P0；本批次实现从外部 `~/.obelisk` 只读探测改为 MilkSU 自己维护 `session-index/obelisk.sqlite`，且 `SessionHistoryPanel.test.ts` 锁住 UI 不显示“事实源/正式档案/历史线索”等边界说教文案 | 后续不得回退为“检测用户有没有安装 Obelisk CLI”或默认依赖 `~/.obelisk`；要扩展就继续内置索引器、导入器、用户确认转档案 |
| DONE-OBELISK-02 | 打包 App 中完成 Session Index 真实搜索 smoke | `scripts/test-local-delivery-baseline.mjs` 现在用隔离 HOME 预置本地会话，并通过 `MILKSU_SESSION_INDEX_SMOKE_*` 让真实 `build/bin/MilkSU.app` 在 App 进程内刷新并搜索 Session Index；2026-08-05 实跑通过，报告显示 `sessionIndexSmoke.resultCount=2`、`source=milksu-coding`、`toolCallCount=1`、`gates.sessionIndexPackagedSearch=true`，且脚本断言结果不泄漏 fixture secret | 不再把“原生 App 能创建 session-index 并搜索相关历史”作为未完成项；后续只推进用户确认转档案、跨历史导入和许可证/NOTICE 收口 |
| DONE-OBELISK-03 | 相关历史可由用户确认后写入 CVE 研究笔记 | `SessionHistoryPanel.vue` 新增可选确认动作，默认不出现；`VulnPage.vue` 只在 CVE 页面传入“记入笔记”，点击后把当前结果以“相关历史（用户确认）”追加进当前 CVE notes；`SessionHistoryPanel.test.ts` 和 `VulnPage.test.ts` 覆盖默认不自动沉淀、点击前 notes 不变、点击后写入、以及展示/写入均脱敏 Provider Credential | 不再把“相关历史 → CVE Note”作为未完成项；剩余是历史导入和许可证/NOTICE/ADR |
| DONE-OBELISK-04 | 相关历史可由用户确认后引用到 Coding 输入草稿 | `ChatComposer.vue` 暴露 `appendDraftText`；`ChatPage.vue` 在非 CTF Chat 的相关历史结果上显示“引用到输入”，点击后把脱敏会话、来源、时间、工具和摘要追加到输入框草稿，并提示“已引用到输入框”，不会直接 `emit('send')`；`ChatComposer.test.ts` 与 `ChatPageRoutingContract.test.ts` 覆盖追加草稿、未自动发送和脱敏路径 | 不再把“Coding 页面能手动引用相关历史到本轮任务输入”作为未完成项；完整 Agent 消费这段上下文并完成修改，归入 Coding 自举闭环验收 |
| DONE-OBELISK-05 | 相关历史可由用户确认后引用到 CTF 复盘草稿 | `CTFPage.vue` 在 CTF 复盘侧栏传入“引用到复盘”，点击后把脱敏会话、来源、时间、工具和摘要传给 `CTFDebrief` 的 `reflectionSeed`；`CTFDebrief.vue` 只在需要复盘时追加到复盘 Textarea，不调用 `saveMemory`；`CTFDebrief.test.ts` 和 `CTFPageNavigationContract.test.ts` 覆盖草稿追加、保存复盘才产生 reflection、未自动保存 Memory 和脱敏路径 | 不再把“相关历史 → CTF 复盘草稿”作为未完成项；真正 Memory 保存仍要求题目结束、用户复盘和原 `save_ctf_training_memory` 链路 |
| DONE-OBELISK-06 | 打包 MilkSU Agent 实际消费用户确认的相关历史 | 2026-08-05 用隔离 App data 启动真实 `build/bin/MilkSU.app`，在 Coding 右栏搜索 `ArtifactPreviewQuotedSmoke`，点击“引用到输入”后发送；Agent 后续回复明确引用历史会话 `History UI source for artifact preview` 与搜索 token，并运行工具核对源码/证据；会话 JSON 报告确认引用进入用户 prompt、Agent 消费历史、fixture credential 原文未落盘，证据保存到 `build/test-results/session-history-agent-consumption-live.json` 与 `build/test-results/session-history-agent-consumption-live.png` | 不再把“Agent 能不能读到用户确认引用的相关历史”作为未完成项；剩余是用这条能力完成一次真实修改、测试、预览、commit/push 的完整自举交付 |
| DONE-OBELISK-07 | 相关历史脱敏显示对已脱敏文本和旧污染文本幂等 | `app/src/lib/redaction.ts` 与 `internal/sessionindex/sessionindex.go` 现在会在脱敏前后收敛 `[credential redacted] redacted]` 以及 query 后缀污染；`redaction.test.ts` 与 `sessionindex_test.go` 覆盖已脱敏值二次通过和历史污染样本；真实打包 App 报告 `build/test-results/session-history-redaction-idempotent-live.json` 验证相关历史卡片与引用输入均保留单个 `[credential redacted]` 且无重复尾巴 | 不再重复修 OBS-21；下一步仍是完整 Coding 自举交付或跨历史导入 |
| DONE-OBELISK-08 | 显式 JSONL 外部历史导入接入 Session Index | `internal/sessionindex/import.go` 新增外部 JSONL 导入器，按显式文件路径导入 `codex / claude / kimi / pi` 来源到 `external:<source>:...` session，支持常见 message/content/tool_use 字段、幂等重导入、工具调用摘要、统一脱敏和 App data 下索引；`ImportExternalSessionHistory` 与 `import_external_session_history` 已接入 App/Wails/desktop bridge；`TestImportExternalJSONLIndexesToolHistoryAndRedactsSecrets`、`TestAppImportsExternalSessionHistoryFromExplicitPath`、`desktop.test.ts` 和真实打包 App `MILKSU_SESSION_HISTORY_IMPORT_LIVE_SMOKE=1 npm run test:session-history-import-live` 通过，报告 `build/test-results/session-history-import-live.json` | 不再把“显式 JSONL 外部历史导入能力”当作未完成；剩余是用户真实历史目录选择、Claude/Kimi/Pi 扩样和许可证/NOTICE/ADR |

## 共同评估后的执行入口

用户第一轮评估已经写入 `current-objectives.md`，并于 2026-08-03 明确恢复产品开发；随后又
确认切到产品闭环冲刺。短期先按 `product-loop-sprint.md` 跑通 UI/UX + Coding 产品闭环；
回到全量目标时再按优先级分层覆盖，不按旧候选批次恢复，也不因单个非阻塞问题切回深度优先。

### 评估口径

候选批次只用以下四个维度，不把“能快速涨几个点”当成单独选择理由：

| 维度 | 判定 |
| --- | --- |
| 产品价值 | 是否直接提高自举、CTF 核心闭环、Memory 可信度或正式交付 |
| 实施风险 | 是否触碰权限、网络、巨型文件、持久化结构或外部副作用 |
| 启动依赖 | 主 Agent 能否独立开始，还是需要用户、Provider、系统权限或外部 Judge |
| 验收成本 | 能否用当前正式 Runtime 得到代码、自动化和真实证据 |

### 用户确认后的优先级映射

| 层级 | 台账范围 | 当前处理 |
| --- | --- | --- |
| P0 · 自主工作 | `COD-01`–`COD-05`、`COD-07`、`COD-08`、`COD-10`、`COD-15`、`COD-16`、`COD-17`–`COD-25`、`COD-31`、`RUN-03`、`RUN-08` | 先补尚未形成最小纵切的必要能力；重点是长任务、构建测试、恢复、Computer Use 实用范围和交付，不补完整审批矩阵 |
| P1 · 成熟能力 | `COD-12`–`COD-14`、`COD-26`–`COD-30` | 优先复用成熟组件；每项至少一个真实任务 |
| P1 · CTF 验收 | `CTF-01`–`CTF-15` | 六赛道可由独立 subagent 执行；发现问题只登记，主 Agent 汇总 |
| P2 · Memory 体验 | `MEM-06`、`MEM-08`、`MEM-10` | 先做可理解、可追溯和删除一致性 |
| 保持回归 | 其余已实现的 Memory、Runtime、数据安全与交付基线 | 不为提高分数重复开发 |
| 持续约束 | `ARC-01`–`ARC-06`、`DOC-01` | 不开独立清债冲刺，不增加新职责，只保留必要证据 |
| 后期 | `COD-06` 完整矩阵、`MEM-11`、`RUN-10`、`DEL-02`、`DEL-09`–`DEL-14`、`DOC-02` | NYU、完整校准、pre-release/RC 和最终文档阶段再做 |

此前的“候选广度批次 A”已被本映射取代，不再具有候选或执行意义。每个最小纵切开始前仍需
写清：

1. 允许修改的范围；
2. 不允许顺带修复的相邻问题；
3. 自动化 Gate；
4. 真实验收动作和证据位置；
5. 遇到新问题时登记的新 ID；
6. 每批最多同时处于修复状态的项目数。
