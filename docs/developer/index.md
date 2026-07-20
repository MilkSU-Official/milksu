# 开发者文档

这里仅保存 MilkSU 当前有效的产品认知、目标架构和集成研究。首页是总地图；左侧文档树负责逐层展开。

## 推荐阅读路径

1. [开发计划](/developer/development-plan)：当前实现顺序与每个里程碑的完成标志。
2. [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)：先分清 Agent Security、Agent for Security、Role 与 Capability。
3. [六层运行时架构](/developer/architecture)：把主线转成可实现的对象、分层和执行约束。
4. [Runtime v1alpha1](/developer/runtime-v1alpha1)：M1 怎样保存事实、判分、取消并从中断恢复。
5. [ADR-0001：Agent Engine 与桌面进程边界](/developer/adr/0001-agent-engine-and-desktop-boundary)：M0 为什么选择 Go/Wails/React + Pi Sidecar，并把 Codex 留作对照。
6. [ADR-0002：Runtime 事实、存储与恢复边界](/developer/adr/0002-runtime-facts-and-recovery)：M1 为什么选择追加事件、内容寻址 Artifact、新 Attempt 恢复和只读桌面 Adapter。
7. [ADR-0003：M2-A CTF 纵切与 Pi Security Adapter](/developer/adr/0003-ctf-vertical-slice)：真实模型怎样只能提议三种类型化动作，并由 Go Runtime 与独立 Judge 掌握事实和成功条件。
8. [靶场与环境管理](/developer/lab-management)：怎样自动导入、启动、重置、判题和清理本地 CTF/Vuln 环境。
9. [Challenge Intake、Browser Use 与 Computer Use](/developer/challenge-intake-and-automation)：怎样接受聊天、文件、截图、目录与任意网站，并安全复用浏览器/桌面项目。
10. [Role Packages](/developer/role-packages)：说明首批 CTF 与 Vulnerability Research 角色，以及人类学习 Outcome。
11. [开源项目坐标](/developer/industry-baseline)：决定一个项目应该接入、委派、学习、只做 benchmark，还是拒绝。
## 当前实现边界

M0、M1 与 M2-A 已完成工程验证：Go/Wails/React 桌面宿主、Pi Sidecar、追加式 Event Store、Artifact Store、只读 Projection、独立 Evaluator和中断恢复已经实跑；真实 Pi/DeepSeek 也已在桌面通过 CTF 类型化动作与本地 Judge 解完内置 Hex 题。

这仍只是离线单题纵切，不等于 M2 可玩 MVP：Browser、Shell、自动 Lab、在线网站、截图/目录接入、Coach/Copilot 与长期学习尚未实现。下一个大模块必须先和用户确认；完成完整 CTF MVP 后，再用 Vuln MVP 检验公共抽象。两个 Role 从首个 MVP 起就有独立面板，具体 UI/UX 随实跑逐步确定。
