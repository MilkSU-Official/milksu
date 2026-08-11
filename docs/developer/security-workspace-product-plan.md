# 个人安全工作台计划

> 状态：Approved Product Plan
>
> 形成日期：2026-08-11
>
> 目标关联：Codex 任务 `019fe9ee-b865-75b3-903d-bada1266f254`（进行中）→ 本产品计划 →
> [当前开发目标](current-objectives.md#进行中目标个人安全工作台)
>
> 本文是下一阶段产品目标，不是完成证据。执行时先读取
> `current-objectives.md`、`product-code-admission.md`、`current-system.md` 和当前代码。

## 进行中目标

完成 MilkSU 个人安全工作台：固化已确认的产品决策、问答与界面稿；将 CTF/CVE 做薄并接入
统一 Coding；实现真实个人成长页；在独立私有目录 `/Users/milksu/code/milksu-admin` 建立
GitHub 登录、邀请制访问、额度与流水管理 API/管理前端；让 MilkSU 客户端接入账户额度与
自有 API Key 的可选路由；按纵向切片完成测试、Beta 追踪和真实验收。

本目标已经作为当前 Codex 任务的进行中目标创建。阶段进度以
[当前开发目标](current-objectives.md#进行中目标个人安全工作台) 为准，本文保存稳定产品决策与
验收方向。

## 当前进度

- 已实现并测试：个人资料、轻量 CTF/CVE、共享 Coding 上下文、独立 Admin 基线、账户额度与本机
  Key 的全局/对话级顺序。
- 已从干净功能提交 `3bbf2817ccd39935bc6e596a2a3d7470d1658907` 构建 `MilkSU Beta`；包检查确认
  branch `main`、`dirty=false`，tracking ID
  `c762a242def367e2dcb8d6a7066db52bf71dd96c1035dd639e77e900135fc7f0`。
- 原生 Computer Use 已复检个人页、模型来源、CTF/CVE 草稿交接、领域上下文 PiP、返回状态、
  关联对话和无虚构 CVE 资产；最后一批又把 CTF 状态改为手工维护，并让 CVE 首页只显示用户明确
  加入的条目。最终包的原生复检正在等待本机确认这次 ad-hoc Beta 对 macOS 安全存储的访问；桌面端
  兑换邀请、显示真实额度以及 App 内 Agent 实际完成 CTF/CVE 仍是完成线，不以按钮或草稿代替。
- 全局左栏固定为窄栏，头像使用圆形裁切；Coding 会话历史默认收起，只在用户点击后以浮层展开，
  不再因 CTF、CVE、Coding、个人资料和设置切换而挤动主页面。
- 独立私有仓库 [MilkSU-Official/milksu-admin](https://github.com/MilkSU-Official/milksu-admin) 已到
  `277af3b73b21a4295ee58c462adb807b36225e1c`：React 管理端、Cloudflare Worker、D1、邀请、暂停访问、
  额度增减、用户流水、全局流水和日间/夜间模式均已部署到 `accounts.milksu.org`；线上 `/health` 和
  `/ready` 已通过。GitHub OAuth 已完成真实管理员登录；`MilkSU-Official` 的 ¥5.00 待领取邀请已写入
  D1，仍需由桌面端登录兑换。TokenFlux Team 继续按真实团队接入结果验收。

## 目标

把 CTF 和 CVE 收成轻量的个人记录与任务入口，把分析、工具和动态工作继续交给同一个
Coding Agent。个人资料页诚实记录用户在 CTF、CVE 和 Coding 中的活动与成长。

内测结束前补上 GitHub 登录、邀请、额度和模型来源切换；用户可以使用 MilkSU 分发的额度，
也可以继续使用自己保存在本机的 API Key。

## 已确认界面

这些图片是实现目标，不代表功能已经完成：

### 个人资料页

![个人资料页定稿](../design/milksu-personal-profile-approved.png)

### CTF 挑战页

![CTF 挑战页定稿](../design/milksu-ctf-challenges-approved.png)

### CVE 研究页

![CVE 研究页定稿](../design/milksu-cve-research-approved.png)

### 账户与模型来源

![账户与模型来源定稿](../design/milksu-account-model-routing-approved.png)

### GitHub 登录页

![GitHub 登录页定稿](../design/milksu-github-login-approved.png)

### 独立内测管理后台

![独立内测管理后台定稿](../design/milksu-beta-admin-approved.png)

实现后的 Admin 视觉对照、额度操作和 Cloudflare 版本截图保存在独立私有仓库
`MilkSU-Official/milksu-admin` 的 `docs/evidence/`，不复制进对内测用户开放的桌面仓库。

## 验收记录

| 项目 | 当前证据 | 结果 |
| --- | --- | --- |
| 桌面产品代码 | Vue/Vitest 68 个文件、365 项测试，lint 与生产构建通过 | 通过 |
| 桌面壳与 Sidecar | Electron、账户 PKCE、Pi、安全边界与 Computer Use 共 212 项 Node 测试通过 | 通过 |
| Go Runtime | `cmd/milksu-backend`、`internal/config` 与 `internal/computercap` 测试通过 | 通过 |
| CTF/CVE 收薄 | CTF 状态手工维护；CVE 首页只从用户明确加入的条目生成；聚焦测试 37 项通过 | 代码通过，最终原生复检待完成 |
| Beta 身份 | `main@3bbf2817ccd39935bc6e596a2a3d7470d1658907`、`dirty=false`、tracking ID `c762a242def367e2dcb8d6a7066db52bf71dd96c1035dd639e77e900135fc7f0`；Package Inspector 与严格签名检查通过 | 通过 |
| Admin 前后端 | `main@277af3b73b21a4295ee58c462adb807b36225e1c`；构建、10 项前端测试与 3 项 Worker 资源测试通过 | 通过 |
| Cloudflare 部署 | `accounts.milksu.org` 的 Worker、D1、静态管理端、`/health` 与 `/ready` 可用 | 通过 |
| Admin 日间模式 | 与客户端相同的日间/夜间切换、持久化和窄屏布局已在本地及线上核对 | 通过 |
| GitHub OAuth | 真实 GitHub 管理员账户登录成功；OAuth Secret 只存在 Worker Secret | 通过 |
| 邀请与初始额度 | D1 中存在 `MilkSU-Official` 的 ¥5.00 待领取邀请 | 后台通过，桌面兑换待完成 |
| 桌面账户联动 | GitHub 登录、头像、余额与两种模型来源顺序 | 待原生验收 |
| 真实 CTF/CVE | 由打包 App 内 Agent 完成任务并保留结果 | 待最终验收 |
| 正式 App | 从最终干净提交构建、核对追踪并打开 | 待最终验收 |

## 实施顺序

### 1. 个人入口与成长页

- 左上角改为当前用户头像；点击后弹出菜单，由“个人资料”进入完整页面。
- 个人页展示全年活跃格、CTF/CVE/Coding 的真实次数、模糊阶段和最近成长。
- 活跃与成长自动来自用户发起的真实任务；Agent 的工具调用不单独计数。
- 详细对话、代码和材料留在本机，只同步个人资料与简短成长概况。
- 全局六维雷达停止展示。先保留并注释现有实现，说明它只可能在以后迁入 CTF 内部。

### 2. CTF 变薄

- 主页面只保留每日挑战、题库、分类、历史和导入。
- 每日挑战是题库首行；允许换题，不做连续打卡、积分和月历奖励。
- 题目展开后只显示必要材料、手工状态、关联 Coding 对话和“交给 Coding”。
- 历史只记录明确开始、导入或从题目发起的 Coding 对话；浏览题库不产生记录。

### 3. CVE 变薄

- 首页只显示用户明确加入研究的公开 CVE；公共数据源只用于搜索和添加。
- 条目展开后只显示简要材料、手工状态、关联 Coding 对话和“交给 Coding”。
- 学习专题是 CVE 内的次级入口，只保存标题、简介、CVE 列表和关联对话。
- “我的漏洞披露提交”暂缓，不进入本轮。

### 4. 安全工具接入 Coding

| 阶段 | 项目 |
| --- | --- |
| 优先接入 | capa、本机安装的 CodeQL、Taskflow 中可复用的 CodeQL MCP |
| 下一步 | Shannon 外部 Worker |
| 后续连接 | Strix、用户已有 CAPEv2、用户已有 Assemblyline |
| 学习或评测 | CAI、ARTEMIS、AgentRE-Bench、Agentic SOC |
| 不进入产品 | BoxPwnr、PentAGI |

工具只在 Coding 中提供能力，CTF/CVE 不复制工具面板或 Agent Loop。每项接入前按上游授权、
权限范围和真实任务重新判断。

### 5. GitHub 内测账户

- 使用 Cloudflare Worker、D1 和 GitHub OAuth 在系统浏览器完成登录；只有邀请用户可以进入内测。
- 登录后左上角显示用户头像；资料允许修改头像、显示名称和一句介绍。
- 所有联系入口统一使用 `milksu@proton.me`。
- 独立私有后台仓库保存邀请、账户额度、管理员页面和账户 API；不放进桌面端仓库，也不向内测用户开放。
- Web 管理端、账户 API 和 D1 由一个 Cloudflare Worker 承载，桌面端只保存加密后的不透明会话；
  GitHub Client Secret 只进入 Worker Secret，不进入仓库或客户端。

### 6. 额度与模型来源

- 账户额度和用户自己的 API Key 是两个独立来源。
- 默认账户额度优先、个人 Key 备用；用户可以调整顺序和自动切换方式。
- Coding 中的临时选择只影响当前对话，设置页保存全局默认。
- 个人 Key 只留在本机；账户额度由私有后台管理。MilkSU Admin 不保存或转发任何模型 Key。
- 账户模型使用 [TokenFlux Team](https://docs.tokenflux.dev/docs/tokenflux/team.html)：管理员邀请成员，
  成员在 TokenFlux 创建自己的团队 Key，再保存在本机凭据库；管理员只管理成员、额度和停用状态，
  看不到成员 Key 明文。
- 自动切换只允许发生在模型尚未输出、也未执行工具之前；已经产生内容或外部效果后必须原地报错，
  不能换来源重放同一回合。
- TokenFlux 的真实余额与消费明细、硬限额和同步延迟在接入真实团队后实测；没有可靠结果前，后台
  人民币流水只作为 MilkSU 内测预算账本，不伪装成 TokenFlux 的实时账单。
- 管理后台支持邀请、暂停访问、初始赠送和带原因的额度增减，Bug 奖励进入同一流水。

### 7. 收口

- 每个纵切使用现有测试和一项真实用户任务验收，不把按钮或模拟数据当完成。
- 从干净提交构建 Beta，在设置页核对 branch、完整 commit 和 tracking ID 后再做原生 UI 回归。
- CTF、CVE、个人资料、登录和模型来源全部通过后，才更新正式 App 和 Current 文档。

## 本轮不做

- 自动项目管理、自动改变 CTF/CVE 状态。
- 把 Coding 产物复制成 CTF/CVE 的结构化展示系统。
- 连续打卡、积分、排行榜和公开个人主页。
- 漏洞披露提交追踪、自动联系厂商或自动提交漏洞。
- 第二套通用 Agent Harness。

## 附录：决策问答记录

这里保存本轮连续确认的结果。问题经过压缩，不逐字重复聊天；后续 Agent 仍需按当前代码和
仓库规范决定实现细节。

| # | 核对的问题 | 已确认答案 |
| --- | --- | --- |
| 1 | CTF/CVE 更像个人记录还是任务入口？ | 两者并重，偏个人记录。 |
| 2 | 是否建立自动选题或推荐模块？ | 不建立；用户可以直接问 Coding。 |
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
| 13 | 每日挑战如何选择？ | 当天稳定、排除已完成题目，允许用户主动换题。 |
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
| 26 | 谁能登录内测？ | 受邀用户；代码仓库权限和账户额度分开管理。 |
| 27 | 管理系统放在哪里？ | 独立私有仓库 `/Users/milksu/code/milksu-admin`，包含 Web 管理前端和 API 后端。 |
| 28 | 额度如何表示和奖励？ | 直接显示人民币余额；支持初始赠送、Bug 奖励和带原因的增减流水。 |
| 29 | 账户额度与个人 API Key 如何共存？ | 两者都可用、可排序；默认账户额度优先，个人 Key 备用，Coding 可临时选择。 |
| 30 | TokenFlux、CVE 披露和联系入口如何处理？ | TokenFlux 明细与硬限额先实测；披露追踪暂缓；联系统一为 `milksu@proton.me`。 |
| 31 | 全局侧栏如何避免切换页面时忽大忽小？ | 固定使用窄栏；Coding 会话历史默认收起，需要时由一个按钮打开浮层。头像裁切为圆形。 |
