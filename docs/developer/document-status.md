# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-03
>
> 产品开发目标：Active / Product-loop sprint

## 事实优先级

文档出现冲突时，按以下顺序判断：

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执；
2. [当前开发目标](/developer/current-objectives)；
3. [目标覆盖台账](/developer/objective-coverage-ledger)；
4. [当前系统与分层](/architecture/current-system)；
5. Target/Designed 文档；
6. Evidence、Historical、Research 和 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/R0.x”不构成当前任务。产品开发先按当前目标中的
product-loop sprint 收口；回到全量目标后再按覆盖台账中的 P0 → P1 → P2 广度顺序推进。

## 当前准确声明

- Coding 的工程底座已经覆盖普通修改、构建测试、LSP、Artifact 预览、隔离 Browser、
  后台任务、Git、PR 预览、worktree、ImageGen、Project MCP 和 Computer Use 自控基础；
  Computer Use 跨 App / 窗口选择、工具截图辅助视觉、完整长时间自举、跨 App 重启和私有
  PR Gate 尚未通过。
- CTF 的 Intake、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘和 Memory 主链
  已存在；NSSCTF P3879 有一条真实 `correct=true`，但六赛道仍只有 Web 窄路径通过。
- 动态 Endpoint 和精确 HTTP/TCP/SSH Scope 主链已落地，后续只在真实赛道中保持回归；
  不能恢复旧的 Endpoint 开发计划。
- Memory 已有归属模型和相关/无关/当前题召回自动化，尚缺真实轨迹校准和用户可解释闭环。
- Runtime Reliability fixture 已覆盖多轮工具、Sidecar 恢复、Compaction、超时/取消、预算
  和失败分类；完整 App 用户可见长任务恢复仍未通过。
- NYU one-shot 与两回合只读 Runtime 只是 safe-static 开发者 smoke，不是完整 MilkSU CTF
  成绩。
- 本地备份、恢复、脱敏诊断和单机交付基线已存在；Developer ID、公证、升级和新机器安装
  属于后期 Release Candidate。
- Lab 为 `Paused / Designed`，不进入当前完成条件。CVE 纵深研究后置，但一级菜单和
  学习/追踪工作台骨架进入当前产品闭环冲刺。

精确百分比、每项证据和缺口只在覆盖台账维护，其他文档不复制第二份动态进度表。

## 文档生命周期

| 类型 | 用途 | 当前入口 |
| --- | --- | --- |
| **Current** | 当前事实、目标、计分和资源边界 | `current-objectives.md`、`objective-coverage-ledger.md`、本页、`current-system.md`、`pi-resource-whitelist.md` |
| **Target** | 稳定领域和架构原则，不表示全部实现 | `developer/architecture.md`、`security-agent-boundary.md`、`role-packages.md` |
| **Evidence** | 可复跑 Runbook 或一次真实验收记录 | `*-acceptance.md`、`local-delivery-baseline.md`、`nyu-ctf-bench-eval.md` |
| **Paused / Designed** | 已冻结的未来产品设计 | `ctf-labs-design.md`、`cve-research-workbench-design.md`、`security-learning-and-research-platform.md` |
| **Historical** | 当时的 ADR、Checkpoint、Review、Spike 和迁移原因 | `developer/adr/*`、`developer/checkpoints/*`、带日期 Review、`spikes/*` |
| **Research** | 外部项目、许可证和方案输入 | `developer/research/*`、`industry-baseline.md`；包括 Wallbreaker 静态对照 |
| **Design Snapshot** | 某次视觉参考、审计和验收证据 | `design/audits/*`、`design-qa.md`、`docs/design/*` |
| **Vendored / External** | 上游原文或执行契约，不按 MilkSU 进度重写 | `third_party/*`、`packages/ui/*`、测试 fixture、Skill 内部参考 |

## 维护规则

1. Current 文档只写当前可验证事实，不保留已被取代的临时计划；
2. Target 文档描述不变量，动态完成度链接到覆盖台账；
3. Evidence 文档保留原始日期、版本和范围，不把一次结果外推；
4. Historical/Research/Design 文档只增加状态和 successor，不反向篡改当时内容；
5. Paused 文档必须在首屏写明未启用；
6. 外部或 vendored 文档不替 MilkSU 改写；
7. 开发过程中只更新测试、回执、Checkpoint 和必要 ADR；最终发布声明在所有 Gate 通过后
   统一更新。
