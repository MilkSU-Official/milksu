# MilkSU Desktop UI

This directory contains the Vue 3 + TypeScript product surface hosted by the Electron desktop shell.

Current user workspaces are:

- **CTF**: catalogs, custom challenges, challenge detail, Pi Agent workspace, Candidate/Judge, recovery and debrief;
- **Coding**: project-scoped Pi sessions, attachments, tools, terminal/background tasks, artifact preview, Browser, Git, ImageGen and environment/capability views;
- **CVE**: a learning/tracking workspace with public intelligence sync, reproduction dossiers, reports and Coding handoff;
- **实验室**: independent jobs with live targets and reports;
- **Settings**: provider configuration, local recovery, diagnostics and application controls.

The Vue UI is not a domain fact source. CTF success, Evidence, recovery and learning facts come from Go projections. Provider credentials remain in the Go-owned credential store and are never returned through Desktop RPC.

## Runtime Connections

- `../sidecar/pi/bridge.js`: Pi session, reviewed resources and CTF/CVE/lab domain tools on top of the Coding loop;
- `../sidecar/pi/bridge-policy.js`: tool policy transport and platform enforcement;
- `../cmd/milksu-backend/app.go`: Go application composition root;
- `../internal/`: application services, domains, persistence and platform adapters.

Coding Browser, a user-paired platform browser and Computer Use are separate permission surfaces. They do not inherit one another's profile, Cookie, token, page session or application scope.

## Stack

- Vue 3, TypeScript and Vite;
- Tailwind CSS;
- pinned Felinic UI sources mounted at `../packages/ui`;
- Electron with a supervised Go Runtime;
- supervised, packaged Node/Pi Sidecars.

## Development

```bash
npm install
cd app && npm install
npm run desktop:start
```
