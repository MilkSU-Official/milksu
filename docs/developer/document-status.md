# 文档与事实状态

> Current。2026-09-25。

冲突时以当前代码、测试和安装包回执为准，然后是 [当前开发目标](current-objectives.md)，然后是 [当前系统](../architecture/current-system.md)。历史文档里的「下一步」和旧里程碑不是任务。过期稿在 Git history，不留在 `docs/`。

## 还留着的文档

| 文档 | 为什么留 |
| --- | --- |
| [当前开发目标](current-objectives.md) | 阶段、还没打进安装包的缺口 |
| [当前系统](../architecture/current-system.md) | 进程和数据边界。细节读代码 |
| [产品代码准入](product-code-admission.md) | 新能力进生产依赖图之前的四道门 |
| [产品回归循环](product-regression-loop.md) | 怎么跑 `npm run test:product-loop` |
| [产品回归自我保护](product-loop-self-protection.md) | 产品回归从 MilkSU 内部启动时保护宿主进程 |
| [三端打包与发版](release-process.md) | 发版操作，含 models.dev 对照 |
| [Linux 安装与桌面](linux-platform-support.md) | 共用 x64 DEB + tarball；ARM 只测不发；GNOME Portal |
| [macOS 签名与公证](macos-signing-and-notarization.md) | 签名材料不进仓库 |
| [看板娘皮肤](companion-skin.md) | 外部作者要交的帧和换装 |
| [插件使用说明](plugin-user-guide.md)、[插件框架](plugin-framework.md) | 外部作者。CI 看 `docs/developer/plugin-**` |
| [动效](motion.md) | 动效落在哪些表面。数值在 `AGENTS.md` |
| [中文写作规范](writing-guide.md) | 判例和 grep 自检。规矩在 `AGENTS.md`「中文写作规范」 |
| [PI 资源白名单](pi-resource-whitelist.md) | 打包进 sidecar 的固定资源 |
| [远程控制](remote-control.md) | 未实现。手机连本机的准入，不是当前完成线 |
| `AGENTS.md` | 协作约束和产品 UI。其他文档不复制 |
| [上手模板](product-loop.local.example.md) | 本机回归怎么填 Key。真值在 gitignore 的 env |

六赛道回归的数据在 `ctf-six-track-regression-manifest.json`，由 `npm run test:ctf-six-track-regression` 校验。NYU safe-static 的命令在 `cmd/nyu-ctf-bench-*`，不是产品回归，也不是 CTF 成绩。

## 规则

- 可下载版本只写 README。Current 文档可以记已经发出的 tag 回执，不写「当前最新版是」。
- 不恢复 `development-plan.md`，不把 ADR、调研笔记或验收过程重新放回入口。
- 删掉生产行为时，同时删掉文档里的宣称。
