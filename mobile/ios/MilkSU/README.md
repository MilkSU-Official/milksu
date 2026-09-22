# MilkSU iOS (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `CloudConfig.swift` — Connect-JSON unary client (`MilkSUCloudAgentClient`) matching `cloud/agent` Worker wire.
- Generate Connect-Swift from `cloud/agent/proto/cloud_session.proto` when buf tooling is in CI; replace the hand client.

## Auth

PKCE against `accounts.milksu.org`（与桌面 `AccountSession` 同线）：
- iOS：`AccountAuth.swift` + `ASWebAuthenticationSession` + Keychain
- Android：`AccountAuth.kt` + Chrome Custom Tabs + `milksu://auth/callback`

Redirect：`milksu://auth/callback`（与桌面 stable scheme 一致；需在系统里注册）。

## First vertical slice

1. Sign in.
2. `ListSessions` / `CreateSession`.
3. Stream turns via `Subscribe` once the generated Connect router ships.
4. Show usage with the models.dev estimate disclaimer (not a bill).
