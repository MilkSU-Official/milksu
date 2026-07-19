# 开发者文档

这里仅保存 MilkSU 当前有效的产品认知、目标架构和集成研究。首页是总地图；左侧文档树负责逐层展开。

## 推荐阅读路径

1. [开发计划](/developer/development-plan)：当前实现顺序与每个里程碑的完成标志。
2. [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)：先分清 Agent Security、Agent for Security、Role 与 Capability。
3. [六层运行时架构](/developer/architecture)：把主线转成可实现的对象、分层和执行约束。
4. [ADR-0001：Agent Engine 与桌面进程边界](/developer/adr/0001-agent-engine-and-desktop-boundary)：M0 为什么选择 Go/Wails/React + Pi Sidecar，并把 Codex 留作对照。
5. [靶场与环境管理](/developer/lab-management)：怎样自动导入、启动、重置、判题和清理本地 CTF/Vuln 环境。
6. [Challenge Intake、Browser Use 与 Computer Use](/developer/challenge-intake-and-automation)：怎样接受聊天、文件、截图、目录与任意网站，并安全复用浏览器/桌面项目。
7. [Role Packages](/developer/role-packages)：说明首批 CTF 与 Vulnerability Research 角色，以及人类学习 Outcome。
8. [开源项目坐标](/developer/industry-baseline)：决定一个项目应该接入、委派、学习、只做 benchmark，还是拒绝。
## 当前实现边界

M0 工程骨架已经开始实现，核心任务 Runtime 仍要到 M1 才建立。当前 Go/Wails 桌面宿主、Pi Sidecar 和通用 UI 不代表六层架构已经落地，也不能反过来规定 Job、Role、Capability 或 Evaluator 的数据模型。

接下来按最小纵向骨架推进：先建立 Go/Wails/SQLite 的可恢复任务骨架，立即跑通可交互的 CTF MVP，再用 Vuln MVP 检验公共抽象。两个 Role 从首个 MVP 起就有最小面板，具体 UI/UX 随实跑逐步确定。
