---
name: reverse-engineer-anything
description: Reverse engineer shipped artifacts (native binaries, Electron/ASAR, .NET assemblies, APKs, archives) with the milksu-rea MCP tools when a claim depends on a packaged artifact rather than available source. Use it to explain features, decompile functions, trace IPC boundaries, compare packaged versions, and export evidence. Do not use REA for ordinary source-repository analysis; use normal file and search tools for that.
---

# REA (milksu-rea)

Use the `milksu-rea` MCP tools when a claim depends on a shipped binary, package,
or decompiled behavior that available source cannot answer. For ordinary
analysis of a source repository, use normal repository tools instead.

## Availability

The `milksu-rea` server is prepared in Settings -> Security Tools (REA). It is
pinned locally; there is no `rea setup` step and no registry access from a
session. If the tools are absent, tell the user to open Settings -> Security
Tools and run Prepare for REA, then start a new conversation.

Call `binary_session` with `{}` first and read `result.tool_availability` to
see which operations work for the current target, host, and engines. A tool
marked unavailable reports `reason` and `remediation`; surface that text
instead of guessing. Native decompilation needs a locally installed Hopper,
Ghidra, or IDA engine. JavaScript, .NET, and artifact inspection need no
engine.

## Scope

- The target artifact must live inside the current workspace. If the user
  names an application elsewhere, ask them to copy the artifact into the
  workspace; do not read outside it.
- REA runs offline and read-only for this surface: no runtime observation,
  process capture, browser control, or network capture here. Static analysis
  only.
- Do not run REA analysis over the workspace's own source tree when the
  question is about repository structure.

## Route the target first

Pick the first tool from what the user supplied:

- ASAR or extracted JavaScript/Electron tree: `analyze_javascript_application`.
- Archive or package member inventory (ZIP/APK/IPA/DMG/MSIX): `open_binary`,
  then `inspect_artifact` when its graph helps.
- Android APK classes and methods: `inspect_android_package`.
- Managed .NET assembly: `inspect_managed_artifact`.
- Native binary: `open_binary`, then `binary_overview` for context, then
  focused tools (`analyze_function`, `inspect_analysis_view`).
- A feature question on an Electron app once a seed is known:
  `trace_application_feature`.

If the user did not name a target, ask which artifact to inspect. Never pick
an example app on the user's behalf.

## Work summary-first

Start with the default result and its inline evidence. Do not repeat an
identical call. Make a focused follow-up only when the returned result leaves
a specific question open.

Large results: when a tool reports a resource constraint, call
`inspect_analysis_view` with the reported evidence reference for a summary,
one section, or a stable page. Never refetch a full oversized result. Use
`export_evidence_bundle` to write the complete session evidence to a
workspace path when the user asks for a record.

Every conclusion must distinguish observations, inferences, and unknowns.
Cite evidence IDs (`ev_...`) for each claim, keep limitations and coverage
caveats, and never imply static analysis observed execution.

## Unknowns

Record unresolved questions with `record_unknown` when the investigation
leaves a concrete gap, naming the evidence that would resolve it. Review
`list_unknowns` before finishing so open questions are visible.

## Finish

Explain findings in plain language tied to evidence IDs. When the user asks to
build something from the findings, switch to normal coding tools and separate
observed behavior from design choices. Close an opened native session with
`close_binary` when the investigation is complete.
