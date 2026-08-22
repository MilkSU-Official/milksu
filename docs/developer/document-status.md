# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-23
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

| 事实 | 当前状态 |
| --- | --- |
| 正式发行基线 | `v26.822.1 / 3db4615d7fa63a1ded64bcd77fb36a437ae98803`（2026-08-22 今日首发）。这是最近一次带三端产物与 SHA-256 的内测包；标签固定在该 source commit，后续 workflow/文档提交不移动标签。 |
| 已发行线 | `26.817.1` 建立账户 TokenFlux / 双来源路由与 Pi 网页查证；`26.817.2` 补齐 Linux 试用 DEB 与 Windows 启动；`26.817.3` 修 Windows 账户授权恢复与打包 Sidecar 路径；`26.818.1` 发出账户可调用目录与当日首发包；`26.818.2` 发出 Coding 多标签浏览器、`milksu_workspace`、85% 自动压缩、CTF 本地目录、Windows Computer Use 与应用级调试模式；`26.819.1` 发出 ak-ui 生产视觉、目录不默认展开，以及普通 Go 不再自动启动隔离浏览器；`26.822.1` 发出 CVE 档案复现、实验室、对话小窗和原子 `milksu_workspace` 记录操作。 |
| 开发版本线 | 仓库版本为 `26.822.1`。正式发行源是 `3db4615`；文档收口提交不移动该 tag。 |
| 三端内测发行 | GitHub prerelease `v26.822.1` 已提供签名并公证的 macOS ARM64 DMG、未签名 Windows x64 EXE 和 Linux x64 试用 DEB，以及 `SHA256SUMS-26.822.1.txt`；R2/Admin current pointer 未发布。 |
| Linux | `26.822.1` DEB 已包含当前 Pi Runtime 收敛并通过原生 Ubuntu 包结构、Node/Pi、Go Runtime 与 Xvfb Electron 启动；仍不含 Secret Service、本地 OCR 或 Computer Use。 |
| Agent Harness | Pi 拥有 Session、Compaction、自然语言理解、通用文件/Shell 与 Tool Loop。MilkSU 已删除 workspace-only 文件工具、Node 文件权限状态机、普通回合 watchdog、CTF sandbox-exec、CVE 只读启动限制与客服式回复模板。不扫描用户句子做关键词/正则意图路由。开发 HEAD 起 Coding/CTF/CVE/实验室强制 Pi 自动压缩，工具结果进模型前截断到 Pi 的 50KB/2000 行；CTF 任务 UI `/compact` 不再拒绝。 |
| MilkSU 宿主边界 | 只保留会话目录记录、Provider 凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。Coding 另有类型化 `milksu_workspace` 与对话级批准，不替代 Pi 工具循环。 |
| 模型与附件 | 账户 TokenFlux 与本机 Provider 共用可调用模型目录；图片由当前模型原生 image input 或本地 OCR 自动路由，附件通过统一可预览/移除队列进入 Pi。 |
| 网页查证 | Coding 复用固定 revision 的 Pi `web_search` / `web_fetch` Extension，已保留真实搜索和官方页面读取回执。 |
| Obelisk | 会话索引底层保留；Coding 右栏和环境页的单会话“相关历史”、过滤、搜索与图谱前端已经移除。 |
| 最近发行回执 | macOS 本机签名公证 DMG；Windows `32575528276`、Linux `32575529943` 均成功。文件名、大小和 SHA-256 记录在当前开发目标。 |
| 下一发行流水 | canonical 全仓验证只在干净且已推送的 source commit 上运行一次并写本地回执；Windows/Linux 走云端，macOS 默认本机签名公证；必须创建 GitHub Release 页。GitHub-only 不构建 macOS OTA ZIP/metadata。 |

## Canonical 文档职责

| 文档 | 状态 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| [当前开发目标](current-objectives.md) | Current / Canonical | 当前阶段、正式发行基线、开发版本线、已发行/未发版事实、下一完成线和未接线方向 | 不保存完整聊天、微提交或旧验收过程 |
| [当前系统与分层](../architecture/current-system.md) | Current / Canonical | 当前运行结构、依赖方向、桌面表面、能力边界和发行结构 | 不安排任务优先级 |
| 本文件 | Current / Living | 事实优先级、文档职责、生命周期和维护规则 | 不复制实现细节或测试日志 |
| Evidence 文档 | Evidence | 可复现命令、截图、哈希、平台回执和失败证据 | 不自动升级为当前完成状态 |
| Historical / Research / Design Snapshot | Historical / Research | 设计来源、旧方案、研究输入与视觉记录 | 不作为实现队列或当前架构 |

## 当前边界

- MilkSU 是 Electron/Chromium + Vue 桌面壳、受管 Go Runtime 和 Pi Sidecar；不再维护 Wails/CEF 双壳。
- Coding、CTF、CVE、实验室共用 Pi 通用能力；CTF 增加题目事实与 Judge，CVE/实验室增加档案或作业与活报告。
- 浏览器、Browser Use、Computer Use 是三个不同 Scope；面板折叠只改变可见性，不应停止 Session。
- Provider Key 不进入 renderer、模型上下文、Shell、后台任务、日志、诊断或文档。
- 用户可见产物位于各操作系统用户文档目录的 `MilkSU` 子目录；Runtime、凭据、Obelisk、浏览器 Profile 和恢复数据位于平台用户配置目录。
- CTF 成功必须来自独立 Judge 或用户明确确认。CVE 发行面仍是学习/追踪；开发线已有点进档案后的复现报告。「实验室」是独立一级入口，不是 CTF 可重置环境。对用户未授权的外部目标，仍需要可见、准确的授权。模型候选不能写成已确认漏洞。
- Beta 只用于用户明确要求的 MilkSU 自举；普通开发、测试和发行准备不构建 Beta。
- 下载页与对外状态以 `26.822.1` 回执为准；晚于 `3db4615` 的 `main` 只描述当前仓库，不能改写该发行页。
- 生产视觉以 [当前视觉约定](../design/current-visual.md) 为准。旧战术档案 / 酸绿稿和 `design-qa.md` 已删除，不再作为实现约束。

## 文档生命周期

- **Current**：当前入口。代码事实变化后必须同步；过期内容应删除或降级，不在正文堆叠旧状态。
- **Target / Designed**：已确认方向但未全部实现，必须明确缺少的代码或真实验收。
- **Evidence**：已经发生的测试或回执，不能外推到未覆盖平台、模块或版本。
- **Historical / Research**：仅供追溯，不作为下一步。
- **Paused**：当前发行包和完成线里没有它。这只说明现在没做，不表示不准做。实验代码若已进生产依赖图，仍应隔离或删除。

## 维护规则

1. 子功能完成后，先更新当前目标中的事实与完成线，再决定是否需要架构或 Evidence 文档。
2. 新发行当轮必须更新并推送 Current 文档：tag、source commit、workflow、产物名、大小、SHA-256 和平台验收；平台未跑即写未跑。不能把上一版回执留成“最新”。
3. 当前代码晚于签名发行时，必须同时写“开发 HEAD / 版本线”和“正式发行基线”，不能把 ad-hoc 包、版本号、空 tag 或同版本号的后续提交写成已发布。
4. 删除生产 UI 或防御层后，同时删除 Current 文档里的能力宣称；历史验收留 Git history 或 Evidence。
5. 不恢复 `development-plan.md`，不把旧对话、压缩摘要、smoke 列表或 M3/M4 台账重新放回 Current 入口。
6. 过期调研快照、日期验收截图和已放弃的设计稿图不留在 `docs/`；考古用 Git history。README 产品截图放在 `docs/media/`，随发行视觉更新。
