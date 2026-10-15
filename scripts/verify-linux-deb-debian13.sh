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
test -f /opt/MilkSU/resources/milksu-sidecar/node_modules/@playwright/mcp/cli.js
test -f /opt/MilkSU/resources/milksu-sidecar/playwright-lazy-mcp.cjs
test -d /opt/MilkSU/resources/milksu-sidecar/node_modules/@deepseek-ai/cordis-plugin-group

runtime_home="$(mktemp -d)"
mkdir -p "$runtime_home/.git"
printf '%s\n' \
  '{"action":"create_session","conversationId":"debian13-package-smoke","executionMode":"go","approvalPolicy":"workspace-auto","provider":"tokenflux","model":"deepseek/deepseek-flash","modelSourceOrder":["personal"]}' \
  '{"action":"destroy_session","conversationId":"debian13-package-smoke"}' \
  | HOME="$runtime_home" \
    OPENAI_API_KEY='package-smoke-imagegen-credential-never-log' \
    TOKENFLUX_API_KEY='package-smoke-imagegen-credential-never-log' \
    "$node_runtime" \
    /opt/MilkSU/resources/milksu-sidecar/chat-bridge.cjs \
  | tee /tmp/milksu-sidecar.stdout
grep -q '"type":"ready"' /tmp/milksu-sidecar.stdout
if grep -q 'package-smoke-imagegen-credential-never-log' /tmp/milksu-sidecar.stdout; then
  echo 'packaged sidecar smoke leaked the dummy credential' >&2
  exit 1
fi

runtime=/opt/MilkSU/resources/runtime/main.cjs
test -f "$runtime"
ELECTRON_RUN_AS_NODE=1 /opt/MilkSU/milksu "$runtime" >/tmp/milksu-runtime.stdout 2>/tmp/milksu-runtime.stderr &
runtime_pid=$!
trap 'kill "$runtime_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-runtime.stdout && break
  kill -0 "$runtime_pid"
  sleep 0.5
done
grep -q '"type"[[:space:]]*:[[:space:]]*"ready"' /tmp/milksu-runtime.stdout
kill "$runtime_pid"
wait "$runtime_pid" || true
EOS
