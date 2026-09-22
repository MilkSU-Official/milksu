# MilkSU iOS (原生)

从 0 的原生客户端：SwiftUI + Connect-Swift。

## 一阶段范围

- GitHub PKCE 登录（复用 `accounts.milksu.org`）
- 云会话列表 / 对话（Connect → `CloudSessionService`）
- 消耗展示（models.dev 估算文案）

## 工程

Xcode 工程在本机创建后放入此目录；协议源：`cloud/agent/proto/cloud_session.proto`。

```text
mobile/ios/MilkSU/
  README.md          # 本文件
  (Xcode project TBD on Apple silicon CI / developer Mac)
```

扫电脑 / 局域网属 #131，不在此面。
