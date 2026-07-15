# 工具即触发器模式

## 问题

一个 LLM 工具调用需要触发宿主级别的副作用（如生成子代理、更新面板），但工具本身运行在 Pi 沙箱中，没有 IPC 访问权限。

直接的方案都会失败：
- 工具无法访问 Rust IPC（没有桥接引用）
- 工具不应具备该能力（最小权限原则）
- 让工具感知宿主会破坏技能的抽象边界

## 解决方案

将工具拆分为两个独立通道：

```
LLM calls tool
  |-- Content channel (Pi skill execute)
  |   Returns text to LLM for reasoning
  |
  +-- Trigger channel (bridge.js intercepts toolcall_end)
      Performs the actual host-level operation
```

### 内容通道 (Content Channel)

Pi 技能的 `execute()` 返回工具结果供 LLM 使用。这是标准的工具响应路径。

```javascript
// skills/panel/tools/panel_update.ts
async execute(_toolCallId, params) {
  return {
    content: [{
      type: "text",
      text: `Panel updated: set ${Object.keys(params.set_fields).join(", ")}`
    }]
  };
}
```

### 触发通道 (Trigger Channel)

桥接层在 `toolcall_end` 事件中拦截同一个工具调用，执行真正的操作。

```javascript
// bridge.js
session.on("toolcall_end", (event) => {
  if (event.toolCall?.toolName === "panel_update") {
    const payload = event.toolCall.toolInput;
    emit({ type: "panel_update", id: conversationId, ...payload });
  }
  if (event.toolCall?.toolName === "spawn_subagents") {
    if (!conversationId.includes(":sub:")) {  // recursion guard
      handleSpawnSubagents({ conversationId, tasks: event.toolCall.toolInput.tasks });
    }
  }
});
```

## 使用场景

| 工具 | 内容（供 LLM 使用） | 触发（宿主侧副作用） |
|------|---------------------|----------------------|
| `panel_update` | "Panel updated: target, phase" | 发出 panel-update Tauri 事件 |
| `spawn_subagents` | "Spawning 3 sub-agents..." | 创建独立的 Pi 会话 |

## 为什么不用其他方案？

### 直接工具执行（Codex 模式）
Codex 的工具（`shell`、`apply_patch`）以审批策略 (Approval Policy) 作为门控，直接执行。当工具的效果是自包含的（运行命令、写文件）时可行，但当效果需要宿主级协调（生成进程、发出 IPC 事件）时不适用。

### 权限门控执行（Claude Code 模式）
Claude Code 通过 `StreamingToolExecutor` 和 7 层权限检查来运行工具。工具本身执行操作。这要求工具具备访问宿主能力的权限，破坏了 Pi 的扩展沙箱模型。

### 为什么工具即触发器是一个干净的解决方案
- 工具保持为纯 Pi 技能（无宿主依赖）
- 桥接层在明确定义的点（toolcall_end 事件）进行拦截
- LLM 获得即时反馈（内容通道）
- 宿主获得异步控制（触发通道）
- 同一事件流承载两个通道（无需额外 IPC）

## 面试要点

此模式解决的问题是："LLM 工具调用如何在工具本身不需要 IPC 访问权限的情况下触发宿主级操作？"

关键洞察在于，工具调用事件已经作为 Pi 事件系统的副作用流经桥接层。桥接层可以在工具无感知的情况下观察并响应该事件。这是观察者模式 (Observer Pattern) 在代理套壳 (Agent Harness) 层面的应用。
