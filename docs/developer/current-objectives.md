# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-09-22
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现以当前代码、测试、Git 历史和原生 App 为准。
> 可下载安装包只写在 README，本页不写「当前最新版是」版本号或 hash。

## 工作规则

1. 先读当前代码、Git、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)。
2. 新能力写当前干净模型，不为已放弃设计写迁移或兼容层。
3. 上游优先：平台/Pi → 固定 Skill、MCP、插件或 CLI → 最小自有实现。不另造通用 harness。
4. Provider Key 不进模型上下文、工具输出、日志、诊断、文档或普通文件。Git 只推授权远端。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果和危险大目录删除确认。
6. CTF、CVE、实验室、Coding 同级。通用循环优先共享 Pi；领域事实、Judge、Memory 由 MilkSU 持有。
7. UI/Runtime 修复回写本页。未打包或未经用户验收的不得写成已发行。产品 UI 只写在 `AGENTS.md`。
8. 发版后更新 README 下载徽章和当前状态。流程见 [三端打包与发版流程](release-process.md)。
9. 尚未实现不是禁止。真边界只覆盖 Key、未授权外部目标、Judge，以及把 smoke 写成完成。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | 内测迭代 / Agent Runtime 与跨平台发行收敛。不再按 M3/M4 组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 当前开发 | 新对话可选 Pi 或 DeepSeek Harness；设置 → 模型「默认运行时」只改新对话 kernel，不改写旧会话。出厂默认官方 DeepSeek Flash、默认运行时 Pi。工作树 DSH 钉 `0.1.6-alpha.1`（内核，不是 UI 参考；原厂 GUI 是 `dsh web`）。Pi 子 Agent 默认主工作区、父回合阻塞；DSH 可在 Multitask 下用 ACP `session/new` 开子会话并继续主对话。Working 短胶囊对 Pi / DSH 同一套信息架构。Computer Use 由模型列窗 / 认窗 / 锁定。看板娘独立 sidecar 打包时把 provider runtime 打进 `companion-bridge.cjs`，不再运行时去要 `../pi/`。看板娘悬浮窗用出厂默认皮肤，出厂角色叫 Milk，只有两种互斥形态：桌面上的角色本体，和点开后单独出现的圆角手机对话（顶部是头像和名字，不是旁边再挂一只角色）。点角色或侧栏页脚（日夜模式和设置之间）打开手机并收起角色；关掉对话角色再出现。侧栏页脚的星标跟着状态变：看板娘在时是普通图标，点一下打开手机；手机开着时呈选中态，点一下把手机拿到前面；已隐藏时变淡，点一下直接打开手机，关上后角色回来。隐藏仍在右键菜单。开合是竖向合页：上下边收到中线一条亮缝再灭掉，打开是同一条路倒放；关对话时窗口先保持手机尺寸，合页播完再缩回角色。不是主窗口整页，也不是左上角工作区菜单。主窗口 / 设置可以和其中一种形态同时开着。角色窗就是精灵那个方框（160 × 160），启动贴在工作区右下角，点开手机共用这个角，关掉后角色还在原地，没有透明边压住下面的按钮，也不穿透；拖角色由壳跟着系统光标走，可以跨到另一块显示器；松手后夹进离窗口中心最近的那块工作区，不留在两块屏幕之间的空档。右键菜单只有 Preload 一个入口，渲染器不再另弹一个。叠层不盖系统输入法；右键菜单夹在当前显示器工作区内。右键、macOS 菜单栏、macOS Dock、Windows 通知区和 Linux 托盘是同一组动作（对话 / 隐藏 / 打开主窗口 / 看板娘设置 / 退出），应用菜单不再放看板娘。看板娘开着时菜单栏 / 托盘就有图标，不必先关掉主窗口。窗口标题是「看板娘」，与主窗口 MilkSU 分开。设置 → 看板娘可以导入文件夹或选用已启用的 `app.pet` 插件皮肤；运动和必交帧见 [看板娘皮肤设计合同](companion-skin.md)。关掉主窗口后 macOS Dock / Windows 任务栏仍显示 MilkSU，用来打开主窗口，Linux 用托盘；已隐藏的看板娘要等「显示看板娘」或「对话」才会再出现；Wayland 仍不能自己贴坐标。Cmd+Q / Ctrl+Q / 菜单退出结束进程，不把看板娘留在后台。产品回归覆盖看板娘手机对话、右键菜单、隐藏 / 显示、出厂与第三方换装、关主窗留桌面栏。产品回归入口 `npm run test:product-loop`；`--gui` 测完会删掉本机 fixture 会话，并写出带每项截图的正式报告（截图在拆 fixture 之前拍，只挂该用例当时的窗）。口径是严格 FAIL / SKIP：没测到、Key 被拒、超时或平台不能测不能记 PASS，SKIP 也不算整次通过。见 [产品回归循环](product-regression-loop.md)。侧栏归档立即执行，只有永久删除二次确认。产品 UI 语言和工作树 renderer 是 React + shadcn，见 `AGENTS.md`。未做：新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。宽作业用 `recon-authorized-target` Skill，不造 typed sweep。 |
| 平台边界 | macOS DMG 签名公证，安装引导图为 1x + @2x HiDPI TIFF；Windows 安装器未代码签名，打入 CUA Driver `0.27.0`；Linux 发共用 DEB 与 tarball，GNOME Portal 已进包，无 Secret Service / 本地 OCR；Hyprland/Xorg Computer Use 不可用。Windows/Linux 窗口铬尚未真机验收。安装包见 README。 |
| 发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted。`macos-release` 仅限 `main`，dispatch 后立即签名。正式包装 OTA 到私有 R2 并发布 current pointer；GitHub Release 不上 updater ZIP。 |

## 已发行

更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)，本页不复述。

最近一次正式包装源 `2fa97b3d`（`26.922.2`）：看板娘可以拖到另一块显示器，松手后夹进离窗口中心最近的工作区。界面收成冷白液态玻璃；主对话滚到顶栏和输入栏时字渐隐。看板娘手机跟主界面同一套冷白，短句进气泡、长文收成笔记；撤回凭据会停掉看板娘 sidecar。用量估算补上 Grok 4.7 与 GPT-6 Astra，Fable 5 与 5.1 的缓存读取价分开。Windows 安装器仍未代码签名。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.922.2>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `35719595545` | `MilkSU-macOS-arm64-26.922.2.dmg` | 335,767,350 B | `a05546387ccded76b2858ae5c7ef6172fbca9bafc7df08252cdbf1c22ed8205c` |
| Windows x64 | `35719599395` | `MilkSU-Windows-x64-26.922.2-Setup.exe` | 267,318,961 B | `7b93104543121b2d0fcd28b0e7915f1010a1bf3d4f4e84004c2c9f413f6dc7b5` |
| Linux x64 DEB | `35719603250` | `MilkSU-Linux-x64-26.922.2.deb` | 241,440,852 B | `561b908749cca1979b3e9d22b1db2024fe9081c974d227d2dd226f5ffd4777fe` |
| Linux x64 tarball | `35719603250` | `MilkSU-Linux-x64-26.922.2.tar.gz` | 295,198,785 B | `4216d02a746602047d34ae5a2e838a7728e8be995ceab51696bc70cf3a536125` |

## 未打进 GitHub 安装包

- 新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。
- Computer Use 选窗器仍是可选人工面。宽作业走 `recon-authorized-target` Skill，不造 typed sweep。
- DSH `bash` 没有 MilkSU 侧超时上界（工具在 harness 进程内，不要在客户端复刻第二套循环）。
- 不要把 `test:dsh-complete-loop` 当主入口。产品回归走 `npm run test:product-loop`。看板娘核心循环是 `companion-core`：开测时把议题抄本写进这次独立实例，再在手机里提问、按停止、收尾；click / express 检出只读。
- 看板娘的英文是 Companion。它以前叫「桌宠」。开发、测试和搜旧记录时，桌宠就是看板娘。代码标识、测试 id、目录和插件槽位仍是 companion / `app.pet`。
- Agent Harness：DSH 没有 Cursor 那种 `run_in_background` Task。ACP `session/prompt` 要等到 `whenIdle`（含子代理）才结算，所以主对话继续发走 host `Agent.followup`。输入栏停止键只在父回合还在生成、压缩或中止时出现。加号 Multitask 才是另开 ACP 子会话。Pi 的 `subagent` 仍阻塞父工具。不要升 Pi 来假装能并行。
- 不要复刻原厂 `dsh web` 皮肤、Queue dock、Jobs 顶栏、slash 目录或 Agent preset 切换器。未复刻 child transcript、preset、插件清单、归档、Schedule。

## 当前产品事实

- Coding / CTF / CVE / 实验室共用 Pi 文件、Shell、自动压缩（80% 空闲与 `/compact` 同一路径）和完整工作循环。工具结果进模型前走 Pi `tool_result` 截断。不扫描用户句子做意图路由。多个工作区可以并行跑回合；同一工作区内的对话排队。同一条会话里的 Pi 子代理仍阻塞父工具。对话里每段思考结束后正文仍留在时间线上，不收进「过程」；下一段思考出结果后，上一段默认折叠。已结束的工具组仍折叠。折叠头是这一轮的累计（想了多久、多少文件、多少次检索、命令和编辑）；回合还在跑时，头下面一行是当前动作，从左到右扫光，换动作时交替换上。个人资料 Coding 用量按钉死的 models.dev 价目显示「约 $…」估算（不是账单）；发版前要连窗口 / 思考档位一起刷新。
- 看板娘会话使用完整 Pi 工具循环（read / bash / grep / find / ls / edit / write），并保留 companion_board / companion_dispatch / companion_memory / companion_app。编排粒度：调研/摸底优先 dispatch 到对话并用 subagent 进 Working，落盘/长执行优先开或 steer 对话，看板娘本体只编排、确认、短回复；用户要看板娘自己做、没有合适对话、或要操作 MilkSU 本体时才本地工具或 companion_app。手机对话流式正文，进行中展示思考耗时和工具，结束后的思考行带上同一段耗时，回合结束后可折叠过程；只有真正空且无过程才报「这一轮没有回复」。companion_app 可打开主窗口、聚焦会话、读取会话摘录和不含凭据的设置；改这些设置、退出和重启要宿主确认。speak_many 一次最多 8 个会话，steer 与 stop 仍要确认。运行状态仍只由看板读取，不能改写，也不能读写 API Key。回复样式在设置里改完即存，默认 Markdown（通栏正文，保留思考耗时）；选对话时短段进气泡，长正文收成可展开的笔记，前后短句留在气泡里，准备时显示思考气泡，短消息节奏写进该模式的提示。发送后刷新抄本仍保留还没落盘的用户句。送进模型的上下文：Pi 保留会话抄本并自己压缩。Obelisk 是旁边的长期记忆，不是第二份抄本。每一轮按当前用户这句话放入长期记忆，并用现有情景检索（默认 8 条，最多 50）取相关记忆，不把整段抄本、整份看板或全部笔记塞进提示词。设置 → 看板娘「记忆」选择提取时机：关闭、每轮结束（出厂）、闲置后（5、10、15、30、60 分钟，默认 10）。回复上屏后用看板娘当前模型另跑一次，把带用户原句的稳定偏好直接写入，不在对话里弹出批准；已写入的条目在「记忆」里忘掉，设置里按结论或原句检索，并显示依据原句。放进上下文时先压缩每条，装不下也不整条丢掉，也不中断这一轮。提取写回和忘掉交错时以较新的一次为准，已忘掉的不会被写回。闲置计时在下一轮开始时清掉，同一段安静时间只向模型提取一次。打招呼、纯编排、对不上原句的回合不写。改口更新同一条。应用关掉时不补跑。Coding、CTF、CVE、实验室和 DSH 的回合结束后，把用户原话交给同一条提取；仓库、项目和分支规矩不写入。某一道题、某一个 CVE 或某一次实验室作业的结论不写入。这个人做 CTF、CVE、实验室的习惯和要求写入同一份长期记忆，可以改口更新。Pi 每轮只把这份长期记忆放进请求，不把情景摘录放进去。DSH 不把长期记忆写进用户消息。情景检索开着时，其他会话落盘后刷新 Obelisk 原文索引，看板娘检索前也会刷新。Obelisk 仍只存原文。CTF 在准备题目工作区时把用户保存的训练记忆写入 MEMORY.md；CVE 在解析研究工作区时把该 CVE 上已保存的学习记录写成 LEARNING.md，没有记录就不留这个文件。这些是某一道作业的先验。实验室作业要求留在作业本身。看板仍用 companion_board。对用户说话用对话标题，id 只留在工具参数。打招呼不展开旧任务。出厂默认账户官方 DeepSeek Flash（`deepseek/deepseek-flash`，`companion_source=account`）；已保存的看板娘模型不因出厂默认变更而改写。附件与 Coding 同一条 preparePromptAttachments + 原图进回合路径；图片 MIME 按文件内容，不跟错误后缀。空助手回合不再从转录里消失，也不再把只有 tool call 的回合删掉；孤儿 toolResult 不会再送进下一轮。工具记录断了时 sidecar 先补合成错误 toolResult，不再自动归档逼「开新对话」。宿主 IPC 与主对话同一套：默认有限超时（读会话 / 看板 / 记忆 / queue 投递），只有确认驻留（patch_settings / quit / relaunch、steer / stop）才 `timeoutMs:0`；host 回执和用户中止立刻处理，不排在 `session.prompt` 后面。board / dispatch / memory / app 失败变成 error toolResult，Pi 继续 think/tool 直到助手正文或用户中止 / 拒绝驻留确认。设置保存只把看板娘 sidecar 标成 stale，不杀进行中的回合。退出登录、清掉账户密钥或撤回仍在使用的密钥会立刻停掉看板娘 sidecar。个人来源的看板娘模型不会在账户目录刷新时被改写成账户模型。看板娘 session 挂同一份 Pi hang-guard（bash 默认超时）和 tool_result 上界，不另造防挂死。StopCompanion / 换 sidecar 时旧 stdout 读循环不得清掉新进程的 stdin；Pi 要等第一条助手回复才写 jsonl，看板娘在用户句、归档后 reset 和 shutdown 时自己刷盘，恢复后同一段抄本还在。模型连不上显示「连不上模型服务」；host 超时显示「看板娘操作已取消或超时」，不结束回合。中止回合显示「这一轮已取消」；sidecar 中途退出显示「看板娘暂时连不上」，不把 Request aborted、companion sidecar is not running、companion_app get_settings 的设置 JSON 或 toolResult 信封画进手机气泡。
- MilkSU 只持会话目录、凭据隔离、桌面授权、领域事实/Judge，以及危险或量不到的递归删除二次确认。删除守卫不再把 `rm -rf X && mkdir X` 或命令里自赋的删除路径当成先创建再删除；有风险和量不到的目标仍弹确认卡，后台任务仍不能弹卡。给模型看的 MilkSU 正文跟界面语言走（默认中文）：运行时上下文、看板娘默认提示、空回复抢救、无工具合同、DSH 读图回退、附件前言、AGENTS.md 包装句、CTF ROLE_STATE。工具 schema 和 Pi 自带英文 coding harness 仍是原文。
- 账户 TokenFlux 与本机 Provider 共用可调用目录；保存的模型 id 跟目录真实后缀走（例如目录只有 `gemini-3.8-flash-tiered` 时不再请求无后缀的 `gemini-3.8-flash`）。附件原图进当前回合。网页查证复用 Pi `web_search` / `web_fetch`。
- 桌面壳是 Electron/Chromium。产品 UI 是 React + shadcn。看板娘输入栏加号走现有本机附件 RPC：图片缩略图按原比例，文件进当前回合；发出去的气泡立刻出现。看板娘气泡按 gifted-chat 分组圆角收口，不再画遮字尖角；助手与用户正文复用 Coding 的 `MarkdownContent`（错误串仍纯文本）。设置 → 看板娘「外观」可调对话字体 / 字号，与设置 → 通用、主窗口对话共用同一组 `conversation_font` / `conversation_font_size`，改完经 BroadcastChannel / localStorage 同步到看板娘窗。看板娘手机窗按 iPhone 17 屏幕 402×874 pt 做成 320 × 696。屏幕圆角仍按 402×874 pt 上 `_displayCornerRadius` 62 pt 缩放到 48.43 px，机身再加 3 px 边；不用 Chromium `corner-shape:squircle`。抬头和输入井用 MIT `react-progressive-blur` 多层 `backdrop-filter`：记录滚进名字胶囊或输入井才被磨砂，没有实心遮罩；磨砂层不加 `clip-path`。主窗口对话列的记录从顶栏和输入胶囊周围的留白底下穿过去，留白不裁字，只用 MIT `react-progressive-blur` 磨砂。输入胶囊左右圆头、不透明；审批、目录和分支在胶囊外左下，用量环在这一行右侧。多行或附件时胶囊增高。待批准条贴在顶栏下沿。右栏用标签切换页面，加号菜单是紧凑白列表。名字胶囊、返回 chevron 和输入井是同一层玻璃，模糊的是手机屏幕里的记录。手机抬头头像白底带细边框，点头像在同一手机窗内叠一层看板娘设置页（复用 `CompanionSettingsPanel`；companion preload / shell 放行 `GetSettings` / `SaveSettingsCmd` / `GetModelCatalog` 与皮肤导入移除，字体 / 悬浮窗 / 皮肤可在手机内改完即存）；返回玻璃 chevron 回到对话，不关手机。设置页上沿用同一套渐进磨砂，配置滚进状态栏和标题才被模糊。托盘 / 菜单「看板娘设置」仍打开主窗口设置 → 看板娘。对话时间按系统日期格式。夜间模式跟主窗口同一套存储并同步到看板娘窗。Cmd+Q / Ctrl+Q / 菜单退出结束进程；关主窗仍留看板娘。隔离浏览器、Browser Use、Computer Use 是三个表面；面板折叠不停止 Session。产物在各 OS 文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。
- 产品 UI 只写在 `AGENTS.md`。

## 当前完成线

1. 功能改动后按 [产品回归循环](product-regression-loop.md) 跑 `npm run test:product-loop`；失败回 P0。安装包上的 Pi / 实验室靶机仍由用户真机看。
2. 用户要求发下一版时：先对照 models.dev 刷新窗口 / 思考档位 / 用量价目（[发版流程](release-process.md) §1.5）→ 升版本号 → 干净已推送的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | 改对话 / 引擎 / DSH / 隔离浏览器后跑 `npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。Settings「评测」不替代这条。 |
| P0 | React + shadcn | 工作树 renderer 已是 React + shadcn（`main.tsx`）。新页和重构只走这条。不再跟 DSH web GUI，不再加 Felinic / Vue SFC。Desktop RPC 与 Go 不动。设计语言和已收口的交互细节见 `AGENTS.md`；剩余不一致按 bug 单独记。 |
| P0 | Pi Runtime 用户验收 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复；无 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256 与平台验收。安装包见 README。 |
| P1 | OTA / current pointer | 侧栏「更新」打开进度框下载；下完后用户点安装并重启；有任务在跑时先确认退出并落盘后续跑；安装失败可见；CI 上传后发布 current pointer。 |
| P1 | Wide lab recon | `bg_status` 熔断与最多 4 条子 Agent lane 已进包。宽作业用 `recon-authorized-target` Skill，不另造 typed sweep。 |
| P1 | 安全工具真实任务 | IDA / capa 已有设置与健康检查；用受控样本留回执。不把 HexStrike 做成默认 MCP。 |
| P1 | Obelisk 学习记录 | 先定义可归因事实，再独立页面；不恢复已删的单会话图谱。 |
| 未接线 | 同一作业 vs 新业务 | 当前 CVE/实验室复用同一会话和 `report.md`。 |
| 未接线 | CTF 比赛模式 | 对着一场比赛打，不走练习题库。尚未设计准入。 |
| 未接线 | 实验室红队模式 | 另开学习面，不是对外红队。尚未设计准入。 |
| 未接线 | 远程控制 App | 手机连本机执行，不是云 Agent。准入与决策见 [远程控制](remote-control.md)。跟踪 [#131](https://github.com/MilkSU-Official/milksu/issues/131)。尚未实现。 |

CVE：点进档案复现，Agent 改 `report.md`。实验室：独立入口，练习包起本机 Docker / AVD 或用户给地址，活报告 + 对话小窗。环境契约见 [靶机、环境经纪与活靶面](/architecture/target-environments)。

## 不要重复打开

只在新复现、自动化失败或用户明确要求时重开：已撤单会话图谱；Wails/CEF；workspace-only 文件工具；Security Bridge / `continue_ctf_job`；关键词意图路由；自建计费；把 dirty HEAD 写成已发版；M3/M4 台账。

## 领域与文档

- CTF：模型只提 Candidate；成功只来自 Judge 或用户确认。
- CVE：完成面是复现报告，不是「复现成功」。
- 实验室：未知洞探测，不是对外红队，也不是 CTF 环境包。
- Memory：用户能力事实必须能链到 Judge、正式 Evidence 或用户确认。
- 依赖方向：`React → Preload / RPC → Application Service → Domain / Runtime → Adapter`。入口是 `main.tsx`。
- 触碰 `CTFPage.tsx`、`app.go`、`bridge-policy.js`、`browsercap/manager.go` 或 Runner/Recovery 时，不往热点文件再加一份通用 harness。
