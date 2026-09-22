# Sandbox image notes

This image is the CF Sandbox runtime for MilkSU cloud Coding.

- Pin Pi and DSH to the same versions as `sidecar/` in the desktop repo.
- Inject Provider credentials only at container start via the Cloud API Worker.
- Never commit API keys into layers or ENV defaults.
