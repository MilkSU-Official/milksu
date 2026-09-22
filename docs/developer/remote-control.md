# 远程控制（手机连本机 MilkSU）

> 文档状态：Target / Designed
>
> 对齐日期：2026-09-21
>
> 本页是产品代码准入（Gate 1）和已对齐决策。实现以本页为准，不以调研对话或旧隧道设想为准。
> 尚未实现。跟踪 issue：[#131](https://github.com/MilkSU-Official/milksu/issues/131)。
> 没有代码、安装包或真机回执之前，不得写成已发行。
> 产品 UI 只写在仓库根目录 `AGENTS.md`，本页不复述 token 或原语数字。

## 用户要看见什么

手机 App 是 **本机 MilkSU 的远程渲染器**，不是 Cursor 那种云 Agent，也不是远程桌面。

- 执行面只在已打开的桌面进程：Pi / DSH、凭据、工具、Judge、工作区都留在电脑上。
- 手机看见：桌宠对话（第一优先）、普通会话列表与一条会话的输入栏（第二优先）、确认/审批、连接状态。
- 用户不填 Cloudflare 账号、不装 `cloudflared`、不跑仓库脚本。设置里打开远程、在电脑旁扫码即可。

理想态（C）：出门用蜂窝也能连、能说话，桌宠 + 会话 + 审批都在。  
底线（A）：同一 Wi-Fi 必须能说话。蜂窝挂了时局域网这条还在。

## 为什么不是 Cloudflare 隧道

CF Tunnel 是「把本机 HTTP 发布到公网」，不是设备网格。MilkSU 代开则中继默认能看 TLS 终止后的明文；用户自建则过不了产品化（要 CF 账号和域名）。两者都不当骨架。隧道、Tailscale、自建 WSS 只允许作为 **可替换哑管道**。

## 最小可交付纵切

设置打开远程 → iPhone 扫码 → 同网对桌宠发一句并看到流式 → 确认卡能在手机上按。  
同一条线上接着：官方盲中继让蜂窝可用、会话列表、审批、新对话「+」、照片和文件附件。

不做：APNs、常驻守护进程、云端存对话、远程桌面、手机直连 TokenFlux。

## 上游阶梯

1. 本机：mDNS / 局域网、系统相机扫码、现有桌宠与会话 RPC。
2. 固定机制：WSS/TLS 1.3（443）、Noise（与 WireGuard 同族）、现有 Desktop RPC 帧与方法名、browsercap 那种 pairing 文件形状。
3. 自有最小层：每台电脑一个 Phone Gateway、本机设备名单、`remote_client` 白名单、开源盲中继（只对拷密文）。

不在手机里跑 Pi，不另造 Agent，不嵌 `cloudflared`。

## 成功怎么算

- 真机：扫码后同 Wi-Fi 桌宠一轮（流式 + 确认）。
- 真机：蜂窝经官方中继再来一轮，中继日志无正文。
- 真机：点进已有会话发一句、解一条 `approval.requested`。
- 逻辑测试：白名单拒凭据方法、撤销后旧票作废、relay 日志契约。

没有这些回执，只算 Designed，不算完成。

## 没有收益时怎么删

关掉设置开关即停监听。删除：Gateway 包、`remote_client` 源、远程设置行、iOS/Android 工程、中继二进制。设备名单是本机文件，随开关清或整份丢掉。不留「以后可能要」的空中继账号协议。

## 三端与不是开发者的用户

- 桌面主机：macOS / Windows / Linux 同一套能力。第一包用 iOS 连 Mac 验收即可，不得把某一端当成唯一交付。
- 手机：原生 iOS 先（主屏幕名 MilkSU），Android 后做。iPad 当大号 iPhone。
- 配置面：设置 → 远程的开关、QR、已配对列表、管道（自动 / 仅局域网 / 自定义中继 URL）。官方中继 `wss://` 预置。隐藏环境变量和「自己去建 CF 隧道」不是配置面。
- 通道只在本机 MilkSU 进程还在时存在。关主窗但菜单栏/托盘仍在（与现有桌宠相同）则还能连；`Cmd+Q` / 退出进程或合盖休眠则手机写「电脑不在」。不另做常驻 daemon。防休眠以后再改。

## 信任

- 第一次配对必须在电脑旁边扫码（或 6 位码）。信任来自设备密钥，不来自账号密码，也不支持隔空首次配对。
- 之后管道里只有密文。中继、CDN、运营商只应看到「谁在传多重的包」。
- 实现与中继开源，构建可核对，不留后门。这是用户可以接受官方托管盲中继的前提。
- E2E 不保证：手机解锁后被盗用、电脑中毒、实现写错。丢手机：在那台电脑的已配对列表里撤销。
- 第一包不做 APNs。打开 App 才看见确认和审批。以后若做推送，通知只写类型，不写 prompt。

## 简单后端（多机多手机不升级成网）

不做云端舰队、不做对话上云、不做打洞网格。

| 块 | 做什么 |
| --- | --- |
| 每台电脑 | 自己的密钥、已配对手机名单、Gateway。电脑之间互不知道。 |
| 每台手机 | 本机保存已配对电脑。连接页切换 = 断开 A、握手连 B。同时只连一台。 |
| 官方中继 | 两边出站 WSS；用配对密钥证明身份后对拷字节。一对（电脑 × 手机）一条管道。 |

局域网能直连就绕过中继。多一台手机 = 名单多一行 + 多一条管道。

### 协议

- 外层：`wss://` TLS 1.3，端口 443。
- 内层：Noise XX（或同族），扫码交换并销钉静态密钥。
- 帧（E2E 明文，管道只见密文）：`invoke` / `result` / `event` / `ping`，方法名复用 Desktop RPC。
- 新 source：`remote_client`。按设备 grant 白名单调用。手机不能冒充 `electron_host`。

### 官方中继

运营者出机器和域名。App 预置该 `wss://`；设置可改为仅局域网或自定义 URL。  
中继日志：时间、票/设备 id、字节数、断开原因。默认不写 IP、不写 payload。  
中继不进桌面默认启动路径；独立开源二进制。

## RPC 白名单

桌宠：`EnsureCompanion`、`SendCompanionMessage`、`AbortCompanionTurn`、`GetCompanionStatus`、`GetCompanionBoard`、`ListCompanionTranscript`、`ConfirmCompanionDispatch`、`ApproveCompanionMemory`、`ForgetCompanionMemory`；`companion-event` 全量扇出。

会话：会话列表投影（不要整份 `messages[]`）、分页 transcript、`SendMessage` / `SteerMessage` / `AbortMessage` / `QueueDshMessage`、`RespondToolApproval`；只推当前订阅的 `conversationId`。

永不代理：凭据读写、全量设置、文件选择器、`shell.openExternal`、插件安装、Computer Use 锁窗、任意本机路径。

附件：手机上传到网关，再走现有 `ImportCodingAttachments` / `preparePromptAttachments`。限额与桌面相同：每条 8 个、单文件 32 MiB、合计 96 MiB。禁止远程读盘路径。

## 产品面（抄 Codex 环境模型）

手机三个面：Milk（桌宠）、会话、连接。不要搬侧栏、右栏浏览器、Computer Use 或整页设置。真机不要再画一层假 iPhone 壳。设计语言跟 `AGENTS.md`，壳按真机导航改。

- 主屏幕名：MilkSU。语言和外观在 App 内自设，不跟当前电脑。
- 会话「+」：选类型；工作区用那台电脑该类型上次路径，否则产品文档目录；模型用桌面默认。不远程选文件夹。
- 一台电脑可配对多台手机；确认/审批与桌面同一套，谁先按谁算。
- 多台电脑是 Codex 式环境列表：对话不跨电脑合并。

## 关键节点

1. 准入即本页。没过本页不要嵌 `cloudflared`。
2. 本机网关 + 扫码 + 局域网桌宠。
3. E2E 握手（此后任何管道都只搬密文）。
4. 手机能解 `companion.confirm`。
5. 盲中继上线（域名由运营者提供）。
6. 会话列表 + `RespondToolApproval`。
7. 推送与防休眠：明确不做或以后再开。
8. iOS 上架与 Android：独立于桌面 DMG 的发行线。
9. 撤销与丢失手机。

## 实现顺序

协议和局域网桌宠 → 中继 → 会话/审批/附件 → TestFlight → Android。  
不要先做 App 再把 UI 绑死在一条隧道上。
