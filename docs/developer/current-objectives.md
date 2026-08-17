# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-17
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现事实以当前代码、测试、Git 历史和原生 App 验收为准；历史设计与旧里程碑不作为任务队列。

## 工作规则

1. 先读当前代码、Git 状态、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)，不要按旧对话重做已闭环事项。
2. MilkSU 仍是 pre-release：新能力实现当前干净模型，不为已放弃的旧设计写迁移、双写或兼容层。
3. 上游优先：平台/Pi → 固定可审阅 Skill、MCP、插件或 CLI → 最小自有实现。Pi 已拥有的通用 Coding 能力，不在 MilkSU 再造一套 harness。
4. Provider Key 不进入模型上下文、工具输出、日志、诊断、文档或普通文件；只向 MilkSU 私有远端发布。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果与危险大目录删除确认。
6. CTF、CVE、Coding 是同级工作区；通用会话、文件、Shell、浏览器、恢复与工具循环优先共享 Pi，领域事实、Evidence、Judge 与学习记录由 MilkSU 持有。
7. UI/Runtime 修复必须回写本页；未打包或未由用户验收的能力不得写成已发行或已完成。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | **内测迭代 / Agent Runtime 与跨平台发行收敛**。当前工作不再按 M3/M4 里程碑组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 当前内测发行 | `v26.817.3 / main@11760758926ab2a1f025cc32c2518d19afdeca35`；同一 source commit 生成 macOS ARM64、Windows x64 与 Linux x64 三端安装包。GitHub prerelease 只提供 DMG、EXE、DEB，R2/Admin current pointer 未发布。 |
| 当前开发 | `main` 已包含上述发行源、macOS 系统 Bash 兼容的发行 workflow 修复与后续纯文档收口；`v26.817.3` 始终固定在 `1176075`，后续 workflow/文档提交不移动发行标签。 |
| 平台边界 | macOS DMG 已签名、公证、staple、Gatekeeper 验证；Windows 安装器已完成原生 Runtime 与首次启动检查但尚未代码签名；Linux DEB 已完成原生 Ubuntu 包结构、Sidecar、Go Runtime 与 Xvfb Electron 启动检查，仍是无 Secret Service、本地 OCR、Computer Use 的试用边界。 |
| 发行流水 | 下一发行从干净、已推送的 `main` 对 canonical Go/Vue/Sidecar/lint/生产与文档构建只验证一次，回执绑定完整 commit 和版本；一条命令把同一 source commit 分发给三端，workflow 只保留平台原生构建与安装/首次启动门禁。GitHub-only 的 macOS job 不再生成 OTA ZIP/metadata。 |

## 当前产品事实

### Pi Runtime 收敛

- 普通 Coding、CTF 与 CVE 的文件、Shell、会话生命周期和输出续跑已经回到 Pi 原生语义。MilkSU 不再复制 workspace-only 文件工具、`sandbox-exec`、持久化授权根、Node `--allow-fs-*` 权限状态机或后台授权令牌。
- CTF 删除了阻断通用任务的自建 sandbox-exec；仍保留 Challenge、Evidence、Candidate、Judge Receipt、Recovery、Memory、精确站点能力和凭据隔离。达到模型输出长度上限时走 Pi `agent_end` / `followUp`，不把半句当完成。
- CVE → Coding 不再注入“只读检查”“只输出启动清单”等限制，使用普通 Pi 工具和当前权限档。普通产品回合不再被 MilkSU 的 90 秒无事件 watchdog 静默终止；用户主动停止和独立评测 deadline 仍保留。
- 普通用户文字和回复风格交给 Pi/模型理解。GUI 一键动作只传 typed product action、界面语言和无凭据系统环境，不额外注入客服话术、固定长尾问题或关键词/正则意图路由。
- 重启后失效的旧 Pi session ID 会清理并按普通消息重建，不能让 GUI 保持“运行中”而 Sidecar 已停止的分裂状态。
- Windows 内测诊断确认过一次账户状态瞬时失败导致本地账户模型授权被清空、随后被误报为“本地运行时异常”的故障；当前源码在账户服务暂时不可用或正在授权时保留既有授权，并在首次发送被双来源不可用拒绝时做一次安全的账户授权刷新与重试，仍不可用时显示准确的凭据配置提示。`26.817.3` 同时修复 Go Runtime 从打包目录查找 Pi Sidecar 时重复拼接 `resources` 的问题；真实打包 App 已完成账户模型验证，并启动 Pi Agent 执行文件与 Shell 工具回合。
- MilkSU 仍保留三项宿主必要边界：会话目录记录、Provider 凭据隔离、递归删除用户 Home/文件系统根/当前 cwd/大型目录时的二次确认。

### 模型、附件与网页查证

- Admin 可为登录用户分配独立 TokenFlux Key；Electron 获取后只交给 Go Credential Store。运行时只展示该 Key 或用户本机已配置 Provider 实际可用的模型。
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

### 已完成：`26.817.3` 三端同源内测发行

三端都从 `main@11760758926ab2a1f025cc32c2518d19afdeca35` 构建并通过各自 workflow。GitHub
prerelease 为 `v26.817.3`，没有上传 OTA ZIP；R2/Admin current pointer 未改变。macOS workflow
从后续 `25e94c0` 的兼容修复重新调度，但构建输入仍锁定为同一 `1176075` 发行源。

| 平台 | Workflow | 用户安装包 | 大小 | SHA-256 | 结果 |
| --- | --- | --- | ---: | --- | --- |
| macOS ARM64 | `32007817407` | `MilkSU-macOS-arm64.dmg` | 235,820,745 B | `f32f9947d936782a9b2e904921a1338c77c4dc705a8b4881c2428e9e184c5b17` | Developer ID 签名、Apple 公证、staple、Gatekeeper、DMG 布局与 artifact 上传通过 |
| Windows x64 | `32007690071` | `MilkSU-Windows-x64-26.817.3-Setup.exe` | 172,641,596 B | `3f8891046700d1d2f69a66a5acd9de2b533d8f5e24e7d86c0decdd21316e876d` | 原生 Windows 构建、打包 Runtime 与首次启动通过；真实打包 App 的 Pi Agent 回合另行复检通过；安装器未代码签名 |
| Linux x64 | `32007693429` | `MilkSU-Linux-x64-26.817.3.deb` | 174,484,372 B | `768d7da28839a6d0a75848dda8676884f9e6cd8e923330f541ca4c7a14193a51` | 原生 Ubuntu 包结构、Sidecar、Go Runtime 与 Xvfb Electron 首次启动通过；试用边界 |

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.817.3>

### 下一完成线

`26.817.3` 已满足三端构建与分发门禁，且补充完成了 Windows 真实打包 App 的模型验证与 Pi Agent
工具回合复检；其余用户视角功能验收不能由 CI 或该单一回合外推。下一条完成线是使用该版本
继续常用 Agent GUI 与 Pi Runtime 回归，失败项回到下面 P0 队列；Windows 签名、Linux 缺失能力和
R2/OTA 分别保持为明确后续工作。

### 后续队列

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 常用 Agent GUI 回归 | 按 Coding 常用功能表覆盖中文任务、文件/Shell、附件、斜杠菜单、权限档、subagent、浏览器、Browser/Computer Use、终端、取消/恢复与错误展示；自动化通过后再由用户做真实 GUI 验收。 |
| P0 | Pi Runtime 用户验收 | 最新正式包中验证跨目录读写、CTF/CVE 交接、长输出续跑和重启恢复，不出现 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | OTA 与私有 R2 | Admin 草稿/发布/暂停和 Desktop 更新提示已有；仍需一次受账户鉴权的真实旧签名版 → 新签名版升级回执。 |
| P1 | 安全工具真实任务 | IDA/idalib 与 capa 已有设置、准备和健康检查；分别用受控本地样本保留真实任务回执后，才决定是否进入 CTF/CVE。CodeQL、Burp、Shannon 仍逐项准入。 |
| P1 | Obelisk 学习记录 | 先定义可归因学习事实，再设计独立页面；不恢复已删除的单会话相关历史/图谱面板。 |
| 后置 | 深度安全与 Labs | CVE 真实复现、外部资产实验、披露自动化和 Labs 不属于当前发行完成线。 |

## 不要重复打开

以下只在出现新复现、自动化失败或用户明确要求时重开：

- 已撤下的单会话“相关历史”与图谱前端；Obelisk 底层索引不等于该 UI。
- Wails/CEF 双壳、workspace-only 文件工具、Node 文件权限状态机、普通回合 watchdog、CVE 只读启动清单和客服式回复模板。
- MilkSU 自建余额、价格映射、扣费流水和模型代理计费。
- M3/M4 旧百分比台账、历史 Beta 完成度和已删除 live smoke；需要考古时使用 Git history。

## 领域完成线

- **CTF**：模型只提出 Candidate；Judge 或用户明确授权结果才能建立成功事实。通用 Coding 能力走 Pi，MilkSU 保留题目、Evidence、Judge、Recovery 与 Memory。
- **CVE**：当前只做公共数据搜索、用户主动追踪、手工状态和关联 Coding；不默认运行 PoC，不对外部资产采取行动。
- **Memory**：Agent 代做不等于用户掌握。用户能力事实必须能链到 Judge、测试/提交、正式 Evidence 或用户确认。
- **发行**：按钮、构建文件或单元测试不等于可分发版本；必须保留对应平台真实产物和验收回执。

## 架构与文档规则

- 依赖方向固定为 `Vue → Electron Preload / Desktop RPC → Application Service → Domain / Runtime → Adapter`。
- 触碰 `CTFPage.vue`、`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、`internal/browsercap/manager.go` 或 Runner/Recovery 时，不再向热点文件增加第二份通用 harness 职责。
- 文档分 Current、Evidence、Historical/Research 三层。Current 只放当前事实与下一完成线；过程聊天、微提交、历史 smoke 和已撤下设计不堆进入口。
