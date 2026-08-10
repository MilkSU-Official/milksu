# MilkSU

MilkSU 是一个 macOS-first 的本地 AI 学习与开发客户端，当前产品主线是：

- **Coding Agent**：以固定版本 Pi 为通用 Agent 基座，在用户授权的项目中持续修改、构建、
  测试、预览、恢复并交付代码；
- **CTF**：把题面、材料、Agent 轨迹、候选、平台 Judge、恢复、复盘和训练证据连成可验证
  的学习闭环。

MilkSU 不从零重写通用模型调用、Tool Loop、Compaction、LSP、Browser 或 ImageGen。
通用能力优先复用成熟组件；自研重点是桌面权限边界，以及 CTF 的 Evidence、Judge、
Recovery、Memory、教学和 Agent 协作。

> 当前仍是 pre-release 开发版本，不是正式签名、公证或可自动升级的发行包。
>
> 2026-08-05，M3 product-loop PR #1 已 squash merge 到 `main`，合并后基线为
> `108e0e3`。当前进度和未完成项只以
> [当前开发目标](docs/developer/current-objectives.md)、当前代码、测试和 Git 历史为准；
> [产品闭环冲刺摘要](docs/developer/product-loop-sprint.md)只记录已完成冲刺的关键结论，
> 不表示同一 PR 仍未合并。

## 为什么是桌面 Agent

MilkSU 的桌面 GUI 不只是给命令行 Agent 加一层聊天界面。它提供三种由用户看得见、可控制的
执行表面，这是它相对纯 TUI 的关键产品能力：

- **浏览器**：MilkSU 管理的会话隔离 Chromium。用户和 Agent 操作同一个页面，适合网页调研、
  前端验证以及后续经领域授权的 CTF/CVE Web 任务；产品界面只称“浏览器”。
- **Browser Use**：用户把真实 Chrome/Edge 中的准确标签页授权给当前任务，用于必须复用现有
  登录态或浏览器扩展的工作；它不继承 MilkSU 浏览器的 Profile，也不获得整个日常浏览器权限。
- **Computer Use**：用户选择一个可见的外部 App、进程和窗口作为 Scope，用于没有更成熟结构化
  接口的桌面操作；浏览器不混入这个权限面。

这三类能力共享同一条产品原则：用户输入表达任务意图，Composer 中的可删除 Scope 表达准确
授权；右栏或底部面板只是观察和接管入口，折叠界面不应等同于停止 Agent、浏览器会话或外部
任务。具体实现、已验证范围和未完成矩阵见
[当前系统与分层](docs/architecture/current-system.md)与
[Coding Agent / Pi 扩展边界](docs/architecture/coding-agent-pi-extension-boundary.md)。

## 当前事实

| 领域 | 可以准确声称 | 仍不能声称 |
| --- | --- | --- |
| Coding | Plan/Go、三档权限、项目工具、附件、本地 OCR、LSP、Artifact 预览、内置 Chromium 浏览器、后台任务、Diff/Hunk、Git、PR 预览/发布确认、worktree、ImageGen、Project MCP、Session Index 和 Computer Use 外部 App 纵切均已有不同程度的工程主链或真实打包验收证据 | 仍不能称为 Codex 等价产品；真实外部 Provider 质量、长期主工作区自改、自主合并发布、完整审批矩阵和发行门禁仍未完成 |
| CTF | NSSCTF/CTFshow 目录、自定义题、单题工作区、Coach/Copilot/Delegate、Evidence、候选、Judge、Checkpoint、恢复、复盘和 Memory 主链已存在；NSSCTF P3879 有一条真实 `correct=true` 记录 | 只有 Web 窄路径有真实 Judge 成功，不能称为六赛道通用 CTF 成绩 |
| CVE | 一级菜单已从 mock 骨架推进为学习/追踪 MVP：NVD、FIRST EPSS、OSV、GitHub Advisory、CISA KEV 与 Vulhub 练习目录同步，来源快照、研究档案、资产验证、学习写回、本地 Docker Compose 练习生命周期和 Coding 接力均已有真实或窄验收 | 不是红队 Agent、批量扫描器、自动 PoC 复现器或披露平台；真实 Vulhub 漏洞复现、外部资产研究和披露闭环后置 |
| Memory | 用户/Agent/协作/导入和提示依赖的归属模型、当前题排除及相关/无关召回测试已经存在 | 尚未完成真实 36 条分层轨迹、跨题推荐和用户能力画像校准 |
| Runtime | 多轮工具 fixture、Sidecar 恢复、Compaction、超时/取消、预算、失败分类、异常退出标记和打包 App/WebView 后台长任务恢复已有可复跑报告 | NYU safe-static 只是开发者 smoke，不是 MilkSU CTF Outcome；交互式 PTY 重连、更多真实长任务和发行级恢复矩阵仍未完成 |
| 发行 | 本地备份、恢复、脱敏诊断、最低窗口和单机性能基线已存在 | Developer ID、Hardened Runtime、公证、升级、新机器和正式支持矩阵尚未进入 RC 验收 |

Lab 纵深闭环仍保持 `Paused / Designed`，不进入当前真实完成条件。CVE 已有学习/追踪 MVP；
CVE 纵深研究、真实漏洞复现、外部资产实验和披露流程仍后置。实验代码和历史设计不能被描述为
当前用户能力。

## 稳定边界

- 模型候选不等于成功；CTF 成功由平台 Judge 或其他独立 Evaluator 决定。
- Provider Credential 不进入模型上下文、前端、普通文件、日志、诊断包或迁移。
- “替我审批”和“完全访问”优先减少普通任务中的无意义中断，但不会绕过付费、外部账户、
  扩大 Scope、托管发布、路径边界或不可逆操作。
- 只允许向用户明确授权的 MilkSU 私有远端发布，不向引用的开源项目创建 PR。
- 新代码直接实现当前干净模型；pre-release 旧 schema 和过渡结构在产品稳定后集中做一次
  破坏性收口，不在功能纵切中途维护临时兼容层。

## 文档入口

先按以下顺序阅读，避免从历史 ADR 恢复旧计划：

1. [当前开发目标](docs/developer/current-objectives.md)：唯一目标契约、优先级和执行规则。
2. [文档与事实状态](docs/developer/document-status.md)：哪些文档是 Current、Target、Evidence、
   Historical、Research 或 Paused。
3. [当前系统与分层](docs/architecture/current-system.md)：当前代码中的进程、模块和边界。
4. [架构快照索引](docs/architecture/index.md)：长期设计、暂停范围和证据入口。

`objective-coverage-ledger.md`、`objective-review-workbook.md`、`docs/developer/adr/`、
带日期的 Review、Checkpoint、设计审计和 Spike 都是历史决策或证据，
不是当前 backlog。发生冲突时，以代码、测试、原生 App、真实回执和当前目标为准。

## 开发

```bash
# 安装根依赖并构建文档
npm install
npm run docs:build

# Vue 浏览器开发预览
npm --prefix app install
npm --prefix app run dev

# Go 与前端自动测试
go test ./...
npm --prefix app run test
npm --prefix app run build

# 固定 Sidecar 资源与 Electron/Chromium 桌面包
npm run sidecar:smoke
npm run desktop:build
npm run m3:release-check
```

具体命令和环境要求以 `package.json`、`app/package.json`、`desktop/package.json` 和当前 CI/脚本为准。
