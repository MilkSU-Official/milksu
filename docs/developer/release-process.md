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
  --release-title "MilkSU 26.818.1 内测版" \
  --release-notes "本次内测说明"
```

命令先验证本地回执和当前 `main`，默认只把同一个 40 位 commit 分发给 **Windows** 与 **Linux**
workflow（避免 GitHub-hosted macOS 分钟费）。macOS 正式签名包在本机完成：

```bash
npm run release:mac:local -- \
  --release-title "MilkSU 26.818.1 内测版" \
  --release-notes "本次内测说明"
```

本机脚本从 Personal Vault 读取 Developer ID / Notary 资产，导入一次性 Keychain，构建、签名、公证、
staple，完成后删除临时 Keychain；不把私钥写入仓库或日志。产物：`build/release/MilkSU-macOS-arm64-<version>.dmg`（与 Win/Linux 一样带版本号）。

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

## 4. 创建 GitHub Release 页（必做）

Windows/Linux Actions 成功、本机 macOS DMG 就绪后，必须创建（或刷新）**Releases 页面**，
不要只留一个空 tag。QQ 群分发、下载页和校验都以 Release 页为准：

```bash
# 先把云端产物拉到本机（run id 换成本轮成功的 Windows / Linux workflow）
mkdir -p build/release/github/windows build/release/github/linux
gh run download <windows-run-id> -D build/release/github/windows -n MilkSU-Windows-x64-installer
gh run download <linux-run-id> -D build/release/github/linux -n MilkSU-Linux-x64-deb-trial

npm run release:github -- \
  --release-title "MilkSU 26.818.1 内测版" \
  --release-notes "本次内测说明"
```

该命令会：

1. 核对本地 `release:verify` 回执与当前 HEAD/版本；
2. 收集版本化安装包：`MilkSU-macOS-arm64-<version>.dmg`、`MilkSU-Windows-x64-<version>-Setup.exe`、`MilkSU-Linux-x64-<version>.deb`；
3. 用同一 source commit 创建或更新 `v<version>` **prerelease** 页面并上传安装包与 `SHA256SUMS-<version>.txt`；
4. 清理旧的无版本号 macOS 资产名（若仍存在）。

## 5. 可选：私有 R2 / Admin OTA

默认 GitHub Release 只提供 DMG、EXE、DEB。macOS 默认不再额外压缩 updater ZIP，也不生成 OTA
metadata。

确实要在同一轮上传私有 R2 并建立 Admin 草稿时，对 macOS 本机发版加 `--upload-release`（或对云端
macOS 使用 `release:dispatch -- --macos-cloud --upload-release ...`）。Admin 草稿仍需维护者审核
发布，命令本身不改变 current pointer。

## 6. 发行记录

只使用 conclusion 为 success 且 source commit 与回执一致的产物。GitHub prerelease 只附加
DMG、EXE、DEB（加 SHA256SUMS），不附加 OTA ZIP。

## 7. 必做：回写并推送版本事实

GitHub Release 页创建成功后，**同一轮**必须更新 Current 文档并推到私有 `main`。发版没有在文档
里变成“最新”，就不算收口。不要把上一版回执留到第二天。

必须同步这些入口，使“正式发行基线”与刚刚发出的 tag 一致：

| 文件 | 必须改写的事实 |
| --- | --- |
| [当前开发目标](current-objectives.md) | 正式发行基线、已发行/未发版分界、完成线表格（tag、source commit、workflow、文件名、大小、SHA-256、平台边界） |
| [文档状态](document-status.md) | 事实摘要里的发行基线、已发行线、开发版本线、三端产物和最近回执 |
| [当前系统](../architecture/current-system.md) | 文首基线，以及刚打进安装包的能力状态 |
| `README.md` | 下载徽章、下载链接和“当前状态”里的最新回执版本 |
| `AGENTS.md` | Release Claims 中的最近一次三端回执 |

同时把晚于该 tag 的 `main` 提交留在“未发版”，不要把同版本号的后续 HEAD 写成已经发出。
平台未跑就写未跑；没有 SHA-256 就不要把空 tag 或 `package.json` 版本号当成已发布。

文档提交不移动发行 tag。推送后核对 Downloads 页、当前目标和 README 写的是同一版本号。
