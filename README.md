# MilkSU

MilkSU 是一个**一站式网络安全 AI 学习客户端**。它让人与安全 Agent 在明确授权的 CTF、漏洞研究和攻防训练环境中共同提出假设、执行实验、验证证据并复盘方法；它不把“自动扫描任意互联网目标”作为产品能力或开源目标。

底层仍是一个由用户拥有的、可验证的 Security Agent Harness 与桌面控制面：MilkSU 不从零重写模型调用、上下文压缩和通用工具循环。当前默认基座已经收敛为固定版本的 Pi Coding Agent；MilkSU 自己实现安全学习任务的假设、实验、证据、副作用、判分、恢复和教学闭环。Codex/Claude Code CLI 只保留为未来可选的 External Agent Runtime，不是当前默认路径。

## 产品使命

**MilkSU 是一个人与安全 Agent 共同工作的网络安全研究与训练环境。它既帮助用户在授权环境中完成更多真实学习任务，也通过可验证的实验、证据和复盘，让用户真正掌握完成这些任务的方法。**

当前产品主线是 **CTF、Coding、CVE**：CTF 已跑通一条真实平台闭环；Coding 正按日常可交付项目补齐 Codex 级工作流；CVE 目前只有演示壳与经过设计的未来研究工作台。Labs 作为 CTF 下的环境型训练领域已经完成顶层设计，但当前暂停，不属于 R0.4 的发布声明。未来再扩展的能力必须继续遵守独立 Judge、可引用证据、显式授权和可恢复轨迹。

文档站首页是一屏架构总图，也是当前设计基准。完整论证按以下顺序阅读：

1. [安全 Agent 与通用 Agent 的能力边界](docs/developer/security-agent-boundary.md)
2. [六层运行时架构](docs/developer/architecture.md)
3. [CTF / Vuln Role Packages](docs/developer/role-packages.md)
4. [CTF Labs 顶层与详细设计](docs/architecture/ctf-labs-design.md)
5. [开源项目坐标](docs/developer/industry-baseline.md)
6. [开发计划](docs/developer/development-plan.md)
7. [ADR-0001：Agent Engine 与桌面进程边界](docs/developer/adr/0001-agent-engine-and-desktop-boundary.md)
8. [Runtime v1alpha1：M1 可恢复任务契约](docs/developer/runtime-v1alpha1.md)
9. [ADR-0002：Runtime 事实、存储与恢复边界](docs/developer/adr/0002-runtime-facts-and-recovery.md)
10. [ADR-0003：M2-A CTF 纵切与 Pi Security Adapter](docs/developer/adr/0003-ctf-vertical-slice.md)
11. [ADR-0004：学习产品、能力与开源发布边界](docs/developer/adr/0004-learning-product-and-release-boundary.md)
12. [ADR-0005：M3 Vuln Research 证据纵切](docs/developer/adr/0005-vuln-research-evidence-slice.md)
13. [ADR-0006：M3 产品控制面与比赛/CVE 工作流](docs/developer/adr/0006-m3-product-control-plane.md)
14. [ADR-0007：CTF Agent Harness 与 NSSCTF Agent Arena](docs/developer/adr/0007-ctf-agent-harness-and-nssctf-arena.md)
15. [ADR-0008：Vue 3、Memoh UI 与 Challenge Desk](docs/developer/adr/0008-vue-memoh-frontend.md)
16. [ADR-0009：NSSCTF 已登录页面桥接与平台 Judge 回执](docs/developer/adr/0009-nssctf-browser-judge-bridge.md)
17. [ADR-0010：PI Coding Agent 工作区](docs/developer/adr/0010-pi-coding-agent-workspace.md)
18. [ADR-0011：NSSCTF 本地题库、能力画像与可解释推荐](docs/developer/adr/0011-nssctf-catalog-and-recommendation.md)
19. [ADR-0012：CTF 单题工作区、PI 解题交接与轨迹回流](docs/developer/adr/0012-ctf-pi-workspace-and-trajectory.md)
20. [ADR-0014：CTF 工具工坊、Agent 交接与训练记忆](docs/developer/adr/0014-ctf-tool-workshop-and-memory.md)
21. [当前架构快照](docs/architecture/index.md)
22. [CTF Labs 顶层与详细设计](docs/architecture/ctf-labs-design.md)
23. [CVE 研究工作台顶层与详细设计](docs/architecture/cve-research-workbench-design.md)

## 三个不能混淆的问题

- **Agent Security**：保护 Agent、凭据、数据和工具边界，是所有高权限 Agent 都可能需要的横切能力。
- **Role Package**：定义安全任务的目标、长期状态、证据与独立判分方式，回答“怎样才算赢”。
- **Capability Package**：提供 Binary、Web、Network、Mobile、Forensics、Fuzz 等可复用工具箱。

Role 与 Capability 可以自由组合。二进制逆向不是某个角色的别名；读取不可信内容也不是安全任务 Agent 的专属定义。

## 六层架构

```text
L1  Desktop Surface      macOS first / Windows later
L2  Role Packages        Red / Blue / CTF / AppSec / Malware / Vuln
L3  Capability Packages  Binary / Web / Net / Mobile / Forensics / Fuzz
L4  Security Runtime     Environment / Evidence / Effect / Evaluator / Recovery
L5  Agent Engine         Pi / Codex Core / Model APIs / External Runtimes
L6  Agent Integrity      Scope / Provenance / Sandbox / Credential / Supply Chain
```

L2 定义角色闭环，L5 提供可改造的通用 Agent Engine，L6 横切保护整条执行链。MilkSU Security Harness 是 L2–L6 的组合，不等于从 API 重写 L5。模型和底层 Engine 可以演进，但角色状态、真实环境、可引用证据、外部判分器和可恢复轨迹不会自动出现。

## 重新开始的边界

早期围绕“无限上下文 Codex”、固定 `taskType`、模型直写安全面板、通用子代理、仓库内 Skill 路由和红队 Engagement 数据模型的实现已经删除。它们没有经过开源项目基线和可验证任务闭环的检验，不再作为历史兼容层保留。

仓库目前包含：

- 文档站与已经确定的架构认知；
- Go / Wails / Vue 3 桌面宿主，界面组件复用 `memohai/ui`，当前产品视觉采用高对比黑绿工作台方案；
- PI Coding Agent 项目工作区、持久会话、模型配置、停止控制与流式工具输出；
- Plan / Go、请求批准 / Project Auto / Full Access 的后端权限策略，以及工作区、Git、模型、插件和工具环境信息；
- 固定版本 Archify、PI LSP、PI Goal、后台任务、项目 MCP 与本地 OCR 的 Coding 资源白名单；CTF 会话通过负向 Smoke 保持隔离；
- 一个进程隔离的 Pi SDK Sidecar 和版本化结构化事件边界；
- Pi 与 Codex app-server 使用同一微型 CTF 的 M0 Spike。Pi 是默认可改造 Engine，Codex 暂作对照与未来兼容运行时。
- Go 实现的 M1 Shared Security Runtime：追加式 SQLite 事件、内容寻址 Artifact、只读 Projection、独立 Evaluator、取消和中断恢复；
- 一个由 Fake Engine、Fake Capability、Fake Environment 与 Fake Evaluator 构成的确定性回归闭环，用来验证 Runtime，而不是冒充当前 CTF Solver；
- 真实 CTF 主链：NSSCTF/CTFshow 目录、单题工作区、Coach/Copilot/Delegate、Pi File/Shell、显式候选、Browser/Arena Judge、恢复、复盘与训练记忆；
- 面向真实入门题的有界文本分析：Base64（含多层）、Hex、Binary、Morse 与 URL 编码只在 Go capability 中确定性转换，结果作为 Artifact/Observation 回到 Agent，而不是让模型自报计算结果；
- 独立于通用聊天的 `security-bridge.js`。它关闭 Pi 内建 Coding Tools 与用户级扩展，只向模型暴露三种 CTF 提议工具。

当前可以准确声称的是：MilkSU 已完成一条真实 NSSCTF P3879 的题面与附件 Intake、Pi 解题、候选闸门、配对浏览器 Judge `correct=true`、恢复和复盘闭环；Coding 核心也已通过一次打包应用内的连续短提示交付，并已接入逐工具审批、文件/图片附件、文件级 Diff、会话隔离的项目终端、可停止的后台进程/端口/日志、stage/commit/push 本地远端闭环和 opt-in 项目 MCP。它仍不能被描述成通用 CTF Solver 或 Codex 等价产品：CTF 多题型、动态 Endpoint 确认、能力画像校准，以及 Coding 的托管平台 PR、交互式 PTY、Coding Browser 和 Computer Use 仍未完成。

2026-07-21 已保存一个 [M2 → M3 授权学习能力基础检查点](docs/developer/checkpoints/2026-07-21-m2-m3-foundation.md)：精确授权策略、Managed Lab/Browser 基础包、CTF 教学与外部人工 Judge 契约、以及本地 Vuln fixture 已经可以编译和自动测试。它们尚未完整接入桌面 UI 或真实环境，因此不改变上面的 M2 验收结论。

2026-07-30 已完成 [M3-A Vuln Research 证据纵切](docs/developer/adr/0005-vuln-research-evidence-slice.md)：固定本地 packet-parser 的 Target/Scope、Attack Surface、Hypothesis、静态 Root Cause Evidence、外部三次 ASan 日志一致性 Evaluator、研究工作台与 Human Outcome 已接入同一 Runtime。MilkSU 不接收、生成或执行触发样本字节；因此原计划中自动编译、最小化和干净环境重放仍是未完成的后续能力，不能把 M3-A 写成完整自动复现 Runner。

同日完成的 [M3 Product Shell](docs/developer/adr/0006-m3-product-control-plane.md) 把顶层入口调整为用户工作流：CTF 从平台题库建立题目、Agent、Judge 与学习工作台，CVE 从优先队列进入研究壳。CTF 侧随后加入 NSSCTF 公开单题导入、官方 Agent Arena 状态机和已登录页面 bridge：Token 只进用户目录下的本地凭据数据库，用户只绑定当前题目页，候选先形成 Evidence，Accepted/Rejected/不明确的平台响应再作为独立 Judge 回执决定是否完成。有附件的公开题可由已绑定页面显式导入，限制 4 MiB 并在扩展与 Go 后端双重校验 SHA-256；未解锁时不会替用户自动花金币。P3879 已完成一次真实登录页面 `correct=true` 验收；CTFshow 账号回归、多题型、动态 Endpoint 确认和专用 Debugger 仍需补齐。CVE 来源仍是明确标记的演示 Adapter。

M3 桌面前端已迁移到 Vue 3。训练场默认直接进入列表式 Challenge Desk：左侧浏览、搜索、筛选和分页 NSSCTF/CTFshow 题库，右侧查看题面、材料状态并选择 Coach/Copilot/Delegate，随后一键进入 PI 工作台；题名前缀系列不再是主入口。组件和主题直接复用 Memoh 主仓库锁定的 `memohai/ui` gitlink，而不是在 MilkSU 内复制一套样式；迁移理由、性能口径和依赖边界见 [ADR-0008](docs/developer/adr/0008-vue-memoh-frontend.md)。

当前一级导航为 `CTF / CVE / Coding`。未来 Labs 不作为 NSSCTF、CTFshow 一类“训练平台来源”，而是 CTF 工作区内与题库并列的二级入口；领域代码仍使用独立 Lab/Environment 边界。Labs 与真实 CVE 工作流均为 `Paused / Designed`，详见[授权安全学习与研究平台](docs/architecture/security-learning-and-research-platform.md)。

通用对话现已升级为 [PI Coding Agent 工作区](docs/developer/adr/0010-pi-coding-agent-workspace.md)：用户明确选择项目目录后，PI 可以使用 `read / bash / edit / write / grep / find / ls` 完成编码任务，工具输入和结果在会话中可见，任务可停止并在应用重启后恢复。内部 Runtime Walking Skeleton 不再占据用户一级导航。CTF 题现在也能按 [ADR-0012](docs/developer/adr/0012-ctf-pi-workspace-and-trajectory.md) 一键生成应用私有单题工作区并交给 PI；工具轨迹、失败回合和候选解释回到 Runtime Evidence，候选只能经显式文件进入 Judge。Coach、Copilot、Delegate 会生成不同的工作区契约、候选规则和程序化预算，不再只是 UI 标签。旧的零继承工具 Security Sidecar 继续保留作类型化基线。PI Shell 目前仍是本机子进程，不能宣称为容器沙箱。

NSSCTF 公开题库现可由用户显式触发限速同步到用户目录下的本地 SQLite；Challenge Desk 直接查询完整目录并从 MilkSU 自己记录的 Outcome、提示依赖和独立步骤计算六维能力画像与下一题推荐。公开目录没有稳定赛事字段，因此题名前缀系列只保留为兼容回退，不冒充官方赛事目录，也不阻挡用户按正常列表选题。实现与隐私边界见 [ADR-0011](docs/developer/adr/0011-nssctf-catalog-and-recommendation.md)。

当前 macOS 构建已经把固定版本、固定哈希的官方 Node LTS 与两份 Pi Bridge bundle 放入 App Resources；Provider、Relay 与 Arena 凭据保存在 `~/Library/Application Support/com.milksu.app/credentials.db`，目录权限为 `0700`、数据库为 `0600`，且不会经 Wails 返回前端。SQLite 内容未额外加密，安全边界是当前系统账户与文件权限。生成的 `.app` 可以脱离源码树和系统 Node 运行。开发包目前仍是 ad-hoc 签名，尚未完成 Developer ID、公证、SBOM 与外部能力审批，因此不要把 `build/bin/MilkSU.app` 当成正式公开发行包。

## 开源与使用边界

MilkSU 的默认开源版本面向 CTF 平台、项目自带靶场、用户本地实验环境和用户有权研究的目标。默认产品不提供任意目标清单、互联网网段批量扫描、凭据喷洒、隐蔽规避或无确认的外部攻击流水线；带外部副作用的动作必须绑定可见范围、保存证据并经过风险分级审批。

“学习工具”描述的是产品目的和默认能力，不构成对具体使用行为的免责。公开发布、托管服务和高风险能力包必须分别评审；详细决策见 [ADR-0004](docs/developer/adr/0004-learning-product-and-release-boundary.md)。

## 核心验收原则

任何新模块都必须回答：

1. 它属于哪一层，是否错误地把 Role、Capability、Worker 或 Agent Integrity 混在一起？
2. 它保存了什么不可由模型自报的事实？
3. 谁独立判断成功，Evidence 怎样引用，Effect 怎样恢复或清理？
4. 在相同模型、工具、环境和预算下，它是否优于最小通用 Agent 基线？

如果一个模块只是一段 Prompt、固定流程、工具薄封装或泛化 Planner，它默认不进入 MilkSU 核心。

## 开发

```bash
# 文档站
npm install
npm run docs:dev

# 桌面 UI 浏览器预览
cd app
npm install
npm run dev

# Wails 桌面端（先固定安装一次 CLI）
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
wails dev

# 自动验证与打包
go test ./...
npm --prefix app run build
# 下载并校验固定的官方 Node LTS，打包 Pi Bridges 并跑脱离源码树测试
npm run sidecar:smoke
# pre/post build hooks 会把 Sidecar 安装到 .app/Contents/Resources
wails build
```
