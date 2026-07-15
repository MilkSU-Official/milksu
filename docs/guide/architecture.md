# 架构

本页描述当前 Tauri 桌面宿主的物理结构。MilkSU 的核心目标架构是“控制面、领域面、执行面”分层，详见[开发者架构](/developer/architecture)。三进程、IPC 和 UI 是宿主实现，不等同于产品差异化本身。

## 目录结构

```
milksu/
  bridge.js                     # Node.js bridge: Pi agent <-> Rust IPC (380 LOC)
  app/                          # Tauri v2 desktop client
    src/                        #   React frontend (TypeScript)
      App.tsx                   #     Root: layout, routing, settings
      hooks/
        useConversations.ts     #     Conversation CRUD, persistence, panel merge
        useAgentEvents.ts       #     agent-message + panel-update + subagent events
        useDerivedState.ts      #     Derive TaskState from Engagement data
      components/
        Sidebar.tsx             #     Conversation list, search, delete
        ChatView.tsx            #     Welcome page, chat, model selector
        TaskPanel.tsx           #     Security task panels
        OutputPanel.tsx         #     Tool output side panel
        SettingsPage.tsx        #     Full-page settings (shadcn/ui)
        ModelSelector.tsx       #     Dropdown model switcher
        EngagementSelector.tsx  #     Engagement picker with create dialog
        ui/                     #     shadcn/ui components
      i18n/                     #   Internationalization (en/zh)
      types.ts                  #   Type definitions
      tauri.ts                  #   IPC wrapper (native + browser stubs)
    src-tauri/                  #   Rust backend
      src/lib.rs                #     IPC commands, bridge management
      src/settings.rs           #     Settings persistence
      src/engagement.rs         #     Engagement CRUD
      src/storage.rs            #     Conversation persistence
  src/                          # Pi extension (TypeScript)
    index.ts                    #   Extension entry point
    skill-loader.ts             #   Skill discovery
    skill-router.ts             #   Routing prompt, keyword matching
    policy-engine.ts            #   Tool call interception (stub)
  skills/                       # Skill plugins
    hello-world/                #   Demo skill
    browser-connect/            #   Browser automation (6 tools)
    network-recon/              #   Network scanning (3 tools)
    panel/                      #   Panel update tool
    subagent/                   #   Sub-agent spawning tool
```

## 三进程架构

```
┌──────────────┐    IPC (invoke/emit)    ┌──────────────┐
│  React       │ <--------------------> │  Rust        │
│  Frontend    │    Tauri events         │  Host        │
│  (TypeScript)│                         │  (lib.rs)    │
└──────────────┘                         └──────┬───────┘
                                                │ stdin/stdout
                                                │ JSON lines
                                         ┌──────┴───────┐
                                         │  Node.js     │
                                         │  Bridge      │
                                         │  (bridge.js) │
                                         └──────┬───────┘
                                                │ Pi SDK
                                         ┌──────┴───────┐
                                         │  LLM API     │
                                         │  (provider)  │
                                         └──────────────┘
```

### 为什么采用三进程？

| 进程 | 职责 | 为什么要独立？ |
|------|------|---------------|
| React | UI 渲染、状态管理 | Web 技术栈，支持热重载 |
| Rust | 窗口管理、IPC、进程生命周期 | 安全沙箱，原生性能 |
| Node.js | LLM 会话、工具执行、扩展加载 | Pi SDK 需要 Node.js 运行时 |

这与 LSP（语言服务器协议）模式一致：编辑器（Rust）通过 stdio JSON-RPC 启动语言服务器（Node.js 桥接）。

## 通信通道

### Tauri IPC 双通道

- **invoke**：前端 -> 后端的请求-响应模式（类似 HTTP POST）。用于用户操作（发送消息、保存设置）。
- **emit/listen**：后端 -> 前端的事件推送模式（类似 WebSocket）。用于流式代理输出。

这与代理工作负载天然契合：用户发送提示词（invoke），代理随时间持续产出多个输出（emit）。

### 桥接 stdio 协议

桥接通过 stdin/stdout 上的 JSON 行 (JSON Lines) 进行通信：

```json
// 命令 (Rust -> Bridge)
{"type": "create_session", "conversationId": "abc", "model": "deepseek-chat", "provider": "deepseek"}

// 事件 (Bridge -> Rust)
{"type": "text_delta", "id": "abc", "content": "Hello"}
{"type": "toolcall_start", "id": "abc", "toolName": "shell", "content": "Running..."}
{"type": "message_done", "id": "abc", "content": "Done."}
```

核心事件包括：`text_delta`、`thinking_delta`、`tool_call_start`、`tool_call_end`、`panel_update`、`message_done`、`error`、`subagents_start`、`subagent_delta`、`subagent_done`、`subagents_done`。协议以 `docs/developer/bridge.md` 的事件表为准。
