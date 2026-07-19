# MilkSU

MilkSU 是一个由用户拥有的、可验证的 Security Agent Harness 与桌面控制面。它不从零重写模型调用、上下文压缩和通用工具循环，而是选择 Pi、Codex CLI 开源核心等成熟 Coding Agent Engine 作为可改造基座，再由 MilkSU 自己实现安全任务的假设、实验、证据、副作用、判分、恢复和教学闭环。直接运行完整 Codex/Claude Code CLI 仍只是可选兼容方式。

## 产品使命

**MilkSU 是一个人与安全 Agent 共同工作的研究与训练环境。它既帮助用户完成更多真实安全任务，也通过可验证的实验、证据和复盘，让用户真正掌握完成这些任务的方法。**

第一阶段只开发两个场景：**CTF** 与 **Vulnerability Research（Vuln）**。这不是把两个按钮写进聊天页，而是先做出两套真实、可验证、可教学的 Role Package 闭环。

文档站首页是一屏架构总图，也是当前设计基准。完整论证按以下顺序阅读：

1. [安全 Agent 与通用 Agent 的能力边界](docs/developer/security-agent-boundary.md)
2. [六层运行时架构](docs/developer/architecture.md)
3. [CTF / Vuln Role Packages](docs/developer/role-packages.md)
4. [靶场与环境管理](docs/developer/lab-management.md)
5. [开源项目坐标](docs/developer/industry-baseline.md)
6. [开发计划](docs/developer/development-plan.md)
7. [ADR-0001：Agent Engine 与桌面进程边界](docs/developer/adr/0001-agent-engine-and-desktop-boundary.md)

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
- Go / Wails / React 桌面宿主；
- 通用聊天、会话存储、模型配置与流式工具输出；
- 一个进程隔离的 Pi SDK Sidecar 和版本化结构化事件边界；
- Pi 与 Codex app-server 使用同一微型 CTF 的 M0 Spike。Pi 是默认可改造 Engine，Codex 暂作对照与未来兼容运行时。

核心 Runtime 仍是空白。当前按[开发计划](docs/developer/development-plan.md)推进：先建立 Go/Wails/SQLite 的最小纵向骨架，再依次跑通 CTF 与 Vulnerability Research；在这两个场景成立之前，不并行开发 Red、Blue、AppSec 或 Malware Role。两者都支持 Coach、Copilot、Delegate，并分别保存安全任务 Outcome 与人类学习 Outcome。

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
wails build
```
