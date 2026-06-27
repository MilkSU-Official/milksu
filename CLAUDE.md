# MilkSU

Pi agent harness extension for pluggable AI skills, with a Tauri v2 native desktop client.

## Rules

- No emoji anywhere: code, comments, docs, UI text, commit messages.
- Communicate in Chinese.
- Explain Agent Harness concepts during development for interview/presentation prep.

## Architecture

- `app/` - Tauri v2 desktop client (React + Rust)
- `src/` - Pi extension (TypeScript)
- `skills/` - Skill plugins

## Dev

```bash
cd app && npx tauri dev
```
