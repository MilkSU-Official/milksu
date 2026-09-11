---
name: jadx
description: Use when decompiling an Android APK, DEX, or AAR to Java. Write output in the current workspace. Do not use for native ELF or PE binaries; use ghidra-rpc for those.
---

# JADX

Decompile Android packages with the local `jadx` CLI. Keep output in the current workspace.

## Before you start

1. Confirm `jadx` or `jadx-gui` is on PATH. If it is missing, tell the user to install JADX and turn on this Skill in Settings → Skills.
2. Decompile into `./jadx-out/<sample-name>`. Do not write into the system temporary directory.

## Decompile

```text
jadx -d ./jadx-out/<sample-name> <sample>
```

Then read the generated Java. Do not dump the entire tree into the conversation; open the classes that matter.
