# MilkSU iOS (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `CloudConfig.swift` — Connect-JSON unary + Subscribe envelope client (`MilkSUCloudAgentClient`) matching `cloud/agent` Worker wire.
- `AccountAuth.swift` — PKCE against `accounts.milksu.org` (same wire as desktop `AccountSession`).
- `MilkSUApp.swift` — Sign-in, session list, chat with Subscribe reconnect loop.
- `Info.plist` — registers `milksu://` URL scheme for `milksu://auth/callback`.
- Generate Connect-Swift from `cloud/agent/proto/cloud_session.proto` when buf tooling is in CI; replace the hand client.

## Auth

- `ASWebAuthenticationSession` + Keychain
- Redirect: `milksu://auth/callback` (desktop stable scheme)

## First vertical slice

1. Sign in (PKCE).
2. `ListSessions` / `CreateSession`.
3. Open a session → `SendTurn` + `Subscribe` (long-poll resume via `after_event_id`).
4. Usage disclaimer: estimates from models.dev are for stats only, not a bill.
