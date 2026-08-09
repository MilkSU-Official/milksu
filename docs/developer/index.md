# 开发者文档

这里按“当前事实 → 目标 → 证据 → 历史原因”组织文档，不再把旧 M0/M1/M2/M3 里程碑排成
当前实施顺序。

## 先读这几份

1. [当前开发目标](/developer/current-objectives)：唯一目标契约；M3 product-loop 合并后的后续批次从这里选择。
2. [文档与事实状态](/developer/document-status)：文档生命周期、当前准确声明和暂停范围。
3. [当前系统与分层](/architecture/current-system)：当前进程、模块、数据和边界。
4. 当前代码、测试、Git 历史和原生 App 验收：实现事实优先于任何手写进度表。

## 当前有效的工程契约

- [产品代码准入与薄 Harness 规则](/developer/product-code-admission)
- [Coding Agent / Pi 扩展边界](/architecture/coding-agent-pi-extension-boundary)
- [CTF Intake → Agent → Judge → Memory](/architecture/ctf-intake-agent-judge-memory)
- [PI Resource Whitelist](/developer/pi-resource-whitelist)
- [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)
- [Browser 三面与 Coding → Security 能力迁移](/developer/adr/2026-08-09-browser-surfaces-and-security-transfer)
- [核心架构：可验证安全任务运行时](/developer/architecture)
- [Security Role Packages](/developer/role-packages)

这些文档描述稳定边界，不单独安排开发顺序；发生实现状态冲突时回到当前目标、代码和测试事实。

## 可复跑验收与证据

- [Coding Agent 交付验收](/developer/coding-agent-delivery-acceptance)
- [Coding Browser 验收](/developer/coding-browser-acceptance)
- [前端视觉 QA 验收](/developer/frontend-visual-qa-acceptance)
- [本地交付基线](/developer/local-delivery-baseline)
- [NYU CTF Bench 安全边界](/developer/nyu-ctf-bench-eval)

证据文档只证明记录中明确写出的范围；不能外推为整个产品完成。

## 已完成冲刺、暂停或未来设计

- [产品闭环冲刺摘要](/developer/product-loop-sprint)：2026-08-05 已随 PR #1 合并到 `main`。
- [产品闭环验收索引](/developer/product-loop-sprint-acceptance)：旧流水验收的压缩索引。
- [旧目标台账摘要](/developer/objective-coverage-ledger)：已退休，不再维护百分比。
- [旧目标评估摘要](/developer/objective-review-workbook)：已写入当前目标，不再作为 backlog。
- [授权安全学习与研究平台](/architecture/security-learning-and-research-platform)
- [CTF Labs 设计](/architecture/ctf-labs-design)
- [CVE 研究工作台设计](/architecture/cve-research-workbench-design)

Lab 纵深闭环仍暂停，只保留外部 HTB/TryHackMe/pwn.college 辅助与进度追踪的未来计划。
CVE 已有学习/追踪 MVP；纵深研究、外部资产实验、漏洞复现和披露闭环仍后置。设计存在不表示
真实目标已经启用。

## 历史与研究

`developer/adr/*`、`developer/checkpoints/*`、带日期的 Review、`developer/research/*`、
`design/audits/*` 和根目录 `design-qa.md` 记录当时的决策、调研或验收快照。它们保留原因和
证据，但不是 backlog；顶部的 Historical/Research/Evidence 标识优先于正文中的旧
“下一步”或“未完成”列表。

选择外部项目时参考[开源项目基线](/developer/industry-baseline)，但项目写进调研表不等于
进入依赖。正式接入仍需要许可证、供应链、权限面和真实任务验收。

近期专项调研：

- [Wallbreaker Harness 静态调研与 MilkSU 对照](/developer/research/2026-08-03-wallbreaker-harness-review)
- [开源安全 Skills / Harness 生态接入调研与计划](/developer/research/2026-08-04-open-source-security-skills-ecosystem)
- [关于一个优秀 skills 包的接入调研和计划](/developer/research/关于一个优秀%20skills%20包的接入调研和计划)
