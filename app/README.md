# MilkSU Desktop Client

Tauri v2 native desktop application for MilkSU -- a Pi agent harness extension for pluggable AI skills.

## Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS v4
- **Backend**: Rust (Tauri v2)
- **Agent Engine**: Pi (earendil-works) via Node.js bridge subprocess

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
  App.tsx               Root: state, IPC, persistence
  components/
    Sidebar.tsx         Conversation list, search, delete
    ChatView.tsx        Welcome page + chat + model selector
    OutputPanel.tsx     Tool output side panel
    SettingsPage.tsx    Full-page settings with category sidebar
    ModelSelector.tsx   Dropdown model switcher (in input bar)
  tauri.ts              Tauri IPC wrapper + browser-preview fallback
  types.ts              Message, Conversation, AppSettings, UsageData, PROVIDERS
  index.css             Light theme, Tailwind

src-tauri/              Rust backend
  src/lib.rs            IPC commands, bridge process management
  src/settings.rs       Settings persistence (JSON file)
  src/storage.rs        Conversation persistence (JSON files)
  src/main.rs           Entry point
```

## Data Storage

All data is stored locally:

- Settings: `~/Library/Application Support/com.milksu.app/settings.json`
- Conversations: `~/Library/Application Support/com.milksu.app/conversations/*.json`

## Supported Providers

DeepSeek (default), Anthropic, OpenAI, Google Gemini, Groq.

API keys are stored locally and passed to the bridge subprocess as environment variables.
