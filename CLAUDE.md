# MilkSU

Pi agent harness extension for pluggable AI skills, with a Tauri v2 native desktop client.

## Rules

- No emoji anywhere: code, comments, docs, UI text, commit messages.
- Communicate in Chinese.
- Explain Agent Harness concepts during development for interview/presentation prep.

## Architecture

```
milksu/
  bridge.js                     # Node.js bridge: Pi agent <-> Rust IPC
  app/                          # Tauri v2 desktop client
    src/                        #   React frontend (TypeScript)
      App.tsx                   #     Root: state, IPC, persistence, task type routing
      components/
        Sidebar.tsx             #     Conversation list with task-type icons, search, delete
        ChatView.tsx            #     Welcome page (task type selector) + chat + model selector
        TaskPanel.tsx           #     Security task panels (pentest/ctf/recon/reverse)
        OutputPanel.tsx         #     Tool output side panel (for chat-type conversations)
        SettingsPage.tsx        #     Full-page settings with shadcn/ui (General, API Keys, Usage, About)
        ModelSelector.tsx       #     Dropdown model switcher (in input bar)
        ui/                     #     shadcn/ui components (Button, Card, Switch, Input, Badge, Separator, Label)
      lib/utils.ts              #     cn() utility (clsx + tailwind-merge)
      types.ts                  #     TaskType, TaskState, Message, Conversation, AppSettings, UsageData, PROVIDERS
      tauri.ts                  #     IPC wrapper: native Tauri or localStorage stubs for browser preview
      index.css                 #     Tailwind v4 + shadcn theme (oklch variables, Geist font)
    src-tauri/                  #   Rust backend
      src/lib.rs                #     IPC commands, bridge process management
      src/settings.rs           #     Settings persistence (JSON file)
      src/storage.rs            #     Conversation persistence (JSON files)
      src/main.rs               #     Entry point
      capabilities/default.json #     IPC + event permission grants
      tauri.conf.json           #     Window config (1200x800), build config
    components.json             #   shadcn/ui config (base-nova style, Vite framework)
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
  -> Rust send_message(): spawn/reuse bridge.js subprocess
  -> bridge.js: Pi createAgentSession() -> session.prompt()
  -> Pi agent streams events to stdout (JSON lines)
  -> Rust reads stdout, emits "agent-message" Tauri events
  -> React listen("agent-message") -> render streaming in ChatView
  -> Conversation auto-saved to ~/Library/Application Support/com.milksu.app/conversations/
```

## Task Type System

Each conversation binds to a task type at creation time:

| Type | Panel | State Tracks |
|------|-------|-------------|
| chat | none (OutputPanel for tool results) | messages only |
| pentest | PentestPanel | target, phase (6 stages), vulnerabilities, ports, tools used |
| ctf | CtfPanel | challenge, category, points, flags, solved status |
| recon | ReconPanel | scope, hosts, ports/services, findings |
| reverse | ReversePanel | binary, arch, protections (NX/canary/PIE/RELRO), functions, findings |

- Welcome page shows task type selector (color-coded pills with lucide icons)
- Sidebar shows task type icon per conversation
- Chat header shows task type badge
- Task panel overlays chat area from the right (does not squeeze chat layout)
- Panel button in chat header toggles the panel

## Current Progress

### Done

- [x] Tauri v2 project scaffolding (React + Rust + Vite)
- [x] Codex-style UI: centered welcome page, sidebar, chat view
- [x] Light/white theme with Geist font
- [x] Custom app icon (transparent background, Dock only)
- [x] Frontend-backend IPC wired: invoke + event channel
- [x] Tauri v2 capabilities/permissions configured
- [x] Pi extension skeleton: skill-loader, skill-router, policy-engine
- [x] Three skills: hello-world, browser-connect, network-recon
- [x] Bridge.js: Node.js subprocess calling Pi createAgentSession()
- [x] Streaming text output: assistant_delta events -> incremental render
- [x] Settings page: full-page layout with shadcn/ui (General, API Keys, Usage, About)
- [x] Model selector: dropdown in input bar, per-provider model list
- [x] Conversation persistence: auto-save to JSON files, load on startup
- [x] Sidebar search: filter conversations by title/content
- [x] Conversation delete: hover X button on sidebar items
- [x] Tool result rendering: collapsible cards with status indicator
- [x] Usage statistics panel: estimated tokens, real-time metrics placeholders, provider status
- [x] Browser-preview fallback: `npm run dev` works outside Tauri using localStorage stubs
- [x] shadcn/ui migration: Button, Card, Switch, Input, Badge, Separator, Label + lucide icons
- [x] Task type system: per-conversation task type (chat/pentest/ctf/recon/reverse)
- [x] Security panels: pentest (phase tracker, vulns, ports), CTF (flags, solved), recon (hosts, services), reverse (protections, functions)
- [x] Task panel overlay layout: floats over chat area, does not squeeze content

### In Progress

- [ ] End-to-end test with real API key (DeepSeek)
  - bridge.js + Pi session verified working
  - Needs user to fill API key in Settings page

### Planned

- [ ] Wire task panel state: agent tool results populate panel fields (target, vulns, ports, flags)
- [ ] Subagents: parallel task execution (both Codex and Claude Code have this)
- [ ] Hooks/lifecycle: policy-engine.ts real implementation (PreToolUse, Stop, Notification)
- [ ] Auto mode: permission classification for security tools
- [ ] Long-running tasks: /goal-like autonomous scans
- [ ] Conversation branching: /fork-like attack path exploration
- [ ] Vision loop: browser_vision_act tool using VL model
- [ ] Export: conversation history, scan reports (deprioritized)

## Dev

```bash
# Browser-only frontend preview (uses localStorage stubs, no agent bridge)
cd app && npm run dev

# Start Tauri dev (Vite + Rust hot reload)
cd app && npx tauri dev

# Frontend build/lint checks
cd app && npm run build && npm run lint

# Build for production
cd app && npx tauri build
```

## Settings Storage

- Settings: `~/Library/Application Support/com.milksu.app/settings.json`
- Conversations: `~/Library/Application Support/com.milksu.app/conversations/*.json`
- API keys are stored locally, passed to bridge.js as environment variables

## Supported Providers

| Provider | Env Var | Default Model |
|----------|---------|---------------|
| DeepSeek (default) | DEEPSEEK_API_KEY | deepseek-chat |
| Anthropic | ANTHROPIC_API_KEY | claude-sonnet-4-20250514 |
| OpenAI | OPENAI_API_KEY | gpt-4o |
| Google Gemini | GEMINI_API_KEY | gemini-2.5-flash |
| Groq | GROQ_API_KEY | llama-3.3-70b-versatile |

## Feature Gap vs Commercial Platforms

Based on analysis of Codex and Claude Code capabilities (see ~/Downloads/agent-harness-talk_7.html):

| Capability | Codex | Claude Code | MilkSU |
|-----------|-------|-------------|--------|
| Project rules | AGENTS.md | CLAUDE.md | SKILL.md |
| Skills | Skills | Skills (.claude/skills/) | Pi skill system |
| Subagents | 6 concurrent | 5 layers + Workflows | Planned |
| Auto execution | Permission Profiles | Auto Mode (classifier) | Planned |
| Lifecycle hooks | PostToolUse (limited) | Hooks (Pre/Stop/Notification) | policy-engine stub |
| Browser | Computer Use + Chrome ext | Computer Use + Chrome ext | Planned |
| Long tasks | /goal | -- | Planned |
| Fork | /fork | -- | Planned |
| Scheduled | Automations | CLI headless + GH Action | -- |
| Plugins | -- | Plugin marketplace | Pi extension system |
| MCP | MCP | MCP | Pi native |

## Key Concepts (Agent Harness)

This section documents Agent Harness patterns for interview/presentation reference.

### Tauri IPC dual-channel

- **invoke**: Frontend -> Backend request-response (like HTTP POST). Used for user actions.
- **emit/listen**: Backend -> Frontend event push (like WebSocket). Used for streaming agent output.
- This maps well to agent workloads: user sends prompt (invoke), agent produces multiple outputs over time (emit).

### Agent subprocess bridge pattern

- Rust (host process): window management, security sandbox, process lifecycle
- Node.js (agent process): LLM interaction, tool execution, extension loading
- Communication: stdin/stdout JSON lines (simple, no dependency, cross-platform)
- Same architecture as LSP: editor spawns language server via stdio JSON-RPC

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

### Task-Type-Aware Chat (MilkSU-specific)

- Each conversation carries a `taskType` field persisted to JSON
- ChatView renders task-specific placeholder text and description on the welcome page
- TaskPanel component dispatches to type-specific sub-panels (PentestPanel, CtfPanel, etc.)
- Panel state (`TaskState` union type) tracks domain-specific data structures
- The panel overlays the chat area (position: absolute) to avoid squeezing the chat layout
- This pattern maps well to the Agent Harness concept: the harness (panel) provides context and structure, while the agent (chat) provides intelligence

### Tool Result Dual-Channel

- `content`: Text for LLM reasoning (the agent reads this)
- `details`: Structured data for UI rendering (the frontend renders this)
- This separation lets the same tool call serve both the agent's decision-making and the user's visual feedback.

### Streaming Architecture

- Bridge.js subscribes to Pi session events: text_delta, thinking_delta, toolcall_start/end, done, error
- Each event is a JSON line with `type`, `id` (conversation), and event-specific fields
- Rust reads stdout line-by-line, maps to AgentMessage struct, emits to frontend
- Frontend accumulates text_delta into a running assistant message, finalizes on message_done
- This gives real-time character-by-character output like ChatGPT/Claude
