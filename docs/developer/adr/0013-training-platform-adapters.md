# ADR-0013：CTF 赛事、题库与交互式靶场使用同一训练平台边界

> 状态：Accepted
>
> 日期：2026-07-31

## 背景

MilkSU 的 CTF 学习对象不只包含按 Flag 判定的比赛题。Hack The Box Machine、TryHackMe Room 一类交互式靶场同样训练枚举、利用、提权、证据整理和复盘，只是生命周期更长、环境交互更强。

产品上将它们归入同一个“CTF 训练”领域，但明确区分体验类型：

- `competition`：有赛事、排行榜和时间边界；
- `challenge-library`：独立题目与平台 Judge；
- `interactive-lab`：有实例生命周期、网络入口和多阶段目标；
- `guided-room`：讲解、任务、问题和靶机组合。

能力画像可以跨平台聚合，但平台目录、赛事进度、实例状态和 Judge 回执不能互相冒充。

## 决策

1. 后端提供训练平台能力注册表。只有真实完成目录、题面/材料与 Judge 闭环的 Adapter 才标记 `ready` 和 `selectable=true`。
2. NSSCTF 与 CTFshow 保持当前可用状态。
3. Hack The Box 进入 `planned`：
   - 产品只接 HTB Labs，不混入 HTB CTF 赛事；
   - 目标内容是 Machines、Starting Point 与 Challenges，目标生命周期是目录、启动、VPN/网络入口、进度、停止与复盘；
   - 使用 Labs Account Settings 中的 API Token，并继续保存到用户目录下的 SQLite 凭据库；Token 不返回 Wails 前端；
   - 只有经过真实账户验证、明确映射、效果分类和测试的官方 Labs 动作才能进入 Adapter 或 Agent；
   - 不抓取未公开的 Web 私有接口；若官方标准账户能力不足，则降级为用户显式绑定的 Browser Bridge。
4. TryHackMe 进入 `restricted`：
   - 官方 Enterprise API 可获取 Room、Questions、Scoreboard 与 Time Report；
   - 该 API 仅面向 Business/Classroom，不承诺普通个人账户可用；
   - 在没有官方消费者接口前，不展示成可点击的可用题库，也不抓取私有接口。
5. 每个平台 Adapter 仍须落入统一 `Challenge Workspace → Agent → Candidate Gate → authoritative Judge → Evidence → Training Report` 契约。

## 官方依据

- Hack The Box Labs 内容类型：<https://help.hackthebox.com/en/articles/5185158-introduction-to-htb-labs>
- TryHackMe Enterprise API：<https://help.tryhackme.com/en/articles/6498330-enterprise-api>
- TryHackMe Room 类型：<https://help.tryhackme.com/en/articles/6611837-rooms>

## 后果

- 用户可以把比赛题、独立题和交互式靶场理解为同一学习路径，不会把它们误称为同一种产品。
- UI 用统一下拉列出可用、规划中、受限和本地自定义来源；只有可用来源进入题库，规划中或受限来源进入带真实能力范围、限制与官方入口的状态页，避免把配置按钮伪装成平台内容或留下死按钮。
- HTB Labs 适配从真实标准账户开始验证，不复用或展示赛事 CTF 的 MCP、Token、赛事目录与 Judge UI。
- TryHackMe 先保留清晰边界，不制造不可维护的集成。
