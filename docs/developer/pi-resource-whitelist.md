# PI Resource Whitelist

MilkSU disables PI ambient discovery for Extensions, Skills, prompts, themes, and context files.
Only resources reviewed here may enter a packaged Agent session.

## Active resources

| Resource | Version / revision | Session scope | Capability | Controls |
| --- | --- | --- | --- | --- |
| `milksu-workflow` | MilkSU source | Coding + CTF roles | Visible progress and role-specific execution guidance | First-party; `milksu_progress` has a bounded schema and no external effects |
| `tt-a1i/archify` | `2.12.0` / `7b49d0b715fd4ba48116bcdecd1ba3789a279613` | Normal Coding only | Architecture, workflow, sequence, dataflow, and lifecycle diagrams | Pinned submodule; MIT; packaged commit check; CTF sessions must not load it |
| `@narumitw/pi-lsp` | `0.29.0` | Normal Coding only | `lsp_diagnostics` and opt-in `lsp_fix` through installed language servers | Exact npm pin; MIT; source reviewed; project config loads only for trusted workspaces; `write` defaults to false; CTF sessions must not load either tool |
| `@narumitw/pi-retry` | `0.31.0` | Normal Coding only | Classifies known transient provider failures for Pi's built-in bounded retry path and detects stalled streams | Exact npm pin; MIT; source reviewed; does not implement a second retry loop; CTF sessions keep MilkSU's recorder-owned retry and budget semantics |

The packaged Sidecar smoke test asserts both sides of the boundary:

- a normal Coding session exposes Archify, `lsp_diagnostics`, `lsp_fix`, and the
  `pi-retry` extension;
- a CTF session exposes none of these external resources and continues to use
  MilkSU's dedicated CTF tools and recorder-owned retry semantics.

## Reviewed but not active

| Resource | Decision |
| --- | --- |
| `pi-plan-mode` | Do not load yet. It overlaps MilkSU's progress workflow and introduces a second planning UX. |
| `pi-subagents` | Keep under review. Multi-agent delegation is useful, but its budget, context, and handoff semantics must map to MilkSU Recorder before activation. |
| `pi-chrome-devtools` | Do not load. It duplicates the explicit browser pairing boundary and would widen browser authority. |
| `tomsej/pi-ext` permissions / review extensions | Reference patterns only until SDK embedding and non-TUI behavior are verified. |
| Community CTF Skill packs | Do not bulk install. Select one category Skill only after a real failed trajectory establishes the need; review scripts and tool prerequisites before activation. |

## Update procedure

1. Review the exact source revision and license; never use a floating branch or unpinned package.
2. Record session scope and whether the resource can read, write, execute, access the network, or load more resources.
3. Keep ambient discovery disabled.
4. Add a positive Coding smoke assertion and a negative CTF isolation assertion.
5. Run the Sidecar smoke test and the M3 release check before publishing.
6. Push only to a MilkSU-owned repository. Never open a PR or write to the upstream project.
