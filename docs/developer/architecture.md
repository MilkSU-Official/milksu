# 核心架构：可验证安全任务运行时

> **状态：重启后的目标架构，优先级仅次于[安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)。**
>
> 日期：2026-07-19
>
> 当前仓库只保留 Tauri、Pi 聊天、配置和通用 UI 作为可复用宿主壳。固定 `taskType`、安全面板、Engagement 红队模型、模型直写面板和通用子代理原型已经删除，不能成为本文的约束。

## 一句话定义

MilkSU 是一个**可验证的安全任务运行时与用户控制面**：它让通用 Coding Agent、专用安全 Agent 和确定性工具在受约束的真实环境中执行 Security Job，并把每一步转化为可恢复的状态、可追溯的证据和由外部 Evaluator 判定的结果。

它不是“没有上下文限制的 Codex”，也不是重新实现一个 Planner、ReAct Loop 或多 Agent 聊天系统。

## 为什么需要重启

早期架构从界面和 Agent Loop 出发：先有聊天、任务类型、面板、Skill 和子代理，再设想它们可以承载安全工作。行业项目调研表明，真正可用的安全 Agent 通常已经拥有自己的工作流、环境、工具链和状态模型。MilkSU 如果继续从通用对话框向外堆功能，只会得到一个更弱的 Coding Agent 外壳。

新的设计顺序必须反过来：

1. 先定义一类安全任务怎样才算成功。
2. 再定义完成它需要的环境、证据、允许的副作用和恢复语义。
3. 然后选择通用 Worker、外部安全 Agent 或确定性工具执行。
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
| `Engagement` | 一次获得授权的工作范围 | 谁授权、可以碰什么、何时到期、数据怎样保留？ |
| `Job` | 一个有明确结果的安全任务 | 目标是什么、使用哪个 Role Package、怎样才算完成？ |
| `Attempt` | 在固定配置下的一次尝试 | 使用哪个 Worker、模型、环境版本、预算和随机种子？ |
| `Step` | 可恢复的最小推进单元 | 这一步想验证什么、执行了什么、观察到什么？ |
| `Action` | 对工具或环境的结构化调用 | 权限、参数、副作用和幂等键是什么？ |
| `Observation` | 工具或目标返回的原始事实 | 原始输出在哪里、何时得到、是否完整？ |
| `Artifact` | 可保存和复用的产物 | PoC、补丁、流量、样本、日志或报告文件在哪里？ |
| `Effect` | 对外部世界造成的变化 | 创建、修改、删除或发送了什么，怎样清理或回滚？ |
| `Evidence` | 支撑一个结论的证据引用 | 哪些 Observation/Artifact 能证明该结论？ |
| `Evaluation` | 独立判分结果 | 哪个 Evaluator、哪个版本、依据什么给出 pass/fail/score？ |
| `Outcome` | Job 的最终状态 | 成功、失败、部分完成、人工复核还是无法判定？ |

`Conversation` 只能作为人与 Worker 的交互记录，不能替代上述对象。

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
  -> 再让 Worker 解释和规划
```

这样模型超时、切换或上下文压缩都不会让已经发生的事实消失。

### 3. 任务状态不能只存在于上下文

Worker 可以重建上下文，但不能拥有唯一真相。攻击路径、案件状态、实验树、PoC、补丁、IOC 和披露状态都必须由 Role Package 投影到持久对象。

### 4. 副作用必须可识别

每个可能改变外部系统的 Action 必须声明：

- `effect_class`：会创建、修改、删除、发送还是获取权限；
- `idempotency_key`：重试时怎样避免重复执行；
- `cleanup`：完成或失败后怎样清理；
- `approval`：是否需要人工批准；
- `scope_check`：如何证明目标仍在授权范围内。

### 5. Worker 和工具都可替换

核心契约不得依赖 Pi 的消息格式、Codex 的 rollout、Claude Code 的 session 或某个 MCP schema。它们通过 Adapter 进入系统。

## 六层架构

```text
L1  Desktop / CLI / API / CI
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
L5  Workers and Tool Executors
    Codex / Claude Code / Pi / External Security Agents / Deterministic Tools

L6  Cross-cutting Agent Integrity
    Scope / Provenance / Sandbox / Credential / Approval / Egress / Supply Chain
```

### L1：交互与集成表面

Desktop、CLI、API 和 CI 只负责：

- 创建和查看 Engagement/Job；
- 选择 Role Package、环境、Worker 与预算；
- 批准高风险 Action；
- 查看 Evidence、Effect、Evaluation 和成本；
- 暂停、恢复、比较和导出 Attempt。

L1 不拥有任务真相。删除桌面 UI 后，同一 Job 仍应能通过 CLI 或 API 完整运行。

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

L4 可以调度 Worker，但不应该重新发明模型的通用规划能力。

### L5：Workers and Tool Executors

MilkSU 支持三种执行关系：

1. **General Worker Adapter**：Codex、Claude Code、Pi、OpenCode 等负责分析、规划、编码和普通工具使用。
2. **External Security Worker Adapter**：PentAGI、CAI、Shannon、Strix 等完整产品作为黑盒或半结构化 Worker，MilkSU 只负责输入 Job、约束环境并收回 Evidence/Outcome。
3. **Deterministic Tool Executor**：CodeQL、Burp、Ghidra、Fuzzer、SIEM 查询等直接作为 Capability 执行，不再套一层伪 Agent。

选择 Worker 是运行配置，不是修改核心领域模型。

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
   创建/连接 Environment，解析 Capability 与 Worker Adapter

3. Start Attempt
   固定模型、工具、环境、Package 和 Evaluator 版本

4. Propose
   Worker 根据结构化状态提出下一 Action 或结束候选

5. Gate
   校验 scope、capability、policy、approval、预算和幂等键

6. Execute and Commit
   执行 Action，先保存 Observation/Artifact/Effect，再提交 Step

7. Evaluate
   在规定时机运行增量或最终 Evaluator

8. Continue / Finish
   Worker 继续探索，或由 Evaluation 产生 Outcome

9. Cleanup
   执行清理、撤销凭据租约、保存最终证据与成本
```

## 首个可验证纵切

重启后的第一条纵切选择 **CTF Role Package**，不是因为 CTF 是最终主要市场，而是因为它最容易验证架构是否真实成立：

- 环境可创建和重置；
- Flag Judge 是独立 Evaluator；
- Attempt 可以重复运行并计算 `success@N`；
- Worker 可以在 Codex、Claude Code、Pi 和外部 Agent 之间替换；
- 失败轨迹、成本和恢复行为可以直接比较。

与 CTF 同批设计的第二个角色是 **Vulnerability Research Role Package**：`Target/Version -> Attack Surface -> Hypothesis -> Experiment/Fuzz -> Reproduction -> Root Cause -> Exploitability -> Disclosure`。CTF 先验证边界清楚的 Judge 与可重置环境；Vuln 再验证开放式探索、长期假设、Crash/PoC 证据和人工复核。AppSec 保留为后续角色，不再是第二条主线。

这两个角色都必须同时支持 `Coach / Copilot / Delegate` 三种协作方式。任务除了安全领域的 `Domain Outcome`，还保存 `Human Outcome`：用户使用过哪些提示、是否独立完成关键步骤、能否解释根因或迁移到变体。详细契约见[Role Packages](/developer/role-packages)。

如果 CTF 与 Vuln 两条链都不能在相同 Worker、工具和预算下优于最小基线，MilkSU 应收缩为 benchmark、Adapter 和证据工具，而不是继续扩张平台。

## 评测与停止条件

每个核心模块都必须在相同模型、工具、环境和预算下，与最小通用 Agent 及成熟通用 Agent 对照：

- `success@1`、`success@N`；
- 单次成功成本与完成时间；
- 无证据成功率和错误判定率；
- 中断恢复率与重复 Effect 次数；
- 结果复现率；
- 人工介入次数和高风险审批质量。

如果新增层不能改善这些指标，也不能接入基线无法使用的环境，应将其降级为外围 Package、Skill、MCP 或研究实验。

## 当前代码边界

架构重启已经删除固定 `taskType`、`TaskState`、`panel_update`、通用子代理、仓库内 Skill 路由和红队专用 Engagement 数据模型。当前代码只保留 UI 外壳、会话存储、进程生命周期、流式工具事件、设置界面和临时 Pi 对话桥。

这些宿主能力不能充当 Runtime 的领域模型。后续顺序固定为：

1. 在无 UI 的契约测试中定义 Job、Attempt、Step、Evidence、Effect、Evaluation 和 Package；
2. 跑通 CTF 的 Environment、Experiment、Artifact 与 Judge 纵切；
3. 冻结 Vuln 的 Attack Surface、Hypothesis、Crash、Reproduction、Root Cause 与 Disclosure 状态；
4. 再为 CTF 与 Vuln 分别增加只读投影事实的角色面板。

Pi 只是暂时保留下来的对话 Worker，不是 L5 接口标准。行业依据见[开源项目基线与架构启示](/developer/industry-baseline)。
