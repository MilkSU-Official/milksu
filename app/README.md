# MilkSU Desktop UI

This directory contains the React + TypeScript product surface hosted by the Electron desktop shell.

Current user workspaces are:

- **Coding**: project-scoped Pi sessions, attachments, tools, terminal/background tasks, artifact preview, Browser, Git, ImageGen and environment/capability views;
- **CVE**: a learning/tracking workspace with public intelligence sync, reproduction dossiers, reports and Coding handoff;
- **实验室**: independent jobs with live targets and reports;
- **Settings**: provider configuration, local recovery, diagnostics and application controls.

The renderer is not a domain fact source. CVE, Lab, and Coding facts come from TypeScript Runtime projections. Provider credentials stay in the Runtime secret store (macOS Keychain via the native helper) and are never returned through Desktop RPC.

## Runtime Connections

- `../runtime/`: Desktop JSONL host; renderer RPC, sessions, settings, CVE, research, companion;
- `../sidecar/pi/bridge.js`: Pi session, reviewed resources and CVE/lab domain tools on top of the Coding loop;
- `../sidecar/pi/bridge-policy.js`: tool policy transport and platform enforcement;
- `../sidecar/dsh/`: ACP adapter for a user-supplied Agent command;
- `../cmd/milksu-backend/`: native helper (Keychain CGO, PTY, Lua, Computer Use OS probes).

Coding Browser, a user-paired platform browser and Computer Use are separate permission surfaces. They do not inherit one another's profile, Cookie, token, page session or application scope.

## Stack

- React 19, TypeScript and Vite;
- Tailwind CSS and shadcn/ui;
- Electron with a supervised TypeScript Runtime and a native helper;
- supervised, packaged Node/Pi Sidecars.

## Development

```bash
npm install
cd app && npm install
cd ../desktop && npm install
npm run desktop:start
```
