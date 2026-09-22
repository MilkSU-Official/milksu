# MilkSU Android (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `app/src/main/java/org/milksu/app/MilkSUApp.kt` — Connect-JSON unary client matching `cloud/agent` Worker wire.
- Prefer Connect-Kotlin stubs from `cloud/agent/proto/cloud_session.proto` when buf generate is available.

## Auth

PKCE against `accounts.milksu.org`. Keep the access token in EncryptedSharedPreferences / Keystore; never log it.

## First vertical slice

1. Sign in.
2. `ListSessions` / `CreateSession`.
3. Wire `Subscribe` streaming when the Worker exposes Connect streams.
4. Usage UI must say estimates are from models.dev, not a bill.
