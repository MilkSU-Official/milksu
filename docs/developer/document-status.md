# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-09
>
> 产品开发目标：Post-M3 / M4 自举与隔离执行

## 事实优先级

文档冲突时按此顺序：

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执；
2. [当前开发目标](/developer/current-objectives)；
3. [当前系统与分层](/architecture/current-system)；
4. Target/Designed 文档；
5. Evidence、Historical、Research 和 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/R0.x”不构成当前任务。M3 product-loop 已于
2026-08-05 squash merge；旧百分比台账已退休。后续只从当前目标、代码、测试和真实验收
选有界批次。

## 当前准确声明

- 阶段是 **Post-M3 / M4 自举与隔离执行**。M4 不是未合并 PR，而是会话在隔离 worktree 内完成
  自然任务并交付。
- Coding 工程底座已覆盖修改/测试、LSP、Artifact、隔离 Browser、后台任务、Git、PR 确认、
  worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离与写入边界、`.worktreeinclude` CoW、精确 submodule 已落地；writer 不读写主依赖。
  **交互仍是协作面板手工准备**；会话不会自动拥有执行环境。
- **Grok 看图已通过**：打包 App + TokenFlux 真实 `grok-4.5` 原生 image input；中文识别任务列表、
  进度胶囊和输入栏，且未调用工具。`grok-4.3` 仍为 text-only。text-only 路径继续 OCR + 可选
  auxiliary vision。
- **真实 Grok 自举小纵切已部分跑通**：自然提示 → writer 只改三份 Current 文档 → reviewer 纠错 →
  返工完成。功能代码、测试、恢复和 Git 交付尚未覆盖；不要写成自举完全未开始。
- **实测缺口**：输入框上方 Git 变更摘要看不到 writer 的三文件改动；活跃 worktree 变更尚未进入
  Goal/Composer 投影。
- Computer Use 有 Calculator Scope 的 observe/click 切片与工具截图辅助视觉；Browser 与
  Computer Use 仍分离。更广 App 矩阵、权限失败路径、Developer ID / TCC 复检未完成。
- 完整自然任务自举（功能代码/测试/恢复/Git 交付）、人工接管账本、自主合并发布和发行门禁仍未通过。
- 模型与凭据：单默认模型；DeepSeek V4 Flash 日常默认；TokenFlux 一等中转；Coding/CTF/sub-agent
  共用 Provider 注册。
- CTF 主链存在；真实 Judge 成功仍只有窄 Web 路径。Memory actor/assistance 已持久化；尚缺真实
  轨迹校准。Runtime Reliability fixture 已有；发行级恢复矩阵未过。
- CVE 正式事实只来自 Vuln Runtime；WebView 无假后端；Session Index 只索引 MilkSU 自有历史。
- UI：rail 主题/设置、Coding Goal 在 Composer `/`、字重与字号层级已收敛。
- Labs 暂停；CVE 纵深/复现/披露后置；NYU safe-static 不是完整 CTF 成绩；Developer ID/公证属 RC。

Current 入口只保留事实与下一条完成线。历史 smoke、已删脚本路径和流水验收见 Evidence /
Git history，不堆本页。

## 文档生命周期

| 类型 | 用途 | 当前入口 |
| --- | --- | --- |
| **Current** | 当前事实、目标和资源边界 | `current-objectives.md`、本页、`current-system.md`、`pi-resource-whitelist.md` |
| **Target** | 稳定领域和架构原则，不表示全部实现 | `developer/architecture.md`、`security-agent-boundary.md`、`role-packages.md` |
| **Evidence** | 可复跑 Runbook 或一次真实验收记录 | `*-acceptance.md`、`local-delivery-baseline.md`、`nyu-ctf-bench-eval.md` |
| **Retired Summary** | 已压缩旧台账/冲刺流水，只保留考古入口 | `objective-coverage-ledger.md`、`objective-review-workbook.md`、`product-loop-sprint.md`、`product-loop-sprint-acceptance.md` |
| **Long-term Design / Partially Implemented** | 长期设计摘要，部分被 MVP 覆盖 | `cve-research-workbench-design.md`、`security-learning-and-research-platform.md` |
| **Paused / Design Summary** | 已冻结未来设计 | `ctf-labs-design.md`、`lab-management.md` |
| **Historical** | 当时的 ADR、Checkpoint、Review、Spike | `developer/adr/*`、`developer/checkpoints/*`、带日期 Review、`spikes/*` |
| **Research** | 外部项目与方案输入 | `developer/research/*`、`industry-baseline.md` |
| **Design Snapshot** | 视觉参考与验收证据 | `design/audits/*`、`design-qa.md`、`docs/design/*` |
| **Vendored / External** | 上游原文，不按 MilkSU 进度重写 | `third_party/*`、`packages/ui/*`、fixture、Skill 内部参考 |

## 维护规则

1. Current 只写当前可验证事实与下一条完成线，不堆历史 smoke 清单；
2. Target 描述不变量，不维护动态完成度；
3. Evidence 保留原始日期、版本和范围，不外推；
4. Historical/Research/Design 只加状态和 successor，不篡改当时内容；
5. Paused 文档首屏写明未启用；
6. 外部或 vendored 文档不替 MilkSU 改写；
7. 开发中只更新测试、回执、Checkpoint 和必要 ADR；发布声明在 Gate 通过后统一更新；
8. 文档压缩单独成批：先保证 Current 不误导执行，再合并冗余过程记录。
