# macOS 签名与公证

> 状态：Current release runbook
>
> Apple Team：`48Y78X426T`

MilkSU 使用独立的 GitHub Actions environment `macos-release` 完成 Developer ID 签名、公证、
staple 与 Gatekeeper 验证。签名资产只存在 Personal Vault 和 GitHub Secrets；不得进入仓库、日志、
模型上下文或正式 App。

## 一次性配置

1. 打开私有仓库的 **Settings → Environments → New environment**，创建 `macos-release`。
2. 仓库套餐支持时给该 environment 添加 Required reviewers，只允许维护者手工批准发版。当前私有
   仓库套餐不支持该保护规则，因此保留 `workflow_dispatch` 手工触发、私有仓库管理员权限和无自动发布。
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

本机的字段名和资产位置记录在 Personal Vault；不要复制到 issue、commit、PR、终端输出或聊天。

## 发一次内测包

1. 确认要发布的提交已推送到 MilkSU 私有仓库且工作树干净。
2. 打开 **Actions → macOS signed release → Run workflow**，选择准确分支。
3. 审批 `macos-release` environment。
4. 等待 job 完成，下载 `MilkSU-macOS-arm64` artifact。
5. 在一台未安装开发证书的 Mac 上下载并打开 DMG，核对设置页 branch、40 位 commit 和 tracking ID。

Workflow 会在一次性 keychain 中导入 `.p12`，并依次执行：

```text
测试 → 构建 Stable → Hardened Runtime / Developer ID 签名
→ 生成并签名 DMG → notarytool 公证 → staple
→ stapler validate → spctl Gatekeeper 验证 → 上传 artifact
```

任何签名、公证、staple 或 Gatekeeper 步骤失败，workflow 都不会上传可分发产物。

## 本机只读核对

已安装 App 可用以下命令核对，不会读取私钥：

```bash
codesign -dv --verbose=4 /Applications/MilkSU.app
codesign --verify --deep --strict --verbose=4 /Applications/MilkSU.app
spctl --assess --type execute --verbose=4 /Applications/MilkSU.app
xcrun stapler validate /path/to/MilkSU-macOS-arm64.dmg
```

普通本地 Stable/Beta 构建保持显式 ad-hoc，不枚举 Developer ID。正式发行只走上述审批后的 CI。

官方参考：[Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)、
[macOS 公证](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、
[GitHub Actions Secrets](https://docs.github.com/en/actions/concepts/security/secrets)。
