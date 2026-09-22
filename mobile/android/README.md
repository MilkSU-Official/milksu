# MilkSU Android (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `app/src/main/java/org/milksu/app/MilkSUApp.kt` — Connect-JSON unary + Subscribe envelope client.
- `AccountAuth.kt` — PKCE + Chrome Custom Tabs.
- `MainActivity.kt` — Sign-in, session list, chat with Subscribe reconnect loop.
- `AndroidManifest.xml` — `INTERNET` + `milksu://auth/callback` intent-filter.
- Prefer Connect-Kotlin stubs from `cloud/agent/proto/cloud_session.proto` when buf generate is available.

## Auth

- Callback: `milksu://auth/callback` (same as desktop `AccountSession`)
- Keep the access token in SharedPreferences for the skeleton; EncryptedSharedPreferences / Keystore before store release.
- Never log the access token.

## First vertical slice

1. Sign in (PKCE).
2. `ListSessions` / `CreateSession`.
3. Open a session → `SendTurn` + `Subscribe` (long-poll resume via `after_event_id`).
4. Usage disclaimer: estimates from models.dev are for stats only, not a bill.

## Build

Gradle skeleton: root `settings.gradle.kts` + `app/build.gradle.kts` (Compose Material3). Open `mobile/android` in Android Studio to sync.
