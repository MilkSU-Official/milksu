#!/usr/bin/env bash
# Bundle Pi + DSH pins into the Cloudflare Sandbox image context.
# Mature path: copy the same versions as the desktop sidecar, then
# `wrangler deploy` builds cloud/agent/sandbox/Dockerfile (CF Sandbox docs).
# Run from repo root in milksu-admin / release CI that has registry credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/cloud/agent/sandbox}"
mkdir -p "$OUT"

PI_VER="$(node -e "console.log(require('$ROOT/package.json').dependencies['@earendil-works/pi-coding-agent'])")"
DSH_VER="$(node -e "console.log(require('$ROOT/package.json').dependencies['@deepseek-ai/dsh'])")"

cat >"$OUT/package-pins.json" <<EOF
{
  "@earendil-works/pi-coding-agent": "${PI_VER}",
  "@deepseek-ai/dsh": "${DSH_VER}"
}
EOF

cp -f "$ROOT/cloud/agent/sandbox/README.sandbox.md" "$OUT/README.sandbox.md" 2>/dev/null || true
echo "cloud-sandbox-bundle: wrote $OUT/package-pins.json (pi=${PI_VER} dsh=${DSH_VER})"
echo "cloud-sandbox-bundle: next — uncomment containers/DO in wrangler.toml and wrangler deploy from milksu-admin"
