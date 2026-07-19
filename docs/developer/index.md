# 开发者文档

这里仅保存 MilkSU 当前有效的产品认知、目标架构和集成研究。首页是总地图；左侧文档树负责逐层展开。

## 推荐阅读路径

1. [安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)：当前主线，先分清 Agent Security、Agent for Security、Role 与 Capability。
2. [六层运行时架构](/developer/architecture)：把主线转成可实现的对象、分层和执行约束。
3. [Role Packages](/developer/role-packages)：说明首批 CTF 与 Vulnerability Research 角色，以及人类学习 Outcome。
4. [开源项目坐标](/developer/industry-baseline)：决定一个项目应该接入、委派、学习、只做 benchmark，还是拒绝。
## 当前实现边界

核心 Runtime 尚未开始实现。仓库只保留聊天、配置、桌面宿主和通用 UI 作为可复用外壳；它们不代表六层架构已经落地，也不能反过来规定 Job、Role、Capability 或 Evaluator 的数据模型。

接下来先用无 UI 的契约测试写出最小 CTF 纵切，再冻结 Vuln 的状态与证据边界。等事实模型稳定以后，才为两个 Role 分别设计面板。
