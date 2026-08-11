---
name: integrate-api
description: Integrate an external API, SDK, OAuth provider, webhook, hosted model, or service using current official documentation and a verified end-to-end request. Use for third-party authentication, cloud services, model providers, billing or quota APIs, data synchronization, and webhook flows. Do not use for purely local code with no external contract.
---

# Integrate API

Make the external contract explicit, bounded, and observable before building around it.

## Verify the contract

1. Read repository instructions and the current official provider documentation. Prefer official SDKs, schemas, CLIs, and examples over memory or secondary tutorials.
2. Identify the exact API version, base URL, authentication method, required scopes, rate limits, request and response schemas, pagination, idempotency, and documented errors.
3. Separate operations into read, write, paid, account authorization, publication, and irreversible effects. Request user confirmation where the product boundary requires it.
4. Decide where credentials live and which process may access them. Never place provider keys in model context, logs, diagnostics, documentation, ordinary files, or frontend-readable settings.

## Implement the narrow adapter

Keep provider details behind the repository's existing adapter boundary. Validate inputs and responses, set bounded timeouts, and expose user-readable failure states. Add retries only for documented transient and idempotent operations; use idempotency keys for retryable writes when supported.

Do not silently fall back to another provider, broaden OAuth scopes, upload project data, or invent a compatibility layer. Mock servers may support tests but cannot prove the provider works.

## Verify the integration

Test schema validation and representative errors locally. Then complete one real, minimal, authorized request using a non-destructive resource. Confirm the returned identity or resource belongs to the intended account and record only credential-free evidence.

For OAuth, verify state, redirect allowlists, one-time code handling, logout or revocation, and denied or expired authorization. For webhooks, verify signature checking, replay protection, and idempotent processing.

Report the provider and API version, granted scopes, real operation verified, error paths checked, credential boundary, and anything still awaiting user or provider configuration.
