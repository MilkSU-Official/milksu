# 代理运行框架模式

本页记录了 MilkSU 中的代理运行框架 (Agent Harness) 设计模式，并与 Codex 和 Claude Code 进行对比。适用于面试和演讲准备。

关于 Agent 自身安全与使用 Agent 执行安全任务的区别、角色包与能力包的区别、随 SOTA 移动的能力边界，以及红队、蓝队、CTF、AppSec 各自的模型外部闭环，见[安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)。

## 什么是代理运行框架？

代理运行框架是围绕模型执行器的确定性基础设施。它管理环境、工具、状态、策略、证据、失败恢复和结果判定。

框架不会让模型凭空变聪明。对于单道 CTF、单个代码库审计或一次性漏洞分析，前沿通用 Agent 往往已经是更好的默认选择。MilkSU 只有在控制面能够提供模型本身拿不到的环境、判分器、轨迹数据或执行规模时才值得存在。

## 核心边界

### 可复制的工程能力

下面这些能力很重要，但不能单独证明 MilkSU 有差异化：

- checkpoint、重试和上下文压缩
- 多模型路由和子代理
- prompt 自动迭代
- 任务队列、报告和领域 UI
- 工具 schema 与通用 MCP 接入

强通用 Agent 可以编写这些脚本，成熟平台也可以逐步加入这些功能。它们是可靠系统的基础，不是天然护城河。

### 需要积累的任务资产

MilkSU 的核心价值应落在以下资产：

- **Environment**：长期靶场、内网、设备、调试器、扫描器、代理链和可回滚快照的标准接入。
- **Evaluator**：能够独立判断 flag、PoC、补丁、策略和证据是否成立。
- **Trace Dataset**：带环境版本、模型、成本、动作、观察、失败原因和 outcome 的真实运行轨迹。
- **Execution Economics**：以更低成本获得更多有效尝试，并可靠恢复中断、避免重复副作用。
- **User-owned Control**：用户拥有模型路由、策略、凭据引用、证据和运行数据。

## 什么时候应该自建？

| 场景 | 默认选择 | MilkSU 成立的条件 |
|------|----------|-------------------|
| 单道 CTF | 直接使用强通用 Agent | 有自动判分和批量 benchmark，需要提高 `success@N` 或降低成本 |
| 单仓库代码审计 | 直接使用 Codex/Claude Code | 有私有规则、真实回归环境和可验证修复闭环 |
| 一次性漏洞分析 | 直接使用强通用 Agent | 需要专用设备、调试器或无法通过普通 MCP 接入的环境 |
| 长期红队行动 | 组合通用 Agent 与人工流程 | 需要跨主机状态、资源生命周期、幂等操作和持续证据链 |
| 蓝队持续运营 | 接入现有安全平台 | 有组织遥测、案件流程和处置判分器可形成闭环 |

如果几段 MCP、一个脚本或现有 Agent Skill 就能解决，不应先造完整 Harness。

## 如何证明不是“套壳”？

以相同模型、相同工具和相同预算运行固定任务集，对比最小 Agent 基线与 MilkSU，至少测量 `success@1`、`success@N`、单次成功成本、误报成功率、中断恢复率、重复副作用和结果复现率。

架构文档描述的是假设；只有真实 benchmark 能把假设升级为产品优势。

## 模式：Tauri IPC 双通道

**问题**：代理工作负载既需要请求-响应（用户操作），也需要流式传输（代理输出）。

**方案**：Tauri 提供两种通信通道：
- `invoke`：同步的请求-响应（类似 HTTP POST）
- `emit/listen`：异步的事件推送（类似 WebSocket）

**对比**：
- Codex 通过统一的 app-server 使用 JSON-RPC over stdio/Unix socket/WebSocket
- Claude Code 使用 queryLoop 异步生成器配合工具流分发

## 模式：代理子进程桥接

**问题**：UI 宿主（Rust）和代理运行时（Node.js/Pi）需要不同的运行环境。

**方案**：Rust 将 Node.js 作为子进程启动，通过 stdin/stdout JSON 行通信。

```
Rust (host) <-- stdin/stdout JSON lines --> Node.js (agent)
```

这与 LSP 架构相同：编辑器通过 stdio 启动语言服务器。

**对比**：
- Codex CLI 是单一 Rust 进程（120+ crate），直接调用 OpenAI Responses API
- Claude Code 是 Bun 二进制文件，使用 React + Ink 终端 UI

## 模式：工具即触发器

**问题**：LLM 的工具调用需要触发宿主级别的副作用（生成子代理、更新面板），但工具本身运行在 Pi 沙箱中，没有 IPC 访问权限。

**方案**：将工具拆分为两个通道：
1. **内容通道**：Pi 技能的 `execute()` 向 LLM 返回推理用的文本
2. **触发通道**：桥接拦截 `toolcall_end` 来执行实际操作

```javascript
// 内容通道 (Pi skill)
async execute(_toolCallId, params) {
  return { content: [{ type: "text", text: "Spawning 3 sub-agents..." }] };
}

// 触发通道 (bridge.js)
if (event.toolCall?.toolName === "spawn_subagents") {
  handleSpawnSubagents({ conversationId, tasks: event.toolCall.toolInput.tasks });
}
```

**为什么不直接让工具完成操作？** 因为工具运行在 Pi 的沙箱内，无法访问 Rust IPC，无法生成进程，也不应该具备这些能力。触发通道将宿主级别的操作保留在桥接中，这正是它们应该存在的位置。

**对比**：
- Codex：工具（`shell`、`apply_patch`）直接在沙箱中执行，以审批策略作为门控
- Claude Code：工具通过 `StreamingToolExecutor` 运行，经过 7 层权限检查

## 模式：扁平子代理并发

**问题**：在没有复杂编排开销的情况下并行化独立任务。

**方案**：生成 N 个独立的 Pi 会话（最多 4 个），通过 `Promise.allSettled` 收集结果。

```
Parent session
  ├── Sub-agent 0 (independent context)
  ├── Sub-agent 1 (independent context)
  ├── Sub-agent 2 (independent context)
  └── Sub-agent 3 (independent context)
       │
       └── Results aggregated via bridge events
```

会话 ID：`{parentConversationId}:sub:{index}` -- 维持父子可追溯性。

通过在对话 ID 中检查 `:sub:` 来防止递归生成。

**对比**：
| | MilkSU | Codex | Claude Code |
|---|---|---|---|
| 最大并发数 | 4 | 6（可配置） | 受上下文限制 |
| 最大深度 | 1 | 1（可配置） | 5 层 |
| 编排方式 | 工具即触发器 | Symphony SPEC | Workflow 工具（JS 脚本，1000 个代理） |
| 代理角色 | 统一 | 3 个内置 + TOML 自定义 | 5 个内置 + 自定义 |

## 模式：任务类型感知的聊天

**问题**：安全工作流（渗透测试、CTF、逆向工程）需要在自由聊天的同时进行结构化的状态跟踪。

**方案**：每个对话携带一个 `taskType` 字段。聊天区域显示一个领域特定的面板覆盖层，包含结构化数据（阶段、漏洞、端口、旗标）。

```
┌────────────────────────────────────────────┐
│ Sidebar │ Chat Area          │ Task Panel  │
│         │                    │ (overlay)   │
│         │ [user message]     │ Phase: Recon│
│         │ [agent response]   │ Ports: ...  │
│         │ [tool result]      │ Vulns: ...  │
│         │                    │             │
└────────────────────────────────────────────┘
```

面板浮动在聊天区域上方（`position: absolute`），避免挤压聊天布局。

**对比**：领域任务 UI 是 MilkSU 当前的产品特征。它应当投影环境状态、证据和 evaluator 结果；如果只展示模型自己生成的总结，它只是界面差异，不构成核心优势。

## 模式：渐进式上下文披露

**问题**：将所有技能的完整信息加载到 LLM 上下文中会浪费 token 并降低性能。

**方案**：技能路由器生成一段简洁的路由提示词，列出可用技能及其触发关键词。只有当技能被激活时，才加载完整的 SKILL.md 内容。

**对比**：
- Codex：2% 上下文预算上限，命中时加载，使用后丢弃
- Claude Code：按目录遍历懒加载 CLAUDE.md
- MilkSU：路由提示词列出技能元数据，关键词匹配后加载完整内容
