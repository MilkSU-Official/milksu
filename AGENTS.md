# MilkSU Repository Guidance

## Start Here

Before changing anything, read:

1. `docs/developer/current-objectives.md`;
2. `docs/developer/objective-coverage-ledger.md`;
3. `docs/developer/document-status.md`;
4. the current Git branch, HEAD and working tree.

M3 product-loop work was squash merged to `main` on 2026-08-05. Continue from
`current-objectives.md` and `objective-coverage-ledger.md` rather than reopening the merged PR or old
sprint gaps. Build the next bounded slice, record adjacent non-blocking bugs and details in the coverage
ledger instead of fixing them opportunistically, and fix immediately only when a problem blocks the selected
slice, threatens data/credentials/scope/private-remote boundaries, or invalidates the acceptance result.

Do not use old milestones, ADR follow-ups, dated reviews, checkpoints, research notes or design audits as
an implementation queue. `docs/developer/development-plan.md` does not exist and must not be recreated.

## Collaboration

- Communicate with the user in Chinese unless they ask otherwise.
- Do not use emoji in code, comments, documentation, UI text or commit messages.
- Explain relevant Agent Harness concepts when they materially help product decisions or the user's
  interview and presentation preparation.

## Current Product Boundary

MilkSU is a Go/Wails/Vue desktop app with supervised Pi Sidecars.

- Pi owns the generic model session, context compaction and tool loop.
- MilkSU owns desktop authorization, workspace and credential boundaries, event projection and product UI.
- The CTF domain owns Challenge, Evidence, Candidate, Judge Receipt, Recovery, Memory and learning facts.
- Labs are paused designs, not current completion conditions.
- CVE has a current learning/tracking MVP; CVE depth research, external-asset experiments, exploit
  reproduction and disclosure workflows remain future work.
- NYU safe-static is a narrow developer evaluation, not a MilkSU CTF score.

Reuse pinned, reviewable Pi packages, Skills, MCP servers, platform CLIs and mature community components.
Do not grow a second generic Coding Agent harness when an upstream component already owns the capability.

## Non-Negotiable Boundaries

- Never read, print, migrate or place Provider API keys in model context, tool output, logs, diagnostics,
  documentation or ordinary files.
- Never publish to referenced open-source repositories. GitHub writes are limited to the explicitly
  authorized MilkSU private remote and still require the product's meaningful publish confirmation.
- Full Access and automatic approval do not bypass paid actions, external-account authorization, Scope
  expansion, path confinement or irreversible external effects.
- Security actions against external targets require visible, exact authorization. Do not add arbitrary
  target lists, internet-range scanning, credential spraying, stealth/evasion or unapproved attack flows.
- Models may propose CTF candidates, but only an independent Judge or explicit authorized human result may
  establish success.
- Do not describe partial smoke tests as complete Coding, CTF, Memory, NYU or release results.

## Architecture Direction

The target dependency direction is:

```text
Vue -> Wails Facade -> Application Service -> Domain / Runtime -> Infrastructure Adapter
```

Do not start a standalone architecture-cleanup milestone. When a selected product slice touches
`CTFPage.vue`, `app.go`, `bridge-policy.js`, `internal/browsercap/manager.go` or CTF Runner/Recovery,
avoid adding a new responsibility and extract the touched concern when practical.

New pre-release code implements the clean current model directly. Do not add migration, dual-write,
fallback or compatibility branches for abandoned pre-release designs. Existing working schema cleanup is
deferred to one destructive pre-release consolidation after the product slices are stable.

## Validation and Delivery

- Use the canonical repository scripts instead of inventing parallel runners.
- A capability is not complete because a button, package or fixture exists; retain one real-task result.
- Preserve the user's unrelated working-tree changes.
- Each selected vertical slice is reviewed, tested, committed and pushed only to MilkSU's private remote.
- Development-time documentation records tests, receipts, checkpoints and necessary ADRs. Final architecture,
  milestone, status and release claims are updated only during the final documentation closeout.
