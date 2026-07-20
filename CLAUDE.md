# MilkSU

One-stop cybersecurity AI learning client with a verifiable security-learning runtime.

## Rules

- Communicate with the user in Chinese.
- Do not use emoji in code, comments, docs, UI text, or commit messages.
- Explain relevant Agent Harness concepts while developing; the repository also supports the user's interview and presentation preparation.
- Before architecture or domain work, read these files in order:
  1. `docs/developer/security-agent-boundary.md`
  2. `docs/developer/architecture.md`
  3. `docs/developer/role-packages.md`
  4. `docs/developer/industry-baseline.md`
  5. `docs/developer/adr/0001-agent-engine-and-desktop-boundary.md`
  6. `docs/developer/adr/0002-runtime-facts-and-recovery.md`
- The documentation home page is the compact architecture map. The developer documents above are the detailed source of truth.
- Do not restore the removed unlimited-context Codex, fixed Task Type, model-written panel, generic sub-agent, in-repo Skill router, or red-team-only Engagement designs.

## Architecture Guardrails

- L2 Role Packages define goals, durable state, Evidence, Evaluators, and Human Outcomes.
- L3 Capability Packages expose reusable security techniques and deterministic tools.
- L4 Shared Security Runtime owns Environment, Job, Attempt, Step, Action, Observation, Artifact, Evidence, Effect, Evaluation, Outcome, Trace, and Recovery.
- L5 is an adaptable Agent Engine. MilkSU may embed or minimally fork a mature open-source Coding Agent core such as Pi or Codex instead of rebuilding generic planning, context, and tool-loop capabilities. The selected engine and model providers remain replaceable and must not define the security domain model.
- L6 Agent Integrity is cross-cutting and risk-based. It is not a Red, Blue, CTF, or AppSec role.
- The model may propose actions and conclusions; only committed observations, artifacts, and evaluators may establish facts or success.

The first implementation vertical is CTF, followed by Vulnerability Research. Both must support Coach, Copilot, and Delegate as a separate collaboration dimension.

The local Juice Shop fixture is only a deterministic regression baseline. CTF domain code must not depend on Juice Shop, Docker, any single platform, or the existence of a platform API/CLI. M2 must normalize chat text, files, screenshots, explicitly selected local directories, browser pages, remote connections, and managed labs through one Challenge Intake. Browser and Computer Use are optional capabilities, not the CTF Agent or its only entry point; platform APIs are optional accelerators only.

Product mission: MilkSU is a one-stop cybersecurity AI learning client where people and security agents work together in explicitly authorized CTF, vulnerability-research, and attack-defense training environments. It helps users complete real learning tasks while using verifiable experiments, evidence, and review to help them genuinely learn how those tasks are done. Domain Outcome and Human Outcome are equally explicit product outputs.

The public product is not a general internet scanner or autonomous pentesting service. Default/open-source capabilities must not provide arbitrary target lists, internet-range bulk scanning, credential spraying, stealth/evasion, or unapproved external attack workflows. Every external target must carry visible scope/provenance; external effects require policy checks, evidence, rate limits where applicable, and risk-based approval. Read `docs/developer/adr/0004-learning-product-and-release-boundary.md` before adding Browser, Shell, Network, Lab, or release functionality.

## Current Code Boundary

M1 is complete. The desktop host is Go/Wails/React; `internal/securityruntime` owns the append-only Event Store, Artifact Store, Projection, recovery semantics, narrow Engine/Capability/Environment/Evaluator boundaries, and their tests. React reads Go projections and may request start/cancel, but never writes runtime facts. `bridge.js` still serves compatible chat only; M2 must add a separate Pi AgentEngine Adapter rather than turn that bridge into the security domain model. Codex app-server remains comparison code and a possible External Agent Runtime, not the default product engine.

Before adding a new core module, state its layer, contract, evaluator, evidence, effects, and baseline comparison in the relevant developer document. Do not add placeholder architecture merely to make the six layers look complete.

Follow `docs/developer/development-plan.md` for implementation order and milestone acceptance criteria.

## Development

```bash
npm run docs:dev
npm run docs:build

cd app
npm run dev
npm run build
npm run lint

cd ..
go test ./...
wails dev
wails build
```
