# MilkSU Desktop Client

Tauri v2 native desktop application for MilkSU -- a Pi agent harness extension for pluggable AI skills.

## Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (base-nova)
- **Backend**: Rust (Tauri v2)
- **Agent Engine**: Pi (earendil-works) via Node.js bridge subprocess
- **Icons**: lucide-react
- **Font**: Geist (oklch color system)

## Development

Browser-only frontend preview:

```bash
npm install
npm run dev -- --host 127.0.0.1
```

This mode uses localStorage-backed stubs for settings and conversations so the UI can be tested outside the Tauri WebView. The agent bridge still requires the native Tauri runtime.

Native desktop development:

```bash
npm install
npx tauri dev
```

Starts Vite dev server on port 1420 with Rust hot reload.

If port 1420 is in use: `lsof -ti:1420 | xargs kill -9`

## Production Build

Frontend checks:

```bash
npm run build
npm run lint
```

Native bundle:

```bash
npx tauri build
```

## Project Structure

```
src/                    React frontend
  App.tsx               Root: state, IPC, persistence, task type routing
  components/
    Sidebar.tsx         Conversation list with task-type icons, search, delete
    ChatView.tsx        Welcome page (task type selector) + chat + model selector
    TaskPanel.tsx       Security task panels (pentest/ctf/recon/reverse)
    OutputPanel.tsx     Tool output side panel (for chat-type conversations)
    SettingsPage.tsx    Full-page settings with shadcn/ui (General, API Keys, Usage, About)
    ModelSelector.tsx   Dropdown model switcher (in input bar)
    ui/                 shadcn/ui components (Button, Card, Switch, Input, Badge, Separator, Label)
  lib/utils.ts          cn() utility (clsx + tailwind-merge)
  tauri.ts              Tauri IPC wrapper + browser-preview fallback
  types.ts              TaskType, TaskState, Message, Conversation, AppSettings, UsageData, PROVIDERS
  index.css             Tailwind v4 + shadcn theme (oklch variables, Geist font)

src-tauri/              Rust backend
  src/lib.rs            IPC commands, bridge process management
  src/settings.rs       Settings persistence (JSON file)
  src/storage.rs        Conversation persistence (JSON files)
  src/main.rs           Entry point

components.json         shadcn/ui config (base-nova style, Vite framework)
```

## Task Type System

Each conversation binds to a task type at creation time. The welcome page shows a task type selector with 5 color-coded pills:

| Type | Color | Icon | Panel Content |
|------|-------|------|---------------|
| Chat | neutral | MessageSquare | none (OutputPanel for tool results) |
| Pentest | red | Shield | target, phase tracker, vulns, ports, tools |
| CTF | purple | Flag | challenge, category, points, flags, solved |
| Recon | blue | Network | scope, hosts, services, findings |
| Reverse | amber | Binary | binary, arch, protections, functions, findings |

- Sidebar shows task type icon per conversation
- Chat header shows task type badge for security types
- Task panel overlays chat area from the right (absolute positioning, does not squeeze layout)

## Data Storage

All data is stored locally:

- Settings: `~/Library/Application Support/com.milksu.app/settings.json`
- Conversations: `~/Library/Application Support/com.milksu.app/conversations/*.json`
- Each conversation JSON includes `task_type` and `task_state` fields

## Supported Providers

DeepSeek (default), Anthropic, OpenAI, Google Gemini, Groq.

API keys are stored locally and passed to the bridge subprocess as environment variables.
