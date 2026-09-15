# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-09-15
>
> 产品开发目标：内测迭代 / Agent Runtime 与跨平台发行收敛

## 事实优先级

发生冲突时按以下顺序判断：

1. 当前代码、Git 状态、自动化测试、打包 Sidecar、原生 App 与真实平台回执；
2. [当前开发目标](current-objectives.md)；
3. [当前系统与分层](../architecture/current-system.md)；
4. Target / Designed 文档；
5. Evidence、Historical、Research 与 Design Snapshot。

历史文档里的“下一步”“未完成”“M2/M3/M4/R0.x”不构成当前任务。M3 product-loop 在
`108e0e3`（2026-08-05）合并，仅用于追溯；当前工作不再按旧里程碑或百分比台账推进。

## 当前事实摘要

实现细节以 [当前开发目标](current-objectives.md) 和 [当前系统](../architecture/current-system.md) 为准，本表只作索引。

| 事实 | 当前状态 |
| --- | --- |
| 许可证 | `AGPL-3.0-only`。Obelisk 兼容、尚未 vendored。 |
| Linux | 共用 x64 DEB + tarball。GNOME Portal Computer Use。无 Secret Service / 本地 OCR。见 [Linux 合同](linux-platform-support.md)。 |
| Agent | Pi 拥有 Session / Compaction / Tool Loop。新对话可选 DSH（工作树钉 `0.1.6-alpha.1`）。产品回归 `npm run test:product-loop`。不扫描用户句子做意图路由。 |
| 宿主 | 会话目录、凭据隔离、桌面授权、Judge、危险删除确认。 |
| 模型与附件 | 账户与本机目录共用；附件原图进当前回合。 |
| 发行 | 干净 `main` 验证一次；三端云端打包。OTA 走私有 R2；GitHub Release 只上安装包。 |

## Canonical 文档职责

| 文档 | 状态 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| [当前开发目标](current-objectives.md) | Current / Canonical | 当前阶段、能力事实、已发行记录、未打进安装包的代码、下一完成线和未接线方向 | 不写「当前最新版是」版本号或 hash；不保存完整聊天或旧验收过程；不复述 UI 规范 |
| [产品回归循环](product-regression-loop.md) | Evidence / Living | 改功能后怎么选跑产品契约套件；和 Settings 评测 / NYU / DSH 单脚本的分界 | 不写模型 Pass@1；不替代安装包真机验收 |
| [当前系统与分层](../architecture/current-system.md) | Current / Canonical | 当前运行结构、依赖方向、桌面表面、能力边界和发行结构 | 不写「当前最新版是」版本号或 hash；不安排任务优先级；不复述 UI 规范 |
| [Linux 安装与桌面合同](linux-platform-support.md) | Target / Designed | 共用 x64 DEB + 通用 tarball；ARM 只测不发；GNOME Portal Computer Use；ISSUE #19 已关闭 | 不把未发版安装面写成 GitHub Latest；不按 arch×distro 发 8 份包 |
| 仓库根目录 `AGENTS.md` | Current / Canonical | 仓库协作约束与产品 UI 设计语言 | 其他文档只指向它，不复制层级、token 或原语表 |
| 本文件 | Current / Living | 事实优先级、文档职责、生命周期和维护规则 | 不复制实现细节或测试日志 |
| Evidence 文档 | Evidence | 可复现命令、截图、哈希、平台回执和失败证据 | 不自动升级为当前完成状态 |
| Historical / Research / Design Snapshot | Historical / Research | 设计来源、旧方案、研究输入与视觉记录 | 不作为实现队列或当前架构 |

## 当前边界

- Electron/Chromium + Vue + 受管 Go + Pi Sidecar。不再维护 Wails/CEF。
- Coding / CTF / CVE / 实验室共用 Pi 通用能力。浏览器、Browser Use、Computer Use 是三个 Scope；折叠面板不停止 Session。
- Provider Key 不进 renderer、模型上下文、日志或文档。
- 产物在文档目录 `MilkSU`；Runtime、凭据、Obelisk、浏览器 Profile 在用户配置目录。
- CTF 成功只来自 Judge 或用户确认。未授权外部目标要可见授权。模型候选不能写成已确认漏洞。
- Beta 只用于明确要求的自举。可下载最新版只写在 README。
- 签名 / 公证 / R2 只在 `macos-release` 与本机 Vault。产品 UI 只写在 `AGENTS.md`。

## 文档生命周期

- **Current**：当前入口。代码事实变化后必须同步；过期内容应删除或降级，不在正文堆叠旧状态。
- **Target / Designed**：已确认方向但未全部实现，必须明确缺少的代码或真实验收。
- **Evidence**：已经发生的测试或回执，不能外推到未覆盖平台、模块或版本。
- **Historical / Research**：仅供追溯，不作为下一步。
- **Paused**：当前发行包和完成线里没有它。这只说明现在没做，不表示不准做。实验代码若已进生产依赖图，仍应隔离或删除。

## 维护规则

1. 子功能完成后，先更新当前目标中的事实与完成线，再决定是否需要架构或 Evidence 文档。
2. 新发行当轮更新 README 的下载徽章、链接和当前状态。Current 文档写该 tag 的回执和能力事实，禁止在 README 以外写「当前最新版是」版本号或 hash。
3. 不能把 ad-hoc 包、空 tag 或同版本号后续提交写成已发布。可下载最新版只以 README 为准。
4. 删除生产 UI 或防御层后，同时删除 Current 文档里的能力宣称；历史验收留 Git history 或 Evidence。
5. 不恢复 `development-plan.md`，不把旧对话、压缩摘要、smoke 列表或 M3/M4 台账重新放回 Current 入口。
6. 过期调研快照、日期验收截图和已放弃的设计稿图不留在 `docs/`；考古用 Git history。README 产品截图放在 `docs/media/`，随产品表面更新。产品 UI 规范只写在 `AGENTS.md`，不要在其他文档复述。
