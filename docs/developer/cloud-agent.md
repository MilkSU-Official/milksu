# 云 Agent（登录即用；手机一阶段 + 电脑端客户端）

> 文档状态：Target / Designed（部分条款待下一轮拍板）
>
> 对齐日期：2026-09-22
>
> 本页是产品代码准入（Gate 1）。**只有下方「已与你对齐」的条目可当实现依据；其余是调研与草案，须再问再定。**
> 尚未实现。跟踪 issue：[#153](https://github.com/MilkSU-Official/milksu/issues/153)。
> 没有代码、安装包或真机回执之前，不得写成已发行。
> 产品 UI 只写在仓库根目录 `AGENTS.md`，本页不复述 token 或原语数字。
>
> **与 [#131](https://github.com/MilkSU-Official/milksu/issues/131) / [远程控制](remote-control.md) 的分界：**  
> 远程控制 = 手机连**本机** MilkSU 执行。  
> 本页 = Agent 在**云沙箱**里跑；手机与电脑都是客户端。二阶段扫电脑 / 局域网 / Tailscale 隧道仍跟 #131，不进本页第一包。

## 已与你对齐（2026-09-22）

| # | 你的决定 |
| --- | --- |
| 1 | 沙箱用 **Cloudflare Sandbox** |
| 2 | 云内核 **Pi 和 DSH 都要**（与桌面同钉；按会话二选一） |
| 3 | 传输：**先调研成熟实现**，不先拍死 WSS / gRPC |
| 4 | 计费：**先做计量与消耗展示**；充值、复杂钱包等后置 |
| 5 | **桌面云客户端 + 手机 App 都做**；手机 App **从 0 开始**（不是壳套桌面） |

## 用户要看见什么

登录 MilkSU 账户后，不用配本机沙箱、也不用开着电脑，就能开云会话：发消息、看流式正文与工具过程、解审批卡、下产物；并看到本回合 / 累计消耗。

- **手机（从 0）：** 独立原生 App → 账户登录 → 云会话列表 → 云对话（流式 + 审批 + 用量）。一阶段不连本机、不扫码。
- **电脑：** 本地工作区之外的「云」环境；与手机同一账户、同一云会话。
- **消耗：** 模型 token 与沙箱时长可计量、可展示；第一包不要求自助充值闭环。

## 为什么要计量（相对旧「无自建计费」）

云沙箱是 MilkSU 成本；登录即用也不能让手机直连 Provider。  
历史「退出余额 / 只下发 TokenFlux Key」对云路径过时。  
**本阶段范围：** 算清楚消耗并落库展示；发放额度 / 硬拦截 / 自助充值等另轮再定（见「计费」节待拍项）。

## 沙箱

**已对齐：Cloudflare Sandbox。**

镜像打进与桌面同钉的 **Pi + DSH**；按会话只起其中一个。工作区用 R2 挂载持久化。实例档位实现时再评，不默认拉满。

仅当有「钉版 Pi+DSH 装不进 / 时长隔离不够」的证据时，再提案退 E2B——须再问你。

## 跑什么

| 责任 | 所有者 |
| --- | --- |
| Session / 压缩 / Tool Loop | 云里的 **Pi 或 DSH**（二选一；不另造 harness；不复刻 `dsh web`） |
| 登录、沙箱生命周期、会话元数据、事件扇出、用量记账 | **MilkSU**（`milksu-admin` / Cloud API + D1 + R2） |
| Computer Use、本机 CTF Judge、看板娘本机编排 | **本机 only**；云一阶段不做 |

云一阶段范围：**云 Coding**（沙箱内文件 / shell / 网页类工具）。

内核产品契约与桌面一致：新建可选 `pi` / `dsh`，出厂默认 Pi；已建不改写。冒烟可先 Pi，**收口前必须 Pi 与 DSH 都通**。

```text
手机 App（从 0） / 桌面云客户端
  --(账户 Bearer + 待定传输)-->
MilkSU Cloud API
  --(启停、计量)-->
CF Sandbox
  └── Pi 或 DSH
        --(服务端凭据)--> TokenFlux / 官方 Provider
```

Key 只在服务端；客户端不直连 TokenFlux。

## 传输：成熟实现调研（待你拍板）

**契约先定事件形状；管道后定。** 下面是调研摘要，不是已定案。

### 别人怎么做

| 产品 / 协议 | 客户端 ↔ 控制面 | 控制面 ↔ 内核 | 要点 |
| --- | --- | --- | --- |
| **OpenAI Codex** | Web：**HTTP + SSE** 收任务事件；桌面/远程 App Server：**JSON-RPC over stdio 或 WebSocket** | 容器内 App Server ↔ harness 多为 **stdio JSON-RPC**（可再隧道） | 浏览器走 SSE；需要双向（审批/打断）时用 WS 或本地 stdio |
| **Cursor** | 编辑器 ACP：**JSON-RPC over stdio**；跨语言 SDK Bridge：**Connect-RPC over HTTP/1.1**（unary + server-stream） | 本地 bridge / CLI | **明确写：经典 gRPC/HTTP2 连不上** Bridge；用 Connect 或普通 POST+流式帧 |
| **Agent Client Protocol (ACP)** | 传输无关；首选 stdio；Streamable HTTP 草案中；允许自定义 | 同左 | 绑定 JSON-RPC 生命周期，不绑定 WSS |
| **Cloudflare Agents** | 交互聊天主推 **WebSocket**（`AgentClient` / `useAgent`）；也可 **HTTP SSE** | Worker / DO / Sandbox | 与我们同云；双向状态与打断用 WS 更顺 |
| **远程 ACP 网关（社区）** | 常把 stdio ACP **桥成 WebSocket** 给远端编辑器 | 每连接一个 agent 子进程 | 说明「远端客户端 + 本地/容器内核」的常见拼法 |

### 对 MilkSU 的含义

1. **业界没有「必须 WSS」或「必须 gRPC」。** 成熟栈多是：**JSON 事件 / JSON-RPC** +（**SSE** 或 **WebSocket** 或 **Connect 流**）。  
2. **经典 gRPC** 不是 Cursor 云/Bridge 路线，在浏览器/Electron 还要 gRPC-Web；CF Worker 上全双工 bidi 也更绕。适合以后「强类型原生 API」另开，不宜当第一包唯一管道。  
3. **与我们栈最贴的两条成熟拼法：**  
   - **Codex Web 同构：** `POST` 发回合 + **SSE** 收事件；审批/中止另 `POST`。  
   - **CF Agents / Codex App Server 远程同构：** **WSS** 上跑同一套 JSON 事件（或 JSON-RPC），便于打断与多端在线。  
4. 沙箱内 Pi/DSH 仍用各自已有通道（Pi bridge / DSH ACP）；**不要**要求浏览器直连沙箱里的 stdio。

### 草案建议（**须你确认后才算对齐**）

- 第一包客户端 ↔ Cloud API：**WSS 上的 JSON 事件流**，或 **POST+SSE**（二选一，实现前再问一轮）。  
- **不**把经典 gRPC 定为第一包。  
- 若你强烈要 typed RPC：倾向 **Connect 风格（HTTP/1.1 + protobuf/JSON）** 对齐 Cursor Bridge，而不是裸 gRPC。

## 消息格式（草案：事件契约）

与桌面 conversation / Working 投影对齐，手机与电脑共用同一套，避免第二套气泡协议：

| 方向 | 类型 | 用途 |
| --- | --- | --- |
| C→S | `session.create` / `list` / `open` | 建、列、打开 |
| C→S | `turn.send` / `abort` / `approval.respond` / `ask.respond` | 回合与人机 |
| S→C | `session.snapshot` | 标题、kernel、状态、累计消耗摘要 |
| S→C | `message.delta` / `thinking.*` / `tool.*` | 流式与过程 |
| S→C | `approval.requested` / `ask.requested` | 审批与选项卡 |
| S→C | `turn.settled` | 结束 + **本回合消耗明细** |
| S→C | `usage.updated` / `error` | 用量刷新与可读错误 |

工具结果遵守内核 `tool_result` 上界；大物进 R2。用户可见文案中英成对，不泄露 Key / 原始计费秘文。

## 计费：先算消耗（已对齐范围）

**已对齐：先计量、算消耗、能展示；充值与其它资金能力后置。**

| 做 | 不做（本阶段） |
| --- | --- |
| 每回合记录：模型 id、input/output/cache tokens、沙箱秒数、估算费用 | 自助充值 / Stripe |
| `usage_turn` 落 D1；桌面与手机能看本回合与累计 | 完整「钱包充值商城」 |
| Admin 发内测额度或开关（若硬拦截需要——**待问**） | 对外标价页、发票 |

价目：模型用钉死表或 TokenFlux 价；沙箱用简化「秒 × 系数」。个人资料本地「约 $…」可继续只做展示。

本机个人 Provider Key 的本地 Coding **不进** 云消耗账本。

## 产品面设计

产品 chrome 数字与 token 只写在 `AGENTS.md`。本节只定信息架构与从 0 的面。

### 电脑（桌面 App 云环境）

在现有 React + shadcn 壳上加「云」，不新开第二套桌面。

| 面 | 行为 |
| --- | --- |
| 环境 | 可切换 **本地 \| 云**（文案 `t()`）。云下侧栏会话来自 Cloud API。 |
| 侧栏 | 同一套会话行 chrome（相对时间、钉选、归档…）；数据源换云。 |
| 对话列 | 复用 Coding 输入栏契约：胶囊、模型、**运行时 Pi/DSH**、审批、用量环 / 消耗摘要。 |
| 空态 | 云下新对话：产品标题取向「我们要构建什么」同类，标明在云上；不教学长文。 |
| 资料 / 设置 | 云消耗（本月 token、沙箱时长、估算）；不把 Key 放进 toast。 |
| 不做（云一阶段） | 云会话里开 Computer Use / 本机文件夹选择器冒充云盘。 |

### 手机 App（从 0）

独立原生工程（不是 Electron 套壳、不是把桌面 DOM 塞进 WebView 当主 UI）。主屏幕名 **MilkSU**。

**一阶段信息架构（草案，细节可再问）：**

```text
登录（GitHub PKCE，复用账户体系）
  → 主页：云会话列表（搜、新建、相对时间）
      → 对话：流式正文、过程/工具、审批/Ask、输入栏、消耗
  → 账户：资料、本月消耗、退出
  →（预留，一阶段可隐藏）连接本机 → 交给 #131
```

| 原则 | 说明 |
| --- | --- |
| 真机导航 | 系统导航栏 / 大标题列表；不画假桌面侧栏，不画假 iPhone 套桌面。 |
| 设计语言 | 跟 `AGENTS.md` 的材料意向（冷白/夜间表面、液态玻璃浮层、强调色、双语 `t`）；控件用平台原生（SwiftUI / Android 对等），不 vendor 第二套战术皮。 |
| 对话 | 与桌面云同一事件契约；忙时同样能停、能回审批。 |
| 新建 | 选 kernel（Pi/DSH）与模型（账户目录）；工作区在沙箱内，不远程选本机文件夹。 |
| 与 #131 | 「扫码连电脑」是后期入口，一阶段主路径只有云。 |

**平台：** 你已说手机与桌面都做。草案按 **iOS + Android 都进一阶段**；若要「先 iOS 真机收口再 Android」须再拍。

**技术栈（未对齐，下一轮问）：** 原生 SwiftUI+Kotlin，或跨端（RN / Flutter）等——**未定，不写进实现依据。**

## 上游阶梯

1. 现有账户 PKCE、`accounts.milksu.org`、桌面事件投影、钉版 Pi/DSH。  
2. CF Sandbox SDK、R2、TokenFlux；客户端传输在你拍板后锁定一种成熟拼法。  
3. 自有：Cloud Session API、用量记账、桌面云环境、**从 0 的手机工程**。

## 最小可交付纵切（草案）

1. 用量记账 API + Admin 可查 → 桌面云 **Pi** 一回合流式 + `turn.settled` 消耗可见。  
2. 桌面云 **DSH** 一回合 + 消耗。  
3. 手机从 0：登录 → 列表 → 对话一轮（Pi 或 DSH）与桌面同 `sessionId`。  
4.（可选，待问）额度用尽是否硬拦。

## 成功怎么算

- Pi 与 DSH 云回合各至少一次；`usage_turn` 有模型 + 沙箱字段。  
- 真机桌面云环境可用。  
- 真机手机 App（从 0）登录并发一句、见流式与消耗。  
- Key 不上客户端。

## 没有收益时怎么删

关 Cloud API / Sandbox；删桌面云入口与手机工程云面；用量表可只读归档。

## 实现顺序（草案）

1. 本页：把「待拍」问完再大面积写码。  
2. 用量记账 + Cloud API + CF 镜像（Pi→DSH）。  
3. 桌面云客户端。  
4. 手机工程从 0：登录与云对话。  
5. 充值、#131 扫码、支付：后置。

## 下一轮要问你的（未对齐）

1. 传输第一包定 **WSS JSON**，还是 **POST+SSE**，还是要上 **Connect**？  
2. 手机一阶段 **iOS+Android 并行**，还是 **先 iOS 收口**？  
3. 手机技术栈偏好？（原生 / RN / Flutter / 其它）  
4. 消耗是否要 **硬拦截**（没额度不能开回合），还是先只展示？  
5. 桌面「本地 \| 云」切换放在侧栏头、工作区菜单，还是别处？

## 关键节点

1. 你已拍：CF、双内核、先计量、双端（手机从 0）。  
2. 传输与手机栈 / 平台节奏：下一轮拍。  
3. 实现按冒烟 → 双内核 → 桌面云 → 手机云。  
4. #131 不阻塞本页。
