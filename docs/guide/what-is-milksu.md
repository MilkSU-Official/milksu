# MilkSU 是什么

MilkSU 是一个由用户拥有的安全任务控制面，基于 [Pi](https://github.com/earendil-works/pi) 代理运行时 (Agent Runtime) 的扩展机制构建。它把 Pi、Codex、Claude Code 和其他模型视为可替换的执行器，负责管理模型之外的环境、判分器、策略、证据、轨迹和恢复流程。

MilkSU 不以“比前沿模型更会解题”为目标。对于一次性 CTF、单仓库审计或临时漏洞分析，成熟通用 Agent 通常是更好的默认选择。MilkSU 的价值来自真实安全任务中需要长期积累的闭环资产：

- 专用环境和工具的标准化接入
- 独立于模型自评的成功判定
- 可回放、可比较的执行轨迹
- 跨会话和跨主机的可恢复运行
- 用户拥有的模型路由、策略边界与运行数据

如果一个需求只需要增加 prompt、循环或几个 MCP 工具，它应该被实现为轻量 Skill 或适配器，而不是扩张核心 Harness。

## 核心设计决策

### 为什么把模型作为 Worker？

模型能力更新快，并且越来越多通用 Agent 已经拥有成熟的代码、安全分析和工具调用能力。MilkSU 不应把任务状态、证据或成功条件绑定在某个模型上下文中。

- 强模型负责规划、分析和生成动作。
- 控制面负责保存状态、执行策略、调度资源和恢复中断。
- Environment Adapter 负责真实目标与工具生命周期。
- Evaluator 负责确认结果，而不是相信模型的完成声明。

这样既能直接利用上游模型进步，也能让环境、判分器和任务数据持续留在用户手中。

### 为什么选择 Pi？

Pi 是一个生产级的编程代理运行时，具备丰富的扩展 API。MilkSU 构建在 Pi *之上*，而非与其并行：

- **工具注册**：通过 `pi.registerTool()` 配合 TypeBox 模式定义
- **技能发现**：通过 `pi.on("resources_discover")` 返回 SKILL.md 路径
- **系统提示词注入**：通过 `pi.on("before_agent_start")`
- **策略执行**：通过 `pi.on("tool_call")` 拦截工具调用

### 为什么选择 Tauri v2？

| | Tauri v2 | Electron |
|---|---|---|
| 二进制体积 | ~10 MB | ~150 MB |
| 内存占用 | ~30 MB | ~150 MB |
| 后端 | Rust（原生） | Node.js |
| 安全性 | 操作系统级沙箱 | Chromium 沙箱 |

Codex Desktop 使用 Electron。MilkSU 选择 Tauri v2，是因为其显著更轻的体积和原生 Rust 后端，与安全导向的使用场景高度契合。

### 为什么支持多供应商？

不同于 Codex（仅支持 OpenAI）或 Claude Code（以 Anthropic 为主），MilkSU 原生支持 5 个供应商，外加用于 API 访问受限地区的中继模式。这源于实际需求：

- DeepSeek 以更低成本提供有竞争力的性能
- 中继模式使得 API 直连受限的地区也能正常使用
- 供应商灵活性让用户可以根据任务需求自由选择

## 架构概览

```
User Input
  -> React (Tauri frontend)
  -> Rust (Tauri backend, process management)
  -> Node.js bridge (Pi agent sessions)
  -> LLM API (provider-dependent)
  -> Streaming events back through the chain
```

三个进程协同工作：**Rust 宿主进程**（窗口管理、IPC、安全）、**Node.js 桥接进程**（LLM 会话、工具执行）和 **React 前端**（UI 渲染、状态管理）。

这套三进程结构是当前桌面宿主实现，不是产品价值本身。完整目标架构还包含控制面中的 Task、Policy、Checkpoint 和 Trace，以及领域面中的 Environment、Evaluator、Evidence 和 Report。
