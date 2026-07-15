# 桥接协议

桥接层 (Bridge, `bridge.js`) 是 Rust 宿主进程与 Pi 代理会话之间的核心协调器。它作为单个 Node.js 子进程运行，支持多路复用会话 (Multiplexed Sessions)。

## 生命周期

```
Rust starts bridge.js subprocess (with --experimental-strip-types)
  -> Bridge loads skills from skills/
  -> Bridge reads stdin for JSON commands
  -> Bridge writes stdout for JSON events
  -> One bridge process serves all conversations
  -> Each conversation gets its own Pi session with injected tools
```

## 启动

Tauri 在 `ensure_bridge()` 中以 `node --experimental-strip-types bridge.js` 启动桥接进程。`--experimental-strip-types` 标志使 Node.js 能直接 import TypeScript 技能文件。

启动后桥接层发出两个初始化事件:
1. `{"type":"ready","id":null}` -- 进程就绪
2. `{"type":"skills_loaded","id":null,"count":18,"skills":[...]}` -- 技能加载完成

## 命令 (Rust -> Bridge)

### create_session

```json
{
  "action": "create_session",
  "conversationId": "abc-123",
  "provider": "deepseek",
  "model": "deepseek-v4-flash"
}
```

创建 Pi 会话，通过 `customTools` 注入技能工具并设置模型。如果启用中继模式，会注册会话级 `milksu-relay` provider。

### send_message

```json
{
  "action": "send_message",
  "conversationId": "abc-123",
  "prompt": "Scan the target network"
}
```

向已有会话发送用户输入。

### destroy_session

```json
{
  "action": "destroy_session",
  "conversationId": "abc-123"
}
```

销毁会话并释放资源。

## 事件 (Bridge -> Rust)

| 事件 | 关键字段 | 描述 |
|------|----------|------|
| `ready` | id | 会话创建完成 (id=null 表示进程就绪) |
| `skills_loaded` | count, skills | 技能加载完成 |
| `text_delta` | id, delta | 增量文本输出 |
| `thinking_delta` | id, delta | 推理/思考输出 |
| `tool_call_start` | id, toolName | 工具调用开始 |
| `tool_call_end` | id, toolName, content, isError | 工具执行完成 |
| `panel_update` | id, set_fields, append_items | 面板状态变更 |
| `message_done` | id, reason, content | 完整消息完成 |
| `error` | id, reason, error | 发生错误 |
| `subagents_start` | id, count | 子代理批次已启动 |
| `subagent_delta` | id, subId, delta | 子代理流式输出 |
| `subagent_done` | id, subId, content | 子代理已完成 |
| `subagents_done` | id, results | 所有子代理已完成 |

## 技能注入

Pi 的扩展自动发现 (`DefaultResourceLoader`) 目前无法加载本项目的技能。桥接层采用手动注入方案:

```javascript
const { discoverSkills } = await import("./src/skill-loader.ts");
const skills = await discoverSkills(join(__dirname, "skills"));
const tools = skills.flatMap((s) => s.tools);

const { session } = await createAgentSession({ customTools: tools });
```

技能只加载一次 (`cachedSkillTools`)，所有会话共享同一份工具定义。

## Pi 事件结构

Pi 的 `session.subscribe()` 发出的事件采用嵌套结构:

```javascript
session.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      // 流式内容事件嵌套在 assistantMessageEvent 中
      const ae = event.assistantMessageEvent;
      // ae.type includes text_delta and thinking_delta
      break;
    case "tool_execution_start":
    case "tool_execution_end":
      // 工具的真实执行生命周期
      break;
    case "agent_end":
      // 一次 prompt 的完整代理循环结束
      break;
  }
});
```

工具调用事件的字段名:
- `ae.toolCall.name` (非 toolName)
- `ae.toolCall.arguments` (非 toolInput)
- `ae.partial.content[ae.contentIndex].name` (工具开始时的名称)

## 会话池

桥接层维护以对话 ID 为键的 `Map<string, PiSession>`:

```javascript
const sessions = new Map();
const promptQueues = new Map(); // serialize prompts per session
const sessionSettings = new Map(); // { provider, model }
```

每个会话有独立的 prompt 队列，保证同一会话内的消息按序执行。

## 中继模式

当桥接启动时启用了中继模式，会为每个会话注册一个使用 OpenAI Chat Completions 协议的临时 provider：

```javascript
session.modelRegistry.registerProvider("milksu-relay", {
  baseUrl: relayUrl,
  apiKey: relayKey,
  api: "openai-completions",
  models: [relayModel],
});
```

## 子代理生成

当父会话执行 `spawn_subagents` 工具时:

1. 桥接层把通用工具定义绑定到当前父会话
2. 从工具输入中解析最多 8 个任务
3. 按批次生成最多 4 个并发 Pi 会话 (每批 4 个)
4. 会话 ID 格式: `{conversationId}:sub:{index}`
5. 子代理工具集中移除 `spawn_subagents`，从能力层阻止递归生成
6. 子代理在 `agent_end` 后完成，所有结果既通过 `subagents_done` 更新 UI，也作为工具结果返回父代理继续推理
