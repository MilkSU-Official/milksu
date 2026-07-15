# 开发者架构

## 架构决策：控制面，而不是更弱的通用 Agent

MilkSU 的核心定位是**用户拥有的安全任务控制面**。Codex、Claude Code、Pi 和其他模型运行时属于执行平面；MilkSU 不以重写它们的推理能力为目标，而是负责模型之外仍需长期积累的部分：

- 真实环境与专用工具的稳定接入
- 可机器验证的成功条件与证据
- 跨运行持久化的状态、轨迹和工件
- 可恢复、可审计、可比较的执行
- 从真实任务结果形成的数据反馈闭环

这一区分是架构边界。状态机、checkpoint、模型路由、子代理和安全面板都是实现手段，不能仅凭“已经实现”就被称为竞争优势。

关于 Agent Security 与 Agent for Security 的区分、通用能力随 SOTA 扩张的集合模型，以及红队、蓝队、CTF、AppSec 的角色化闭环，见[安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)。

### 三个需要分开的问题

架构必须分别回答三个问题：

1. **Agent Security**：这个 Agent 接触哪些不可信内容、工具、插件、凭据和网络边界，需要怎样的 provenance、沙箱、capability 与供应链防护？
2. **Agent for Security**：这个 Worker 服务 Red、Blue、CTF 还是 AppSec？它维护什么角色状态，由什么 evaluator 判断成功，允许产生什么副作用？
3. **Shared Capability**：任务需要 Binary、Web、Network、Mobile、Forensics 还是 Fuzzing？这些工具和方法怎样跨角色复用？

安全任务不自动等于高输入对抗风险，通用任务也不自动等于安全。普通 CTF 可以运行在隔离、可重置的环境里；读取网页、邮件或外部仓库的普通 Agent 反而可能需要很强的 prompt injection 和数据外传防护。二进制逆向也不是 AppSec 独有角色，它可以同时服务红队、CTF、恶意样本分析和漏洞研究。每个 Role Package 必须单独声明 `Integrity Requirements` 和所需 `Capabilities`，公共内核不得假设所有安全角色共享同一威胁模型或工具箱。

### 价值模型

```text
TaskOutcome
  = ModelCapability
  x EnvironmentAccess
  x EvaluatorQuality
  x FeedbackData
  x ExecutionEfficiency
```

上游模型供应商主要决定 `ModelCapability`。MilkSU 的自建价值必须来自后四项。如果一个需求只是在通用 Agent 外增加提示词、循环或 UI，而没有改善这些因素，就不属于核心架构。

## 核心目标

### G1. Model-as-Worker

模型是可替换的 worker。任务状态、成功判定和证据不能只存在于某个模型的上下文中，也不能由某个模型供应商的会话格式定义。

- 通过统一 adapter 调用不同模型或外部 Agent。
- 模型切换、超时或进程重启后，任务仍可从持久状态继续。
- 允许把 Codex 或 Claude Code 纳入执行平面，而不是把它们视为必须击败的竞品。

### G2. Environment Adapter

领域 Skill 不应只注入提示词。它需要声明任务环境、工具、凭据引用、资源生命周期、快照和清理方式。

- 红队环境可以包含长期靶场、跳板、代理链、Burp、Ghidra、模糊测试集群和虚拟机快照。
- CTF 环境可以包含附件、远端实例、依赖版本、重置操作和 flag 提交器。
- 蓝队环境可以包含组织资产、遥测、案件系统和处置动作。

环境适配器是可复用资产；临时 shell 命令不是。

### G3. Evaluator First

模型输出“完成”不等于任务成功。每种可自动化任务都应优先定义 evaluator：

- flag 是否被接受
- PoC 是否稳定触发且能重复
- 补丁是否阻断漏洞并通过回归
- 策略决策是否命中预期风险
- 扫描发现是否能回溯到原始证据

没有自动判定器的任务必须明确标记为人工评审，不能把模型自评混入成功指标。

### G4. Trace as Data

执行轨迹既用于审计，也用于形成可比较的数据资产。目标事件模型为：

`Run -> Step -> ModelCall -> ToolCall -> ToolResult -> Artifact -> PolicyDecision -> Evaluation -> Outcome`

每个结论都应能回溯到 observation 或 artifact；每次运行都应能关联模型、Skill、环境版本、预算和 evaluator 版本。只有这样，prompt、工具和模型迭代才有可信反馈。

### G5. Recoverable Execution

核心提交顺序为：

```text
执行工具 -> 保存 ToolResult / Artifact -> 更新 checkpoint -> 调用模型
```

- 网络重试和模型超时不消耗业务动作额度。
- 有副作用的 ToolCall 必须带幂等键和清理信息。
- 失败只扩展探索分支，不覆盖已经验证的状态。
- 恢复后复用已完成 observation，不盲目重放工具。

### G6. Domain State without Domain Lock-in

公共内核只保存通用事件和引用；Blue Case、Red Campaign、CTF Challenge 等领域状态由独立 Role Package 或投影视图维护。Binary、Web、Network、Mobile、Forensics 和 Fuzzing 等 Capability Package 只提供共享工具与方法，不负责宣布角色任务成功。这样既允许领域结构化，又避免把某一种工作流或技术领域硬编码进整个 Agent Loop。

### G7. Evidence Projection

桌面 UI、安全面板和报告是同一底层事件的不同投影：

- 面板展示当前状态、风险、证据与评测结果。
- 报告从已验证 artifact 生成，不从聊天总结反推事实。
- UI 可以被 CLI 或 API 替换，核心任务仍应可运行。

因此，领域 UI 是重要产品体验，但不是系统的唯一价值来源。

## 明确非目标

- 不训练或复刻一个通用前沿模型。
- 不以“拥有更多 prompt、更多 Agent 或更多工具”为成功标准。
- 不为一次性 CTF、单仓库审计或临时分析强行增加控制面。
- 不把模型自己的总结当作验证结果。
- 不在没有真实 benchmark 前宣称架构优于 Codex 或 Claude Code。

## 目标分层

```text
┌────────────────────────────────────────────────────┐
│ 接口：Desktop / CLI / API                          │
├────────────────────────────────────────────────────┤
│ 角色包：Red / Blue / CTF / AppSec / Malware       │
│         各自的状态投影、动作语义、证据和 evaluator │
├────────────────────────────────────────────────────┤
│ 能力包：Binary / Web / Network / Mobile            │
│         Forensics / Fuzzing                        │
├────────────────────────────────────────────────────┤
│ 公共底座：Run、Environment、Trace、Artifact、Effect│
│           Scheduler、Checkpoint、Model Router      │
├────────────────────────────────────────────────────┤
│ 通用 Worker：Pi / Codex / Claude Code / Tools      │
└────────────────────────────────────────────────────┘

横切 Agent Integrity：Provenance、Sandbox、Credential、
Capability、Egress、Plugin / Skill / MCP Supply Chain
```

Agent Integrity 是高权限 Agent 的共享基础设施，按实际信任边界启用；角色包表达任务目标和判分语义；能力包提供可跨角色复用的工具箱。三者可以独立演进，不能再合并成一个统一的 Security Kernel。

当前三进程桌面架构是上述目标的一种宿主实现，不等同于完整目标架构。

## 架构验收门槛

核心能力必须使用固定任务集做基线对照。相同模型、工具和预算下，对比最小 Pi Agent 与启用 MilkSU 控制面的运行，记录：

- `success@1`、`success@N`
- 单次成功成本和完成时间
- 无证据成功与错误判定率
- 中断恢复成功率
- 重复副作用次数
- 结果复现率

如果一个模块不能改善这些指标，也不能接入基线无法使用的环境，应当作为外围插件或实验保留，而不是进入核心。

## 模块全景

MilkSU 由 8 个功能模块 (Module) 组成，每个模块可以独立评估和迭代。

| 模块 | 文件 | 代码行数 | 成熟度 |
|------|------|----------|--------|
| 核心代理循环 (Core Agent Loop) | bridge.js, lib.rs | ~890 | L2 (真实 API E2E 已验证，暂无自动化回归) |
| 子代理 (Sub-agents) | skills/subagent/, bridge.js | ~200 | L1 (仅代码) |
| 安全面板 (Security Panels) | TaskPanel.tsx, types.ts | ~730 | L2 (UI 已验证) |
| 任务管理 (Engagement Mgmt) | engagement.rs, EngagementSelector.tsx | ~350 | L1 (仅代码) |
| 设置与供应商 | SettingsPage.tsx, settings.rs, tauri.ts | ~900 | L2 (UI 已验证) |
| 国际化 (i18n) | i18n/*.json, index.ts | ~480 | L3 (端到端已验证) |
| 技能系统 (Skills System) | src/*.ts, skills/* | ~500 | L1 (仅代码) |
| UI 外壳 | App.tsx, Sidebar, ChatView | ~760 | L2 (UI 已验证) |

### 成熟度等级

| 等级 | 名称 | 标准 |
|------|------|------|
| L0 | 桩代码 (Stub) | 仅有接口，无实现 |
| L1 | 已编码 (Code) | 实现已完成，未经验证 |
| L2 | 已验证 (Verified) | 在浏览器或 Tauri 中手动验证通过 |
| L3 | 端到端 (E2E) | 使用真实数据完成端到端测试 |
| L4 | 生产就绪 (Polished) | 具备完善的错误处理，可用于生产环境 |

## 构建系统

### 前端 (Vite + React)

```
app/
  vite.config.ts    # Vite config
  tsconfig.*.json   # TypeScript configs (app + node)
  index.html        # Entry point
  src/              # React source
```

### 后端 (Cargo + Tauri)

```
app/src-tauri/
  Cargo.toml        # Rust dependencies
  tauri.conf.json   # Window config, build settings
  src/              # Rust source
  capabilities/     # IPC permission grants
```

### Pi 扩展

```
package.json        # Pi manifest (extensions, skills arrays)
src/                # Extension TypeScript source
skills/             # Skill plugin directories
```

Pi 扩展无需构建步骤 -- Pi 使用 `jiti` 进行 TypeScript 即时编译 (JIT compilation)。

## 类型系统

核心类型定义在 [types.ts](../../app/src/types.ts)（282 行）中：

- `TaskType`: `'chat' | 'pentest' | 'ctf' | 'recon' | 'reverse'`
- `TaskState`: 按 `type` 字段区分的联合类型 (Discriminated Union)
- `Message`: 聊天消息，包含角色、内容、状态、工具结果
- `Conversation`: 消息列表 + taskType + taskState + engagement
- `SubagentResult`: 每个子代理的任务/状态/结果/流式输出
- `AppSettings`: 供应商密钥、模型、主题、语言、中继配置
- `Engagement`: 带时间线的安全任务，包含目标信息

## 错误处理策略

当前状态：错误处理极少（项目早期阶段）。

目标：错误应通过与正常消息相同的事件通道传播。

```
Bridge error -> {"type": "error", "id": "conv-123", "content": "Connection failed"}
Rust reads   -> emits "agent-message" with error type
React        -> shows error in chat with retry option
```
