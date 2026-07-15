# MilkSU

Pi agent harness extension for pluggable AI skills, with a Tauri v2 native desktop client.

## Rules

- No emoji anywhere: code, comments, docs, UI text, commit messages.
- Communicate in Chinese.
- Explain Agent Harness concepts during development for interview/presentation prep.
- Before changing architecture, read `docs/developer/security-agent-boundary.md` and keep Agent Security, Role Package, and Capability Package separate.
- Documentation site (`docs/`) is the single source of truth for architecture and progress:
  - Before starting a feature: read `docs/progress/roadmap.md` for priorities and `docs/developer/` for architecture context.
  - After completing a feature: update `docs/progress/status.md` (checklist), `docs/progress/changelog.md` (entry), and relevant `docs/developer/` pages if architecture changed.
  - Do NOT duplicate architecture or progress information in this file. This file contains rules and quick-reference only; detailed docs live in the docs site.

## Architecture

See docs site for full details:
- **Architecture overview**: `docs/developer/architecture.md`
- **Data flow**: `docs/guide/data-flow.md`
- **Bridge protocol**: `docs/developer/bridge.md`
- **Tauri IPC**: `docs/developer/tauri-ipc.md`
- **Skill system**: `docs/developer/skills.md`
- **Key patterns**: `docs/developer/tool-as-trigger.md`, `docs/developer/subagents.md`, `docs/developer/streaming.md`
- **Task types**: `docs/user/task-types.md`

Quick reference -- three-process architecture:
- React frontend (TypeScript): UI, chat, panels
- Rust backend (Tauri v2): IPC, process management, persistence
- Node.js bridge (bridge.js): Pi agent sessions, tool execution

## Progress Tracking

All feature progress, module status, roadmap, and changelogs are tracked in the documentation site:

- **Module status**: `docs/progress/status.md` -> `/progress/status`
- **Roadmap (P0-P3)**: `docs/progress/roadmap.md` -> `/progress/roadmap`
- **Changelog**: `docs/progress/changelog.md` -> `/progress/changelog`
- **Sprint reviews**: `docs/progress/sprint-*.md`
- **Module maturity (detailed)**: `docs/developer/module-status.md`

Run `npm run docs:dev` and use the local URL printed by VitePress.

Do NOT duplicate progress information in this file. Update the docs site instead.

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
| DeepSeek (default) | DEEPSEEK_API_KEY | deepseek-v4-flash |
| Anthropic | ANTHROPIC_API_KEY | claude-sonnet-4-6 |
| OpenAI | OPENAI_API_KEY | gpt-4o |
| Google Gemini | GEMINI_API_KEY | gemini-2.5-flash |
| Groq | GROQ_API_KEY | llama-3.3-70b-versatile |

## Feature Gap & Key Concepts

See docs site:
- **Platform comparison**: `docs/developer/comparison.md`
- **Agent Harness patterns**: `docs/guide/agent-harness.md`
- **Relay mode**: `docs/developer/relay.md`
- **Providers**: `docs/developer/providers.md`
