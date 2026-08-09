# MilkSU Repository Guidance

## Start Here

Before changing anything, read:

1. `docs/developer/current-objectives.md`;
2. `docs/developer/document-status.md`;
3. `docs/architecture/current-system.md`;
4. the current Git branch, HEAD and working tree.

M3 product-loop work was squash merged to `main` on 2026-08-05. Continue from
`current-objectives.md`, current code, tests and Git history rather than reopening the merged PR, retired
ledgers or old sprint gaps. Build the next bounded slice, record adjacent non-blocking bugs near the relevant
code or current target notes instead of fixing them opportunistically, and fix immediately only when a problem
blocks the selected slice, threatens data/credentials/scope/private-remote boundaries, or invalidates the
acceptance result.

Do not use old milestones, ADR follow-ups, dated reviews, checkpoints, research notes or design audits as
an implementation queue. `docs/developer/development-plan.md` does not exist and must not be recreated.

## Product Code Admission

Read `docs/developer/product-code-admission.md` at these decision points:

- before designing a new product capability, public Wails API, persisted state, Sidecar resource or
  feature flag;
- before implementing Agent Harness behavior, compatibility/migration logic, experimental product
  surfaces or a capability already owned by Pi or another reviewed upstream component;
- before adding smoke, fixture, benchmark, browser-preview or release-acceptance infrastructure;
- during review and delivery closeout when deciding whether an implemented but unverified capability
  should remain in the production dependency graph.

Apply its four gates: design admission, development boundary, test/acceptance separation and
review/retention. Small fixes and documentation-only work do not require rereading it unless they change
one of those decisions.

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

Apply an upstream-first implementation ladder: first use an existing platform or Pi capability, then a pinned
and reviewable Skill, MCP server, plugin, package or platform CLI, then a small license-compatible vendored
mechanism or proven design, and only then write the smallest MilkSU-owned implementation. Record why the
earlier level was insufficient. “Mature” requires an inspectable source, compatible license, bounded
permissions, maintained releases and evidence for the relevant use case; popularity alone is insufficient.
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
- Keep smoke, fixtures, benchmarks and acceptance coordinators outside production startup, Wails bindings
  and Vue entrypoints as required by `docs/developer/product-code-admission.md`.
- A capability is not complete because a button, package or fixture exists; retain one real-task result.
- Preserve the user's unrelated working-tree changes.
- Each selected vertical slice is reviewed, tested, committed and pushed only to MilkSU's private remote.
- Development-time documentation records tests, receipts, checkpoints and necessary ADRs. Final architecture,
  milestone, status and release claims are updated only during the final documentation closeout.
