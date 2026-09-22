# 云 Agent（登录即用；手机一阶段 + 电脑端客户端）

> 文档状态：Target / Designed
>
> 对齐日期：2026-09-22
>
> 本页是产品代码准入（Gate 1）和已对齐决策。实现以本页为准。
> 尚未实现。跟踪 issue：[#153](https://github.com/MilkSU-Official/milksu/issues/153)。
> 没有代码、安装包或真机回执之前，不得写成已发行。
> 产品 UI 只写在仓库根目录 `AGENTS.md`，本页不复述 token 或原语数字。
>
> **与 [#131](https://github.com/MilkSU-Official/milksu/issues/131) / [远程控制](remote-control.md) 的分界：**  
> 远程控制 = 手机连**本机** MilkSU 执行。  
> 本页 = Agent 在**云沙箱**里跑；手机与电脑都是客户端。二阶段扫电脑 / 局域网 / Tailscale 隧道仍跟 #131，不进本页第一包。

## 用户要看见什么

登录 MilkSU 账户后，不用配本机沙箱、也不用开着电脑，就能开云会话：发消息、看流式正文与工具过程、解审批卡、下产物。

- **手机一阶段：** 账户登录 → 云会话列表 → 一条云对话（流式 + 审批）。不连本机、不扫码。
- **电脑端：** 在本地工作区之外多一个「云」环境；同一套账户下的云会话与手机共用。
- **计费 / 配额：** 账户有可见余额与用量；模型调用与云沙箱时长都从 MilkSU 账户扣；不够时产品内明确提示，不静默失败。

理想态：登录就有可试额度；充值或 Admin 发配额后可稳定用。  
底线：内测可用 Admin 发配额跑通一整条云回合；桌面与手机看到同一会话事件。

## 为什么重开计费

此前产品链退出了 MilkSU 自有余额 / 扣费流水，模型只走用户级 TokenFlux Key 或本机个人 Key（见历史 `security-workspace-product-plan`）。  
**该决定对云 Agent 过时：** 云沙箱是 MilkSU 的成本；「登录即用」不能要求用户自己去 TokenFlux 控制台管 Key，也不能让手机直连 Provider。  
本地个人 Provider Key 路径仍可保留、不强制进 MilkSU 账本；**账户云 Agent 路径必须走 MilkSU 计费与配额。**

## 沙箱选型

| 选项 | 结论 |
| --- | --- |
| **Cloudflare Sandbox（首选）** | 已有 `accounts.milksu.org`（Worker / D1 / Admin）。Containers 按活跃 CPU 计、可缩到零；`$5` Workers Paid 含基础量。与账户栈同云，运维面最小。工作区用 R2 挂载持久化（容器休眠后内存盘会丢）。 |
| E2B | 编码 Agent 最常见；隔离与 pause/resume 更强，但 wall-clock 计费、Pro 底价更高。仅当 CF 装不下钉版 Pi + Node、或会话时长 / 隔离不够时再退。 |
| Modal 等 | 单价与运维不占优，第一包不选。 |

第一包：**Cloudflare Sandbox**。镜像自带钉死的 Pi sidecar 与最小工具链；实例档位从 `basic` 起评，不够再升，不默认 `standard-4`。

## 跑什么、怎么回传

### 所有权

| 责任 | 所有者 |
| --- | --- |
| 模型 Session、压缩、Tool Loop | 云里的 **Pi 或 DeepSeek Harness（DSH）**（与桌面同钉版本；二选一；不另造 harness，不复刻 `dsh web`） |
| 账户、登录、余额、配额、沙箱生命周期、会话元数据、事件扇出 | **MilkSU**（`milksu-admin` Worker + D1 + R2；可扩独立 `agent.*` 主机名） |
| 桌面授权、本机 Computer Use、本机 CTF Judge | **仍只在本机**；第一包云会话不做 |

第一包云会话范围：**云 Coding**（文件 / shell / 网页工具在沙箱内）。不做：CTF Judge、Computer Use、Browser Use 挂用户 Chrome、看板娘本机编排。

### 内核：Pi 与 DSH

桌面已是「新对话可选 Pi 或 DSH，出厂默认 Pi；设置 → 模型默认运行时只改新对话」。云会话跟同一产品契约，不做成「云只用 Pi」。

| 项 | 决定 |
| --- | --- |
| 产品 | 新建云会话可选 `pi` / `dsh`；默认跟账户或客户端上的「默认运行时」（出厂 Pi）。已建会话的 kernel 不改写。 |
| 镜像 | 沙箱镜像同时打进钉版 Pi 与钉版 DSH（与桌面 sidecar 同钉）。按会话启动对应进程，不跑两套并行 harness 抢同一工作区。 |
| 事件 | 客户端只消费 **Cloud Session Protocol**（与现有桌面 conversation / Working 投影对齐）。Pi 与 DSH 的差异停在云端适配层，不向手机/电脑暴露第二套气泡协议，也不搬 DSH 原厂 GUI。 |
| 结算 | `turn.settled` 在该内核本回合真正结束后再扣费。DSH 须等 ACP 回合 idle（含子代理 / Multitask 子会话策略与桌面一致）再结算，避免半回合漏扣或重复扣。 |
| 实现顺序 | **冒烟先 Pi**（镜像小、路径熟）。**一阶段收口前必须接上 DSH**（建会话选 DSH → 一流式回合 → 扣费）。缺 DSH 不算云 Agent 一阶段完成。 |
| 不做 | 为「两个内核看起来一样」另造 MilkSU 自有 prompt 路由或第二套通用 harness；云端复刻 `dsh web` / Queue dock / Jobs 顶栏。 |

### 进程形状

```text
手机 / 电脑客户端
  --(HTTPS + WSS, Bearer session)-->
MilkSU Cloud API (Worker)
  --(计量、启停)-->
CF Sandbox 容器
  └── Pi sidecar  或  DSH（ACP）  （按会话二选一）
        --(服务端持有的模型凭据)--> TokenFlux / 官方 Provider
```

- Provider API Key **只在服务端**注入沙箱环境；永不下发到手机或桌面 renderer，不进模型上下文与日志正文。
- 客户端不直连 TokenFlux。

### 消息格式（Cloud Session Protocol）

外层：`wss://`（或 HTTPS SSE 降级）+ 现有账户 Bearer。  
内层帧与桌面事件投影对齐，便于电脑 / 手机共用渲染：

| 方向 | 类型 | 用途 |
| --- | --- | --- |
| C→S | `session.create` / `session.list` / `session.open` | 建、列、打开云会话 |
| C→S | `turn.send` | 用户句 + 附件引用 |
| C→S | `turn.abort` / `approval.respond` / `ask.respond` | 停止与人机选择 |
| S→C | `session.snapshot` | 标题、状态、用量摘要 |
| S→C | `message.delta` / `thinking.*` / `tool.*` | 流式正文与过程 |
| S→C | `approval.requested` / `ask.requested` | 审批与 `milksu_ask` |
| S→C | `turn.settled` | 结束；带本回合 token / 沙箱秒数 / 扣费 |
| S→C | `billing.updated` / `error` | 余额变化与可读错误 |

规则：

- 事件名与载荷字段尽量复用现有桌面 conversation 投影；云特有字段进显式命名空间（如 `cloud.sandboxId`），不发明第二套聊天气泡协议。
- 工具结果仍遵守 Pi `tool_result` 上界；完整产物进 R2，客户端只拿列表与下载 URL。
- 不计费细节、原始 Provider 错误码、Key 材料不得出现在用户可见 `detail` 里（映射成中英成对文案）。

## 计费与配额

### 账本（MilkSU 持有）

在 `milksu-admin`（D1）恢复并扩展：

| 表 / 概念 | 作用 |
| --- | --- |
| `wallet` | 用户余额（最小货币单位或积分；一种单位即可） |
| `ledger` | 不可变流水：发放、充值、扣模型、扣沙箱、退款、调整 |
| `usage_turn` | 每回合：input/output/cache tokens、模型 id、沙箱秒数、费用拆分 |
| `quota_policy` | Admin 可配：日/月上限、并发沙箱数、单会话最长墙钟 |

扣费时机：`turn.settled` 时按实测结算；若余额在回合中耗尽 → 中止工具循环、可见「余额不足」，已产生费用入账。

### 价目

- **模型：** 以 TokenFlux / 官方价或钉死的估算表计价；个人资料「约 $…」仍可保留为展示，**账户扣费以 ledger 为准**。
- **沙箱：** 按 CF Containers 成本加固定系数，或按「沙箱积分 / 分钟」简化；Admin 可调系数，不把 CF 原始账单暴露给用户。

### 第一包资金来源

1. Admin 发放内测额度（必做）。  
2. 用户自助充值（Stripe 等）可后置；未接支付前 UI 只显示余额与「联系发放」，不假装能付款。  
3. 本机「个人 Provider Key」Coding **不走** 本账本；只有 **账户云 Agent**（以及若继续提供的账户模型代理）走账本。

### 与旧「用户级 TokenFlux Key 下发」的关系

- 云 Agent：**改为服务端池或服务端代持**，客户端不再依赖静默同步下来的 Key 才能聊云会话。  
- 桌面本地账户模型：可继续短期兼容已下发 Key；新设计以「账户余额 + 服务端调用」为准，迁移在实现纵切里做干净切换，不为旧代理计费写双写兼容层。

## 产品面

### 电脑

- 环境切换：本地 | 云（命名跟产品文案，中英 `t()`）。  
- 云会话进侧栏同一套会话行 chrome（钉选 / 归档 / 相对时间）；数据源是 Cloud API，不是本机 jsonl。  
- 对话列复用 Coding 输入栏契约（胶囊、模型芯片只读展示账户可选模型、审批、用量）。  
- 设置 / 个人资料：余额、本月用量、并发占用；不把 API Key 放进 toast。

### 手机一阶段

- 原生 iOS 先（主屏幕名 MilkSU），Android 后。  
- 面：登录 → 云会话列表 → 对话。不要搬侧栏、右栏浏览器、Computer Use。  
- 设计语言跟 `AGENTS.md`；真机导航，不画假桌面壳。  
- 与 #131 远程控制的「连接 / 扫码」面分开；一阶段不出现扫电脑。

## 上游阶梯

1. 现有：GitHub PKCE 账户、`accounts.milksu.org` Worker/D1、桌面事件投影、钉版 Pi。  
2. 固定机制：Cloudflare Sandbox SDK、R2、WSS、TokenFlux HTTP。  
3. 自有最小层：Cloud Session API、wallet/ledger、客户端云环境适配、iOS 云对话面。

不在客户端重造 Pi；不在手机里跑工具循环。

## 最小可交付纵切

1. Admin 给用户发余额 → 桌面登录 → 建 **Pi** 云会话 → 一回合流式（含至少一次沙箱内 shell）→ `turn.settled` 扣费 → 余额可见。  
2. 同一账户再建 **DSH** 云会话 → 一回合流式 → 扣费（与 Pi 同一账本与事件协议）。  
3. 同一账户在第二台客户端（先桌面双开或预览页，再 iOS）打开同一会话看到连续事件。  
4. 余额为 0 时拒绝新回合，文案明确。

## 成功怎么算

- 真账户：发额度 → Pi 与 DSH 云回合各至少一次成功 → ledger 有模型 + 沙箱流水。  
- 真机桌面：云环境分别用 Pi / DSH 发一句，流式 + 工具过程 + 结算后余额变化。  
- 真机 iOS：登录 → 发一句 → 流式；与桌面同一 `sessionId`（kernel 与桌面创建时一致）。  
- 逻辑测试：无 Bearer 拒；余额不足拒；Key 不上客户端；并发沙箱上限生效；错误 kernel 名拒建会话。

没有这些回执，只算 Designed，不算完成。

## 没有收益时怎么删

关掉 Cloud API 路由与 Sandbox 绑定；删除云客户端入口、wallet UI、iOS 云面。已产生 ledger 可只读归档。不留「空的云环境」开关。

## 三端与不是开发者的用户

- 云执行在 CF，与 macOS / Windows / Linux 桌面客户端无关；三端桌面都能当客户端。  
- 配置面：登录账户即可；不要求用户建 CF 账号、装 `cloudflared`、或导出环境变量。  
- 平台暂时做不到的（如某档沙箱镜像缺工具）写在产品 UI 与当前目标，不把本机开发者路径当成交付。

## 实现顺序

1. 本页准入（已完成对齐则按本页实现）。  
2. `milksu-admin`：wallet / ledger / 发配额 API + Admin UI。  
3. Cloud API + CF Sandbox + **含 Pi 的**镜像；桌面云 Pi 冒烟 + 扣费。  
4. 同一镜像打进 **DSH**；桌面云 DSH 一回合 + 扣费；事件协议无分叉。  
5. 余额不足路径。  
6. iOS 一阶段登录 + 云对话（Pi / DSH 均可开）。  
7. 自助充值、Android、更强持久化 / 多会话策略：后置。

不要先做手机再把协议绑死在临时 HTTP；不要先做 #131 扫码冒充云 Agent；不要只交付 Pi 云就算一阶段完成。

## 关键节点

1. 准入即本页；计费重新进入产品链；云会话内核含 Pi 与 DSH。  
2. 沙箱选定 CF；退 E2B 必须有装不下钉版 Pi+DSH 的证据。  
3. 服务端持 Key；客户端只持账户 session。  
4. 桌面云 Pi 一回合 + 扣费。  
5. 桌面云 DSH 一回合 + 扣费。  
6. iOS 云一回合。  
7. 与 #131 远程控制分发行线，互不阻塞。
