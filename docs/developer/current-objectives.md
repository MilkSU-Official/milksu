# 当前开发目标

> Current。最后收口：2026-09-25。
>
> 只回答现在处于什么阶段、下一版要什么。实现以代码、测试和安装包回执为准。
> 可下载版本只写在 README。产品 UI 只写在 `AGENTS.md`。

## 工作规则

1. 先读代码、Git、本文件、[文档状态](document-status.md)、[当前系统](../architecture/current-system.md)。
2. 新能力写当前模型，不为已放弃设计加迁移层。上游有的能力不另造 harness。
3. Provider Key 不进模型上下文、日志、文档或普通文件。只推授权远端。
4. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果和危险大目录删除。
5. CTF、CVE、实验室、Coding 同级。领域事实和 Judge 由 MilkSU 持有。
6. 未打包或未经真机验收的，不得写成已发行。发版流程见 [三端打包](release-process.md)。

## 阶段

内测迭代。不再按 M3/M4 排期。M3 product-loop 已在 `108e0e3`（2026-08-05）合并，只供追溯。

出厂默认官方 DeepSeek Flash、运行时 Pi。新对话可选 Pi 或 DeepSeek Harness；设置里的默认运行时只改新对话。工作树 Pi 钉 0.87.0，DSH 钉 `0.1.6-alpha.1`。DSH 是内核，不是 UI。

产品回归：`npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。

## 已发行

最近一次正式包装源 `2fa97b3d`（`26.922.2`）。更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.922.2>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `35719595545` | `MilkSU-macOS-arm64-26.922.2.dmg` | 335,767,350 B | `a05546387ccded76b2858ae5c7ef6172fbca9bafc7df08252cdbf1c22ed8205c` |
| Windows x64 | `35719599395` | `MilkSU-Windows-x64-26.922.2-Setup.exe` | 267,318,961 B | `7b93104543121b2d0fcd28b0e7915f1010a1bf3d4f4e84004c2c9f413f6dc7b5` |
| Linux x64 DEB | `35719603250` | `MilkSU-Linux-x64-26.922.2.deb` | 241,440,852 B | `561b908749cca1979b3e9d22b1db2024fe9081c974d227d2dd226f5ffd4777fe` |
| Linux x64 tarball | `35719603250` | `MilkSU-Linux-x64-26.922.2.tar.gz` | 295,198,785 B | `4216d02a746602047d34ae5a2e838a7728e8be995ceab51696bc70cf3a536125` |

Windows 安装器仍未代码签名。

## 未打进该安装包

工作树里已有、上面那个 tag 没有的，以代码为准。发下一版前仍缺的验收：

- Windows Computer Use 整段崩溃尚未真机验收。Windows / Linux 窗口铬尚未真机验收。
- 新对话继承项目 `milksu` 还没有。
- 宽作业用 `recon-authorized-target` Skill，不造 typed sweep。Computer Use 选窗器仍是可选人工面。
- DSH `bash` 没有 MilkSU 侧超时上界。
- 决策（Jev，没接上则当前对话模型）和记忆归档结果进看板娘过程折叠。账户发钥匙，设置里不填。issue #117 的另外几问、#155、#156 还没接到这一层。

## 完成线

1. 改对话、引擎、DSH 或隔离浏览器后跑产品回归。失败先修。
2. 用户要求发版时：对照 models.dev（[发版流程](release-process.md) §1.5）→ 升版本号 → 干净已推送的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | `npm run test:product-loop`。Settings「评测」不替代。 |
| P0 | Pi 真机 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256。安装包见 README。 |
| P1 | OTA | 侧栏下载，用户点安装并重启。有任务先确认退出。 |
| 未接线 | 远程控制 | 手机连本机，不是云 Agent。见 [远程控制](remote-control.md)，[#131](https://github.com/MilkSU-Official/milksu/issues/131)。 |
| 未接线 | CTF 比赛模式 / 实验室红队面 | 尚未设计准入。 |

只在新复现或用户明确要求时重开：已撤单会话图谱、Wails/CEF、关键词扫描用户句子做路由、自建计费、把 dirty HEAD 写成已发版、M3/M4 台账。
