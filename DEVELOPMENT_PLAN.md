# MilkSU Development Plan

> 本文件是早期 S0-S5 平台计划的历史快照，不再作为当前优先级或完成状态的依据。当前路线图见 `docs/progress/roadmap.md`，当前实现状态见 `docs/progress/status.md`。

## Sprint Overview

| Sprint | Name | Duration | Owner | Dependencies |
|--------|------|----------|-------|-------------|
| S0 | Agent Loop Fix | 1 day | Codex | none |
| S1 | Engagement Memory | 1 week | Codex | S0 |
| S2 | Policy Engine / Auto Mode | 1 week | Codex | S0 |
| S3 | Wire Task Panels | 1 week | Codex | S1 |
| S4 | Browser CDP Enhancement | 1 week | Codex | S0 |
| S5 | Sub-agents | 2 weeks | Codex | S1, S2 |

Framework design for each sprint is done by Claude (this session).
Implementation for each sprint is done by Codex with detailed task specs.

---

## S0: Agent Loop Fix

### Problem
bridge.js uses `createAgentSession()` from Pi but does not pass model/provider config.
The session creation needs to respect the user's selected provider and API key.

### Files to modify
- `bridge.js` -- accept model/provider from stdin messages, pass to session
- `app/src-tauri/src/lib.rs` -- already passes model/provider in JSON, verify bridge reads it

### Acceptance
- User fills DeepSeek API key in Settings page
- User sends a message in chat
- Agent responds with streaming text
- Tool calls render as collapsible cards

---

## S1: Engagement Memory

### New files
- `app/src-tauri/src/engagement.rs` -- Rust CRUD + timeline append
- `src/engagement-store.ts` -- TypeScript store for bridge.js
- `skills/engagement/SKILL.md` -- Skill declaration
- `skills/engagement/tools/manage.ts` -- engagement_create, engagement_query, engagement_list tools
- `app/src/types.ts` -- add Engagement types
- `app/src/components/EngagementSelector.tsx` -- UI for selecting/creating engagements

### Data
- Storage path: `~/Library/Application Support/com.milksu.app/engagements/{id}.json`
- Timeline: `{id}.timeline.jsonl`

### Key types (defined in framework)
See `src/types.ts` additions and `app/src-tauri/src/engagement.rs` skeleton.

---

## S2: Policy Engine / Auto Mode

### New files
- `src/rules/default.rules` -- Default security tool rules
- `src/execpolicy.ts` -- Rule parser and matcher (simplified Starlark -> TOML)
- `app/src/components/ConfirmDialog.tsx` -- Tool confirmation dialog

### Modify
- `src/policy-engine.ts` -- Replace stub with real implementation
- `src/index.ts` -- Wire policy engine to tool_call hook
- `bridge.js` -- Add confirmation request/response protocol
- `app/src-tauri/src/lib.rs` -- Add confirmation IPC

### Decision model
- `allow` -- execute without asking
- `prompt` -- show ConfirmDialog, wait for user response
- `forbidden` -- reject, tell agent why

---

## S3: Wire Task Panels

### New files
- `src/auto-populate.ts` -- Tool result parsers (nmap XML, etc.)

### Modify
- `bridge.js` -- After tool execution, parse results and emit panel updates
- `app/src-tauri/src/lib.rs` -- Forward panel update events
- `app/src/App.tsx` -- Handle panel update events, update task_state

### Flow
tool_call_end -> parse result -> emit "panel-update" event -> React updates TaskPanel

---

## S4: Browser CDP Enhancement

### Modify
- `skills/browser-connect/tools/*.ts` -- Add intercept, analyze, DOM traversal tools

### New tools
- `browser_intercept` -- request interception (modify/block HTTP requests)
- `browser_analyze` -- page analysis (forms, links, scripts, cookies)
- `browser_execute` -- JS execution with structured result parsing

---

## S5: Sub-agents

### New files
- `src/sub-agent-manager.ts` -- SubAgentManager class
- `skills/orchestration/SKILL.md` -- Orchestration skill
- `skills/orchestration/tools/spawn.ts` -- spawn_sub_agent, collect_sub_agents tools
- `app/src/components/SubAgentProgress.tsx` -- Progress display

### Modify
- `bridge.js` -- Multi-session pool (SessionPool class)
- `app/src-tauri/src/lib.rs` -- Multiple bridge processes or multiplexed single bridge
