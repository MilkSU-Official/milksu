# MilkSU M3 Architecture Review

> 状态：**Historical**。当前事实以
> [架构快照](/architecture/) 与
> [文档状态登记](/developer/document-status) 为准；本页保留 2026-07-31 的审阅证据。
>
> Review date: 2026-07-31
>
> Scope: current `codex/authorized-learning-foundation` implementation, packaged Sidecar, local persistence, Vue desktop surface, NSSCTF / CTFshow adapters, permission-gated external platform facts, and CTF runtime.
>
> Companion diagrams: [system architecture](/architecture/milksu-system.architecture.html) and [CTF solve loop](/architecture/ctf-solve-loop.workflow.html).

## Executive assessment

MilkSU has a coherent product kernel: the model does not own solved state; the CTF Runtime persists
evidence; platform adapters produce authoritative Judge receipts; credentials and training data stay in
the user data directory; and PI is embedded behind a curated resource boundary.

The project is not “architecturally out of control,” but four files have become change concentrators:

| File | Current size | Concentrated responsibilities |
| --- | ---: | --- |
| `app/src/components-vue/CTFPage.vue` | 3,553 lines | platform picker, catalog paging, browser pairing, challenge desk, Agent launch, history, ability UI, Judge state |
| `app.go` | 1,917 lines | Wails facade, settings, conversations, active CTF platforms, Arena, memory, reports, Vuln entry points |
| `internal/browsercap/manager.go` | 1,787 lines | browser sessions, policy, extension installation, pairing server, NSSCTF and CTFshow commands/results/persistence |
| `internal/ctf/service.go` | 1,683 lines | job commands, runner lifecycle, recorder ingestion, candidate gate, recovery, external Judge, cancellation |
| `bridge-policy.js` | 1,785 lines | Coding/CTF tool policy, path enforcement, command sandbox, custom CTF tools, capability projection |

These are maintainability risks, not a reason for a rewrite. The correct sequence is:

1. freeze the real NSSCTF P3879 `correct=true` receipt as an integration fixture;
2. close the clean-install catalog, paired-page intake, and ambiguous Judge recovery gaps;
3. split the four change concentrators behind their existing public contracts;
4. keep product work moving on the extracted seams.

## What is structurally strong

### Authoritative completion boundary

`internal/ctf` separates a model candidate from platform acceptance. NSSCTF, CTFshow, and local
fixtures normalize their result into a Judge receipt before solved state changes. This is the most
important invariant in the product and must survive every refactor.

### Evidence-first runtime

`internal/securityruntime/store.go` uses an append-only SQLite Event Store with WAL, `synchronous=FULL`,
JSON validation, monotonic per-job sequence, and update/delete triggers. Workspaces, artifacts,
checkpoints, replay, budgets, and debriefs are stored outside the model context.

### Local-first data root

`internal/appdata/directory.go` resolves `os.UserConfigDir()/com.milksu.app` and enforces directory mode
`0700`. Event stores, catalogs, credentials, memory, browser pairing, and workspaces are not written into
the application bundle or repository.

### Agent resource boundary

PI ambient Skills, Extensions, prompt templates, themes, and context files are disabled. Normal Coding
loads only reviewed resources from the [PI Resource Whitelist](pi-resource-whitelist.md); CTF sessions
do not inherit Archify or PI LSP tools. Packaged smoke tests assert both the positive and negative sides.

### Platform scope becomes tool scope

NSSCTF and CTFshow use an explicitly paired browser tab. The model is not handed a user browser session
or a platform token. HTB Labs stays outside Agent scope because its Platform Rules prohibit standard
Labs content from being used to test, evaluate, benchmark, or develop AI without written permission.

## Findings and decisions

### P0 — Clean-user recovery is still a release gate

The product recorded a native desktop NSSCTF P3879 `correct=true` receipt. The remaining P0s are
clean-install catalog bootstrap, carrying the explicitly paired page text into the workspace, and
recovering a candidate after a timeout or ambiguous Judge receipt.

**Decision:** do not call the CTF experience MVP-complete until a clean user can reach an unsolved
challenge, produce a candidate, recover from an ambiguous Judge result, and finish with an authoritative
receipt. HTB is not an acceptance gate unless HTB grants written Agent permission.

### P1 — Extract facades; do not rewrite domains

`app.go` should remain the Wails binding surface, but delegate by product area:

- `AgentFacade`: conversations, model probe, send/abort;
- `TrainingFacade`: catalog, challenge start, memory, replay, reports;
- `NSSCTFWebFacade`: bridge status, attachment, Judge submission, Arena;
- `CTFShowWebFacade`: catalog sync, challenge import, Judge submission;
- `ExternalPlatformFacts`: restricted/planned status, policy boundary, and official human-only links;
- `VulnFacade`: current evidence slice.

The frontend and Wails method names can remain stable while implementation moves. This avoids a generated
binding migration during feature work.

### P1 — Split browser transport from platform adapters

`internal/browsercap.Manager` currently owns four separate concerns:

1. generic browser sessions and origin policy;
2. extension installation and persistent pairing;
3. loopback WebSocket command transport;
4. NSSCTF / CTFshow page-specific protocols and result parsing.

**Decision:** retain one loopback server, but move page protocols into adapter packages behind a
`PairedPageAdapter` interface. The transport should route typed envelopes and know nothing about NSSCTF
button labels, CTFshow catalogs, Flag formats, or platform result text.

### P1 — Split the Vue CTF screen by state ownership

The visual result can remain one guided desk, but `CTFPage.vue` should become composition rather than
implementation. Extract composables first, then panels:

- `useTrainingPlatform` — platform selection and capability state;
- `useCatalogSearch` — query, category, pagination, refresh;
- `useChallengeWorkspace` — selected challenge and current job;
- `usePairedJudge` — pairing, attachment, connection check, candidate submission;
- `useAgentHandoff` — role, model, launch/resume and recorder state;
- `useTrainingHistory` — history and debrief;
- `useAbilityProfile` — compact sidebar profile and radar data.

This reduces regression risk without changing the black/green Memoh design or returning to a dense
dashboard.

### P1 — Make database evolution uniform

The Event Store has a migration table, but credentials, memory, NSSCTF catalog, and CTFshow catalog create
tables independently. This is safe for their current first schema but fragile once columns change.

**Decision:** introduce a small shared SQLite migrator with numbered, transactional migrations and
per-database version ownership. Add startup backup/recovery tests before the first destructive migration.

### P1 — Plaintext SQLite credentials are an explicit product tradeoff

`credentials.db` is outside the app bundle, under a `0700` directory, and chmod'd `0600`; it is not
encrypted. This matches the requested “no Keychain” behavior, but local malware or another process
running as the same OS user can read it.

**Decision:** keep the current default for M3, never return secrets across Wails or include them in logs,
reports, backups, or support bundles. Later add an optional user passphrase/encrypted store rather than
silently returning to Keychain.

### P1 — Dependency advisories need a tracked upgrade window

The current root `npm audit` reports three high and three moderate advisories, including transitive
`brace-expansion` and `protobufjs` under PI, plus Vite/VitePress/PostCSS development-chain findings.
The newly added PI LSP extension is exact-pinned and does not introduce its own reported advisory.

**Decision:** do not run an unreviewed `npm audit fix`. Track a PI-compatible upgrade, rerun Sidecar
protocol tests, and treat the VitePress chain as build-time exposure only while the docs server remains
loopback-only.

### P2 — Retire the dual runner after parity evidence

`security-bridge.js` and `internal/engine/security_supervisor.go` remain a useful typed fixture baseline,
but maintaining both that path and the PI CTF path can create divergent semantics.

**Decision:** keep it through the clean-user NSSCTF acceptance flow as a regression oracle. Then freeze it to fixtures
or remove production reachability once PI covers cancellation, recovery, evidence, and Judge semantics.

### P2 — Platform capability must be data, not UI conditionals

NSSCTF, CTFshow, custom intake, and HTB expose different operations. The UI should render from capability
facts such as `catalog`, `attachments`, `instance`, `browser_pairing`, `official_api`, `judge`, and
`arena`, rather than growing platform-name branches.

**Decision:** extend the existing training platform registry and make readiness compute from required
capabilities. “HTB opens a configuration panel” must never be presented as “HTB supported.”

## Target module boundaries

```text
Vue Product Surface
  -> Wails Facades
      -> CTF Application Services
          -> CTF Domain + Evidence Runtime
          -> PlatformAdapter registry
              -> NSSCTF Browser Adapter
              -> CTFshow Browser Adapter
              -> Restricted platform facts / official links
              -> Local / Custom Adapter
          -> AgentEngine Adapter
              -> PI Coding Sidecar
                  -> reviewed Coding Skills / Extensions
                  -> MilkSU CTF tool policy
          -> EnvironmentProvider
              -> Local workspace
              -> Docker Lab
```

Rules:

- Vue may own view state, never solved truth.
- Wails facades translate and delegate; they do not parse platform payloads.
- Platform adapters own external protocol differences and return typed receipts.
- CTF Runtime owns candidate, evidence, checkpoint, debrief, and solved transitions.
- PI owns the generic Agent loop; MilkSU owns CTF scope, tools, budgets, and learning semantics.
- Credentials stay in the Go host and are injected only into the exact adapter that needs them.

## Refactor checkpoints

| Checkpoint | Acceptance |
| --- | --- |
| NSSCTF native E2E | One unsolved problem; attachment evidence; MilkSU candidate; paired Bridge submit; `correct=true`; debrief and ability update |
| HTB permission gate | No Agent access to HTB content or targets without written HTB permission or an explicit AI Range entitlement |
| Browser adapter split | Existing NSSCTF and CTFshow bridge tests pass without platform strings in transport package |
| App facade split | Existing Wails public method names and frontend generated bindings remain unchanged |
| CTFPage split | Same viewport and interactions; no dense dashboard regression; frontend build and targeted UI tests pass |
| SQLite migrator | Existing user databases open without data loss; migrations are idempotent and transactional |
| Legacy runner decision | PI parity evidence exists; production call sites are removed or explicitly retained |

## Review status

- Architecture diagram: showcase validation 9/9, 0 errors, 0 warnings; dark and light visual review passed.
- CTF workflow diagram: showcase validation 9/9, 0 errors, 0 warnings; dark and light visual review passed.
- Go internal package count: 15.
- Go internal test files: 47.
- Vue components in `components-vue`: 17.
- Current release status remains **M3 in progress** until clean-install NSSCTF bootstrap, paired-page intake, and ambiguous Judge recovery pass.
