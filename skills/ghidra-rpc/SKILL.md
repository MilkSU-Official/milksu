---
name: ghidra-rpc
description: Use when reversing a binary with Ghidra. Start ghidra-rpc, load the file, then decompile or list functions. Do not use for APK Java source; use jadx for that.
---

# Ghidra

Drive the local `ghidra-rpc` CLI. Keep the Ghidra project file inside the current workspace.

## Before you start

1. Confirm `ghidra-rpc` is on PATH. If it is missing, tell the user to open Settings → Skills, turn on Ghidra, and run Prepare.
2. Confirm `GHIDRA_INSTALL_DIR` points at a Ghidra 11+ install, and Java 17+ is available.
3. Put the project in the current workspace, for example `./ghidra-work.gpr`. Do not write project files into the system temporary directory.

## Session

```text
ghidra-rpc start --project ./ghidra-work.gpr --headless
export GHIDRA_RPC_PROJECT="$PWD/ghidra-work.gpr"
ghidra-rpc load <binary>
ghidra-rpc decompile <program> <function>
```

Useful follow-ups: `list-functions`, `xrefs-to`, `rename-function`, `list-instances`, `stop`.

Read the JSON result. If a command fails, show the error and stop guessing Ghidra GUI clicks.
