# 靶机、环境经纪与活靶面

> 文档状态：**Implementing / Not shipped**（开发 HEAD 已接到实验室 / CVE 档案；未进 GitHub Release）
>
> 收口：2026-08-24。产品判断仍以本页为准；实现事实以代码和 [当前开发目标](/developer/current-objectives) 为准。
> 设计预览：`app/env-preview.html`（不进产品入口）。开发时打开 `http://127.0.0.1:1421/env-preview.html`。
>
> 冲突时：本页管环境产品判断与交互；实现事实仍以代码和 [当前开发目标](/developer/current-objectives) 为准。

开工前先读完「产品判断」「两个引擎」「第一刀」。后面的社区调研和苹果可行性是依据，不是实现清单。

---

## 1. 产品判断

**没有真实环境，就不是合格的安全研究工作台。**

评测只是同一能力的一种用法。用户打开 CVE、实验室、本地 CTF 房，要能对着一个活的、可重置、范围清楚的目标动手。否则 Agent 只能读 advisory、改 Markdown、解文件题——那是刷题器，只服务初级学生。

被否掉的说法：

- 「CVE 不默认拉靶 / 先读 NVD」——读 advisory 是情报，不是复现。
- 「用更轻的沙箱代替 Docker」——WASM、浏览器隔离、本机 python server 盖不住有洞的服务栈。Firecracker / gVisor 是隔离技术，不是靶机目录，运维更重。
- 「Agent 自己 docker compose」——生命周期由经纪管。Agent 只有 `env.*`，没有 docker.sock、任意 YAML、未声明 adb。
- 「把漏洞工作台搬进实验室」——实验室是靶场。CVE 档案、Judge、报告仍在各自模块，只**引用**环境能力。
- 「右侧写死隔离浏览器」——右侧是活靶面。网页、终端、模拟器、以后真机走同一个槽。

轻的是控制面（钉死的包、用户点启动、类型化生命周期）。轻的不是把客人换成假服务。

---

## 2. 当前切片

本地、不连云。AWS Device Farm、Corellium、BrowserStack、云手机农场不做：账号、网络、费用、数据出境，对个人研究员太重。

| 优先级 | 做什么 | 不做的理由 / 做法 |
| --- | --- | --- |
| **P0** | 本地 **Web Hub** + **Docker Linux**（Juice Shop、WebGoat、白名单 Vulhub） | `internal/vuln` 已有 compose 白名单 `up/ps/down`，缺产品入口 |
| **P1** | 本机官方 **Android AVD**（Apple Silicon 用 ARM 系统镜像） | 不要把模拟器再塞进 Docker：Mac 上嵌套 KVM 基本不可用 |
| 后做 | 真机适配（adb / usbmux） | 虚拟机盖不住 Play Integrity、TEE、基带、iOS 时再接 |
| 后做 | 苹果 | 见文末可行性。不承诺 iOS 虚拟机 |
| 本切片不做 | 固件再托管、UART/JTAG、FirmAE/Qiling | 方向对，不和 Web Hub 抢经纪 |

Web Hub = 桌面里的练习包目录：列出包、一键启动、端口或设备进当前作业 Scope、停止即拆。不是云 Hub，不是镜像商店。

---

## 3. 两个引擎，四个入口

导航上的四个模块是**用户在做的事**。底下只有两套引擎。类比已经成立的 Coding 循环：

```text
Coding 模块   = Agent 循环的家     → CVE / 实验室用 ConversationDock 引用
实验室模块   = 靶与环境的家       → CVE / CTF 用 EnvironmentStrip 引用
CVE 模块     = 已知洞档案 + 报告  → 不搬进实验室
CTF 模块     = 题 + Judge         → 本地房才引用实验室
```

| 引擎 | 家 | 产出 | 不产出 |
| --- | --- | --- | --- |
| Coding / Pi | Coding 页 | 会话、工具循环、隔离浏览器、终端、Git | 靶、Judge、CVE 情报 |
| 实验室 / Broker | 实验室页 | 练习包目录、租约、就绪地址/设备、重置/销毁 | Agent 循环、漏洞是否成立、Flag |

每份作业（CVE 档案、实验室作业、CTF 本地房、评测容器题）最多绑：

1. 一条 Coding 会话（已有：dock + `domainTaskContext` + 展开 / 返回）
2. 一份环境租约（新的：环境条 + Scope 里的地址）

Join 表是 **Scope**：经纪写出 `127.0.0.1:3000` 或 `emulator-5554`；Coding 只打 Scope。停环境 = 收回授权。会话可以还在，下一跳工具应失败并写进报告，不要改打别的端口。

**禁止三跳**：先去实验室起靶 → 再去 Coding 打 → 再回 CVE 写报告。人停在作业所在模块，两个引擎在原地被引用。

三条规矩：

1. **作业拥有引用。** 从 CVE 启动 Juice Shop，租约记在这份 CVE 上。实验室列表可以显示「被 CVE-2023-46604 使用」，人不被撵去实验室。反过来亦然。同一包撞端口要说占用，不要暗中换端口。
2. **两个引用并列，没有从属。** 不是「实验室里的 Coding」，也不是「Coding 里的实验室」。停环境不影响会话；停会话不立刻拆容器（直到离开作业的停止策略）。
3. **各管各的完成面。** 环境就绪 ≠ 复现成功 ≠ Flag。谁都不替别人盖章。

心智模型：

| 我想… | 打开 |
| --- | --- |
| 逛靶、起练习场、打我带来的 URL | 实验室（作业 / 练习包） |
| 研究这个 CVE | CVE 档案（有包就在档案里起） |
| 做这道 CTF | CTF（本地房才有环境条） |
| 写工具、看完整终端 / Git | 展开到 Coding，「来自 X」+ 当前靶 |

不要第五个导航「环境」。CVE 列表继续禁止「练习环境」列。

---

## 4. 对象

```text
LabPackage
  id / 来源 / 许可
  provider: docker | process | android-avd | apple-vz | device-attached | user-attached
  surface:  browser | shell | emulator | device     // 右栏活靶面，由包决定
  镜像 digest 或磁盘 / AVD 哈希
  compose 或等价清单
  发布面：localhost 端口、受限 adb、串口
  网络：默认禁止出网、禁止 docker.sock、禁止任意 USB 枚举
  就绪探针
  重置 / 销毁
  Judge 或「无自动 Judge、只出报告」

Lease
  绑在一份作业上（CVE id / LabJob id / CTF 房）
  状态：none | docker-down | pulling | stopped | ready | busy | failed
  地址（给 Scope 和活靶面）
  占用者（若被别的作业占用）

TargetSurface
  档案右栏槽。不是写死的浏览器。
  复用 Coding 已有表面，不另造一套。
```

Agent 工具（不是 bash）：

`env.start` → `env.status` → `env.reset` → `env.stop`

真机后做再加 `env.attach` / `env.detach`。

Agent 拿不到：`docker` / `compose` / `nerdctl`、任意 compose 路径、docker.sock、未声明的 adb / 模拟器控制台 / Virtualization API、未配对 USB、摄像头、麦克风、钥匙串、宿主机局域网扫描。

Readiness ≠ Judge。容器 healthy 只证明靶活着。

`user-attached`：用户自己已经在跑的 URL / 主机（今天的实验室作业）。  
`device-attached`：MilkSU 经适配器持有的真机线。今天没有。

已有种子：`internal/vuln` Practice 校验 compose、限制 project 名、`up/ps/down`、留证据。ADR-0005「不执行触发样本」不能理解成永远不起靶。

---

## 5. 交互

现有壳已经是 **列表 → 档案 → 报告 + 右下角对话小窗**。环境挂在档案上。

### 5.1 实验室 = 练习包的家

顶栏：`作业 | 练习包`。

- 作业表多一列环境圆点：未绑定 / 已停止 / 就绪。不是 Docker 控制台。
- 题目包：少数钉死的包（Juice Shop、WebGoat、一条 Vulhub、InjuredAndroid），卡片打开后是靶机卡片，不是全量 Vulhub 商店。

新作业来源三段：`练习包 | 本机地址 | 远程`。  
选练习包 → **启动并打开**（建作业 + `env.start` + 进档案）。  
选本机/远程 → 今天的 URL 作业，环境条写「用户自带靶」，没有启动按钮。

### 5.2 环境条（CVE / 实验室同一组件）

放在摘要和报告之间。`EnvironmentStrip` 已有草稿。

| 状态 | 用户看见 | 主按钮 |
| --- | --- | --- |
| 无包 | 「没有练习包」，不是错误 | 无。CVE 仍可「开始复现」 |
| Docker 未运行 | 直说 + 打开 Docker Desktop | 重试 |
| 拉取中 | 镜像名、层进度、可取消 | 取消。禁止无限转圈 |
| 已停止 | 包名 | **启动** |
| 就绪 | 包名、地址可复制、无出网 | **打开靶**、重置、停止 |
| 被占用 | 「被作业 X 占用」 | 去那边 / 停那边 |
| 失败 | 失败原因原文 | 重试 |

**启动必须是用户手势。** 打开档案不自动 `compose up`。

CVE「开始复现」和「启动」分开：

```text
开始复现
  → 有包且未就绪 → 「这个洞有练习包。先启动？」[只写报告] [启动并复现]
  → 无包 → 开对话，环境条保持「没有练习包」
  → 已就绪 → 开对话，并打开活靶面
```

### 5.3 详情之后：看见靶、看见 Agent 打靶

点 **打开靶** 或带环境的 **开始复现**，档案变成左右工作面。浮动小窗收进左栏，避免挡住靶。

```text
左：环境条 + 报告 + 对话（引用 Coding）
右：TargetSurface（由包决定）
```

| 包 | 右栏 | 复用 |
| --- | --- | --- |
| 有 HTTP 的 Docker（Juice Shop / WebGoat） | 隔离浏览器 | 现有 `WebContentsView` |
| 无 Web UI 的 Linux 服务（ActiveMQ 端口等） | 受管终端 | 现有 Coding 终端，只打租约 |
| Android AVD | 模拟器画面 | 本机 emulator 窗或嵌入预览 + 受限 adb |
| 以后真机 | 设备画面 | scrcpy / 受限 usbmux，**同一槽** |

「打开靶」打开的是这个槽，不是系统 Chrome。人和 Agent 共用这一面：Agent 点按钮、敲命令、点屏幕，人都看得到。脚注写清隔离范围。

需要完整终端 / Git / 多文件才展开到 Coding。活靶面标签已经在，不用再起一次。展开不算离开作业，默认不停环境。Coding 大窗任务条要带租约状态。普通 Coding 会话（无 `domainTaskContext`）看不见实验室里碰巧在跑的容器。

离开：默认离开作业（回列表 / 换作业 / 关模块）就停环境；切去看靶不算离开。用户随时可停，Agent 不能阻止。

失败时人停在作业上：Docker 没开、镜像在拉、靶停了 Agent 还在跑——都在环境条和工具结果里说清楚。

---

## 6. 保真度与缺口

| 档 | 现在 |
| --- | --- |
| 文件工作区 | 已有。不能冒充服务复现 |
| 本机进程 | 评测 AutoPen 种子，不是产品定位 |
| Docker 包 | 经纪已接实验室 / CVE 档案（开发 HEAD）：Juice Shop、WebGoat、S2-045、whoami；回环绑定、内部网络 |
| 用户自带 URL | 实验室已有 |
| Android AVD | 专用 `MilkSU-Lab` 设备池（开发 HEAD）：空白设备 + InjuredAndroid；多作业调度空闲模拟器，不拿日常 AVD |
| Apple VM | 未做；iOS Simulator 不当研究级 iOS |
| 真机 | 未做 |

当前缺口：CTF 本地房还没有可重置环境。Docker / AVD 练习包已在开发 HEAD 的实验室和 CVE 档案里，未进发行。安卓验收是 adb，不是 Computer Use。

没有 Provider 时：文件题和读补丁还在，必须显示「真实环境不可用」。

---

## 7. 许可、体积、评测

- HTB 不能训 / 评 AI（ADR-0013）。Cybench 里的 HTB 题不能当官方 40 容器评测灌进来。
- 镜像按需拉。清单进仓库（digest / compose 哈希）。App 不装全套 Vulhub，更不装整套 Android 系统镜像。
- 本机 98 道 A/B 评测是文件/进程档，不是产品定位。容器题以后走同一 Broker，Judge 独立。
- 评测榜只列已出分的模型，不要把账户目录空行刷进排名。

---

## 8. 第一刀与 PR 切分

本地 Web Hub：Juice Shop、WebGoat、一条白名单 Vulhub（Struts2 S2-045 / CVE-2017-5638）。同一 Broker 覆盖 Linux 服务包和本机 AVD。

看得见的总验收：

1. 实验室 → 练习包 → 启动并打开 → 环境条就绪 → 打开靶，右栏出现对应活靶面（网页或终端或模拟器）。
2. CVE 档案若匹配该包（例如 CVE-2017-5638），环境条能启动；不匹配写「没有练习包」，「开始复现」仍可用。
3. Docker 没开时环境条直说，不空转。
4. 停止后地址离开 Agent Scope。
5. 人能看见 Agent 在右栏动手（同一浏览器页、同一终端、或同一台 AVD），对话在左栏。
6. P1：本机官方 AVD 窗口起来，活靶面显示 `emulator-*` 串口。

下面每个 PR 单独可验收。不要把 6 个阶段揉进一次「看起来能跑」。

| PR | 阶段 | 改什么 | 验收 |
| --- | --- | --- | --- |
| **PR-A** | 经纪内核 | `internal/envbroker`：LabPackage / Lease / occupancy / docker-down / 异步 Start | `go test ./internal/envbroker`：Juice Shop start/stop、占用、Docker 未运行 |
| **PR-B** | 环境条接入 | `EnvironmentStrip` 进实验室作业和 CVE 档案 | 作业详情、CVE 档案都有环境条；无包显示「没有练习包」 |
| **PR-C** | 练习包目录 | 实验室 `作业 \| 练习包`；新作业 `练习包 \| 本机地址 \| 远程`；钉死 Juice Shop / WebGoat / S2-045 / whoami / android-avd | 练习包表能列出上述包；选练习包会建作业并 `env.start` |
| **PR-D** | 浏览器活靶面 | 打开靶 → `TargetLivePane` browser，复用隔离浏览器 viewport | Juice Shop 就绪后右栏地址钉死 `127.0.0.1:3000` |
| **PR-E** | 终端活靶面 | whoami → shell 面 + `ProbeEnvLease` | 右栏出现 whoami HTTP 正文，不是假浏览器 |
| **PR-F** | P1 本机 AVD | host `emulator`/`adb`，Apple Silicon ARM 镜像 | `MILKSU_ENVBROKER_LIVE=1 go test ./internal/envbroker -run TestLiveAndroidAVD`：本机模拟器窗口起来，租约 `ready` + `emulator-*` |

草稿预览仍在：`EnvironmentStrip.vue`、`TargetSurfacePreview.vue`、`LabEnvironmentPreview.vue`。产品面进实验室 / CVE 档案，不再只活在预览页。

---

## 9. 不要做

- 第五个导航、镜像商店、全量 Vulhub 浏览、容器日志当主界面
- 列表页一键起靶、hover 预拉镜像
- 让模型自己弹 Docker 许可
- Mac 上 Docker 套 Android 模拟器
- 把 Strix / HexStrike 的 Agent 容器当成靶
- Simulator 冒充研究级 iOS
- 自建手机农场网站、Corellium、云设备农场
- 固件再托管（本切片）
- 把 CVE 情报 / Judge 搬进实验室

---

## 10. 真机适配（后做，对象先留）

虚拟机是可重置默认档。盖不住的走真机，不是口头「用户自己插线」。

社区拆开的三层，不要混：

| 层 | 现成物 | MilkSU |
| --- | --- | --- |
| 发现 / 配对 / 转发 | adb、DeviceFarmer/stf、scrcpy；iOS：pymobiledevice3、libimobiledevice | Broker：`env.attach` → Scope → `detach` |
| 运行时插桩 | Frida、objection、RMS | 工具 Adapter，不是环境 |
| 分析台 | MobSF | 参考；不整仓接入 |

`env.reset` 仅当设备声明可重置。生产手机默认没有 reset。

---

## 11. 开源社区怎么研究（2026-08-24 快照）

社区没有「更轻沙箱替代 Docker」。分层和本设计同一张图。star 是当日 `gh api`，不是接入承诺。

**Web / 服务：容器就是靶。** [Vulhub](https://github.com/vulhub/vulhub) 21157、[Juice Shop](https://github.com/juice-shop/juice-shop) 13706。包在社区，生命周期应在 Broker。

**AI Agent：几乎都把攻击端装进 Docker，靶还是你自己的。** Strix 是 Agent jail，不是靶机经纪。缺口是起靶。

**Android：模拟器一条线，真机一条线，Frida 叠在上面。** 本机 AVD + Magisk；docker-android 适合 Linux 宿主机。真机学 STF 的租约，不要做农场网站。MobSF 动态主要在模拟器。

**iOS：开源只能接真机。** 没有 Corellium 替代。Tart / UTM 跑的是 macOS/Linux 客户机。Simulator 不是研究级 iOS。

**固件：** Firmadyne / FirmAE / Qiling 说明「仿真不够就上原机」；本切片不做。

取舍：adapter 调 Docker / 以后 `emulator`+`adb`；adapt Vulhub 包模型和 STF 租约；不 fork 虚拟化。

---

## 12. 苹果（后做，只记判断）

本机、不连云的前提下，没有「再做一个 Android 那样的本地 iPhone 模拟器」可抄。

| 方案 | 结论 |
| --- | --- |
| Xcode Simulator | 本机能起，但是 Simulator：无真内核、无 SE、不能越狱。产品上必须标明「不是 iPhone」 |
| Tart / UTM | macOS / Linux 客户机。Linux 已有 Docker |
| Corellium | 研究级虚拟 iPhone，但是云。排除 |
| 开源本地虚拟 iPhone | 没有 |
| 用户插入的真机 | iOS 开源默认路径；真机适配后做 |

P0/P1 不含苹果。以后优先 `device-attached`（pymobiledevice3），不用 Simulator 充数。
