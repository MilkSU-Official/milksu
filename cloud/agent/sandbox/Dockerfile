# MilkSU Cloud Coding sandbox image.
# Pin must match @cloudflare/sandbox in cloud/agent/package.json
# (https://developers.cloudflare.com/sandbox/configuration/dockerfile/).
FROM docker.io/cloudflare/sandbox:0.7.0

WORKDIR /workspace/milksu

# package-pins.json is produced by scripts/cloud-sandbox-bundle.sh
# (same Pi / DSH versions as the desktop sidecar).
COPY package-pins.json /workspace/milksu/package-pins.json
COPY bridge-entry.sh /workspace/milksu/bridge-entry.sh
COPY turn-runner.mjs /workspace/milksu/turn-runner.mjs

RUN node -e "const pins=require('./package-pins.json'); \
  require('fs').writeFileSync('package.json', JSON.stringify({ name: 'milksu-cloud-sandbox', private: true, dependencies: pins }, null, 2));" \
  && npm install --omit=dev --no-audit --no-fund \
  && chmod +x /workspace/milksu/bridge-entry.sh /workspace/milksu/turn-runner.mjs \
  && rm -rf /tmp/* /root/.npm

# Runtime credentials are injected by the Cloud Agent Worker — never bake keys.
ENV MILKSU_CLOUD_KERNEL_ROOT=/workspace/milksu/node_modules
ENV NODE_PATH=/workspace/milksu/node_modules
ENV MILKSU_CLOUD_KERNEL=pi

# Base image ENTRYPOINT stays /sandbox; CMD starts our bridge placeholder.
CMD ["/workspace/milksu/bridge-entry.sh"]
