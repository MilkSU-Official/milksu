# MilkSU iOS (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `CloudConfig.swift` — Connect-JSON unary client (`MilkSUCloudAgentClient`) matching `cloud/agent` Worker wire.
- Generate Connect-Swift from `cloud/agent/proto/cloud_session.proto` when buf tooling is in CI; replace the hand client.

## Auth

Use the same PKCE login as desktop (`accounts.milksu.org`). Store the access token in Keychain; never log it.

## First vertical slice

1. Sign in.
2. `ListSessions` / `CreateSession`.
3. Stream turns via `Subscribe` once the generated Connect router ships.
4. Show usage with the models.dev estimate disclaimer (not a bill).
