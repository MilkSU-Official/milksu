# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-12
>
> 产品开发目标：Post-M3 / M4 自举与隔离执行

## 事实优先级

文档冲突时按此顺序：

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执；
2. [当前开发目标](/developer/current-objectives)；
3. [当前系统与分层](/architecture/current-system)；
4. Target/Designed 文档；
5. Evidence、Historical、Research 和 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/R0.x”不构成当前任务。M3 product-loop 已于
2026-08-05 squash merge；旧百分比台账已退休。后续只从当前目标、代码、测试和真实验收
选有界批次。

## 当前准确声明

- 阶段是 **Post-M3 / M4 自举与隔离执行**。M4 不是未合并 PR，而是会话在隔离 worktree 内完成
  自然任务并交付。
- Coding 工程底座已覆盖修改/测试、LSP、Artifact、隔离 Browser、后台任务、Git、PR 确认、
  worktree、ImageGen、Project MCP、Session Index、Computer Use 外部 App 纵切。
- Worktree 隔离与写入边界、`.worktreeinclude` CoW、精确 submodule 已落地；干净 Git 任务在首次
  effectful 回合由 Agent 自动准备内部 writer，用户不再选择或看到 worktree / writer 控件。
- **Grok 看图已通过**：打包 App + TokenFlux 真实 `grok-4.5` 原生 image input；中文识别任务列表、
  进度胶囊和输入栏，且未调用工具。`grok-4.3` 仍为 text-only。text-only 路径继续 OCR + 可选
  auxiliary vision。
- **功能代码自举已有真实部分纵切**：自动执行环境、运行中消息 steering/queue、Git 文件悬浮跳转、
  CTF/CVE 共享 Coding/Pi、Stable/Beta 身份与构建追踪已实现并测试。正式 Stable 已用内部 Computer Use
  核对干净 Beta 的 branch/40 位 commit/tracking ID，并完成 CTF/CVE 任务连续性、PiP 与返回路径全程。
  实现过程仍有 reviewer 直接收口，因此不能写成 Coding Agent 已完成通用自治交付。
- Git 变更摘要可悬浮查看文件并跳到“变更”；自然 Agent 会话同时出现 Goal 与真实 Git diff 的打包
  App 证据仍待补。Computer Use 已从 Calculator 扩到 Stable → MilkSU Beta 的真实 click/scroll 和
  CTF/CVE 连续性全程；右栏默认收敛为目标、状态和单一主操作，诊断与证据按需展开。Browser 与
  Computer Use 仍分离，Developer ID / TCC 复检未完成。
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
- 完整自然任务自举（功能代码/测试/恢复/Git 交付）、人工接管账本、自主合并发布和发行门禁仍未通过。
- 模型与凭据：单默认模型；账户额度和本机个人 Key 是两个独立来源，设置页可调整全局顺序，Coding
  可只为当前对话调整优先来源；仅允许在模型未输出且工具未执行前自动切换。个人 Key 不进入后台、
  日志或模型上下文。Cloudflare Worker、D1、管理端和公开账户 API 已部署，GitHub OAuth Secret、
  真实登录/额度联动和 TokenFlux 明细仍待联调。
- CTF 主链存在；真实 Judge 成功仍只有窄 Web 路径。Memory actor/assistance 已持久化；尚缺真实
  轨迹校准。Runtime Reliability fixture 已有；发行级恢复矩阵未过。
- CTF/CVE 交给 Coding 时只挂草稿、不自动发送，并复用同一 Pi 会话；可折叠领域上下文保留题目/CVE、
  Scope、材料、Evidence/Judge 或只读边界与返回动作。Beta 已实测 P7591 和 CVE-2024-3400 的交接/返回；
  未提交 flag、未运行 PoC，且附件或 Judge 未连接不再阻止打开 Coding。
- CVE 用户页只显示明确加入研究的公开条目，手工状态与关联 Coding 对话；内置目录不再伪造用户资产命中、实时更新时间或自动进度。WebView 无假后端；Session Index 只索引 MilkSU 自有历史。相关历史列表仍由用户明确确认后引用；完整图谱则按需让当前 Pi/Provider 在无工具静默回合中，把有界的会话、Memory 摘要和正式 Evidence 摘要归纳成人类语义图。图节点必须可回溯来源，关系标为模型推断；不读目标文档、不新增图数据库、不写 Memory、不回填 Agent。
- UI：rail 主题/设置、Coding Goal 与常用 Agent 动作在 Composer `/`；“+”统一提供附件、Goal、Plan、浏览器、Browser/Computer Scope、已审核 Pi Skills 与项目 MCP。运行中输入可继续发送并通过 Pi steering/queue 在下一模型调用前应用；左上角用户头像进入个人资料页，页面展示真实活跃格、CTF/CVE/Coding 模糊阶段和最近确认成长，全局六维雷达不再挂载；Git 摘要可展开文件并跳到“变更”。产品表面只显示“浏览器”，不再暴露 worktree/writer 或五项 Computer Use readiness 样子货；
  Browser Use Bridge 与 Computer Use 系统配置集中到“设置 → 浏览器与控制”。
- Coding 的已审核 Skill 由 Pi 按需加载完整内容，设置页只管理审核目录的启停；当前目录覆盖产品设计、前端视觉验收、API 集成、安全审查、技术交付物、架构图和 MilkSU 发布。禁用项从下一条 Coding 消息生效，CTF 角色保持隔离，用户不能借设置注入任意 Skill 路径。
- 个人安全工作台 Beta 已从干净 `3a4fbbd326fdee2ffee1f8a9ce3f18da719a8f33` 构建，tracking ID 为 `9e3bf417639dc803fe43e08ec0baa87aaa2703c5f574fa8eec3f17a7ae5d77a3`；包身份、sealed provenance、严格签名和桌面检查已通过。此前原生审计已覆盖设置追踪、个人页、轻量 CTF/CVE、草稿交接、PiP/返回和关联对话，最终收薄领域上下文后的包待本机钥匙串确认后复检。客户端已指向 `accounts.milksu.org`，但 GitHub OAuth Secret、真实额度和 App 内 Agent 完成任务尚未验收；当前仍是 ad-hoc 签名。
- 安全工具 MCP 是下一阶段 Coding 常规能力，不是当前发行能力：候选为 IDA Pro/idalib、Burp、radare2、Ghidra 与 Semgrep；
  必须先通过固定版本、最小权限、真实任务和拒绝路径，是否进入 CTF/CVE 由用户监督的领域纵切决定。
- 相关历史人类语义图已在重新打包的 macOS App 用 TokenFlux `grok-4.5` 通过 `Computer Use`（10 节点/11 关系）与 `MCP`（11 节点/12 关系）真实归纳、来源详情/回跳和主聊天不受污染验收；`@antv/g6@5.1.1` 仅在完整图谱视图懒加载，列表与紧凑侧栏不会触发模型调用。
- Labs 暂停；CVE 纵深/复现/披露后置；NYU safe-static 不是完整 CTF 成绩；Developer ID/公证属 RC。

Current 入口只保留事实与下一条完成线。历史 smoke、已删脚本路径和流水验收见 Evidence /
Git history，不堆本页。

## 文档生命周期

| 类型 | 用途 | 当前入口 |
| --- | --- | --- |
| **Current** | 当前事实、目标和资源边界 | `current-objectives.md`、本页、`current-system.md`、`pi-resource-whitelist.md` |
| **Target** | 稳定领域和架构原则，或已确认但尚未实现的产品目标 | `developer/architecture.md`、`security-agent-boundary.md`、`role-packages.md`、`security-workspace-product-plan.md` |
| **Evidence** | 可复跑 Runbook 或一次真实验收记录 | `*-acceptance.md`、`local-delivery-baseline.md`、`nyu-ctf-bench-eval.md` |
| **Retired Summary** | 已压缩旧台账/冲刺流水，只保留考古入口 | `objective-coverage-ledger.md`、`objective-review-workbook.md`、`product-loop-sprint.md`、`product-loop-sprint-acceptance.md` |
| **Long-term Design / Partially Implemented** | 长期设计摘要，部分被 MVP 覆盖 | `cve-research-workbench-design.md`、`security-learning-and-research-platform.md` |
| **Paused / Design Summary** | 已冻结未来设计 | `ctf-labs-design.md`、`lab-management.md` |
| **Historical** | 当时的 ADR、Checkpoint、Review、Spike | `developer/adr/*`、`developer/checkpoints/*`、带日期 Review、`spikes/*` |
| **Research** | 外部项目与方案输入 | `developer/research/*`、`industry-baseline.md` |
| **Design Snapshot** | 视觉参考与验收证据 | `design/audits/*`、`design-qa.md`、`docs/design/*` |
| **Vendored / External** | 上游原文，不按 MilkSU 进度重写 | `third_party/*`、`packages/ui/*`、fixture、Skill 内部参考 |

## 维护规则

1. Current 只写当前可验证事实与下一条完成线，不堆历史 smoke 清单；
2. Target 描述不变量，不维护动态完成度；
3. Evidence 保留原始日期、版本和范围，不外推；
4. Historical/Research/Design 只加状态和 successor，不篡改当时内容；
5. Paused 文档首屏写明未启用；
6. 外部或 vendored 文档不替 MilkSU 改写；
7. 开发中只更新测试、回执、Checkpoint 和必要 ADR；发布声明在 Gate 通过后统一更新；
8. 文档压缩单独成批：先保证 Current 不误导执行，再合并冗余过程记录。
