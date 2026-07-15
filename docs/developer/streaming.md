# 流式管线

## 概述

MilkSU 将 LLM 的输出逐字符实时传递给用户。流式管线 (Streaming Pipeline) 跨越三个进程，经过四次跳转。

## 管线

```
LLM API response
  -> Pi session event (message_update.assistantMessageEvent.text_delta)
  -> bridge.js unwraps nested event, writes JSON line to stdout
  -> Rust reads line, emits Tauri event
  -> React useAgentEvents hook accumulates into running message
  -> User sees character-by-character output
```

## 事件流详解

### 1. Pi 会话事件 (嵌套结构)

Pi 的 `session.subscribe()` 发出顶层事件，流式内容嵌套在 `assistantMessageEvent` 中:

```
message_update
  -> assistantMessageEvent.type:
       text_delta      (增量文本, delta 字段)
       thinking_delta  (推理输出, delta 字段)

message_end
  -> message.role === "assistant"
  -> message.stopReason: "stop" | "toolUse"
  -> message.content[]: {type: "text"} | {type: "thinking"} | {type: "toolCall"}

tool_execution_start
  -> toolName, args

tool_execution_end
  -> toolName, result, isError

agent_end
  -> 一次包含工具调用的完整代理循环结束
```

### 2. 桥接事件解包

桥接层订阅 Pi 事件，解包嵌套结构后写出扁平 JSON 行:

```javascript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent) {
        handleAssistantEvent(conversationId, event.assistantMessageEvent);
      }
      break;
    case "message_end":
      if (event.message?.role === "assistant") {
        const content = extractTextContent(event.message);
        if (content || assistantTextStreamed) {
          emit(conversationId, "message_done", {
            reason: event.message.stopReason ?? "stop",
            content,
          });
        }
      }
      break;
    case "tool_execution_start":
      emit(conversationId, "tool_call_start", { toolName: event.toolName });
      break;
    case "tool_execution_end":
      emit(conversationId, "tool_call_end", {
        toolName: event.toolName,
        content: extractToolResultContent(event.result),
        isError: event.isError,
      });
      break;
  }
});

function handleAssistantEvent(conversationId, ae) {
  switch (ae.type) {
    case "text_delta":
      emit(conversationId, "text_delta", { delta: ae.delta });
      break;
    case "thinking_delta":
      emit(conversationId, "thinking_delta", { delta: ae.delta });
      break;
  }
}
```

每次 `emit()` 写出一行以 `\n` 结尾的 JSON。

### 3. Rust 事件转发

Rust 逐行读取 stdout，反序列化为 `BridgeEvent`，然后按类型发出 Tauri 事件:

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentMessage {
    conversation_id: String,
    role: String,
    content: String,
    tool_name: Option<String>,
    done: bool,
}

// text_delta -> agent-message (role: "assistant_delta")
// message_done -> agent-message (role: "assistant", done: true)
// tool_call_start -> agent-message (role: "tool", done: false)
// tool_call_end -> agent-message (role: "tool", done: true)
// panel_update -> panel-update (separate event type)
```

### 4. React 累积

`useAgentEvents` 钩子将事件累积为消息:

```typescript
listenEvent<AgentEvent>('agent-message', (event) => {
  const { conversation_id, role, content, tool_name, done } = event.payload;

  if (role === 'assistant_delta') {
    // Append to running assistant message
  } else if (role === 'assistant' && done) {
    // Finalize message status
  } else if (role === 'tool') {
    // Tool call card (running -> done)
  }
});
```

面板更新单独监听:

```typescript
listenEvent<PanelUpdateEvent>('panel-update', (event) => {
  const { conversation_id, set_fields, append_items } = event.payload;
  // mergePanelUpdate() into conversation.taskState
  // Auto-show task panel if active conversation
});
```

## 工具执行与界面投影

当 LLM 调用 `panel_update` 工具时，一次调用产生两条事件路径:

```
tool_execution_start / tool_execution_end
  |-- (1) emit("tool_call_end") -> Rust agent-message -> React tool card
  +-- (2) emit("panel_update") -> Rust panel-update -> React TaskPanel re-render
```

LLM 看到工具返回 "Panel updated: 1 field(s) set"，继续对话。
用户同时看到工具卡片状态变化和面板数据刷新。

## 对比

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 传输方式 | stdout JSON 行 | SSE (服务器推送事件) | AsyncGenerator yield |
| 协议 | 自定义 13 事件协议 | OpenAI Responses API SSE | Claude Messages API 流式传输 |
| 缓冲 | 行缓冲 stdout | SSE 事件流 | 生成器拉取模式 |
| 延迟 | 每跳约 10ms | 约 10ms (stageItem delay) | 近乎即时 (同进程) |
