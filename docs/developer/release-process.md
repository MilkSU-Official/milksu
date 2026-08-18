# 三端打包与发版流程

> 状态：Current release runbook

本流程的原则是：同一 source commit 的全仓测试只跑一次，三端 workflow 只重复无法跨平台替代的
原生构建和安装包验收。

## 1. 冻结发行源

先把版本号和待发代码提交并推送到私有 `main`，确保 tracked working tree 干净。根目录与
`desktop/package.json` 的版本必须相同。

## 2. 全量验证一次

```bash
npm run release:verify
```

该命令依次运行唯一 canonical suite：

```text
go test ./...
npm --prefix app test
npm run test:sidecar
npm --prefix app run lint
npm --prefix app run build
npm run docs:build
```

成功后在被 Git 忽略的 `build/test-results/release-source-verification.json` 写入本地回执。回执绑定
完整 commit、版本和以上六项检查。HEAD、版本、tracked 文件或 `origin/main` 任一发生变化，回执立即失效，
不能用于分发。

需要人工体验时，可在同一提交上构建普通 Stable 验收包并由用户操作。不要构建 Beta；人工验收也不需要
再次运行上述全量 suite。

## 3. 分发：Windows/Linux 走云端，macOS 默认本机

```bash
npm run release:dispatch -- \
  --release-title "MilkSU 26.817.2 内测版" \
  --release-notes "本次内测说明"
```

命令先验证本地回执和当前 `main`，默认只把同一个 40 位 commit 分发给 **Windows** 与 **Linux**
workflow（避免 GitHub-hosted macOS 分钟费）。macOS 正式签名包在本机完成：

```bash
npm run release:mac:local -- \
  --release-title "MilkSU 26.817.2 内测版" \
  --release-notes "本次内测说明"
```

本机脚本从 Personal Vault 读取 Developer ID / Notary 资产，导入一次性 Keychain，构建、签名、公证、
staple，完成后删除临时 Keychain；不把私钥写入仓库或日志。产物：`build/release/MilkSU-macOS-arm64.dmg`。

| 平台 | 默认路径 | 保留的原生门禁 |
| --- | --- | --- |
| macOS | 本机 `release:mac:local` | Stable 构建、Developer ID 签名、App/DMG 公证、staple、Gatekeeper、DMG 安装布局 |
| Windows | GitHub Actions | 原生 Go 编译、关键 Sidecar 路由、NSIS 结构、打包 Runtime 与首次启动 |
| Linux | GitHub Actions | 原生 Go 编译、关键 Sidecar 路由、DEB 结构、打包 Runtime 与 Xvfb 首次启动 |

确需云端 macOS（自托管或托管）时显式加 `--macos-cloud`；自托管再加 `--use-self-hosted`。

可先查看而不触发：

```bash
npm run release:dispatch -- --dry-run
```

## 4. GitHub 安装包与 OTA

默认流程只生成内测用户需要的 DMG、EXE、DEB。macOS 默认不再额外压缩体积相近的 updater ZIP，
也不生成 OTA metadata。

确实要在同一轮上传私有 R2 并建立 Admin 草稿时，直接一次运行：

```bash
npm run release:dispatch -- --upload-release \
  --release-title "MilkSU 26.817.2" \
  --release-notes "本次更新说明"
```

只有这个模式会在 macOS 签名构建中额外生成 updater ZIP 和 metadata。不要先跑一轮 GitHub-only，
再为 OTA 重跑相同的签名构建。Admin 草稿仍需维护者审核发布，命令本身不改变 current pointer。

## 5. 发行记录

只使用 conclusion 为 success 且 source commit 与回执一致的产物。建立 tag/GitHub prerelease 时只附加
DMG、EXE、DEB，不附加 OTA ZIP。最后在当前目标中记录 tag、source commit、workflow、文件名、大小、
SHA-256 和各平台真实验收边界。
