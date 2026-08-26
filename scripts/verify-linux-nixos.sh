#!/usr/bin/env bash
# Wrap linux-unpacked with the NixOS FHS env and start packaged runtimes.
set -euo pipefail

unpacked="${1:?path to linux-unpacked}"
image="${NIX_IMAGE:-nixos/nix}"

unpacked="$(cd "$unpacked" && pwd)"
test -x "$unpacked/milksu"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

docker run -i --rm --platform linux/amd64 \
  -v "$unpacked:/unpacked:ro" \
  -v "$repo_root/packaging/linux:/packaging:ro" \
  -e MILKSU_LINUX_UNPACKED=/unpacked \
  "$image" \
  bash -s <<'EOS'
set -euo pipefail
nix-build /packaging/default.nix --arg unpacked /unpacked
test -x result/bin/milksu
node_runtime=/unpacked/resources/milksu-sidecar/node
test -x "$node_runtime"
test "$("$node_runtime" --version)" = "v24.18.0"
runtime_home="$(mktemp -d)"
mkdir -p "$runtime_home/.git"
printf '%s\n' \
  '{"action":"create_session","conversationId":"nixos-package-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}' \
  '{"action":"destroy_session","conversationId":"nixos-package-smoke"}' \
  | HOME="$runtime_home" "$node_runtime" \
    /unpacked/resources/milksu-sidecar/chat-bridge.cjs \
  | tee /tmp/milksu-sidecar.stdout
grep -q '"type":"ready"' /tmp/milksu-sidecar.stdout
backend=/unpacked/resources/milksu-backend
"$backend" >/tmp/milksu-backend.stdout 2>/tmp/milksu-backend.stderr &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-backend.stdout && break
  kill -0 "$backend_pid"
  sleep 0.5
done
grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-backend.stdout
kill "$backend_pid"
wait "$backend_pid" || true
EOS
