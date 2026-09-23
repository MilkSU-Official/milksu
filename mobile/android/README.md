# MilkSU Android (native)

Cloud Coding client for MilkSU accounts.

## Layout

- `app/src/main/java/org/milksu/app/MilkSUApp.kt` — Connect-JSON unary + Subscribe envelope client.
- `AccountAuth.kt` — PKCE + Chrome Custom Tabs + EncryptedSharedPreferences.
- `MainActivity.kt` — Sign-in, session list, chat with Subscribe reconnect loop.
- `AndroidManifest.xml` — `INTERNET` + `milksu://auth/callback` intent-filter.
- Prefer Connect-Kotlin stubs from `cloud/agent/proto` when `npm run generate` lands in CI.

## Auth

- Callback: `milksu://auth/callback` (same as desktop `AccountSession`)
- Access token in `EncryptedSharedPreferences` (AES256-GCM); never log it.
- One-shot migrate from the earlier plaintext `milksu.account` prefs.

## First vertical slice

1. Sign in (PKCE).
2. `ListSessions` / `CreateSession`.
3. Open a session → `SendTurn` + `Subscribe` (long-poll resume via `after_event_id`).
4. Usage disclaimer: estimates from models.dev are for stats only, not a bill.

## Build

Gradle skeleton: root `settings.gradle.kts` + `app/build.gradle.kts` (Compose Material3 + security-crypto). Open `mobile/android` in Android Studio to sync.
