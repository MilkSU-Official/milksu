# MilkSU Codex Tasks

## Task S0: Fix Agent Loop - Model/Provider Pass-through

### Context
MilkSU is a Tauri v2 desktop app (React + Rust). The agent runs in a Node.js subprocess (`bridge.js`) that communicates with the Rust backend via stdin/stdout JSON lines.

The pipeline: React `invoke("send_message")` -> Rust spawns bridge.js -> bridge.js creates Pi agent session -> agent streams responses -> Rust reads stdout -> emits Tauri events -> React renders.

### Problem
`bridge.js` creates the Pi session but does not use the model/provider selection from the user. The Rust `send_message` command already sends `model` and `provider` in the JSON message, but bridge.js ignores these fields and lets Pi auto-select.

### Pi API details (already verified)
- `createAgentSession()` returns `{ session }`.
- `session.modelRegistry` is a public getter returning the `ModelRegistry`.
- `session.modelRegistry.find(provider, modelId)` returns a Model object or `undefined`.
- `session.setModel(model)` switches the model mid-session (validates auth, updates session state).
- `session.model` returns the current model (has `.provider` and `.id` fields).
- Pi's built-in model IDs for our providers:
  - **deepseek**: `deepseek-v4-flash`, `deepseek-v4-pro`
  - **anthropic**: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-haiku-4-5-20251001`, `claude-opus-4-6`, etc
  - **openai**: `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
  - **google**: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-flash-preview`
  - **groq**: `llama-3.3-70b-versatile`, `qwen/qwen3-32b`

### What to do

#### 1. bridge.js - Model switching (lines 73-88)

In the `rl.on("line")` handler, before calling `session.prompt(msg.text)`:

```javascript
if (msg.model && msg.provider) {
  const desired = session.modelRegistry.find(msg.provider, msg.model);
  if (desired) {
    const current = session.model;
    if (!current || current.provider !== msg.provider || current.id !== msg.model) {
      try {
        await session.setModel(desired);
      } catch (err) {
        emit("error", { reason: "model_switch_failed", error: String(err) });
      }
    }
  }
}
```

No changes needed to `initSession()` -- Pi will auto-select based on available API keys, and we override on first prompt.

#### 2. types.ts - Update PROVIDERS model IDs to match Pi registry

Update the `PROVIDERS` array in `app/src/types.ts` (around line 153). Change only the `models` arrays:

```typescript
// DeepSeek: was ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
models: ['deepseek-v4-flash', 'deepseek-v4-pro'],

// Anthropic: was ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-opus-4-20250514']
models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],

// OpenAI: was ['gpt-4o', 'gpt-4o-mini', 'o3-mini']
models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],

// Google: keep ['gemini-2.5-flash', 'gemini-2.5-pro'] (already correct)

// Groq: was ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768']
models: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
```

Also update `active_model` default in `app/src-tauri/src/settings.rs` if it references old model IDs.

#### 3. settings.rs - Update default model ID

Check `settings.rs` for the default `active_model` value. If it says `deepseek-chat`, change it to `deepseek-v4-flash`.

### Files
- `bridge.js` (line 73-88: add model switching before prompt)
- `app/src/types.ts` (line 153-189: PROVIDERS model lists)
- `app/src-tauri/src/settings.rs` (default active_model value)

### Acceptance criteria
- bridge.js reads msg.model and msg.provider and calls session.setModel() when different from current
- PROVIDERS model IDs match Pi's built-in model registry
- Default model in settings.rs is a valid Pi model ID
- `npm run build` passes (frontend)
- `cargo build` passes (if settings.rs changed)

---

## Task S1: Engagement Memory - Rust Backend Integration

### Context
The engagement data model is already defined in `app/src-tauri/src/engagement.rs` with full struct definitions and Tauri command skeletons. The commands are already registered in `lib.rs`.

### What to do

1. Add `uuid` dependency to `app/src-tauri/Cargo.toml`:
   ```toml
   [dependencies]
   uuid = { version = "1", features = ["v4"] }
   ```

2. Add `dirs` dependency if not already present (check Cargo.toml first).

3. Fix the `now_iso()` function in `engagement.rs` to return proper ISO 8601 timestamps. Add `chrono` dependency:
   ```toml
   chrono = "0.4"
   ```
   Then use `chrono::Utc::now().to_rfc3339()`.

4. Add the engagement IPC permission to `app/src-tauri/capabilities/default.json`. Look at the existing format and add the new command names.

5. Create the frontend TypeScript types in `app/src/types.ts`. Add these types at the end of the file (DO NOT modify existing types):

   ```typescript
   export interface Engagement {
     id: string
     name: string
     scope: string[]
     status: 'active' | 'completed' | 'archived'
     created: string
     updated: string
     conversation_ids: string[]
     targets: EngagementTarget[]
     credentials: EngagementCredential[]
     attack_paths: AttackPath[]
     notes: string[]
   }

   export interface EngagementTarget {
     id: string
     type: 'host' | 'domain' | 'subnet' | 'url'
     value: string
     authorized: boolean
     hosts: EngagementHost[]
   }

   export interface EngagementHost {
     ip: string
     hostnames: string[]
     os: string | null
     status: string
     last_seen: string | null
     services: EngagementService[]
     vulnerabilities: EngagementVulnerability[]
   }

   export interface EngagementService {
     port: number
     protocol: string
     state: string
     service: string
     version: string | null
     banner: string | null
     notes: string[]
   }

   export interface EngagementVulnerability {
     id: string
     severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
     title: string
     description: string
     proof: string | null
     exploitable: boolean
     remediation: string | null
     references: string[]
   }

   export interface EngagementCredential {
     id: string
     username: string
     secret: string
     type: 'password' | 'hash' | 'privateKey' | 'token' | 'cookie'
     source: string
     valid: boolean
   }

   export interface AttackPath {
     id: string
     name: string
     impact: string
     steps: AttackStep[]
   }

   export interface AttackStep {
     order: number
     action: string
     target: string
     tool: string
     result: string
     timestamp: string
   }

   export interface EngagementSummary {
     id: string
     name: string
     status: 'active' | 'completed' | 'archived'
     updated: string
     host_count: number
     vuln_count: number
     cred_count: number
   }
   ```

6. Add IPC wrapper functions to `app/src/tauri.ts`. Follow the existing pattern in that file (it has a dual-mode system: native Tauri invoke for desktop, localStorage stubs for browser preview).

### Files
- `app/src-tauri/Cargo.toml` -- add uuid, chrono dependencies
- `app/src-tauri/src/engagement.rs` -- fix now_iso()
- `app/src-tauri/capabilities/default.json` -- add permissions
- `app/src/types.ts` -- add Engagement types (append, don't modify existing)
- `app/src/tauri.ts` -- add IPC wrappers

### Acceptance criteria
- `cargo build` succeeds in `app/src-tauri/`
- Engagement CRUD commands are callable from frontend
- Browser preview mode has localStorage fallback for engagement operations

---

## Task S2: Engagement Selector UI Component

### Context
The app needs a way for users to create and select engagements. This should appear in the sidebar or as a dropdown in the chat header for security task types (pentest/recon/ctf/reverse).

### What to do

1. Create `app/src/components/EngagementSelector.tsx`:
   - A dropdown/select component showing available engagements
   - "New Engagement" button that shows a dialog to create one (name + scope fields)
   - Shows engagement status badge (active/completed/archived)
   - Only visible for non-chat task types

2. Integrate into `ChatView.tsx`:
   - Show EngagementSelector in the chat header area, next to the task type badge
   - When an engagement is selected, store the engagement ID in the conversation state

3. Style: use existing shadcn/ui components (Button, Card, Input, Badge from `app/src/components/ui/`). Follow the existing design language (Geist font, oklch colors, no emoji).

### Files
- `app/src/components/EngagementSelector.tsx` (new)
- `app/src/components/ChatView.tsx` (modify: add EngagementSelector)
- `app/src/App.tsx` (modify: add engagement state management)

### Design reference
Look at `app/src/components/ModelSelector.tsx` for the dropdown pattern used in this project.

### Acceptance criteria
- Engagement selector appears for pentest/recon/ctf/reverse task types
- User can create new engagement with name and scope
- Selected engagement persists with conversation
- Browser preview mode works (localStorage fallback)
