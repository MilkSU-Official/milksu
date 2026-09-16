# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-09-17
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
| 当前开发 | 新对话可选 Pi 或 DeepSeek Harness；设置 → 模型「默认运行时」只改新对话 kernel，不改写旧会话。出厂默认官方 DeepSeek Flash、默认运行时 DSH。工作树 DSH 钉 `0.1.6-alpha.1`（内核，不是 UI 参考；原厂 GUI 是 `dsh web`）。Pi 子 Agent 默认主工作区、父回合阻塞；DSH 可在 Multitask 下用 ACP `session/new` 开子会话并继续主对话。Working 短胶囊对 Pi / DSH 同一套信息架构。Computer Use 由模型列窗 / 认窗 / 锁定。产品回归入口 `npm run test:product-loop`。产品 UI 语言和工作树 renderer 是 React + shadcn，见 `AGENTS.md`。`v26.916.2` 安装包已是 React + shadcn。未做：新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。宽作业用 `recon-authorized-target` Skill，不造 typed sweep。 |
| 平台边界 | macOS DMG 签名公证；Windows 安装器未代码签名，打入 CUA Driver `0.27.0`；Linux 发共用 DEB 与 tarball，GNOME Portal 已进包，无 Secret Service / 本地 OCR；Hyprland/Xorg Computer Use 不可用。Windows/Linux 窗口铬尚未真机验收。安装包见 README。 |
| 发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted。`macos-release` 仅限 `main`，dispatch 后立即签名。正式包装 OTA 到私有 R2 并发布 current pointer；GitHub Release 不上 updater ZIP。 |

## 已发行

更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)，本页不复述。

最近一次正式包装源 `8e44b319`（`26.916.2`）：产品 UI 改为 React + shadcn；设置可选界面/对话字族与 11–18px 字号；默认运行时 DSH；Working / Multitask；主题 light/dark 不再跟系统反转。Windows 安装器仍未代码签名。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.916.2>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `35119063866` | `MilkSU-macOS-arm64-26.916.2.dmg` | 329,078,946 B | `826e3093a844a4bbf928f7289d6002d479456fe2422277a27e25a33646d9f25b` |
| Windows x64 | `35119069646` | `MilkSU-Windows-x64-26.916.2-Setup.exe` | 263,083,136 B | `c89556da71015e40149f23f8bc88475bd4584cd2e51819203b13c70b236f4817` |
| Linux x64 DEB | `35121459391` | `MilkSU-Linux-x64-26.916.2.deb` | 236,953,320 B | `ea72ec77388e3b850ffb2081db1328730d3d9e169ea598037c0661c4bb1f3157` |
| Linux x64 tarball | `35121459391` | `MilkSU-Linux-x64-26.916.2.tar.gz` | 290,163,067 B | `5927ea2ab7ef0ebe628eee91b2d2d3eff3c4aff2f878e7b72b1c9748a381ac73` |

## 未打进 GitHub 安装包

- 新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。
- Computer Use 选窗器仍是可选人工面。宽作业走 `recon-authorized-target` Skill，不造 typed sweep。
- DSH `bash` 没有 MilkSU 侧超时上界（工具在 harness 进程内，不要在客户端复刻第二套循环）。
- 不要把 `test:dsh-complete-loop` 当主入口。产品回归走 `npm run test:product-loop`。
- Agent Harness：DSH 没有 Cursor 那种 `run_in_background` Task。ACP `session/prompt` 要等到 `whenIdle`（含子代理）才结算，所以主对话继续发走 host `Agent.followup`。作曲栏停止键只在父回合还在生成、压缩或中止时出现。加号 Multitask 才是另开 ACP 子会话。Pi 的 `subagent` 仍阻塞父工具。不要升 Pi 来假装能并行。
- 不要复刻原厂 `dsh web` 皮肤、Queue dock、Jobs 顶栏、slash 目录或 Agent preset 切换器。未复刻 child transcript、preset、插件清单、归档、Schedule。
- 设置 → 通用「强调色」：出厂默认墨色；可选蓝 / 紫 / 青 / 琥珀 / 玫红。彩色预设同时改写 `--emphasis` 与 `--primary`，发送/主按钮、选中滤片、Switch / Checkbox、进度条、侧栏选中细条和 `text-primary` 勾选跟色；侧栏「更新」仍用固定 `--update` 蓝。即时落盘。未进安装包。
- 准备 writer 时按停止，有时同时出现「本轮已停止。」和「Agent 运行失败」。合同只留前者。

## 当前产品事实

- Coding / CTF / CVE / 实验室共用 Pi 文件、Shell、自动压缩（80% 空闲与 `/compact` 同一路径）和完整工作循环。工具结果进模型前走 Pi `tool_result` 截断。不扫描用户句子做意图路由。
- MilkSU 只持会话目录、凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。
- 账户 TokenFlux 与本机 Provider 共用可调用目录；附件原图进当前回合。网页查证复用 Pi `web_search` / `web_fetch`。
- 桌面壳是 Electron/Chromium。产品 UI 是 React + shadcn。隔离浏览器、Browser Use、Computer Use 是三个表面；面板折叠不停止 Session。产物在各 OS 文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。
- 产品 UI 只写在 `AGENTS.md`。

## 当前完成线

1. 功能改动后按 [产品回归循环](product-regression-loop.md) 跑 `npm run test:product-loop`；失败回 P0。安装包上的 Pi / 实验室靶机仍由用户真机看。
2. 用户要求发下一版时：升版本号 → 干净已推送的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | 改对话 / 引擎 / DSH / 隔离浏览器后跑 `npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。Settings「评测」不替代这条。C9 / C15 / C16 / C20 已确认；DSH A/B/C 已复验。 |
| P0 | React + shadcn | 工作树 renderer 已是 React + shadcn（`main.tsx`）。新页和重构只走这条。不再跟 DSH web GUI，不再加 Felinic / Vue SFC。Desktop RPC 与 Go 不动。细节优化看下面「迁移残留」。 |
| P0 | Pi Runtime 用户验收 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复；无 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256 与平台验收。安装包见 README。 |
| P1 | OTA / current pointer | 侧栏蓝色「更新」一点即下载并重启；有任务在跑时先确认退出并落盘后续跑；安装失败可见；CI 上传后发布 current pointer。 |
| P1 | Wide lab recon | `bg_status` 熔断与最多 4 条子 Agent lane 已进包。宽作业用 `recon-authorized-target` Skill，不另造 typed sweep。 |
| P1 | 安全工具真实任务 | IDA / capa 已有设置与健康检查；用受控样本留回执。不把 HexStrike 做成默认 MCP。 |
| P1 | Obelisk 学习记录 | 先定义可归因事实，再独立页面；不恢复已删的单会话图谱。 |
| 未接线 | 同一作业 vs 新业务 | 当前 CVE/实验室复用同一会话和 `report.md`。 |
| 未接线 | CTF 比赛模式 | 对着一场比赛打，不走练习题库。尚未设计准入。 |
| 未接线 | 实验室红队模式 | 另开学习面，不是对外红队。尚未设计准入。 |

CVE：点进档案复现，Agent 改 `report.md`。实验室：独立入口，练习包起本机 Docker / AVD 或用户给地址，活报告 + 对话小窗。环境契约见 [靶机、环境经纪与活靶面](/architecture/target-environments)。

### React 迁移残留（行为 / 风格，留给细节优化）

行为可能和旧 Vue + Felinic 不一致：

- Settings / Profile / Eval / Vuln / Lab 本地状态走 `createStore` + `useStore` / `useStoreRuntime`，页面订阅读稳定 snapshot。
- Dialog / Select / Dropdown / Switch 从 Felinic `v-model` 换成 Radix `open` + `onOpenChange`。点遮罩关闭、Esc、焦点陷阱、Select 受控值可能和旧的不一样。
- 已访问的 CTF / CVE / Lab 会留在树上用 `display:none` 藏起来（相当于旧 KeepAlive）。对话右栏是 `ContextRail`。`CodingComposerControls` 不再补 `[data-button]::before`。侧栏搜索和 Cmd/Ctrl+K 打开居中命令面板（齐平搜索、全部/会话/设置/命令、最近会话加点/工作区/相对时间）；对话行右侧显示相对活跃时间，悬停钉选/归档、右键菜单，没有三点按钮；钉选分组用图钉，项目文件夹开合换图标。作曲栏模型芯片先出一级菜单（模型 / 推理强度 / 上下文 / 运行时），点开不展开二级，悬停才出二级，二级按窗口限高滚动；Git 芯片是可搜索、限高滚动、可从查询创建分支的 popover；设置页默认/subagent 仍是单个可搜索 popover；图片附件用缩略图，`@` 走现有选文件 RPC；短时失败用 toast，审批/凭据/表单错误仍用 Alert。
- Vite / 浏览器 demo 没有 `window.milksu`。设置页不再把 `desktop runtime is unavailable` 当成产品错误；完整设置和插件列表要 Electron。

风格（C：shadcn 结构 + Cursor Light / Cursor Dark，彩蛋后加）：

- `index.css` 夜间是页面 `#181818` / 侧栏 `#141414`，浅色是页面 `#fcfcfc` / 侧栏 `#f3f3f3`，页底和侧栏用 70–90% 透明度透出一丝桌面。macOS `under-window` vibrancy，Windows acrylic，Linux 仍不透明。菜单/对话框保持不透明。不要再用 zinc-950 `#09090b` 或纯白 `#ffffff` 当页底。`ak-ui.css` / `beautiful-chrome.css` 已从树上删掉，不要当现行语言加回来。
- 设置页跟 Cursor：设置分类占用原来那一列侧栏，不要再叠第二列导航。内容是一组 `SettingsSection` / `SettingsRow`，右侧控件与行标签同一字号、同一高度。改完即存，不要页脚「保存并验证」。不要再套第二层卡片或评测 workbench。LIVE/AUTH 彩蛋未加回。
- 产品入口是 `main.tsx`；`@felinic/ui` / Vue 已从 `app/` 生产依赖拿掉。Felinic submodule `packages/ui` 已卸载，不进 renderer。

## 不要重复打开

只在新复现、自动化失败或用户明确要求时重开：已撤单会话图谱；Wails/CEF；workspace-only 文件工具；Security Bridge / `continue_ctf_job`；关键词意图路由；自建计费；把 dirty HEAD 写成已发版；M3/M4 台账。

## 领域与文档

- CTF：模型只提 Candidate；成功只来自 Judge 或用户确认。
- CVE：完成面是复现报告，不是「复现成功」。
- 实验室：未知洞探测，不是对外红队，也不是 CTF 环境包。
- Memory：用户能力事实必须能链到 Judge、正式 Evidence 或用户确认。
- 依赖方向：`React → Preload / RPC → Application Service → Domain / Runtime → Adapter`。入口是 `main.tsx`。
- 触碰 `CTFPage.tsx`、`app.go`、`bridge-policy.js`、`browsercap/manager.go` 或 Runner/Recovery 时，不往热点文件再加一份通用 harness。
