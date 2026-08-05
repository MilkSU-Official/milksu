# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-05
>
> 产品开发目标：Post-M3 product-loop merge；下一批次从当前目标、代码和测试事实选择

## 事实优先级

文档出现冲突时，按以下顺序判断：

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执；
2. [当前开发目标](/developer/current-objectives)；
3. [当前系统与分层](/architecture/current-system)；
4. Target/Designed 文档；
5. Evidence、Historical、Research 和 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/R0.x”不构成当前任务。M3 product-loop PR #1 已于
2026-08-05 squash merge 到 `main`；`product-loop-sprint.md` 现在是已完成冲刺摘要，不再表示
同一 PR 仍未合并。旧百分比台账已退休；后续工作从当前目标、代码、测试和真实验收中选择
有界批次。

## 当前准确声明

- Coding 的工程底座已经覆盖普通修改、构建测试、LSP、Artifact 预览、隔离 Browser、
  后台任务、Git、PR 预览/发布确认、worktree、ImageGen、Project MCP、Session Index 和
  Computer Use 外部 App/窗口纵切；真实外部 Provider 质量、长期主工作区自改、自主合并发布、
  完整审批矩阵和发行门禁仍未通过。
- CTF 的 Intake、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘和 Memory 主链
  已存在；NSSCTF P3879 有一条真实 `correct=true`，但六赛道仍只有 Web 窄路径通过。
- 动态 Endpoint 和精确 HTTP/TCP/SSH Scope 主链已落地，后续只在真实赛道中保持回归；
  不能恢复旧的 Endpoint 开发计划。
- Memory 已有归属模型和相关/无关/当前题召回自动化，尚缺真实轨迹校准和用户可解释闭环。
- Runtime Reliability fixture 已覆盖多轮工具、Sidecar 恢复、Compaction、超时/取消、预算、
  失败分类、异常退出标记和打包 App/WebView 后台长任务恢复；交互式 PTY 重连、更多真实长任务
  和发行级恢复矩阵仍未通过。
- NYU one-shot 与两回合只读 Runtime 只是 safe-static 开发者 smoke，不是完整 MilkSU CTF
  成绩。
- 本地备份、恢复、脱敏诊断和单机交付基线已存在；Developer ID、公证、升级和新机器安装
  属于后期 Release Candidate。
- Lab 为 `Paused / Designed`，不进入当前完成条件。CVE 已有学习/追踪 MVP；CVE 纵深研究、
  真实漏洞复现、外部资产实验和披露流程仍后置。

不再维护动态百分比台账；实现进展以当前代码、测试、Git 历史和真实验收为准。

## 文档生命周期

| 类型 | 用途 | 当前入口 |
| --- | --- | --- |
| **Current** | 当前事实、目标和资源边界 | `current-objectives.md`、本页、`current-system.md`、`pi-resource-whitelist.md` |
| **Target** | 稳定领域和架构原则，不表示全部实现 | `developer/architecture.md`、`security-agent-boundary.md`、`role-packages.md` |
| **Evidence** | 可复跑 Runbook 或一次真实验收记录 | `*-acceptance.md`、`local-delivery-baseline.md`、`nyu-ctf-bench-eval.md` |
| **Retired Summary** | 已压缩的旧台账、工作簿和冲刺流水，只保留考古入口 | `objective-coverage-ledger.md`、`objective-review-workbook.md`、`product-loop-sprint.md`、`product-loop-sprint-acceptance.md` |
| **Long-term Design / Partially Implemented** | 长期产品设计摘要，部分被当前 MVP 覆盖 | `cve-research-workbench-design.md`、`security-learning-and-research-platform.md` |
| **Paused / Design Summary** | 已冻结的未来产品设计摘要 | `ctf-labs-design.md`、`lab-management.md` |
| **Historical** | 当时的 ADR、Checkpoint、Review、Spike 和迁移原因 | `developer/adr/*`、`developer/checkpoints/*`、带日期 Review、`spikes/*` |
| **Research** | 外部项目、许可证和方案输入 | `developer/research/*`、`industry-baseline.md`；包括 Wallbreaker 静态对照 |
| **Design Snapshot** | 某次视觉参考、审计和验收证据 | `design/audits/*`、`design-qa.md`、`docs/design/*` |
| **Vendored / External** | 上游原文或执行契约，不按 MilkSU 进度重写 | `third_party/*`、`packages/ui/*`、测试 fixture、Skill 内部参考 |

## 维护规则

1. Current 文档只写当前可验证事实，不保留已被取代的临时计划；
2. Target 文档描述不变量，不维护动态完成度；
3. Evidence 文档保留原始日期、版本和范围，不把一次结果外推；
4. Historical/Research/Design 文档只增加状态和 successor，不反向篡改当时内容；
5. Paused 文档必须在首屏写明未启用；
6. 外部或 vendored 文档不替 MilkSU 改写；
7. 开发过程中只更新测试、回执、Checkpoint 和必要 ADR；最终发布声明在所有 Gate 通过后
   统一更新。
8. 文档压缩单独成批处理：先保证 Current/入口文档不误导执行，再把冗余过程记录合并为短入口
   和 Evidence 索引；不要在功能修复中顺手大规模搬迁历史证据。
