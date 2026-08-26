# 个人安全工作台计划

> 状态：Historical product plan（2026-08-11 那一轮）
>
> 形成日期：2026-08-11
>
> 当时把 CTF/CVE 收薄、工具只接 Coding、披露暂缓，是那一轮的范围，不是现行禁令。
> 现行口径以 [当前开发目标](current-objectives.md) 和 `AGENTS.md` 为准：尚未实现不是禁止实现。
>
> 目标关联：Codex 任务 `019fe9ee-b865-75b3-903d-bada1266f254` → 本产品计划 →
> [当前开发目标](current-objectives.md)
>
> 本文保留当时决策和验收记录。执行时先读取
> `current-objectives.md`、`product-code-admission.md`、`current-system.md` 和当前代码。

## 进行中目标

完成 MilkSU 个人安全工作台：固化已确认的产品决策、问答与界面稿；将 CTF/CVE 做薄并接入
统一 Coding；实现真实个人成长页；在独立私有目录 `/Users/milksu/code/milksu-admin` 建立
GitHub 登录、邀请制访问和用户级模型凭据管理；让 MilkSU 客户端静默取得账户分配 Key，同时保留
用户自有 Provider Key；按纵向切片完成测试、构建追踪和真实验收。

本目标已经作为当前 Codex 任务的进行中目标创建。阶段进度以
[当前开发目标](current-objectives.md#进行中目标个人安全工作台) 为准，本文保存稳定产品决策与
验收方向。

## 当前进度

- 已实现并测试：个人资料、轻量 CTF/CVE、共享 Coding 上下文、真实 CTF Daily、公共数据驱动的
  CVE 学习专题、独立 Admin、用户级 TokenFlux Key 分配与客户端静默同步。
- 产品 UI 设计语言只写在仓库根目录 `AGENTS.md`。旧战术档案 / 酸绿界面系统已删除，不再作为实现或验收约束。
- CTF/CVE 交给 Coding 时，输入框只显示一句可读的接力任务；完整结构化提示在发送时才交给 Agent，
  并绑定当前对话，避免内部工作区路径、Scope 编排和长提示直接暴露或跨任务串用。
- 最终功能提交 `main@cfc9a102408b8e2017f339ddce08f246b6b67c02` 已由 workflow `31676876645`
  构建正式签名 App；Apple 公证、stapler、Gatekeeper、严格签名和隔离首次启动均通过。设置页实机
  确认 `dirty=false` 与 tracking ID
  `6adfa291a021387f7cb40800012941a51f051bec90036b78353c68a4c57d58ff`。
- 原生 Computer Use 已复检个人页、模型来源、CTF/CVE 草稿交接、领域上下文 PiP、返回状态、
  关联对话和无虚构 CVE 资产。CTF 状态由用户手工维护；CVE 首页只显示用户明确加入的条目。
  CVE-2024-3400 已在打包 App 中由 Coding Agent 进入临时工作区完成只读研究并生成中文简报，返回后
  自动关联 1 个 Coding 对话，状态仍诚实地保持手工“研究中”。
- “添加 CVE”已改为先搜索 NVD 再选择加入；搜索结果加入时复用当前返回数据，不发第二次请求。
  `CVE-2024-3094` 已在打包 App 中真实搜索并加入；用户可见默认状态为手工“想研究”。大量 NVD
  参考资料按机构去重，主界面最多显示四个关键来源，其余统一进入“在 NVD 查看全部”。最终签名 App
  已通过学习专题取得真实 NVD 搜索结果。
- CTF Daily 不再把题库第一行伪装成每日挑战：规则先筛候选，Pi 可结合近期题目、关联 Coding 对话、
  已确认训练事实和 CTF Memory 选择并解释，当天固定且允许换题，模型不可用时规则兜底。代码与最终包
  表面已复检；真实模型选择回执仍待有可用题库与模型的内测环境补齐。
- 壳侧栏与会话历史的现行交互以 `AGENTS.md` 为准；本页旧「窄栏 + 浮层历史」描述已过期。
- 用户可见产物固定写入 `~/Documents/MilkSU/{Coding,CTF,CVE}`，设置页可打开；内部 Runtime、凭据、
  Obelisk、浏览器 Profile 和恢复数据继续留在 App Support，不暴露成用户工作区。
- 独立私有仓库 [MilkSU-Official/milksu-admin](https://github.com/MilkSU-Official/milksu-admin) 已到
  `89b2037`：React 管理端、Cloudflare Worker、D1、邀请、暂停访问、用户级 TokenFlux 凭据分配和
  日间/夜间模式均已部署到 `accounts.milksu.org`；线上 `/health` 和 `/ready` 已通过。GitHub OAuth
  已完成真实管理员登录；`MilkSU-Official` 的邀请已由桌面端兑换，Admin 已显示访问开通和模型凭据
  已分配。客户端 `main@73595e4` 已静默取得该 Key、保存到本地 Credential Store，并以准确的
  `grok-4.6` 完成真实 Coding 回合。MilkSU 自有余额、价格映射、扣费流水和代理计费已退出当前产品链。

## 目标

把 CTF 和 CVE 收成轻量的个人记录与任务入口，把分析、工具和动态工作继续交给同一个
Coding Agent。个人资料页诚实记录用户在 CTF、CVE 和 Coding 中的活动与成长。

GitHub 登录、邀请和模型来源已经接入；登录用户可以使用 Admin 分配的独立 TokenFlux Key，也可以
继续使用自己保存在本机 Credential Store 的 Provider Key。MilkSU 不再提供余额或自建代理计费。

## 已确认界面

产品 UI 设计语言只写在 `AGENTS.md`。旧战术档案稿、酸绿带和 `design-qa.md` 已删除，不得再作为新设计、实现或验收的参考。

Admin 视觉对照、凭据分配和 Cloudflare 版本截图保存在独立私有仓库
`MilkSU-Official/milksu-admin` 的 `docs/evidence/`，不复制进对内测用户开放的桌面仓库。

## 验收记录

| 项目 | 当前证据 | 结果 |
| --- | --- | --- |
| 桌面产品代码 | Vue/Vitest 76 个文件、434 项测试与生产类型检查/构建通过 | 通过 |
| 桌面壳与 Sidecar | Electron、账户 PKCE、Pi、安全边界、Browser Extension 与 Computer Use 共 240 项 Node 测试通过 | 通过 |
| Go Runtime | `go test ./...` 全仓通过 | 通过 |
| CTF/CVE 收薄 | CTF 状态手工维护；CVE 首页只从用户明确加入的条目生成；相关聚焦与完整回归通过；最终签名 App 已完成原生复检 | 通过；Daily 真实模型回执单列 |
| 正式签名身份 | `main@cfc9a102408b8e2017f339ddce08f246b6b67c02`、`dirty=false`、tracking ID `6adfa291a021387f7cb40800012941a51f051bec90036b78353c68a4c57d58ff`；Developer ID、公证、staple、Gatekeeper 与严格签名通过 | 通过 |
| Admin 前后端 | `main@89b2037`；用户级模型凭据接口、加密保存、管理界面与生产部署已完成 | 通过 |
| Cloudflare 部署 | `accounts.milksu.org` 的 Worker、D1、静态管理端、`/health` 与 `/ready` 可用 | 通过 |
| Admin 日间模式 | 与客户端相同的日间/夜间切换、持久化和窄屏布局已在本地及线上核对 | 通过 |
| 游戏化 UI | Desktop CTF/CVE/Coding/Profile/Settings 与 Admin 日夜主题均以实际运行截图核对；CTF/CVE 接力草稿、来源右栏和返回路径通过 Computer Use | 通过 |
| GitHub OAuth | 真实 GitHub 管理员账户登录成功；OAuth Secret 只存在 Worker Secret | 通过 |
| 邀请与模型凭据 | 桌面兑换邀请；Admin 显示访问开通和 TokenFlux 凭据已分配 | 通过 |
| 桌面账户联动 | Electron 静默取得账户 Key，Go 保存到本地 Credential Store；运行时只显示 Grok 4.3/4.5/4.6，真实 Coding 回合成功 | 通过；正式签名发行待生成 |
| 真实 CTF/CVE | 全新 `Caesar Shift 12` 完成创建、共享 Coding、运行中引导、脚本/笔记、返回和手工完成；题面矛盾被如实指出，未编造 Flag 或 Judge 成功。CVE-2024-3400 已完成只读研究、文档交付、返回与对话关联 | 通过 |
| 正式 App | workflow `31676876645` 产出的 DMG 已下载，并在隔离数据目录首次启动；设置页 branch/完整 commit/tracking ID、登录视觉、CVE 专题与真实 NVD 结果已回归 | 通过；CTF Daily 真实模型回执待内测环境补齐 |

Obelisk 当前保存和检索 Coding、CTF、CVE 历史，只能帮助用户找回做过的事情。个人页现有次数、
阶段和最近活动是本机投影，不把一次 Agent 代做、手工“已完成”或普通工具调用解释成用户能力提升。
后续只有带来源、结果和协助程度的 Judge、测试/提交、正式 Evidence 或用户确认，才进入可归因的
成长事实；这项升级不在本轮实现。

## 实施顺序

### 1. 个人入口与成长页

- 左上角改为当前用户头像；点击后弹出菜单，由“个人资料”进入完整页面。
- 个人页展示全年活跃格、CTF/CVE/Coding 的真实次数、模糊阶段和最近成长。
- 活跃与成长自动来自用户发起的真实任务；Agent 的工具调用不单独计数。
- 详细对话、代码和材料留在本机，只同步个人资料与简短成长概况。
- 全局六维雷达停止展示。先保留并注释现有实现，说明它只可能在以后迁入 CTF 内部。

### 2. CTF 变薄

- 主页面只保留每日挑战、题库、分类、历史和导入。
- 每日挑战由现有训练规则先筛候选，再复用当前 Pi，结合近期做题、已确认训练事实、关联 Coding
  对话和 CTF Memory 选择并给一句理由；结果当天固定，允许换题。模型不可用时才使用规则兜底。
  不做连续打卡、积分和月历奖励，也不把普通题库第一行伪装成 Daily。
- 题目展开后只显示必要材料、手工状态、关联 Coding 对话和“交给 Coding”。
- 历史只记录明确开始、导入或从题目发起的 Coding 对话；浏览题库不产生记录。

### 3. CVE 变薄

- 首页只显示用户明确加入研究的公开 CVE；公共数据源只用于搜索和添加。
- 条目展开后只显示简要材料、手工状态、关联 Coding 对话和“交给 Coding”。
- 学习专题是 CVE 内的次级入口；点击后从 NVD 公共数据搜索同类 CVE，再由用户选择加入研究。
  它不只是过滤用户本地列表，也不增加课程进度、自动状态或第二套 Agent。
- “我的漏洞披露提交”暂缓，不进入本轮。

### 4. 安全工具接入 Coding

| 阶段 | 项目 |
| --- | --- |
| 优先接入 | capa、本机安装的 CodeQL、Taskflow 中可复用的 CodeQL MCP |
| 下一步 | Shannon 外部 Worker |
| 后续连接 | Strix、用户已有 CAPEv2、用户已有 Assemblyline |
| 学习或评测 | CAI、ARTEMIS、AgentRE-Bench、Agentic SOC |
| 当时未接 | BoxPwnr、PentAGI |

当时工具先接到 Coding，CTF/CVE 不复制工具面板或 Agent Loop。这是 8 月 11 日那一轮的范围，
不是“不准再接到 CTF/CVE”。每项接入仍按上游授权、权限范围和真实任务判断。

### 5. GitHub 内测账户

- 使用 Cloudflare Worker、D1 和 GitHub OAuth 在系统浏览器完成登录；只有邀请用户可以进入内测。
- 登录后左上角显示用户头像；资料允许修改头像、显示名称和一句介绍。
- 所有联系入口统一使用 `milksu@proton.me`。
- 独立私有后台仓库保存邀请、访问状态、加密的用户级模型凭据、管理员页面和账户 API；不放进桌面端仓库，也不向内测用户开放。
- Web 管理端、账户 API 和 D1 由一个 Cloudflare Worker 承载，桌面端只保存权限为 `0600` 的不透明
  会话文件，不使用 macOS Keychain；会话不进入 renderer、日志或模型上下文。同一系统用户下的本地
  恶意进程仍可能读取，这是换取无钥匙串弹窗体验的明确边界。GitHub Client Secret 只进入 Worker
  Secret，不进入仓库或客户端。

### 6. 账户模型与个人来源

- Admin 为每个登录用户分配一份独立 TokenFlux Key，并加密保存在服务端。
- Electron 用不透明账户会话取得当前用户凭据，直接交给 Go 写入现有 `0600` Credential Store；
  renderer、日志、模型上下文和普通配置文件都不接触 Key。
- 账户模型直接请求 `https://tokenflux.dev/v1`；MilkSU 不维护余额、价格映射、扣费流水、超限或代理路由。
- Go 获取与当前 Key 分组一致的模型目录并作为唯一可选集合；未配置凭据的原厂 Provider 不进入任务模型列表。
- 原厂 Provider 和自定义 OpenAI-compatible 中转站仍可由用户在设置中逐个配置；每个 Key 只保存在本机
  Credential Store，未配置时隐藏。
- Coding 中的模型选择只影响当前对话；Coding、CTF 与 sub-agent 复用同一 Pi Provider 注册和目录。
- 管理后台继续支持邀请、暂停访问和更换/撤销用户模型凭据，不再把内部测试额度描述成模型账单。

### 7. 收口

- 每个纵切使用现有测试和一项真实用户任务验收，不把按钮或模拟数据当完成。
- 从干净提交构建 Beta，在设置页核对 branch、完整 commit 和 tracking ID 后再做原生 UI 回归。
- CTF、CVE、个人资料、登录和模型来源全部通过后，才更新正式 App 和 Current 文档。

## 那一轮没做

当时没做自动项目管理、自动改 CTF/CVE 状态、打卡积分、披露提交追踪，也没做第二套通用 Agent
Harness。这些不是永久禁令。第二套通用 Harness 仍然不要造；披露对外部平台的静默代交仍然不要做。
CTF/CVE 工作台、本地复现和安全工具进安全工作区，按现行目标可以直接做。

## 附录：决策问答记录

这里保存本轮连续确认的结果。问题经过压缩，不逐字重复聊天；后续 Agent 仍需按当前代码和
仓库规范决定实现细节。

| # | 核对的问题 | 已确认答案 |
| --- | --- | --- |
| 1 | CTF/CVE 更像个人记录还是任务入口？ | 两者并重，偏个人记录。 |
| 2 | 是否建立自动选题或推荐模块？ | 不建立通用推荐系统；每日挑战是唯一例外，复用 Pi 和既有训练/记忆事实做一次薄推荐。 |
| 3 | 哪个领域适合每日内容？ | 只有 CTF 做“每日挑战”。 |
| 4 | CVE 如何组织学习内容？ | 做“学习专题”，按漏洞类型串联多个公开 CVE。 |
| 5 | CTF/CVE 状态是否自动追踪？ | 完全手工；Judge 等验收事实与手工状态分离。 |
| 6 | 如何关联 Coding 对话？ | 只自动记录从当前 CTF/CVE 发起的 Coding 对话。 |
| 7 | 是否推断其他对话属于某道题或某个 CVE？ | 不推断，不增加复杂的关联管理界面。 |
| 8 | 页面需要多少说明文字？ | 用户看一眼能懂；需要长篇解释才能使用的功能不做。 |
| 9 | CTF 页面叫什么、采用什么结构？ | 使用玩家熟悉的“挑战”与题库列表，不使用“案件”。 |
| 10 | 是否突出“正在做的挑战”？ | 不突出；历史收进“历史”入口，每日挑战放题库首行。 |
| 11 | 是否做连续打卡、月历和积分？ | 本轮不做。 |
| 12 | 是否保留 GitHub 风格格子？ | 保留，但只在个人页展示真实活跃度。 |
| 13 | 每日挑战如何选择？ | 规则先筛候选，Pi 结合近期习惯、训练事实、相关对话和 CTF Memory 选择并解释；当天稳定、排除已完成题目，允许用户主动换题；模型不可用时规则兜底。 |
| 14 | 哪些操作写入 CTF 历史？ | 明确开始、导入或从题目发起 Coding；单纯浏览不写入。 |
| 15 | 全局能力画像展示什么？ | 活跃格、CTF/CVE/Coding 概况和最近确认成长。 |
| 16 | CTF 成长是否给精确分数？ | 不给；只显示“刚开始、持续练习、比较熟悉”等阶段。 |
| 17 | 成长记录由谁提交？ | 从真实用户任务自动形成，不要求用户手工申报。 |
| 18 | Agent 工具调用是否算成长？ | 不单独计算；按用户发起并完成的真实任务计。 |
| 19 | 哪些资料同步到账号？ | 头像、资料、活跃日期、阶段和简短成长；对话、代码、材料留本机。 |
| 20 | 个人页是否公开？ | 第一版私有，仅本人可见。 |
| 21 | 个人资料可以改什么？ | 头像、显示名称和一句介绍。 |
| 22 | 六维雷达如何处理？ | 从全局移除，代码暂留并注释，只可能以后放进 CTF 内部。 |
| 23 | 登录后左上角显示什么？ | 用户自己的头像，不再显示 MilkSU Logo。 |
| 24 | 头像菜单放什么？ | 先放个人资料，并为账户、设置、退出保留自然位置。 |
| 25 | 内测使用什么登录？ | GitHub OAuth；Google 暂缓。 |
| 26 | 谁能登录内测？ | 受邀用户；代码仓库权限和产品访问状态分开管理。 |
| 27 | 管理系统放在哪里？ | 独立私有仓库 `/Users/milksu/code/milksu-admin`，包含 Web 管理前端和 API 后端。 |
| 28 | 账户如何获得模型能力？ | Admin 为每个受邀用户分配独立 TokenFlux Key；客户端登录后静默同步到本机 Credential Store。 |
| 29 | 账户 Key 与个人 API Key 如何共存？ | 账户目录和用户已配置 Provider 都可用；运行时只展示各凭据实际可调用的模型。 |
| 30 | TokenFlux、CVE 披露和联系入口如何处理？ | TokenFlux 直接使用用户级 Key，不建设 MilkSU 自有计费；披露追踪暂缓；联系统一为 `milksu@proton.me`。 |
| 31 | 全局侧栏如何避免切换页面时忽大忽小？ | 固定使用窄栏；Coding 会话历史默认收起，需要时由一个按钮打开浮层。头像裁切为圆形。 |
| 32 | CVE 默认状态如何表达？ | 用户可见为“想研究”，不暗示必须复现；状态仍完全手工。 |
| 33 | CVE 学习专题从哪里取内容？ | 搜索 NVD 公共数据，不只过滤用户已经加入的 CVE。 |
