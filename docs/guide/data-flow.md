# 数据流

## 聊天消息流

```
User types message in ChatView
  -> React: invoke("send_message", {conversationId, prompt})
  -> Rust: send_message() spawns/reuses bridge.js subprocess
  -> Bridge: Pi createAgentSession() -> session.prompt()
  -> Pi agent streams events to stdout (JSON lines)
  -> Rust: reads stdout, emits "agent-message" Tauri events
  -> React: listen("agent-message") -> render streaming in ChatView
  -> Conversation auto-saved to disk
```

### 流式传输细节

文本通过 `text_delta` 事件逐字符到达：

1. 桥接收到 Pi 的 `text_delta` 事件
2. 桥接将 `{"type": "text_delta", "id": "conv-123", "content": "H"}` 写入 stdout
3. Rust 读取该行，映射为 `AgentMessage` 结构体，发出 Tauri 事件
4. React 的 `useAgentEvents` 钩子将 delta 累积为一条进行中的助手消息
5. 收到 `message_done` 后，消息状态从 `running` 变为 `done`

## 子代理流

```
Agent calls spawn_subagents tool
  -> Pi returns tool result to agent (content channel)
  -> Bridge intercepts toolcall_end for "spawn_subagents" (trigger channel)
  -> Bridge spawns N independent Pi sessions (max 4 concurrent)
  -> Each sub-agent streams subagent_delta/subagent_done events
  -> Rust forwards as "subagent-delta"/"subagents-done" Tauri events
  -> React accumulates results into SubagentToolMessage card
```

这使用了[工具即触发器模式](/developer/tool-as-trigger) -- 工具的 `execute()` 向 LLM 返回文本，而桥接拦截同一个工具调用来执行实际的子代理生成操作。

## 面板更新流

```
Agent calls panel_update tool
  -> Pi returns confirmation text to agent (content channel)
  -> Bridge intercepts toolcall_end for "panel_update" (trigger channel)
  -> Bridge emits panel_update event with set_fields/append_items
  -> Rust forwards as "panel-update" Tauri event
  -> React merges update into conversation's taskState
  -> TaskPanel re-renders with new data
```

## 持久化

| 数据 | 存储位置 | 格式 |
|------|---------|------|
| 设置 | `~/Library/Application Support/com.milksu.app/settings.json` | JSON |
| 对话 | `~/Library/Application Support/com.milksu.app/conversations/*.json` | 每个对话一个 JSON 文件 |
| 项目 | `~/Library/Application Support/com.milksu.app/engagements/*.json` | 每个项目一个 JSON 文件 |
