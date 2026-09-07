# DSH 实验内核合同

> 文档状态：**Current / Design contract**
>
> 最后对齐：2026-09-07
>
> 本文记录已锁定的产品合同，供 Coding / Security / Product UI / Platform 在 PR 评论中会签。
> 它不是实施队列，也不是发版宣称。默认生产 harness 仍是 Pi。实现是会签之后的后续切片。

当前发行事实仍以 [当前开发目标](current-objectives.md)、[文档状态](document-status.md)、
当前代码和真实平台回执为准。不要把本页写成已接线能力，也不要把 DSH 写进发行完成线。

## 状态

Current / Design contract。不是实施队列。不是发版宣称。

默认生产 harness 仍是 Pi（钉住的 `pi-coding-agent` 0.84.1）。DeepSeek Harness（下称 DSH）
在近中期只是**实验开关 / 内核替换实验**：只允许钉在**新会话**上，用来验证薄适配是否
盖住准入面。在准入通过之前，它不是默认的可选第二核心，更不是第二套 MilkSU 通用
Coding harness。

会签完成前不实现、不暴露产品设置、不把该能力写进 `current-objectives.md` 的发行或完成线。

## 问题

Milk SU 希望保留一个选项：对**新会话**把 DSH 当作实验第二内核跑起来，用来对照 Pi。

不允许的做法：

- 在已有会话中途热替换内核；
- 再造一套 MilkSU 自有通用 Coding harness / 提示注入器 / 按内核分叉的桌面循环；
- 把 DSH 做成实验室练习包的默认内核，或改写探测 → 活报告完成面。

今天产品里没有内核选择器。Coding / CTF / CVE / 实验室共用 Pi Session、Compaction 与
Tool Loop。`/handoff` 与用量环「接到新会话」走 Pi 分叉 + 现行 compact，开的是新会话，
不是同一会话换引擎。隔离浏览器、Browser Use、Computer Use 挂在当前内核的薄合同上，
不按引擎各做一套桌面循环。

## 已锁定的产品合同

1. **默认永远是 Pi。** 未选择、未钉死、设置缺失、实验开关关闭，一律走现行 Pi 路径。
2. **近中期定位：实验开关 / 内核替换实验。** 在第 5 条准入面全部盖住之前，产品不得把
   DSH 宣传成默认可选第二核心，也不得把它写进发行完成线。
3. **设置必须标明「实验」。** 内核选择只出现在**创建新会话**时；创建时钉死；已有会话
   **禁止热替换**。空控件保持空白，只显示控件自己的标签，不加「还没有 / 打开以后会
   出现」说明。将来做 UI 时，中英文必须同一处 `t()`，例如
   `t('实验内核', 'Experimental kernel')`、`t('DeepSeek Harness（实验）', 'DeepSeek Harness (experimental)')`。
   本页不实现该控件。
4. **实验室（实验室）默认仍是 Pi。** 练习包作业要跑 DSH，必须同时取得 Lab 与 Security
   会签式同意（产品上是可见、准确的实验授权，不是隐藏开关）。同意之后仍走
   探测 → 活报告（`report.md` / `report.html`）；不得改成「扫描完成」语义，也不得把
   DSH 变成实验室默认。
5. **薄准入面。** 产品设置把 DSH 从「实验脚手架」升成「可选用实验内核」之前，DSH
   必须经薄适配覆盖下列表面。缺一面就停在脚手架，不准升格：
   - 打开回合 / 流式事件；
   - 工具注册 + 审批钩子；
   - 停止 / 恢复；
   - Compaction 语义（跟所选内核走，不另建 MilkSU 摘要器）；
   - 原生 Skill / 工具渐进披露（跟 DSH 原生日录走；丢掉 Pi 专用 leftover；
     **禁止**做一套在每个内核上看起来一样的 MilkSU 万能注入器）；
   - 类型化产品工具 `milksu_ask` / `milksu_workspace`；
   - Key 隔离、未授权目标闸门、Judge（Candidate ≠ 已确认事实）。
6. **不要发明第二套 harness / 注入器，也不要按内核分叉桌面循环。** Computer Use、
   隔离浏览器、Browser Use 继续挂在**当前会话已钉内核**的薄合同上。MilkSU 只做
   桌面授权、工作区、凭据、事件投影和产品 UI。
7. **换内核的唯一合法时刻是接到新会话。** 复用 `/handoff` / 「接到新会话」的产品语义：
   新会话可另选内核并钉死；旧会话内核不变。中途切换必须被产品拒绝。

## 今日实现锚点（只说明现状，不在本 PR 改）

这些路径属于现行 Pi 产品链。后续实现只能在它们旁边加**薄适配**，不能另开一套循环。

| 面 | 现行锚点 |
| --- | --- |
| 会话 / spawn | Go supervisor → 受管 Pi Sidecar（`internal/engine/supervisor.go`，`sidecar/pi/`） |
| 停止 / 压缩 | Sidecar `abort_session` / `compact_session`；85% 空闲路径与 `/compact` 同一条 |
| 接到新会话 | `/handoff` 与用量环「接到新会话」：Pi 分叉 + 现行 compact |
| 产品工具 | 类型化 `milksu_ask` / `milksu_workspace`；when-to-use 只留 description |
| 实验室环境 | `env_status` / `env_start` / `env_reset` / `env_stop`；作业会话 `lab-job-*` |
| 活报告 | 实验室 / CVE 工作区 `report.md`（或 `report.html`） |
| 凭据 | Credential Store；Key 不进模型上下文、工具输出、日志、诊断或普通文件 |
| 对照 spike 风格 | 隔离目录 `spikes/engine-comparison/`（`npm run spike:pi` / `spike:codex`）；消融风格见 [研究：Pi 之上的 MilkSU harness 消融](research-harness-ablation.md) 与其引用的 `spikes/harness-ablation/`、`npm run spike:harness-ablation*` |

DSH 对照 runner **尚未存在**。实现切片若需要，应仿 `spikes/harness-ablation/` 与
`spikes/engine-comparison/` 另开隔离 spike（例如 `spikes/dsh-kernel/` 与
`npm run spike:dsh-kernel*`），**不进生产依赖图**。本 PR 不添加这些脚本。

## Feedback Loop（可跑闭环，不是 MUST 墙）

本节给会签角色一份各自能跑的闭环。形状固定为：

**观察 → 要跑的命令 / fixture → 读哪些指标 → 只改什么 → 再验。**

禁止用一堵 MUST / 禁令墙代替闭环。缺 DSH spike 的格子标成「实现切片再补」；在那之前
先用 Pi 对照与现有负向测试把闸门钉住。

### Coding

**观察。** 新会话创建记录里的内核钉（默认 `pi`；实验选择才是 `dsh`）。spawn 仍走
supervisor → 当前内核薄适配，而不是第二条 Desktop RPC 循环。已有会话没有「换内核」入口。

**跑。**

```bash
# 现行 Pi 短交付对照（今天就能跑）
node scripts/test-coding-agent-delivery.mjs
npm run test:coding-delivery-report

# 隔离引擎对照风格（Historical；不是第二套产品 runtime）
npm run spike:pi:protocol

# DSH 新会话对照 — 实现切片再补，风格锚点：
# spikes/harness-ablation/ 与 npm run spike:harness-ablation*
# 建议对称：spikes/dsh-kernel/ 与 npm run spike:dsh-kernel*
# 同一短文件任务：一条 Pi-only 新会话，一条 DSH-on 新会话（仅新会话）
```

Fixture 锚点：`tests/fixtures/coding-agent-delivery/template`。消融任务形态对齐
[研究：Pi 之上的 MilkSU harness 消融](research-harness-ablation.md) 的短文件 Judge 题，
不要在本页发明第二套任务集。

**读。** 工具调用次数、是否在里程碑处停下、billed input、失败分类
（静默挂起 / 缺准入面 / 注入器回流 / 第二条 harness）。独立 Judge 看文件内容，
不看模型自述。

**改。** 只补薄适配缺口（流式事件、工具注册/审批、停止/恢复、compaction、
`milksu_ask` / `milksu_workspace` 投影）。不写 MilkSU 万能注入器，不按内核分叉
Composer / 浏览器 / Computer Use。

**再验。** 同一 fixture 在 Pi-only 与 DSH-on 新会话各跑一遍；热替换负向格必须拒绝。

### Security

**观察。** DSH 新会话是否仍经过同一套 Scope / Key / 未授权目标闸门 / Judge。
实验室练习包在未同时取得 Lab + Security 同意时不得钉 DSH。Candidate 不能写成
已确认事实。

**跑。**

```bash
# Key / 环境不泄漏（今天就能跑）
go test ./internal/engine -count=1 -run 'Credential|credential|InactiveModelSource'
go test ./internal/config -count=1 -run 'ManagedAccount'
go test ./internal/codingterminal -count=1 -run 'credential'

# 未授权目标 / 授权失败关闭（今天就能跑；实现切片再补 DSH 会话包装）
go test ./internal/computercap -count=1 -run 'Authorization|FailsClosed'
go test ./internal/ctf -count=1 -run 'Judge|candidate|credential'

# 实现切片再补：对 DSH-on 新会话跑未授权外网负向 + 日志/工具输出 Key 扫描
# rg -nE 'sk-|api[_-]?key|Authorization: Bearer' <dsh-session-log-or-tool-output>
# 禁止把真实 Key 放进仓库、fixture 或文档；只用合成值。
```

**读。** 闸门命中率（拒绝次数 / 试图越权次数）、工具输出与诊断里是否出现 Key、
Judge Receipt 是否仍独立于模型 Candidate、练习包默认内核是否仍是 Pi。

**改。** 只收紧薄适配上的泄漏或绕过。不把闸门下放到模型提示，不按内核复制第二套
授权状态机。实验室 DSH 必须保持「Lab + Security 双同意」，单边同意不够。

**再验。** 负向目标仍拒绝；Key grep 干净；无同意的练习包会话内核仍是 `pi`。

### Lab

**观察。** 实验室作业会话（`lab-job-*`）默认内核是 Pi。练习包卡片、环境条、
`env_*` 与右栏活靶面不因实验开关改默认。完成面仍是 Agent 可继续改的活报告，
不是状态标签，也不是「扫描完成」。

**跑。**

```bash
# 现行练习包绑定与 env_*（今天就能跑）
go test ./cmd/milksu-backend -count=1 -run 'EnvWorkspaceActionUsesBoundLabPackage'
npm run test:sidecar
# lab-job 角色压缩/续跑不按角色跳过：sidecar/pi/bridge-ctf-continuation.test.js

# 已同意的 DSH 练习包作业 — 实现切片再补隔离 fixture：
# 有界 env_status → env_start → 探测里程碑写入 report.md → 停
# 对照：无 Lab+Security 同意时同一练习包仍 spawn Pi
```

**读。** 完成物是否仍是工作区 `report.md` / `report.html`（摘要、环境、进程、网络、
步骤）；环境经纪是否仍只绑练习包 / 用户给出的靶；有没有把「scan finished /
扫描完成」写回产品文案或完成面。

**改。** 拒绝任何把实验室默认改成 DSH、或把活报告收成一次性扫描结果的适配。
DSH 同意只钉**这一次新作业会话**，不改练习包目录默认。

**再验。** 无同意 → Pi；有同意 → 薄合同跑完后报告仍可继续改；产品文案没有扫描完成语义。

## 消融设计（合同矩阵，不是跑数）

表的写法对齐 [研究：Pi 之上的 MilkSU harness 消融](research-harness-ablation.md)
（Historical / Research：变体、模型看见什么、成功/失败、不能外推）。**本 PR 不跑、
不写结果。** 真跑留给后续隔离 spike，形态与 `spikes/harness-ablation/`、
`npm run spike:harness-ablation*` 相同；DSH 格子在实现切片再补 runner。

| Cell | Variant | 模型看见什么 | Success | Fail |
| --- | --- | --- | --- | --- |
| Pi-only 新 Coding 会话 | control | 现行 Pi 提示 + 文件/Shell + 薄产品工具 description | 短文件任务过独立 Judge | 静默挂起 / 冒出第二套 harness |
| DSH-on 新会话（实验） | treatment | DSH 原生披露 + 同一薄合同（ask / workspace / 审批 / 压缩） | 同一任务经薄合同做完 | 缺任一准入面（流式、注册/审批、停/续、压缩、ask/workspace、Key/闸门/Judge） |
| 有 vs 无 MilkSU 额外 prompt 长文 | ablation | 内核原生日录 vs 再贴 MUST / when-to-use 长文 | 披露仍跟所选内核走 | 注入器或关键词/正则路由回流 |
| 会话中途试图热替换 | negative | 旧会话上下文，内核钉不变 | 产品拒绝；只允许接到新会话后再选 | 静默换内核 |
| 练习包作业要对 DSH、但无 Lab+Security 同意 | negative | 与今天实验室 Pi 作业相同 | 仍走 Pi | DSH 变成实验室默认，或未同意就 spawn DSH |

### 不能外推

- 本页没有跑数。不能把矩阵本身写成 DSH 已可用或解题率结论。
- 短文件 Coding 过 Judge，不能外推到长 CTF / CVE、真实 `milksu_ask` 挂起、或实验室活靶。
- 对照研究里的 billed input / 空转税只描述 Pi 附加层；DSH 格子要等隔离 spike 再写 Evidence。
- 一种模型、一个种子、隔离 runner 的结果不能写成发行完成。

## 本 PR 明确不做

任何产品代码、Settings UI、Sidecar、打包、合并，或改 `current-objectives.md` 发行宣称。
不碰 PR #55（窄逆向出厂覆盖）、#56（Hyprland Computer Use）、#57（subagent 工作代理模型）
的范围。本页只是合同。会签之后另开实现切片。

## 会签清单（写在 PR 评论，不写进代码）

- [ ] Coding Agent Lead：harness / 渐进披露跟 DSH 原生走；不造第二套循环或万能注入器
- [ ] Security Lead：Key / 未授权目标 / Judge；练习包 DSH 必须 Lab + Security 双同意
- [ ] Product UI Lead：实验开关文案；只在新会话创建时可选；没有中途换内核 UI
- [ ] Platform Lead：仅当后续实现碰到 spawn / Sidecar 内核进程接线时才需要会签——不得新增
      Desktop RPC 源隔离破口。本设计 PR 尚未改 spawn，Platform 可在评论里回 N/A，但保留本框
