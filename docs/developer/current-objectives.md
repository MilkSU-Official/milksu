# 当前开发目标

> 状态：当前唯一执行契约
>
> 生效日期：2026-08-02
>
> 这是一份工作范围与验收顺序，不是发布说明，也不用于提前宣称能力完成。
>
> **持久目标入口：** 每次新会话、任务移交或上下文压缩后，必须先重新读取本文件和当前
> 仓库状态。不得用对话摘要缩小这里记录的范围，也不得把部分 smoke 当作整体完成。

## 事实源与执行原则

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执优先于旧对话与文档。
2. 每次开始工作先读取仓库状态，不根据历史计划重复已经完成的功能。
3. 通用 Coding 能力优先复用固定版本的 Pi、成熟 Extension、Skill、MCP 和平台 CLI。
4. MilkSU 自研集中在 CTF Evidence、Judge、Memory、教学和 Agent 协作。
5. 每个可交付纵切必须测试、审阅、提交并只推送到 MilkSU 自己的私有仓库。
6. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
7. Labs 与 CVE Research 保持暂停，不作为当前完成条件。
8. 从现在开始新增的代码不为尚未发布的临时设计增加迁移、双写或兼容分支，直接实现当前
   干净模型。已经工作的旧代码和既有 schema 不在功能开发中途返工；确需调整时集中到全部
   产品纵切完成后的最终收口，一次破坏性修改并重新执行完整回归。

## Pre-release 破坏性演进原则

MilkSU 当前没有需要承诺向后兼容的外部发行基线。后续开发固定遵守：

1. **新代码现在就写干净。** 新增领域模型、DTO、事件和数据结构直接表达当前设计，不为
   尚未发布的旧设想增加 fallback、双写、影子字段、临时 Adapter 或 Migration。
2. **不在纵切中途为清债而清债。** 已经工作的旧代码和旧 schema 若不阻碍当前功能正确性，
   继续保持回归，不打断 CTF、Memory、Runtime 和交付主线去做纯重构。
3. **确需修改旧设计时先登记，最后集中破坏性收口。** 在全部产品纵切与真实验收完成后、
   最终文档更新前，一次性删除不再需要的兼容代码、历史 schema 和过渡结构，不长期保留
   两套设计。
4. **开发数据不构成兼容承诺。** 最终收口可以要求显式重置 pre-release 本地数据；应用
   不能擅自删除数据，也不能读取、迁移、导出或记录 Provider Credential。
5. **收口不是只改代码。** 破坏性调整后必须从全新数据目录重新执行完整自动化、打包
   Sidecar、原生 App、恢复、六赛道、Memory 校准、Bench 和发行回归；失败项修复后重跑。
6. **最后才冻结和写文档。** 回归全部通过后再冻结首个外部 Beta schema/API baseline，
   从该版本起维护正式向前 Migration 与兼容承诺，并统一更新架构、里程碑、状态和发布说明。

## 1. Coding Agent 自举底座

Coding Agent 的北极星不是复制 Codex 的全部功能，而是能够安全地开发、验证、恢复并交付
MilkSU 自身。

### B1 · 自主修改

- 冷启动核对仓库、HEAD、工作区和项目指令；
- 规划并完成 Vue、Go、TypeScript 的普通跨文件修改；
- 运行测试、构建、修复失败并复验；
- Vue/Go 可应用 Code Action 通过真实验收；
- 跨文件 LSP Action 在不能完整审阅和原子应用时必须拒绝，不能部分写入；
- 已完成的超大 Diff 拒绝边界保持回归。

### B2 · 自主验证

- 预览工作区内普通 Markdown、HTML 和图片产物；
- HTML 使用隔离渲染、严格 CSP、禁网、路径和大小限制；
- Coding Browser 继续使用隔离 Profile 与逐次批准；
- Computer Use 使用用户可见会话、明确应用范围和逐次授权，用于验证 MilkSU 原生 App；
- Workspace Auto 不得隐式启用 Computer Use。

### B3 · 持续执行

- Pi 持久会话、上下文压缩、失败恢复和结构化移交不重复已经完成的工作；
- 原生 App 重启后核对后台任务、PID、端口、日志和长任务状态；
- 旧 PTY 可以明确结束，但不能伪装为可重连；
- 已失效的审批跨重启自动过期。

### B4 · 安全交付

- 文件与 Hunk Diff、stage、commit、push 保持回归；
- 托管平台 PR 在发布前展示仓库、分支、提交和目标并单独确认；
- 只允许当前明确授权的 MilkSU 私有远端；
- 不向引用的开源项目创建 PR。

### B5 · 规模化协作

- 单 Agent 自举通过后，再验证多 Agent 分工；
- 每个写入 Agent 使用独立 Git worktree；
- 主 Agent 负责审阅、冲突处理、集成、真实验收和最终交付；
- 只有真实任务证明并行有用时才保留，不以 Agent 数量作为完成指标。

最终验收是一次真实的 “MilkSU develops MilkSU”：在打包 MilkSU 中完成一个此前未实现的
Vue + Go 纵切，运行测试与原生 App，预览产物，中途重启并恢复，最后审阅、提交、推送并
经确认向 MilkSU 私有仓库创建 PR。

## 其余目标审查与调整

除 Coding Agent 外，其余目标也需要调整。总体方向没问题，但目前把“产品完成条件、真实
验收活动、内部研究、架构维护和正式发布”混在了一起。

总体收敛为四条主线：CTF 通用闭环、Memory 可信度、Runtime 评测、正式交付。架构拆分
作为这些主线的工程约束，不单独追求“清债完成”。

## 2. CTF 通用能力：保留，但改成六赛道验收

当前代码实际定义了六个能力轴：Web、Pwn、Reverse、Crypto、Forensics、Misc，而不是
五个；并且只有六个赛道都出现 Judge-verified 成功才会 Ready：
`internal/nssctf/catalog.go:474`、`internal/nssctf/catalog.go:686`。

因此目标调整为：

- Web、Pwn、Reverse、Crypto、Forensics、Misc 各至少一个真实 Judge-verified 闭环；
- Forensics 与 Misc 不再合并，否则和能力画像模型不一致；
- 一题成功只是通用能力 smoke，不得描述为整体 CTF 成绩；
- 为六题建立固定的回归清单，记录平台、题号、类别、材料类型和验收日期。

每题统一验收：

- 授权题面及材料；
- Solver 轨迹和 Checkpoint；
- 候选及依据；
- 平台 Judge 回执；
- 提示依赖和用户贡献；
- 中断/恢复；
- 复盘和训练证据。

Tool Builder 与 Strategist 不要求每题都调用，改为两个跨赛道场景：

- 至少一题自然卡关后，Solver 提交工具请求，Coding Agent 交付工具，Solver 使用结果
  继续；
- 至少一题在重复失败后，由 Strategist 使用独立会话复盘，提出不同路线，再交回 Solver
  验证。

这两条是产品协作能力验收，不是额外 Agent 数量指标。

## 3. 动态 Endpoint 与网络边界：提升为 CTF P0

这项必须在 Web/Pwn 真实扩样本之前完成。

当前精确的 `ctf_http` 和 `ctf_socket` 工具边界不错：HTTP 不跟随重定向，Socket 限制为
精确 `host:port`。但只要题目存在 origin/socket，通用 CTF Shell 的 Seatbelt 就会开放
整个网络，而不是只允许目标地址：`bridge-policy.js:330`。

因此真正的缺口不是“再显示一个 Endpoint 输入框”，而是：

- 页面或 Agent 发现的新 Endpoint 只能提出授权申请，不能自动加入 Scope；
- UI 展示协议、域名/IP、端口、来源和用途；
- 用户逐条确认后生成新的不可变 Scope；
- HTTP、TCP、SSH 分开授权；
- 动态 Endpoint 不自动继承平台 Cookie、Token 或浏览器会话；
- 通用 Shell 默认继续无网络；
- 复杂协议通过受控网络 broker/proxy，或每次明确批准的窄网络执行器；
- 不能因为存在一个授权 Origin 就让任意 Shell 访问整个互联网。

动态 Endpoint 和精确网络执行器合成一个纵切，不分两轮做。

## 4. Memory 与能力画像：保留并前置数据可信度

这是 MilkSU 的核心创新，必要性很高。但“积累数十次轨迹”不应是第一步，必须先修正数据
模型，否则真实训练只会积累错误归因。

当前问题是：

- `TrainingSignal` 只有提示数和独立步骤数，没有步骤作者和协作贡献；
- `realTrainingSignal` 直接把这些计入能力画像：`app.go:814`；
- delegate 模式下 Agent 解题和用户独立解题仍可能落入同一成功信号；
- Memory 的 Judge verification 能证明答案正确，但不能证明是谁完成了关键推理。

目标拆成三层。

### 第一层：证据归属

- `actor = user / agent / shared / imported`；
- `assistance = none / hint / copilot / delegated`；
- 用户独立步骤只能来自显式用户操作或用户确认的结构化记录；
- Agent 总结、推测和复盘文本不能自动变成用户能力事实；
- Judge 正确性与用户贡献度必须是两个独立维度。

### 第二层：画像与 Memory 分离

- Memory 表示“过去题目中可复用的经验”；
- Ability Profile 表示“有证据支持的用户能力”；
- Agent 代做的成功可以形成 Agent Memory，但不能等价提升用户能力；
- 提示依赖、独立完成和协作完成分别显示，不能压成一个模糊分数。

### 第三层：校准活动

第一轮采用 36 条分层样本：

- 6 个赛道；
- coach、copilot、delegate 三种协作方式；
- 每个组合至少两条轨迹。

36 不是神奇完成线，而是足以发现系统性误归因的第一轮矩阵。还要增加同知识点跨题召回
和无关题负对照。

验收指标包括：

- 模型猜测写入用户能力事实的次数必须为 0；
- delegate 成功不增加“独立完成”计数；
- 推荐理由能链接到具体 Judge、提示、步骤和失败记录；
- 当前题不召回自己的复盘；
- 相关旧题优先于同类别但无关的旧题；
- 删除/归档证据后推荐与画像同步变化。

## 5. NYU Runtime Bench：拆成两个 Bench

“完整 MilkSU Runtime 接 NYU 安全子集”有价值，但不是近期产品完成条件。它拆为：

### Runtime Reliability Bench

优先做，使用自建、安全、可复跑 fixture：

- 多轮规划；
- 文件读取；
- 普通开发命令；
- 工具调用；
- Sidecar/App 重启；
- 上下文压缩；
- 超时与取消；
- 成本和工具预算；
- 失败分类。

这是测 Harness，不需要借 NYU 题目，也不会产生虚假的 CTF 分数。

### NYU CTF Outcome Bench

等六赛道真实闭环稳定后再做：

- 只采用人工准入的安全子集；
- 复用正式 CTF Runtime、Evidence 和 Checkpoint，不能另造第二套 Runner；
- 记录 admission、工具面、成本、超时和恢复；
- 不运行未经审核的附件、服务或漏洞触发输入；
- 报告继续明确区分 attempted、completed 和 solved。

当前 safe-static 结果继续称为“Pi Runtime safe-static smoke”，不能称为完整 MilkSU CTF
成绩：`docs/developer/nyu-ctf-bench-eval.md:116`。

## 6. 架构债：保留，但不作为独立里程碑

这些拆分确实必要，因为热点已经很大：

- `CTFPage.vue`：3,021 行；
- `internal/browsercap/manager.go`：1,951 行；
- `bridge-policy.js`：2,417 行；
- `app.go`：1,352 行；
- `internal/ctf/service.go`：920 行。

不停止产品开发进行一次大规模纯重构，调整为“触碰即拆分”：

- 做 Endpoint/Memory UI 前拆 `CTFPage.vue` 对应区域；
- 修改网络和 Computer Use 前拆 `bridge-policy.js`；
- 扩平台 Judge/Browser 前拆 `internal/browsercap/manager.go`；
- 修改恢复语义前拆 CTF Runner/Recovery；
- `app.go` 只在相关纵切里继续把业务规则移到 Adapter/应用服务。

持续约束：

- Wails 只做桌面调用和 DTO；
- 领域层不依赖 Wails；
- Pi Runtime 不知道 NSSCTF/CTFshow 页面细节；
- 平台 Adapter 不决定学习成功或用户能力；
- 新功能不得继续给这些巨型文件增加新的职责。

## 7. 本地交付：拆成数据安全和正式发行两阶段

### Pre-release 最终数据收口

现有五个数据库的编号、事务、兼容检查与迁移前安全备份已经实现，功能纵切期间保持回归，
不把移除这些旧实现当作当前优先事项。

从现在开始：

- 新数据结构直接按当前领域模型设计，不为尚未发布的中间形态新增兼容层；
- 若一个纵切必须修改既有 schema，先完成不依赖兼容技巧的领域语义和测试，不用保留旧
  字段、影子表或双写来伪装完成；
- 所有破坏性的旧代码与 schema 简化集中到产品目标完成后、最终文档更新前一次执行；
- 最终收口允许显式重置 pre-release 开发数据，但不能自动删除本机数据，也不能读取、迁移
  或导出 Credential；
- 收口后从全新数据目录重跑完整自动化、原生 App、六赛道、Memory 校准、恢复和发行回归；
- 首个外部 Beta 以收口后的结构冻结正式 baseline，从此才承诺编号式向前 Migration 和
  版本升级兼容。

诊断入口已经存在，应从“未完成”中删除：`app/src/components-vue/SettingsPage.vue:229`。
剩余目标改为：

- 持久化的上次启动/异常退出标记；
- Sidecar、恢复、迁移和后台任务的脱敏日志；
- 崩溃后下次启动提供恢复/诊断入口；
- 不保存会话正文、工具原始输出或凭据。

### 正式发行，Release Candidate 阶段

Developer ID、公证、升级渠道很重要，但不阻塞当前功能迭代。现在默认允许 ad-hoc
签名 `-`：`scripts/package-sidecar.mjs:1277`。

只有准备外部 Beta/正式版时，将以下设为发布门禁：

- Developer ID Application 签名；
- hardened runtime 和 entitlements；
- Apple notarization 与 stapling；
- 签名升级包和升级源；
- 旧版本 → 新版本迁移；
- 升级失败回滚；
- 全新 macOS 用户、无开发工具机器安装；
- 离线/网络失败时的可理解降级。

尺寸目标具体化。当前最低窗口是 `1080×680`：`main.go:23`。先定义支持矩阵，再做 QA，
不使用模糊的“小窗口”。性能同样先记录启动时间、空闲内存、前端 chunk 和 App 体积基线，
再设回归阈值。

## 8. 文档：维持最后统一更新

这一条不需要调整。

开发过程中只保留：

- 测试输出；
- Judge 回执；
- 轨迹和 Checkpoint；
- 版本化验收记录；
- 必要 ADR。

不反复修改“已完成/当前成绩”声明。等六赛道、Memory 校准、自举 Coding Gate 和发行门禁
实际通过后，再统一更新架构、里程碑、状态和发布说明。

## 调整后的总体顺序

1. Coding Agent 自举门槛。
2. Memory 证据归属模型。
3. 动态 Endpoint 确认与窄网络执行器。
4. 六赛道真实 CTF 验收，其中包含一次 Tool Builder 和一次 Strategist 闭环。
5. 使用真实轨迹完成 Memory/推荐校准。
6. Runtime Reliability Bench。
7. NYU 安全子集 Outcome Bench。
8. 集中完成 pre-release 旧代码与 schema 的破坏性收口，并从全新数据目录完整回归。
9. 崩溃恢复、全新机器、签名、公证、升级和性能发布门禁。
10. 最后统一更新文档。

Labs 与 CVE 继续暂停，不进入上述任何完成条件。
