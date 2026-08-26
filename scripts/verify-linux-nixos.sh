#!/usr/bin/env bash
# Wrap linux-unpacked with the NixOS FHS env. Sidecar execute is Debian/Arch.
set -euo pipefail

unpacked="${1:?path to linux-unpacked}"
image="${NIX_IMAGE:-nixos/nix}"
case "${NIX_PLATFORM:-$(uname -m)}" in
  aarch64|arm64|linux/arm64) platform=linux/arm64 ;;
  *) platform=linux/amd64 ;;
esac

unpacked="$(cd "$unpacked" && pwd)"
test -x "$unpacked/milksu"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

docker run -i --rm --platform "$platform" \
  -v "$unpacked:/unpacked:ro" \
  -v "$repo_root/packaging/linux:/packaging:ro" \
  -e MILKSU_LINUX_UNPACKED=/unpacked \
  "$image" \
  bash -s <<'EOS'
set -euo pipefail
nix-build /packaging/default.nix --arg unpacked /unpacked
test -x result/bin/milksu
test -x /unpacked/milksu
test -x /unpacked/resources/milksu-sidecar/node
test -x /unpacked/resources/milksu-backend
test -f /unpacked/resources/milksu-sidecar/chat-bridge.cjs
# Do not execute the Ubuntu-linked Node/Go binaries inside the Nix sandbox;
# they need /lib64/ld-linux. Sidecar/Runtime start is covered by Debian/Arch.
EOS
