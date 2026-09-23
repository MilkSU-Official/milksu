# MilkSU iOS (native)

Cloud Coding client for MilkSU accounts.

## UI

SwiftUI 原生壳（不是桌面 React 拷贝）：

- **底部 Tab 2 个**：会话 / 我的（`TabView`）
- 登录：品牌大标题 + 单 CTA（`ASWebAuthenticationSession` PKCE）
- 会话：`NavigationStack` + inset grouped `List` + `.searchable` + 下拉刷新 + `ContentUnavailableView`
- 对话：气泡 + 底部胶囊输入（`.ultraThinMaterial`）+ SF Symbol 发送
- 文案：系统语言中/英（`L10n`），冷色画布 `#f4f6f8` / 墨色主按钮

## Layout

- `L10n.swift` — 中英成对文案
- `CloudConfig.swift` — Connect-JSON unary + Subscribe envelope client
- `AccountAuth.swift` — PKCE（同桌面 `AccountSession`）
- `MilkSUApp.swift` — 登录 / Tab / 列表 / 对话
- `Info.plist` — `milksu://auth/callback`
- 生成 Connect-Swift 后可替换手搓客户端（`cloud/agent/proto`）

## First vertical slice

1. Sign in (PKCE).
2. `ListSessions` / `CreateSession`.
3. Open a session → `SendTurn` + `Subscribe`（`after_event_id` 重连）.
4. Usage disclaimer: models.dev 估算，不是账单.
