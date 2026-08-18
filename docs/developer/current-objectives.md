# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-18
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现事实以当前代码、测试、Git 历史和原生 App 验收为准；历史设计与旧里程碑不作为任务队列。
>
> 发版改动与未发版改动必须分开写。有三端回执的正式内测包是 `26.817.3`；仓库版本线已经到 `26.818.1`，其中大部分产品改动尚未形成新的三端回执发行。

## 工作规则

1. 先读当前代码、Git 状态、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)，不要按旧对话重做已闭环事项。
2. MilkSU 仍是 pre-release：新能力实现当前干净模型，不为已放弃的旧设计写迁移、双写或兼容层。
3. 上游优先：平台/Pi → 固定可审阅 Skill、MCP、插件或 CLI → 最小自有实现。Pi 已拥有的通用 Coding 能力，不在 MilkSU 再造一套 harness。
4. Provider Key 不进入模型上下文、工具输出、日志、诊断、文档或普通文件；只向 MilkSU 私有远端发布。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果与危险大目录删除确认。
6. CTF、CVE、Coding 是同级工作区；通用会话、文件、Shell、浏览器、恢复与工具循环优先共享 Pi，领域事实、Evidence、Judge 与学习记录由 MilkSU 持有。
7. UI/Runtime 修复必须回写本页；未打包或未由用户验收的能力不得写成已发行或已完成。
8. 写发行声明时同时给出“正式发行基线”和“开发 HEAD”。`package.json` 的 `26.818.1` 与标签 `v26.818.1` 不等于三端回执发行。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | **内测迭代 / Agent Runtime 与跨平台发行收敛**。当前工作不再按 M3/M4 里程碑组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 正式发行基线 | `v26.817.3 / main@11760758926ab2a1f025cc32c2518d19afdeca35`。这是最近一次带 SHA-256 与三端 workflow 回执的内测发行；GitHub prerelease 只提供 DMG、EXE、DEB，R2/Admin current pointer 未发布。 |
| 开发版本线 | 根目录与 `desktop/package.json` 已升到 `26.818.1`。标签 `v26.818.1` 落在测试提交 `b92fcde`，不是一次三端回执发行，不能当下载基线。 |
| 当前开发 | `main` 晚于 `1176075`：先并入 `26.817.1`–`26.817.3` 的全部已发行改动，再叠加上面的未发版 Coding GUI、账户目录、CTF 本地目录、审批/压缩与发行工具。文档收口时 HEAD 含 `a2c71fb`（上下文约 85% 自动压缩）。 |
| 平台边界 | `26.817.3`：macOS DMG 已签名、公证、staple、Gatekeeper；Windows 安装器完成原生 Runtime 与首次启动但未代码签名；Linux DEB 完成包结构、Sidecar、Go Runtime 与 Xvfb Electron 启动，仍无 Secret Service、本地 OCR、Computer Use。未发版还修了 Windows 目录 Reveal、冷启动和本机 Personal Vault 签名默认路径，尚未随新包发出。 |
| 发行流水 | 下一发行从干净、已推送的 `main` 对 canonical Go/Vue/Sidecar/lint/生产与文档构建只验证一次；Windows/Linux 走云端，macOS 默认本机 `release:mac:local`。必须创建 GitHub Release 页并上传带版本号的 DMG/EXE/DEB 与 SHA256SUMS，不能只留空 tag。GitHub-only 不生成 OTA ZIP/metadata。 |

## 已发行改动：`26.817.1` → `26.818.1`

`26.817.1`–`26.817.3` 是 8 月 16–17 日发出的内测线。今日首发、可从 Releases 下载的正式包能力以 `26.818.1` 为准。

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

## 未发版改动：晚于 `v26.818.1` / `b92fcde` 的 `main`

这些已经在当前 `main` 里，版本号仍是 `26.818.1`，但**不在**今日发出的安装包中。不要把它们写进 `26.818.1` 下载说明，也不要把当前 HEAD 当成已经发出的包。

### Coding 工作台

- 日间模式会话高亮保持可见。
- `+ → 本机文件或图片` 在 `pointerdown` 打开系统选择框；输入框自管 `⌘Z` / `⌘⇧Z`；右侧栏可拖宽并记住宽度。用户已在本地 dirty Stable 包确认 C9 / C15 / C20。
- 普通 Coding Go 或打开右栏会自动拉起隔离浏览器，不再要求设置或批准。每个标签是独立 `WebContentsView`，切换换页并更新地址。用户已确认 C16。
- 子 Agent 把父会话的虚拟 `milksu-route/模型` 改写成账户 `milksu-relay/`，避免独立 Pi CLI 报 Model not found。
- `替我审批` 自动执行隔离浏览器；请求批准卡对可授权操作提供“本对话始终允许”。ImageGen、外部账户授权和破坏性删除仍每次确认。
- 工具行按 `toolCallId` 结束，不再只改最后一条同名调用；用户展开的工具组在后续流式输出中保持展开。
- 新增类型化 `milksu_workspace`：列出/聚焦/关闭内置浏览器标签，列出/预览产物，打开环境、变更、终端和后台任务。设置、凭据、审批档和用户 Chrome 不在这个工具里。
- 上下文用量达到窗口约 85% 且 Session 空闲时，走与 `/compact` 相同的 Pi 压缩；`compact_context` 只在达到阈值时调度。不在整回合结束后才第一次压缩，也不另建 MilkSU 摘要器。

### CTF / CVE / 桌面宿主

- NSSCTF「全部 / 收藏」在完整本地目录预热后于前端筛选分页；同步丢弃飞行中的旧全量快照；训练进度从目录快照拆开，Judge/确认后重叠加（AsabaLazy / Luo，PR #8）。
- 未打包 Windows 上补全 GitHub 登录回调（`996820e`）。新的正式 Windows 包尚未发行。
- CTF / CVE 的模型操作工作台 UX 后置，不在本轮把 `milksu_workspace` 扩到那两个模块。

### 发行工具

- 本机默认走 Personal Vault 签名；`release:github` 必须创建/刷新 GitHub Release 页。
- 这些是发版管道后续提交，不是一次已经发出的新版本号。

## 当前产品事实

### Pi Runtime 收敛

- 普通 Coding、CTF 与 CVE 的文件、Shell、会话生命周期和输出续跑已经回到 Pi 原生语义。MilkSU 不再复制 workspace-only 文件工具、`sandbox-exec`、持久化授权根、Node `--allow-fs-*` 权限状态机或后台授权令牌。
- CTF 删除了阻断通用任务的自建 sandbox-exec；仍保留 Challenge、Evidence、Candidate、Judge Receipt、Recovery、Memory、精确站点能力和凭据隔离。达到模型输出长度上限时走 Pi `agent_end` / `followUp`，不把半句当完成。
- CVE → Coding 不再注入“只读检查”“只输出启动清单”等限制，使用普通 Pi 工具和当前权限档。普通产品回合不再被 MilkSU 的 90 秒无事件 watchdog 静默终止；用户主动停止和独立评测 deadline 仍保留。
- 普通用户文字和回复风格交给 Pi/模型理解。GUI 一键动作只传 typed product action、界面语言和无凭据系统环境，不额外注入客服话术、固定长尾问题或关键词/正则意图路由。
- 重启后失效的旧 Pi session ID 会清理并按普通消息重建，不能让 GUI 保持“运行中”而 Sidecar 已停止的分裂状态。
- `26.817.3` 已在真实打包 Windows App 验证账户模型与 Pi 工具回合；`26.818.1` 继续收紧账户目录、错误文案和 Windows Reveal。
- MilkSU 仍保留三项宿主必要边界：会话目录记录、Provider 凭据隔离、递归删除用户 Home/文件系统根/当前 cwd/大型目录时的二次确认。

### 模型、附件与网页查证

- Admin 可为登录用户分配独立 TokenFlux Key；Electron 获取后只交给 Go Credential Store。运行时只展示该 Key 或用户本机已配置 Provider 实际可用的模型。
- 账户模型目录按账户凭据优先刷新并记录不含密钥的 `credential_source`；权威账户目录缺少所选模型时，请求前跳过账户来源，目录未知时仍保留运行时尝试。TokenFlux 在首个内容输出前返回 `model_not_found` / `not supported by any configured account` 时，可安全回退到已配置的个人来源；设置页默认模型与 Coding 共用同一可调用目录。
- 图片按当前模型能力路由：模型声明 image input 时原图进入同一 Pi 回合，否则使用本地 OCR；不配置第二个视觉模型。选择、粘贴和拖放的普通文件进入统一附件栏，可排序、预览、移除并以 Pi 附件描述发送。
- Coding 网页查证复用固定 revision 的 Pi `web_search` / `web_fetch` Extension，不另建 MilkSU 搜索决策状态机；真实联网查询已完成搜索并读取 xAI 官方文档。
- 设置页支持账户模型、原厂 Provider 和最多 8 个简单 OpenAI-compatible 中转站；Key 统一进入 Credential Store，未配置来源不进入模型列表。

### 桌面产品表面

- 桌面壳是 Electron/Chromium + Vue；Go 是受管 Runtime，Pi Sidecar 拥有通用模型会话、Compaction 与 Tool Loop。
- 右栏“浏览器”、真实 Chrome/Edge 的 Browser Use、外部 App 的 Computer Use 是三个独立执行表面。折叠面板只改变观察视图，不应停止 Session。
- 用户可见产物写入各操作系统的用户文档目录下 `MilkSU/{Coding,CTF,CVE}`；无项目 Coding 临时工作区、Runtime、事件、Obelisk、浏览器 Profile 与凭据留在平台用户配置目录，不把 macOS 路径写死为产品契约。
- Obelisk 会话索引底层继续保留；Coding 右栏与环境页已移除“相关历史”、搜索、过滤和图谱等单会话前端。学习记录/记忆系统如重新进入产品，应单独设计页面。
- 日间/夜间模式共用中性纸面/暖石墨层级，酸绿只用于选择、主操作和活动强度；CTF、CVE、Coding 不以旧蓝黑色块区分。

## 当前完成线

### 已完成：`26.818.1` 今日首发三端内测发行

三端都从 `b92fcded25e59805463af4ff718d73ed8776e3fb` 构建。GitHub prerelease 为
`v26.818.1`，没有上传 OTA ZIP；R2/Admin current pointer 未改变。macOS 走本机
Developer ID 签名与公证；云端 macOS job 已取消。Windows / Linux 走成功的 Actions run。

| 平台 | Workflow | 用户安装包 | 大小 | SHA-256 | 结果 |
| --- | --- | ---: | ---: | --- | --- |
| macOS ARM64 | 本机 `release:mac:local` | `MilkSU-macOS-arm64-26.818.1.dmg` | 233,523,396 B | `cc328d86518ee6c9b0035b4ac1581fd80a1390bdb7b63d6c5326f880c25e9cc6` | Developer ID 签名、Apple 公证；云端 macOS job `32095636487` / `32095689774` 已取消 |
| Windows x64 | `32095638823` | `MilkSU-Windows-x64-26.818.1-Setup.exe` | 172,663,691 B | `3cc5608a3bb4585656866b6c2b0ef601300c2440b97b5e08c588f5b41e6de5a5` | 原生 Windows 构建、打包 Runtime 与首次启动通过；安装器未代码签名 |
| Linux x64 | `32095642259` | `MilkSU-Linux-x64-26.818.1.deb` | 174,505,248 B | `9265394a91d9490d18389f60c23992f22ffcdd732349df2d93e27880546f0669` | 原生 Ubuntu 包结构、Sidecar、Go Runtime 与 Xvfb Electron 首次启动通过；试用边界 |

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.818.1>

### 下一完成线

`26.818.1` 已是当前可下载基线。`main` 上晚于 `b92fcde` 的 Coding GUI、审批、压缩、
CTF 目录和未打包 Windows 登录回调还不是一次新发行。

下一条完成线是：

1. 继续用当前开发包做常用 Agent GUI 与 Pi Runtime 回归，失败项回到下面 P0 队列；
2. 用户明确要求发下一版时，先升版本号，再从干净已推送的 `main` 跑 `release:verify` 并留下新的三端回执；不要把现有 `v26.818.1` 标签挪到更新的 HEAD 上。

Windows 签名、Linux 缺失能力、R2/OTA，以及 CTF/CVE 模型操作工作台 UX，分别保持为明确后续工作。

### 后续队列

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 常用 Agent GUI 回归 | 按 Coding 常用功能表覆盖中文任务、文件/Shell、附件、斜杠菜单、权限档、subagent、浏览器、Browser/Computer Use、终端、取消/恢复与错误展示；自动化通过后再由用户做真实 GUI 验收。C9 / C15 / C16 / C20 已由用户在本地 dirty Stable 包确认；C10 / C11 已修待复验。 |
| P0 | Pi Runtime 用户验收 | 最新正式包中验证跨目录读写、CTF/CVE 交接、长输出续跑和重启恢复，不出现 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执发行 | 需要新的版本号、同一 source commit、三端产物、SHA-256 与平台验收。现有 `v26.818.1` 不够覆盖 `b92fcde` 之后的 `main`。 |
| P1 | OTA 与私有 R2 | Admin 草稿/发布/暂停和 Desktop 更新提示已有；仍需一次受账户鉴权的真实旧签名版 → 新签名版升级回执。 |
| P1 | 安全工具真实任务 | IDA/idalib 与 capa 已有设置、准备和健康检查；分别用受控本地样本保留真实任务回执后，才决定是否进入 CTF/CVE。CodeQL、Burp、Shannon 仍逐项准入。 |
| P1 | Obelisk 学习记录 | 先定义可归因学习事实，再设计独立页面；不恢复已删除的单会话相关历史/图谱面板。 |
| 后置 | CTF/CVE 模型操作工作台 | 领域工具与 Coding 交接已有；不把 `milksu_workspace` 扩到 CTF/CVE，直到产品 UX 想清楚。 |
| 后置 | 深度安全与 Labs | CVE 真实复现、外部资产实验、披露自动化和 Labs 不属于当前发行完成线。 |

## 不要重复打开

以下只在出现新复现、自动化失败或用户明确要求时重开：

- 已撤下的单会话“相关历史”与图谱前端；Obelisk 底层索引不等于该 UI。
- Wails/CEF 双壳、workspace-only 文件工具、Node 文件权限状态机、普通回合 watchdog、CVE 只读启动清单和客服式回复模板。
- 用关键词或正则扫描用户句子来打开浏览器、切页或选工具。
- MilkSU 自建余额、价格映射、扣费流水和模型代理计费。
- 把晚于 `v26.818.1` 的 HEAD、同一版本号或本地 dirty 包写成已经发出的三端正式包。
- M3/M4 旧百分比台账、历史 Beta 完成度和已删除 live smoke；需要考古时使用 Git history。

## 领域完成线

- **CTF**：模型只提出 Candidate；Judge 或用户明确授权结果才能建立成功事实。通用 Coding 能力走 Pi，MilkSU 保留题目、Evidence、Judge、Recovery 与 Memory。
- **CVE**：当前只做公共数据搜索、用户主动追踪、手工状态和关联 Coding；不默认运行 PoC，不对外部资产采取行动。
- **Memory**：Agent 代做不等于用户掌握。用户能力事实必须能链到 Judge、测试/提交、正式 Evidence 或用户确认。
- **发行**：按钮、构建文件、版本号或空 tag 不等于可分发版本；必须保留对应平台真实产物和验收回执。

## 架构与文档规则

- 依赖方向固定为 `Vue → Electron Preload / Desktop RPC → Application Service → Domain / Runtime → Adapter`。
- 触碰 `CTFPage.vue`、`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、`internal/browsercap/manager.go` 或 Runner/Recovery 时，不再向热点文件增加第二份通用 harness 职责。
- 文档分 Current、Evidence、Historical/Research 三层。Current 只放当前事实与下一完成线；过程聊天、微提交、历史 smoke 和已撤下设计不堆进入口。
