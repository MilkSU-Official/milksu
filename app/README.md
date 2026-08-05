# MilkSU Desktop UI

This directory contains the Vue 3 + TypeScript product surface embedded by Wails.

Current user workspaces are:

- **CTF**: catalogs, custom challenges, challenge detail, Agent workspace, Candidate/Judge, recovery and
  debrief;
- **Coding**: project-scoped Pi sessions, attachments, tools, terminal/background tasks, artifact preview,
  Browser, Git, ImageGen and environment/capability views;
- **CVE**: a learning/tracking workspace with real read-only intelligence sync, source snapshots,
  research notes, asset verification, practice-environment handoff and Coding handoff paths;
- **Settings**: provider configuration, local recovery, diagnostics and application controls.

The Vue UI is not a domain fact source. CTF success, Evidence, recovery and learning facts come from Go
projections. Provider credentials remain in the Go-owned credential store and are never returned through
Wails bindings.

## Runtime Connections

- `../bridge.js`: normal Coding Pi session and reviewed resources;
- `../security-bridge.js`: CTF-specific Pi session with Coding resources disabled;
- `../bridge-policy.js`: tool policy transport and platform enforcement;
- `../app.go`: Wails facade/composition root;
- `../internal/`: application services, domains, persistence and platform adapters.

Coding Browser, a user-paired platform browser and Computer Use are separate permission surfaces. They do
not inherit one another's profile, Cookie, token, page session or application scope.

## Stack

- Vue 3, TypeScript and Vite;
- Tailwind CSS;
- pinned `memohai/ui` sources mounted at `../packages/ui`;
- Wails v2.13 with a Go host;
- supervised, packaged Node/Pi Sidecars.

## Development

```bash
npm install
npm run dev
npm run test
npm run build
```

Browser preview uses its own local state and does not prove native Wails behavior. Native bindings,
packaged Sidecars, macOS permissions, restart recovery and final visual behavior require the repository's
packaged-App validation.
