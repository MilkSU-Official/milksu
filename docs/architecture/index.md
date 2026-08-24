# MilkSU 架构快照

> 文档状态：Current
>
> 审阅日期：2026-08-23
>
> 范围：当前 `main`。正式发行基线是 `v26.823.1 / efeda10`。文档收口提交不移动该 tag。
> 实现进度、已发行与未发版分界以
> [当前开发目标](/developer/current-objectives)、当前代码、测试和真实验收为准。

这组文档用于回答当前实现与长期设计。尚未实现不是禁止实现：

0. [Archify 当前架构规格](generated/milksu-current-system.architecture.json)：生成时描述 Coding
   主链、CTF 证据闭环、持久化和内部评测边界；交互式 HTML 由 Coding 的“架构图”动作
   按需重新生成和预览。JSON 是版本化规格快照，不替代当前代码事实。
1. [当前系统与分层](current-system.md)：MilkSU 现在由哪些进程、容器和模块组成？
2. [CTF 数据与时序](ctf-intake-agent-judge-memory.md)：一道题怎样从 Intake 进入 Agent、Judge 和训练记忆？
3. [Coding Agent / Pi 扩展边界](coding-agent-pi-extension-boundary.md)：哪些能力复用 Pi，哪些能力属于 MilkSU；CTF 当前少接了哪些 Coding 面（现有接线，不是禁令）？
4. [当前开发目标](/developer/current-objectives)：唯一目标契约；M3 product-loop 已合并，后续
   从目标、代码和测试事实选择有界批次。
5. [授权安全学习与研究平台](security-learning-and-research-platform.md)：CTF、实验室、CVE、
   Coding 怎样共享证据、授权、环境与学习底座？
6. [CTF Labs 顶层与详细设计](ctf-labs-design.md)：CTF 可重置训练环境的长期设计；环境经纪本身见下一篇，不是主导航「实验室」的别名。
7. [靶机、环境经纪与活靶面](target-environments.md)：**Designed**。真实环境是工作台本体；P0 本地 Docker Web/Linux，P1 本机 AVD；右栏是活靶面（浏览器/终端/模拟器），不是写死浏览器。未进发行。
8. [CVE 研究工作台顶层与详细设计](cve-research-workbench-design.md)：CVE 档案与复现报告的长期背景。
9. [文档与任务状态登记](/developer/document-status)：跨文档的唯一当前口径与任务状态。

## 状态约定

| 状态 | 含义 |
| --- | --- |
| **Implemented** | 实现和自动化证据都在仓库中；不自动代表真实场景或最终原生发布已验。 |
| **Verified** | 该文档明确写出的真实场景已经验收；不能外推到相邻能力。 |
| **Partial** | 主体代码已存在，但真实场景、原生 UI 或发布门仍未全部验收。 |
| **Planned** | 只有决策、研究或接口方向，不能在产品中宣称可用。 |
| **Paused** | 有实验或未发布代码，但已经从当前交付范围移除。 |

## 文档事实优先级

当不同年代的文档出现冲突时，按以下顺序判断：

1. `developer/current-objectives.md` 的当前任务与完成门槛；
2. 本目录的 `current-system.md` 与代码、测试、原生 App 的实现事实；
3. `Planned / Paused` 详细设计；
4. 记录代码无法表达之取舍的 ADR。

ADR 记录当时为什么这样决定，不会因为后续实现而改写历史。单次代码审阅、文件规模和工程
Checkpoint 由 Git 历史与自动化重新生成，不再长期占用文档入口。

## 本快照的关键结论

- CTF 的产品内核已经成立：模型候选与权威 Judge 分离，事实进入追加式 Event Store，
  PI 轨迹和候选可以回流，用户复盘后才允许沉淀长期训练记忆。
- M3 product-loop 已证明多条打包 App 纵切可用。当前最大产品风险不再是底层完全缺失，而是
  真实外部 Provider 质量、长期主工作区自举、六赛道 CTF、Memory 校准和发行门禁尚未形成
  完整矩阵。架构热点继续登记，但不启动独立清债冲刺。
- 普通 Coding 会话已经在代码层接入固定版本 Archify、PI LSP、Goal、后台任务、MCP
  Adapter 和 Playwright MCP；Coding 核心的 Plan → Go、多轮修改、真实打包命令执行与
  独立复验已经 **Verified**。隔离 Coding Browser 已在 `26.817.x` 打包任务验收；开发版本线
  上浏览器自动就绪且多标签独立，并增加 `milksu_workspace` 与 85% Pi 压缩。Artifact 预览、
  ImageGen、Computer Use、PR 和 worktree 也已有不同程度的工程主链或真实打包验收。
  Session Index 底层仍在，单会话相关历史/图谱前端已删除。真实外部 Provider/更广系统权限
  矩阵和最终长期自举 Gate 仍未完成。
- 桌面主壳已迁到 Electron/Chromium：Vue 运行在主 `BrowserWindow`，Go 作为受管本地 Runtime
  通过 JSONL RPC 提供应用服务；右栏“浏览器”是会话隔离的 `WebContentsView`，用户和 Agent
  操作同一当前 Target。旧 Wails/CEF 生产链已删除。
- “浏览器”、Browser Use 与 Computer Use 是桌面 GUI 的三种独立执行表面：分别对应 MilkSU
  管理页面、用户授权的真实标签页和用户授权的可见 App/Window（含真实浏览器窗口）。它们共享可见 Scope、可接管和
  显式停止语义，但不共享 Profile 或权限；面板折叠不等于终止 Session。
- Coding Composer 的“+”已经收敛为统一能力入口：附件、Goal、Plan、浏览器、
  Browser/Computer Scope、已审核 Pi Skills 与项目 MCP。选择 Scope/Skill 不直接发送，Skill
  复用 Pi 原生 `/skill:name`；未选择 Plan 时默认是 Go，不再维护 `/go` 或常驻 Plan/Go 下拉。
- IDA Pro/idalib 与 capa 已有设置、准备和健康检查，就绪且启用后进入普通 Coding 可选目录。
  CodeQL、Burp、Shannon 仍只做检测。接到实验室或 CVE 复现由当前切片决定，不需要先开“是否投影”的会。不把 HexStrike 整包 MCP 做成产品页。
- 主导航「实验室」已进入 `26.822.1`（作业、改名、报告、对话小窗）；`26.823.1` 起与 Coding 共用完整循环。CTF 可重置环境仍未做。
- NYU CTF Bench 的只读元数据、Admission、DeepSeek one-shot Runner、两回合 Pi 只读
  Agent Runtime 和摘要 Judge 是 **Implemented / Verified for the narrow baseline**。
  Agent Runtime 当前只有 5 个手选 static 样本：2 solved、1 unsolved、1 无效 JSON、
  1 回合超时。它验证了只读加载、强制重启和恢复，但不是完整 NYU CTF Bench 成绩、
  不是作用型 CTF Agent 工具链验收，也不是面向用户的题库或评测服务。
- Coding Harness 遵循 **reuse-first**：Pi Core 或经审阅的社区扩展能负责的通用能力，
  MilkSU 不再写临时替代品；自研集中在桌面安全边界和 CTF 的 Evidence / Judge /
  Recovery / Memory。

## 证据入口

- 进程组合：`desktop/main.cjs`、`desktop/preload.cjs`、`cmd/milksu-backend/main.go`、
  `cmd/milksu-backend/desktop_rpc.go`、`cmd/milksu-backend/app.go`
- 通用 Agent：`sidecar/pi/bridge.js`、`internal/engine/supervisor.go`
- CTF 事实链：`internal/ctf/`、`cmd/milksu-backend/ctf_agent_recorder.go`
- 追加式事实存储：`internal/securityruntime/`
- 平台与浏览器：`internal/nssctf/`、`internal/ctfshow/`、`internal/browsercap/`
- 本地数据根：`internal/appdata/directory.go`
- 固定 Coding 资源：`docs/developer/pi-resource-whitelist.md`、`scripts/package-sidecar.mjs`
- 构建与验收：`scripts/package-sidecar.mjs`、`scripts/package-electron.mjs`、
  `scripts/check-macos-signing.mjs`
