# 云 Agent（登录即用；手机 + 电脑客户端）

> 文档状态：Target / Designed
>
> 对齐日期：2026-09-22
>
> 本页是产品代码准入（Gate 1）。**「已与你对齐」可当实现依据。**
> 尚未实现。跟踪 issue：[#153](https://github.com/MilkSU-Official/milksu/issues/153)。
> 产品 UI 只写在仓库根目录 `AGENTS.md`，本页不复述 token 或原语数字。
>
> **与 [#131](https://github.com/MilkSU-Official/milksu/issues/131) / [远程控制](remote-control.md) 的分界：**  
> 远程控制 = 手机连**本机**执行。本页 = 云沙箱执行；二阶段扫电脑仍跟 #131。

## 已与你对齐

| 项 | 决定 |
| --- | --- |
| 沙箱 | **Cloudflare Sandbox** |
| 内核 | 云上 **Pi 和 DSH 都要**（同钉；按会话二选一） |
| 传输 | 客户端 ↔ Cloud API 第一包定 **Connect**（见下） |
| 计量 | **只展示，额度 / 硬拦 / 充值后置。** 模型费用 **models.dev** 估算，文案须说明「仅根据 models.dev 估算，方便统计，不是账单」。云 = 模型费 + 沙箱费；本地 = 仅模型费。**所有本地回合都记**（含个人 Key）。 |
| 云端凭据 | **允许用户用自己的 Key**（可配自定义中转站 / base URL）。加密存服务端，运行时注入沙箱；**明文永不下发客户端**、不进日志与模型上下文。也可继续用账户代持目录（登录即用、不必自带 Key）。 |
| 客户端 | 桌面云 + **原生**手机（**iOS 与 Android 并行**）；手机 **从 0** |
| 桌面切换 | 输入栏胶囊**外左下**点一下：**本地 PC \| 云**。未开回合可自由切；开过后走 **换宿主迁移** |
| 迁移 | **先复制到另一端，确认成功后再删源端**（安全换宿主，不是先删再碰运气，也不是永久双开分叉） |

## 用户要看见什么

- 登录后开云会话；手机与电脑同一账户云会话。
- 消耗可见且带估算说明；本地无沙箱费行。
- 左下可切本地 / 云；开过后迁移有明确进度与失败可回退（源端尚未删）。

## Connect（已定为第一包管道）

[Connect](https://connectrpc.com/docs/introduction/)：Protobuf 定义 API，在普通 HTTP 上 RPC；默认可兼容 gRPC / gRPC-Web。自有协议跑 HTTP/1.1+，支持 JSON 或二进制 Protobuf 与 streaming。Cursor SDK Bridge 同族（Connect over HTTP/1.1）。我们用 **TS + Swift + Kotlin** 生成客户端。

- 客户端 ↔ Cloud API：**Connect**（unary 建会话 / 发回合 / 审批；server-stream 推事件）。  
- 沙箱内 Pi/DSH：仍用各自 bridge / ACP，不要求客户端直连容器 stdio。  
- 编码：实现时在 JSON 与 proto 间择一默认（可双开），不另造第二套事件名。

调研背景（Codex SSE/WS、Cursor Connect、CF Agents WS、ACP 传输无关）见 Git 历史；现已锁定 Connect，不再并列待选。

## 沙箱与内核

**CF Sandbox**；镜像含钉版 **Pi + DSH**；按会话起一个。云一阶段只做云 Coding。  
凭据：**允许用户自带 Key（及自定义中转）**，或账户代持；一律只在服务端持有并注入沙箱。

```text
原生手机 / 桌面
  --(账户 Bearer + Connect)-->
Cloud API
  --> CF Sandbox → Pi 或 DSH → 用户自带中转/官方 或 账户代持上游
```

## RPC / 事件契约

`.proto` 定义 `CloudSessionService` + stream，推送对齐桌面 conversation 投影：

`session.snapshot` · `message.delta` · `thinking.*` · `tool.*` · `approval.requested` · `ask.requested` · `turn.settled`（消耗明细）· `usage.updated` · `error` · `migrate.*`（进度 / 成功 / 失败）

## 计量与费用展示

| 场景 | 计什么 | 怎么算 / 怎么说 |
| --- | --- | --- |
| 本地 | 仅模型费 | models.dev 价 × token；**所有本地回合都记**（账户与个人 Key） |
| 云 | 模型费 + 沙箱费 | 模型同上；沙箱秒 × 系数 |
| 文案 | 必有 | 「根据 models.dev 估算，方便统计，不是账单 / 实扣」中英成对 |
| 额度 | 不做 | 不硬拦、不扣钱包 |

落库 `usage_turn`：`local|cloud`、kernel、model、tokens、sandbox_seconds、model_cost_est、sandbox_cost_est、source（account/personal）。

## 产品面

### 电脑：本地 / 云切换

- 位置：胶囊外左下（`AGENTS.md`）。  
- 空会话：自由切换落点。  
- 已开回合：触发迁移，不可静默丢上下文。

### 换宿主迁移（已对齐）

**先复制到目标端 → 目标端可打开并校验成功 → 再删（或归档作废）源端。**

| 步骤 | 行为 |
| --- | --- |
| 1 复制 | 在目标环境建关联会话；抄本 / 必要附件按策略拷入（云则进沙箱+R2） |
| 2 校验 | 目标端能列出会话、打开抄本；用户或自动 smoke 通过 |
| 3 切换 | UI 落到目标会话；后续回合在新宿主跑 |
| 4 删源 | **仅成功后**删除或标记废弃源端；失败则保留源端、报错、不切过去 |

大工作区是否整盘拷贝：实现纵切再定边界（可先迁对话与明示附件，整盘后置），但「先复制成功再删」不变。

### 手机（从 0）

原生 iOS（SwiftUI）+ Android（Kotlin）并行。登录 → 云列表 → 对话（流式、审批、带说明的消耗）。一阶段主路径只有云；#131 扫码后置。Connect 生成双端客户端。

## 上游阶梯

1. 账户 PKCE、钉版 Pi/DSH、models.dev 价目副本。  
2. CF Sandbox、R2、TokenFlux、**Connect**。  
3. 用量展示、左下切换 + 先拷后删迁移、双端原生工程。

## 最小纵切

1. 本地回合用量（全记 + 估算文案）。  
2. 云 Pi：模型费 + 沙箱费展示。  
3. 云 DSH 一回合。  
4. 左下切换 + 迁移最小路径（先拷后删，至少一个方向）。  
5. iOS、Android 各一轮云对话。

## 成功怎么算

- 本地 / 云消耗展示与文案符合对齐表。  
- Pi 与 DSH 云通。  
- 迁移失败时源端仍在；成功后源端已清理、目标可续聊。  
- iOS、Android 各至少一轮。  
- Connect 契约有生成客户端；**用户 Key 明文不上客户端**（可配置，仅服务端保存）。

## 没有收益时怎么删

关 Cloud API / Sandbox；删桌面云入口与手机云面；用量表可只读归档。

## 实现顺序

1. Connect `.proto` + Cloud API 骨架 + 用量记账。  
2. CF 镜像 Pi→DSH。  
3. 桌面左下切换与迁移。  
4. iOS / Android 并行云对话。  
5. 额度、充值、#131：后置。

## 本仓落地进度（2026-09-22）

| 刀 | 状态 | 落点 |
| --- | --- | --- |
| 1 用量 + Connect 契约 | 骨架已进仓 | `internal/modelpricing`、`usage_turns`、`cloud/agent/proto`、Worker stub |
| 2–3 CF Pi/DSH | 骨架 | `cloud/agent/sandbox`；需 CF 绑定与镜像闭包 |
| 4 左下切换 + 先拷后删 | UI + Desktop RPC | `ComposerHostSwitch`、`migrateConversationHost`、`desktop/cloud-agent-client.cjs`（`CloudAgentInvoke`，Bearer 只在 Electron main）；云宿主 `SendTurn` 走同一代理 |
| 5 原生双端 | Connect-JSON 客户端 | `mobile/ios`、`mobile/android`（SwiftUI / Compose 列表骨架 + unary） |
| 云端 BYOK | 设置入口 | `CloudCredentialSettings` → `UpsertCredential`（服务端加密；明文成功后清空） |

桌面渲染进程**不得**持有账户 Bearer；云 unary 一律走 `CloudAgentInvoke`。
空画布可用 `pendingHost`；已开回合迁移成功后写入 `cloudSessionId`。
部署与密钥仍在 `milksu-admin` / CF 控制台（本 Agent 无该仓写权限）。
Subscribe 流式与真沙箱仍待 CF Sandbox 绑定。

## 检查点

Gate 1 主决策已对齐（含 Connect、先拷后删换宿主、全记本地估算、**云端允许自带 Key/中转且仅服务端持有**）。实现中碰到整盘迁移边界、Connect 默认 JSON vs proto 等细则再问，不回开已拍项。
