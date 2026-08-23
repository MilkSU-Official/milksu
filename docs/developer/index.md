# 开发者文档

这里按“当前事实 → 目标 → 证据 → 历史原因”组织文档，不再把旧 M0/M1/M2/M3 里程碑排成
当前实施顺序。

## 先读这几份

1. [当前开发目标](/developer/current-objectives)：唯一目标契约；M3 product-loop 合并后的后续批次从这里选择。
2. [文档与事实状态](/developer/document-status)：文档生命周期、当前准确声明和暂停范围。
3. [当前系统与分层](/architecture/current-system)：当前进程、模块、数据和边界。
4. 当前代码、测试、Git 历史和原生 App 验收：实现事实优先于任何手写进度表。

## 当前有效的工程契约

- [当前视觉约定](/design/current-visual)
- [产品代码准入与薄 Harness 规则](/developer/product-code-admission)
- [Coding Agent / Pi 扩展边界](/architecture/coding-agent-pi-extension-boundary)
- [CTF Intake → Agent → Judge → Memory](/architecture/ctf-intake-agent-judge-memory)
- [PI Resource Whitelist](/developer/pi-resource-whitelist)
- [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)
- [Electron/Chromium 桌面壳](/developer/adr/2026-08-10-electron-chromium-desktop-shell)
- [核心架构：可验证安全任务运行时](/developer/architecture)
- [Security Role Packages](/developer/role-packages)

这些文档描述稳定边界，不单独安排开发顺序；发生实现状态冲突时回到当前目标、代码和测试事实。

## 可复跑验收与证据

- [三端打包与发版流程](/developer/release-process)
- [Coding Agent 交付验收](/developer/coding-agent-delivery-acceptance)
- [浏览器执行表面验收](/developer/coding-browser-acceptance)
- [本地交付基线](/developer/local-delivery-baseline)
- [NYU CTF Bench 安全边界](/developer/nyu-ctf-bench-eval)

证据文档只证明记录中明确写出的范围；不能外推为整个产品完成。

## 长期设计（不是禁令）

- [授权安全学习与研究平台](/architecture/security-learning-and-research-platform)
- [CTF Labs 设计](/architecture/ctf-labs-design)（CTF 可重置环境，不是主导航实验室）
- [CVE 研究工作台设计](/architecture/cve-research-workbench-design)

主导航「实验室」和 CVE 档案复现已进入 `26.822.1`；`26.823.1` 起 CTF / CVE / 实验室与 Coding 共用完整循环。CTF 可重置环境仍未做。设计存在不表示已经做完。

## 历史

`developer/adr/*` 记录当时的决策原因，不是 backlog。顶部的 Historical/Evidence
标识优先于正文中的旧“下一步”或“未完成”列表。过期调研快照和日期验收截图已删除，考古用 Git history。

历史样本见[开源项目基线](/developer/industry-baseline)，当前接入顺序和拒绝项以
[个人安全工作台计划：安全工具接入 Coding](/developer/security-workspace-product-plan#4-安全工具接入-coding)
为准。项目写进调研表不等于已经进入产品；正式接入仍需经过许可证、供应链、权限面和真实任务验收。
