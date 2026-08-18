# Cua driver Windows compatibility source

MilkSU keeps the macOS `cua-driver` path on the audited upstream release artifact. Windows builds the same upstream release from source with one narrow compatibility patch because the Windows process image path can differ from the canonical path used in the approved target manifest.

## Pinned provenance

- Upstream: `https://github.com/trycua/cua.git`
- Release: `cua-driver-rs-v0.14.2`
- Commit: `ed9d5efcf5f261f4854bf2de0ba06a2b0b4419c4`
- License: upstream root `LICENSE.md` (MIT)
- Rust: `1.97.1`
- Target: `x86_64-pc-windows-msvc`
- Patch SHA-256: `25811f122f48ebdf346139c13724ee6f7cfa4ab8e29afad5a49d5bcfe62a96d4`
- Upstream `Cargo.lock` SHA-256: `08325c0e9779b1604bdc707f60c4f85836f2e7e668375112448b3d04a46db3b2`
- Patched source SHA-256 after LF normalization: `190779e4f349ad7b359e9a51f3c057089e388d716612bbf66f8ebb9a6e15bc8f`

## Compatibility boundary

The patch canonicalizes the executable path returned for the already-open process handle before target-manifest comparison. Failure to canonicalize rejects the route. It does not authorize by PID alone, enable UIAccess, relax the target manifest, or change the Cua protocol.

`scripts/build-windows-cua-driver.mjs` owns checkout, provenance verification, the locked build, the targeted regression test, and the build receipt. Generated source, Cargo caches, binaries, and licenses stay under `build/sidecar-cache/` and are not source assets.

When a later audited upstream Cua release contains an equivalent fix, remove this patch and the Windows source-build exception after the same packaged ordinary-user probes pass.
