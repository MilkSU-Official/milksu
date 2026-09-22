# MilkSU cloud Coding sandbox: Pi + DSH (same pins as desktop sidecar).
# Built on Cloudflare Sandbox / Containers. Do not bake Provider API keys into the image.
FROM docker.io/cloudflare/sandbox:0.7.0

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
# Node deps for Pi / DSH are copied at image build from the desktop sidecar lockfile
# in CI (see scripts/cloud-sandbox-bundle.sh). Placeholder keeps the Dockerfile reviewable.
COPY README.sandbox.md /opt/milksu/README.sandbox.md

ENV MILKSU_CLOUD=1
WORKDIR /home/user
