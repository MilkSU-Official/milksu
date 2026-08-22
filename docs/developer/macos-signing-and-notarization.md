# macOS 签名与公证

> 状态：Current release runbook
>
> Apple Team：`48Y78X426T`

MilkSU 使用独立的 GitHub Actions environment `macos-release` 完成 Developer ID 签名、公证、
staple 与 Gatekeeper 验证。签名资产只存在 Personal Vault 和 GitHub Secrets；不得进入仓库、日志、
模型上下文或正式 App。

## 一次性配置

1. 打开仓库的 **Settings → Environments → New environment**，创建 `macos-release`。
2. 仓库已公开：该 environment 必须启用 Required reviewers（当前审阅人 `MilkSU-Official`），
   只允许维护者批准后才注入签名 / 公证 / R2 secrets；并把 deployment branch 限制为 `main`。
   管理员不能绕过审批。`workflow_dispatch` 仍手工触发，不能自动发布到 R2 current pointer。
3. 在 `macos-release` 的 Environment secrets 中创建：

| Secret | 内容 |
| --- | --- |
| `MACOS_CSC_LINK` | Developer ID Application `.p12` 的 base64，不带换行 |
| `MACOS_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `MILKSU_CODESIGN_IDENTITY` | 完整证书名，例如 `Developer ID Application: … (48Y78X426T)` |
| `APPLE_TEAM_ID` | `48Y78X426T` |
| `APPLE_API_KEY_BASE64` | App Store Connect API `.p8` 文件的 base64，不带换行 |
| `APPLE_API_KEY_ID` | App Store Connect API Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| `CLOUDFLARE_R2_ACCOUNT_ID` | 持有私有 `milksu-releases` bucket 的账户 ID |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | 只允许写入该 release bucket 的 R2 S3 access key ID |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | 对应的 R2 S3 secret access key |
| `MILKSU_RELEASE_PUBLISH_TOKEN` | 只允许在 Admin 创建 release draft 的随机 token |

本机的字段名和资产位置记录在 Personal Vault；不要复制到 issue、commit、PR、终端输出或聊天。

## 构建一次正式候选包（默认本机）

1. 按[三端打包与发版流程](release-process.md)把准确版本提交并推送到 `main`，运行一次
   `npm run release:verify` 生成绑定完整 commit 的本地回执。
2. 用 `npm run release:dispatch ...` 分发 Windows/Linux；macOS **默认不走云端**。
3. 在维护者 Mac 上运行：

```bash
npm run release:mac:local -- \
  --release-title "MilkSU … 内测版" \
  --release-notes "…"
```

脚本从 Personal Vault 读取 `.p12` / `.p8` 与 `macos-signing-secrets.env`，导入一次性 Keychain，依次：

```text
构建 Stable → Hardened Runtime / Developer ID 签名
→ App 公证、staple 与验证
→ 生成并签名 DMG → DMG 公证、staple 与验证
→ 验证 DMG 安装布局 → 写出 build/release/MilkSU-macOS-arm64-<version>.dmg
→ 删除临时 Keychain
```

4. 在一台未安装开发证书的 Mac 上打开 DMG，核对设置页 branch、40 位 commit 和 tracking ID。

需要恢复云端 macOS（GitHub-hosted 或已注册 self-hosted）时，对 `release:dispatch` 显式加
`--macos-cloud`（自托管再加 `--use-self-hosted`），并审批 `macos-release` environment。云端
GitHub-only 模式仍只生成 DMG artifact，不默认生成 OTA ZIP。

全仓 Go、Vue、Sidecar、lint 和生产/文档构建已由 commit-bound 本地回执证明，macOS 打包路径不重复
执行。只有显式 `--upload-release` 时才额外生成 updater ZIP 与 release metadata。

任何签名、公证、staple 或 Gatekeeper 步骤失败都不得分发产物。普通功能开发验收继续用 ad-hoc
Stable；不要构建 Beta，除非用户明确要求自举。

## 上传私有 R2 并建立草稿

需要 OTA 时，不先构建 GitHub-only 候选再重复整轮签名。维护者在同一次已验证 source commit 分发中
使用 `npm run release:dispatch -- --upload-release ...`。CI 在该轮额外生成 updater ZIP 和元数据，使用
rclone 的 Cloudflare S3 provider 把 ZIP、DMG 和元数据上传到
`releases/stable/darwin/arm64/<version>/`，再逐个下载到临时目录复核 SHA-256。只有回读一致时，CI 才调用
Admin 的窄 internal API 创建或幂等更新草稿。

这一步不会直接向用户发布。维护者必须进入 MilkSU Admin 的 **版本** 页面，核对版本、commit、tracking、
大小、哈希和发布说明，再点击“发布此版本”。发布只改变 D1 的 current pointer；R2 对象保持不可变。

`milksu-releases` 必须保持私有，不配置公开 bucket domain。Desktop feed、ZIP 和 DMG 都经
`accounts.milksu.org` Worker 返回，并要求受邀且访问状态正常的登录账户 Bearer session。会话只保存在
Electron 主进程；不得进入 Vue、日志、诊断或模型上下文。暂停账户、未受邀账户和未登录客户端不能检查
或下载更新。

## OTA 发行验收

代码测试、Admin fixture、候选 DMG 或只看到更新提示都不代表 OTA 已完成。正式收口需要：

1. 应用远端 D1 migration，并部署带私有 R2 binding 与 release secret 的 Admin Worker；
2. 用新干净 HEAD 运行正式签名流水、上传 R2、在 Admin 人工发布；
3. 在安装着旧正式签名 Stable 的近新用户 Mac 上登录有效账户，收到提示并完成下载、重启安装；
4. 核对新版本、完整 commit、tracking ID、严格签名、Gatekeeper 和核心启动路径；
5. 用退出登录或暂停账户复核 feed/download 不再可用。

不要用 Beta 代替 Stable OTA 验收，也不要让本地开发脚本持有或复制 CI 的 Apple/R2/Admin 凭据。

## 本机只读核对

已安装 App 可用以下命令核对，不会读取私钥：

```bash
codesign -dv --verbose=4 /Applications/MilkSU.app
codesign --verify --deep --strict --verbose=4 /Applications/MilkSU.app
spctl --assess --type execute --verbose=4 /Applications/MilkSU.app
xcrun stapler validate /path/to/MilkSU-macOS-arm64-<version>.dmg
```

普通本地 Stable/Beta 构建保持显式 ad-hoc，不枚举 Developer ID。正式发行只走上述审批后的 CI。

官方参考：[Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)、
[macOS 公证](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、
[GitHub Actions Secrets](https://docs.github.com/en/actions/concepts/security/secrets)。
