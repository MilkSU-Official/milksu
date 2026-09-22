# Sandbox image notes

CF Sandbox runtime for MilkSU cloud Coding
(https://developers.cloudflare.com/sandbox/configuration/dockerfile/).

## Pins

- Base image: `docker.io/cloudflare/sandbox:0.7.0` — must match `@cloudflare/sandbox` in `cloud/agent/package.json`.
- Pi / DSH: same versions as the desktop sidecar (`package-pins.json`, refreshed by `scripts/cloud-sandbox-bundle.sh`).

## Build / deploy

1. From repo root: `./scripts/cloud-sandbox-bundle.sh`
2. In milksu-admin: uncomment `[[containers]]` / Durable Object / migrations in `wrangler.toml`
3. Bind D1 (`migrations/0001_init.sql`), R2, and secret `CREDENTIAL_KEK`
4. `npx wrangler deploy` (Docker must be available; Wrangler builds and pushes the image)

## Credentials

Inject Provider credentials only at container start via the Cloud API Worker.
Never commit API keys into layers or ENV defaults.
