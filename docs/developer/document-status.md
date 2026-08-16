# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-15
>
> 产品开发目标：Post-M3 / 内测运行与后续纵切

## 事实优先级

文档冲突时按此顺序：

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执；
2. [当前开发目标](/developer/current-objectives)；
3. [当前系统与分层](/architecture/current-system)；
4. Target/Designed 文档；
5. Evidence、Historical、Research 和 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/R0.x”不构成当前任务。M3 product-loop 已于
2026-08-05 squash merge；旧百分比台账和压缩摘要已从当前工作树删除，需要考古时使用 Git
历史。后续只从当前目标、代码、测试和真实验收选有界批次。

## 当前准确声明

- 阶段是 **Post-M3 / 内测运行与后续纵切**。首个可分发的正式签名包已经完成；完整 Coding 自治
  功能交付证据已由用户明确后置，不再作为当前内测条件。
- Coding 工程底座已覆盖修改/测试、LSP、Artifact、隔离 Browser、后台任务、Git、PR 确认、
  worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离与写入边界、`.worktreeinclude` CoW、精确 submodule 已落地；干净 Git 任务在首次
  effectful 回合由 Agent 自动准备内部 writer，用户不再选择或看到 worktree / writer 控件。
- **Grok 看图已通过**：打包 App + TokenFlux 真实 `grok-4.5` 原生 image input；中文识别任务列表、
  进度胶囊和输入栏，且未调用工具。当前代码由所选模型的 image input 能力自动决定原图透传或本地
  OCR，不再配置第二个视觉模型；`grok-4.5` 保留真实回执，`grok-4.6` 只接受远端目录的明确能力声明，
  Groq 当前官方视觉项为 `qwen/qwen3.6-27b`。这次自动路由仅完成局部自动化，尚未重新打包复检
  Computer Use 截图，也未真实调用 Groq 视觉模型。
- **功能代码自举已有真实部分纵切**：自动执行环境、运行中消息 steering/queue、Git 文件悬浮跳转、
  CTF/CVE 共享 Coding/Pi、Stable/Beta 身份与构建追踪已实现并测试。正式 Stable 已用内部 Computer Use
  核对干净 Beta 的 branch/40 位 commit/tracking ID，并完成 CTF/CVE 任务连续性、PiP 与返回路径全程。
  实现过程仍有 reviewer 直接收口，因此不能写成 Coding Agent 已完成通用自治交付。
- Git 变更摘要可悬浮查看文件并跳到“变更”；自然 Agent 会话同时出现 Goal 与真实 Git diff 的打包
  App 证据仍待补。Computer Use 已从 Calculator 扩到 Stable → MilkSU Beta 的真实 click/scroll 和
  CTF/CVE 连续性全程；右栏默认收敛为目标、状态和单一主操作，诊断与证据按需展开。Browser 与
  Computer Use 仍分离；辅助功能/屏幕录制已分成准确入口并在返回后复检，屏幕录制授权退出由 Electron
  安排可靠重启。TCC 只授予 Developer ID 正式 Stable 操作者，Beta 只是被控目标，本地 ad-hoc Stable
  不再作为验收入口；新签名包上的 TCC 跨版本复用与扩样仍需本批次真实复检。
- Composer `/` 以可删除内联状态启用 Browser/Computer；通用 Browser Use 复用固定版 Playwright
  MCP 官方扩展并由用户选择真实标签页，Computer Use 排除浏览器。MilkSU CTF 扩展仍负责
  NSSCTF/CTFshow 领域采集与 Judge，不被通用上游替代。
- 桌面 GUI 的关键产品边界是三种可见执行表面：MilkSU 管理的“浏览器”、用户真实标签页的
  Browser Use、外部 App/Window 的 Computer Use。用户与 Agent 共用准确对象，Scope 可见且可撤销；
  面板显隐只改变观察视图，不应替代 Session 的显式启动、停止或恢复。每种表面必须分别保留真实
  任务证据，不能把其中一项的验收外推到另外两项。
- 桌面壳已经从 Wails/WKWebView 直接迁到 Electron/Chromium；旧 CEF 原型和 Wails 生产链均已删除，
  不保留兼容。Vue 通过受限 Preload 调用 Electron Host，Electron 以 JSONL RPC 监管 Go Runtime。
  右栏“浏览器”是会话隔离的 `WebContentsView`，用户与 Agent 共用同一页面；固定 Playwright MCP
  只得到单一 Target 的 loopback CDP Proxy。打包 App + TokenFlux `grok-4.5` 已只用浏览器完成顺序点击
  CTF-like 挑战、表单提交和 Electron 官方文档调研；三项都在右栏折叠后继续执行，重新展开仍是同一页面
  与终态，且没有回退 Shell。裸域名补全 HTTPS，普通文字进入搜索。`MilkSU Beta` 已使用独立产品名、
  Bundle ID、图标、数据目录与设置页构建追踪；Stable 排除自身，只能锁定 Beta 等外部 App。
- 完整自然任务自举（功能代码/测试/恢复/Git 交付）、人工接管账本与自主合并发布仍未扩样；它们是
  后续证据，不阻塞当前内测。最终功能提交 `main@cfc9a102408b8e2017f339ddce08f246b6b67c02`
  已由 workflow `31676876645` 生成正式 DMG；Apple 公证票据、stapler、Gatekeeper、严格签名和隔离
  首次启动均通过。设置页实机核对完整 commit、`dirty=false` 与 tracking ID
  `6adfa291a021387f7cb40800012941a51f051bec90036b78353c68a4c57d58ff`。
- 模型与凭据：Admin 已支持为每个登录用户分配独立 TokenFlux Key；Electron 用账户会话取得凭据并交给
  Go 写入现有 `0600` Credential Store，renderer、日志、模型上下文和普通配置文件均不接触 Key。MilkSU
  当前直接请求 `https://tokenflux.dev/v1`，自建余额、价格映射、扣费流水、超限和代理计费不再属于产品链。
  Go 获取与该 Key 分组一致的模型目录并以 last-known-good 缓存，设置、Composer 与 Pi 共用同一目录；
  运行时只展示当前凭据实际可用的模型，未配置 Key 的原厂 Provider 自动隐藏。2026-08-15 的分配 Key
  返回 Grok 4.3/4.5/4.6；客户端已把旧 `x-ai/grok-4.6` 对齐为 `grok-4.6`，本地 Stable 包经 Computer Use
  完成真实 Coding 调用，非分组模型直接请求得到 `404 model_not_found`。Admin 对应提交为 `89b2037`，
  客户端为 `main@73595e4`；尚未把该客户端提交制成新的 Developer ID 正式签名发行。
- OTA 代码纵切已实现但尚未生产发布：独立 Admin 可管理版本草稿、发布和暂停；CI 可在 Apple 验证后把
  ZIP/DMG/元数据上传私有 R2、回读验哈希并创建草稿；Desktop Stable 启动后用 Electron 主进程保存的
  登录态检查、下载并重启安装。feed 与下载都要求已受邀且访问正常的登录账户，R2 不公开。当前只有
  自动化、管理页浏览器验收和普通 Stable ad-hoc 打包证据；生产 D1/R2/Worker、正式签名流水与真实旧版
  到新版升级尚未执行，Beta 不参与这条 OTA 流程。
- CTF 主链存在；真实 Judge 成功仍只有窄 Web 路径。Memory actor/assistance 已持久化；尚缺真实
  轨迹校准。Obelisk 目前只索引历史与线索，不是个人成长事实源；个人页阶段是活动近似值，不等于
  独立能力评分。Runtime Reliability fixture 已有；发行级恢复矩阵未过。
- CTF/CVE 交给 Coding 时只挂草稿、不自动发送，并复用同一 Pi 会话；可折叠领域上下文保留题目/CVE、
  Scope、材料、Evidence/Judge 或只读边界与返回动作。Beta 已实测 P7591 和 CVE-2024-3400 的交接/返回；
  未提交 flag、未运行 PoC，且附件或 Judge 未连接不再阻止打开 Coding。
- CVE 用户页只显示明确加入研究的公开条目，用户可见默认状态为“想研究”，状态完全手工并自动关联从条目发起的 Coding 对话；添加入口按编号、产品或关键词搜索 NVD，再由用户选择加入，不要求手填公开元数据。选择结果直接保存，不重复发起网络请求；临时上游失败不泄露 Desktop RPC 错误。NVD 参考资料按机构去重，主界面只留四个关键来源和“在 NVD 查看全部”。三个薄学习专题直接搜索公共 NVD 数据；最终签名 App 已取得真实专题搜索结果。WebView 无假后端；Session Index 只索引 MilkSU 自有历史。
- CTF Daily 不再把题库第一行伪装成每日挑战：规则先筛未完成候选，Pi 可结合近期题目、关联 Coding 对话、已确认事实和 CTF Memory 选择并解释，当天固定且允许主动换题，模型不可用时规则兜底。代码、测试与最终包表面已回归；真实模型选择回执仍待有可用题库与模型的内测环境补齐。
- UI：rail 主题/设置、Coding Goal 与常用 Agent 动作在 Composer `/`；“+”统一提供附件、Goal、Plan、浏览器、Browser/Computer Scope、已审核 Pi Skills 与项目 MCP。运行中输入可继续发送并通过 Pi steering/queue 在下一模型调用前应用；左上角用户头像进入个人资料页，页面展示真实活跃格、CTF/CVE/Coding 模糊阶段和最近确认成长，全局六维雷达不再挂载；Git 摘要可展开文件并跳到“变更”。产品表面只显示“浏览器”，不再暴露 worktree/writer 或五项 Computer Use readiness 样子货；
  Browser Use Bridge 与 Computer Use 系统配置集中到“设置 → 浏览器与控制”。
- Coding 的已审核 Skill 由 Pi 按需加载完整内容，设置页只管理审核目录的启停；当前目录覆盖产品设计、前端视觉验收、API 集成、安全审查、技术交付物、架构图和 MilkSU 发布。禁用项从下一条 Coding 消息生效，CTF 角色保持隔离，用户不能借设置注入任意 Skill 路径。
- 用户可见交付物写入 `~/Documents/MilkSU/{Coding,CTF,CVE}`；Runtime、事件、凭据、Obelisk、浏览器 Profile 与恢复状态继续留在 App Support。设置页明确展示并可打开产物目录。
- 个人安全工作台历史 Beta 纵切来自干净提交 `31c06dfb296dd85e96e24dacf21a26ba70cea3d1`；原生 Computer Use 已用全新自定义题 `Caesar Shift 12` 完成创建、共享 Coding、运行中引导、可复现脚本/笔记、返回与手工状态闭环。题面与规定 Flag 格式实际不一致，Agent 明确拒绝编造候选，未建立 Judge 成功事实。该 Beta 是过程证据，不再代表当前正式版本；当前正式签名基线仍是 `cfc9a10`，待发行代码 HEAD 为 `73595e4`。
- 安全工具设置与普通 Coding 的首条生产纵切已实现：真实目录、检测、启停持久化和准备进度进入
  Desktop RPC；IDA Pro/idalib lazy MCP 与 capa 原生工具只在 `ready + enabled` 时交给现有 Pi 供模型
  自主选择。“在 Coding 中配置”会挂载未发送草稿和所需的 `Go · 完全访问`；本机 Stable 已由该入口
  安装 uv 与固定 idalib MCP、完成非交互健康检查，并在返回设置页后显示 IDA Pro“可用 / 已加入自动能力目录”。
  CodeQL、Burp Suite、Shannon 仍是检测/前提状态，不是模型能力；真实 crackme/二进制任务
  回执和 CTF/CVE 模块接入仍待独立纵切，不能由当前自动化测试外推。
- 相关历史人类语义图已在重新打包的 macOS App 用 TokenFlux `grok-4.5` 通过 `Computer Use`（10 节点/11 关系）与 `MCP`（11 节点/12 关系）真实归纳、来源详情/回跳和主聊天不受污染验收；`@antv/g6@5.1.1` 仅在完整图谱视图懒加载，列表与紧凑侧栏不会触发模型调用。
- Labs 暂停；CVE 纵深/复现/披露后置；NYU safe-static 不是完整 CTF 成绩。Developer ID / 公证的
  私有 workflow 与 Environment Secrets 已配置，最终功能提交的 Apple 公证、stapler、Gatekeeper、
  下载 artifact 和隔离首次启动回执均已完成。升级、全新机器、性能与恢复矩阵仍属于 RC。

Current 入口只保留事实与下一条完成线。历史 smoke、已删脚本路径和流水验收见 Evidence /
Git history，不堆本页。

## 文档生命周期

| 类型 | 用途 | 当前入口 |
| --- | --- | --- |
| **Current** | 当前事实、目标和资源边界 | `current-objectives.md`、本页、`current-system.md`、`pi-resource-whitelist.md` |
| **Target** | 稳定领域和架构原则，或已确认但尚未实现的产品目标 | `developer/architecture.md`、`security-agent-boundary.md`、`role-packages.md`、`security-workspace-product-plan.md` |
| **Evidence** | 可复跑 Runbook 或一次真实验收记录 | `*-acceptance.md`、`local-delivery-baseline.md`、`nyu-ctf-bench-eval.md` |
| **Long-term Design / Partially Implemented** | 长期设计摘要，部分被 MVP 覆盖 | `cve-research-workbench-design.md`、`security-learning-and-research-platform.md` |
| **Paused / Design Summary** | 已冻结未来设计 | `ctf-labs-design.md` |
| **Historical** | 代码无法还原的决策理由 | `developer/adr/*` |
| **Research** | 外部项目与方案输入 | `developer/research/*`、`industry-baseline.md` |
| **Design Contract / Evidence** | 当前视觉合同、批准参考与实际界面证据 | `design/milksu-game-ui-system.md`、`design/game-ui/*`、安全工具设置当前参考与生产截图 |
| **Vendored / External** | 上游原文，不按 MilkSU 进度重写 | `third_party/*`、`packages/ui/*`、fixture、Skill 内部参考 |

## 维护规则

1. Current 只写当前可验证事实与下一条完成线，不堆历史 smoke 清单；
2. Target 描述不变量，不维护动态完成度；
3. Evidence 保留原始日期、版本和范围，不外推；
4. ADR/Research 只保留代码和 Git 历史无法还原的决策理由或外部输入；
5. Paused 文档首屏写明未启用；
6. 外部或 vendored 文档不替 MilkSU 改写；
7. 开发中只更新可复跑测试契约、真实回执和必要 ADR；一次性进度 Checkpoint 交给 Git 历史；
8. 代码导览、命令输出抄录和可由 Agent 重新扫描生成的清单不进入长期文档。
