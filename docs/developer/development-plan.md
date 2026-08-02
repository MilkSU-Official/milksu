# 开发计划：CTF / Coding 收口，Labs / CVE 设计待解冻

> 状态：当前实现主线
>
> 日期：2026-08-01

## 产品主线

MilkSU 现在以**一站式网络安全 AI 学习客户端**开源。CTF、Vulnerability Research、未来的 Red/Blue 都是人与安全 Agent 在明确授权环境中共同学习的 Workspace；Domain Outcome 与 Human Outcome 同时成立，才算完成产品目标。

这不是只换名称。默认开源产品不发展任意目标清单、互联网网段批量扫描、凭据喷洒、隐蔽规避或无人审批的外部攻击流水线。外部网站、Socket、SSH 或浏览器目标必须来自用户显式接入并保存范围与 provenance；高风险动作按 Effect 分类、限速和审批。发布边界见 [ADR-0004](/developer/adr/0004-learning-product-and-release-boundary)。

## 起步策略

MilkSU 不在“先造完整基础架构”和“先做一次性 Demo”之间二选一。我们采用**最小纵向骨架**：只实现足够支撑一个真实任务的公共契约，然后立即让真实模型、真实工具、真实环境和独立 Evaluator 连成闭环。

历史上的第一条纵切是 CTF，第二条是 Vulnerability Research（下文简称 Vuln），它们帮助冻结了 Runtime 的事实、证据、Evaluator 和恢复边界。当前实现优先级已经调整为 CTF 真实闭环、Coding 日常交付、内部 Eval 与产品底座；Vuln/CVE 和 Labs 保留设计，但不再阻塞 R0.4。

MilkSU Security Harness 是默认运行方式，但“自己的 Harness”不等于从模型 API 开始重写通用 Agent Loop。我们会先评估 Pi SDK、Codex CLI 开源核心等成熟 Coding Agent Engine，尽量复用它们的模型接入、上下文压缩、会话、通用 Tool Loop 与流式事件，再在其上改造出由 MilkSU 掌握的安全任务状态、实验、证据、评测和人机协作。

直接运行用户已有的 Codex/Claude Code CLI 是另一种 External Agent Runtime；它与“把开源 Agent Engine 嵌入并改造成 MilkSU Harness”不是同一件事。

## 当前 R0.4 的边界

当前可演示版本只承诺：

- macOS 单用户桌面客户端；
- macOS 桌面控制面采用 Go + Wails v2 + Vue 3/TypeScript；界面组件复用 Memoh 主仓库锁定的 `memohai/ui`，Agent Engine 可以保留其原生语言，通过明确的进程内或本地协议边界接入；
- SQLite 事件与状态存储，文件系统保存 Artifact；
- 固定版本 Pi Coding Agent、可替换 Model Provider 和 MilkSU Security Harness；
- CTF 单题私有工作区与受控本机执行；它不是容器或 VM；
- NSSCTF/CTFshow 题库、自定义题目 Intake、显式候选与独立平台/本地 Judge；
- Coding 的项目选择、持久会话、Plan/Go、Codex 风格三档权限、Project Auto 项目沙箱、
  显式 Full Access、停止与真实交付回归；
- 开发者专用 NYU safe-static 单次推理与 Digest Judge；
- Coach、Copilot、Delegate 三种协作方式的最小闭环；
- 任务退出后可以恢复，事实不只存在于聊天上下文。

R0.4 不发布 Managed Labs、真实 CVE 目标接入、Web 产品、GraphQL、PostgreSQL、微服务、多用户、Red/Blue/AppSec/Malware Role 或通用工作流编辑器，也不把用户安装的 Codex/Claude Code CLI 作为默认运行方式。Labs 和 CVE 的长期设计不等于当前能力承诺。

## 当前发布检查点：CTF-first M3 MVP

本文后面的 `M0—M7` 是长期**能力里程碑**。当前桌面版本所说的 `M3 MVP` 是一次**产品发布检查点**，两者不要混用：产品已经先行吸收了部分 M3/M7 的界面与打包能力，但这不代表长期能力里程碑已经按完成标志验收。

### 2026-08-01 优先级重排

当前迭代冻结 Managed Labs 与 CVE 扩展，不继续推进 Juice Shop、WebGoat、Vulhub、HTB/THM
自动化或新的漏洞研究执行能力。工作区中已经存在的 Lab 实验代码不能写入当前发布声明。

新的交付顺序是：

1. **NYU CTF Bench + Coding Agent first**：先建立最小开发者 Eval；用
   [Coding Agent 真实交付验收](coding-agent-delivery-acceptance.md)证明连续短提示、附件、
   编辑、命令、测试、修错、恢复、审批和最终交付，而不只证明工具已注册。
2. **CTF**：保持现有 NSSCTF Intake → PI → Candidate → Judge → Debrief 主链不回归；
   只修阻断真实使用的问题，不扩新的平台或 Lab。
3. **Memory**：使用真实 CTF/Coding 轨迹校准召回、脱敏和用户确认，不提前增加向量数据库。
4. **Foundation**：统一 UI/Markdown、权限可见性、发布回归和本地数据迁移。
5. **Architecture**：按当前架构快照逐步拆分职责集中点，保持 Wails、Pi 和 Runtime 公开契约。

Labs 与 CVE 何时解冻，必须由新的用户目标、授权边界和独立验收决定；它们不再阻塞当前
R0.4 的冻结、提交与演示。

2026-08-01 回归结果：

| 产品面 | 状态 | 已有事实 | 距离可用 MVP 的缺口 |
| --- | --- | --- | --- |
| 用户信息架构 | 已完成 | 一级入口收敛为 `CTF / CVE / Coding`；`任务运行时`、通用 Walking Skeleton Wails 接口和里程碑标签已从用户产品面删除 | Labs 未来位于 CTF 二级导航，但当前不展示为可用入口 |
| PI Coding Agent | 已完成工程与真实模型验收 | 用户选择项目后可使用 `read / bash / edit / write / grep / find / ls`；工具输入与结果可见；会话可恢复、可停止；CTF 题可一键进入固定 PI 工作区；设置页保存凭据后会发起一次有界 PI 模型预检，直接报告模型选择、凭据或网络错误；2026-07-31 已用用户 SQLite 凭据对 `deepseek/deepseek-v4-flash` 完成真实响应验证 | CTF Shell 仍是本机子进程，不是容器沙箱 |
| Coding 日常工作流 | 已完成窄真实闭环 | 输入框上方仅保留 Plan/Go、权限和模型；项目、能力、架构图、变更、终端和浏览器集中在右侧。原生 App 已连续完成理解、修改、测试、修复和总结；本地远端已验 stage、commit、push；右侧终端同时提供按 Conversation 隔离的交互式项目 PTY，以及可显示 PID/端口/有界日志并停止的后台任务；右侧浏览器页已通过固定 Playwright MCP 完成隔离 Chrome 的启动、页面读取、填写、点击和结果回读 | 仍缺逐块/行级审阅、托管平台 PR、跨应用重启终端恢复、Computer Use、多 Agent 和更大项目样本 |
| CTF 产品入口 | 已完成工程接线 | 默认直接进入列表式 Challenge Desk：NSSCTF/CTFshow 使用正常分页题库，自定义模式独立导入本地题面与材料；训练历史使用按题目分组的下拉；“添加本地材料”只复制到本题私有工作区，不上传平台；NSSCTF 完整本地 SQLite 目录按题号、题名、标签、题型在后端分页；Arena、已登录页面 Judge/附件 Bridge 和训练平台注册表均已接线；清洁用户目录原生回归已同步 4,204 道 NSSCTF 题并选中第一题 | NSSCTF 公开列表没有稳定赛事字段；Labs 是未来 CTF 二级入口而不是平台来源，当前暂停；HTB/THM 自动化不在范围内 |
| CTF 解题 Harness | 真实 Judge 与恢复链路已验收 | 单题 `challenge.json / AGENTS.md / TASK.md / materials / work / evidence`、精确授权目标与材料清单、PI File/Shell、有界 `ctf_http / ctf_socket`、轨迹回流、显式候选闸门、三种协作模式预算、Sidecar 路径策略与 macOS Seatbelt 已接通；2026-07-31 DeepSeek 已完成真实 NSSCTF P3879 的题面/附件、Agent 候选、Chrome Bridge Judge `correct=true`、证据与复盘闭环；Judge 不明确可受控重试并跨重启恢复 | 页面发现的动态 endpoint 仍缺用户确认 UI；Shell 精确网络 allowlist、真正容器/VM、专用 Debugger和多题型真实验收仍缺。Juice Shop 的 Docker 生命周期只算暂停中的内部实验，不是当前产品能力 |
| 训练与复盘 | 首次真实 Accepted 已完成，待样本校准 | 学习记录、Human Outcome、Evidence/Experiment、跨 NSSCTF/CTFshow 的六维能力画像与来源计数、区分进行中/已通过/未通过/已取消的可解释 NSSCTF 推荐、最多一题且展示提示依赖与独立步骤的失败复盘候选、PI 回合/失败轨迹、候选历史、证据驱动结构化复盘、受限 Artifact 预览、有界逐事件回放，以及默认隐去原始 Flag 的 JSON/Markdown 训练报告均已进入当前工作台；Challenge Desk、平台下拉、训练历史、浏览器配对和自定义本地 Intake 已通过浏览器与原生桌面 QA；P3879 Accepted 已进入能力画像与恢复链路 | 真实解题质量、提示粒度和能力画像有效性仍需更多不同题型的训练样本校准 |
| CVE 追踪 | 产品壳完成 | CVE 优先队列、筛选、关注、研究任务和本地持久化可用 | 来源仍是演示 Adapter，资产不是真实 CMDB，研究任务未完整接 Runtime；在 CTF MVP 前冻结扩展 |
| macOS 交付 | 开发构建完成 | 2026-08-01 `npm run m3:release-check` 已同时通过全量 Go 测试、Sidecar 策略测试、Vue 生产构建、打包 Sidecar 冒烟、Wails 生产构建、自签名和 diff 检查；最新原生 App 已回归题库、来源下拉、训练历史、已完成工作台、Markdown 轨迹和模型设置；单实例锁避免两个 Bridge/SQLite 进程争用用户数据 | 正式 Developer ID 签名、公证、升级和数据迁移仍属于公开发行工作 |

### CTF-first M3 检查点：已完成

以下窄路径已经在原生桌面连成一次真实闭环，因此可以称为“CTF 产品闭环完成”，但不能称为完整 M2、长期 M3 或通用 CTF Agent 已完成：

1. 用户选择一场比赛或一题 NSSCTF，并显式共享题目材料；
2. MilkSU 自动建立应用私有、每题独立的 Challenge Workspace，保存题面、附件、连接信息、provenance 和授权范围；M3 不把该目录误称为容器沙箱；
3. 用户一键让 PI Agent 进入该 Workspace，Agent 能读取材料、编写脚本、运行命令并持续显示工具轨迹；
4. 候选 Flag 进入 MilkSU Evidence，再由 Arena、已登录页面或人工外部 Judge 判定，模型不能自报成功；
5. 至少一题真实 NSSCTF 返回 `correct=true`，退出应用后可以恢复并查看学习复盘。
6. 清洁安装能明确同步首批题目；页面读取失败可恢复；Judge 超时或不明确时不会永久锁死候选。

工程发布门可通过 `npm run m3:release-check` 重复执行：全量 Go 测试、Vue 生产构建、打包 Sidecar 协议检查、Wails 生产包、关键生成绑定、macOS 签名和 diff 格式必须同时通过。该命令证明工程产物一致；P3879 的 Accepted 是独立的真实平台证据。

### 验收记录与当前任务队列

| 优先级 | 任务 | 验收方式 |
| --- | --- | --- |
| P0-1 | 打通 `CTF Challenge → PI Coding Agent` 一键交接 | 已完成工程接线：选择题目后自动创建固定题目目录和 Agent 任务，不再手工复制题面 |
| P0-2 | 完整材料 Intake | 已有题面、Arena/NSSCTF/CTFshow 附件的哈希与 provenance；CTFshow 同源题面图片会作为材料导入，跨源图片明确警告且不扩权；Challenge Desk 可由用户显式补充本地截图、题面图片或手动下载的附件，限制为 8 项、单项 4 MiB、合计 12 MiB，训练记录只保留文件名与摘要而不泄露原始磁盘路径；ZIP、Tar、Tar.gz/Gzip 在进入工作区时预检条目数、展开体积、路径逃逸、链接、可执行权限、高压缩比和类型伪装；安全归档自动以无执行权限的私有普通文件展开，路径清单进入 `challenge.json`；`TASK.md` 机器生成材料路径、类型、大小、哈希、展开结果和预检提示；危险、加密、特殊文件、逃逸或超限归档整包拒绝展开；继续补 NSSCTF 题面内远程图片的自动 Intake |
| P0-3 | 建立 CTF Workspace 工具策略 | 目录契约、精确授权目标、Arena 动态 HTTP/TCP/SSH 端点归一化、按模式裁剪工具、工作区文件边界、受保护策略文件、Coach 无 Shell、沙箱可见工具探测、只接受 Scope 精确 Origin/host:port 的 HTTP/TCP 基线工具、macOS Seatbelt、固定子进程环境、命令超时、输出上限、回合/时间/错误提交预算、重复调用和重复失败检测已完成；固定 Juice Shop 的真实 Docker 生命周期及 clean 已验收，但它是本地题目环境而不是 PI Shell 容器；题面文字不能自动扩权；下一步补真正容器/VM、Shell 的精确 host/port 内核级网络 allowlist 与专用 Debugger 会话 |
| P0-4 | 串联 Judge、Evidence 与恢复 | PI 回合、显式候选、格式评估、运行检查点、轨迹指标、结构化复盘、安全制品预览和有界逐事件回放已进入工作台；`TestNSSCTFPageToAcceptedTrainingReportSurvivesRestart` 已从浏览器页与附件贯穿到外部 Judge、脱敏报告，并证明新应用进程能从用户数据目录恢复 Accepted、回放和复盘 |
| P0-5 | 完成第一次真实 NSSCTF 回归 | 已完成：P3879 从选题、附件、Agent 候选到已配对 Chrome Bridge `correct=true` 全程走桌面产品，并保留可恢复轨迹 |
| P0-6 | 清洁安装题库引导 | 已完成：空目录首次进入会自动同步 NSSCTF，失败时展示明确重试动作；2026-07-31 clean-user-data 原生回归同步 4,204 题并选到第一题 |
| P0-7 | 配对页面材料与动态目标 Intake | 页面正文已作为 64 KiB 上限、带 SHA-256 provenance 的只读材料进入工作区；正文中的 URL/socket 不会自动扩权。剩余：把发现的 endpoint 作为未确认建议展示，只有用户明确确认后才写入 exact SourceTargets |
| P0-8 | Judge 不明确结果恢复 | 已完成：超时或不明确回执记录为 `inconclusive`，同一候选可以受控重试或人工核对；重启后不会永久卡在 `needs_review` |
| P1-1 | 做实比赛训练组织 | 默认 Challenge Desk 已采用与 NSSCTF 相同心智模型的完整 SQLite 分页列表，支持题号/题名/标签搜索、题型筛选、逐题状态和右侧题面预览，不再要求用户记题号或先进入“前缀系列”；下一步接官方赛事元数据 Adapter，在真实赛事字段可用时提供比赛视图 |
| P1-2 | 做实 Coach/Copilot/Delegate | 已完成不同运行契约、候选规则、程序化预算和底层工具裁剪；下一步用真实训练轨迹校准提示粒度和自治边界 |
| P1-3 | 学习复盘 | 已展示关键观察、失败实验、候选历史、提示依赖、独立步骤和下一步建议；推荐器区分任务生命周期，进行中/已通过不重复推荐，未通过题最多占一个复盘位并解释提示依赖与独立步骤；结题后要求用户提交自己的 Reflection；工作台可查看逐事件回放并生成含平台 Judge、材料哈希、工具统计和学习指标的可分享报告，原始 Flag 默认只保留哈希 |
| P1-4 | Labs 设计与解冻准备 | 已完成顶层与详细设计；Juice Shop、WebGoat、Vulhub 只保留未来自托管路线。当前暂停实现与真实接入；HTB/THM 自动化不在范围内。NYU CTF Bench 只作为开发者模式的模型/Harness 基准工具，不进入普通用户题库 |
| P2 | 恢复 CVE 主线 | 接真实增量 Feed、资产来源和研究 Runtime；不阻塞当前 CTF-first MVP |

## 里程碑

### M0 · Agent Engine 选型与工程起点

> 实现状态：已完成（2026-07-19）。当时的 Go/Wails/React 骨架、Pi/Codex 同题 Spike 和桌面结构化事件链均已实跑；M3 后桌面视图层已迁移到 Vue 3，见 [ADR-0008](/developer/adr/0008-vue-memoh-frontend)。Agent Engine 边界仍以 [ADR-0001](/developer/adr/0001-agent-engine-and-desktop-boundary) 为准。

目标：先决定 MilkSU 应在什么成熟通用 Harness 上做最小改造，避免因为偏爱某种语言而重写已经解决的问题。

- 用同一个微型 CTF 对 Pi SDK 和 Codex 开源核心/服务接口做两条 Spike；
- 比较模型与 Provider 可替换性、Tool 注册与拦截、Context/Compaction、Session/Resume、结构化事件、授权控制、嵌入方式、许可证、上游升级成本和 fork 差异；
- 优先验证“依赖/扩展即可完成”，其次才是维护小范围 fork；不接受长期大幅魔改上游；
- 记录 Agent Engine、桌面栈和进程边界 ADR；
- 将 L5 校准为“可改造 Agent Engine”，并把完整外部 CLI 运行方式与嵌入基座分开；
- 建立 Go module、包边界、测试和格式检查；
- 用 Wails v2 接管桌面 UI；是否保留 Pi Node runtime 由 Spike 结论决定；
- 明确桌面绑定只是 L1 Adapter，领域代码不依赖 Wails。

**完成标志**：两条 Spike 都留下可运行代码和比较记录；选出一个首选 Agent Engine 与备选方案；桌面应用可启动并能收到该 Engine 的结构化事件；仓库中不再存在两套相互竞争的产品主线。

### M1 · Walking Skeleton：可恢复的任务骨架

> 实现状态：已完成（2026-07-19）。用户可以在桌面创建、观察和取消确定性的 Fake Job；追加事件、Artifact 哈希、独立 Evaluator、正常关闭与强制中断恢复均已验证。实现边界见 [Runtime v1alpha1](/developer/runtime-v1alpha1)，存储与恢复决策见 [ADR-0002](/developer/adr/0002-runtime-facts-and-recovery)。用户随后已确认并启动第一条真实 CTF 纵切。

目标：在选定的 Agent Engine 上，用确定性 Fake Model/Fake Tool 验证最小安全事实链。

- 定义 `Job / Attempt / Step / Action / Observation / Artifact / Evidence / Effect / Evaluation / Outcome`；
- 定义追加式事件、SQLite Event Store 和只读 Projection；
- 建立 Artifact 目录、哈希和来源引用；
- 在不复制底层 Engine 接口的前提下，建立 MilkSU 的 `AgentEngine`、`Capability`、`Environment`、`Evaluator` 边界；
- 冻结 `LabPackage v1alpha1` 的最小来源、架构、Endpoint、Readiness、Reset、Judge 和 Security 字段；
- 冻结“程序管理 Compose/OCI、Agent 只请求类型化 `lab.start/reset/stop/submit`”的边界；M1 只校验 manifest，真实 Provider 留到 M2；
- 将 Go 事件实时推送到桌面视图层；
- 支持开始、取消、崩溃后恢复一个 Fake Job。

**完成标志**：用户能在桌面创建任务、看到 Step 流动，强制退出后重开仍能恢复；Evaluator 而不是模型决定 Outcome。

### M2 · CTF 可玩 MVP

> 实现状态：离线单题纵切和一条真实 NSSCTF Browser Judge 闭环已完成。M2 的广义完成标志仍包含多输入通道、Managed Browser/Lab 和多题型验证，因此长期 M2 仍是 Partial。

> 2026-07-21 的 [M2 → M3 授权学习能力基础检查点](/developer/checkpoints/2026-07-21-m2-m3-foundation) 是历史快照；后续真实进展以下表和当前架构快照为准。

> 2026-07-31 已通过已登录页面 Bridge 取得 P3879 `correct=true`，并保留题面、附件、候选、Judge、恢复和复盘证据；这只完成窄路径，不代表全部题型或全部 M2 交付块。

目标：尽快看到第一个由 MilkSU Security Harness 完成并能带练的真实安全任务。

CTF 不是“解完一题就结束”的 Solver 页面，而是长期陪伴 CTFer 成长的训练与比赛空间。暂定的信息层级是 `CTF Workspace → Competition/Training Task → Challenge → Attempt/Experiment`：用户可以新建一场比赛、一组训练任务，或直接开始一道题。具体导航和布局等实际使用后再定，但单题 MVP 的数据不能阻断以后向比赛和长期学习扩展。

Juice Shop 只承担可重复的本地回归测试。M2 的真人验收可能直接使用 NSSCTF 或其他任意小众 CTF 网站，因此 `Challenge` 不能依赖 Docker、Juice Shop、某个平台的数据结构，也不能假设网站会为 AI 提供 API/CLI。

首期先实现统一的 **Challenge Intake**，而不是把 Browser 当成任务入口。用户可以通过聊天粘贴题面、上传附件或截图、选择一个本地目录、提供 URL/Socket/SSH、打开本地 Lab，或显式分享浏览器页面。Intake 保存原始 Artifact、哈希、provenance 和授权范围，再归一化为同一个 Challenge/Material；Browser Use 只是其中一个 L3 Capability。详细候选和安全约束见 [Challenge Intake、Browser Use 与 Computer Use](/developer/challenge-intake-and-automation)。

这里描述的是 **M2 内部**怎样兼容真实题目来源，不会把 Challenge Intake 提前到 M0/M1 之前。全局开发顺序仍是 M0 Engine 与桌面工程起点 → M1 可恢复任务骨架 → M2 CTF 可玩 MVP。

1. **Chat / File / Image / Directory Intake**：接受文字、附件、截图与用户明确选择的本地目录；原始材料先保存和哈希，附件不自动执行，目录默认只读且不能扩大到用户未选择的位置。
2. **Managed Browser**：MilkSU 启动独立浏览器与专用 Profile，用户亲自登录任意 CTF 网站；Agent 只能操作这个受控上下文。它负责读取题目、下载附件、点击开启环境、取得连接信息和在批准后提交 Flag。
3. **User Browser Bridge**：用户把已经打开并登录的某个标签页显式分享给 MilkSU。只授权选中的标签页，不读取整个浏览器 Profile。它解决临时比赛、复杂登录和用户已经进行到一半的场景。
4. **Remote / Manual Intake**：即使浏览器不可用，用户仍可提供 URL、Pwn Socket、SSH、连接说明或手工确认结果；它不是次等保底，而是很多题型的正常入口。
5. **Platform Adapter**：只有网站恰好提供稳定公开 API 且规则允许时才增加，用于改善体验；它不是任意网站兼容性的基础，也不是 M2 必须依赖的前提。

为避免把一个内置题的成功误当成完整 CTF 产品，M2 拆成以下可单独确认的交付块：

| 交付块 | 状态 | 用户能得到什么 | 明确不包含 |
| --- | --- | --- | --- |
| M2-A · Offline Challenge Slice | 已完成工程验证 | 粘贴题面、上传小文件、真实 Pi/Model、三种类型化动作、独立本地 Judge、实验与证据面板 | Browser、Shell、Lab、在线提交、Coach/Copilot |
| M2-B · Managed Local Lab | Paused / Designed | 固定本地靶场由程序启动/重置/清理，受控 File/Shell/Socket Capability | 当前发布、任意网站与用户浏览器 |
| M2-C · Managed Browser | Planned | 独立 Profile 登录小众 CTF，读取题面、下载附件和在审批后提交 | 当前发布、读取用户整个浏览器 Profile |
| M2-D · User Browser Bridge | 已完成 NSSCTF 窄路径验收 | 用户显式绑定当前 NSSCTF 题目页，候选提交与平台回执进入 Evidence/Outcome | 静默接管其他标签页、读取 Cookie/密码、任意网页脚本 |
| M2-E · Teaching and Workspace | 工程完成，待真实训练验证 | 列表式 Challenge Desk、公开题库同步、跨 NSSCTF/CTFshow 且带来源计数的六维能力雷达、可解释 NSSCTF 推荐、Coach/Copilot/Delegate 运行契约、批量材料分诊、同题 Coding Agent 工具工坊、隔离的策略 Agent 复盘、失败轨迹、结构化复盘、用户确认的本机训练记忆、安全制品预览与有界逐事件回放 | 长期跨比赛学习计划、逐工具 Diff、自动并行 Agent、提示策略和能力画像的真实样本校准 |
| M2-F · Platform Evaluation Track | NSSCTF 窄路径已验收 | 公开题目导入；官方 Token 领题、恢复、提交、放弃；已登录页面提交；平台 Judge 回写 Evidence/Outcome | 通用平台账号、全部平台 E2E、Swarm/完整 benchmark Runner |

M2-B 与 M2-C 谁先做不是架构定律，要根据用户当前最想验收的场景选择。两条路径都必须复用 M2-A 的 Challenge、Experiment、Evidence 与 Judge，而不能另造一套任务真相。

- 通过选定 Engine 接入第一个真实 Model Provider；
- 在通用 Tool Loop 上实现 MilkSU Security Loop：观察 → 假设 → 实验 → 证据 → Judge → 调整；
- 接入隔离环境、Shell/File Capability 和已固定版本的 OWASP Juice Shop 本地 fixture（`labs/ctf/juice-shop`）；
- 用户从 CTF Workspace 选择 Challenge 后由 Lab Manager 一键准备环境，不需要复制启动命令或端口；
- 定义与 Environment 解耦的 `ChallengeSource / TargetProvider / SubmissionJudge`：本地 Lab、远程 URL/Socket 和网站题共享 CTF Role，但生命周期能力不同；
- 实现统一 Challenge Intake：聊天文字、文件、截图、本地目录、浏览器页面和远程连接都产生保留原始材料与授权的规范化输入；
- 实现 Managed Browser Sandbox：用户可在隔离 Profile 中登录任意网站，Agent 通过受控 Browser Action 读取、点击、下载和填写；
- 实现或至少跑通 User Browser Bridge 的最小共享标签页路径，让用户能把已经登录的当前题交给 MilkSU；
- 分离 Platform Context 与 Target Context：前者持有比赛账户，后者访问不可信靶机，Cookie、存储和凭据不能互通；
- 跑通 Manual Import 保底路径，覆盖非浏览器的 Pwn Socket、SSH、附件题和临时连接信息；
- 自动 Flag 提交必须显式启用、限速并保存提交前确认与网页响应 Evidence；没有平台 API 时，浏览器页面的成功提示就是外部 Judge 输入；
- 保存 Experiment Tree、命令输出、脚本、Flag 来源和失败分支；
- 实现版本化 Flag Judge；
- CTF 面板展示当前假设、实验、证据、Judge 和对话；
- Coach 提供分级提示，Copilot 支持共同选择实验，Delegate 可自主推进。
- 在 Workspace 中累计题型、知识点、失败模式、提示依赖和用户独立完成的关键步骤，形成可继续的学习记录。
- 让解题 Agent 与 Coding Agent 通过结构化工具请求、可测试脚本和独立轨迹交接；卡住时由只读策略 Agent 独立诊断路线并交付一个可验证下一步；用户确认的复盘保存为本机可归档记忆，新题只把它作为待验证先验。

**完成标志**：真实模型能从桌面完成一题；用户无论粘贴题面、上传文件/截图、选择本地目录、提供远程连接还是分享网页，都进入同一个完整 CTF Agent 闭环；本地环境由 MilkSU 自动启动、重置和清理，远程网站题不错误调用本地生命周期；在没有任何专用 API/CLI Adapter 的情况下，用户能登录一个未针对开发过的小众 CTF 网站，把题目、附件和目标交给 Agent，并由本地 Judge、网站页面响应或用户确认验证 Flag；用户可以在三种协作方式下介入，并从复盘看到“为什么这样解”；再次打开 Workspace 时可以继续下一题。更换输入通道、网站或本地 Lab 不能要求修改 CTF Role、Evidence 或教学闭环代码。

### M3 · Vuln Research 可用 MVP

> 实现状态：M3-A 证据纵切已完成工程验证（2026-07-30）。Vuln Role、固定本地 Target/Scope、静态攻击面与根因 Evidence、三次外部 ASan 日志一致性 Evaluator、独立研究工作台和 Human Outcome 已接入桌面，见 [ADR-0005](/developer/adr/0005-vuln-research-evidence-slice)。MilkSU 未生成或执行漏洞触发输入；因此下面“自动编译、触发、最小化并由自身干净环境重放”的严格完成标志仍保留为后续工作。
>
> 同日完成的 [M3 Product Shell](/developer/adr/0006-m3-product-control-plane) 已把桌面入口调整为比赛目录自动组场和 CVE 优先队列，并验证关注、研究任务和跨刷新持久化。当前数据来自明确标记的内置演示 Adapter；真实比赛平台、实时漏洞 Feed、资产系统和完整 Runtime Projection 仍是后续接线，因此不能据此宣称完整 M3 已完成。

目标：用第二类任务检验第一版抽象，避免把 CTF 的特殊性误写成通用 Runtime。

M3 开始前必须完成一次“学习产品发布门”评审：确认密钥不落明文、Sidecar 可固定和审计、Browser/Shell/Network 权限默认最小化、外部目标有显式授权记录，并检查当前界面和能力没有退回通用扫描产品语义。未通过时只允许继续本地 fixture 与文档开发，不发布外部目标能力。

Vuln 面板的产品方向不是“一次性扫描向导”，而是赏金猎人或安全研究员愿意长期停留的个人实验室：打开以后立即知道最近在研究什么、哪些假设还没验证、哪些 Crash 等待复现、证据放在哪里、下一步最值得做什么。第一版先保证信息真实、可操作、可继续，视觉上的炫酷和“像家一样熟悉”随真实使用逐步打磨。

- 建立 `Target/Version / Attack Surface / Hypothesis / Experiment / Crash or Behavior / Reproduction / Root Cause / Exploitability` 投影；
- 准备一个版本固定、授权明确的本地漏洞研究 fixture；
- 接入编译、运行、调试或最小 Fuzz Capability；
- 保存触发样本、调用栈、环境指纹和最小复现；
- 实现稳定复现 Evaluator，根因和影响允许独立人工复核；
- Vuln 面板以“研究工作台”组织目标、假设队列、最近实验、Crash、待复现项、证据和下一步，而不是只显示一次 Agent 对话；
- 在 Coach/Copilot 中让用户参与攻击面选择和根因解释。

**完成标志**：Agent 找到候选问题后，MilkSU 能在干净环境稳定复现并引用原始证据；用户重新打开客户端能自然继续昨天的研究，并能够复述根因或完成一个变体实验。

### M4 · MilkSU Security Harness v1：恢复、上下文与治理

目标：把两个 MVP 中真实出现的共性固化成可靠 Harness。

- 用 MilkSU 事件和角色投影向底层 Engine 重建安全上下文，而不是另外实现一套通用 Compaction；
- 实现预算、超时、取消、重试和 Checkpoint；
- 区分模型提议、PolicyDecision、实际 Action 和已提交 Observation；
- 加入 Effect、幂等、清理、授权范围和风险分级审批；
- 支持 Attempt 对比、Replay 和失败分类；
- 固化 Human Outcome：提示使用、用户独立步骤、根因解释和变体迁移。

**完成标志**：长任务中断后不会丢失事实或重复关键 Effect；同一任务的多个 Attempt 可以按成功、成本、证据和学习效果比较。

### M5 · Capability 与环境扩展

目标：让 CTF/Vuln 从演示题扩展到一小组有代表性的真实任务。

- 冻结 Capability Package manifest 与 Adapter contract；
- 按实测需要扩展 Web、Binary、Source、Fuzz 等能力；
- 支持 Docker 环境模板、快照/重建和健康检查；
- 接入确定性 CLI、API 或 MCP，但保留原始输出和版本；
- 为每个接入项目记录拆解卡、风险和 ADR。

**完成标志**：新增工具不需要修改 Role 核心模型；同一种 Capability 可以同时服务 CTF 与 Vuln，并产出一致的 Observation/Artifact。

### M6 · 基线、外部运行时与评测

目标：证明自研 Security Harness 的收益，而不是只证明模型会做题。

- 建立固定 CTF/Vuln benchmark、预算和环境版本；
- 记录 `success@1`、`success@N`、成本、恢复率、复现率、错误成功率和 Human Outcome；
- 实现通用 External Agent Runtime Adapter；它与 M0 选定的内嵌 Agent Engine 保持概念分离；
- Codex CLI、Claude Code 作为可选兼容运行方式接入；
- 在相同任务、模型条件允许时比较 MilkSU Security Harness 与原版 Coding Harness；
- 根据真实轨迹决定吸收、委派或拒绝哪些业界设计。

**完成标志**：我们能用数据回答 MilkSU Security Harness 在哪些场景优于直接运行原版 Coding Agent；外部 Runtime 的升级或缺失不会阻止默认 Harness 工作。

### M7 · 桌面产品化

目标：把研究原型变成可以长期使用的本地安全工作台。

- 完成 CTF 与 Vuln 各自的信息架构和交互细节；
- 把 CTF 工作台打磨成长期训练主页，既能进入一场比赛，也能组织训练任务和单题，并持续呈现学习轨迹；
- 把 Vuln 工作台打磨成研究员的长期主页：高信息密度但不压迫，常用目标、环境、工具、证据和未完成研究触手可及；
- 管理模型、环境、凭据、工具版本和本地数据；
- 提供任务导入导出、证据包和复盘报告；
- 完成 macOS 打包、签名、升级和数据迁移；
- 根据真实需求再评估 Windows；
- 只有出现远程、多机或多人协作需求时，才评估 PostgreSQL 和服务化。

**完成标志**：macOS 用户可以安装、配置模型、完成任务、恢复历史并导出可复核证据，不需要部署 Web 服务。

## 交互式开发节奏

每个里程碑都按同一节奏进行：

1. 先选一个用户能亲手体验的最小场景；
2. 写清事实、接口、Evidence、Evaluator 和预期 UI；
3. 实现并自动测试；
4. 在桌面中由用户实际操作；
5. 一起阅读失败轨迹，决定保留、修改或删除；
6. 完成一个小提交，再进入下一纵切。

短期目标不是把七个里程碑一次设计完。真实 P3879 Accepted、清洁安装题库同步、配对页面
正文 Intake 和 Judge 不明确结果恢复已经形成 CTF 基线；当前按“NYU + Coding first →
CTF → Memory → Foundation → Architecture”的顺序收口。Managed Labs 与 CVE 扩展已冻结，
不再作为 R0.4 完成条件。下一步先让最小 Eval 和 Coding Agent 真实交付 fixture 进入可重复
回归，再完成 UI/Markdown 与原生发布门。
