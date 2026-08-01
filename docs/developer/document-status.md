# 文档与任务状态登记

> 状态：**Living document**
>
> 最后事实审计：2026-08-02
>
> 规则：未经自动化或真实产品验收的工作区改动不能从 `Partial` 升为 `Verified`。

## 当前唯一口径

MilkSU 当前是一个 local-first 的授权安全学习与研究桌面工作台：

- **CTF** 已跑通一条真实 NSSCTF Intake → Pi → Candidate → Browser Judge → Recovery →
  Debrief 闭环，但多题型、动态 Endpoint 和能力画像仍需样本校准；
- **Coding** 核心 Plan → Go、多轮编辑、命令与测试已经真实交付；Codex 风格三档权限菜单、
  Project Auto 和显式 Full Access 已实现；理解项目、运行测试、审阅变更、修复失败和总结
  已在同一打包 App 会话完成连续真实验收，文件级 Diff 有独立右侧页并向审阅动作注入桌面
  Git Adapter 的可信证据。逐工具审批、文件/图片附件、项目级 MCP 选择，以及可显示 PID、
  监听端口、有界日志并停止任务的会话隔离终端已接线；本地远端已完成 stage、commit、
  push 原生回归，仍缺托管平台 PR、Coding Browser、Computer Use 和交互式 PTY；
- **NYU CTF Bench** 只有开发者专用 safe-static 单次 Runner 与 Digest Judge，不是完整
  Challenge Runner，也不是用户训练能力；
- **Labs** 与 **CVE Research** 已完成顶层/详细设计，但保持 `Paused / Designed`；
- 当前发布检查点是 **R0.4**，不能写成“完整 M0—M7 的长期 M3 已完成”。

## 文档生命周期

| 类型 | 文档 | 如何使用 |
| --- | --- | --- |
| Current | [开发计划](/developer/development-plan) | 当前优先级、验收记录和长期 M0—M7 里程碑。 |
| Current | [当前架构快照](/architecture/) | 当前进程、边界、CTF/Coding/Eval 状态和架构债。 |
| Current | [Coding 与 Codex 能力对照](/developer/coding-agent-codex-parity) | Coding 产品差距的逐项事实源。 |
| Current | [NYU CTF Bench 评测边界](/developer/nyu-ctf-bench-eval) | 内部评测能够做什么、明确不能做什么。 |
| Current | [PI Resource Whitelist](/developer/pi-resource-whitelist) | Coding 可以加载的固定 Pi 资源和 CTF 隔离规则。 |
| Target | [六层运行时架构](/developer/architecture) | 保存对象模型和不可破坏的架构原则；不用于判断发布状态。 |
| Designed | [授权安全学习与研究平台](/architecture/security-learning-and-research-platform) | CTF、Labs、CVE、Coding 的长期关系。 |
| Paused | [CTF Labs 设计](/architecture/ctf-labs-design) | 授权和发布门满足后才允许解冻。 |
| Paused | [CVE 研究工作台设计](/architecture/cve-research-workbench-design) | 取得数据、平台和目标授权后分阶段解冻。 |
| Historical | `developer/adr/*` | 保留当时决策；通过后继链接解释被什么取代，不重写历史。 |
| Historical | `developer/checkpoints/*`、带日期 Review | 保留当日证据，不用于宣称当前完成状态。 |
| Research | `developer/research/*`、`design/audits/*` | 调研或设计输入，不自动成为依赖、任务或产品承诺。 |

## 任务状态

### Verified / 已形成稳定基线

| 能力 | 证据边界 |
| --- | --- |
| NSSCTF P3879 真实闭环 | 题面、附件、Agent 候选、配对页面 `correct=true`、恢复与复盘。 |
| 清洁用户题库与恢复 | 自动同步 4,204 题、Judge 不明确恢复、报告脱敏、跨进程恢复。 |
| Coding 核心交付 | 打包 App 中 Plan → Go、多轮修改、`npm test`、smoke 与外部独立复验。 |
| Coding 权限执行 | Project Auto 项目外写入负向测试、Full Access 显式项目外写入与 Provider Key 隔离测试。 |
| Coding 权限菜单 | Codex 三档层级、帮助入口、选中态、警示色和 1024 × 700 视口完成浏览器交互与视觉对照；推荐状态恢复为 Project Auto。 |
| Coding 日常动作与 Diff | 同一真实打包 App 会话连续完成理解、失败复现、审阅、修复和总结；修复后 `npm test` 为 3/3；右侧变更页支持文件列表、暂存/工作区 Diff、截断和可信 Git 证据审阅。 |
| Coding Git 与项目终端 | 本地临时远端完成原生 stage、commit、push 与远端 HEAD 核对；右侧终端页在原生 App 中完成短命令和 `127.0.0.1:18876` 后台服务启停，显示 PID、端口、日志和退出状态，并按 Conversation 隔离任务。 |
| Coding 运行时隔离 | Project Auto 的 HOME/TMP/Node wrapper 位于用户数据目录的稳定工作区哈希路径；用户仓库不再生成运行时 `.milksu`，旧目录不会被自动删除且从 Git 面板隐藏。 |
| Coding 审批与扩展底座 | Request Approval 会暂停单次工具并由桌面批准/拒绝；固定 `pi-goal`、`pi-lsp`、后台任务和 opt-in MCP Adapter 已进入打包清单、正向 Smoke 与 CTF 负向隔离。 |
| Coding 附件与文本视觉降级 | 文件/图片会复制到用户数据目录并随会话持久化；纯文本模型使用本地 OCR 或显式视觉路由，无法可靠识图时必须披露降级。 |
| Archify 一键产品动作 | 真实打包 App 一键生成固定 JSON/HTML，独立复验 9/9、0 error、0 warning，右侧预览成功。 |
| 本地持久化 | 用户目录 SQLite、Workspace、Artifact、Conversation、Memory 和 Credential Store。 |
| 安全备份恢复 | 设置页可导出一致 SQLite 快照并从备份恢复；恢复在 Store 打开前执行，拒绝未来版本/损坏哈希/路径穿越，保留凭据与配对，并生成可回滚快照。 |
| NYU safe-static 基线 | 人工准入、一次无工具 Provider 调用、Digest Judge、成本/Token/退出原因报告。 |
| 当前架构图 | Archify 规格与 HTML 通过 showcase 9/9、0 error、0 warning。 |

### Active / R0.4 当前工作

| 优先级 | 任务 | 完成条件 |
| --- | --- | --- |
| P0 | Coding 审批与外部副作用闭环 | 保持单次工具批准/拒绝回归；Git 发布、Browser、Computer Use 等外部副作用继续使用独立授权。 |
| P0 | Coding Diff / Git 发布 | stage/commit/push 本地闭环已验收；继续补逐块/行级反馈、托管平台凭据路径和 PR 发布确认。 |
| P0 | Coding 产物与视觉预览 | 在已实现附件输入之上补 HTML/Markdown/图片产物预览，并区分 OCR 文本与真正视觉理解。 |
| P0 | 原生 UI / Markdown 回归 | 长代码块、表格、旧会话、窄窗口、下拉框和右侧面板在打包 App 中不重叠、不截断。 |
| P0 | CTF 多题型验收 | Web、Reverse、Crypto、Forensics 各保留 Judge、轨迹、提示依赖和恢复证据。 |
| P1 | Coding Browser / Computer Use | 项目 MCP 已 opt-in 接入；继续复用成熟 Browser/Computer Use 能力，并在环境面板显示来源、权限、活动和停止状态。 |
| P1 | CTF Memory / 能力画像校准 | 错误记忆可停用；跨题召回与六维变化能由真实训练样本解释。 |
| P1 | 架构债拆分 | CTFshow、NSSCTF Web 与 Arena 桌面适配器已从 `app.go` 独立；继续保持 Wails/领域契约稳定，拆 `CTFPage.vue`、Browser Manager、CTF Service 和 Bridge Policy。 |
| P1 | SQLite 迁移与公开发行 | 可回滚备份恢复已完成；仍需统一编号迁移、Developer ID、公证和升级路径。 |

### Designed / Paused

- CTF 二级 Labs：Juice Shop、WebGoat、Vulhub 白名单。
- CVE Research：情报、项目与资产、Research Case、Evidence Gate、报告与披露。
- Labs/CVE 的设计不进入 R0.4 完成率，也不允许 UI 暗示已经接入。

### Out of scope

- HTB/THM 内容抓取、Lab Token 和 Agent 自动化；
- 未授权互联网扫描、凭据喷洒和无人审批的外部动作；
- 云端用户系统、多人协作、PostgreSQL 与公开服务 API；
- 将 safe-static NYU 结果包装成完整模型排行榜或真实 CTF Agent 成绩。

## 状态更新规则

1. `Implemented` 需要代码和自动化测试；
2. `Verified` 还需要打包 Sidecar/原生 App 或真实平台证据；
3. `Planned / Designed / Paused` 不得出现在“当前可用能力”列表；
4. 历史文档只补 successor，不反向改写当时结论；
5. 每次里程碑重排必须同时更新本页、开发计划、README、当前架构图和文档导航；
6. 文档构建、链接检查和 Archify showcase 验证必须进入发布检查。
