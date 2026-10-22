# Cua driver Windows source pin

MilkSU keeps the macOS `cua-driver` path on the audited upstream release
artifact. Windows still builds the same upstream release from source because
the official Windows zip is not the Sidecar install path, and
`prepare_computer_use_driver` can rebuild the reviewed copy in a checkout.

Upstream `0.38.0` already canonicalizes the Windows process image path before
target-manifest comparison (`canonical_process_executable`). The older MilkSU
`0.14.2` canonicalize patch is gone.

## Pinned provenance

- Upstream: `https://github.com/trycua/cua.git`
- Release: `cua-driver-rs-v0.38.0`
- Commit: `85e2b1318bd77ccf3cfa88ccdf875a4bb7eaed19`
- License: upstream root `LICENSE.md` (MIT)
- Rust: `1.97.1`
- Target: `x86_64-pc-windows-msvc`
- Upstream `Cargo.lock` SHA-256 after LF normalization: `56fab67bb0a0d93eeb7fe71783ed876617462a255a95290f53db322003e94fb0`
- `libs/cua-driver/rust/crates/platform-windows/src/browser_platform.rs` SHA-256 after LF normalization: `cf2d4bd97381fe99958748867fb2d9b846c957b8e1dac8302907d6e7eed741b4`
- Upstream `.gitattributes` has `* text=auto`. Windows checkout must not hash raw working-tree bytes, or the lockfile pin follows CRLF and fails CI.

## Compatibility boundary

The Windows source build does not add a MilkSU patch. It does not authorize by
PID alone, enable UIAccess, relax the target manifest, or change the Cua
protocol.

`scripts/build-windows-cua-driver.mjs` owns checkout, provenance verification,
the locked build, and the build receipt. Generated source, Cargo caches,
binaries, and licenses stay under `build/sidecar-cache/` and are not source
assets.

Linux Computer Use still does not ship this driver. GNOME Wayland stays on the
XDG Desktop Portal; Hyprland and Xorg stay unavailable.
