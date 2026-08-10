# 核心架构：可验证安全任务运行时

> **文档状态：Target architecture。核心原则仍有效；“当前实现”以
> [当前架构快照](/architecture/)为准，当前任务只以
> [当前开发目标](/developer/current-objectives)为执行契约。**
>
> 日期：2026-07-19
>
> 本文形成于架构重启阶段。固定 `taskType`、模型直写安全面板、Engagement 红队模型和通用
> 子代理原型已经删除；其后的 CTF、Coding、Browser Judge、Memory 与 Eval 实现不在本文的
> 原始“当前代码”叙述中。

## 产品与运行时的一句话定义

MilkSU 是一个**一站式网络安全 AI 学习客户端**；它的技术核心是**可验证的安全学习任务运行时与用户控制面**。通用 Coding Agent、专用安全 Agent 和确定性工具只在明确授权的 CTF、漏洞研究与攻防训练环境中执行 Security Learning Job，并把每一步转化为可恢复的状态、可追溯的证据、由外部 Evaluator 判定的领域结果和可观察的人类学习结果。

它不是“没有上下文限制的 Codex”，也不从零重新实现模型调用、Planner、ReAct Loop、上下文压缩或多 Agent 聊天系统。MilkSU 可以嵌入或小范围改造 Pi、Codex 开源核心等成熟 Coding Agent Engine，但必须自己拥有 Security Harness 的角色状态、环境、证据、评测、恢复和教学语义。

它也不是任意目标的通用互联网扫描器、自动渗透服务或隐蔽攻击编排器。学习定位必须由默认能力、授权范围、审批、速率、证据和发布方式共同成立，不能只改首页文案。详细边界见 [ADR-0004：学习产品、能力与开源发布边界](/developer/adr/0004-learning-product-and-release-boundary)。

## 可交互架构视图

- [MilkSU 当前系统架构规格](/architecture/generated/milksu-current-system.architecture.json)：生成时的 Coding 主链、
  CTF 证据闭环、持久化和 NYU safe-static Eval 边界。
- [2026-07-31 M3 System Architecture 历史规格](/architecture/milksu-system.architecture.json)：
  保留当日桌面进程、PI Sidecar、CTF Runtime、Browser Bridge 和 Lab 实验边界，不代表当前发布状态。
- [MilkSU CTF Solve Loop 规格](/architecture/ctf-solve-loop.workflow.json)：从选题、读取材料、预算内解题，到候选闸门、权威 Judge 回执与训练复盘。

这些图由固定版本 Archify 生成。仓库只保存可审阅的 JSON 规格；交互式 HTML 由 Coding
的“架构图”动作按需生成、校验并在右侧预览，不作为稳定文档入口，也不提交到 Git。
需要保留视觉验收证据时只提交一张最终截图。带日期的规格是历史快照；无日期的“当前系统”
规格随事实审计更新。

## 为什么需要重启

早期架构从界面和 Agent Loop 出发：先有聊天、任务类型、面板、Skill 和子代理，再设想它们可以承载安全工作。行业项目调研表明，真正可用的安全 Agent 通常已经拥有自己的工作流、环境、工具链和状态模型。MilkSU 如果继续从通用对话框向外堆功能，只会得到一个更弱的 Coding Agent 外壳。

新的设计顺序必须反过来：

1. 先定义一类安全任务怎样才算成功。
2. 再定义完成它需要的环境、证据、允许的副作用和恢复语义。
3. 然后让选定的可扩展 Agent Engine、外部安全 Agent 或确定性工具执行；通用 Loop 优先复用成熟开源实现。
4. 最后才决定用 Desktop、CLI、API 或报告怎样展示。

## 核心对象模型

聊天不是系统的事实来源。MilkSU 的最小事实模型如下：

```text
Engagement
  └─ Job
      ├─ Attempt
      │   └─ Step
      │       ├─ Action
      │       ├─ Observation
      │       ├─ Artifact
      │       └─ Effect
      ├─ Evidence
      ├─ Evaluation
      └─ Outcome
```

| 对象 | 人话解释 | 必须回答的问题 |
| --- | --- | --- |
| `Engagement` | 一次获得授权的学习或研究范围 | 谁授权、可以碰什么、学习目标是什么、何时到期、数据怎样保留？ |
| `Job` | 一个有明确结果的安全任务 | 目标是什么、使用哪个 Role Package、怎样才算完成？ |
| `Attempt` | 在固定配置下的一次尝试 | 使用哪个 Agent Engine、模型、环境版本、预算和随机种子？ |
| `Step` | 可恢复的最小推进单元 | 这一步想验证什么、执行了什么、观察到什么？ |
| `Action` | 对工具或环境的结构化调用 | 权限、参数、副作用和幂等键是什么？ |
| `Observation` | 工具或目标返回的原始事实 | 原始输出在哪里、何时得到、是否完整？ |
| `Artifact` | 可保存和复用的产物 | PoC、补丁、流量、样本、日志或报告文件在哪里？ |
| `Effect` | 对外部世界造成的变化 | 创建、修改、删除或发送了什么，怎样清理或回滚？ |
| `Evidence` | 支撑一个结论的证据引用 | 哪些 Observation/Artifact 能证明该结论？ |
| `Evaluation` | 独立判分结果 | 哪个 Evaluator、哪个版本、依据什么给出 pass/fail/score？ |
| `Outcome` | Job 的最终状态 | 成功、失败、部分完成、人工复核还是无法判定？ |

`Conversation` 只能作为人与 Agent Engine 的交互记录，不能替代上述对象。

## 不可破坏的架构约束

### 1. 成功不能由模型自报

模型输出“已拿到权限”“漏洞存在”或“补丁有效”都只是候选结论。Job 只有在以下一种条件成立时才能结束为成功：

- 外部 Judge 接受结果；
- PoC 在指定环境中稳定复现；
- 补丁阻断 PoC 且回归测试通过；
- 目标状态、日志、沙箱或人工签名提供了规定证据。

### 2. 证据必须先于摘要保存

正确顺序是：

```text
执行 Action
  -> 保存 Observation / Artifact
  -> 记录 Effect
  -> 提交 Step checkpoint
  -> 再让 Agent Engine 解释和规划
```

这样模型超时、切换或上下文压缩都不会让已经发生的事实消失。

### 3. 任务状态不能只存在于上下文

Agent Engine 可以重建上下文，但不能拥有唯一真相。攻击路径、案件状态、实验树、PoC、补丁、IOC 和披露状态都必须由 Role Package 投影到持久对象。

### 4. 副作用必须可识别

每个可能改变外部系统的 Action 必须声明：

- `effect_class`：会创建、修改、删除、发送还是获取权限；
- `idempotency_key`：重试时怎样避免重复执行；
- `cleanup`：完成或失败后怎样清理；
- `approval`：是否需要人工批准；
- `scope_check`：如何证明目标仍在授权范围内。

### 5. Agent Engine、模型和工具都可替换

核心契约不得依赖 Pi 的消息格式、Codex 的 rollout、Claude Code 的 session 或某个 MCP schema。它们通过 Adapter 进入系统。

## 六层架构

```text
L1  Desktop Surface
    macOS first / Windows later
                 │
L2  Role Packages
    Red / Blue / CTF / AppSec / Malware / Vulnerability Research
                 │
L3  Capability Packages
    Source / Web / Network / Binary / Mobile / Forensics / Fuzzing
                 │
L4  Shared Security Runtime
    Job / Environment / Evidence / Effect / Evaluator / Trace / Recovery
                 │
L5  Agent Engine and Tool Executors
    Embedded Pi/Codex Core / Model Providers / External Agent Runtimes / Deterministic Tools

L6  Cross-cutting Agent Integrity
    Scope / Provenance / Sandbox / Credential / Approval / Egress / Supply Chain
```

### L1：桌面交互表面

第一阶段产品只有 macOS 桌面客户端，后续再评估 Windows；不提供 Web 产品、GraphQL 或公开 HTTP API。Electron/Chromium 承载 Vue 产品表面和会话隔离的内置浏览器；受限 Preload 与本地 JSONL RPC 把 UI 连接到受管 Go application service。loopback 只用于明确授权的 Browser Bridge、限定单一 Target 的 CDP Proxy 或其他本地进程协议，不构成公开 HTTP API。L1 负责：

- 创建和查看 Engagement/Job；
- 选择 Role Package、环境、Agent Engine、模型与预算；
- 批准高风险 Action；
- 查看 Evidence、Effect、Evaluation 和成本；
- 暂停、恢复、比较和导出 Attempt。

L1 还负责桌面产品区别于纯 TUI 的三类可见执行表面：

- MilkSU 管理的“浏览器”，让用户与 Agent 共用会话隔离的 Chromium 页面；
- Browser Use，把用户真实浏览器中明确选择的单个标签页作为可撤销 Scope；
- Computer Use，把明确选择的外部 App / PID / Window 作为可撤销 Scope。

它们不是三个 Agent Engine，也不是同一个“控制电脑”总开关。L1 展示对象、授权、生命周期、
进度、证据与停止动作；L3 Adapter 执行动作；L4/L6 继续判定领域事实和安全边界。面板折叠或页面
切换只是显示状态，不得隐式终止或扩大已授权 Session。

L1 不拥有任务真相。即使不启动桌面 UI，同一 Job 的核心逻辑仍应能由 Go 契约测试或内部开发命令完整运行；这不等于第一阶段要发布 CLI/API 产品。

### L2：Role Package

Role Package 定义“这类任务怎样才算赢”，至少包含：

```yaml
id: ctf.challenge
version: 1
job_input_schema: ...
state_projection: ...
required_capabilities: [web, binary]
allowed_effects: [network_probe, local_file_write]
evidence_requirements: ...
evaluator_bundle: ...
integrity_requirements: ...
benchmark_cases: ...
ui_views: ...
```

角色的差异不靠不同 system prompt，而靠不同的长期状态、证据契约与 Evaluator：

| Role | 主要状态 | 典型 Evaluator |
| --- | --- | --- |
| Red | Scope、资产、身份、凭据、攻击路径、Effect | 权限证明、目标状态变化、可复现影响 |
| Blue | Case、时间线、Evidence Graph、竞争假设、处置状态 | 检测命中、人工复核、遏制与恢复结果 |
| CTF | Challenge、Experiment Tree、Snapshot、失败分支 | Flag Judge |
| AppSec | Source-to-sink、Hypothesis、PoC、Patch、Regression | PoC 与测试套件 |
| Malware | Sample、Behavior、Infrastructure、IOC、检测规则 | 沙箱、规则命中、人工复核 |
| Vulnerability Research | Version、Crash、Root Cause、Exploitability、Disclosure | 可重复触发、根因和影响证据 |

### L3：Capability Package

Capability Package 定义“怎样调用一种技术”，而不是“任务是否成功”。每个包至少声明：

- Tool/CLI/API/MCP Adapter；
- 输入输出 schema 与 parser；
- 运行环境和版本；
- 所需权限、凭据与网络范围；
- 会产生的 Artifact 和 Effect；
- 超时、取消、清理和健康检查；
- 适用 Role 和已知限制。

`Binary`、`Web`、`Network`、`Mobile`、`Forensics`、`Fuzzing` 和 `Source/Code Audit` 都是共享能力。一个包可以服务多个 Role，也不能自行把 Finding 标记为已验证。

Browser Use 与 Computer Use 也只是这里的执行能力，不是新的 Role 或 Agent Engine。用户通过聊天文字、附件、截图、本地目录、浏览器页面、远程连接或本地 Lab 发起任务时，统一 Challenge Intake 必须先保存原始材料、provenance 和授权，再交给 CTF Role。第三方浏览器/桌面项目的候选、固定版本和准入条件见 [Challenge Intake、Browser Use 与 Computer Use](/developer/challenge-intake-and-automation)。

Composer 中的 `/` 或“+”只选择这些 Capability，不拥有执行语义：Goal/Plan 改变任务状态，
产品 UI 中的“浏览器”和 MCP 打开既有管理面，Browser/Computer Scope 与 Pi Skill 先成为可删除状态，发送后才由
Runtime 校验和展开。安全工具 MCP 也必须先在 Coding 以固定版本、最小权限和真实任务完成准入，
再作为 Capability Package 迁入 CTF/CVE；连接一个 Server 不等于建立领域 Finding 或 Judge 结果。

### L4：Shared Security Runtime

这是 MilkSU 自己必须稳定拥有的部分：

- **Admission**：校验 Engagement、Scope、Package 和资源；
- **Environment Manager**：创建、连接、快照、重置和销毁环境；
- **Job/Attempt Scheduler**：运行、预算、并发、取消和重试；
- **Action Gateway**：Capability 解析、Policy、审批和执行；
- **Event Store**：追加保存 Step、Observation、Effect 和状态变化；
- **Artifact/Evidence Store**：保存原始材料、哈希、来源与引用关系；
- **Evaluator Runner**：在受控环境中执行版本化 Judge；
- **Recovery Engine**：从已提交 Step 恢复，避免重复副作用；
- **Projection API**：为 Role 状态、UI、报告和 benchmark 提供只读投影。

L4 驱动安全任务状态和事实提交，但不应该重新发明模型的通用规划能力。通用会话、模型调用、上下文压缩和 Tool Loop 由 L5 的成熟 Agent Engine 提供。

M1 按 [Runtime v1alpha1](/developer/runtime-v1alpha1) 实现确定性的 Walking Skeleton，用 Fake Engine/Capability/Environment/Evaluator 验证事实链和恢复语义。M2-A 已在同一 Runtime 上增加通用 `RoleFact` 与 CTF Projection，并用独立 Pi Security Adapter、真实模型、类型化 Capability 和 Flag Judge 跑通离线单题；实现边界见 [ADR-0003](/developer/adr/0003-ctf-vertical-slice)。

Environment Manager 也不能退化成让模型自由执行 `docker compose`。靶场由
`LabSourceAdapter + LabPackage + EnvironmentProvider` 确定性管理，Agent 只能通过类型化工具
请求生命周期动作；Readiness 与 Judge 分开。详细契约见
[CTF Labs 顶层与详细设计](/architecture/ctf-labs-design)。

### L5：Agent Engine and Tool Executors

L5 首先区分“内嵌基座”和“外部完整运行时”。两者都可能来自 Codex 或其他 Coding Agent，但集成深度不同：

1. **Embedded Agent Engine**：优先通过 SDK、library 或稳定服务协议复用 Pi、Codex 开源核心等成熟实现的模型接入、Session、Compaction、通用 Tool Loop 和事件；MilkSU 在其上实现 Security Harness。先扩展，必要时才维护小范围 fork。
2. **Model Provider**：由 Engine 调用云端或本地模型 API。换模型不应改变 Role、Evidence 或 Evaluator。
3. **External Agent Runtime**：用户已有的 Codex CLI、Claude Code，或 PentAGI、CAI、Shannon、Strix 等完整产品以原版 Harness 运行；MilkSU 只输入有边界的 Attempt 并归一化事件和结果。
4. **Deterministic Tool Executor**：CodeQL、Burp、Ghidra、Fuzzer、SIEM 查询等直接作为 Capability 执行，不再套一层伪 Agent。

更换内嵌 Engine 或选择外部 Runtime 是运行配置，不是修改核心领域模型。MilkSU Security Harness 是 L2–L6 的组合，不能把它缩写成某个模型或某个 CLI。

### L6：Cross-cutting Agent Integrity

完整性轨道保护的是 Agent、用户数据和执行边界，不等于安全任务本身。它横切所有层：

- Engagement scope 与 Rules of Engagement；
- 不可信内容的 provenance 和 taint；
- 最小能力授权与凭据租约；
- 沙箱、网络出口和文件系统边界；
- MCP、Skill、Package 和工具供应链；
- Action 审批、速率和预算；
- 机密数据外传防护；
- 可审计 PolicyDecision。

不同 Job 根据真实风险选择要求。普通隔离 CTF 与读取生产日志的蓝队任务不会共享同一套威胁假设。

## 一次 Job 的标准执行流程

```text
1. Admit
   校验授权、Role Package、输入 schema、预算和完整性要求

2. Prepare
   创建/连接 Environment，解析 Capability 与 Agent Engine

3. Start Attempt
   固定模型、工具、环境、Package 和 Evaluator 版本

4. Propose
   Agent Engine 根据结构化状态提出下一 Action 或结束候选

5. Gate
   校验 scope、capability、policy、approval、预算和幂等键

6. Execute and Commit
   执行 Action，先保存 Observation/Artifact/Effect，再提交 Step

7. Evaluate
   在规定时机运行增量或最终 Evaluator

8. Continue / Finish
   Agent Engine 继续探索，或由 Evaluation 产生 Outcome

9. Cleanup
   执行清理、撤销凭据租约、保存最终证据与成本
```

## 首个可验证纵切

重启后的第一条纵切选择 **CTF Role Package**，不是因为 CTF 是最终主要市场，而是因为它最容易验证架构是否真实成立：

- 环境可创建和重置；
- Flag Judge 是独立 Evaluator；
- Attempt 可以重复运行并计算 `success@N`；
- 底层 Agent Engine 或 Model Provider 可以替换，外部 Agent Runtime 也能作为对照运行；
- 失败轨迹、成本和恢复行为可以直接比较。

与 CTF 同批设计的第二个角色是 **Vulnerability Research Role Package**：`Target/Version -> Attack Surface -> Hypothesis -> Experiment/Fuzz -> Reproduction -> Root Cause -> Exploitability -> Disclosure`。CTF 先验证边界清楚的 Judge 与可重置环境；Vuln 再验证开放式探索、长期假设、Crash/PoC 证据和人工复核。AppSec 保留为后续角色，不再是第二条主线。

这两个角色都必须同时支持 `Coach / Copilot / Delegate` 三种协作方式。任务除了安全领域的 `Domain Outcome`，还保存 `Human Outcome`：用户使用过哪些提示、是否独立完成关键步骤、能否解释根因或迁移到变体。详细契约见[Role Packages](/developer/role-packages)。

如果 CTF 与 Vuln 两条链都不能在相同 Agent Engine、模型、工具和预算下优于原版 Coding Agent 基线，MilkSU 应收缩为 benchmark、Adapter 和证据工具，而不是继续扩张平台。

## 评测与停止条件

每个核心模块都必须在相同模型、工具、环境和预算下，与最小通用 Agent 及成熟通用 Agent 对照：

- `success@1`、`success@N`；
- 单次成功成本与完成时间；
- 无证据成功率和错误判定率；
- 中断恢复率与重复 Effect 次数；
- 结果复现率；
- 人工介入次数和高风险审批质量。

如果新增层不能改善这些指标，也不能接入基线无法使用的环境，应将其降级为外围 Package、Skill、MCP 或研究实验。

## 重启阶段的代码边界（历史基线）

架构重启已经删除固定 `taskType`、`TaskState`、`panel_update`、通用子代理、仓库内 Skill 路由和红队专用 Engagement 数据模型。M0 保留 UI 外壳、会话存储、进程生命周期、流式工具事件、设置界面和临时 Pi 对话桥；M1 增加 Go 实现的追加事件、Artifact、Projection、独立 Evaluator 与恢复骨架；M2-A 增加 CTF Role Projection、独立 Pi Security Adapter、三种类型化动作、本地 Judge 与独立 CTF 面板。

这些宿主能力不能充当 Runtime 的领域模型。2026-07-19 的临时后续顺序已经失效并移除；
当前任务只以 [当前开发目标](/developer/current-objectives) 为准。

Pi 的临时聊天桥不是 L5 接口标准；M0 实跑后 Pi SDK 已选为首要 Embedded Agent Engine，Codex app-server 保留为对照与可能的 External Agent Runtime。M2-A 已通过独立 Security Adapter 依赖 Pi SDK，没有 fork 上游；新增 Role 仍应优先扩展窄 Adapter。决策见 [ADR-0001](/developer/adr/0001-agent-engine-and-desktop-boundary)、[ADR-0002](/developer/adr/0002-runtime-facts-and-recovery) 与 [ADR-0003](/developer/adr/0003-ctf-vertical-slice)。

当前实现已经继续前进到真实 NSSCTF Judge、CTF 单题工作区、训练记忆、Pi Coding 交付与
NYU safe-static 内部评测。本文继续负责不可破坏的对象和分层原则，不再负责发布状态。
