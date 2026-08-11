---
name: release-milksu
description: Build, inspect, and promote a traced MilkSU desktop Beta from a clean commit, then update Stable only after real App verification. Use only inside the MilkSU repository when the user asks to package, audit, release, promote, or self-bootstrap MilkSU. Do not use for ordinary project releases or merely running local tests.
---

# Release MilkSU

Treat Beta as the executable acceptance candidate and Stable as a promotion of the same verified source.

## Confirm the source

1. Read `AGENTS.md`, `docs/developer/current-objectives.md`, `docs/developer/document-status.md`, `docs/architecture/current-system.md`, and the relevant canonical acceptance instructions.
2. Record the current branch, full HEAD, and working-tree state before packaging.
3. Preserve unrelated changes. Do not build a release candidate from an unexplained dirty tree.
4. Run the repository's canonical focused tests, Sidecar checks, frontend build, Go tests, and packaging checks proportional to the slice.

## Build and inspect Beta

Build `MilkSU Beta` with the canonical command from the clean commit. Fully quit any older Beta before launching the new bundle.

Before acceptance, open Settings and confirm the visible channel, branch, full commit, clean state, build time, and tracking ID. Verify Bundle identity, data-directory isolation, signature checks available in the current environment, and that Stable cannot select itself for Computer Use.

## Run real acceptance

Use Stable to operate the newly built Beta through Computer Use when the selected slice requires self-bootstrap verification. Exercise the real user path, a relevant failure or recovery path, and the final visible state. Save credential-free evidence and record any manual takeover.

Do not treat an old running process, overwritten bundle on disk, unit test, fixture, screenshot, or model statement as final Beta acceptance.

## Promote

Only after the final Beta from the same clean commit passes acceptance, build Stable from that commit. Recheck Settings tracking and the minimum launch path. Commit or push only to the explicitly authorized MilkSU private remote; hosted publication and irreversible release actions still require confirmation.

Report the tested commit, Beta tracking ID, commands, real App path verified, remaining release limitations, and whether Stable was actually built or only remains eligible for promotion.
