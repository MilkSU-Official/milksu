# MilkSU Sprint Review -- 2026-07-02

## Sprint Metrics (S0-S4)

| Metric | Value |
|--------|-------|
| Sprints completed | 5/6 (S5 sub-agents remaining) |
| Lines added | ~2,048 across 26 files |
| Skill tools | 15 (4 skills, 11 tool files) |
| Frontend LOC | 2,979 (12 .ts/.tsx files) |
| Commits | 6 (docs + S1 + S2 + S0 + S3 + S4) |

## Sprint Summary

| Sprint | Scope | Files | Delta |
|--------|-------|-------|-------|
| S0 | Agent loop fix: model/provider pass-through | 4 | +20 -8 |
| S1 | Engagement memory: Rust CRUD + IPC wrappers | 6 | +306 -8 |
| S2 | Engagement selector UI: dropdown, inline create, status badges | 5 | +307 -5 |
| S3 | Wire task panels: panel_update event pipeline (Pi tool -> bridge -> Rust -> React) | 6 | +507 -1 |
| S4 | Browser CDP: browser_analyze, browser_intercept, browser_network | 5 | +908 |

## Feature Matrix (updated)

| Capability | MilkSU | Codex | Claude Code | Arkloop | Memoh |
|-----------|--------|-------|-------------|---------|-------|
| Skills/plugins | Pi skills | Skills | .claude/skills | ClawHub | Supermarket |
| MCP | Pi native | MCP | MCP | MCP + ACP | MCP |
| Panel state wiring | S3 done (unique) | -- | -- | -- | -- |
| Browser CDP | S4 done (12 tools) | Computer Use | CU + Chrome ext | -- | Container browser |
| Model pass-through | S0 done (5 providers) | OpenAI only | Anthropic only | Multi-model | Multi-model |
| Engagement memory | S1+S2 done | Session only | .claude/ memory | OpenViking | Mem0 |
| Sub-agents | S5 planned | 6 concurrent | 5 layers + Workflows | subagentctl | Sub-agents |
| Sandbox | -- | Cloud VM | Local process | Firecracker | Container |
| Lifecycle hooks | Stub | PostToolUse | Pre/Stop/Notify | Lua scripts | Hooks module |
| Auto mode | Planned | Perm Profiles | Classifier | -- | Tool Approval |
| Long tasks | Planned | /goal | Headless | -- | Heartbeat |
| Multi-channel | Desktop only | Web only | CLI + IDE | Telegram | TG/Discord/WX |
| Injection defense | -- | Sandbox boundary | Instruction boundary | Semantic scan | -- |

## Retrospective

### What worked

- Claude design + Codex implement workflow: fast iteration, clean separation of concerns
- panel_update dual-channel pattern: agent-to-UI side-channel avoids LLM token waste
- Engagement data model: rich types (AttackPath, Credential, Host) ready for real use
- Browser tools "wide output" design: one tool call returns full attack surface
- tauri.ts localStorage fallback: browser preview works without Tauri runtime

### What needs attention

- No end-to-end test yet: agent loop never ran with real API key
- Engagement + TaskState overlap: two systems track the same data
- CLAUDE.md planned list outdated: several done items not checked off
- S5 sub-agents is the hardest sprint, may need architecture rethink
- No CI/CD or automated tests of any kind

## Architecture Issues Found

### Critical

1. **Engagement vs TaskState data duplication** -- `Engagement` has `EngagementHost` (ip, services, vulnerabilities). `PentestState` has `ports[]` and `vulnerabilities[]`. `ReconState` has `hosts[]` and `ports[]`. Same data, different shapes, no sync between them. Panel_update writes to TaskState; engagement CRUD writes to Engagement.

2. **Single bridge process, single conversation** -- `bridge.js` uses module-level `currentPromptId` and a single `session`. All events carry the last-set prompt ID. Rust side holds `Mutex<Option<BridgeProcess>>` -- one bridge for entire app. No conversation isolation.

### Warning

3. **App.tsx God component** -- 394 lines, 11 useState, 7 useCallback, 3 useEffect. Owns conversation CRUD, message routing, panel merge, engagement state, settings, task type switching, layout toggling. Every sprint grows this file.

4. **Browser tools share mutable module state** -- `intercept.ts` and `network.ts` have module-level arrays and flags. If two conversations use browser tools, they share logs and route handlers.

### Minor

5. **Bridge crash = silent death** -- If bridge.js crashes, the stdout reader thread exits silently. `Mutex<Option<BridgeProcess>>` still holds `Some(...)` with dead stdin. No reconnect, no UI notification.

6. **camelCase/snake_case boundary fragile** -- Frontend camelCase, Rust snake_case. Manual mapping in `fromStored()`/`toStored()` and `commandArg()`. Every new field needs mapping in 3 places.

## Fix Priority

| Order | Issue | Status | Summary |
|-------|-------|--------|---------|
| 1 | #6 serde rename_all camelCase | DONE | storage.rs rename_all + alias, removed fromStored/toStored/commandArg |
| 2 | #5 bridge crash recovery | DONE | Arc<Mutex<...>>, reader thread clears bridge + emits bridge-error |
| 3 | #3 App.tsx extract hooks | DONE | useConversations + useAgentEvents hooks, App.tsx 394->181 lines |
| 4 | #1 Engagement vs TaskState | DONE | deriveTaskState() derives PentestState/ReconState from Engagement |
| 5 | #2 single bridge -> SessionPool | OPEN | S5 prerequisite, biggest change |
| 6 | #4 browser shared state | DONE | Documented as single-session limitation in SKILL.md |

## Next Steps

1. Fix #2 single bridge -> SessionPool (S5 prerequisite)
2. S5 sub-agents
3. End-to-end test with DeepSeek API key
