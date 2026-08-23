# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-23
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现事实以当前代码、测试、Git 历史和原生 App 验收为准；历史设计与旧里程碑不作为任务队列。
>
> 发版改动与未发版改动必须分开写。有三端回执的正式 GitHub Release 是今日首发 `26.823.1`。
> 文档收口提交不移动该 tag。不要把晚于 `efeda10` 的 HEAD 写成已发版。

## 工作规则

1. 先读当前代码、Git 状态、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)，不要按旧对话重做已闭环事项。
2. MilkSU 仍是 pre-release：新能力实现当前干净模型，不为已放弃的旧设计写迁移、双写或兼容层。
3. 上游优先：平台/Pi → 固定可审阅 Skill、MCP、插件或 CLI → 最小自有实现。Pi 已拥有的通用 Coding 能力，不在 MilkSU 再造一套 harness。
4. Provider Key 不进入模型上下文、工具输出、日志、诊断、文档或普通文件；Git 只推到授权的 MilkSU 远端。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果与危险大目录删除确认。
6. CTF、CVE、实验室、Coding 是同级工作区；通用会话、文件、Shell、浏览器、恢复与工具循环优先共享 Pi，领域事实、Evidence、Judge 与学习记录由 MilkSU 持有。
7. UI/Runtime 修复必须回写本页；未打包或未由用户验收的能力不得写成已发行或已完成。
8. 写发行声明时同时给出“正式发行基线”和“开发 HEAD”。发版完成后必须立刻按
   [三端打包与发版流程](release-process.md) 回写本页、[文档状态](document-status.md)、
   [当前系统](../architecture/current-system.md)、`README.md` 和 `AGENTS.md`，不能把上一版回执留成“最新”。
   版本号、空 tag 或本地 dirty 包仍然不等于已发版。
9. **尚未实现不是禁止实现。** 不要在能力出现前写解冻清单、冻结门或“不准做 PoC / 不准扩工作台 / 不准进 CTF/CVE”。真边界只覆盖 Key、未授权外部目标、Judge 与把 smoke 写成完成。选中的产品切片可以直接做。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | **内测迭代 / Agent Runtime 与跨平台发行收敛**。当前工作不再按 M3/M4 里程碑组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 正式发行基线 | `v26.823.1 / efeda10af4f1e2cf55c4a8db1761cdbb486055a2`（2026-08-23 今日首发）。这是当前 GitHub Latest Release；提供带版本号的 DMG、EXE、DEB 与 `SHA256SUMS`；R2/Admin current pointer 未发布。 |
| 开发版本线 | 根目录与 `desktop/package.json` 是 `26.823.1`。正式发行源是 `efeda10`；文档收口提交不移动该 tag。 |
| 当前开发 | 正式包是 `26.823.1`。CTF / CVE / 实验室共用完整 Coding 循环、始终开启的上下文整理，以及 CVE 列表里的公开源条目，都已打进本包。 |
| 平台边界 | `26.823.1`：macOS DMG 本机 Developer ID 签名并公证；Windows 安装器完成原生 Runtime 与首次启动但未代码签名，并打入审阅过的 CUA Driver；Linux DEB 完成包结构、Sidecar、Go Runtime 与 Xvfb Electron 启动，仍无 Secret Service、本地 OCR、Computer Use。 |
| 发行流水 | 下一发行从干净、已推送的 `main` 对 canonical Go/Vue/Sidecar/lint/生产与文档构建只验证一次；macOS / Windows / Linux 都走 GitHub-hosted 云端。macOS 本机打包暂时关闭。必须创建 GitHub Release 页并上传带版本号的 DMG/EXE/DEB 与 SHA256SUMS，不能只留空 tag。GitHub-only 不生成 OTA ZIP/metadata。 |

## 已发行改动：`26.817.1` → `26.823.1`

`26.817.1`–`26.817.3` 是 8 月 16–17 日发出的内测线。`26.818.1` / `26.818.2` 是 8 月 18 日两版。`26.819.1` 是 8 月 19 日 ak-ui 生产视觉包。`26.822.1` 是 8 月 22 日档案复现与实验室包。可从 Releases 下载的最新正式包能力以 `26.823.1` 为准。

### `26.817.1` / `main@783679f`

- 账户 GitHub PKCE、Admin 分配的 TokenFlux 凭据与本机 Provider 共用模型目录；请求直达 `https://tokenflux.dev/v1`。
- 修掉 `milksu-route` 转发时覆盖真实来源凭据的 `401`；外层占位认证不得进入具体 Provider。
- Coding 复用固定 Pi `web_search` / `web_fetch`，并完成真实搜索与官方页面读取。
- 图片按当前模型 image input 或本地 OCR 自动路由；普通文件进入统一附件队列。
- 普通 Coding / CTF / CVE 回到 Pi 原生文件、Shell 与工具循环；删除 workspace-only 文件工具、客服式回复模板和关键词/正则意图路由。
- 提供签名公证的 macOS ARM64 DMG 与未签名 Windows x64 安装器。OTA / R2 current pointer 未发布。

### `26.817.2` / `main@09718ce`

- 增加 Linux x64 试用 DEB，并打通原生 Ubuntu 包结构、Sidecar、Go Runtime 与 Xvfb Electron 启动。
- 修 Windows 桌面壳与 Go Runtime 启动。
- CTF / CVE 恢复 Pi 原生工具语义，不再注入只读启动清单或自建 sandbox-exec。
- 同一 source commit 第一次形成 macOS / Windows / Linux 三端 GitHub prerelease。

### `26.817.3` / `main@1176075`

- Windows 账户服务瞬时失败时不再清空本地账户模型授权；首次发送被双来源拒绝时可安全刷新一次。
- 打包 Go Runtime 在安装目录旁定位 Pi Sidecar，不再重复拼接 `resources`。
- 真实打包 Windows App 完成账户模型验证，并跑通 Pi Agent 文件与 Shell 工具回合。
- 三端 workflow 回执与 SHA-256 已记录在当时的发行页；标签固定在 `1176075`，后续文档/workflow 提交不移动该 tag。

### `26.818.1` / `b92fcde`（2026-08-18 今日首发）

- 账户凭据优先产生带 `credential_source` 的权威目录；缺失模型在请求前跳过，TokenFlux `model_not_found` 可安全回退到个人来源。设置页默认模型与 Coding 共用同一可调用目录（东云，PR #3）。
- 接受 TokenFlux 单模型与复合 Key 模型 ID；已启用服务的模型选择器与目录对齐。
- 自定义中转站只在保存成功后进入列表；MilkSU 账户行不因当前默认是中转而消失（薄荷布丁 / SkyAerope，PR #7）。
- Agent 出错时展示具体 Provider 限制（含 TokenFlux Claude Code 客户端限制），不再一律报“本地运行时异常”。
- Windows 设置页“打开产物目录 / 数据目录”改为 Go 确定受信任路径、Electron `shell.openPath` 打开，不再写死 `/usr/bin/open`（荒景肆，PR #6）。
- 冷启动加快；macOS `⌘Q` 立即退出。
- 无项目任务钉在项目树下方；厂商图标、Coding 历史栏与启动噪音收敛。
- Composer 旁的上下文用量改成可悬停的环状计量；`milksu_progress` 计划与 token 用量转发给 Coding。
- Pi：上下文溢出与可重试错误不再提前结束回合；abort 不再合成空白气泡。
- 安装包文件名带版本号。GitHub prerelease 提供 DMG / EXE / DEB 与 `SHA256SUMS-26.818.1.txt`。

### `26.818.2` / `ea7d2ff`（2026-08-18 今日第二版）

- 日间模式会话高亮保持可见。
- `+ → 本机文件或图片` 在 `pointerdown` 打开系统选择框；输入框自管 `⌘Z` / `⌘⇧Z`；右侧栏可拖宽并记住宽度。用户已在本地 dirty Stable 包确认 C9 / C15 / C20。
- 普通 Coding Go 或打开右栏会自动拉起隔离浏览器，不再要求设置或批准。每个标签是独立 `WebContentsView`，切换换页并更新地址。用户已确认 C16。
- 子 Agent 把父会话的虚拟 `milksu-route/模型` 改写成账户 `milksu-relay/`，避免独立 Pi CLI 报 Model not found。
- `替我审批` 自动执行隔离浏览器；请求批准卡对可授权操作提供“本对话始终允许”。ImageGen、外部账户授权和破坏性删除仍每次确认。
- 工具行按 `toolCallId` 结束，不再只改最后一条同名调用；用户展开的工具组在后续流式输出中保持展开。
- 新增类型化 `milksu_workspace`：列出/聚焦/关闭内置浏览器标签，列出/预览产物，打开环境、变更、终端和后台任务。设置、凭据、审批档和用户 Chrome 不在这个工具里。
- 上下文用量达到窗口约 85% 且 Session 空闲时，走与 `/compact` 相同的 Pi 压缩；`compact_context` 只在达到阈值时调度。不在整回合结束后才第一次压缩，也不另建 MilkSU 摘要器。
- 目标、计划和会话目录收进 Composer 控制栏 chips；窄栏收成图标，权限按钮按内容宽度。
- NSSCTF「全部 / 收藏」在完整本地目录预热后于前端筛选分页；同步丢弃飞行中的旧全量快照；训练进度从目录快照拆开，Judge/确认后重叠加（AsabaLazy / Luo，PR #8）。
- 未打包 Windows 上补全 GitHub 登录回调；无 Git 也能启动。
- Windows Computer Use 沿用 macOS 的有界 Cua 会话：按绝对可执行文件绑定目标、用 Electron 主进程 PID 排除宿主窗口。可见浏览器窗口也是合法 Computer Use 目标；隔离“浏览器”和 Browser Use 仍是另外两条表面。Driver 先走安装包/Sidecar 自带副本；缺失时可由类型化 `prepare_computer_use_driver` 把 MilkSU 审阅过的 Driver 拷到本机配置目录或按仓库脚本构建，不运行 Cua 官方安装脚本。macOS Computer Use 路径未改。
- 设置页增加默认关闭的应用级本地调试模式：内存环形日志、Desktop RPC 命令名计数和一键复制诊断，不采集凭据、路径或 RPC 参数。
- 安装包文件名带版本号。GitHub prerelease 提供 DMG / EXE / DEB 与 `SHA256SUMS-26.818.2.txt`。

### `26.819.1` / `eed1dac`（2026-08-19 今日首发）

- 生产全页换 ak-ui 视觉（石墨指挥面、纸面事实、青主操作、金焦点），Felinic 留下；旧战术档案 / 酸绿契约已删除（#15 / #18）。
- CTF 每日挑战和 CVE 列表不再默认选中展开；普通 Go 发送不再自动启动隔离浏览器。
- 用户消息有秒级时间分割线；模型 / 工具等待用 compact ak-loading 菱形脉冲。
- 空 TokenFlux 目录时，删除或停用自定义中转站不会再把它的模型 ID 接到 TokenFlux 默认选择或「可用模型」里（#13 / #11）。
- README 截图换成当前 CTF / CVE / Coding 页。GitHub prerelease 提供 DMG / EXE / DEB 与 `SHA256SUMS-26.819.1.txt`。

### `26.822.1` / `3db4615`（2026-08-22 今日首发）

- CVE 点进档案再复现；实验室是独立一级入口；两者共用可拖放对话小窗，工作区留下 Agent 可改的 `report.md`。
- 实验室列表可双击标题或用行内菜单改名；作业记录写入 Go。
- `milksu_workspace` 增加原子记录动作：`list_records` / `get_record` / `create_record` / `update_record` / `archive_records` / `restore_records` / `focus_record` / `search_records`（kind 为 conversation / lab / cve / ctf）。
- 档案对话小窗默认 4:3；上下文用量与大窗 Composer 同一条；带斜杠菜单、Skills 和项目 MCP。
- 日间模式侧栏、会话历史、设置跟随纸面主题；左上角头像为 Admin `ak-media--album` 相框。
- 会话可归档与行内改名；上下文压缩、停止按钮、工具活动组展开状态和产品文案去掉 harness 备注一并打进本包。
- GitHub prerelease 提供 DMG / EXE / DEB 与 `SHA256SUMS-26.822.1.txt`。

### `26.823.1` / `efeda10`（2026-08-23 今日首发）

- CTF、CVE 和实验室使用与 Coding 相同的完整工作循环：终端、Git、变更、产物、执行权限、隔离浏览器和工作台动作都在。领域工具、Judge、证据栏和绑定的题目工作区仍保留。
- 长任务会自动整理上下文，CTF 任务里的 `/compact` 与 Coding 走同一条。过长的工具输出会被截断，需要时再读。
- 设置页「同步公开源」写入的 CISA KEV 条目会进入 CVE 列表；内置样例目录仍不默认铺开。
- 夜间模式 Agent 气泡里的代码块跟气泡前景色；产品窗口拦截 Ctrl+R / Cmd+R / F5，不再回到启动加载页。
- Windows 后台任务与前台 bash 用同一套解析，缺 bash 时作为工具失败返回。非 macOS 上项目 MCP 不再包一层 sandbox-exec。
- 标题、侧栏和正文共用 Inter Variable + Noto Sans SC Variable。Sidecar 崩溃时不再把 Node 内部栈第一行当成用户可见原因。
- GitHub Release（Latest）提供 DMG / EXE / DEB 与 `SHA256SUMS-26.823.1.txt`。

## 未发版改动：晚于 `v26.823.1` / `efeda10` 的 `main`

文档收口提交不移动该 tag。

- Agent 上下文工程收敛：主会话逐回合声明经 Go / Sidecar 校验的权威工作目录，协作 writer worktree 只属于独立 effectful subagent 进程，不再能替换主会话 cwd。受管 Sidecar 启用 Pi 原生 `PI_CACHE_RETENTION=long`，沿用稳定会话 ID 与 Provider prompt cache，不增加 MilkSU 缓存状态机；Pi 的一次性压缩仍显式使用 `cacheRetention: none`。模型目录缺少窗口或仍给出旧 `128000` 占位时，Go、Sidecar 与 Vue 共用的型号族预设会补齐 GPT、Claude、Grok：已知精确型号优先，远端非占位目录值继续权威。GPT 与 Claude Opus / Sonnet / Fable 另有内置思考档位，其他模型须在设置页按实际 Provider 能力手动启用；Composer 用离散滑块写入对话级选择，chip 与档位只显示 `off / minimal / low / medium / high / xhigh / max` 标准英文，Go 约束后交给 Pi 原生 `setThinkingLevel`，子 Agent 继承同一档位。当前 Pi 支持到 `max`；`ultra` 属于 Codex 多 Agent 编排语义，不伪装成 Provider effort。自动化覆盖 cwd 身份、缓存环境、三层窗口解析和思考档位透传；真实 Provider 缓存命中率与 effort 请求仍待用户授权的计费链路验收，不写成完成回执。

## 当前产品事实

### Pi Runtime 收敛

- 普通 Coding、CTF 与 CVE 的文件、Shell、会话生命周期和输出续跑已经回到 Pi 原生语义。MilkSU 不再复制 workspace-only 文件工具、`sandbox-exec`、持久化授权根、Node `--allow-fs-*` 权限状态机或后台授权令牌。
- Coding、CTF、CVE 与实验室共用 Pi 自动压缩：会话创建/复用时 `setAutoCompactionEnabled(true)`，85% 空闲路径与任务 UI `/compact` 都不按角色跳过。工具结果进模型前走 Pi `tool_result` 截断。
- CTF 删除了阻断通用任务的自建 sandbox-exec；仍保留 Challenge、Evidence、Candidate、Judge Receipt、Recovery、Memory、精确站点能力和凭据隔离。达到模型输出长度上限时走 Pi `agent_end` / `followUp`，不把半句当完成。
- CVE → Coding 不再注入“只读检查”“只输出启动清单”等限制，使用普通 Pi 工具和当前权限档。普通产品回合不再被 MilkSU 的 90 秒无事件 watchdog 静默终止；用户主动停止和独立评测 deadline 仍保留。
- 普通用户文字和回复风格交给 Pi/模型理解。GUI 一键动作只传 typed product action、界面语言和无凭据系统环境，不额外注入客服话术、固定长尾问题或关键词/正则意图路由。
- 重启后失效的旧 Pi session ID 会清理并按普通消息重建，不能让 GUI 保持“运行中”而 Sidecar 已停止的分裂状态。
- `26.817.3` 已在真实打包 Windows App 验证账户模型与 Pi 工具回合；`26.818.1` 继续收紧账户目录、错误文案和 Windows Reveal；`26.818.2` 把有界 Computer Use Driver、隔离浏览器多标签和调试模式打进正式包。
- MilkSU 仍保留三项宿主必要边界：会话目录记录、Provider 凭据隔离、递归删除用户 Home/文件系统根/当前 cwd/大型目录时的二次确认。

### 模型、附件与网页查证

- Admin 可为登录用户分配独立 TokenFlux Key；Electron 获取后只交给 Go Credential Store。运行时只展示该 Key 或用户本机已配置 Provider 实际可用的模型。
- 账户模型目录按账户凭据优先刷新并记录不含密钥的 `credential_source`；权威账户目录缺少所选模型时，请求前跳过账户来源，目录未知时仍保留运行时尝试。TokenFlux 在首个内容输出前返回 `model_not_found` / `not supported by any configured account` 时，可安全回退到已配置的个人来源；设置页默认模型与 Coding 共用同一可调用目录。
- 图片按当前模型能力路由：模型声明 image input 时原图进入同一 Pi 回合，否则使用本地 OCR；不配置第二个视觉模型。选择、粘贴和拖放的普通文件进入统一附件栏，可排序、预览、移除并以 Pi 附件描述发送。
- Coding 网页查证复用固定 revision 的 Pi `web_search` / `web_fetch` Extension，不另建 MilkSU 搜索决策状态机；真实联网查询已完成搜索并读取 xAI 官方文档。
- 设置页支持账户模型、原厂 Provider 和最多 8 个简单 OpenAI-compatible 中转站；Key 统一进入 Credential Store，未配置来源不进入模型列表。
- 设置页可按模型启用思考能力、限制支持档位并设置默认值；Coding Composer 只对已启用模型显示对话级快捷滑块。档位沿用 Pi 的 `off / minimal / low / medium / high / xhigh / max`，不维护第二套推理循环。

### 桌面产品表面

- 桌面壳是 Electron/Chromium + Vue；Go 是受管 Runtime，Pi Sidecar 拥有通用模型会话、Compaction 与 Tool Loop。
- 右栏“浏览器”、真实 Chrome/Edge 的 Browser Use、可见窗口的 Computer Use 是三个独立执行表面。Computer Use 可以锁定用户真实浏览器窗口做像素级操作；结构化标签页控制仍走隔离浏览器或 Browser Use。折叠面板只改变观察视图，不应停止 Session。
- 用户可见产物写入各操作系统的用户文档目录下 `MilkSU/{Coding,CTF,CVE,Lab}`；无项目 Coding 临时工作区、Runtime、事件、Obelisk、浏览器 Profile 与凭据留在平台用户配置目录，不把 macOS 路径写死为产品契约。
- Obelisk 会话索引底层继续保留；Coding 右栏与环境页已移除“相关历史”、搜索、过滤和图谱等单会话前端。学习记录/记忆系统如重新进入产品，应单独设计页面。
- 进入 Coding 从“永远打开空白草稿”改为恢复上次会话：会话历史现在有归档、重命名与恢复入口，空白草稿不再是回到工作区的唯一入口，继续上一段任务比重新起草更常见。CTF/CVE 交接与显式历史点击仍然直接打开具体会话。
- Agent 会话的直接删除改为可恢复归档：侧栏归档前确认，设置页集中恢复或永久删除且两者均再次确认；永久删除同步清理 Pi 会话与 Obelisk 活动索引。Coding 会话列表同时支持行内改名。该能力已进入 `26.822.1`。
- 生产视觉是 ak-ui：石墨指挥面、纸面事实、青主操作、金焦点。酸绿不进产品。CTF、CVE、实验室、Coding 用同一套石墨 + 青，不以旧蓝黑色块或酸绿带区分。旧战术档案稿不再是实现约束。

## 当前完成线

### 已完成：`26.823.1` 今日首发三端正式 GitHub Release

三端都从 `efeda10af4f1e2cf55c4a8db1761cdbb486055a2` 构建。GitHub Latest Release 为
`v26.823.1`，没有上传 OTA ZIP；R2/Admin current pointer 未改变。macOS 走本机
Developer ID 签名与公证。Windows / Linux 走成功的 Actions run。

| 平台 | Workflow | 用户安装包 | 大小 | SHA-256 | 结果 |
| --- | --- | ---: | ---: | --- | --- |
| macOS ARM64 | 本机 `release:mac:local` | `MilkSU-macOS-arm64-26.823.1.dmg` | 237,784,345 B | `fdce68aef5d3d6d2a55af1d8ef1d2046de6aaacfebb08e45adcf1558ac09e859` | Developer ID 签名、Apple 公证、staple、Gatekeeper |
| Windows x64 | `32588820764` | `MilkSU-Windows-x64-26.823.1-Setup.exe` | 182,520,020 B | `ff21e869b9f71f4925542cf5b6e54509c08f5bf82c43a0a28bc34daf720d034d` | 原生 Windows 构建、打包 Runtime 与首次启动通过；安装器未代码签名 |
| Linux x64 | `32588822563` | `MilkSU-Linux-x64-26.823.1.deb` | 178,292,984 B | `01bf16a110101c83fc93b72ff334e5f5476078cca96557e4dda880fd24846bce` | 原生 Ubuntu 包结构、Sidecar、Go Runtime 与 Xvfb Electron 首次启动通过；试用边界 |

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.823.1>

上一版 `v26.822.1 / 3db4615` 仍可下载，标签未移动。

### 下一完成线

`26.823.1` 已是当前可下载基线。文档收口提交不改变这个 tag。

下一条完成线是：

1. 继续用 `26.823.1` 安装包做常用 Agent GUI 与 Pi Runtime 回归，失败项回到下面 P0 队列；
2. 用户明确要求发下一版时，先升版本号，再从干净已推送的 `main` 跑 `release:verify` 并留下新的三端回执；不要把现有 `v26.823.1` 标签挪到更新的 HEAD 上。

Windows 签名、Linux 缺失能力、R2/OTA 仍是发行后续，不是产品方向禁令。

### 后续队列

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 常用 Agent GUI 回归 | 按 Coding 常用功能表覆盖中文任务、文件/Shell、附件、斜杠菜单、权限档、subagent、浏览器、Browser/Computer Use、终端、取消/恢复与错误展示；自动化通过后再由用户做真实 GUI 验收。C9 / C15 / C16 / C20 已由用户在本地 dirty Stable 包确认；C10 / C11 已修待复验。 |
| P0 | Pi Runtime 用户验收 | 最新正式包中验证跨目录读写、CTF/CVE 交接、长输出续跑和重启恢复，不出现 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执发行 | 需要新的版本号、同一 source commit、三端产物、SHA-256 与平台验收。现有 `v26.823.1` 只覆盖 `efeda10`。 |
| P1 | OTA 与私有 R2 | Admin 草稿/发布/暂停和 Desktop 更新提示已有；仍需一次受账户鉴权的真实旧签名版 → 新签名版升级回执。 |
| P1 | 安全工具真实任务 | IDA/idalib 与 capa 已有设置、准备和健康检查；用受控本地样本留下真实任务回执。就绪工具接到实验室作业，窄工具也可进 CVE 复现；不需要先开一次“是否投影”的会。不把 HexStrike 整包 MCP 做成产品页或 Kali 应用商店。CodeQL、Burp、Shannon 仍逐项接入。 |
| P1 | Obelisk 学习记录 | 先定义可归因学习事实，再设计独立页面；不恢复已删除的单会话相关历史/图谱面板。 |
| 未接线 | 继续同一作业还是新开一轮 | 当前按同一 CVE/实验室作业复用同一会话和 `report.md`。新开一轮的产品决策还没定。 |

### 当前切片：CVE 复现档案 + 实验室报告

实验室在界面上就叫**实验室**。完成面是 Agent 可继续改的报告，不是状态标签，也不是人签过字的 Finding 列表。未授权外网不扫、不横向、模型候选不能写成已确认漏洞。CTF 仍只当题。CTF 可重置环境（Juice Shop / Vulhub 一类）是另一份长期设计，不是这个实验室模块。

| 切片 | 放哪 | 做什么 | 现在能看见 |
| --- | --- | --- | --- |
| **CVE：已知洞复现** | 点进 CVE 档案，不在列表卡片上做 | 按公开描述打一轮。Agent 编辑工作区 `report.md`（或 `report.html`）：摘要、环境、进程、网络、步骤。没打上也留报告。 | 列表点进去后能看摘要/来源、开始复现、报告和右下角对话小窗 |
| **实验室** | 独立一级入口，不塞进 CVE | 用户给出协议和地址，开作业。Agent 对这个靶做探测，把发现写进同一份活报告。工具在设置里准备，在作业里使用。 | 新作业 → 报告 + 对话小窗；作业留在列表 |

共用：Pi 会话、详情页 + 右下角对话小窗。CTF 不再把解题嵌进整页 Coding。同一 CVE / 题目 / 实验室作业可以新开对话，列表和 Coding 大窗共用同一会话。HexStrike 只作为以后实验室作业里可审阅的 CLI，不作为默认 MCP、不作为独立页面。

## 不要重复打开

以下只在出现新复现、自动化失败或用户明确要求时重开：

- 已撤下的单会话“相关历史”与图谱前端；Obelisk 底层索引不等于该 UI。
- Wails/CEF 双壳、workspace-only 文件工具、Node 文件权限状态机、普通回合 watchdog、CVE 只读启动清单和客服式回复模板。
- 用关键词或正则扫描用户句子来打开浏览器、切页或选工具。
- MilkSU 自建余额、价格映射、扣费流水和模型代理计费。
- 把晚于 `v26.823.1` 的 HEAD、同一版本号或本地 dirty 包写成已经发出的三端正式包。
- M3/M4 旧百分比台账、历史 Beta 完成度和已删除 live smoke；需要考古时使用 Git history。

## 领域完成线

- **CTF**：模型只提出 Candidate；Judge 或用户明确授权结果才能建立成功事实。通用能力走 Pi，MilkSU 保留题目、Evidence、Judge、Recovery 与 Memory。`26.823.1` 起 CTF / CVE / 实验室与 Coding 共用完整循环（终端、Git、浏览器、工作台动作）；领域工具叠在上面，不是禁令也不是替换。
- **CVE**：发行面包含公共数据搜索、用户主动追踪、手工状态，以及点进档案后的复现报告。不以「复现成功 / 没复现上」当完成面。披露草稿仍可后做。对用户未授权的外部资产，仍需要可见、准确的授权。
- **实验室**：`26.822.1` 已接线列表、改名、作业、报告和对话小窗。它是未知漏洞探测作业面，不是对外红队，也不是 CTF 题库里的环境包。
- **Memory**：Agent 代做不等于用户掌握。用户能力事实必须能链到 Judge、测试/提交、正式 Evidence 或用户确认。
- **发行**：按钮、构建文件、版本号或空 tag 不等于可分发版本；必须保留对应平台真实产物和验收回执。

## 架构与文档规则

- 依赖方向固定为 `Vue → Electron Preload / Desktop RPC → Application Service → Domain / Runtime → Adapter`。
- 触碰 `CTFPage.vue`、`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、`internal/browsercap/manager.go` 或 Runner/Recovery 时，不再向热点文件增加第二份通用 harness 职责。
- 文档分 Current、Evidence、Historical/Research 三层。Current 只放当前事实与下一完成线；过程聊天、微提交、历史 smoke 和已撤下设计不堆进入口。
