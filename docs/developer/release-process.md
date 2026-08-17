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

## 3. 一次触发三端

```bash
npm run release:dispatch -- \
  --release-title "MilkSU 26.817.2 内测版" \
  --release-notes "本次内测说明"
```

命令先验证本地回执和当前 `main`，再把同一个 40 位 commit 分发给 macOS、Windows、Linux 三个
workflow。三个 job 随后并行运行：

| 平台 | 保留的原生门禁 |
| --- | --- |
| macOS | Stable 构建、Developer ID 签名、App/DMG 公证、staple、Gatekeeper、DMG 安装布局 |
| Windows | 原生 Go 编译、关键 Sidecar 路由、NSIS 结构、打包 Runtime 与首次启动 |
| Linux | 原生 Go 编译、关键 Sidecar 路由、DEB 结构、打包 Runtime 与 Xvfb 首次启动 |

这些检查不能由本机的全仓测试替代，因此不删除。三端 workflow 不再重复运行完整 Go、Vue、Sidecar
测试，也不再由 macOS 安装与测试无关的 `ripgrep` / `fd`。

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
