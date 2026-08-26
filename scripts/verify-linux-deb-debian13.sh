#!/usr/bin/env bash
# Install an amd64 MilkSU DEB inside Debian 13 and start the packaged runtimes.
# Proves the Ubuntu-built package is not Ubuntu-only. This is not a GNOME desktop
# or Computer Use receipt.
set -euo pipefail

package="${1:?path to MilkSU-Linux-x64-*.deb}"
image="${DEBIAN_IMAGE:-debian:13}"

if [[ ! -f "$package" ]]; then
  echo "missing package: $package" >&2
  exit 1
fi

package="$(cd "$(dirname "$package")" && pwd)/$(basename "$package")"

docker run -i --rm --platform linux/amd64 \
  -v "$package:/tmp/milksu.deb:ro" \
  "$image" \
  bash -s <<'EOS'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends /tmp/milksu.deb
test -x /opt/MilkSU/milksu
test -f /usr/share/icons/hicolor/48x48/apps/milksu.png
test -f /usr/share/icons/hicolor/256x256/apps/milksu.png
node_runtime=/opt/MilkSU/resources/milksu-sidecar/node
test -x "$node_runtime"
test "$("$node_runtime" --version)" = "v24.18.0"
"$node_runtime" -e '
const fs = require("fs");
function pngSize(path) {
  const buf = fs.readFileSync(path);
  return buf.readUInt32BE(16) + "x" + buf.readUInt32BE(20);
}
if (pngSize("/usr/share/icons/hicolor/48x48/apps/milksu.png") !== "48x48") process.exit(1);
if (pngSize("/usr/share/icons/hicolor/256x256/apps/milksu.png") !== "256x256") process.exit(1);
'
grep -q linux/amd64 /opt/MilkSU/resources/milksu-sidecar/manifest.json
test "$("$node_runtime" -p 'require("/opt/MilkSU/resources/milksu-sidecar/manifest.json").platform')" = "linux/amd64"

runtime_home="$(mktemp -d)"
mkdir -p "$runtime_home/.git"
printf '%s\n' \
  '{"action":"create_session","conversationId":"debian13-package-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}' \
  '{"action":"destroy_session","conversationId":"debian13-package-smoke"}' \
  | HOME="$runtime_home" "$node_runtime" \
    /opt/MilkSU/resources/milksu-sidecar/chat-bridge.cjs \
  | tee /tmp/milksu-sidecar.stdout
grep -q '"type":"ready"' /tmp/milksu-sidecar.stdout

backend=/opt/MilkSU/resources/milksu-backend
test -x "$backend"
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
