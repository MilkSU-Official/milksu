---
name: subagent
description: Spawn parallel sub-agents for independent tasks. Each sub-agent runs in its own session.
triggerKeywords: [subagent, parallel, concurrent, spawn, fork, distribute]
---

# Sub-Agent Skill

Spawn independent sub-agents to handle parallel tasks. Each sub-agent gets its own Pi session with separate context.

## Available Tools

- `spawn_subagents` -- Spawn multiple sub-agents with individual task descriptions

## Usage

The main agent calls spawn_subagents with an array of up to 8 task descriptions. The desktop bridge runs up to 4 tasks concurrently and returns the collected results to the main conversation.

## Limitations

- Maximum 8 tasks per call and 4 concurrent sub-agents
- Execution currently requires the MilkSU desktop bridge
- Sub-agents cannot spawn their own sub-agents
- Each sub-agent starts with a clean context (no conversation history from parent)
- Sub-agents share the same model/provider as the parent conversation
