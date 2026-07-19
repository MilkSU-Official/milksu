# 开发计划：先跑通 CTF 与 Vuln

> 状态：当前实现主线
>
> 日期：2026-07-19

## 起步策略

MilkSU 不在“先造完整基础架构”和“先做一次性 Demo”之间二选一。我们采用**最小纵向骨架**：只实现足够支撑一个真实任务的公共契约，然后立即让真实模型、真实工具、真实环境和独立 Evaluator 连成闭环。

第一条纵切是 CTF，第二条是 Vulnerability Research（下文简称 Vuln）。只有两条纵切都用过的抽象，才有资格进入稳定的共享 Runtime。

MilkSU Security Harness 是默认运行方式，但“自己的 Harness”不等于从模型 API 开始重写通用 Agent Loop。我们会先评估 Pi SDK、Codex CLI 开源核心等成熟 Coding Agent Engine，尽量复用它们的模型接入、上下文压缩、会话、通用 Tool Loop 与流式事件，再在其上改造出由 MilkSU 掌握的安全任务状态、实验、证据、评测和人机协作。

直接运行用户已有的 Codex/Claude Code CLI 是另一种 External Agent Runtime；它与“把开源 Agent Engine 嵌入并改造成 MilkSU Harness”不是同一件事。

## MVP 的边界

第一个可用版本只承诺：

- macOS 单用户桌面客户端；
- macOS 桌面控制面优先采用 Go + Wails v2 + React/TypeScript；Agent Engine 可以保留其原生语言，通过明确的进程内或本地协议边界接入；
- SQLite 事件与状态存储，文件系统保存 Artifact；
- 一个经实跑选定的可扩展 Agent Engine、可替换 Model Provider 和 MilkSU Security Harness；
- 一个隔离的本地任务环境；
- 一个自动获取、启动、等待就绪、重置、停止和清理的 Lab Manager，用户不需要手动启动靶场；
- CTF Flag Judge 与 Vuln Reproduction Evaluator；
- CTF、Vuln 各自的最小面板；
- Coach、Copilot、Delegate 三种协作方式的最小闭环；
- 任务退出后可以恢复，事实不只存在于聊天上下文。

MVP 不做 Web 产品、GraphQL、PostgreSQL、微服务、多用户、Red/Blue/AppSec/Malware Role、通用工作流编辑器，也不把用户安装的 Codex/Claude Code CLI 作为默认运行方式。

## 里程碑

### M0 · Agent Engine 选型与工程起点

> 实现状态：已完成（2026-07-19）。Go/Wails/React 骨架、Pi/Codex 同题 Spike 和桌面结构化事件链均已实跑；决策与保留技术债见 [ADR-0001](/developer/adr/0001-agent-engine-and-desktop-boundary)。进入 M1 前仍按约定由用户确认模块边界。

目标：先决定 MilkSU 应在什么成熟通用 Harness 上做最小改造，避免因为偏爱某种语言而重写已经解决的问题。

- 用同一个微型 CTF 对 Pi SDK 和 Codex 开源核心/服务接口做两条 Spike；
- 比较模型与 Provider 可替换性、Tool 注册与拦截、Context/Compaction、Session/Resume、结构化事件、授权控制、嵌入方式、许可证、上游升级成本和 fork 差异；
- 优先验证“依赖/扩展即可完成”，其次才是维护小范围 fork；不接受长期大幅魔改上游；
- 记录 Agent Engine、桌面栈和进程边界 ADR；
- 将 L5 校准为“可改造 Agent Engine”，并把完整外部 CLI 运行方式与嵌入基座分开；
- 建立 Go module、包边界、测试和格式检查；
- 用 Wails v2 接管现有 React UI；是否保留 Pi Node runtime 由 Spike 结论决定；
- 明确桌面绑定只是 L1 Adapter，领域代码不依赖 Wails。

**完成标志**：两条 Spike 都留下可运行代码和比较记录；选出一个首选 Agent Engine 与备选方案；桌面应用可启动并能收到该 Engine 的结构化事件；仓库中不再存在两套相互竞争的产品主线。

### M1 · Walking Skeleton：可恢复的任务骨架

目标：在选定的 Agent Engine 上，用确定性 Fake Model/Fake Tool 验证最小安全事实链。

- 定义 `Job / Attempt / Step / Action / Observation / Artifact / Evidence / Effect / Evaluation / Outcome`；
- 定义追加式事件、SQLite Event Store 和只读 Projection；
- 建立 Artifact 目录、哈希和来源引用；
- 在不复制底层 Engine 接口的前提下，建立 MilkSU 的 `AgentEngine`、`Capability`、`Environment`、`Evaluator` 边界；
- 冻结 `LabPackage v1alpha1` 的最小来源、架构、Endpoint、Readiness、Reset、Judge 和 Security 字段；
- 让程序而不是 Agent 管理 Compose/OCI 生命周期；Agent 只能调用类型化的 `lab.start/reset/stop/submit`；
- 将 Go 事件实时推送到 React；
- 支持开始、取消、崩溃后恢复一个 Fake Job。

**完成标志**：用户能在桌面创建任务、看到 Step 流动，强制退出后重开仍能恢复；Evaluator 而不是模型决定 Outcome。

### M2 · CTF 可玩 MVP

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

**完成标志**：真实模型能从桌面完成一题；用户无论粘贴题面、上传文件/截图、选择本地目录、提供远程连接还是分享网页，都进入同一个完整 CTF Agent 闭环；本地环境由 MilkSU 自动启动、重置和清理，远程网站题不错误调用本地生命周期；在没有任何专用 API/CLI Adapter 的情况下，用户能登录一个未针对开发过的小众 CTF 网站，把题目、附件和目标交给 Agent，并由本地 Judge、网站页面响应或用户确认验证 Flag；用户可以在三种协作方式下介入，并从复盘看到“为什么这样解”；再次打开 Workspace 时可以继续下一题。更换输入通道、网站或本地 Lab 不能要求修改 CTF Role、Evidence 或教学闭环代码。

### M3 · Vuln Research 可用 MVP

目标：用第二类任务检验第一版抽象，避免把 CTF 的特殊性误写成通用 Runtime。

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

短期目标不是把七个里程碑一次设计完，而是尽快到达 **M2：您可以亲自和 CTF Agent 做完第一题**。M3 紧随其后，用 Vuln 任务检验我们是否真的做出了 Security Harness，而不是 CTF 专用脚本。
