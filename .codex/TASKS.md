# MilkSU Codex Tasks

> **Superseded implementation snapshot.** 本文件记录早期 S0-S5 的实施说明，不再是当前 TODO 或架构依据。它使用的固定 `taskType`、面板写入和 Security Kernel 假设已经被后续研究修正。继续任何任务前，必须先阅读 `docs/developer/security-agent-boundary.md` 理解当前目标，再阅读 `docs/progress/roadmap.md` 的“架构纠偏 TODO”确认落地优先级。

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

---

## Task S4: Browser CDP Enhancement -- Pentest-Focused Tools

### Context
The `skills/browser-connect/` skill connects to Chrome via CDP using Playwright. It already has 9 tools for basic browsing (connect, tabs, navigate, get_page, screenshot, click, type, evaluate). S4 adds 3 pentest-focused tools to give the agent the capabilities it needs for web application security testing.

All new tools go in `skills/browser-connect/tools/` and use the same `ensureConnected()` pattern from `connect.ts`. No changes to bridge.js, Rust, or the frontend are needed.

### What to do

#### 1. Create `skills/browser-connect/tools/analyze.ts`

A single tool `browser_analyze` that performs automated page security analysis. Returns structured data about the page's attack surface.

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

export const browserAnalyze = defineTool({
  name: "browser_analyze",
  label: "Browser Analyze",
  description:
    "Analyze the current page for security-relevant elements: forms (with hidden fields, CSRF tokens), links (internal/external), scripts (inline/external), cookies, meta tags, and response headers. Use this as a first step when assessing a web application page.",
  parameters: Type.Object({
    scope: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("forms"),
          Type.Literal("links"),
          Type.Literal("scripts"),
          Type.Literal("cookies"),
          Type.Literal("headers"),
          Type.Literal("storage"),
        ]),
        { description: "Which analyses to run (default: all)" }
      )
    ),
  }),
  async execute(_toolCallId, params) {
    const { page } = await ensureConnected();
    const scope = params.scope ?? ["forms", "links", "scripts", "cookies", "headers", "storage"];
    const result: Record<string, unknown> = {};

    if (scope.includes("forms")) {
      result.forms = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("form")).map((form) => ({
          action: form.action,
          method: form.method,
          id: form.id || null,
          inputs: Array.from(form.querySelectorAll("input, select, textarea")).map((el) => ({
            name: (el as HTMLInputElement).name,
            type: (el as HTMLInputElement).type,
            value: (el as HTMLInputElement).type === "hidden" ? (el as HTMLInputElement).value : null,
          })),
        }));
      });
    }

    if (scope.includes("links")) {
      result.links = await page.evaluate(() => {
        const origin = window.location.origin;
        return Array.from(document.querySelectorAll("a[href]")).map((a) => {
          const href = (a as HTMLAnchorElement).href;
          return {
            href,
            text: (a as HTMLAnchorElement).innerText.trim().slice(0, 80),
            external: !href.startsWith(origin),
          };
        });
      });
    }

    if (scope.includes("scripts")) {
      result.scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("script")).map((s) => ({
          src: s.src || null,
          inline: !s.src,
          length: s.src ? null : s.textContent?.length ?? 0,
          type: s.type || null,
          nonce: s.nonce || null,
        }));
      });
    }

    if (scope.includes("cookies")) {
      const cookies = await page.context().cookies();
      result.cookies = cookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
      }));
    }

    if (scope.includes("headers")) {
      // Get response headers from the main document by re-fetching the URL
      // via the CDP session to read headers without navigating
      result.headers = await page.evaluate(() => {
        const meta: Record<string, string> = {};
        document.querySelectorAll("meta").forEach((m) => {
          const name = m.getAttribute("name") || m.getAttribute("http-equiv");
          const content = m.getAttribute("content");
          if (name && content) meta[name] = content;
        });
        return meta;
      });
    }

    if (scope.includes("storage")) {
      result.storage = await page.evaluate(() => {
        const ls: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) ls[key] = localStorage.getItem(key)?.slice(0, 200) ?? "";
        }
        const ss: Record<string, string> = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) ss[key] = sessionStorage.getItem(key)?.slice(0, 200) ?? "";
        }
        return { localStorage: ls, sessionStorage: ss };
      });
    }

    const url = page.url();
    const title = await page.title();
    const text = JSON.stringify(result, null, 2);

    return {
      content: [{ type: "text", text: `Page analysis for [${title}] (${url}):\n\n${text}` }],
      details: { url, title, ...result },
    };
  },
});
```

#### 2. Create `skills/browser-connect/tools/intercept.ts`

Request interception tool using Playwright's `page.route()`. The agent can set up rules to log, block, or modify requests.

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";
import type { Route, Request } from "playwright-core";

interface InterceptedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  resourceType: string;
  timestamp: number;
}

const interceptLog: InterceptedRequest[] = [];
let interceptActive = false;

export const browserIntercept = defineTool({
  name: "browser_intercept",
  label: "Browser Intercept",
  description:
    "Start or stop HTTP request interception on the current page. When active, all requests are logged. Optionally block requests by URL pattern or modify request headers. Call with action 'start' to begin, 'stop' to end and get the log, or 'log' to read the current log without stopping.",
  parameters: Type.Object({
    action: Type.Union(
      [Type.Literal("start"), Type.Literal("stop"), Type.Literal("log")],
      { description: "start: begin intercepting, stop: end and return log, log: read log" }
    ),
    blockPatterns: Type.Optional(
      Type.Array(Type.String(), {
        description: "URL substrings to block (e.g., ['analytics', 'tracking']). Only used with 'start'.",
      })
    ),
    modifyHeaders: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Headers to add/override on outgoing requests. Only used with 'start'.",
      })
    ),
  }),
  async execute(_toolCallId, params) {
    const { page } = await ensureConnected();

    if (params.action === "log") {
      return {
        content: [
          {
            type: "text",
            text: interceptActive
              ? `Intercepting. ${interceptLog.length} request(s) captured:\n${formatLog(interceptLog)}`
              : "Interception is not active.",
          },
        ],
        details: { active: interceptActive, count: interceptLog.length, requests: interceptLog.slice(-50) },
      };
    }

    if (params.action === "stop") {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      interceptActive = false;
      const log = [...interceptLog];
      interceptLog.length = 0;
      return {
        content: [
          {
            type: "text",
            text: `Interception stopped. ${log.length} request(s) captured:\n${formatLog(log)}`,
          },
        ],
        details: { count: log.length, requests: log.slice(-100) },
      };
    }

    // action === "start"
    if (interceptActive) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
    interceptLog.length = 0;
    interceptActive = true;

    const blockPatterns = params.blockPatterns ?? [];
    const modifyHeaders = params.modifyHeaders ?? {};

    await page.route("**/*", async (route: Route, request: Request) => {
      interceptLog.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        resourceType: request.resourceType(),
        timestamp: Date.now(),
      });

      const shouldBlock = blockPatterns.some((pattern) =>
        request.url().includes(pattern)
      );
      if (shouldBlock) {
        await route.abort("blockedbyclient");
        return;
      }

      if (Object.keys(modifyHeaders).length > 0) {
        const headers = { ...request.headers(), ...modifyHeaders };
        await route.continue({ headers });
        return;
      }

      await route.continue();
    });

    return {
      content: [
        {
          type: "text",
          text: `Interception started.${blockPatterns.length > 0 ? ` Blocking: ${blockPatterns.join(", ")}` : ""}${Object.keys(modifyHeaders).length > 0 ? ` Modifying headers: ${Object.keys(modifyHeaders).join(", ")}` : ""}`,
        },
      ],
      details: { active: true, blockPatterns, modifyHeaders },
    };
  },
});

function formatLog(log: InterceptedRequest[]): string {
  if (log.length === 0) return "(none)";
  return log
    .slice(-30)
    .map((r) => `${r.method} ${r.url}${r.postData ? " [has body]" : ""}`)
    .join("\n");
}
```

#### 3. Create `skills/browser-connect/tools/network.ts`

Passive network monitor that captures request/response pairs with headers, status codes, and timing. Complements `browser_intercept` (which can modify) by providing a read-only view.

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

interface CapturedExchange {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  postData: string | null;
  status: number | null;
  responseHeaders: Record<string, string>;
  contentType: string | null;
  responseSize: number | null;
  timing: number | null;
  timestamp: number;
}

const exchanges: CapturedExchange[] = [];
let monitorActive = false;
let cleanupFns: (() => void)[] = [];

export const browserNetwork = defineTool({
  name: "browser_network",
  label: "Browser Network",
  description:
    "Start or stop passive network monitoring. Captures HTTP request/response pairs with headers, status, size, and timing. Use 'start' to begin, 'stop' to end and get the full log, 'log' to read current captures. Optionally filter by URL pattern and/or HTTP method.",
  parameters: Type.Object({
    action: Type.Union(
      [Type.Literal("start"), Type.Literal("stop"), Type.Literal("log")],
      { description: "start/stop/log" }
    ),
    urlFilter: Type.Optional(
      Type.String({ description: "Only capture URLs containing this substring" })
    ),
    methodFilter: Type.Optional(
      Type.String({ description: "Only capture this HTTP method (GET, POST, etc.)" })
    ),
  }),
  async execute(_toolCallId, params) {
    const { page } = await ensureConnected();

    if (params.action === "log") {
      const filtered = filterExchanges(exchanges, params.urlFilter, params.methodFilter);
      return {
        content: [
          {
            type: "text",
            text: monitorActive
              ? `Monitoring. ${filtered.length} exchange(s):\n${formatExchanges(filtered)}`
              : "Monitor is not active.",
          },
        ],
        details: { active: monitorActive, count: filtered.length, exchanges: filtered.slice(-50) },
      };
    }

    if (params.action === "stop") {
      for (const fn of cleanupFns) fn();
      cleanupFns = [];
      monitorActive = false;
      const filtered = filterExchanges(exchanges, params.urlFilter, params.methodFilter);
      const result = [...filtered];
      exchanges.length = 0;
      return {
        content: [
          {
            type: "text",
            text: `Monitor stopped. ${result.length} exchange(s):\n${formatExchanges(result)}`,
          },
        ],
        details: { count: result.length, exchanges: result.slice(-100) },
      };
    }

    // action === "start"
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
    exchanges.length = 0;
    monitorActive = true;

    const pending = new Map<string, { req: CapturedExchange; startTime: number }>();

    const onRequest = (request: import("playwright-core").Request) => {
      const entry: CapturedExchange = {
        url: request.url(),
        method: request.method(),
        requestHeaders: request.headers(),
        postData: request.postData(),
        status: null,
        responseHeaders: {},
        contentType: null,
        responseSize: null,
        timing: null,
        timestamp: Date.now(),
      };
      pending.set(request.url() + request.method(), { req: entry, startTime: Date.now() });
    };

    const onResponse = (response: import("playwright-core").Response) => {
      const key = response.url() + response.request().method();
      const record = pending.get(key);
      if (record) {
        record.req.status = response.status();
        record.req.responseHeaders = response.headers();
        record.req.contentType = response.headers()["content-type"] ?? null;
        record.req.timing = Date.now() - record.startTime;
        exchanges.push(record.req);
        pending.delete(key);
      } else {
        exchanges.push({
          url: response.url(),
          method: response.request().method(),
          requestHeaders: response.request().headers(),
          postData: response.request().postData(),
          status: response.status(),
          responseHeaders: response.headers(),
          contentType: response.headers()["content-type"] ?? null,
          responseSize: null,
          timing: null,
          timestamp: Date.now(),
        });
      }
    };

    page.on("request", onRequest);
    page.on("response", onResponse);
    cleanupFns.push(
      () => page.removeListener("request", onRequest),
      () => page.removeListener("response", onResponse)
    );

    return {
      content: [{ type: "text", text: "Network monitor started. Navigate or interact with the page to capture traffic." }],
      details: { active: true },
    };
  },
});

function filterExchanges(
  items: CapturedExchange[],
  urlFilter?: string,
  methodFilter?: string
): CapturedExchange[] {
  return items.filter((e) => {
    if (urlFilter && !e.url.includes(urlFilter)) return false;
    if (methodFilter && e.method.toUpperCase() !== methodFilter.toUpperCase()) return false;
    return true;
  });
}

function formatExchanges(items: CapturedExchange[]): string {
  if (items.length === 0) return "(none)";
  return items
    .slice(-30)
    .map((e) => {
      const status = e.status !== null ? ` -> ${e.status}` : "";
      const ct = e.contentType ? ` (${e.contentType.split(";")[0]})` : "";
      const timing = e.timing !== null ? ` ${e.timing}ms` : "";
      return `${e.method} ${e.url}${status}${ct}${timing}`;
    })
    .join("\n");
}
```

#### 4. Update `skills/browser-connect/SKILL.md`

Add the 3 new tools to the "Available Tools" section:

After the existing list, add:
```markdown
- `browser_analyze` -- Analyze page for security-relevant elements (forms, links, scripts, cookies, headers, storage)
- `browser_intercept` -- Intercept HTTP requests: log, block by pattern, modify headers
- `browser_network` -- Passive network monitor: capture request/response pairs with headers and timing
```

Add a new section after "Usage Patterns":
```markdown
## Pentest Workflow

1. Connect with `browser_connect`
2. Run `browser_analyze` to map the page attack surface
3. Start `browser_network` to capture traffic
4. Interact with forms, click links, trigger AJAX calls
5. Read `browser_network` log to find API endpoints, auth tokens, CSRF tokens
6. Use `browser_intercept` to replay modified requests (header injection, parameter tampering)
7. Report findings via `panel_update` from the panel skill
```

### Files

| File | Action |
|------|--------|
| `skills/browser-connect/tools/analyze.ts` | Create |
| `skills/browser-connect/tools/intercept.ts` | Create |
| `skills/browser-connect/tools/network.ts` | Create |
| `skills/browser-connect/SKILL.md` | Modify: add 3 tools + pentest workflow section |

### Do NOT modify
- `skills/browser-connect/tools/connect.ts` -- ensureConnected() and existing connect tools stay as-is
- `skills/browser-connect/tools/interact.ts` -- existing click/type/evaluate stay as-is
- `skills/browser-connect/tools/page-ops.ts` -- existing get_page/screenshot/navigate stay as-is
- Any files outside `skills/browser-connect/`

### Acceptance criteria
- `node --check` passes on all 3 new files (no syntax errors)
- `discoverSkills('/Users/milksu/code/milksu/skills')` finds `browser_analyze`, `browser_intercept`, and `browser_network` as registered tools
- SKILL.md lists all 12 tools (9 existing + 3 new)
- No changes to files outside `skills/browser-connect/`
