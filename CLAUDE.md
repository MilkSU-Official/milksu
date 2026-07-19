# MilkSU

Verifiable security job runtime and user-owned control plane.

## Rules

- Communicate with the user in Chinese.
- Do not use emoji in code, comments, docs, UI text, or commit messages.
- Explain relevant Agent Harness concepts while developing; the repository also supports the user's interview and presentation preparation.
- Before architecture or domain work, read these files in order:
  1. `docs/developer/security-agent-boundary.md`
  2. `docs/developer/architecture.md`
  3. `docs/developer/role-packages.md`
  4. `docs/developer/industry-baseline.md`
- The documentation home page is the compact architecture map. The four developer documents above are the detailed source of truth.
- Do not restore the removed unlimited-context Codex, fixed Task Type, model-written panel, generic sub-agent, in-repo Skill router, or red-team-only Engagement designs.

## Architecture Guardrails

- L2 Role Packages define goals, durable state, Evidence, Evaluators, and Human Outcomes.
- L3 Capability Packages expose reusable security techniques and deterministic tools.
- L4 Shared Security Runtime owns Environment, Job, Attempt, Step, Action, Observation, Artifact, Evidence, Effect, Evaluation, Outcome, Trace, and Recovery.
- L5 is an adaptable Agent Engine. MilkSU may embed or minimally fork a mature open-source Coding Agent core such as Pi or Codex instead of rebuilding generic planning, context, and tool-loop capabilities. The selected engine and model providers remain replaceable and must not define the security domain model.
- L6 Agent Integrity is cross-cutting and risk-based. It is not a Red, Blue, CTF, or AppSec role.
- The model may propose actions and conclusions; only committed observations, artifacts, and evaluators may establish facts or success.

The first implementation vertical is CTF, followed by Vulnerability Research. Both must support Coach, Copilot, and Delegate as a separate collaboration dimension.

Product mission: MilkSU is a research and training environment where people and security agents work together. It helps users complete more real security tasks while using verifiable experiments, evidence, and review to help them genuinely learn how those tasks are done. Domain Outcome and Human Outcome are equally explicit product outputs.

## Current Code Boundary

`app/` retains a generic Tauri/React host, chat history, settings, streaming messages, and tool-output UI. `bridge.js` is a temporary Pi chat adapter. Pi is also a candidate embedded Agent Engine, so do not delete it until the M0 base-engine spike decides whether to embed Pi, adapt Codex, or choose another extensible core. None of these files define the target Runtime contract.

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
npx tauri dev
```
