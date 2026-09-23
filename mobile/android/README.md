# MilkSU Android (native)

Cloud Coding client for MilkSU accounts.

## UI

Material 3 原生壳：

- **底部 NavigationBar 2 项**：会话 / 我的
- 登录：品牌大标题 + 主按钮（Chrome Custom Tabs PKCE）
- 会话：`LargeTopAppBar` + 圆角 `Surface` 行 + FAB 新对话 + 下拉刷新
- 对话：气泡 + 圆角 `OutlinedTextField` 胶囊输入 + `FilledIconButton` 发送
- 主题：冷色画布 / 墨色 primary（`MilkSUTheme`）；文案中英（`L10n`）

## Layout

- `L10n.kt` / `MilkSUTheme.kt` — 文案与色板
- `MilkSUApp.kt` — Connect-JSON + Subscribe 信封客户端
- `AccountAuth.kt` — PKCE + EncryptedSharedPreferences
- `MainActivity.kt` — 登录 / Tab / 列表 / 对话
- `AndroidManifest.xml` — `INTERNET` + `milksu://auth/callback`
- Prefer Connect-Kotlin stubs from `cloud/agent/proto` when `npm run generate` lands in CI.

## Build

Open `mobile/android` in Android Studio to sync（Compose Material3 + icons-extended + security-crypto）.
