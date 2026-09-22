# 云 Agent（登录即用；手机一阶段 + 电脑端客户端）

> 文档状态：Target / Designed（传输是否锁定 Connect 仍待拍）
>
> 对齐日期：2026-09-22
>
> 本页是产品代码准入（Gate 1）。**只有「已与你对齐」可当实现依据；标「草案 / 待拍」的须再问。**
> 尚未实现。跟踪 issue：[#153](https://github.com/MilkSU-Official/milksu/issues/153)。
> 产品 UI 只写在仓库根目录 `AGENTS.md`，本页不复述 token 或原语数字。
>
> **与 [#131](https://github.com/MilkSU-Official/milksu/issues/131) / [远程控制](remote-control.md) 的分界：**  
> 远程控制 = 手机连**本机**执行。本页 = 云沙箱执行；二阶段扫电脑仍跟 #131。

## 已与你对齐

| # | 决定 |
| --- | --- |
| 沙箱 | **Cloudflare Sandbox** |
| 内核 | 云上 **Pi 和 DSH 都要**（同钉；按会话二选一） |
| 传输 | 先调研；你对 **Connect** 感兴趣（见专节介绍）。**是否定为第一包管道仍待你一句确认。** |
| 计量 | **只要展示，额度 / 硬拦先不做。** 模型费用 **models.dev** 价目估算。云 = 模型费 + 沙箱费；本地 = 仅模型费。 |
| 客户端 | 桌面云 + **原生**手机（**iOS 与 Android 并行**）；手机 **从 0** |
| 桌面切换 UI | 输入栏胶囊**外左下**（与审批 / 项目 / 分支同一带，像 Cursor）点一下：**本地 PC \| 云**。未开回合可自由切；**开过后切换要迁移。** |

## 用户要看见什么

- 登录后能开云会话；手机与电脑同一账户云会话。
- 每回合 / 累计消耗可见：本地只显示模型费；云显示模型费 + 沙箱费。
- 不在本阶段做「余额不足不能发」或充值。

## Connect 是什么（给你看的介绍）

[Connect](https://connectrpc.com/docs/introduction/)（Buf 家）是一套 **用 Protobuf 定义 API、在普通 HTTP 上跑 RPC** 的库族——可以想成「好用的、浏览器也友好的 gRPC 亲戚」。

| 点 | 说明 |
| --- | --- |
| 你写什么 | 一份很短的 `.proto`，生成服务端路由和**各语言类型安全客户端** |
| 三种协议 | 同一套服务默认可讲：**Connect 自有协议**、**gRPC**、**gRPC-Web**。客户端默认走 Connect 协议，也可拨成 gRPC |
| Connect 自有协议 | 跑在 **HTTP/1.1 / 2 / 3**；支持 unary 与 streaming；body 可以是 **JSON 或二进制 Protobuf**。甚至能用 curl 调 |
| 和「经典 gRPC」差别 | 经典 gRPC 强依赖 HTTP/2 帧语义，浏览器不能直接说；Connect 为浏览器 / 移动 / Node 设计。Cursor 的 SDK Bridge 也是 **Connect over HTTP/1.1**，并写明经典 gRPC 连不上 |
| 流式 | 有 server-streaming 等；适合「发一句、收回合事件流」 |
| 我们关心的语言 | **TypeScript**（桌面 Electron/renderer 或 preload）、**Swift**（稳定）、**Kotlin**（移动，beta）——和「原生双端 + 桌面」对得上 |
| 和 CF | Worker 侧可走 Connect / gRPC-Web 翻译路径；全双工 bidi 仍要按 CF 能力选型，实现时用证据 |

**和 WSS / SSE 怎么比（直觉）：**

- **SSE / 手工 JSON：** 实现轻，但类型与多端桩要自己维护。  
- **WSS + JSON 事件：** 双向自然，CF Agents 常用；契约要自管。  
- **Connect：** 契约在 `.proto` 里；桌面 / iOS / Android 生成同一套 RPC；流式用 HTTP，不必先上 WebSocket；需要时仍能兼容 gRPC 生态。

**草案倾向：** 若你确认，第一包客户端 ↔ Cloud API 用 **Connect（JSON 或 proto，server-stream 推事件）**；沙箱内 Pi/DSH 仍用各自 bridge/ACP，不要求浏览器直连容器 stdio。

## 沙箱与内核

**CF Sandbox**；镜像含钉版 **Pi + DSH**；按会话起一个。云一阶段只做云 Coding。Key 只在服务端。

```text
原生手机 / 桌面
  --(账户 Bearer + 待确认：Connect?)-->
Cloud API
  --> CF Sandbox → Pi 或 DSH → TokenFlux/官方（服务端凭据）
```

## 传输调研摘要（仍有效）

Codex Web：HTTP+SSE；Codex App Server 远程：WS 或 stdio JSON-RPC。  
Cursor Bridge：Connect / HTTP/1.1，非经典 gRPC。  
CF Agents：交互常 WebSocket，也可用 SSE。  
ACP：传输无关，JSON-RPC。

→ 没有唯一业界标准；**Connect 是与「原生双端 + 类型契约」最贴的成熟选项之一。**

## 消息 / RPC 契约（草案）

用 Connect 时：`.proto` 里定义 `CloudSessionService`（建会话、发回合、中止、审批）+ server-stream `Subscribe` / `Run` 推：

`session.snapshot` · `message.delta` · `thinking.*` · `tool.*` · `approval.requested` · `ask.requested` · `turn.settled`（带消耗明细）· `usage.updated` · `error`

载荷尽量对齐现有桌面 conversation 投影，避免第二套气泡协议。

## 计量与费用展示（已对齐）

| 场景 | 计什么 | 怎么算 |
| --- | --- | --- |
| **本地对话** | 仅 **模型费** | 用 **models.dev**（与现有 `knownModelPricing` / 发版刷新同源）按 token 估算；展示「约 …」，标明估算 |
| **云对话** | **模型费 + 沙箱费** | 模型同上；沙箱按秒（或活跃 CPU 折算）× 系数，Admin 可调系数 |
| 额度 | **不做** | 不硬拦、不扣钱包；只记账与展示 |
| 充值 | **后置** | |

落库：`usage_turn`（环境 `local|cloud`、kernel、model、tokens、sandbox_seconds、model_cost_est、sandbox_cost_est）。  
本地个人 Key 与账户云调用都可记模型费展示；沙箱费只出现在 `cloud`。

## 产品面

### 电脑：本地 / 云切换（已对齐位置）

- 位置：输入栏胶囊**外左下**，与审批 / 项目 / 分支同一行（`AGENTS.md` 已写）。  
- 交互：点一下在 **本地 PC** 与 **云** 之间切换「下一条对话开在哪」。  
- **未发出第一条消息：** 可自由切换，只影响新会话落点。  
- **已经开过回合再切换：必须走迁移**，不能静默清空或假装还在同一执行面。

#### 迁移（草案，细节可再问）

目标：用户从本地切到云（或反过来）时，**对话可继续，执行面换边**。

| 方向 | 草案行为 |
| --- | --- |
| 本地 → 云 | 创建（或关联）云会话；把当前可见抄本 / 附件策略迁到云沙箱；后续回合在 CF 跑；本地会话标记已迁移或保留只读 |
| 云 → 本地 | 在本机建关联会话；拉下需要的上下文 / 产物；后续回合用本机 Pi/DSH；云会话标记已迁出 |

实现前须再拍：是 **复制后分叉** 还是 **单一会话换宿主**；大工作区是否只迁对话不迁整盘。

### 手机（从 0，已对齐）

- **原生**：iOS（SwiftUI）+ Android（Kotlin）**并行**。  
- 主屏幕名 MilkSU；GitHub PKCE 登录 → 云会话列表 → 对话（流式、审批、消耗）。  
- 设计语言跟 `AGENTS.md` 意向 + 平台控件；不画假桌面壳。  
- 一阶段主路径只有云；扫电脑留给 #131。  
- 与桌面共用 Cloud API / 同一事件契约（若定 Connect，则双端生成客户端）。

## 上游阶梯

1. 账户 PKCE、钉版 Pi/DSH、models.dev 价目副本。  
2. CF Sandbox、R2、TokenFlux；Connect（若你确认）或你另选的管道。  
3. 用量展示、桌面左下切换 + 迁移、双端原生工程。

## 最小纵切

1. 本地回合：`usage_turn` 模型费（models.dev）可见。  
2. 云 Pi 一回合：模型费 + 沙箱费可见。  
3. 云 DSH 一回合。  
4. 桌面左下本地/云切换（空会话）+ 迁移最小路径（至少一种方向）。  
5. iOS 与 Android：登录 + 云对话各一轮。

## 成功怎么算

- 本地与云消耗展示符合「本地仅模型 / 云模型+沙箱」。  
- Pi 与 DSH 云回合通。  
- 左下切换与至少一条迁移路径真机可演示。  
- iOS、Android 各至少一轮云对话。  
- 无额度硬拦；Key 不上客户端。

## 下一轮只问这些

1. **传输是否就定 Connect 做第一包？**（是 / 否，否的话选 WSS 或 POST+SSE）  
2. 迁移策略：切环境是 **复制分叉** 还是 **同一会话换宿主**？  
3. 本地模型费：是否 **所有本地回合都记**（含个人 Key），还是只记账户模型来源？

## 检查点

1. 已拍：CF、双内核、计量展示、models.dev 模型费、云加沙箱费、原生双端并行、左下切换+迁移。  
2. 待拍：Connect 是否锁定、迁移语义、本地记账范围。  
3. #131 不阻塞。
