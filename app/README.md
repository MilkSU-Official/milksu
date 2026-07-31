# MilkSU Desktop Host

This directory contains the Vue desktop control plane. It provides a PI Coding Agent project workspace, conversation storage, settings, provider selection, streaming tool output, the guided CTF training flow, and CVE intelligence.

CTF and Vuln surfaces read committed projections from the Shared Security Runtime. They do not treat conversation text or model-authored UI state as domain truth.

`../bridge.js` is the PI Coding Agent sidecar adapter. It restores project-scoped PI sessions and exposes `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`. The separate `../security-bridge.js` keeps those built-in tools disabled for the CTF harness.

## Stack

- Vue 3 + TypeScript + Vite + Tailwind CSS
- `memohai/ui` as a pinned git submodule (`@felinic/ui`)
- Memoh's default `data-color-scheme="memoh"` palette
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

## NSSCTF browser judge

The native app installs the unpacked extension sources under its local app-data browser directory. In the guided training flow:

1. import an NSSCTF problem ID or canonical problem URL;
2. open the same problem in a logged-in Chrome tab;
3. load the extension directory shown by MilkSU, paste the one-time pairing code, and connect that tab;
4. submit a candidate from the Agent workspace.

The extension cannot read the browser profile or send arbitrary page actions. It accepts only the fixed NSSCTF flag-submission command and returns an authoritative, rejected, ambiguous, or adapter-error receipt. Only an authoritative platform receipt can complete the CTF job.

## Retained Structure

```text
src/
  App.vue                 desktop host composition
  components-vue/         Coding Agent, guided CTF, CVE and settings surfaces
  composables/            conversation, CTF, NSSCTF and runtime state
  desktop.ts              Wails IPC wrapper plus browser preview storage

../app.go                 Wails L1 adapter
../internal/config        compatible local settings store
../internal/conversation  compatible conversation store
../internal/engine        Sidecar supervision and normalized events
../packages/ui            pinned memohai/ui submodule
```
