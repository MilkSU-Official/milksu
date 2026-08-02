# 开发者文档

这里仅保存 MilkSU 当前有效的产品认知、目标架构和集成研究。首页是总地图；左侧文档树负责逐层展开。

## 推荐阅读路径

1. [开发计划](/developer/development-plan)：当前实现顺序与每个里程碑的完成标志。
2. [文档与任务状态登记](/developer/document-status)：当前唯一口径、文档生命周期和 Active/Paused/Out-of-scope 队列。
3. [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)：先分清 Agent Security、Agent for Security、Role 与 Capability。
4. [六层运行时架构](/developer/architecture)：把主线转成可实现的对象、分层和执行约束。
5. [Runtime v1alpha1](/developer/runtime-v1alpha1)：M1 怎样保存事实、判分、取消并从中断恢复。
6. [ADR-0001：Agent Engine 与桌面进程边界](/developer/adr/0001-agent-engine-and-desktop-boundary)：M0 为什么选择 Go/Wails/React + Pi Sidecar，并把 Codex 留作对照。
7. [ADR-0002：Runtime 事实、存储与恢复边界](/developer/adr/0002-runtime-facts-and-recovery)：M1 为什么选择追加事件、内容寻址 Artifact、新 Attempt 恢复和只读桌面 Adapter。
8. [ADR-0003：M2-A CTF 纵切与 Pi Security Adapter](/developer/adr/0003-ctf-vertical-slice)：真实模型怎样只能提议三种类型化动作，并由 Go Runtime 与独立 Judge 掌握事实和成功条件。
9. [ADR-0004：学习产品、能力与开源发布边界](/developer/adr/0004-learning-product-and-release-boundary)：为什么“学习工具”必须落实为默认能力、授权、审批与分级发布，而不是免责文案。
10. [ADR-0005：M3 Vuln Research 证据纵切](/developer/adr/0005-vuln-research-evidence-slice)：第二个 Role 怎样复用 Runtime，并用固定源码、外部三次日志和独立 Evaluator 形成研究工作台。
11. [ADR-0006：M3 产品控制面与比赛/CVE 工作流](/developer/adr/0006-m3-product-control-plane)：为什么顶层入口从上传题目和本地 fixture 改成比赛目录与 CVE 优先队列，以及演示数据、产品状态和 Runtime 事实怎样分层。
12. [ADR-0007：CTF Agent Harness 与 NSSCTF Agent Arena](/developer/adr/0007-ctf-agent-harness-and-nssctf-arena)：怎样把教练、副驾、单 Agent 委托、多 Agent 竞速和基准回放分层，并用真实平台判题而不是模型自报成功。
13. [ADR-0008：Vue 3、Memoh UI 与 Challenge Desk](/developer/adr/0008-vue-memoh-frontend)：为什么替换 React 视图层、怎样直接复用 Memoh 主题，以及列表式训练场如何和 Agent 工作台分层。
14. [ADR-0009：NSSCTF 已登录页面桥接与平台 Judge 回执](/developer/adr/0009-nssctf-browser-judge-bridge)：怎样只绑定用户选中的题目页、提交候选，并把 Accepted/Rejected/不明确回执写成独立事实。
15. [ADR-0010：PI Coding Agent 工作区](/developer/adr/0010-pi-coding-agent-workspace)：为什么内部任务运行时退出用户导航，以及通用对话怎样获得项目选择、编码工具、停止和会话恢复。
16. [ADR-0011：NSSCTF 本地题库、能力画像与可解释推荐](/developer/adr/0011-nssctf-catalog-and-recommendation)：怎样限速同步公开题库、从本机真实训练轨迹计算能力雷达，并推荐下一题。
17. [ADR-0012：CTF 单题工作区、PI 解题交接与轨迹回流](/developer/adr/0012-ctf-pi-workspace-and-trajectory)：怎样借鉴开源 CTF Agent 的单题工作区、Playbook、预算和轨迹设计，并把 PI 候选送入独立 Judge。
18. [ADR-0014：CTF 工具工坊、Agent 产物交接与训练记忆](/developer/adr/0014-ctf-tool-workshop-and-memory)：怎样让解题 Agent 与 Coding Agent 用可测试产物交接，并把经用户确认的复盘变成可撤销的本机训练记忆。
19. [Challenge Intake、Browser Use 与 Computer Use](/developer/challenge-intake-and-automation)：怎样接受聊天、文件、截图、目录与任意网站，并安全复用浏览器/桌面项目。
20. [Role Packages](/developer/role-packages)：说明首批 CTF 与 Vulnerability Research 角色，以及人类学习 Outcome。
21. [开源项目坐标](/developer/industry-baseline)：决定一个项目应该接入、委派、学习、只做 benchmark，还是拒绝。
22. [PI Resource Whitelist](/developer/pi-resource-whitelist)：记录 Coding Agent 可加载的固定版本 Skill/Extension，以及 CTF 隔离断言。
23. [Coding Agent 与 Codex 能力对照](/developer/coding-agent-codex-parity)：按日常开发工作流追踪项目、执行、Git、权限、扩展与自动化的实现和验收差距。
24. [CTF Agent 开源项目对照](/developer/research/2026-07-31-ctf-agent-landscape)：BoxPwnr、D-CIPHER、EnIGMA+、CAI 等框架与 MilkSU 底座取舍。
25. [NYU CTF Bench 离线评测](/developer/nyu-ctf-bench-eval)：只导入固定版本的 benchmark 索引与人工准入材料；提供 one-shot 与两回合 Pi 只读 Agent Runtime，生成可复现摘要报告，但不启动挑战或执行 Agent 输出。
26. [授权安全学习与研究平台](/architecture/security-learning-and-research-platform)：CTF、Labs、CVE 与 Coding 怎样共享授权、证据、环境和学习底座。
27. [CTF Labs 顶层与详细设计](/architecture/ctf-labs-design)：未来怎样提供一键启动、可重置、可判定的环境型训练。
28. [CVE 研究工作台顶层与详细设计](/architecture/cve-research-workbench-design)：未来怎样支撑赏金猎人的情报、资产、研究、证据和披露日常。
29. [2026-07-31 M3 Architecture Review](/developer/architecture-review-2026-07-31)：保留当时的变更集中点、优先级和真实平台验收判断；当前状态以后继文档为准。

## 当前实现边界

M0、M1、M2-A 与 M3-A 已完成工程验证：Go/Wails 桌面宿主、Vue 3 + Memoh UI 控制面、Pi Sidecar、追加式 Event Store、Artifact Store、只读 Projection、独立 Evaluator 和中断恢复已经实跑。普通 Coding 会话加载经过审阅和固定版本的 MilkSU Workflow、Archify、PI LSP 与 PI Retry；打包应用内的 Plan → Go、多轮修改、测试和人类纠错已经通过一次真实交付回归，CTF 会话通过负向 Smoke 保持资源隔离。Vuln Role 已增加固定本地 packet-parser 的 Target、Attack Surface、Hypothesis、静态 Root Cause、外部三次 ASan 日志一致性 Evaluation 和 Human Outcome 工作台。

这些仍不等于完整 M2/M3：Managed Labs、真正容器/VM 隔离和精确网络 allowlist 尚未发布；Vuln 也尚未由 MilkSU 自动生成、最小化或执行触发输入。当前一级入口为 `CTF / CVE / Coding`。CTF 已支持 NSSCTF/CTFshow 本地目录、完整分页、自定义题目 Intake、能力画像、可解释推荐、Coach/Copilot/Delegate、Arena、只绑定当前题目页的 Chrome bridge，以及 Challenge 到 PI 单题工作区的一键交接；P3879 已完成一次真实 `correct=true`、恢复和复盘闭环。用户确认的复盘会进入本机 SQLite + Markdown 训练记忆。CTF Sidecar 已限制工作区、命令时长和输出量，并在 macOS 使用 Seatbelt 约束本地命令，但这仍不是容器。多题型、CTFshow 账号回归、动态 Endpoint 确认和能力画像校准仍欠验证。CVE 情报仍是演示 Adapter；Labs 与真实 CVE 工作流均为 `Paused / Designed`。
