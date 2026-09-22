#!/usr/bin/env bash
# Bundle Pi + DSH lockfiles into the Cloudflare Sandbox image context.
# Run from repo root in milksu-admin / release CI that has registry credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/cloud/agent/sandbox/bundle}"
mkdir -p "$OUT"

echo "cloud-sandbox-bundle: copying sidecar package pins into $OUT"
# Placeholder until milksu-admin owns the closed-source image build.
# Real build should copy sidecar/pi and sidecar/dsh lockfiles + node_modules
# resolution identical to desktop pins (see AGENTS.md / package.json).
cp -f "$ROOT/cloud/agent/sandbox/README.sandbox.md" "$OUT/README.sandbox.md"
echo "ok" >"$OUT/.bundle-ready"
echo "cloud-sandbox-bundle: wrote placeholder bundle (deploy CI replaces with full Pi+DSH closure)"
