#!/usr/bin/env bash
# Sandbox entry for MilkSU cloud Coding kernels.
# Mature shape: CF Sandbox CMD child of /sandbox binary
# (https://developers.cloudflare.com/sandbox/configuration/dockerfile/).
# Credentials arrive via env from the Worker — never baked into the image.
set -euo pipefail

ROOT="${MILKSU_CLOUD_KERNEL_ROOT:-/workspace/milksu/node_modules}"
KERNEL="${MILKSU_CLOUD_KERNEL:-pi}"

case "$KERNEL" in
  pi|dsh) ;;
  *)
    echo "unsupported MILKSU_CLOUD_KERNEL=$KERNEL (want pi|dsh)" >&2
    exit 2
    ;;
esac

if [[ ! -d "$ROOT" ]]; then
  echo "kernel root missing: $ROOT" >&2
  exit 1
fi

# Placeholder until milksu-admin attaches the real Pi bridge / DSH ACP server.
# Keep the process alive so Durable Object exec / health checks can see a ready sandbox.
echo "milksu-cloud-bridge: kernel=$KERNEL root=$ROOT ready (harness attach pending)"
exec sleep infinity
