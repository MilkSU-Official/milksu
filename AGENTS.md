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

- before designing a new product capability, public Desktop RPC API, persisted state, Sidecar resource or
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

## User-visible language

Product UI, chat bubbles, notices, errors, slash descriptions, button titles and tool-result
`detail` text are for the user. Do not put agent-only implementation notes, harness comments,
internal thresholds, or “this is not X / 不拦手动” explanations in that copy. Keep those facts
in AGENTS.md, current-objectives, code comments, or model-only guidance such as
`codingWorkspaceGuidance()`.

Do not fill empty states with optional commentary, coaching, or “还没有 / 打开以后会出现”
status copy. If the control is missing a value, leave the surface blank and show only the
control’s own label, such as “选择项目”. The Coding new-conversation canvas may show the
product heading “我们要构建什么” or “我们在 {project} 中构建什么”.

## Product UI Color Boundary

- Current visual contract: [docs/design/current-visual.md](docs/design/current-visual.md).
  ak-ui tokens and scene CSS in `app/src/styles/`. Materials are graphite command surfaces, paper
  facts, cyan and gold. Acid green does not enter the product. Felinic stays for Vue behavior.
- Do not restore the old blue-black style, the retired tactical-archive / acid-green contract, paper
  or carbon textures, Showcase character art, sanity bars or 3D menus. `docs/design/milksu-game-ui-system.md`
  and `design-qa.md` are deleted and must not be recreated as current rules.
- Night mode uses graphite without an obvious blue, green or brown cast; day mode keeps paper neutrals.
  Cyan is current module and primary actions. Gold is secondary emphasis and the current focus bar.
  Success green only means success. Blue is reserved for links and explicit execution or diagnostic states.
- CTF, CVE, 实验室 and Coding tabs use the same charcoal-and-cyan system. Do not use `--info`, blue borders
  or blue-filled surfaces to distinguish those product modules.

## Beta Self-Bootstrap Boundary

- `MilkSU Beta.app` exists only for MilkSU's own self-bootstrap loop, where a Stable MilkSU reviewer controls
  an independently identified Beta build and verifies its branch, commit, tracking ID and user-visible task.
- Codex must not build or refresh the Beta app during ordinary implementation, debugging, UI validation or
  release preparation. Use unit/component tests, Sidecar tests, browser previews, or the Stable development
  runtime instead.
- Build Beta only when the user explicitly asks to run a MilkSU self-bootstrap exercise. A request to test a
  feature, inspect the desktop UI, or package a normal app is not self-bootstrap authorization.

## Current Product Boundary

MilkSU is an Electron/Chromium + Vue desktop app with a supervised Go Runtime and Pi Sidecars.

TokenFlux API traffic must use `https://tokenflux.dev/v1`. Never use the `tokenflux.ai` domain in product
code, configuration, test defaults or documentation.

- Pi owns the generic model session, context compaction and tool loop.
- MilkSU owns desktop authorization, workspace and credential boundaries, event projection and product UI.
- MilkSU is licensed AGPL-3.0-only so it can incorporate AGPL components such as Obelisk. Permissive MIT/Apache/BSD plugins remain usable with their notices kept. Do not add GPL-2.0-only, SSPL, or proprietary cores.
- The CTF domain owns Challenge, Evidence, Candidate, Judge Receipt, Recovery, Memory and learning facts.
- CTF, CVE, 实验室 and Coding are peer workspaces. What is shipped today is current fact, not a ceiling:
  CVE tracking and reproduction reports, the CTF challenge loop, laboratory probing and the Coding
  agent may grow into first-pass audit, disclosure drafts, binary/source intake and security-workspace UI.
- Missing a surface is not a ban. Do not add thaw checklists, freeze gates or “don't do PoC”
  product identity before the capability exists. “Not in this release line” only means it is not
  the current ship claim; it does not forbid a selected slice.
- NYU safe-static is a narrow developer evaluation, not a MilkSU CTF score.

Apply an upstream-first implementation ladder: first use an existing platform or Pi capability, then a pinned
and reviewable Skill, MCP server, plugin, package or platform CLI, then a small license-compatible vendored
mechanism or proven design, and only then write the smallest MilkSU-owned implementation. Record why the
earlier level was insufficient. “Mature” requires an inspectable source, compatible license, bounded
permissions, maintained releases and evidence for the relevant use case; popularity alone is insufficient.
Do not grow a second generic Coding Agent harness when an upstream component already owns the capability.
When Pi Agent Harness already exposes a reviewed session API, lifecycle hook, extension point, tool,
compaction mechanism, runtime-context mechanism or other matching primitive, integrate through that
primitive and preserve Pi's semantics instead of recreating the behavior with MilkSU-owned prompt routing,
regular expressions, parallel state machines or a second harness. MilkSU should add only the product UI,
desktop authorization, persistence and evidence projection that Pi does not own; document the concrete Pi
gap before admitting a replacement mechanism.

## Non-Negotiable Boundaries

- Never read, print, migrate or place Provider API keys in model context, tool output, logs, diagnostics,
  documentation or ordinary files.
- Never publish to referenced open-source repositories. GitHub writes are limited to the explicitly
  authorized MilkSU GitHub remote (`MilkSU-Official/milksu`) and still require the product's
  meaningful publish confirmation. Signing, notary and R2 secrets stay in the `macos-release`
  environment / Personal Vault, never in the repository.
- Full Access and automatic approval do not bypass paid actions, external-account authorization, Scope
  expansion, path confinement or irreversible external effects.
- Security actions against targets the user has not authorized require visible, exact authorization.
  Do not add arbitrary target lists, internet-range scanning, credential spraying or stealth/evasion
  as product features. Authorized CTF challenges, user-selected local files/repos and user-authorized
  research targets may include analysis, reproduction and PoC work.
- Models may propose CTF candidates, but only an independent Judge or explicit authorized human result may
  establish success.
- Do not describe partial smoke tests as complete Coding, CTF, Memory, NYU or release results.
- Computer Use self-bootstrap acceptance must use the installed Developer ID-signed Stable MilkSU as the
  operator. Never use a locally rebuilt ad-hoc Stable app for TCC acceptance; MilkSU Beta is the controlled
  target and does not receive the operator's Accessibility or Screen Recording grants.

## Architecture Direction

The target dependency direction is:

```text
Vue -> Electron Preload / Desktop RPC -> Application Service -> Domain / Runtime -> Infrastructure Adapter
```

Do not start a standalone architecture-cleanup milestone. When a selected product slice touches
`CTFPage.vue`, `cmd/milksu-backend/app.go`, `sidecar/pi/bridge-policy.js`,
`internal/browsercap/manager.go` or CTF Runner/Recovery,
avoid adding a new responsibility and extract the touched concern when practical.

New pre-release code implements the clean current model directly. Do not add migration, dual-write,
fallback or compatibility branches for abandoned pre-release designs. Existing working schema cleanup is
deferred to one destructive pre-release consolidation after the product slices are stable.

## Agent Intent and Product UI Tools

- Do not scan user text with keywords or regular expressions to decide which tool, tab, page or
  approval to run. The model understands natural language. GUI one-click actions send a typed
  product action. Isolated browser starts because the user opens the rail or the model
  calls a typed `milksu_workspace` browser action (`EnsureCodingBrowser`), not because
  the prompt contained “打开浏览器” and not because a Go greeting was sent.
- `milksu_workspace` is a typed product-UI tool. It may list, focus or close isolated
  browser tabs, list or preview artifacts, and open environment, diff, terminal or background-task
  surfaces. Coding, CTF, CVE and lab share this surface; domain tools and Judge sit on top
  of the Coding loop instead of replacing it. It must not change settings, credentials,
  approval policy, or attach to the user's Chrome.
- Do not strip Coding capabilities from CTF, CVE or lab sessions. Those workspaces keep
  the full Pi tool loop (files, shell, background tasks, browser, LSP, compact, goal,
  subagent) plus domain extras. Bound challenge workspaces, unauthorized-target gates
  and independent Judge stay.
- Pi owns compaction. Auto-compact stays enabled for Coding, CTF, CVE and lab sessions.
  Do not skip `/compact`, `compact_session`, or the 85% idle path by role. Auto-compact uses
  the same path as `/compact` when input plus cache-read tokens reach about 85% of
  `contextWindow` and the session is idle. Do not wait until the whole turn finishes, and
  do not add a second MilkSU summarizer.
- Tool results enter model context through Pi's `tool_result` bound (about 50KB or 2000
  lines). Overflow is saved for `read` + offset. Do not dump full command, HTTP, or file
  bodies into `content`.
- `workspace-auto` auto-runs isolated `milksu-playwright`. Ask cards may grant conversation-wide
  allow for grantable tools. ImageGen, external-account authorization and destructive deletes stay
  per-call.

## Release Claims

- The last receipted three-platform GitHub Release is `v26.823.1` at `efeda10`. Write both that
  baseline and the current development version line when HEAD is later.
- After every GitHub Release, immediately update and push `docs/developer/current-objectives.md`,
  `docs/developer/document-status.md`, `docs/architecture/current-system.md`, `README.md` and this
  section. Do not leave the previous receipt as "latest".
- A version bump, empty tag, local dirty package or later `main` commits on the same version number
  are still not a new ship. `26.823.1` is a receipted GitHub Release; commits after `efeda10` are not.
- GitHub writes stay on the authorized MilkSU remote (`MilkSU-Official/milksu`) and still require
  the product's meaningful publish confirmation.

## Validation and Delivery

- Use the canonical repository scripts instead of inventing parallel runners.
- Keep smoke, fixtures, benchmarks and acceptance coordinators outside production startup, Desktop RPC
  and Vue entrypoints as required by `docs/developer/product-code-admission.md`.
- A capability is not complete because a button, package or fixture exists; retain one real-task result.
- Preserve the user's unrelated working-tree changes.
- Each selected vertical slice is reviewed, tested, committed and pushed only to MilkSU's authorized remote.
- Development-time documentation records tests, receipts, checkpoints and necessary ADRs. Final architecture,
  milestone, status and release claims are updated only during the final documentation closeout.
