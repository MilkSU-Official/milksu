# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-15
>
> 本页只回答“现在按什么目标继续做”：当前事实 + 下一条完成线。
> 实现事实以当前代码、测试、Git 历史和原生 App 验收为准。
> 旧覆盖台账、流水验收和历史 smoke 只留 Evidence / Git history，不堆进入口。

## 先读规则

1. 先读当前代码、测试、Git 状态、本文件、文档状态和当前系统，不按旧对话重复已闭环事项, 子功能实现后回写状态到本文档。
2. 仍是 pre-release；新能力直接实现干净模型，不为未发布旧设计写迁移、双写或兼容层。
3. 已工作的旧 schema 不在功能纵切中途返工；最终收口可集中做一次破坏性整理。
4. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
5. 只向 MilkSU 私有远端提交/推送/开 PR，不向引用的开源项目创建 PR。
6. 自动审批可减少无意义打断，但不能绕过付费、外部账户、Scope 扩大、路径边界、托管发布或不可逆操作。
7. CTF、CVE、Coding 是同级主工作区；同语义控件必须同规格。全局设置固定左下 rail；缺凭据或模块配置 CTA 跳到全局设置对应分类。
8. 非阻塞问题先记复现和影响；只有数据 / Credential / Scope / 私有远端 / Judge / 验收失真立即修。
9. 日间/夜间主题已可用：新安装和无有效偏好时默认日间，用户明确选择后本机持久化；日间模式以中性档案纸承载内容，导航、页头、筛选、Coding 右栏等命令面保持深色；夜间模式的 CTF、CVE、Coding、设置和个人页统一使用无明显蓝、绿、棕偏色的中性暖石墨层级，不再以实心偏蓝黑色块割裂产品；主操作使用酸绿，蓝色只保留给链接和执行/诊断状态；后续只在 UI 巡检中扩样调色。
10. UI 巡检或视觉修复后，必须同步防回归测试与当前文档。
11. 模型与凭据保持普通入口：登录账户可取得 Admin 分配的用户级 TokenFlux Key，本机个人 Provider Key 仍可独立配置。账户 Key 由 Electron 获取并写入现有 Credential Store，不返回 renderer；MilkSU 不承载余额、价格映射或计费代理。运行时只展示当前凭据实际返回的模型；未配置凭据的原厂 Provider 不进入任务模型列表。
12. Coding 自举默认由外部 reviewer 操作真实打包 MilkSU：给略带模糊的人类需求，让 MilkSU 在隔离 worktree 内理解、修改和验证；reviewer 只查轨迹、diff、测试和边界，并通过产品 UI 要求返工。除非链路阻塞、安全/Scope 问题或用户明确要求，reviewer 不直接改功能代码。
13. 上游优先：平台/Pi → 固定可审阅 Skill/MCP/插件/CLI → 许可证兼容的最小上游机制 → 最小自有实现。一会话一个结果契约，除阻塞和安全外不靠连续微提示收口。
14. Coding Agent 的成熟机制要反哺 CTF/CVE：通用会话、浏览器、worktree、恢复和审阅优先复用上游；Challenge/Evidence/Judge、漏洞研究事实、领域采集与安全验证工作流由 MilkSU 持有。不能把“上游优先”误写成不发展自己的安全领域能力。

## 当前事实

- 阶段：**Post-M3 / 内测运行与后续纵切**。首个可分发的正式签名包已经完成；M4 的 Coding 自治功能交付证据由用户明确后置，不阻塞当前内测。
- M3 product-loop 已 squash merge（`108e0e3`，2026-08-05）；不要把它或旧分支当打开中的任务。
- Coding 工程底座已覆盖：Plan/Go、权限、附件、本地 OCR、LSP、Artifact Preview、隔离 Browser、后台任务恢复、Diff/Hunk、Git、PR 发布确认、worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离已落地：干净 Git 项目的首次 effectful 回合由 Agent 自动准备一个内部 writer；`.worktreeinclude` 用平台 CoW 复制 ignored 本地环境，submodule 按精确提交初始化，writer 不读写主依赖目录。用户不再选择或看到 worktree / writer；脏工作区和非 Git 任务保留原工作区并明确降级。
- **Grok 看图已通过**：打包 App 经 TokenFlux 真实 `grok-4.5` 原生 image input 看图成功；中文识别任务列表、进度胶囊和输入栏，且未调用工具。`grok-4.3` 仍为 text-only；text-only 模型继续走 OCR + 可选 auxiliary vision。
- **功能代码自举已有真实但仍不等于完整自治交付的纵切**：本批次完成 Agent 自动执行环境、运行中消息 steering/queue、Git 变更文件悬浮跳转、CTF/CVE 共享 Coding/Pi 上下文、Stable/Beta 身份与构建追踪；自动化测试和打包均通过。正式 Stable 已通过内部 Computer Use 核对干净 Beta 的分支、完整提交与追踪号，并完成真实 CTF/CVE 任务连续性、PiP 与返回路径验收。实现过程仍有 reviewer 直接收口，不能外推为 Coding Agent 已能全自治完成任意功能开发。
- Git 变更摘要现在可悬浮查看真实文件并点击打开“变更”；执行环境由 Agent 维护，不再暴露用户手工 writer 控件。自然会话中出现 Goal 与真实 Git diff 时的打包 App 悬浮纵切仍需补一条证据。
- Computer Use：用户选择外部可见 App/PID/Window 的不可变 Scope；Stable/Beta 独立产品名、Bundle ID、图标、数据目录、构建追踪和自我排除已落地。Stable → Beta 已完成版本核验、真实 click/scroll 与 CTF/CVE 连续性全程；辅助功能与屏幕录制现在分别打开准确的系统设置，授权返回后自动复检，屏幕录制导致的系统退出由 Electron 安排可靠重启。任务级授权会在重启或驱动恢复后自动重连；用户明确请求 Computer Use 且只存在一个合格外部窗口时直接启动，准备期间提交的消息会在能力就绪后自动续发，多窗口仍要求选择准确目标。后端同时排除浏览器窗口，不能由绕过前端的 RPC 把 Browser Scope 混进来。TCC 只授予作为操作者的 Developer ID 正式 Stable，Beta 只是被控目标；本地 ad-hoc Stable 不得用于权限验收。Browser 与 Computer Use 仍是分离权限面。
- Session Index / 相关历史：MilkSU 自有 `obelisk.sqlite` 已索引本机 Coding、CTF、CVE 会话，支持 FTS/LIKE 搜索、Credential 遮蔽和用户确认后引用到当前输入。完整图谱改为**按需生成的人类语义图**：当前 Pi/Provider 在无工具静默回合中，把有界的 user/assistant 历史、Obelisk Memory 摘要和正式 Evidence 摘要归纳成主题、决策、问题、能力、里程碑、证据和洞见；工具消息不进入材料，节点必须回溯真实来源，关系明确是模型推断。图谱不读取目标文档、不写 Memory、不自动进入 Agent 上下文，也没有“引用到输入”动作。Obelisk 当前是历史索引和线索入口，不是个人成长事实源；个人页的次数、阶段和“最近成长”仍是本机活动的近似投影，只有 Judge、测试/提交、正式 Evidence 或用户明确确认的结果才能在后续成为可归因的成长事实。CTF Memory 继续属于独立领域事实，不与历史索引混写。
- Composer `/` 已覆盖 Goal、Plan、Pi 会话动作、模型/权限、状态/Diff/Review、MCP、Browser Use 与 Computer Use；用户可见的 worktree / writer 入口已删除。Agent 运行时输入仍可发送：消息先通过 Pi steering 应用于下一次模型调用，并以队列卡片展示；只有真正 settled 才结束运行态。输入框左下“+”继续作为附件、Goal、Plan、浏览器、Browser/Computer Scope、已审核 Pi Skills 和项目 MCP 的统一入口。产品 UI 只使用“浏览器”，不暴露“沙箱浏览器”。
- Coding 的已审核 Skill 已扩为产品设计、前端视觉验收、API 集成、安全审查、技术交付物、架构图和 MilkSU 发布；设置页可逐项停用。Pi 常驻的仍只是 Skill 名称与用途，完整 `SKILL.md` 只在任务匹配或用户主动选择后加载；禁用列表随消息进入 Sidecar，变更在下一条 Coding 消息重载会话资源。CTF 领域角色不继承这些 Coding Skill，设置也不能添加任意路径。
- 浏览器三面已分责：右栏“浏览器”是会话隔离的内置 Chromium；`/browser-use` 复用固定版 Playwright MCP 官方扩展，由用户在真实 Chrome/Edge 选择准确标签页；`/computer-use` 只列外部原生 App，浏览器窗口不进入该 Scope。NSSCTF/CTFshow 的 MilkSU 扩展继续作为领域 Bridge，不承担通用浏览器控制。
- **Chromium 桌面壳纵切已完成**：MilkSU.app 现由 Electron/Chromium 承载 Vue 产品表面和右栏 `WebContentsView`，Go 作为受管本地 Runtime 通过 JSONL RPC 提供应用服务。浏览器使用每会话独立 `session.fromPath`、默认拒绝页面权限，并经限定单一 Target 的 loopback CDP Proxy 交给固定 Playwright MCP。打包 App + TokenFlux `grok-4.5` 已只用浏览器完成三类真实任务：按页面提示点击取得 `flag{browser_agent_ok}`、填写并提交表单取得确定性回执、阅读 Electron 官方文档并归纳 `WebContentsView` 与旧 `BrowserView` 的关系。三次均在 Agent 开始后折叠右栏，任务仍继续，重新展开仍是同一页面与终态；未回退 Shell。裸域名会补全 HTTPS，普通文字会进入搜索。旧 Wails/CEF 生产链已直接删除，不保留兼容或双壳。
- 模型与凭据：Admin 可为每个登录用户分配独立 TokenFlux Key；Electron 使用账户会话向 `accounts.milksu.org` 取得该凭据并交给 Go，Go 把它保存到现有 `0600` Credential Store，renderer、日志、模型上下文和普通配置文件都拿不到 Key。MilkSU 当前直接请求 `https://tokenflux.dev/v1`，不再经过自建计费代理，也不维护余额、价格映射、扣费流水或 10% 超限逻辑。远端模型目录与该 Key 的模型分组一致，并以 last-known-good 缓存同时驱动设置、Composer 与 Pi；运行时只展示当前账户目录中的模型，未配置 Key 的原厂 Provider 自动隐藏。2026-08-15 的分配 Key 返回 `grok-4.3`、`grok-4.5`、`grok-4.6`；客户端已把旧 `x-ai/grok-4.6` 选择对齐为准确的 `grok-4.6`，Computer Use 实测真实 Coding 回合成功，直接请求非分组模型得到 `404 model_not_found` 且无有效输出。设置页仍可配置本机个人 Provider 或最多 8 个简单 OpenAI-compatible 中转站；这些 Key 各自进入同一 Credential Store，未配置时不进入任务模型列表。Coding / CTF / sub-agent 继续共用 Pi Provider 注册。
- 2026-08-16 模型路由回归：双来源 `milksu-route` 曾把外层占位 `apiKey` 原样转发给账户和个人 Provider，覆盖两个来源各自的真实凭据并造成 `401`。当前路由会在进入具体来源前移除外层 `apiKey` 与 `Authorization`，再由 Pi 为所选来源独立解析凭据；两个本机凭据的 TokenFlux `/models` 均返回 `200`，真实双来源链选择 `account` 并由 `grok-4.5` 返回精确回执 `MILKSU_ROUTE_OK`，全量 Sidecar 242 项通过。当前已安装 `26.816.1 / main@4077c86` 不含这次认证转发修复，仍需新的正式签名发行。
- CVE：用户首页只显示自己明确加入研究的公开 CVE，状态手工维护，并自动关联从该条目发起的 Coding 对话；“添加 CVE”先按编号、产品或关键词搜索 NVD，再由用户选择加入，不再要求手填整套元数据。搜索结果加入时直接保存已返回的公开元数据，不重复请求；临时服务错误转为用户可读提示。NVD 大量参考资料按机构去重，主界面只留四个关键来源和“在 NVD 查看全部”。纵深研究、真实复现、外部资产和披露仍后置。
- CTF：题库、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘、Memory 主链存在；真实 Judge 成功仍只有窄 Web 路径。
- CTF/CVE → Coding 已复用同一 Coding/Pi：交接只挂载草稿、不自动发送；右侧可折叠领域上下文保留题目/CVE、授权 Scope、材料、Evidence/Judge 或只读安全边界，并提供返回工作台。NSSCTF 附件或 Judge 未连接不再阻止用公开题面打开 Coding；附件缺失只作为材料警告。Beta Computer Use 已实测历史真实 CTF 任务的手工完成状态，以及 CVE-2024-3400 从跟踪页进入临时 Coding 工作区、生成只读研究简报、返回并自动关联 1 个对话的完整纵切；CVE 状态仍由用户手工保持“研究中”。未运行 PoC、未提交 flag、未建立 Judge 成功事实。
- Runtime：Sidecar 恢复、Compaction、异常退出标记、后台长任务打包 App/WebView 恢复、预算和失败分类已有。
- UI：左上角显示圆形裁切的当前用户头像并打开个人菜单；全局左栏固定为窄栏，Coding 会话历史默认收起并由单一按钮以浮层展开，不再因模块切换挤动主页面。完整个人页以 CTF/CVE/Coding 页签展示真实全年活跃图、所选日期细节与最近活动，全局六维雷达不再挂载；Coding 页签从统一的 `usage/model-usage.sqlite3` 读取全部模型与工具事件，不为每个模型拆库，也不保存 prompt、回复、工具参数或输出。三个模块的页签、标签与活跃度统一使用中性炭黑加酸绿色阶，不再以旧偏蓝黑或 `info` 蓝区分模块。Goal 与 Git 摘要位于输入框上方，Git 摘要可展开文件列表并跳到“变更”。Coding 顶部保留独立 Bottom Dock 和统一右栏；CTF/CVE 进入 Coding 后领域上下文可折叠/PiP，不再丢失原任务。Computer Use 使用紧凑任务面，诊断与证据默认折叠。Electron 窗口已避开 macOS 红黄绿按钮，Stable/Beta 使用正确名称与图标；设置页底部固定显示 branch、40 位 commit、clean/dirty、build time 和 tracking ID。
- 用户可见产物固定写入 `~/Documents/MilkSU/{Coding,CTF,CVE}`，设置页可直接打开。普通用户文件通过 Composer 的只读附件入口进入受管附件区，目录通过项目选择器成为任务 Scope，Provider Key 只走模型设置。无项目 Coding 会话统一显示为“无项目任务”，实际临时工作区转入 `Application Support/<bundle-id>/agent-workspaces`，不再在 Documents 生成“新编码任务-哈希”目录；CVE 等用户可见产物仍留在 Documents。Runtime、事件库、凭据、Obelisk、浏览器 Profile 和内部恢复数据继续留在 `~/Library/Application Support/<bundle-id>`，两类目录不混用；工作区拒绝根目录、用户主目录和符号链接越界。
- 暂停/后置：Labs；CVE 纵深研究、真实漏洞复现、外部资产实验、披露；NYU safe-static 只是开发者 smoke，不是完整 CTF 成绩。

## 下一条完成线

### 进行中目标：个人安全工作台

- **任务**：Codex `019fe9ee-b865-75b3-903d-bada1266f254`。
- **目标文档**：[个人安全工作台计划](security-workspace-product-plan.md)。
- **关联方式**：该 Codex 任务执行目标文档中的产品目标，本节只维护当前切片、完成线和验收状态。
- **当前切片**：个人安全工作台、Admin、账户模型来源、全局游戏化界面与隐藏/窄屏控制面均已进入代码。最终功能提交 `main@cfc9a102408b8e2017f339ddce08f246b6b67c02` 已由私有 `macOS signed release` workflow `31676876645` 构建；下载 DMG 的 SHA-256 为 `3eff2a795a48c4fa11e5e9aa5549d32e8127e5149843a48fb163ae37086b159a`，Apple 公证、stapler、Gatekeeper、严格签名与首次启动均通过。设置页实机核对 `branch=main`、完整 commit、`dirty=false` 和 tracking ID `6adfa291a021387f7cb40800012941a51f051bec90036b78353c68a4c57d58ff`；最终签名 App 的 GitHub 登录视觉、CVE “漏洞”页、公共学习专题和真实 NVD 搜索结果已经复检。用户级 TokenFlux Key 的 Admin 分配、桌面静默同步、本地凭据保存、模型目录过滤和旧模型 ID 对齐已分别进入 Admin `89b2037` 与客户端 `main@73595e4`，并通过本地 Stable 包真实 Coding 回合；这两个新提交尚未形成新的正式签名发行。
- **完成线**：从客户端 `main@73595e4` 生成新的 Developer ID 签名发行并完成内测升级；继续只处理真实阻塞问题，补一条真实题库的 Daily 推荐回执，并为 IDA/capa 各保留一项真实本地样本回执。MilkSU 自建余额、价格映射、扣费流水和代理计费已从当前路线移除；Obelisk 可归因成长事实继续作为独立后续纵切。

| 优先级 | 主线 | 只认什么完成 |
| --- | --- | --- |
| P2 | Coding 自举闭环 | 自动 worktree、运行中 steering/queue、Git 悬浮跳转与 Stable → Beta 可见验收已有；完整自然功能任务的自治 Git 交付证据由用户明确后置，不阻塞当前内测发行。 |
| P0 | Session Index | 继续内置 MilkSU 自有历史索引；外部会话导入在有明确文件选择、确认和产品调用者前不进发行图。 |
| P0 | CVE 学习/追踪扩样 | 更多真实 CVE 验证同步、练习、研究档案、资产验证和学习写回；不做外部攻击、自动 PoC 或披露。 |
| P1 | Computer Use 扩样 | 权限分流与可靠重启已实现；只用正式签名 Stable 作为操作者复检 TCC，再扩 Calculator 之外 1–2 个真实 App/窗口和权限拒绝路径。不与 Browser 强行合并权限。 |
| P1 | 安全工具 MCP 常规能力 | 先在 Coding Agent 中接入固定版本、可审阅的安全工具，形成普通的检测、准备、启用、健康检查、版本/Schema 审阅与证据回执能力。设置页把能力准备好；就绪且启用的能力自动进入现有 Pi 工具目录，由模型按任务选择，不要求用户逐任务勾选。是否进入 CTF/CVE 由后续领域纵切单独决定。 |
| P1 | Chromium 壳扩样 | 已完成 macOS ARM64 Electron/Chromium 壳、地址/搜索、点击、表单、公开资料调研与折叠连续执行纵切；下一阶段只补 Windows 打包评估、下载/弹窗/权限负向矩阵、页面崩溃恢复和自动化更新，不恢复 CEF/Wails 双壳。 |
| P1 | MilkSU Beta 自举 | 双身份、数据目录、追踪、签名检查、自我排除、版本核验与 CTF/CVE 可见任务全程已完成；剩余更广真实任务与 Computer Use TCC 扩样。禁止稳定版控制自己或共享状态/权限。 |
| P1 | Memory 可信度 | 区分 user / agent / shared / imported 与 none / hint / copilot / delegated；Agent 代做不能抬高用户独立能力。 |
| P1 | Runtime Reliability | 自建安全 fixture：多轮、文件、命令、工具、重启、压缩、取消、预算、失败分类。 |
| P1 | OTA 版本与更新提示 | Admin 版本草稿/发布/暂停、Desktop 启动检查、更新提示、下载进度与重启安装已实现并通过本地用户视角验收；生产 D1/R2 部署和一条真实旧签名版到新签名版升级回执仍待完成。 |
| P1 | Cloudflare R2 正式发版 | 私有签名 workflow 已能在签名、公证、staple 和 Gatekeeper 后生成 ZIP/DMG/元数据，以 rclone 上传私有 R2、回读验哈希并创建 Admin 草稿；只有 Admin 人工发布才改变当前版本。生产 secrets 与真实流水尚未执行。 |
| P2 | 本地交付与发行 | Developer ID `.app`、DMG、公证、stapling、Gatekeeper 与隔离首次启动已通过；RC 再做崩溃恢复、诊断、全新机器、OTA 升级、性能和尺寸。不读取或迁移本机签名私钥/证书密码/Personal Vault。 |
| 持续 | 架构与 UI | 触碰即拆热点文件；不新开纯清债里程碑。UI 巡检后同步测试与当前文档。 |

推荐顺序：先从 `main@73595e4` 完成正式签名发行并记录真实阻塞问题；有可用模型与题库时补 Daily 真实推荐回执，同时用本地 crackme/二进制补齐 IDA/capa 真实回执；之后推进 Obelisk 成长事实和其余安全工具。Coding 完整自治功能交付留作后续证据，不恢复 `development-plan.md`，不把已删除 live smoke 嵌回产品启动链。

### 2026-08-13 M4 距离核对后的增量任务

这张表保存本次对话在“M4 还差什么”核对后临时加入的有效任务，防止对话压缩后丢失。它只记录
用户仍然要的结果；已经否定的方案、随手猜测和旧实现不进入队列。

| 状态 | 增量任务 | 收口标准 |
| --- | --- | --- |
| 已完成，最终签名包已复检 | CVE 添加改为公共搜索 | 输入 CVE 编号、产品或关键词搜索 NVD，选择结果直接加入；上游 503 等错误不泄露 Desktop RPC；不再要求用户手填公开元数据。 |
| 已完成，最终签名包已复检 | CVE 来源收敛 | 参考链接按机构去重，主界面只显示四个可读来源和“在 NVD 查看全部”，不再让重复 UUID/邮箱链接贯穿页面。 |
| 已完成，最终签名包已复检 | 登录页右侧视觉融合 | 删除带整块深蓝背景的旧活动图调用，改用复用当前酸绿、灰白与炭黑色票的代码化信号格和准星；图案随容器自适应，不再出现位图矩形接缝。 |
| 已实现，真实模型回执待补 | 真实 CTF 每日挑战 | 现有规则先筛出未完成且适合用户的少量候选；复用当前 Pi，根据近期做题、已确认训练事实、相关 Coding 对话和 CTF Memory 选择一题并给一句理由；当天固定，用户主动“换一道”才重选；模型不可用时使用可解释的规则兜底。不得再把题库第一行伪装成 Daily。 |
| 已完成，最终签名包已复检 | CVE “想研究”状态 | 用户界面和交给 Coding 的上下文统一显示“想研究”，不再默认暗示必须复现；状态继续完全手工。当前工作中的旧持久化枚举不在这个 UI 纵切中途破坏性迁移。 |
| 已完成，最终签名包已复检 | 公共数据驱动的 CVE 学习专题 | 专题只做薄入口；点击后直接搜索 NVD 公共数据并展示可加入研究的真实 CVE，不过滤用户本地列表，不建立课程进度、自动状态或第二套 Agent。 |
| 已确认边界 | 高级安全能力只进 Coding | CodeQL、capa、补丁分析、变体搜索和后续安全 Worker 作为 Coding 工具/任务入口；CTF/CVE 只保留对象、来源、收藏、手工状态和关联对话。 |
| 已完成 | 最终发行与近新用户验收 | `main@cfc9a102408b8e2017f339ddce08f246b6b67c02` 的正式 DMG 已通过 Developer ID 签名、公证、staple、Gatekeeper、严格签名和隔离首次启动；设置页版本追踪、登录视觉、CVE 专题与真实 NVD 结果已回归。Daily 的真实模型选择回执单独保留，不将无题库空状态伪写为通过。 |
| 用户明确后置 | M4 独立自治功能任务 | 原建议第 3 项“让 Coding Agent 独立完成一个小型真实功能”暂缓，不阻塞内测发行，也不在本轮偷偷恢复自举监督。 |
| 账户 Key 已联调，安全工具首条已实现 | 账户模型、Obelisk 成长事实、安全工具 | 用户级 TokenFlux Key 分配、静默同步、模型过滤与真实 Coding 调用已完成；不再建设 MilkSU 自有计费。Obelisk 可归因成长仍后续；安全工具已实现设置、检测和 IDA/capa 适配器，真实样本回执及 CodeQL/Burp/Shannon 适配继续逐项推进。 |
| 已实现，生产部署待执行 | Admin OTA 版本管理 | 独立 Admin 已有版本列表、草稿/发布/暂停、发布说明和 D1 current pointer；版本清单、electron-updater feed 与下载都要求已登录且访问状态正常的账户。 |
| 已实现，真实升级待验收 | R2 签名发版流水 | 私有 CI 可上传 ZIP/DMG/元数据到私有 R2，回读验 SHA-256 后建立 Admin 草稿；Desktop 已接入带登录态的启动检查、下载和重启安装。仍需生产部署并保留一次旧签名版到新签名版真实升级回执。 |

### OTA 版本管理与 Cloudflare R2 发版 TODO

目标是把“做出一个签名包”补成用户可用的更新闭环：管理员能发布版本，App 能在启动后发现新版本，
用户确认后完成更新。代码纵切现已覆盖 Admin 版本表和控制面、私有 R2 绑定、受账户鉴权的版本清单与
下载代理、Desktop 启动检查和更新提示，以及 CI 的不可变上传、回读验哈希和草稿创建。当前只做了
普通 Stable ad-hoc 打包和本地 UI/自动化验收；没有构建 Beta，也没有把未验证代码写成生产已部署或
真实 OTA 已成功。

1. **Admin 控制面**：在独立私有 `milksu-admin` 中增加版本管理。每个版本至少记录频道、语义版本、
   Desktop commit、平台/架构、发布说明、最低兼容版本、不可变对象地址、大小、SHA-256 和草稿/已发布/
   已暂停状态。管理员先看到 CI 创建的草稿，确认后才发布；暂停或回退只切换公开清单指向，不覆盖
   已上传对象。
2. **App 更新链路**：主窗口可用后异步读取受账户鉴权的版本清单，根据当前频道、平台、架构和语义版本
   判断是否有更新。登录会话只留在 Electron 主进程，用于 feed 与下载的 Bearer header，不进入 Vue、
   日志或模型上下文；未登录、未受邀或访问暂停的账户不能检查或下载。发现新版本时显示版本号、说明和
   “更新 / 稍后”；网络失败不阻塞启动，同一版本被用户稍后处理后不在同一启动周期重复打扰。用户确认后
   由 electron-updater 校验清单、包哈希和签名，完成安装与重启后显示新的版本、commit 和 tracking ID。
3. **CI 发布数据面**：扩展现有私有 workflow，保持
   `测试 → 构建 → 签名 → 公证 → staple → Gatekeeper`，随后生成更新清单和校验值，上传到 Cloudflare
   R2 的版本化不可变路径，回读并复核，再调用 Admin 的窄发布接口创建草稿。任何一步失败都不得改动
   当前公开版本。
4. **Skill 分工**：不新建第二套本地签名/上传实现。现有 `release-milksu` Skill 后续只负责确认干净
   source、触发经审批的 CI、跟踪状态和整理无凭据回执；证书、Apple 公证凭据、R2 写入凭据和 Admin
   发布凭据只存在于对应的 CI environment。

这条纵切只在以下证据齐全后收口：Admin 可创建并发布真实版本；R2 对象和鉴权清单已回读且哈希一致；
一台安装旧正式签名版本的近新用户 Mac 在 App 内收到提示，经用户确认更新到新正式签名版本；更新后的
设置页版本追踪、Gatekeeper 和核心启动路径通过。单元测试、手工下载 DMG 或只看到提示都不能替代这条
真实升级结果。

本地实现证据：Admin Worker 覆盖无 publisher secret 拒绝、R2 对象存在性、草稿发布、未登录下载拒绝、
有效账户 feed/download 和暂停账户拒绝；版本管理页已在桌面和 760px 窄屏完成发布交互验收。Desktop
UpdateManager 覆盖登录 header、无登录不接触 feed、下载进度、重启安装和 Stable/Beta/dev 启用边界；
普通 Stable ad-hoc App 已打包并通过严格签名检查，且包含 `app-update.yml` 与 updater 依赖。生产 Worker、
D1 migration、R2 bucket/secrets 和真实 Developer ID 旧版到新版升级仍是下一条发行验收，不可由上述本地
证据替代。

本批次既定发行顺序已经执行完成。此后的 Current 文档提交只记录事实，不改变已签名 App 的来源提交；
若功能代码再变化，才从新的干净 HEAD 重跑正式签名发行。

本批次代码与本地回归证据：Go 全仓通过；Vue 70 个测试文件、390 个测试通过；Sidecar、Desktop
与 Browser Extension 213 个测试通过；生产前端类型检查与构建通过。内置浏览器已确认“想研究”文案、
三个薄专题入口，以及专题点击后进入预填关键词的 NVD 公共搜索；最终签名包也已返回真实 NVD 公共
搜索结果。由于隔离首次启动环境没有可用题库与已配置模型，本轮没有
把 Daily 空状态或规则兜底冒充为真实 Pi 推荐；该回执随内测可用环境补齐。

### 已完成纵切：相关历史人类语义图

- **实现**：固定 `@antv/g6@5.1.1` 仍只在完整“相关历史”切换图谱时懒加载；点击后才用当前 Pi/Provider 运行一次静默的 no-tools、Plan/read-only 归纳，不再保留确定性工具关系图或双路径 fallback。临时会话事件不进入产品会话流，完成后销毁且不持久化图谱。
- **材料**：最多 24 条脱敏来源；conversation 只取可见 user/assistant 文本并按会话限额，另可取 Obelisk Memory 摘要和有模块/时间归属的正式安全 Evidence。工具调用、工具结果和目标文档不作为图谱材料；项目筛选时无法证明项目归属的正式档案宁可省略。
- **模型与校验**：节点限于 topic、decision、milestone、capability、problem、evidence、insight；边限于 depends_on、enables、blocks、supports、validates、evolves_to、contrasts_with。模型输出经 JSON、枚举、数量、端点和 Source ID 校验；无真实来源的节点丢弃，Credential 在索引、Projection 与 UI 再遮蔽。
- **交互**：语义簇、重要度、状态和有向关系服务于人类阅读；支持拖动、缩放、适应视图、节点关系解释、来源摘要和来源会话回跳。列表仍可经用户确认引用，图谱本身不提供引用或回填。紧凑侧栏只保留列表，不加载 G6，也不耗模型额度。
- **真实验收**：重新打包并签名校验的 macOS App 使用 TokenFlux `grok-4.5` 生成 `Computer Use` 图（10 节点/11 关系）和 `MCP` 图（11 节点/12 关系）；前者归纳 Calculator 窄切片、会话接通缺口、Browser 分离、Compaction 边界和安全运行时，后者归纳 Playwright MCP、local fixture、socket 路径和会话恢复边界。两图均无 Bash 工具中心；点击节点可见语义理由、真实会话来源并回跳，主聊天无临时生成消息。
- **边界**：这是给人看的瞬态历史认知图，不是新的 Agent Memory、目标解析器或执行知识图谱；关系只代表模型归纳，不建立 Judge、CVE 来源、Memory 或用户能力事实。

### 安全工具 MCP 常规能力队列

这是 Coding Agent 的常规能力接入队列，不是默认捆绑清单。设置目录可以展示检测到的软件和已审阅的
准备入口；只有 `ready + enabled` 的适配器进入模型目录。每项还必须用受控样本完成真实任务，才可把
状态提升为任务验收或扩到 CTF/CVE。未经审阅的社区 Server 只作为研究输入，不进入发行依赖图。

第一条生产纵切已经进入“设置 → 安全工具”和普通 Coding：Desktop RPC 提供真实目录、检测、启停持久化、
准备进度和健康检查；准备完成的能力由 Go 在每个回合重新投影给现有 Pi Session，模型根据轻量能力摘要自行
决定是否调用。完整 MCP Schema 仍按需加载；“在 Coding 中配置”只挂未发送草稿，不会暗中启动安装；
该草稿明确使用 `Go · 完全访问`，用户发送后 Coding 才能在本机用户目录准备软件，而不是落回项目沙箱。
2026-08-13 的本机 Stable 实测从设置页进入 Coding，安装 `uv 0.12.3` 与固定
`mrexodia/ida-pro-mcp@0b5f7ae...`，完成非交互健康检查，再回设置页得到 IDA Pro“可用 / 已加入自动能力目录”。
首轮实测发现无超时启动 IDA 会阻塞；当前交接提示已要求不启动 GUI，所有外部工具健康检查必须非交互且带
15 秒超时。该回执证明配置链路，不等于已经完成真实 crackme 反编译任务。
视觉参考与生产组件证据见 `docs/design/milksu-security-tools-settings-master.png`、
`docs/design/milksu-security-tools-settings-option-3.png` 和 `docs/design/audits/milksu-security-tools-settings-production.png`。

1. **IDA Pro / idalib**：已实现真实 IDA/idalib 检测、固定
   [mrexodia/ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp) commit 的隔离安装、只读 profile 与 lazy MCP；
   当前允许函数、反编译、交叉引用、字符串和数据库生命周期工具，不开放 `py_eval`、补丁与任意脚本。
   仍需用一个本地 crackme 保留真实成功回执，完成前状态是“实现并测试”，不是发行级任务验收。
2. **capa**：已实现官方 [mandiant/capa](https://github.com/mandiant/capa) `v9.4.0` 的架构选择、SHA-256
   校验、托管安装和原生 `capa_analyze` 工具；模型只得到工作区相对文件入口。仍需对真实二进制保留一次
   能力识别结果，不能由单元测试替代。
3. **CodeQL**：当前只有 CLI 检测与设置说明，没有自动安装、查询包或模型工具；检测到 CLI 也不进入
   自动能力目录。后续先用公开漏洞仓库验证建库、查询与 SARIF 回执。
4. **Burp Suite**：当前只检测本机 App，没有接入 MCP。后续评估
   [PortSwigger/mcp-server](https://github.com/PortSwigger/mcp-server)，第一阶段只读 Proxy/Repeater 历史和请求详情。
5. **Shannon**：当前只检测 Docker CLI/Engine 前提，没有安装 Worker 或暴露任务工具。后续以独立容器任务
   适配器接入，并用明确授权的本地靶场验证，不把它复制成第二套 Agent Loop。

radare2、Ghidra、Semgrep 和 CAI 继续作为后续上游研究输入；在前五项没有产生真实任务证据前，不扩大
生产目录。CTF/CVE 模块只在普通 Coding 中的能力通过实际题目或漏洞样本后再做独立纵切，不直接继承设置页状态。

共同准入门槛：固定 commit/release 与许可证；工具描述和 schema 哈希可审阅；默认 localhost/stdio、
最小环境变量和工作区根；读写/执行/联网效果分类；凭据不进模型上下文；Server 更新后重新审阅；保留一项
真实成功任务和一项越权拒绝回执。MilkSU 不为这些工具复制协议层，只维护安装状态、选择、Scope、审批与证据。

## 不要重复打开

仅在新复现或测试失败时重开：

- Archify；Coding 基础理解/测试/审阅/修复/总结；Plan/Go 与三档权限；附件、本地 OCR、视觉降级。
- Coding Browser 隔离与 Playwright MCP；LSP；Git Diff/Hunk/stage/commit/push/PR 确认发布。
- 顶栏视觉统一、全局 rail 设置/主题/能力画像、字重与 Coding 字号层级、共享 Button label 规格；Coding 顶部独立 Bottom Dock 开关、右栏独立开关、Codex 式终端标签栏与精简空状态。
- Computer Use 外部 App Scope、权限检测、工具截图辅助视觉；Artifact Preview；后台任务跨重启恢复。
- CVE 多源同步/练习生命周期/学习写回/资产验证；Session Index 基础索引与确认写入。
- 相关历史人类语义图：Pi 无工具静默归纳、有界 Memory/会话/Evidence 摘要、Credential 遮蔽、来源回跳；图谱不引用、不回填 Agent。
- 模型与凭据普通入口、TokenFlux、移除 Kimi/KouriChat 与 fast/deep 路由。
- 假后端与无调用者外部导入清理；CTF Memory actor/assistance 持久化；worktree 写入边界与 `.worktreeinclude`/submodule。
- TokenFlux `grok-4.5` 打包 App 真看图（中文 UI 识别、无工具调用）。
- 真实 Grok 文档小纵切：自然提示 → writer 只改 Current 文档 → reviewer 返工（不含功能代码/测试/恢复/Git 交付）。
- M3 product-loop 合并。

## 领域完成线（摘要）

- **CVE**：只做学习/追踪。可扩多源缓存与练习闭环；后置未授权外部目标、批量扫描、自动 PoC、披露自动提交。
- **Memory**：可复用经验 ≠ 用户能力画像；用户独立能力只能来自显式用户操作或确认记录；推荐须能链到 Judge/提示/失败/确认材料。
- **Bench**：先自建 Runtime Reliability；NYU Outcome 后置到核心产品闭环稳定后的安全子集；safe-static 不是完整 CTF 成绩。

## 架构和文档规则

- 触碰 `CTFPage.vue`、`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、
  `internal/browsercap/manager.go`、CTF Runner/Recovery 时避免继续塞职责，能抽边界就抽。
- Electron Preload 只暴露窄 RPC/事件桥；Go Runtime 不依赖 Electron 类型；领域层不依赖桌面壳；Pi 不知道平台页面细节；Adapter 不判定学习成功或用户能力。
- 文档三层：Current 入口、Evidence 索引、Historical/Research。过程聊天、微提交、历史 smoke 清单不堆进入口。
