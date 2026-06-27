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
      App.tsx                   #     Root: state, IPC, persistence
      components/
        Sidebar.tsx             #     Conversation list, search, delete
        ChatView.tsx            #     Welcome page + chat + model selector
        OutputPanel.tsx         #     Tool output side panel
        SettingsPage.tsx        #     Full-page settings with category sidebar
        ModelSelector.tsx       #     Dropdown model switcher (in input bar)
      types.ts                  #     Message, Conversation, AppSettings, UsageData, PROVIDERS
      index.css                 #     Light theme, Tailwind
    src-tauri/                  #   Rust backend
      src/lib.rs                #     IPC commands, bridge process management
      src/settings.rs           #     Settings persistence (JSON file)
      src/storage.rs            #     Conversation persistence (JSON files)
      src/main.rs               #     Entry point
      capabilities/default.json #     IPC + event permission grants
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
  -> Rust send_message(): spawn/reuse bridge.js subprocess
  -> bridge.js: Pi createAgentSession() -> session.prompt()
  -> Pi agent streams events to stdout (JSON lines)
  -> Rust reads stdout, emits "agent-message" Tauri events
  -> React listen("agent-message") -> render streaming in ChatView
  -> Conversation auto-saved to ~/Library/Application Support/com.milksu.app/conversations/
```

## Current Progress

### Done

- [x] Tauri v2 project scaffolding (React + Rust + Vite)
- [x] Codex-style UI: centered welcome page, sidebar, chat view
- [x] Light/white theme throughout
- [x] Custom app icon (transparent background, Dock only)
- [x] Frontend-backend IPC wired: invoke + event channel
- [x] Tauri v2 capabilities/permissions configured
- [x] Pi extension skeleton: skill-loader, skill-router, policy-engine
- [x] Three skills: hello-world, browser-connect, network-recon
- [x] Bridge.js: Node.js subprocess calling Pi createAgentSession()
- [x] Streaming text output: assistant_delta events -> incremental render
- [x] Settings page: API key config for 5 providers (DeepSeek, Anthropic, OpenAI, Google, Groq)
- [x] Model selector: dropdown in input bar, per-provider model list
- [x] Conversation persistence: auto-save to JSON files, load on startup
- [x] Sidebar search: filter conversations by title/content
- [x] Conversation delete: hover X button on sidebar items
- [x] Tool result rendering: collapsible cards with status indicator
- [x] Settings page redesign: full-page layout with category sidebar (General, API Keys, Usage, About)
- [x] Usage statistics panel: conversation/message/tool counts, estimated token count, real usage placeholders, provider status
- [x] Browser-preview fallback: `npm run dev` works outside Tauri using localStorage-backed settings/conversation stubs

### In Progress

- [ ] End-to-end test with real API key (DeepSeek)
  - bridge.js + Pi session verified working
  - Needs user to fill API key in Settings page

### Planned

- [ ] Security dashboard panels (pentest, CTF, reverse engineering)
- [ ] Vision loop: browser_vision_act tool using VL model
- [ ] Export: conversation history, scan reports

## Codex Handoff 2026-06-27

Codex made direct supervisory fixes after finding issues during QA. Claude should review these files before continuing and avoid overwriting them blindly:

- `app/src/tauri.ts`: Added a Tauri IPC wrapper. Native Tauri still uses real `invoke`/`listen`; browser-only `npm run dev` uses localStorage-backed settings and conversation stubs so UI QA does not white-screen outside the Tauri WebView.
- `app/src/App.tsx`: Switched Tauri IPC calls to the wrapper and kept the desktop runtime path intact.
- `app/src/components/SettingsPage.tsx`: Fixed responsive layout. Desktop keeps the full-page settings sidebar; narrow windows move settings navigation above content so labels, cards, and buttons do not overlap.
- `app/src/types.ts`: Added `UsageData` and `EMPTY_USAGE` placeholders for future real usage telemetry.
- `CLAUDE.md`, `TEST_PLAN.md`, `app/README.md`: Updated docs, browser-preview guidance, and verification steps.

Verification already run by Codex:

- `cd app && npm run build` passes.
- `cd app && npm run lint` passes.
- Browser preview at `http://127.0.0.1:1420/` renders without new console errors after a clean reload.
- Settings opens in browser preview without a blank page.
- Usage page clearly labels token counts as estimated and real metrics as unavailable.
- Narrow viewport around 390px wide keeps settings content readable.

Suggested commit message for this batch:

```text
feat(app): refine settings usage panel and browser preview fallback

- add Tauri IPC wrapper with browser-preview localStorage stubs
- clarify estimated versus real usage metrics
- make settings page responsive for narrow windows
- update README, CLAUDE notes, and UI test plan
```

Next phase ownership:

- shadcn/ui migration is owned by Claude. Codex did not initialize shadcn, did not add components, and should not touch shadcn configuration unless the user explicitly reassigns that work.
- Before starting shadcn work, Claude should inspect the current diff, decide whether to commit or preserve this batch, then plan the shadcn migration from the current working tree.

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
