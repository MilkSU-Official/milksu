# PI Resource Whitelist

> 状态：**Living / Enforced**。打包清单、版本固定和 CTF 负向隔离以当前代码与 Sidecar Smoke
> 为准；“已加载”不等于专项能力已经 Verified。

MilkSU disables PI ambient discovery for Extensions, Skills, prompts, themes, and context files.
Only resources reviewed here may enter a packaged Agent session.

## Build-vs-buy rule

Coding Harness adopts a strict **reuse-first** policy:

1. If Pi core already owns the lifecycle, MilkSU calls Pi instead of reimplementing it.
2. If a reviewed Pi package provides a general Coding capability, MilkSU pins and adapts it instead of shipping an interim clone.
3. MilkSU-owned code is limited to desktop product boundaries that an extension cannot own safely: workspace/sandbox enforcement, credential isolation, explicit approval transport, Electron/Go RPC event-state projection, and user-data persistence.
4. Product-specific invention is concentrated in the CTF Agent: role orchestration, evidence, Judge, recovery, training memory, and ability calibration.
5. A planned Coding feature with a credible upstream candidate stays visibly `Planned` until that candidate is integrated or rejected with evidence. It must not accumulate a temporary bespoke harness meanwhile.

The goal is not the raw number of installed packages. The acceptance metric is a smaller MilkSU-specific control plane, with each external capability pinned, licensed, scoped, and tested in both positive Coding and negative CTF-isolation paths.

## Active resources

| Resource | Version / revision | Session scope | Capability | Controls |
| --- | --- | --- | --- | --- |
| `milksu-workflow` | MilkSU source | Coding + CTF roles | Visible progress and role-specific execution guidance | First-party; `milksu_progress` has a bounded schema and no external effects |
| `frontend-visual-qa` | MilkSU source | Normal Coding only | Tests, real preview and sandbox Browser evidence for frontend changes | First-party reviewed Skill; explicit Pi `/skill:frontend-visual-qa`; CTF sessions must not load it |
| `tt-a1i/archify` | `2.12.0` / `7b49d0b715fd4ba48116bcdecd1ba3789a279613` | Normal Coding only | Architecture, workflow, sequence, dataflow, and lifecycle diagrams | Pinned submodule; MIT; packaged commit check; CTF sessions must not load it |
| `@narumitw/pi-lsp` | `0.29.0` + reviewed MilkSU patch | Normal Coding only | `lsp_diagnostics` and reviewed `lsp_fix` through fixed language servers | Exact npm pin; MIT; MilkSU rejects multi-file/resource WorkspaceEdits that cannot be reviewed and applied atomically, forces a reviewed Go/Vue/TypeScript config, ignores repository commands, launches the real server with a non-secret environment, forces a dry-run before writes, validates the project path and hashes, shows a complete Diff in Ask, and verifies the applied text; TypeScript `5.3.0`, Vue `2.2.12` non-Hybrid mode, and TypeScript SDK `6.0.3` are bundled |
| `diff` | `8.0.4` | Normal Coding LSP adapter | Unified Diff generation for reviewed `lsp_fix` | Exact npm pin; BSD-3-Clause; only formats the upstream Pi LSP dry-run result; license copied into the Sidecar manifest |
| `@narumitw/pi-goal` | `0.43.0` | Normal Coding only | Pi-native goal lifecycle, alongside the desktop progress projection | Exact npm pin; MIT; CTF sessions keep MilkSU's recorder-owned progress and Judge semantics |
| `pi-better-background-tasks` | `0.1.10` | Normal Coding only | Conversation-owned background processes, bounded logs and stop | Exact npm pin; MIT; visible lifecycle; CTF sessions must not load it |
| `pi-mcp-adapter` | `2.17.0` | Normal Coding opt-in | Reviewed project MCP servers and first-party adapters | Exact npm pin; MIT; digest selection, sandbox, environment filtering and per-call desktop approval |
| `@playwright/mcp` | `0.0.78` | Normal Coding, explicit sandbox Browser or Browser Use | Dedicated-profile Browser control or extension-mode access to one user-approved real tab | Exact npm pin; Apache-2.0; the two modes have separate Scope/profile semantics; transient descriptor or extension pairing; no ambient whole-profile authority |
| `@napi-rs/system-ocr` | `1.1.0` | Normal Coding attachments | Local text extraction for images when the selected model has no vision | Exact npm pin; MIT; local-only fallback and explicit degradation disclosure |

The packaged Sidecar smoke test asserts both sides of the boundary. The
`ready.extensions` list is derived from the tools and flags actually registered
by the resource loader; it is not a hard-coded declaration:

- a normal Coding session exposes the reviewed frontend QA/Archify Skills, Goal, background tasks and the reviewed MCP Adapter;
  bundled TypeScript/Vue/Go LSP diagnostics are available, and Playwright appears only after the
  user explicitly starts the Coding Browser;
- a CTF session exposes none of these external resources and continues to use
  MilkSU's dedicated CTF tools and recorder-owned retry semantics.

`pi-lsp` diagnostics and the reviewed TypeScript, Vue, and Go write-fix paths are **Verified**.
MilkSU deliberately
overrides both repository and user LSP configuration with `PI_LSP_CONFIG`.
The fixed commands run through `/usr/bin/env -i` and receive only `HOME`,
`PATH`, `TMPDIR`, `LANG`, and `LC_ALL`; provider and relay credentials do not
reach the language server. Clean macOS packages include reviewed TypeScript,
Vue and Go servers in `milksu-sidecar/lsp-runtime`; the packaged-app fixtures returned
`TS2322` at `1:14` and `compiler.IncompatibleAssign` at `3:21` without modifying
their source files. A packaged TypeScript fixture also verified `source.organizeImports`
under “替我审批” and “请求批准”: the desktop showed the full unified Diff,
approval applied the reviewed text, and rejection preserved the original SHA-256.
Packaged Vue and Go fixtures now verify the same action under “替我审批” with exact
before/after SHA-256 values and reviewed unified Diffs. Vue uses the official
`@vue/language-server@2.2.12` non-Hybrid mode with MilkSU's fixed TypeScript SDK; this avoids
requiring an ambient editor-owned tsserver plugin bridge. MilkSU's reviewed `pi-lsp` patch rejects
cross-file text edits and create/rename/delete resource operations instead of partially applying
the current file.
`gopls v0.23.0` is built from the verified official module
sum and commit, and its BSD-3-Clause license and binary SHA-256 are recorded in
the Sidecar manifest.

## Reviewed but not active

| Resource | Decision |
| --- | --- |
| Pi plan-mode example/package | Preferred source for the Agent-side plan lifecycle. MilkSU's UI may project the plan, but must not grow a second planning engine. Integrate only after its embedded/non-TUI events map cleanly to the desktop composer. |
| `pi-sub-agent` | Preferred multi-agent candidate. It already supplies isolated subprocess contexts, single/parallel/chain modes, bounded output, abort propagation, role presets, and recursion prevention. Activation still requires a packaged `pi` executable, parent-tool narrowing, budget projection, and visible desktop status. Do not build a competing subagent runner. |
| `tomsej/pi-ext` permissions | Preferred rule-matching/reference implementation for safe/read-only modes. Pi itself explicitly has no built-in permission boundary, so MilkSU must retain its OS sandbox and credential isolation. The extension's TUI confirmation cannot silently stand in for the missing desktop approval protocol. |
| `tomsej/pi-ext` Session Snap / Query / Handoff | Preferred candidates for archive, recall, and fresh-session handoff. Reuse their session semantics where possible; MilkSU supplies repository-grouped navigation and desktop persistence. |
| `tomsej/pi-ext` Code Review / Tool Pills / `pi-sem` | Preferred candidates for review workflow, compact tool rendering, and semantic change inspection. Evaluate measured context cost before enabling semantic tools by default. |
| `tomsej/pi-ext` Ask User Question | Preferred structured clarification candidate once extension UI requests can round-trip through the Desktop RPC. |
| `pi-chrome-devtools` | Do not load. It duplicates the explicit browser pairing boundary and would widen browser authority. |
| IDA Pro/idalib, Burp, radare2, Ghidra, Semgrep MCP | Security pilot candidates, not active resources. Review and pin one upstream per tool, start read-only/minimal, separate read/write/execute/network effects, keep credentials out of context, retain a real Coding task and a denied over-scope receipt, then decide whether to promote it into CTF/CVE. |
| Community CTF Skill packs | Do not bulk install. Select one category Skill only after a real failed trajectory establishes the need; review scripts and tool prerequisites before activation. |

Pi's official documentation states that Pi runs with the launching process's filesystem, process, network, and credential authority unless it is sandboxed or containerized. Therefore the MilkSU OS sandbox is platform code, not a duplicate plugin feature. A community permission matcher can improve policy authoring, but cannot replace the enforcement layer.

## MilkSU custom-code disposition

| Current area | Decision | Target |
| --- | --- | --- |
| Pi SessionManager, context compaction, model/tool loop | Keep upstream-owned | Remove MilkSU behavior that duplicates Pi lifecycle decisions |
| `milksu_progress` | Thin projection only | Replace its planning semantics with the selected Pi plan/task package; keep only the bounded Desktop RPC event schema |
| Coding permission matcher | Reduce/replace | Reuse a reviewed permission package's matching rules where embedding permits; retain MilkSU sandbox, credential boundary, and desktop approval transport |
| Agent-side subtask orchestration | Do not build | Integrate `pi-sub-agent` after packaged-runtime and budget tests |
| Session archive/query/handoff | Do not build | Evaluate Session Snap / Query / Handoff and adapt only desktop navigation/state |
| Code review and semantic diff | Do not build from scratch | Evaluate Code Review / Tool Pills / `pi-sem`; MilkSU owns file/diff presentation in the right panel |
| Architecture diagrams, LSP, retry | Keep pinned external resources | Keep the reviewed `gopls` package gate and thin LSP review adapter, expand language fixtures, and avoid feature forks |
| CTF recorder, Judge, evidence, role handoff, learning memory | Keep MilkSU-owned | This remains the product's primary innovation surface |

## Update procedure

1. Review the exact source revision and license; never use a floating branch or unpinned package.
2. Record session scope and whether the resource can read, write, execute, access the network, or load more resources.
3. Keep ambient discovery disabled.
4. Add a positive Coding smoke assertion and a negative CTF isolation assertion.
5. Run the Sidecar smoke test and the full regression command
   (`npm run m3:release-check`; the script name is retained for compatibility) before publishing.
6. Copy the direct dependency license into `THIRD_PARTY-LICENSES` and record its path in the Sidecar manifest.
7. Push only to a MilkSU-owned repository. Never open a PR or write to the upstream project.
