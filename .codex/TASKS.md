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

---

## Task S3: Wire Task Panels — Agent-to-Panel Event Pipeline

### Context
The app has TaskPanel components (PentestPanel, CtfPanel, ReconPanel, ReversePanel) that display structured security data (targets, ports, vulnerabilities, flags, etc.). Currently these panels are empty because nothing populates `conversation.taskState`.

S3 adds a `panel_update` Pi tool that the agent can call to push structured data into the panel. The event flows through the full pipeline: Pi agent -> bridge.js -> Rust -> React state -> TaskPanel UI.

This is the "Tool Result Dual-Channel" pattern: the tool returns minimal text to the LLM ("Panel updated.") while its structured input flows through a side-channel to update the UI.

### Architecture

```
Agent calls panel_update({ set_fields: { target: "10.0.0.1" }, append_items: { ports: [...] } })
  -> Pi executes tool, emits toolcall_end event
  -> bridge.js detects toolName === "panel_update", emits "panel_update" JSON line
  -> Rust parses "panel_update" event, emits Tauri "panel-update" event
  -> React listener merges payload into conversation.taskState
  -> TaskPanel re-renders with new data
```

### What to do

#### 1. Create `skills/panel/SKILL.md`

```markdown
---
name: panel-update
description: Update the task panel UI with structured security data. Always available. Use this to populate panel fields as you discover targets, ports, vulnerabilities, flags, and other findings during security tasks.
triggerKeywords: [panel, update, target, finding, result]
---

# Panel Update Skill

Provides the `panel_update` tool for pushing structured data to the task panel sidebar.

## When to use

Call `panel_update` whenever you discover actionable information during a security task:
- Set the target when the user specifies one
- Append ports after a port scan
- Append vulnerabilities after discovering one
- Update the phase as work progresses
- Add flags in CTF challenges

## Field reference by task type

### pentest
- `target` (string): the target IP/hostname
- `phase` (number 0-5): current workflow phase index
- `vulnerabilities` (array): `{ severity, title, detail? }`
- `ports` (array): `{ port, service, state }`
- `tools_used` (array of strings)

### ctf
- `challenge` (string): challenge name
- `category` (string): challenge category
- `points` (number | null)
- `flags` (array of strings)
- `hints` (array of strings)
- `solved` (boolean)

### recon
- `scope` (array of strings)
- `hosts` (array): `{ ip, hostname?, os? }`
- `ports` (array): `{ host, port, service, version? }`
- `findings` (array of strings)

### reverse
- `binary` (string): binary file path
- `arch` (string): architecture
- `protections` (object): `{ nx, canary, pie, relro }`
- `functions` (array): `{ name, address, note? }`
- `findings` (array of strings)
```

#### 2. Create `skills/panel/tools/update.ts`

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default defineTool({
  name: "panel_update",
  label: "Update Task Panel",
  description:
    "Push structured data to the task panel sidebar. Use set_fields to overwrite scalar values (target, phase, binary, solved). Use append_items to add entries to array fields (ports, vulnerabilities, flags, hosts, findings, functions, tools_used, scope, hints). Both parameters are optional but at least one must be provided.",
  parameters: Type.Object({
    set_fields: Type.Optional(
      Type.Record(Type.String(), Type.Any(), {
        description:
          "Key-value pairs to set (overwrites). Example: { target: '10.0.0.1', phase: 2 }",
      })
    ),
    append_items: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Array(Type.Any()),
        {
          description:
            "Key-array pairs to append. Example: { ports: [{ port: 22, service: 'ssh', state: 'open' }] }",
        }
      )
    ),
  }),
  async execute(_toolCallId, params) {
    const fieldCount = Object.keys(params.set_fields ?? {}).length;
    const appendCount = Object.values(params.append_items ?? {}).reduce(
      (sum, arr) => sum + arr.length,
      0
    );
    return {
      content: [
        {
          type: "text",
          text: `Panel updated: ${fieldCount} field(s) set, ${appendCount} item(s) appended.`,
        },
      ],
      details: {
        panel_update: true,
        set_fields: params.set_fields ?? {},
        append_items: params.append_items ?? {},
      },
    };
  },
});
```

#### 3. Modify `bridge.js`

In the `session.subscribe()` callback, add a check for `panel_update` in the `toolcall_end` case. When the tool name is `"panel_update"`, emit an additional `panel_update` event with the tool input:

```javascript
case "toolcall_end":
  // Check if this is a panel_update tool call -- emit dedicated event
  if (event.toolCall?.toolName === "panel_update") {
    const input = event.toolCall?.toolInput ?? {};
    emit("panel_update", {
      set_fields: input.set_fields ?? {},
      append_items: input.append_items ?? {},
    });
  }
  // Always emit the regular tool_call_end too
  emit("tool_call_end", {
    toolName: event.toolCall?.toolName,
    toolInput: event.toolCall?.toolInput,
  });
  break;
```

#### 4. Modify `app/src-tauri/src/lib.rs`

**a.** Add a new Tauri event struct:

```rust
#[derive(Clone, Serialize)]
struct PanelUpdateMessage {
    conversation_id: String,
    set_fields: serde_json::Value,
    append_items: serde_json::Value,
}
```

**b.** Add fields to `BridgeEvent`:

```rust
#[derive(Deserialize)]
struct BridgeEvent {
    // ... existing fields ...
    set_fields: Option<serde_json::Value>,
    append_items: Option<serde_json::Value>,
}
```

**c.** Add a match arm in the stdout reader thread (in `ensure_bridge`), before the `_ => {}` default:

```rust
"panel_update" => {
    let _ = app_clone.emit(
        "panel-update",
        PanelUpdateMessage {
            conversation_id: conv_id,
            set_fields: event.set_fields.unwrap_or(serde_json::Value::Object(Default::default())),
            append_items: event.append_items.unwrap_or(serde_json::Value::Object(Default::default())),
        },
    );
}
```

#### 5. Modify `app/src/App.tsx`

**a.** Add a `PanelUpdateEvent` interface near the top:

```typescript
interface PanelUpdateEvent {
  conversation_id: string
  set_fields: Record<string, unknown>
  append_items: Record<string, unknown[]>
}
```

**b.** Import the empty state constants:

```typescript
import type { Conversation, Message, AppSettings, TaskType, TaskState, EngagementSummary } from './types'
import { EMPTY_PENTEST, EMPTY_CTF, EMPTY_RECON, EMPTY_REVERSE } from './types'
```

**c.** Add a helper function to get the empty state for a task type:

```typescript
function emptyStateFor(taskType: TaskType): TaskState | undefined {
  switch (taskType) {
    case 'pentest': return { ...EMPTY_PENTEST }
    case 'ctf': return { ...EMPTY_CTF }
    case 'recon': return { ...EMPTY_RECON }
    case 'reverse': return { ...EMPTY_REVERSE }
    default: return undefined
  }
}
```

**d.** Add a helper function to merge panel updates into task state:

```typescript
function mergePanelUpdate(
  current: TaskState | undefined,
  taskType: TaskType,
  setFields: Record<string, unknown>,
  appendItems: Record<string, unknown[]>,
): TaskState | undefined {
  const base = current ?? emptyStateFor(taskType)
  if (!base) return undefined

  const merged = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(setFields)) {
    merged[key] = value
  }

  for (const [key, items] of Object.entries(appendItems)) {
    const existing = Array.isArray(merged[key]) ? (merged[key] as unknown[]) : []
    merged[key] = [...existing, ...items]
  }

  return merged as TaskState
}
```

**e.** Add a useEffect to listen for `panel-update` events (place it right after the existing `agent-message` useEffect):

```typescript
useEffect(() => {
  const unlisten = listenEvent<PanelUpdateEvent>('panel-update', (event) => {
    const { conversation_id, set_fields, append_items } = event.payload

    setConversations(prev => {
      const updated = prev.map(c => {
        if (c.id !== conversation_id) return c
        const newState = mergePanelUpdate(c.taskState, c.taskType, set_fields, append_items)
        return { ...c, taskState: newState }
      })

      const conv = updated.find(c => c.id === conversation_id)
      if (conv) persistConversation(conv)

      return updated
    })
  })
  return () => { unlisten.then(fn => fn()) }
}, [persistConversation])
```

**f.** Auto-open the task panel when a panel update arrives. In the `panel-update` listener, after updating conversations, also set `showTaskPanel(true)` if the updated conversation is the active one and its taskType is not 'chat':

```typescript
// Inside the panel-update listener, after setConversations:
if (conversation_id === activeId) {
  setShowTaskPanel(true)
}
```

Note: The `activeId` reference needs to be stable. Use a ref or include it in the dependency array. The cleanest approach: use a ref for activeId:

Add near the top of the App component:
```typescript
const activeIdRef = useRef(activeId)
activeIdRef.current = activeId
```

Then in the panel-update listener, use `activeIdRef.current` instead of `activeId`.

### Files

| File | Action |
|------|--------|
| `skills/panel/SKILL.md` | Create |
| `skills/panel/tools/update.ts` | Create |
| `bridge.js` | Modify: add panel_update event emission in toolcall_end |
| `app/src-tauri/src/lib.rs` | Modify: add PanelUpdateMessage struct, BridgeEvent fields, panel_update handler |
| `app/src/App.tsx` | Modify: add panel-update listener, mergePanelUpdate helper, emptyStateFor helper, auto-open panel |

### Do NOT modify
- `app/src/components/TaskPanel.tsx` -- it already renders all fields from taskState correctly
- `app/src/types.ts` -- TaskState types and EMPTY_* constants are already defined
- `app/src/tauri.ts` -- the existing `listenEvent` function works for the new event
- `app/src-tauri/src/storage.rs` -- `task_state` is already `Option<serde_json::Value>` and serialized

### Acceptance criteria
- `cargo build` succeeds in `app/src-tauri/`
- `npm run build` succeeds in `app/`
- The `panel_update` tool definition loads when the Pi extension starts (the skill-loader finds `skills/panel/SKILL.md` and loads `skills/panel/tools/update.ts`)
- bridge.js emits `panel_update` JSON lines when the tool is called
- Rust forwards `panel-update` Tauri events to the frontend
- App.tsx merges `set_fields` (overwrite) and `append_items` (append to arrays) into `conversation.taskState`
- TaskPanel auto-opens when a panel update arrives for the active conversation
- Updated taskState persists to disk via `save_conversation`
