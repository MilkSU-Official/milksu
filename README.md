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
> 产品开发目标已于 2026-08-03 恢复，当前按 P0 → P1 → P2 做广度优先功能覆盖；非阻塞
> Bug 和细节先登记、后批量修复。当前进度和未完成项只以
> [目标覆盖台账](docs/developer/objective-coverage-ledger.md)为准。

## 当前事实

| 领域 | 可以准确声称 | 仍不能声称 |
| --- | --- | --- |
| Coding | Plan/Go、三档权限、项目工具、附件、本地 OCR、LSP、Artifact 预览、隔离 Browser、后台任务、Diff/Hunk、Git、PR 预览、worktree、ImageGen 和 Project MCP 均已有不同程度的工程主链或验收证据 | 尚未通过一次完整、长时间、跨 App 重启并最终发布私有 PR 的 “MilkSU develops MilkSU” Gate；不能称为 Codex 等价产品 |
| CTF | NSSCTF/CTFshow 目录、自定义题、单题工作区、Coach/Copilot/Delegate、Evidence、候选、Judge、Checkpoint、恢复、复盘和 Memory 主链已存在；NSSCTF P3879 有一条真实 `correct=true` 记录 | 只有 Web 窄路径有真实 Judge 成功，不能称为六赛道通用 CTF 成绩 |
| Memory | 用户/Agent/协作/导入和提示依赖的归属模型、当前题排除及相关/无关召回测试已经存在 | 尚未完成真实 36 条分层轨迹、跨题推荐和用户能力画像校准 |
| Runtime | 多轮工具 fixture、Sidecar 恢复、Compaction、超时/取消、预算和失败分类已有可复跑报告 | 完整 App 的用户可见长任务恢复仍未通过；NYU safe-static 只是开发者 smoke，不是 MilkSU CTF Outcome |
| 发行 | 本地备份、恢复、脱敏诊断、最低窗口和单机性能基线已存在 | Developer ID、Hardened Runtime、公证、升级、新机器和正式支持矩阵尚未进入 RC 验收 |

Labs 与 CVE Research 保持 `Paused / Designed`，不进入当前完成条件。它们的实验代码和历史
设计不能被描述为当前用户能力。

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

1. [当前开发目标](docs/developer/current-objectives.md)：唯一目标契约、优先级和广度执行规则。
2. [目标覆盖台账](docs/developer/objective-coverage-ledger.md)：89 个细项的证据、缺口与统一计分。
3. [文档与事实状态](docs/developer/document-status.md)：哪些文档是 Current、Target、Evidence、
   Historical、Research 或 Paused。
4. [当前系统与分层](docs/architecture/current-system.md)：当前代码中的进程、模块和边界。
5. [目标共同评估工作簿](docs/developer/objective-review-workbook.md)：用户与主 Agent 的目标讨论区，
   不构成开发授权。

`docs/developer/adr/`、带日期的 Review、Checkpoint、设计审计和 Spike 都是历史决策或证据，
不是当前 backlog。发生冲突时，以代码、测试、原生 App、真实回执、当前目标和覆盖台账为准。

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

# 固定 Sidecar 资源、打包与完整回归
npm run sidecar:smoke
wails build
npm run m3:release-check
```

具体命令和环境要求以 `package.json`、`app/package.json`、`wails.json` 和当前 CI/脚本为准。
