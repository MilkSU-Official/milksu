# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-09-15
>
> 本页只回答“当前处于什么阶段、下一条完成线是什么”。实现以当前代码、测试、Git 历史和原生 App 为准。
> 可下载安装包只写在 README，本页不写「当前最新版是」版本号或 hash。

## 工作规则

1. 先读当前代码、Git、本文件、[文档状态](document-status.md)和[当前系统](../architecture/current-system.md)。
2. 新能力写当前干净模型，不为已放弃设计写迁移或兼容层。
3. 上游优先：平台/Pi → 固定 Skill、MCP、插件或 CLI → 最小自有实现。不另造通用 harness。
4. Provider Key 不进模型上下文、工具输出、日志、诊断、文档或普通文件。Git 只推授权远端。
5. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果和危险大目录删除确认。
6. CTF、CVE、实验室、Coding 同级。通用循环优先共享 Pi；领域事实、Judge、Memory 由 MilkSU 持有。
7. UI/Runtime 修复回写本页。未打包或未经用户验收的不得写成已发行。产品 UI 只写在 `AGENTS.md`。
8. 发版后更新 README 下载徽章和当前状态。流程见 [三端打包与发版流程](release-process.md)。
9. 尚未实现不是禁止。真边界只覆盖 Key、未授权外部目标、Judge，以及把 smoke 写成完成。

## 当前阶段与基线

| 项目 | 当前事实 |
| --- | --- |
| 阶段 | 内测迭代 / Agent Runtime 与跨平台发行收敛。不再按 M3/M4 组织。 |
| 历史基线 | M3 product-loop 已在 `108e0e3`（2026-08-05）合并，仅供追溯。 |
| 当前开发 | 新对话可选 Pi 或 DeepSeek Harness。出厂默认官方 DeepSeek Flash。工作树 DSH 钉 `0.1.6-alpha.1`：MCP / Skills / 停止 / 所选型号 / 官方 `playwright-mcp` 懒挂 / host compact；DeepSeek 会话不能 rewind / 分叉。产品回归入口 `npm run test:product-loop`（见 [产品回归循环](product-regression-loop.md)）。自动压缩空闲阈值 80%。产品 UI 见 `AGENTS.md`。未做：#53 typed sweep；新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。 |
| 平台边界 | macOS DMG 签名公证；Windows 安装器未代码签名，打入 CUA Driver `0.27.0`；Linux 发共用 DEB 与 tarball，GNOME Portal 已进包，无 Secret Service / 本地 OCR；Hyprland/Xorg Computer Use 不可用。Windows/Linux 窗口铬尚未真机验收。安装包见 README。 |
| 发行流水 | 干净已推送的 `main` 上跑一次 canonical 验证；三端走 GitHub-hosted。`macos-release` 仅限 `main`，dispatch 后立即签名。正式包装 OTA 到私有 R2 并发布 current pointer；GitHub Release 不上 updater ZIP。 |

## 已发行

更早的 tag 见 [GitHub Releases](https://github.com/MilkSU-Official/milksu/releases)，本页不复述。

最近一次正式包装源 `d37b957`（`26.915.1`）：Pi `bash` 缺省 600 秒；非活跃 Sidecar 停靠保活；凭据轮换惰性、撤回立即停；writer 只在模型委托写入时准备；思考收进「过程」。Windows 安装器仍未代码签名。

发行页：<https://github.com/MilkSU-Official/milksu/releases/tag/v26.915.1>

| 平台 | Workflow | 安装包 | 大小 | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS ARM64 | `34873453613` | `MilkSU-macOS-arm64-26.915.1.dmg` | 300,728,583 B | `f5f39a9349e6bc892237aab9ddfce938a9bf9a7f30c159213449e9303c52ffda` |
| Windows x64 | `34873457848` | `MilkSU-Windows-x64-26.915.1-Setup.exe` | 238,824,009 B | `15aaf941a66a774f0cf38f81dccc4985ef4e9fdaff43fcf56b8659d507e9127f` |
| Linux x64 DEB | `34873461697` | `MilkSU-Linux-x64-26.915.1.deb` | 213,799,724 B | `cfaddcb225b1fd1a24f4755339475418088f67d84d812b8716f77494ae61f890` |
| Linux x64 tarball | `34873461697` | `MilkSU-Linux-x64-26.915.1.tar.gz` | 264,788,231 B | `17bd5593e460373e00e556d4ae3caacab405d3df083250ecfbe73414075b48df` |

## 未打进 GitHub 安装包

- #53 typed sweep；新对话继承项目 `milksu`；Windows Computer Use 整段崩溃尚未真机验收。
- Computer Use 仍要先选窗口。DSH `bash` 没有 MilkSU 侧超时上界（工具在 harness 进程内，不要在客户端复刻第二套循环）。
- DSH `0.1.6-alpha.1`、产品回归 `npm run test:product-loop`、`desktop-surface`（Computer Use 优先，不可用降级隔离浏览器）均未进安装包。不要把 `test:dsh-complete-loop` 当主入口。
- 准备 writer 时按停止，有时同时出现「本轮已停止。」和「Agent 运行失败」。合同只留前者。
- macOS OTA ZIP 须先把 sidecar 许可证改成属主可写，否则 ShipIt 可能装完仍是旧版。已装的 26.912.3 在下一包装进包前仍用 GitHub DMG。

## 当前产品事实

- Coding / CTF / CVE / 实验室共用 Pi 文件、Shell、自动压缩（80% 空闲与 `/compact` 同一路径）和完整工作循环。工具结果进模型前走 Pi `tool_result` 截断。不扫描用户句子做意图路由。
- MilkSU 只持会话目录、凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。
- 账户 TokenFlux 与本机 Provider 共用可调用目录；附件原图进当前回合。网页查证复用 Pi `web_search` / `web_fetch`。
- 桌面壳是 Electron/Chromium + Vue。隔离浏览器、Browser Use、Computer Use 是三个表面；面板折叠不停止 Session。产物在各 OS 文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。
- 产品 UI 只写在 `AGENTS.md`。

## 当前完成线

1. 功能改动后按 [产品回归循环](product-regression-loop.md) 跑 `npm run test:product-loop`；失败回 P0。安装包上的 Pi / 实验室靶机仍由用户真机看。
2. #53 typed sweep 只在真实 wide job 仍用 bash 复刻库存后再做。
3. 用户要求发下一版时：升版本号 → 干净已推送的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | 改对话 / 引擎 / DSH / 隔离浏览器后跑 `npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。Settings「评测」不替代这条。C9 / C15 / C16 / C20 已确认；C10 / C11 已修待复验。 |
| P0 | Pi Runtime 用户验收 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复；无 MilkSU 自建 workspace 策略或旧 session ID。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256 与平台验收。安装包见 README。 |
| P1 | OTA / current pointer | 侧栏先检查再下载；安装失败可见；CI 上传后发布 current pointer。 |
| P1 | #53 typed sweep | `bg_status` 熔断与最多 4 条只读 subagent 已进包。inventory 工具待真实 wide job 仍用 bash 时再做。 |
| P1 | 安全工具真实任务 | IDA / capa 已有设置与健康检查；用受控样本留回执。不把 HexStrike 做成默认 MCP。 |
| P1 | Obelisk 学习记录 | 先定义可归因事实，再独立页面；不恢复已删的单会话图谱。 |
| 未接线 | 同一作业 vs 新业务 | 当前 CVE/实验室复用同一会话和 `report.md`。 |
| 未接线 | CTF 比赛模式 | 对着一场比赛打，不走练习题库。尚未设计准入。 |
| 未接线 | 实验室红队模式 | 另开学习面，不是对外红队。尚未设计准入。 |

CVE：点进档案复现，Agent 改 `report.md`。实验室：独立入口，练习包起本机 Docker / AVD 或用户给地址，活报告 + 对话小窗。环境契约见 [靶机、环境经纪与活靶面](/architecture/target-environments)。

## 不要重复打开

只在新复现、自动化失败或用户明确要求时重开：已撤单会话图谱；Wails/CEF；workspace-only 文件工具；Security Bridge / `continue_ctf_job`；关键词意图路由；自建计费；把 dirty HEAD 写成已发版；M3/M4 台账。

## 领域与文档

- CTF：模型只提 Candidate；成功只来自 Judge 或用户确认。
- CVE：完成面是复现报告，不是「复现成功」。
- 实验室：未知洞探测，不是对外红队，也不是 CTF 环境包。
- Memory：用户能力事实必须能链到 Judge、正式 Evidence 或用户确认。
- 依赖方向：`Vue → Preload / RPC → Application Service → Domain / Runtime → Adapter`。
- 触碰 `CTFPage.vue`、`app.go`、`bridge-policy.js`、`browsercap/manager.go` 或 Runner/Recovery 时，不往热点文件再加一份通用 harness。
