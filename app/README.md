# MilkSU Desktop Host

This directory contains the reusable desktop shell retained during the architecture restart. It provides conversation storage, settings, provider selection, streaming messages, and generic tool-output UI.

It intentionally has no built-in Pentest, CTF, Recon, Reverse, Engagement, or Role state. Future CTF and Vuln panels must read committed projections from the Shared Security Runtime; they must not treat a conversation or model-authored panel update as domain truth.

`../bridge.js` is the M0 Pi sidecar adapter. It emits MilkSU-shaped structured events but is not yet the final L5 `AgentEngine v1alpha1` contract.

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Wails v2.13 with a Go host
- Pi SDK through a supervised Node.js sidecar
- Local settings and conversation persistence

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
cd ..
wails dev
```

Browser preview stores settings and conversations in `localStorage`; sending messages still requires the native Wails bridge.

## Retained Structure

```text
src/
  App.tsx                 generic host composition
  components/ChatView    conversation and tool output
  components/Sidebar     conversation navigation
  components/Settings    model and provider configuration
  hooks/                  conversation persistence and streamed events
  desktop.ts              Wails IPC wrapper plus browser preview storage

../app.go                 Wails L1 adapter
../internal/config        compatible local settings store
../internal/conversation  compatible conversation store
../internal/engine        Sidecar supervision and normalized events
```
