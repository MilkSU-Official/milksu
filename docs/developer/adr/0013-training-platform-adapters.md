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
   - 优先接入官方 HTB CTF Remote MCP；
   - 官方文档确认它支持赛事注册、挑战实例启停、Flag 提交与 solve stats；
   - 当前已实现固定官方端点的 Streamable HTTP 握手、协议协商、会话头、JSON/SSE 响应和有界分页工具发现；MCP Token 复用用户目录下的 SQLite 凭据库，并且不返回 Wails 前端；
   - 远端工具清单当前只用于 Adapter 准入，不直接注册给 PI；只有工具名与参数经过本地明确映射、效果分类和测试后才能进入 Agent；
   - HTB Labs Machine 不使用未公开的 Web 私有 API，等待官方标准账户接口，或采用用户显式绑定的 Browser Bridge。
4. TryHackMe 进入 `restricted`：
   - 官方 Enterprise API 可获取 Room、Questions、Scoreboard 与 Time Report；
   - 该 API 仅面向 Business/Classroom，不承诺普通个人账户可用；
   - 在没有官方消费者接口前，不展示成可点击的可用题库，也不抓取私有接口。
5. 每个平台 Adapter 仍须落入统一 `Challenge Workspace → Agent → Candidate Gate → authoritative Judge → Evidence → Training Report` 契约。

## 官方依据

- Hack The Box CTF MCP：<https://help.hackthebox.com/en/articles/11793915-model-context-protocol-for-ctf>
- Hack The Box Labs 内容类型：<https://help.hackthebox.com/en/articles/5185158-introduction-to-htb-labs>
- TryHackMe Enterprise API：<https://help.tryhackme.com/en/articles/6498330-enterprise-api>
- TryHackMe Room 类型：<https://help.tryhackme.com/en/articles/6611837-rooms>

## 后果

- 用户可以把比赛题、独立题和交互式靶场理解为同一学习路径，不会把它们误称为同一种产品。
- UI 用统一下拉列出可用、规划中、受限和本地自定义来源；只有可用来源进入题库，规划中或受限来源进入带真实能力范围、限制与官方入口的状态页，避免把配置按钮伪装成平台内容或留下死按钮。
- HTB CTF MCP 已通过本地确定性服务器验证 JSON/SSE、协议降级、分页、响应上限、凭据不泄漏与异常会话处理；下一步需要真实 Token 读取官方工具名，再实现赛事、实例和 Judge 三组白名单映射。
- TryHackMe 先保留清晰边界，不制造不可维护的集成。
