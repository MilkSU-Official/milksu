# MilkSU Repository Guidance

## Start Here

Before changing anything, read:

1. `docs/developer/current-objectives.md`;
2. `docs/developer/document-status.md`;
3. `docs/architecture/current-system.md`;
4. the current Git branch, HEAD and working tree.

Product UI language lives only in this file (`Product UI Design Language` below).
Do not restate layers, tokens or primitives in other docs.

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
  feature flag, and when checking three-platform productization for that capability;
- before adding a user-visible page or changing the design language;
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

The product UI is bilingual: Simplified Chinese and English. Settings → 界面语言 / Interface
language switches both. Default is Chinese. Every user-visible Chinese string in Vue, composables
and frontend lib copy must be wrapped with `t('中文', 'English')` from `app/src/lib/uiLocale.ts`.
When you add or change Chinese UI copy, change the English argument in the same edit. Do not
leave a Chinese-only control, notice, empty state, aria-label, placeholder or button. Module
names CTF, CVE, Lab and Coding stay as those product names in both languages. Enforcement:
`app/src/lib/uiLocaleCoverage.test.ts`.

## Product UI Design Language

This section is the only product UI language. Other docs point here; they must not
copy the layer table, token names, radii or Beautiful UI primitive numbers.

Review this section by layer. Do not invent a second primitive at the same layer.

| Layer | Owns | Use |
| --- | --- | --- |
| Materials | tokens, color, type, motion | Beautiful UI is the dominant language: cool white / cool black with a restrained clear material. One opaque wash, then a single 74–92% chrome/card fill — do not stack two page fills or they go solid. Hairline + top specular. `backdrop-filter` only on composer, menus, dialogs and the conversation dock. Reading surfaces stay denser. The window stays opaque on all three platforms; do not punch through to the desktop, and do not ship macOS vibrancy or Windows Mica as the product look. Later tuning changes wash contrast or fill %, not a second glass primitive. 8px rows, `--hover-2`, 280ms `cubic-bezier(0.16, 1, 0.3, 1)` enter. Cyan / gold are execution and focus, not page chrome. Fonts: Inter Variable + Noto Sans SC Variable. |
| Shell | sidebar, topbar, page column | one Beautiful UI 14 sidebar (`ContextSidebar`). Collapsed 52px; expanded min 224px, default 264px, drag the right edge to resize. Selected chat rows are a full 8px rounded rectangle. Footer: version (vertically centered) plus a theme icon; the icon stays when collapsed. Workspace avatar menu is only as wide as its items. `WorkspaceModuleTopBar`, `--page-stack-width` 64rem. Coding right rail, bottom terminal, settings nav, profile panels and catalogs use the same 14 chrome. Window frame is one shell on three platforms: macOS `hiddenInset` with traffic lights over the sidebar; Windows and Linux hide the native caption and in-window menu, paint a canvas-colored overlay, and keep system buttons top-right. Do not leave a mac traffic-light hole on Windows or Linux, and do not add a second white title bar. |
| List chrome | filters, History, primary action | `WorkspaceCatalogActions`: History + Import (CTF/CVE) or Create (Lab). Catalog tables use canvas fill, not gold / paper / cyan row backgrounds. Filter inputs, selects and outline buttons use 8px radius. **ak-ui easter eggs:** `.ak-segmented` filters and `ak-tag` chips for category, difficulty, severity, daily challenge. |
| Facts | cards, tables, dialogs, status | Felinic `SettingsSection` / `SettingsRow` / `ActionCard` / `ModelListRow` with 8px radius and the clear `--card` fill. Settings list rows, tool workbench and field controls use the same 8px radius. **ak-ui easter egg:** `ConnectionLiveStatus` LIVE/OFF, and the module topbar mark. |
| Copy | user-visible strings | `t('中文', 'English')`; empty controls stay blank |
| Agent conversation | Coding / CTF / CVE / lab chat | Beautiful UI primitives: 03 stream edge (real Pi tokens, solid 2px caret; streamed glyphs stay sharp), 04 ask rows, 05 chips, 06 plan capsule (pull-up min 18rem so step text is readable), 08 prompt island, 18 code blocks. Do not put ak-ui cards in this layer. |

Home chat fills the column right of the sidebar. CTF / CVE / lab default to one
dismissible dock (close is X unmount). Maximize covers everything right of the
sidebar; the right rail stays in-flow beside the thread. Do not stack docks, put a
session list inside a dock, or put `MissionOperationPanel`, domain-task chrome or
“返回 CTF” in the conversation column.

Shared CSS lives in `app/src/index.css`, `app/src/styles/beautiful-chrome.css` and `app/src/styles/agent-conversation.css`. Felinic stays for Vue
behavior. Do not add `@yunyoujun/ak-ui` to `app/package.json`. Do not vendor Beautiful UI's
React runtime, `globals.css` or paid `@central-icons-react`. ak-ui is **not** the product
language; keep only the easter eggs named above. Retired graphite / paper / tactical /
acid-green drafts are not current. Enforcement:
`WorkspaceVisualContract.test.ts`, `globalStyleContract.test.ts`,
`WorkspaceCatalogActions.test.ts`, `ConnectionLiveStatus.test.ts`.

Review a new page, settings category, dossier, dialog, preview, Vue/CSS/copy change, or
incoming PR against those layers. A screenshot is not a review. Do not invent a
one-off max-width, radius, padding, card, or color to finish one page.

### When the user changes the UI

If the user — not the agent — changed layout, color, spacing, typography or component choice
(working tree, pasted screenshot, follow-up instruction, or an edit they made in the app), do
not silently revert to this language and do not silently rewrite this language to match the
one-off. Ask in Chinese whether to:

1. update the design language (this section, shared CSS/tokens, and the
   visual-contract tests) so later pages follow the new rule; or
2. keep this language and treat the edit as a one-off to align or isolate.

## Productization and three-platform support

MilkSU ships macOS, Windows and Linux. Every new product capability must be designed for those
three platforms, and for a user who is not this developer.

- Do not hardcode operating-system or this-machine paths. Forbidden in product Go,
  Electron, Sidecar, Vue and packaging: `/tmp`, `/private/tmp`, `/var/tmp`,
  `/run/user/<uid>`, `/Users/...`, `C:\Users\...`, Homebrew prefixes, `/usr/bin/open`,
  a Docker socket that already exists here, or a binary that only lives in this checkout.
  Unix-domain sockets that overflow `sockaddr_un` are not an excuse to paste `/tmp` or
  `/private/tmp`; shorten the filename under the platform ephemeral root instead.
- Resolve paths through Go / Electron platform APIs and the existing app-data / Documents
  `MilkSU` layout. Ephemeral/runtime directories use `os.TempDir()`, Node `os.tmpdir()`,
  and Linux `$XDG_RUNTIME_DIR` via `internal/hostpath` and `sidecar/hostpath.js`. Go,
  Sidecar and tests must call that helper; tests must not paste `/private/tmp/milksu-...`
  as the expected product path. After reading the platform env, a documented OS default
  such as `%SystemRoot%\System32` is allowed. Opening folders uses a trusted path from
  Go plus the host shell, not a macOS-only command.
- First-run must be a product path: detect what is on the machine, show Settings, offer a
  default, and let the user point to a path or sign in. Other users must be able to turn the
  feature on without reading the repo, exporting environment variables, or copying a personal
  config.
- Hidden env vars, undocumented CLI flags, and “run this script from the checkout” are not a
  configuration surface. If a tool needs a local install (IDA, Docker, Android SDK), Settings
  detects it, names the missing piece, and provides the next action.
- If a platform cannot support the capability yet, say so in the product UI and in
  `current-objectives.md`. Do not ship the macOS path as if it were the product, and do not
  leave Windows/Linux as an unhandled crash or a blank control.
- Credentials, TCC / Accessibility and code signing stay on their existing boundaries. A
  feature that only works after this developer grants extra OS permissions is not done until
  the in-product permission path exists.

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
When the selected Agent Harness already exposes a reviewed session API, lifecycle hook, extension point, tool,
compaction mechanism, runtime-context mechanism or other matching primitive, integrate through that
primitive and preserve that harness's semantics instead of recreating the behavior with MilkSU-owned prompt routing,
regular expressions, parallel state machines or a second harness. MilkSU should add only the product UI,
desktop authorization, persistence and evidence projection that the harness does not own; document the concrete
harness gap before admitting a replacement mechanism.

Progressive disclosure follows the currently selected Agent Harness core. Today that core is Pi
(`pi-coding-agent` 0.84.1): Skill catalogs stay at `name` + when-to-use `description`, bodies load with
`read` or `/skill:name`, slash-only skills use `disable-model-invocation`, and fat optional tools
`registerTool` first then activate through the harness (Pi Dynamic Tool Loading or a typed product action).
Do not add a MilkSU-owned injector that keyword-scans user text, pastes Skill bodies or tool-action essays
into the system prompt, or guesses when to inject context. If the selected core later becomes another
reviewed harness (for example DeepSeek Harness), use that harness's native skill and tool disclosure and
drop Pi-specific prompt leftovers; do not keep a MilkSU disclosure adapter that tries to look the same on
every harness.

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

- Progressive disclosure is owned by the selected Agent Harness, not by MilkSU prompt routing.
  For the current Pi core: put when-to-use on the Skill or tool `description`; do not repeat it as a
  system-prompt MUST essay; do not paste Skill bodies into the system prompt. If the core changes
  (for example to DeepSeek Harness), follow that core's disclosure instead of copying Pi's catalog
  format or keeping a MilkSU injector.
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
- `milksu_ask` is a typed product-UI tool for Beautiful UI 04 choice cards. The model
  calls it when the user must pick among 2–6 concrete options; the conversation shows
  a question plus selectable rows and pauses until one is chosen. Do not regex the
  prompt for “给我几个选项”, and do not treat this as tool-permission HITL
  (deny / allow once / always allow).
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

- The last receipted three-platform GitHub Release is `v26.905.2` at `b18b860`. Write both that
  baseline and the current development version line when HEAD is later. Keep `v26.905.1`, `v26.904.1` and
  `v26.827.1` as previous downloadable releases, not Latest.
- After every GitHub Release, immediately update and push `docs/developer/current-objectives.md`,
  `docs/developer/document-status.md`, `docs/architecture/current-system.md`, `README.md` and this
  section. Do not leave the previous receipt as "latest".
- A version bump, empty tag, local dirty package or later `main` commits on the same version number
  are still not a new ship. `26.905.2` is a receipted GitHub Release; commits after `b18b860` are not.
- GitHub writes stay on the authorized MilkSU remote (`MilkSU-Official/milksu`) and still require
  the product's meaningful publish confirmation.

## Validation and Delivery

- Use the canonical repository scripts instead of inventing parallel runners.
- Keep smoke, fixtures, benchmarks and acceptance coordinators outside production startup, Desktop RPC
  and Vue entrypoints as required by `docs/developer/product-code-admission.md`.
- Incoming PRs and selected slices that touch product UI must pass the design-language review in this
  file. Incoming PRs and selected slices that add a capability must pass the productization /
  three-platform review.
- A capability is not complete because a button, package or fixture exists; retain one real-task result.
- Preserve the user's unrelated working-tree changes.
- Each selected vertical slice is reviewed, tested, committed and pushed only to MilkSU's authorized remote.
- Development-time documentation records tests, receipts, checkpoints and necessary ADRs. Final architecture,
  milestone, status and release claims are updated only during the final documentation closeout.
