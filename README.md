# MilkSU

MilkSU 是一个由用户拥有的安全任务控制面。它把 Codex、Claude Code、Pi 以及其他模型视为可替换的执行器，围绕它们提供环境接入、结果判定、轨迹留存、失败恢复和规模化运行。

MilkSU 不试图训练一个比前沿模型更聪明的“安全大脑”。它要解决的是另一类问题：如何让强模型在真实安全环境里形成可验证、可复现、可积累的任务闭环。

当前产品目标和概念边界以[安全 Agent 与通用 Agent 的能力边界](docs/developer/security-agent-boundary.md)为最高优先级设计依据。Roadmap 负责落地这个目标；早期 Sprint、固定 Task Type 和 Security Kernel 方案不再是主线。

## 核心命题

安全任务的结果不只取决于模型能力：

~~~text
任务结果
  = 模型能力
  x 环境与工具接入
  x 判分器质量
  x 真实反馈与轨迹数据
  x 执行效率与恢复能力
~~~

模型能力主要来自上游供应商。MilkSU 应当长期积累后四项，而不是重复实现一个更弱的通用 Coding Agent。

## 三个不能混淆的问题

- **Agent Security** 保护 Agent 自身免受 prompt injection、工具投毒、凭据滥用、数据外传和供应链攻击。这是浏览、邮件、办公、开发和安全 Agent 都可能需要的通用基础设施。
- **Role Package（角色包）**定义 Agent for Security 最终要完成什么，例如红队证明攻击路径、蓝队完成遏制恢复、CTF 提交正确 flag。
- **Capability Package（能力包）**提供完成任务的方法和工具，例如二进制逆向、Web 测试、取证和 Fuzzing。

三者应分开组合。普通 CTF Agent 可以在隔离环境中执行安全任务，却不一定面对外部攻击者；浏览网页的普通 Agent 不是安全任务 Agent，却可能需要很强的输入完整性保护；二进制逆向则是一种可被 Red、CTF、AppSec、恶意样本分析和漏洞研究共享的能力。MilkSU 不使用“所有安全 Agent 都面对恶意输入”作为统一架构前提，也不把“会用某种工具”误当成一个安全角色。

## 什么时候值得使用 MilkSU

- 任务需要接入长期靶场、内网、设备、调试器、扫描器或可回滚环境。
- 成败可以由 flag、PoC、补丁验证、覆盖率、策略命中或其他判分器确认。
- 同类任务需要批量运行、重复评测，或者比较不同模型与 Skill 的效果。
- 任务跨越多个会话、进程或主机，需要恢复执行并避免重复副作用。
- 用户需要拥有自己的模型路由、策略边界、证据和运行数据。

如果只是一次性 CTF、单仓库审计或临时漏洞分析，优先直接使用成熟的通用 Agent。只有当 MilkSU 能提供不可替代的环境、判分与数据闭环时，额外的 Harness 层才有意义。

## 核心架构目标

1. **Model-as-Worker**：模型是可替换的执行器，不是系统唯一的状态来源。
2. **Environment Adapter**：用统一接口管理目标、工具、凭据引用、快照和清理动作。
3. **Evaluator First**：模型不能自行宣布任务成功；关键结论必须由判分器或证据验证。
4. **Trace as Data**：持久化 action、observation、artifact、decision 和 outcome，使运行可回放、可比较、可学习。
5. **Recoverable Execution**：先保存工具结果和 checkpoint，再继续推理；重试不得重复有副作用的动作。
6. **Role and Capability Packages**：角色包定义结果、状态和判分；能力包提供跨角色共享的工具与方法。
7. **Evidence Projection**：桌面 UI 和安全面板展示任务状态、证据与决策，但展示层本身不被视为护城河。

目标架构把通用 Worker、跨领域完整性和角色闭环分开：

~~~text
Desktop / CLI / API
        |
Role Packages
Red / Blue / CTF / AppSec / Malware / Vulnerability Research
        |
Capability Packages
Binary / Web / Network / Mobile / Forensics / Fuzzing
        |
Shared Security Substrate
Environment、Evaluator、Evidence、Trace、Effect
        |
General Worker
Pi / Codex / Claude Code / 其他模型与工具

Cross-cutting Agent Integrity
Provenance、Sandbox、Credential、Capability、Supply Chain
~~~

Agent Integrity 按内容信任度、权限和数据风险配置；Role Package 按任务结果配置；Capability Package 按所需技术配置。三者各自演进，Agent Integrity 不是安全任务专属护城河，二进制逆向等共享能力也不应被某一个角色独占。

详细设计以文档站为准，阅读顺序如下：

- [安全 Agent 与通用 Agent 的能力边界](docs/developer/security-agent-boundary.md)（当前架构目标）
- [核心架构](docs/developer/architecture.md)（目标分层）
- [Agent Harness 设计边界](docs/guide/agent-harness.md)
- [平台对比与差异化](docs/developer/comparison.md)
- [路线图与验证门槛](docs/progress/roadmap.md)（落地顺序）

## 验证原则

任何“优势”都必须通过对照实验而不是功能清单证明。使用相同模型、相同工具和相同预算，对比最小 Agent 基线与 MilkSU，至少记录：

- `success@1` 与 `success@N`
- 单次成功成本与完成时间
- 无证据的误报成功率
- 中断后的恢复成功率
- 重复副作用次数
- 结果复现率

如果一个新模块既不能改善这些指标，也不能接入基线无法使用的环境，它不应进入核心架构。

## 开发

~~~bash
# 启动文档站
npm run docs:dev

# 启动桌面端浏览器预览
cd app
npm run dev

# 启动 Tauri 桌面端
cd app
npx tauri dev
~~~

项目当前状态与优先级见 [模块状态](docs/progress/status.md) 和 [路线图](docs/progress/roadmap.md)。
