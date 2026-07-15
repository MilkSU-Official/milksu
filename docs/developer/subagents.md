# 子代理

## 概述

MilkSU 支持从一个父对话中生成最多 4 个并发子代理 (Sub-agents)。子代理是独立的 Pi 会话，并行执行任务并将结果流式传回父对话。

## 架构

```
Parent conversation (conv-123)
  |-- Sub-agent 0 (conv-123:sub:0)
  |-- Sub-agent 1 (conv-123:sub:1)
  |-- Sub-agent 2 (conv-123:sub:2)
  +-- Sub-agent 3 (conv-123:sub:3)
```

每个子代理:
- 拥有独立的 Pi 会话 (独立上下文)
- 获得唯一的会话 ID: `{parentId}:sub:{index}`
- 继承父会话的 provider/model 设置
- 通过桥接事件流式返回结果
- 不能再生成子代理 (递归守卫)

## 生成流程

1. 代理调用 `spawn_subagents` 工具并传入任务列表
2. Pi 将工具结果返回给代理 (内容通道): "Spawning N sub-agents..."
3. 桥接层拦截 `toolcall_end` (触发通道)
4. 桥接层按批次生成最多 4 个并发 Pi 会话
5. 结果通过 `subagent_delta` / `subagent_done` 事件流式传输
6. 所有子代理完成后触发 `subagents_done`

## 递归守卫

一行代码即可防止子代理无限递归:

```javascript
const toolName = toolCall.name ?? toolCall.toolName;
if (toolName === "spawn_subagents" && !conversationId.includes(":sub:")) {
  const toolInput = toolCall.arguments ?? toolCall.toolInput ?? {};
  void handleSpawnSubagents({ conversationId, tasks: toolInput.tasks });
}
```

如果对话 ID 包含 `:sub:`，说明它已经是子代理，生成请求会被静默忽略。

## 子代理事件订阅

子代理也需要适配 Pi 的嵌套事件结构:

```javascript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent?.type === "text_delta") {
        emit(parentConversationId, "subagent_delta", {
          subId: index,
          delta: event.assistantMessageEvent.delta,
        });
      }
      break;
    case "message_end":
      if (event.message?.role === "assistant") {
        const content = extractTextContent(event.message);
        emit(parentConversationId, "subagent_done", { subId: index, content });
        settle(content);
      }
      break;
  }
});
```

## 与其他平台的对比

### Codex (扁平 + 顺序交接)

- 6 个并发代理 (可配置 `max_subagents`)
- 最大深度 1 (可配置 `max_depth`)
- Symphony SPEC.md 编排多代理工作流
- 3 个内置代理角色 + 自定义 TOML 定义角色

### Claude Code (5 层嵌套 + 工作流)

- 子代理最多嵌套 5 层
- Workflow 工具: 确定性 JS 脚本编排最多 1000 个代理
- 每个工作流 16 个并发代理
- `pipeline()` 用于流式扇出，`parallel()` 用于屏障同步
- 5 个内置角色 (Explore, Plan, code-reviewer, fork, statusline-setup)

### MilkSU (扁平 + 工具即触发器)

- 4 个并发代理
- 最大深度 1 (通过递归守卫硬性限制)
- 工具即触发器模式 (无专用编排语言)
- 统一代理角色 (无角色特化)

## 事件协议

| 事件 | 载荷 | 触发时机 |
|------|------|----------|
| `subagents_start` | `{ id, count }` | 批次已生成 |
| `subagent_delta` | `{ id, subId, delta }` | 子代理流式文本输出 |
| `subagent_done` | `{ id, subId, content }` | 单个子代理完成 |
| `subagents_done` | `{ id, results: [{subId, content}] }` | 所有子代理完成 |

## 前端渲染

结果在聊天中以可折叠的 `SubagentToolMessage` 卡片形式呈现:

- 每张卡片显示子代理的索引和流式输出
- 卡片可独立展开/折叠
- 状态指示器显示运行中/已完成/错误
- 所有卡片归组在父工具调用下
- `useAgentEvents` hook 监听 `subagents-start`/`subagent-delta`/`subagents-done` Tauri 事件
