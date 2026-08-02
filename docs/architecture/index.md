# MilkSU 架构快照

> 审阅日期：2026-08-01
>
> 范围：当前 `codex/authorized-learning-foundation` 分支及本轮工作区。本文档只描述代码中
> 已存在或已经明确规划的边界，不把本地 Lab、内部 NYU CTF Bench 基线或尚未完成的
> 插件专项回归写成面向用户的已发布能力。

这组文档用于回答当前实现与未来解冻设计：

0. [Archify 交互式架构图](generated/milksu-current-system.html)：一张图查看 Coding 主链、
   CTF 证据闭环、持久化和内部评测边界；对应的
   [可审阅规格](generated/milksu-current-system.architecture.json) 可继续迭代。
1. [当前系统与分层](current-system.md)：MilkSU 现在由哪些进程、容器和模块组成？
2. [CTF 数据与时序](ctf-intake-agent-judge-memory.md)：一道题怎样从 Intake 进入 Agent、Judge 和训练记忆？
3. [Coding Agent / Pi 扩展边界](coding-agent-pi-extension-boundary.md)：哪些能力复用 Pi，哪些能力属于 MilkSU，CTF 为什么不继承 Coding 插件？
4. [架构债与 M3 / R0.4 边界](m3-r04-boundary-and-debt.md)：现在能声称什么、不能声称什么，下一轮先还哪些债？
5. [授权安全学习与研究平台](security-learning-and-research-platform.md)：CTF、Labs、CVE、
   Coding 怎样共享证据、授权、环境与学习底座？
6. [CTF Labs 顶层与详细设计](ctf-labs-design.md)：未来怎样提供一键启动、可重置、
   可判定的环境型训练？
7. [CVE 研究工作台顶层与详细设计](cve-research-workbench-design.md)：未来怎样支撑
   赏金猎人的情报、资产、研究、证据与披露日常？
8. [文档与任务状态登记](/developer/document-status)：跨文档的唯一当前口径与任务状态。

## 状态约定

| 状态 | 含义 |
| --- | --- |
| **Implemented** | 实现和自动化证据都在仓库中；仍可能需要纳入最终原生发布回归。 |
| **Partial** | 主体代码已存在，但真实场景、原生 UI 或发布门仍未全部验收。 |
| **Planned** | 只有决策、研究或接口方向，不能在产品中宣称可用。 |
| **Paused** | 有实验或未发布代码，但已经从当前交付范围移除。 |

## 文档事实优先级

当不同年代的文档出现冲突时，按以下顺序判断：

1. 本目录的 `current-system.md` 与 `m3-r04-boundary-and-debt.md`；
2. `developer/development-plan.md` 的当前检查点和任务队列；
3. `Planned / Paused` 详细设计；
4. ADR 与带日期的 Architecture Review / Checkpoint。

ADR、Review 和 Checkpoint 记录当时为什么这样决定，不会因为后续实现而改写历史；它们必须
通过 `Historical`、`Superseded` 或后继链接避免被误读成当前状态。

## 本快照的关键结论

- CTF 的产品内核已经成立：模型候选与权威 Judge 分离，事实进入追加式 Event Store，
  PI 轨迹和候选可以回流，用户复盘后才允许沉淀长期训练记忆。
- 当前最大风险不是“底层完全缺失”，而是职责集中：`app.go`、`CTFPage.vue` 和
  `internal/browsercap/manager.go` 仍是主要变更热点。CTF Service 已在不改变公开契约的
  前提下抽出 Submission/Judge、平台回执和 Coding Agent 交接；约 920 行的核心 Runner
  仍需继续分离 Intake 与 Recovery。
- 普通 Coding 会话已经在代码层接入固定版本 Archify、PI LSP、Goal、后台任务、MCP
  Adapter 和 Playwright MCP；Coding 核心的 Plan → Go、多轮修改、真实打包命令执行与
  独立复验已经 **Verified**。Archify 一键动作和隔离 Coding Browser 已在原生包完成
  真实验收；TypeScript/Vue LSP 已随包并在原生 fixture 返回确定性诊断，Go LSP 与
  `lsp_fix` 仍未完成，不能把局部语言验收宣称为插件体系全部完成。
- Managed Labs 本轮已暂停。工作区里的 Lab Manager / WebGoat 实验不能进入 R0.4 发布声明，
  也不能作为 M3 完成条件。
- NYU CTF Bench 的只读元数据、Admission、DeepSeek one-shot Runner、两回合 Pi 只读
  Agent Runtime 和摘要 Judge 是 **Implemented / Verified for the narrow baseline**。
  Agent Runtime 当前只有 5 个手选 static 样本：2 solved、1 unsolved、1 无效 JSON、
  1 回合超时。它验证了只读加载、强制重启和恢复，但不是完整 NYU CTF Bench 成绩、
  不是作用型 CTF Agent 工具链验收，也不是面向用户的题库或评测服务。
- Coding Harness 遵循 **reuse-first**：Pi Core 或经审阅的社区扩展能负责的通用能力，
  MilkSU 不再写临时替代品；自研集中在桌面安全边界和 CTF 的 Evidence / Judge /
  Recovery / Memory。

## 证据入口

- 进程组合：`main.go`、`app.go`
- 通用 Agent：`bridge.js`、`internal/engine/supervisor.go`
- CTF 事实链：`internal/ctf/`、`ctf_agent_recorder.go`
- 追加式事实存储：`internal/securityruntime/`
- 平台与浏览器：`internal/nssctf/`、`internal/ctfshow/`、`internal/browsercap/`
- 本地数据根：`internal/appdata/directory.go`
- 固定 Coding 资源：`docs/developer/pi-resource-whitelist.md`、`scripts/package-sidecar.mjs`
- 发布检查：`scripts/m3-release-check.sh`
