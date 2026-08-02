# 文档与事实状态

> 状态：Living document
>
> 最后事实审计：2026-08-02
>
> 当前任务与执行顺序只以[当前开发目标](/developer/current-objectives)为准。

## 当前事实

- CTF 已完成一条真实 NSSCTF P3879 Intake → Pi → Candidate → Browser Judge
  `correct=true` → Recovery → Debrief 闭环；这不代表六赛道通用 CTF 能力。
- Coding 已完成 Plan/Go、三档权限、逐次审批、文件/图片输入、项目终端、后台任务、
  隔离 Browser、TypeScript/Vue/Go LSP 诊断、经审阅的 TypeScript Code Action、
  文件/Hunk Diff、stage、commit 和 push。
- Archify 已完成一键生成、验证和右侧预览。
- CTF Tool Builder、Strategist、Checkpoint、候选、Judge、恢复、复盘与本机 Memory
  已有工程主链，但仍欠真实跨题协作与画像校准。
- NYU CTF Bench 只有 one-shot 和两回合只读 safe-static Runtime smoke，不是完整
  MilkSU CTF 成绩。
- 安全备份、校验、恢复暂存、启动恢复、凭据保留、失败回滚和脱敏诊断包已经实现。
- Labs 与 CVE Research 保持 Paused / Designed，不进入当前完成条件。
- 最近一次完整 `m3:release-check` 已通过；开发包仍不是 Developer ID 公证发行包。

## 文档生命周期

| 类型 | 文档 | 如何使用 |
| --- | --- | --- |
| Current | [当前开发目标](/developer/current-objectives) | 唯一任务范围、优先顺序与验收契约。 |
| Current | [当前架构快照](/architecture/) | 当前进程、模块和已实现边界。 |
| Current | [本页](/developer/document-status) | 只登记事实，不维护 backlog。 |
| Current | [NYU CTF Bench 评测边界](/developer/nyu-ctf-bench-eval) | 记录内部评测能够与不能声称什么。 |
| Current | [PI Resource Whitelist](/developer/pi-resource-whitelist) | 固定 Pi 资源和 CTF 隔离规则。 |
| Target | [六层运行时架构](/developer/architecture) | 保存对象模型和不可破坏的架构原则。 |
| Designed | [授权安全学习与研究平台](/architecture/security-learning-and-research-platform) | 长期产品关系，不自动进入当前任务。 |
| Paused | [CTF Labs 设计](/architecture/ctf-labs-design) | 获得新的范围与授权后才可解冻。 |
| Paused | [CVE 研究工作台设计](/architecture/cve-research-workbench-design) | 获得新的范围与授权后才可解冻。 |
| Historical | `developer/adr/*`、`developer/checkpoints/*`、带日期 Review | 保留当时决策与证据，不用于安排当前工作。 |
| Research | `developer/research/*`、`design/audits/*` | 调研输入，不自动成为依赖或产品承诺。 |

## 状态更新规则

1. `Implemented` 需要代码和自动化测试；
2. `Verified` 还需要打包 Sidecar、原生 App 或真实平台证据；
3. `Planned / Designed / Paused` 不得出现在当前可用能力列表；
4. 历史文档只补 successor，不反向改写当时结论；
5. 当前任务变化只更新[当前开发目标](/developer/current-objectives)，不复制新的优先级表；
6. 最终架构、里程碑、状态和发布说明在功能与真实验收完成后统一更新。
