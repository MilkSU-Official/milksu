# 宿主绑定工具与投影事件

## 问题

一个 LLM 工具调用有时需要宿主级协调，例如生成子代理或把结构化状态投影到界面。这里必须区分两种情况：

- **需要把结果返回给模型继续推理**：必须等待宿主操作完成，再走正常工具结果通道。
- **只更新界面投影**：可以旁路观察同一次工具执行，但旁路事件不能代替工具结果。

## 解决方案

MilkSU 在创建 Pi 会话时，通过公开的 `customTools` 参数把技能工具绑定到当前会话。对于 `spawn_subagents`，桥接层替换占位执行器并等待所有子代理完成：

```
LLM calls spawn_subagents
  -> Session-bound executor in bridge.js
  -> Spawn isolated Pi sessions
  -> Stream progress to UI
  -> Await all results
  -> Return results through Pi tool channel
```

```javascript
const tools = bindSkillTools(await loadSkillTools(), conversationId);
const { session } = await createAgentSession({ customTools: tools });
```

这样父代理在工具调用返回后能直接看到子代理结果，而不是只收到一句“正在生成”。

## 界面投影通道

`panel_update` 的参数还需要更新 Tauri 界面。桥接层观察 Pi 的 `tool_execution_start`，把同一份结构化参数发成 `panel_update` 事件：

```javascript
session.subscribe((event) => {
  if (event.type === "tool_execution_start" && event.toolName === "panel_update") {
    emit(conversationId, "panel_update", event.args);
  }
});
```

这条事件只服务 UI 投影。Pi 自己仍然执行工具并把结果放进模型上下文。

## 使用场景

| 工具 | 模型获得的结果 | 宿主侧行为 |
|------|---------------|------------|
| `panel_update` | 更新确认 | 发出 panel-update Tauri 投影事件 |
| `spawn_subagents` | 完整子代理结果 | 创建独立会话并流式更新 UI |

## 为什么不用其他方案？

### 为什么不能只拦截工具调用事件？

`toolcall_end` 只表示模型把工具参数生成完毕，不表示工具执行完成。如果在这个事件上异步启动子代理，父代理会先拿到占位结果并继续推理，真正结果只留在 UI，形成两个不一致的世界。

### 为什么不把桥接引用放进通用技能？

那会让技能依赖 Tauri/stdio 细节，失去可复用性。技能保留名称、描述和参数契约；桥接层只在桌面会话创建时绑定宿主实现。

- 技能契约不依赖宿主 IPC
- 宿主协调结果仍通过标准工具通道返回模型
- UI 进度事件与最终工具结果共享一次执行
- 子代理工具不会注入子代理会话，从能力层阻止递归

## 面试要点

此模式解决的问题是："宿主级操作如何既保留技能抽象，又成为模型可见、可等待、可审计的一次工具执行？"

关键点不是“看到工具调用就触发副作用”，而是明确区分执行通道和投影通道：执行结果决定代理下一步，投影事件只决定界面如何显示。
