---
name: ghidra-rpc
description: >
  Use when a ready, user-enabled Ghidra RPC overlay should analyze one
  authorized binary already inside the current workspace. Requires local
  Ghidra 11+ and Java 17+ with GHIDRA_INSTALL_DIR set. Keep samples and
  Ghidra projects inside the workspace. Catalog name stays here; the body
  loads with read or /skill:ghidra-rpc.
---

# Ghidra RPC

Scout shortname `ghidra-rpc-main` means the main zip. Preferred pin:
`cellebrite-labs/ghidra-rpc` HEAD
`1743305487b1de754fb750486dd468ea4d3c4141` (2026-08-06) — post-v0.2.0
headless write fix and `--with-instructions` breaking change. Alternate
stable tag `v0.2.0` / `ad507753469d01c7a0faee8b2b2b54ba9367b46e`. Do not
use `assaflevy/ghidra-rpc-win`. Security still decides; current overlay
follows the preferred HEAD. MilkSU does not vendor that repository.
Upstream mentions MIT in README only and has no LICENSE file. Host CLI
risk is sample/path exfil; subprocess mainly starts the daemon.

Keep sample binaries and `.gpr` projects inside the current Coding / Lab
workspace or `Documents/MilkSU`. Do not place them under the platform temp
directory. Do not paste this body into the system prompt. Do not invent a
second harness or keyword router.
