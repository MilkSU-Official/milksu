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

| 事实 | 当前状态 |
| --- | --- |
| 许可证 | 主项目为 `AGPL-3.0-only`（`LICENSE` / `NOTICE`）。第三方仍保留原许可。Obelisk 作为计划嵌入的 AGPL 记忆组件与此兼容；尚未 vendored。 |
| Linux | Ubuntu/Debian 共用 x64 DEB，Omarchy/Arch/Nix 共用 x64 tarball。GNOME Wayland Computer Use 走 Portal。无 Secret Service、本地 OCR；Hyprland / Xorg Computer Use unavailable。ISSUE #19 已关闭。合同见 [Linux 安装与桌面合同](linux-platform-support.md)。 |
| Agent Harness | Pi 拥有 Session、Compaction、自然语言理解、通用文件/Shell 与 Tool Loop。Coding/CTF/CVE/实验室共用完整 Coding loop；工具结果进模型前截到 Pi 的 50KB/2000 行。产品工具 when-to-use 只留在 description 与 Skill 名录。新对话可选 Pi 或 DeepSeek Harness。DSH 接到产品 MCP / Skills / 停止 / 所选型号 / 懒挂 Playwright / host compact；DeepSeek 会话不能 rewind / 分叉。不扫描用户句子做关键词/正则意图路由。 |
| 上下文工程 | 主会话 cwd 经监督器校验后注入 Pi；writer worktree 只在模型委托 effectful 角色时从当前提交准备，不要求主工作区干净，未提交改动不进入。窗口优先级：手动覆盖 > catalog（忽略旧占位）> 型号族预设 > 保守默认。型号族窗口、输出上限和思考档位以 [models.dev](https://models.dev/) 为公开基准。`/rewind` 走 Pi `navigateTree`，`/handoff` 走分叉 + compact。空闲约 80% 自动走同一 compact 路径。 |
| MilkSU 宿主边界 | 只保留会话目录记录、Provider 凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。凭据经子进程环境在 spawn 时注入：轮换惰性抵达下一回合，撤回或关掉正在用的 Key 立即停掉旧进程。Coding 另有类型化 `milksu_workspace` 与对话级批准，不替代 Pi 工具循环。 |
| 模型与附件 | 账户 TokenFlux 与本机 Provider 共用可调用模型目录；附件原图进入当前回合，不再由 MilkSU 按目录白名单标成纯文本再改走 OCR。 |
| 网页查证 | Coding 复用固定 revision 的 Pi `web_search` / `web_fetch` Extension，已保留真实搜索和官方页面读取回执。 |
| Obelisk | 会话索引底层保留；Coding 右栏和环境页的单会话“相关历史”、过滤、搜索与图谱前端已经移除。 |
| 下一发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted 云端。正式打包上传 OTA 并发布 current pointer；GitHub Release 只上用户安装包。 |

## Canonical 文档职责

| 文档 | 状态 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| [当前开发目标](current-objectives.md) | Current / Canonical | 当前阶段、能力事实、已发行记录、未打进安装包的代码、下一完成线和未接线方向 | 不写「当前最新版是」版本号或 hash；不保存完整聊天或旧验收过程；不复述 UI 规范 |
| [当前系统与分层](../architecture/current-system.md) | Current / Canonical | 当前运行结构、依赖方向、桌面表面、能力边界和发行结构 | 不写「当前最新版是」版本号或 hash；不安排任务优先级；不复述 UI 规范 |
| [Linux 安装与桌面合同](linux-platform-support.md) | Target / Designed | 共用 x64 DEB + 通用 tarball；ARM 只测不发；GNOME Portal Computer Use；ISSUE #19 已关闭 | 不把未发版安装面写成 GitHub Latest；不按 arch×distro 发 8 份包 |
| 仓库根目录 `AGENTS.md` | Current / Canonical | 仓库协作约束与产品 UI 设计语言 | 其他文档只指向它，不复制层级、token 或原语表 |
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
- 可下载的最新版只写在 README。晚于该安装包的 `main` 只描述当前仓库。
- 仓库已公开。签名 / 公证 / R2 材料只在 `macos-release` environment secrets 与本机 Personal Vault；Secret scanning 与 push protection 已打开。`macos-release` 需要 `MilkSU-Official` 审批，且只能从 `main` 部署。`main` 由 ruleset 保护：禁止强推和删分支，只有维护者可直接推送；协作者走 PR。
- 产品 UI 设计语言只写在仓库根目录 `AGENTS.md`。`docs/design/current-visual.md`、切片对照表和旧战术档案 / 酸绿稿已删除，不再作为实现约束。

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
