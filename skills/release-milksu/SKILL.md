---
name: release-milksu
description: Build, verify, publish, or audit a traced MilkSU Stable desktop release for macOS ARM64 and Windows x64. Use only inside the MilkSU repository when the user asks to package, release, publish, promote, or inspect a MilkSU desktop version. Build MilkSU Beta only for an explicitly requested Stable-to-Beta self-bootstrap exercise.
---

# Release MilkSU

Use one clean source commit and the repository workflows. Keep signing, notarization, R2, and Admin publisher credentials inside their GitHub environments.

## Confirm the release

1. Read `AGENTS.md`, the three current architecture/status documents it names, and `docs/developer/product-code-admission.md` when release acceptance infrastructure changes.
2. Record the branch, full HEAD, working-tree state, previous published version, requested platforms, and whether publication is authorized.
3. Preserve unrelated changes. Do not package Stable from an unexplained dirty tree.
4. Use version `YY.MDD.N`: two-digit year, month without a leading zero plus two-digit day, then that day's sequence. For example, the first release on 2026-08-16 is `26.816.1`; October 5 is `26.1005.1`.
5. Run canonical tests locally before consuming hosted minutes. Do not retry an unchanged failed workflow.

## Build Stable

Push the clean release commit to the authorized private `main`, then dispatch the platform workflows against that exact commit.

### macOS ARM64

Prefer a registered private self-hosted macOS ARM64 runner; use a GitHub-hosted Mac only when the local runner is unavailable or unsuitable. Do not restore or upload GitHub's remote Node/Go caches on the self-hosted path; reuse the runner's local tool and package caches instead. Use `macOS signed release` once. It must test, compile the App once, apply Developer ID signing and hardened runtime, notarize, staple, and verify Gatekeeper. Derive both deliverables from the same verified `.app`:

- DMG: user installer and GitHub Release asset;
- ZIP plus updater metadata: authenticated OTA payload uploaded directly from the runner to private R2.

The DMG is a real drag-install surface, not a container holding only an App. It must show `MilkSU.app`, an `/Applications` shortcut, clear drag guidance, and a readable branded background in one Finder window. Mount it and verify the App, shortcut target, `.DS_Store`, and background; retain a visible Finder inspection before release.

Download only the DMG artifact for local inspection. Do not download the OTA ZIP just to upload it again, and do not expose the ZIP on GitHub.

### Windows x64

Use `Windows x64 release` on a native Windows runner. It must test, build the packaged runtimes and assisted NSIS installer, start the packaged App, and confirm that its Go Runtime starts. The installer must expose a conventional installation directory, Start menu and desktop shortcuts, an uninstall entry, and a finish-page launch action. Download only the EXE artifact.

Do not claim Windows signing unless the workflow had a configured Windows code-signing certificate and verified the resulting signature. Until then, label the EXE as an unsigned internal-test build and expect SmartScreen. Record unavailable platform capabilities in the release notes instead of silently implying parity.

## Verify and publish

1. Confirm both runs used the intended full commit and version.
2. Record run IDs, artifact names, sizes, SHA-256 values, tracking metadata, and platform-specific verification results without credentials.
3. Locally verify the macOS DMG with `codesign`, `spctl`, and `xcrun stapler`; rely on the native Windows workflow for first-launch acceptance unless a real Windows machine is available.
4. Create immutable tag `v<version>` at the release source commit only after required builds pass.
5. Create a GitHub prerelease for internal testers. Upload only the DMG and EXE; never upload the OTA ZIP.
6. The macOS workflow may upload the OTA objects and create an Admin draft after explicit publication authorization. Publishing or changing the Admin current pointer must match that authorization and must not overwrite immutable R2 objects.
7. Verify the GitHub tag, Release assets, R2/Admin receipt, and checksums before reporting completion.

## Beta exception

Do not build or refresh `MilkSU Beta.app` during ordinary implementation, debugging, UI validation, or Stable release preparation. Build Beta only when the user explicitly requests a MilkSU self-bootstrap exercise. In that case, use the installed Developer ID-signed Stable App as operator, keep Stable and Beta identities/data separate, and record the Beta branch, commit, tracking ID, and visible task.

## Close out

Update current release facts only after the real artifacts exist. Keep the tag on the binary source commit; a later documentation-only commit does not change binary provenance. Report what was built, signed, notarized, uploaded, published, and actually tested, plus any remaining platform limitations.
