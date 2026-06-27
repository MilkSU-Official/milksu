# MilkSU

Pi agent harness extension for pluggable AI skills, with a Tauri v2 native desktop client.

## Rules

- No emoji anywhere: code, comments, docs, UI text, commit messages.
- Communicate in Chinese.
- Explain Agent Harness concepts during development for interview/presentation prep.

## Architecture

```
milksu/
  app/                          # Tauri v2 desktop client
    src/                        #   React frontend (TypeScript)
      App.tsx                   #     Root: conversation state, Tauri IPC
      components/
        Sidebar.tsx             #     Conversation list, search
        ChatView.tsx            #     Welcome page + chat view
        OutputPanel.tsx         #     Tool output side panel
      types.ts                  #     Message, Conversation types
      index.css                 #     Light theme, Tailwind
    src-tauri/                  #   Rust backend
      src/lib.rs                #     send_message command, agent-message event
      src/main.rs               #     Entry point
      capabilities/default.json #     IPC permission grants
      tauri.conf.json           #     Window config, build config
  src/                          # Pi extension (TypeScript)
    index.ts                    #   Extension entry: hooks, tool registration
    skill-loader.ts             #   Scan skills/ for SKILL.md + tools
    skill-router.ts             #   Build routing prompt, keyword matching
    policy-engine.ts            #   Tool call interception
    interruption.ts             #   Human-in-the-loop approval
    types.ts                    #   MilkSUSkillManifest, LoadedSkill, etc.
  skills/                       # Skill plugins
    hello-world/                #   Demo skill
    browser-connect/            #   Browser automation for pentest
    network-recon/              #   Network scanning (nmap, report)
```

## Data Flow

```
User input
  -> React invoke("send_message", {conversationId, prompt})
  -> Rust #[tauri::command] send_message()
  -> (TODO) spawn Node.js subprocess -> Pi agent session
  -> app.emit("agent-message", payload)
  -> React listen("agent-message") -> render in ChatView
```

## Current Progress

### Done

- [x] Tauri v2 project scaffolding (React + Rust + Vite)
- [x] Codex-style UI: centered welcome page, sidebar, chat view
- [x] Light/white theme throughout
- [x] Custom app icon (transparent background, Dock only)
- [x] Frontend-backend IPC wired: invoke + event channel
- [x] Mock agent response (send message -> see reply)
- [x] Pi extension skeleton: skill-loader, skill-router, policy-engine
- [x] Three skills: hello-world, browser-connect, network-recon
- [x] Tauri v2 capabilities/permissions configured

### In Progress

- [ ] Connect Rust backend to Pi agent (spawn Node.js subprocess)
  - Rust uses Command to spawn `node bridge.js`
  - bridge.js imports Pi agent core, runs agent loop
  - Communication via stdin/stdout JSON line protocol
  - Each agent event (assistant message, tool call, tool result) emits back to frontend

### Planned

- [ ] Streaming output: show agent thinking and tool execution in real-time
- [ ] Tool result rendering: structured display for different tool types
- [ ] Conversation persistence: save/load from local storage or SQLite
- [ ] Search functionality in sidebar
- [ ] Security dashboard panels (pentest, CTF, reverse engineering)
- [ ] Vision loop: browser_vision_act tool using VL model
- [ ] Settings page: API key config, model selection, skill toggle
- [ ] Export: conversation history, scan reports

## Dev

```bash
# Start Tauri dev (Vite + Rust hot reload)
cd app && npx tauri dev

# Build for production
cd app && npx tauri build
```

## Key Concepts (Agent Harness)

This section documents Agent Harness patterns for interview/presentation reference.

### Tauri IPC dual-channel

- **invoke**: Frontend -> Backend request-response (like HTTP POST). Used for user actions.
- **emit/listen**: Backend -> Frontend event push (like WebSocket). Used for streaming agent output.
- This maps well to agent workloads: user sends prompt (invoke), agent produces multiple outputs over time (emit).

### Pi Extension System

- Default-exported async function receives `ExtensionAPI` object
- `pi.registerTool(definition)` with TypeBox schemas for type-safe tool parameters
- `pi.on("resources_discover")` returns skill paths for SKILL.md progressive disclosure
- `pi.on("before_agent_start")` injects system prompt with skill routing context
- `pi.on("tool_call")` intercepts tool calls for policy enforcement

### Skill Architecture

Each skill is a directory with:
- `SKILL.md`: Declaration with YAML frontmatter (name, description, triggerKeywords)
- `tools/`: Tool definitions using `defineTool()` with TypeBox parameter schemas
- `prompts/`: Optional workflow prompts for complex operations

The skill-router builds a routing prompt listing available skills. Pi's agent sees this in its system prompt and selects appropriate tools based on user intent.

### Tool Result Dual-Channel

- `content`: Text for LLM reasoning (the agent reads this)
- `details`: Structured data for UI rendering (the frontend renders this)
- This separation lets the same tool call serve both the agent's decision-making and the user's visual feedback.
