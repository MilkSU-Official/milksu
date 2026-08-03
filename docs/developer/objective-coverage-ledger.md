# 当前目标覆盖台账

> 状态：Active / Product-loop sprint with coverage ledger
>
> 产品代码快照：2026-08-04，`86ee5d9`
>
> 最近证据复核：2026-08-04，`86ee5d9`
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
| Coding Agent 与高频替代能力 | 31 | 1,525 / 3,100 | **49%** |
| CTF 通用闭环与网络边界 | 15 | 550 / 1,500 | **37%** |
| Memory 与能力画像 | 11 | 500 / 1,100 | **45%** |
| Runtime Reliability 与 NYU Bench | 10 | 700 / 1,000 | **70%** |
| 架构约束 | 6 | 125 / 600 | **21%** |
| 本地数据安全与正式交付 | 15 | 600 / 1,500 | **40%** |
| 最终文档 | 2 | 75 / 200 | **38%** |
| **整体** | **90** | **4,075 / 9,000** | **45%** |

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
50%。后续只使用同一张表比较变化。

### 分值分布

| 分值 | 细项数 | 解释 |
| ---: | ---: | --- |
| 100% | 8 | 行定义的精确门槛已经通过 |
| 75% | 19 | 已有真实证据，仍缺完整矩阵或最终 Gate |
| 50% | 33 | 工程实现和自动化存在，仍缺真实任务 |
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
| COD-10 | Markdown、HTML、图片产物预览 | Go/Vue 实现与安全测试存在；前端建议列表只展示工作区相对路径内的 Markdown、HTML 与图片产物，不再建议绝对路径或 `..` 逃逸形态；`CodingArtifactPreviewPanel.test.ts` 覆盖用户可见的 Markdown/HTML/图片建议入口、三种产物渲染、手输不安全或不支持路径会在前端拦截且不调用后端、Markdown/HTML 产物内容以及建议/标题/图片 alt 在渲染层脱敏 Provider Credential 形态、失败后清空旧预览；`desktop.test.ts` 锁住桌面 adapter 会把 `workspacePath` 与 `relativePath` 原样传给 Wails `GetCodingArtifactPreview` | 50% | 打包 App 三种产物真实预览 |
| COD-11 | HTML 隔离、CSP、禁网、路径与大小限制 | `artifact_preview_test.go` 等自动化；`codingArtifact.test.ts` 覆盖外部资源剥离、CSP 和不安全建议路径过滤；`CodingArtifactPreviewPanel.test.ts` 覆盖 HTML 预览使用空 sandbox iframe、注入 `default-src 'none'` CSP，手输逃逸路径不会进入预览后端，并向用户显示无脚本/无网络说明 | 50% | 原生 WebView 负向验收 |
| COD-12 | 隔离 Browser 自动化与证据边界 | Browser integration 与 41 项窄测试通过 | 100% | — |
| COD-13 | MilkSU 项目前端视觉 QA 真实纵切 | `frontend-visual-qa-acceptance.md` | 100% | — |
| COD-14 | 用户授权的其他项目前端视觉 QA | 尚无项目与任务证据 | 0% | 用户提供一个授权前端项目 |
| COD-15 | Computer Use 选择当前可见 App / 窗口并生成不可变 Scope | Go Host 枚举可见窗口，前端选择，动态 session policy，descriptor/proxy 锁定 bundle、PID、window；能力摘要已显示真实 App、bundle、PID 和 window，不再写死 MilkSU 自身；Bridge descriptor 拒绝带换行或控制字符的 App 名称，避免污染不可变 Scope 提示；`codingPolicy.test.ts` 覆盖 UI 启动参数只来自用户选定的 PID/window pair，不因同名 App、同 PID 多窗口或同 windowId 不同 PID 漂移，覆盖 ChatPage 刷新可见窗口列表时优先保持当前选择、否则回到已启用会话精确目标、最后才退到第一个窗口，并锁住 Plan/read-only 即使已有目标也不能展示为可操作；`CodingComputerUsePanel.test.ts` 覆盖右侧栏展示外部 App 的 bundle/PID/window、未接入原因、重新检测、权限就绪后才启动、其他任务占用禁用和正式接入说明；`1698e39` 在 Coding 产品闭环卡增加“Computer Use 快速接入”，Browser preview 验证点击后会打开“浏览器与 App”面板并显示 Computer Use 接入清单；Go、Node、前端构建通过 | 50% | 打包 App 中完成真实外部 App 权限与窗口操作验收 |
| COD-16 | Computer Use 一次性系统权限真实验收 | Accessibility 与 Screen Recording 未授权；UI 已说明 App 管理不能替代辅助功能/屏幕录制，提供请求系统权限和重新检测入口；`1698e39` 增加从产品闭环卡直达权限/可见窗口接入面板的用户路径 | 0% | 用户在 macOS 完成授权并启动真实外部窗口会话 |
| COD-17 | Pi 持久会话、Compaction 与连续性 | fixture、事件投影和既有真实任务；`codingContinuity.test.ts` 覆盖任务删除时同步清理 ready/resumed、compacting、compactedAt 和 compaction errors，避免删除后的幽灵恢复/压缩状态；`codingContinuityPresentation.test.ts` 覆盖待连接、恢复、新会话、整理中和已整理状态的用户可见徽章、说明和整理按钮禁用原因 | 75% | 完整 App 重启长上下文验收 |
| COD-18 | 重启后后台任务、PID、端口、日志和长任务恢复 | Sidecar fixture 与部分打包任务存在；`CodingTerminalPanel.test.ts` 覆盖恢复后的用户可见状态，展示 recovered 提示、PID、端口和日志 tail；`bridge-background-view.test.js` 覆盖恢复投影把持久记录里的 `spawnPid` 映射为用户可见 PID，避免重启后进程号丢失；`desktop.test.ts` 锁住刷新、启动和停止后台任务时 conversation、workspace、命令、名称、executionMode 与 approvalPolicy 传给 Wails 的正式入口 | 50% | 跨 App 重启的真实长任务 |
| COD-19 | 旧 PTY 明确结束且审批跨重启过期 | 自动化测试存在；`bridge-approval.test.js` 覆盖 App/Sidecar 审批通道关闭时多个会话的 pending approval 全部以拒绝过期，旧 requestId 不能在重启后继续批准；`manager_test.go` 覆盖 Manager 关闭会让运行中的旧 PTY 发出 stopped 事件，且关闭后的 Manager 不能再启动看似可重连的新 PTY；`CodingTerminalPanel.test.ts` 覆盖空 Shell 列表时 UI 明确提示交互式 Shell 不跨 App 重启恢复、旧 PTY 已结束且不可重连，并引导后台长任务在“后台任务”恢复；`agentRecovery.test.ts` 覆盖 Coding/CTF 继续提示会明确禁止复用重启前审批状态，并要求扩大权限、Endpoint、应用窗口或外部发布时重新做有意义确认 | 50% | 原生 App 真实重启负向验收 |
| COD-20 | Diff、Hunk、stage、commit、push 日常闭环 | 代码、测试和历史真实验收完成 | 100% | — |
| COD-21 | PR 预览、一次性确认和私有远端限制 | `pull_request_test.go` 覆盖一次性 token、过期、状态变化、私有 MilkSU 远端、窄 `gh pr create` 和读回验证；`CodingChangesPanel.test.ts` 覆盖 UI 先展示仓库/分支/提交/目标，再单独发布，不把内部 confirmation token 显示给用户，后端拒绝过期预览或错误文本回显 token 后清空旧确认并脱敏 token，异常 preview 若指向非 MilkSU 私有仓库则不会进入确认态或调用发布，并在重新准备 PR 时清掉上一轮成功结果，避免旧外部写入状态与新预览混淆；`desktop.test.ts` 覆盖 Wails adapter 会把 workspace、confirmation token、title 和 body 原样传给发布命令，省略标题/正文时只传空字符串而不是 `undefined` | 50% | 真实托管平台 Draft PR |
| COD-22 | 经确认发布 MilkSU 私有 Draft PR | 尚无本轮真实发布回执 | 0% | 在最终自举 Gate 中执行 |
| COD-23 | 多 Agent 独立 worktree、恢复和安全收尾 | Manager 与 Bridge 自动化存在；`bridge-collaboration.test.js` 覆盖并行和串行写入 Agent 都必须使用不同注册 writer worktree，Go Manager 覆盖恢复、集成后清理、脏 worktree/submodule 拒绝和中断准备安全收尾；`CodingCollaborationPanel.test.ts` 覆盖显式 2 writer 准备、集成后安全结束和中断准备后的有界清理；`desktop.test.ts` 覆盖 Wails adapter 会把 conversation、workspace 和 writer 数原样传给准备命令，省略 writer 数时默认为 1 | 50% | 真实有价值的协作任务 |
| COD-24 | 多 Agent 在真实任务中证明并行有用 | 尚无成功率与成本证据 | 0% | 选择自然可并行的任务验收 |
| COD-25 | 完整 “MilkSU develops MilkSU” Gate | 有多个局部自举任务；产品闭环冲刺期间已补 TopBar 一致性、CVE→Coding handoff、Computer Use 快速接入、CTF/CVE 路由保留契约、产品闭环卡生成恢复点入口、用户验收清单、合并状态投影、清单行内操作入口、待补任务 prompt 和多轮前端 test/build/Browser preview 证据；`86ee5d9` 通过完整 `npm run m3:release-check` 并重新生成本机 `MilkSU.app` | 25% | 一次完整 Vue + Go、重启、交付、PR |
| COD-26 | ImageGen 文生图、参考图编辑和项目资产 | 受控工具、UI、测试与打包存在；ImageGen 审批详情只保留允许字段，并会脱敏 `Bearer` / `sk-*` 形态，防止模型把 `apiKey` 或 `Authorization` 等额外字段塞进用户审批卡 | 50% | 真实 Provider 生成 |
| COD-27 | 打包 App 真实 ImageGen Provider 与预览 | Provider 尚未在 App 内配置 | 0% | 用户自行配置后执行，不接触 Key |
| COD-28 | Project MCP 来源、版本、工具面与权限审阅 | Go/Vue/Bridge 实现和测试存在；`npm run test:project-mcp` 通过正式 `loadCodingMcpConfig`、固定 `.mcp.json` digest、sandbox wrapper、`env -i` 私有 HOME/TMPDIR、`hostConfigDiscovery=off`、MCP SDK `listTools/callTool` 实际调用本地项目 `fixture_read`，并输出 `workspaceAutoApprovalRequired=false` 作为自动审批契约证据 | 75% | 用户真实项目或高频 MCP 任务验收 |
| COD-29 | 高频 Plugin 候选完成真实任务 | 尚未由使用频率选出候选 | 0% | 先收集重复工作流与替代失败 |
| COD-30 | 代表任务成功率、接管、恢复、成本对照 | Coding delivery gate 已输出 `milksu-run-manifest/v1alpha1` 与 `milksu-agent-scoreboard/v1alpha1`，覆盖任务 ID、fixture digest、工具面、预算、人工介入、失败分类和未运行基线状态；共享 validator 已拒绝 `not-run` baseline 携带成绩、缺失败/介入证据、预算超限、隐私边界松动和 `passed=true` 但非满分等误报形态 | 25% | 从用户真实历史选择固定 20 项，运行 MilkSU 与裸 Codex/Pi 对照 |
| COD-31 | Computer Use 工具截图接入纯文本模型的辅助视觉回路 | Bridge `tool_result` hook 为 `milksu-computer-use/computer_use` 截图追加受控视觉摘要；辅助视觉缓存不保存原图；64 项 Node 窄测试、Go、前端 lint/build 通过 | 50% | 打包 App 中用纯文本主模型和真实辅助视觉完成外部窗口定位验收 |

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
| CTF-12 | 六题固定回归清单 | `ctf-six-track-regression-manifest.json` 固定六个赛道 slot、统一 requiredEvidence、跨赛道 Tool Builder/Strategist 协作项和 Web/P3879 既有 `correct=true` 证据引用；`npm run test:ctf-six-track-regression` 校验六轴顺序、缺失赛道不得伪造 `correct=true`、已验证赛道必须有权威 Judge 与完整证据 refs | 50% | 选定其余五赛道真实题目，补平台、题号、材料类型、验收日期和 Judge 回执 |
| CTF-13 | Solver 卡关 → Coding Tool Builder → Solver | Tool Workshop 代码与测试存在 | 25% | 真实自然卡关闭环 |
| CTF-14 | 重复失败 → 独立 Strategist → Solver | 角色与恢复基础存在 | 25% | 真实独立会话重规划闭环 |
| CTF-15 | Evidence、候选、Judge、Checkpoint、恢复和复盘主链 | 主链代码、测试及一题真实记录；`CTFSubmissionGate.test.ts` 覆盖 Agent 候选说明、格式 warning、Judge 回执 summary 和外部 Judge label 在提交/Judge UI 层脱敏 Provider Credential 形态，同时提交按钮行为不变 | 75% | 在其余五赛道重复验证 |

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
| DOC-01 | 开发期只保留测试、回执、验收记录和 ADR | 当前验收文档遵守此规则；`product-loop-sprint-acceptance.md` 已记录 `d4df0f8`、`42c392d`、`1698e39`、`eefa729`、`d23f7ff`、`18b50f0`、`b15782f`、`bbcbdc1`、`3a57d98`、`0393f85`、`c1af6d0`、`b61749e`、`498a515` 和 `86ee5d9` 的窄测、全量前端、Browser preview、M3 release check 与未证明范围 | 75% | 持续保持，不提前写完成声明 |
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
| OBS-13 | macOS “App 管理”权限不等于 Computer Use 所需 Accessibility；截图可用也不代表 AX 可用；`CodingComputerUsePanel.test.ts` 已覆盖缺辅助功能/屏幕录制时启动禁用、可请求系统权限，并在 Computer Use 不可用时禁用请求按钮 | `COD-16` 仍需单独真实验收 Accessibility 与 Screen Recording |
| OBS-14 | `ChatPage.vue` 的 Computer Use UI 已抽为 `CodingComputerUsePanel.vue`，并有面板级测试覆盖外部 App/window 展示、启动按钮和其他任务占用禁用；`desktop.test.ts` 已锁住 `start_coding_computer_use` 会把用户选定的 `conversationId`、`targetPid`、`targetWindowId` 原样传给 Wails；ChatPage 刷新可见窗口列表的选择逻辑已抽为 `nextComputerUseTargetKey` 并测试，不因同名 App、同 PID 多窗口或同 windowId 不同 PID 漂移；仍缺整页 ChatPage 时序和打包 App 外部窗口真实验收 | 后续若建立 ChatPage 测试基架或做打包 App 外部窗口验收时补，不在当前批次深挖 |
| OBS-15 | `workspace-auto` 对未知或项目 MCP 目前只自动放行 read-like 工具；对经过用户审阅并固定 Scope 的本地 Project MCP 写工具仍可能产生重复审批 | 先不现场放宽，避免没有工具面/Scope 证据时扩大权限；等真实高频 Project MCP 候选确定后，为已审阅本地工具增加更精确的自动审批契约 |
| OBS-16 | 与裸 Pi Agent 相比，MilkSU 过去过早把大量精力投入权限、恢复、脱敏和文档边界，导致“能像裸 Harness 一样顺滑干活”的主链体感滞后 | 下一阶段优先真实可用闭环：Computer Use、Browser、Project MCP、Artifact Preview、ImageGen 和小型 MilkSU develops MilkSU；除 Key、Scope、私有远端、Judge/能力归因硬红线外，非阻塞细节先登记后修 |
| OBS-17 | 当前用户明确要求产品 UI/UX 上有完整闭环；CVE 作为一级菜单不能只停在暂停文档，至少要有学习/追踪工作台骨架、状态、安全边界和后续 Coding Agent 可接手任务；Lab 暂不实现 | 见 `product-loop-sprint.md`；MilkSU 已有 CTF 模块，当前冲刺不新接 CTFd；CVE 只做学习/追踪，不做红队 Agent、批量打靶或自动 PoC；`b15782f` 已让 CVE 列表直接展示研究任务、练习、接力和笔记闭环状态，减少用户必须点进详情才知道在研究什么的问题；`498a515` 补 CVE 待补任务 prompt，便于后续 Agent 只接未完成学习/追踪项；Lab 后置为 HTB/TryHackMe/pwn.college 等外部靶场辅助与进度追踪计划 |

## 暂存缺陷

开发和真实验收新发现的非阻塞缺陷追加在这里，至少记录复现条件、影响范围、证据位置和建议
处理层。没有可复现证据时先记为 `OBS-*`，确认是产品缺陷后分配 `BUG-*`。

| ID | 问题 | 复现与证据 | 影响 | 计划处理层 |
| --- | --- | --- | --- | --- |
| BUG-01 | GUI 任务在 Computer Use 未接入时没有停下并引导启用能力，而是用 Full Access Shell 研究目标 App 的截图、数据目录和内部 IPC | 2026-08-03 MilkSU 临时沙盒对话“找到那个 codex 那个 App…”；环境面板显示 `Computer Use：未接入`，轨迹随后尝试 Accessibility、截图、`goals_1.sqlite` 和 Electron IPC，外部调用最终为 `no-client-found`；2026-08-03 已接入 Coding policy guidance，未启用时要求停下并提示开启可见 Computer Use，会明确禁止 bash、截图目录、SQLite、Electron IPC、私有协议和网络逆向作为 UI 控制替代；启用时提示不可变 app/window Scope；2026-08-03 修复前端能力摘要仍写“当前 MilkSU App”的旧文案，改为展示真实 target name、bundle、PID 和 window，并用 `codingPolicy.test.ts` 锁住；2026-08-03 前端能力预览与 Bridge 会话策略均补充“不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过可见会话 Scope”，并由 `codingPolicy.test.ts` 与 `bridge-policy.test.js` 锁住 | 浪费长时间上下文，绕开产品设计的可见应用 Scope，也让用户误以为 Computer Use 不可用 | 路由护栏与误导文案修复已落地；后续在打包 App 中做真实外部 App 操作验收，确认模型不再绕用 Shell/IPC |
| BUG-02 | `m3:release-check` 在进入实际检查前要求 `internal/computercap/session-policy.yaml` 被 Git 跟踪，但当前文件不存在且未被跟踪 | 2026-08-04 执行 `npm run m3:release-check`，脚本输出 `Required Computer Use source is not tracked by Git: internal/computercap/session-policy.yaml`；随后补入 `internal/computercap/session-policy.yaml` 作为打包 Cua Driver smoke policy，运行时仍由 `internal/computercap/manager.go` 按用户选择的 App 动态生成 per-session policy；同批次补齐 `package-sidecar.mjs` smoke fixture 的 `targetWindowId`；重新执行完整 `npm run m3:release-check` 通过并输出 `M3 engineering release checks passed.` | 合并前总检查门禁已恢复 | 已关闭；后续只在新的 `m3:release-check` 失败时重新登记 |
| BUG-03 | 从 CTF/CVE 回到 Coding 时，在没有 remembered Coding 会话的情况下可能恢复到会话数组里的第一个非 CTF 对话，而不是最近一次 Coding 对话 | 2026-08-04 用户反馈“从 CTF 切换到 CVE 后，再回去显示最顶部的对话，而不是最底部/最近的”；代码证据为 `selectCodingConversationId()` 回退分支使用 `conversations.find(nonCTF)`，依赖数组顺序；本批次已改为按 `createdAt` 选择最近非 CTF，并给 unordered conversations 增加 `workspaceSessionRouting.test.ts` 回归；`eefa729` 进一步锁住 CTF/CVE 页面 KeepAlive、Chat 不被误缓存和 CTF resume point 合约 | 模块切换打断用户的任务连续性，容易误以为解题或 Coding 会话丢失 | 自动化已修复；后续打包 App 中做真实模块切换验收 |
| OBS-18 | CTF Agent 对话、CTF 工作台和 CVE 页面之间的返回语义仍需产品决策：点击 CTF 是回最近题目工作台、直接回 Solver 对话，还是提供二者入口 | 2026-08-04 用户反馈“CTF 进入解题会话后返回题库/切换 CVE 体验怪”；当前已有 `CTFWorkspaceHeader` 的“返回题库”和 `selectCTFResumePoint()` 恢复最近 job，但模块级 rail 仍只表达一级模块，不表达“回 Agent 对话 / 回工作台”二选一；本批次先把 CTF Agent 对话顶栏从 `Coding` 改为 `CTF`，并在同一 TopBar 动作区增加“返回工作台”入口，避免 CTF 会话看起来属于 Coding 模块；`eefa729` 用 App routing 契约锁住 CTF/Vuln KeepAlive 和 CTF resume point，避免一级菜单切换时直接丢工作台状态；2026-08-04 又把 CTF workspace 顶部“返回题库”、正文“题库”、预算停止“返回题库”和空工作区“选择一道题”全部改为强返回列表路径，清理 NSSCTF/CTFshow 已选题并补 `CTFPageNavigationContract.test.ts`，避免退到半截题目详情页 | 已修“返回题库不像返回”的最小体验问题；仍需决定模块级 rail 是否同时暴露“最近 Agent 对话 / 当前工作区 / 题库列表” | 最小体验修正已落地并有前端 test/build；后续打包 App 做真实模块切换验收，再决定是否加模块内恢复条 |

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
