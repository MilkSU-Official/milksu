# MilkSU Desktop Host

This directory contains the reusable desktop shell retained during the architecture restart. It provides conversation storage, settings, provider selection, streaming messages, and generic tool-output UI.

It intentionally has no built-in Pentest, CTF, Recon, Reverse, Engagement, or Role state. Future CTF and Vuln panels must read committed projections from the Shared Security Runtime; they must not treat a conversation or model-authored panel update as domain truth.

`../bridge.js` is a temporary Pi chat adapter that keeps the existing desktop interaction path usable. It is not the final L5 Worker Adapter contract.

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Tauri v2 with a Rust host
- Pi through a temporary Node.js subprocess bridge
- Local settings and conversation persistence

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
npx tauri dev
```

Browser preview stores settings and conversations in `localStorage`; sending messages still requires the native Tauri bridge.

## Retained Structure

```text
src/
  App.tsx                 generic host composition
  components/ChatView    conversation and tool output
  components/Sidebar     conversation navigation
  components/Settings    model and provider configuration
  hooks/                  conversation persistence and streamed events
  tauri.ts                IPC wrapper plus browser preview storage

src-tauri/
  src/lib.rs              bridge lifecycle and IPC
  src/settings.rs         local settings
  src/storage.rs          local conversation history
```
