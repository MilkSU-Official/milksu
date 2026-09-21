# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-09-20
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
| 当前开发 | 新对话可选 Pi 或 DeepSeek Harness；设置 → 模型「默认运行时」只改新对话 kernel，不改写旧会话。出厂默认官方 DeepSeek Flash、默认运行时 Pi。工作树 DSH 钉 `0.1.6-alpha.1`（内核，不是 UI 参考；原厂 GUI 是 `dsh web`）。Pi 子 Agent 默认主工作区、父回合阻塞；DSH 可在 Multitask 下用 ACP `session/new` 开子会话并继续主对话。Working 短胶囊对 Pi / DSH 同一套信息架构。Computer Use 由模型列窗 / 认窗 / 锁定。桌宠独立 sidecar 打包时把 provider runtime 打进 `companion-bridge.cjs`，不再运行时去要 `../pi/`。桌宠悬浮窗用出厂默认皮肤，出厂角色叫 Milk，只有两种互斥形态：桌面上的角色本体，和点开后单独出现的圆角手机对话（顶部是头像和名字，不是旁边再挂一只宠物）。点角色或侧栏页脚（日夜模式和设置之间）打开手机并收起角色；关掉对话角色再出现。不是主窗口整页，也不是左上角工作区菜单。主窗口 / 设置可以和其中一种形态同时开着。角色窗就是精灵那个方框（160 × 160），没有透明边压住下面的按钮，也不穿透；拖角色由壳跟着系统光标走，松手后夹回屏幕。右键菜单只有 Preload 一个入口，渲染器不再另弹一个。叠层不盖系统输入法；右键菜单夹在当前显示器工作区内。右键、macOS 菜单栏、macOS Dock、Windows 通知区和 Linux 托盘是同一组动作（对话 / 隐藏 / 打开主窗口 / 桌宠设置 / 退出），应用菜单不再放桌宠。桌宠开着时菜单栏 / 托盘就有图标，不必先关掉主窗口。窗口标题是「桌宠」，与主窗口 MilkSU 分开。设置 → 桌宠可以导入文件夹或选用已启用的 `app.pet` 插件皮肤；运动和必交帧见 [桌宠皮肤设计合同](companion-skin.md)。关掉主窗口后 macOS Dock / Windows 任务栏仍显示 MilkSU，用来唤醒桌宠，Linux 用托盘；Wayland 仍不能自己贴坐标。Cmd+Q / Ctrl+Q / 菜单退出结束进程，不把桌宠留在后台。产品回归覆盖桌宠手机对话、右键菜单、隐藏 / 显示、出厂与第三方换装、关主窗留桌面栏。产品回归入口 `npm run test:product-loop`；`--gui` 测完会删掉本机 fixture 会话，并写出带每项截图的正式报告（截图在拆 fixture 之前拍，只挂该用例当时的窗）。侧栏归档立即执行，只有永久删除二次确认。产品 UI 语言和工作树 renderer 是 React + shadcn，见 `AGENTS.md`。未做：新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。宽作业用 `recon-authorized-target` Skill，不造 typed sweep。 |
| 平台边界 | macOS DMG 签名公证，安装引导图为 1x + @2x HiDPI TIFF；Windows 安装器未代码签名，打入 CUA Driver `0.27.0`；Linux 发共用 DEB 与 tarball，GNOME Portal 已进包，无 Secret Service / 本地 OCR；Hyprland/Xorg Computer Use 不可用。Windows/Linux 窗口铬尚未真机验收。安装包见 README。 |
| 发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted。`macos-release` 仅限 `main`，dispatch 后立即签名。正式包装 OTA 到私有 R2 并发布 current pointer；GitHub Release 不上 updater ZIP。 |

## 已发行

更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)，本页不复述。

最近一次正式包装源 `d3ee32bd`（`26.917.3`）：侧栏「更新」打开进度框下载，下完后用户点安装并重启；macOS DMG 安装引导图为 Retina @2x。一并打进：整理上下文 / 接到新会话短会话不再失败；DSH 打 TokenFlux 保留厂商前缀；出厂默认运行时 Pi。Windows 安装器仍未代码签名。`26.917.2` 没有 GitHub Release。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.917.3>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `35205819724` | `MilkSU-macOS-arm64-26.917.3.dmg` | 329,693,780 B | `fc24f9bf907bfdbddccda796072c84cf013b5f1683df9ae6f0055af0c26ae792` |
| Windows x64 | `35205823589` | `MilkSU-Windows-x64-26.917.3-Setup.exe` | 263,093,940 B | `7db65b8dd7dbaa8638a3bbfee54253039e3531720aa3db58fa59ac7325fb1104` |
| Linux x64 DEB | `35205827853` | `MilkSU-Linux-x64-26.917.3.deb` | 236,968,756 B | `67e539cdee66fe798ebb05fae4eb75efb5d311d4f3f525a2adfdb6d89df66fcf` |
| Linux x64 tarball | `35205827853` | `MilkSU-Linux-x64-26.917.3.tar.gz` | 290,175,038 B | `c2ae0a3ea47b9ece37fe0da7a0475afec0dbd55a3546f573199ffa8bc793da73` |

## 未打进 GitHub 安装包

- 凭据轮换不再切在飞回合、会话带自己的中转站与模型、删除守卫改判命令自写的脚本、切换对话不丢草稿、对话选中文字「加入对话」：已在 `main`（#120 / #119 / #106 / #122 / #123），未打进安装包。删除守卫不再把 `rm -rf X && mkdir X` 或命令里自赋的 `REPRO=…; rm -rf "$REPRO"` 当成「先创建再删除」。有风险（主目录 / 工作区根 / 超大目录）和量不到目标仍弹确认卡；后台任务仍不能弹卡。原先静默拦截的预制策略已改成：若将来切到拦截，必须把原因给用户和大模型，让模型改方案；当前未启用。产品回归按上手顺序走独立实例：登录 / 中转站密码框 → 主页 Pi/DSH → 桌宠 → CTF/CVE/Lab → 桌面执行面 → 资料/更新 → 设置其余项。开测前和每条用例前只留一扇测试窗，关掉日常 MilkSU 和残留 Electron，GitHub 回调不进日常窗口。测完打印从大模块到小模块的报告。
- 新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。
- Computer Use 选窗器仍是可选人工面。宽作业走 `recon-authorized-target` Skill，不造 typed sweep。
- DSH `bash` 没有 MilkSU 侧超时上界（工具在 harness 进程内，不要在客户端复刻第二套循环）。
- 不要把 `test:dsh-complete-loop` 当主入口。产品回归走 `npm run test:product-loop`。
- Agent Harness：DSH 没有 Cursor 那种 `run_in_background` Task。ACP `session/prompt` 要等到 `whenIdle`（含子代理）才结算，所以主对话继续发走 host `Agent.followup`。作曲栏停止键只在父回合还在生成、压缩或中止时出现。加号 Multitask 才是另开 ACP 子会话。Pi 的 `subagent` 仍阻塞父工具。不要升 Pi 来假装能并行。
- 不要复刻原厂 `dsh web` 皮肤、Queue dock、Jobs 顶栏、slash 目录或 Agent preset 切换器。未复刻 child transcript、preset、插件清单、归档、Schedule。

## 当前产品事实

- Coding / CTF / CVE / 实验室共用 Pi 文件、Shell、自动压缩（80% 空闲与 `/compact` 同一路径）和完整工作循环。工具结果进模型前走 Pi `tool_result` 截断。不扫描用户句子做意图路由。同一工作区的多条 Pi 对话可以同时跑回合（按会话排队 prompt）；同一条会话里的 Pi 子代理仍阻塞父工具。对话里每段思考结束后正文仍留在时间线上，不收进「过程」；已结束的工具组仍折叠进「过程」。个人资料 Coding 用量按钉死的 models.dev 价目显示「约 $…」估算（不是账单）；发版前要连窗口 / 思考档位一起刷新。
- 桌宠会话使用完整 Pi 工具循环（read / bash / grep / find / ls / edit / write），并保留 companion_board / companion_dispatch / companion_memory / companion_app。系统提示优先把工作交给已有对话；用户要桌宠自己做、没有合适对话、或要操作 MilkSU 本体时，桌宠自己用这些工具或 companion_app 做。companion_app 可打开主窗口、聚焦会话、读取会话摘录和不含凭据的设置；改这些设置、退出和重启要宿主确认。speak_many 一次最多 8 个会话，steer 与 stop 仍要确认。运行状态仍只由看板读取，不能改写，也不能读写 API Key。出厂默认账户官方 DeepSeek Flash（`deepseek/deepseek-flash`，`companion_source=account`）；已保存的桌宠模型不因出厂默认变更而改写。附件与 Coding 同一条 preparePromptAttachments + 原图进回合路径；图片 MIME 按文件内容，不跟错误后缀。空助手回合不再从转录里消失，也不再把只有 tool call 的回合删掉；孤儿 toolResult 不会再送进下一轮。工具记录断了时手机里直接「开新对话」，当前记录归档，不必去设置里找归档。
- MilkSU 只持会话目录、凭据隔离、桌面授权、领域事实/Judge，以及危险或量不到的递归删除二次确认。给模型看的 MilkSU 正文跟界面语言走（默认中文）：运行时上下文、桌宠默认提示、空回复抢救、无工具合同、DSH 读图回退、附件前言、AGENTS.md 包装句、CTF ROLE_STATE。工具 schema 和 Pi 自带英文 coding harness 仍是原文。
- 账户 TokenFlux 与本机 Provider 共用可调用目录；保存的模型 id 跟目录真实后缀走（例如目录只有 `gemini-3.8-flash-tiered` 时不再请求无后缀的 `gemini-3.8-flash`）。附件原图进当前回合。网页查证复用 Pi `web_search` / `web_fetch`。
- 桌面壳是 Electron/Chromium。产品 UI 是 React + shadcn。桌宠作曲栏加号走现有本机附件 RPC：图片缩略图按原比例，文件进当前回合；发出去的气泡立刻出现。桌宠气泡按 gifted-chat 分组圆角收口，不再画遮字尖角；助手与用户正文复用 Coding 的 `MarkdownContent`（错误串仍纯文本）。设置 → 桌宠「外观」可调对话字体 / 字号，与设置 → 通用、主窗口对话共用同一组 `conversation_font` / `conversation_font_size`，改完经 BroadcastChannel / localStorage 同步到桌宠窗。桌宠手机窗按 iPhone 镜像 `build/iphone17-compare/iphone17-mirror.png` 做成 288 × 604。屏幕圆角仍按 402×874 pt 上 `_displayCornerRadius` 62 pt 缩放到 41.64 px，机身再加 5 px 边；不用 Chromium `corner-shape:squircle`。抬头用 MIT `react-progressive-blur` 多层 `backdrop-filter`：记录滚进 Milk 胶囊带才被磨砂，没有实心白遮罩；磨砂层不加 `clip-path`。手机抬头头像白底带细边框，点头像在同一手机窗内叠一层桌宠设置页（复用 `CompanionSettingsPanel`；companion preload / shell 放行 `GetSettings` / `SaveSettingsCmd` / `GetModelCatalog` 与皮肤导入移除，字体 / 悬浮窗 / 皮肤可在手机内改完即存）；返回玻璃 chevron 回到对话，不关手机。托盘 / 菜单「桌宠设置」仍打开主窗口设置 → 桌宠。对话时间按系统日期格式。夜间模式跟主窗口同一套存储并同步到桌宠窗。Cmd+Q / Ctrl+Q / 菜单退出结束进程；关主窗仍留桌宠。隔离浏览器、Browser Use、Computer Use 是三个表面；面板折叠不停止 Session。产物在各 OS 文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。
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
