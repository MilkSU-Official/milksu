# 文档与事实状态

> 状态：Current / Living
>
> 最后事实审计：2026-08-17
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
| 开发 HEAD | `main@7d6126784b059611a7ee09772b71ec84b5cd547b`；CTF/CVE 已恢复 Pi 原生文件、Shell 与会话生命周期语义。 |
| 正式签名发行 | `v26.817.1 / main@783679f`；macOS ARM64 DMG 与 Windows x64 安装程序已完成对应平台验收，R2/Admin current pointer 未发布。 |
| Linux | `main@4ffa5a1` 的 x64 `.deb` 通过原生 Ubuntu 包结构、Node/Pi、Go Runtime 与 Xvfb Electron 启动；尚不是正式发行，也不是最新 Runtime 代码。 |
| Agent Harness | Pi 拥有 Session、Compaction、自然语言理解、通用文件/Shell 与 Tool Loop。MilkSU 已删除 workspace-only 文件工具、Node 文件权限状态机、普通回合 watchdog、CTF sandbox-exec、CVE 只读启动限制与客服式回复模板。 |
| MilkSU 宿主边界 | 只保留会话目录记录、Provider 凭据隔离、桌面授权、领域事实/Judge，以及危险大目录删除二次确认。 |
| 模型与附件 | 账户 TokenFlux 与本机 Provider 共用模型目录；图片由当前模型原生 image input 或本地 OCR 自动路由，附件通过统一可预览/移除队列进入 Pi。 |
| 网页查证 | Coding 复用固定 revision 的 Pi `web_search` / `web_fetch` Extension，已保留真实搜索和官方页面读取回执。 |
| Obelisk | 会话索引底层保留；Coding 右栏和环境页的单会话“相关历史”、过滤、搜索与图谱前端已经移除。 |
| 当前发行任务 | 用户已明确要求 macOS、Windows、Linux 从同一新版本和同一干净 source commit 发行；完成状态以三端真实产物与各自回执为准。 |

## Canonical 文档职责

| 文档 | 状态 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| [当前开发目标](current-objectives.md) | Current / Canonical | 当前阶段、开发/发行基线、下一完成线、活跃队列和后置项 | 不保存完整聊天、微提交或旧验收过程 |
| [当前系统与分层](../architecture/current-system.md) | Current / Canonical | 当前运行结构、依赖方向、桌面表面、能力边界和发行结构 | 不安排任务优先级 |
| 本文件 | Current / Living | 事实优先级、文档职责、生命周期和维护规则 | 不复制实现细节或测试日志 |
| Evidence 文档 | Evidence | 可复现命令、截图、哈希、平台回执和失败证据 | 不自动升级为当前完成状态 |
| Historical / Research / Design Snapshot | Historical / Research | 设计来源、旧方案、研究输入与视觉记录 | 不作为实现队列或当前架构 |

## 当前边界

- MilkSU 是 Electron/Chromium + Vue 桌面壳、受管 Go Runtime 和 Pi Sidecar；不再维护 Wails/CEF 双壳。
- Coding、CTF、CVE 共用 Pi 通用能力；CTF/CVE 只增加领域上下文、事实、Evidence、Judge 与返回工作台。
- 浏览器、Browser Use、Computer Use 是三个不同 Scope；面板折叠只改变可见性，不应停止 Session。
- Provider Key 不进入 renderer、模型上下文、Shell、后台任务、日志、诊断或文档。
- 用户可见产物位于各操作系统用户文档目录的 `MilkSU` 子目录；Runtime、凭据、Obelisk、浏览器 Profile 和恢复数据位于平台用户配置目录。
- CTF 成功必须来自独立 Judge 或用户明确确认；CVE 当前只做学习/追踪，不默认运行 PoC 或作用于外部资产。
- Beta 只用于用户明确要求的 MilkSU 自举；普通开发、测试和发行准备不构建 Beta。

## 文档生命周期

- **Current**：当前入口。代码事实变化后必须同步；过期内容应删除或降级，不在正文堆叠旧状态。
- **Target / Designed**：已确认方向但未全部实现，必须明确缺少的代码或真实验收。
- **Evidence**：已经发生的测试或回执，不能外推到未覆盖平台、模块或版本。
- **Historical / Research**：仅供追溯，不作为下一步。
- **Paused**：不进入生产依赖图、启动链或当前完成条件。

## 维护规则

1. 子功能完成后，先更新当前目标中的事实与完成线，再决定是否需要架构或 Evidence 文档。
2. 新发行必须记录 tag、source commit、workflow、产物名、大小、SHA-256 和平台验收；平台未跑即写未跑。
3. 当前代码晚于签名发行时，必须同时写“开发 HEAD”和“正式发行基线”，不能把 ad-hoc 包写成已发布。
4. 删除生产 UI 或防御层后，同时删除 Current 文档里的能力宣称；历史验收留 Git history 或 Evidence。
5. 不恢复 `development-plan.md`，不把旧对话、压缩摘要、smoke 列表或 M3/M4 台账重新放回 Current 入口。
