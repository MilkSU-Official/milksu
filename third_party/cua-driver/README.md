# Cua driver Windows source pin

MilkSU keeps the macOS `cua-driver` path on the audited upstream release
artifact. Windows still builds the same upstream release from source because
the official Windows zip is not the Sidecar install path, and
`prepare_computer_use_driver` can rebuild the reviewed copy in a checkout.

Upstream `0.27.0` already canonicalizes the Windows process image path before
target-manifest comparison (`canonical_process_executable`). The older MilkSU
`0.14.2` canonicalize patch is gone.

## Pinned provenance

- Upstream: `https://github.com/trycua/cua.git`
- Release: `cua-driver-rs-v0.27.0`
- Commit: `082de4344b731ae4738ddc6a6f13f21bb3c49a85`
- License: upstream root `LICENSE.md` (MIT)
- Rust: `1.97.1`
- Target: `x86_64-pc-windows-msvc`
- Upstream `Cargo.lock` SHA-256 after LF normalization: `1200667c238ea4b425e7ab0b1e3bfa1c49b93158ae90bd52a15d5e78c2871678`
- `libs/cua-driver/rust/crates/platform-windows/src/browser_platform.rs` SHA-256 after LF normalization: `509e8467489b4201c947779dced4af267bdd68bd1a588a6d249404ef948fc53f`
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
