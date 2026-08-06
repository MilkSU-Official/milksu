# 当前开发目标

> 文档状态：Current / Canonical target contract
>
> 最后收口：2026-08-06
>
> 本页只回答“现在按什么目标继续做”。实现事实以当前代码、测试、Git 历史和原生 App 验收为准。
> 旧覆盖台账和流水验收已压缩为历史摘要，不再作为当前执行入口。

## 先读规则

1. 每次开始工作先读当前代码、测试、Git 状态、本文件、文档状态和当前系统，不按旧对话重复已经闭环的事。
2. 当前仍是 pre-release；可以用破坏性方式实现新的干净模型，不为未发布旧设计写迁移、双写或兼容层。
3. 已工作的旧 schema 和历史实现暂不在功能纵切中途返工；最终收口时可集中做一次破坏性整理，再完整回归。
4. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
5. 只向 MilkSU 私有远端提交/推送/开 PR，不向引用的开源项目创建 PR。
6. 自动审批要减少无意义打断，但不能绕过付费、外部账户、Scope 扩大、路径边界、托管发布或不可逆操作。
7. CTF、CVE、Coding 是同级主工作区；同一位置、同一语义的标题、按钮、下拉、Badge、搜索框和表格操作必须使用同一视觉规格。全局设置固定在左下 rail；各页页头不再放通用齿轮，缺凭据或模块配置类 CTA 应跳到全局设置对应分类。
8. 发现非阻塞问题先稳定记录复现条件和影响，避免深度优先陷进去；只有数据/Credential/Scope/私有远端/Judge/验收失真类问题立即修。
9. 左下角日间模式按钮与主题切换暂列 UI TODO；实现前必须先确定浅色主题配色、组件状态和关键页面原型，并与用户交互确认细节效果后再写代码。
10. 每次 UI 巡检或视觉修复完成后，必须同步更新能防回归的测试与相关当前文档；不要只靠截图或口头确认记忆问题已经修过。
11. 模型与凭据设置保持普通用户入口：一个默认模型、一个模型来源、一个凭据区。默认日常模型是 DeepSeek V4 Flash；TokenFlux/词元流动是一等中转站入口；当前不保留 fast/deep 按角色模型路由，也不接 Kimi/KouriChat 产品入口。旧 pre-release `model_routing` 记录不迁移，后续真有需求再重新设计按需路由。

## 当前合并后事实

- M3 product-loop PR #1 已于 2026-08-05 squash merge 到 `main`，合并提交 `108e0e3`；后续不要把该 PR 或 `codex/authorized-learning-foundation` 当作打开中的当前任务。
- `AGENTS.md` 是仓库 Agent 指导源；`CLAUDE.md` 只是指向它的兼容软链接。
- Coding 已有 Plan/Go、权限、附件、本地 OCR、LSP、Artifact Preview、隔离 Browser、后台任务恢复、Diff/Hunk、Git、PR 发布确认、worktree、ImageGen、Project MCP、Session Index 和 Computer Use 外部 App 纵切。
- CVE 已有学习/追踪 MVP：多源只读情报同步、来源快照、Vulhub 练习目录匹配、本地 Docker Compose 练习生命周期、资产验证、学习写回和 Coding 接力。
- CTF 主链已有题库、自定义题、工作区、Evidence、候选、Judge、Checkpoint、恢复、复盘和 Memory；真实 Judge 成功仍只有窄 Web 路径。
- Runtime 已有 Sidecar 恢复、Compaction、异常退出标记、后台长任务打包 App/WebView 恢复、预算和失败分类。
- 模型与凭据设置已收敛为一个默认模型、一个模型来源和一个凭据区；DeepSeek V4 Flash 是默认日常模型，TokenFlux 是一等中转站入口，fast/deep 按角色模型路由和 Kimi/KouriChat 产品入口已移除。
- Labs 纵深闭环暂停；CVE 纵深研究、真实漏洞复现、外部资产实验和披露流程后置。
- NYU safe-static 只能叫 Pi Runtime safe-static smoke，不能叫 MilkSU 完整 CTF 成绩。

## 当前优先级

| 优先级 | 主线 | 下一步只认什么完成 |
| --- | --- | --- |
| P0 | Coding 自举质量 | 在真实打包 MilkSU 中完成一个更自然的 MilkSU 或用户项目任务：理解、修改、测试、预览/Computer Use 或 Browser 验证、恢复、Git 交付；重点看真实外部 Provider 质量和人工接管次数。 |
| P0 | Session Index / Obelisk 形态长期记忆 | 继续内置，不退回“检测用户是否安装 Obelisk CLI”；扩展真实用户历史目录、Claude/Kimi/Pi 样本、许可证/NOTICE/ADR。 |
| P0 | CVE 学习/追踪扩样 | 用更多真实 CVE 验证多源同步、练习目录、研究档案、资产验证和学习写回；仍不做外部攻击、自动 PoC 或披露。 |
| P1 | CTF 六赛道 | Web、Pwn、Reverse、Crypto、Forensics、Misc 各至少一题 Judge-verified；每题留材料、轨迹、候选、Judge、恢复、复盘和提示依赖。 |
| P1 | Memory 可信度 | 区分 user / agent / shared / imported 与 none / hint / copilot / delegated；Agent 代做不能提升用户独立能力。 |
| P1 | Runtime Reliability | 用自建安全 fixture 验证多轮、文件读取、命令、工具、重启、压缩、取消、预算、失败分类。 |
| P2 | 本地交付与发行 | 崩溃恢复、诊断、全新机器、Developer ID 签名 `.app`、DMG、公证、stapling、升级、性能和尺寸矩阵进入 RC 阶段再做；其中稳定 Developer ID 签名会影响 macOS TCC / Computer Use 授权复检，应先于外部分发验收补齐。DMG 发布工作流参考同开发者 FiberGuard 的两阶段签名/公证流程：先生成 Developer ID 签名 `.app`，再生成签名 DMG，提交 notarization，最终 staple、`codesign` 与 `spctl` 校验；不得读取或迁移本机签名私钥、证书密码或 Personal Vault。 |
| 持续约束 | 架构与 UI | 触碰即拆热点文件；不新开纯清债里程碑。UI 巡检后同步测试和当前文档；日间模式先做配色/原型并经用户确认。文档继续压缩为短入口 + Evidence 索引。 |

## 不要重复打开的已闭环项

以下只在出现新复现或测试失败时重新打开：

- Archify 生成/验证/预览；
- Coding 的基础理解、测试、审阅、修复、总结动作；
- Plan/Go、三档权限、逐次审批、完全访问；
- 附件、本地 OCR、视觉模型降级；
- Coding Browser 基础隔离、Playwright MCP、Browser 证据目录；
- TypeScript/Vue/Go LSP 和 TypeScript Code Action；
- Git Diff/Hunk、stage、commit、push、PR 预览与经确认发布；
- CTF/CVE/Coding 顶栏视觉规格统一；全局设置固定在左下 rail；重复 Logo 已移除；头像能力画像入口已恢复；
- Computer Use 外部 App/窗口 Scope、Settings 权限检测、工具截图辅助视觉；
- Artifact Preview 的 Markdown/HTML/PNG 打包 App 验收；
- 后台任务打包 App/WebView 跨重启恢复；
- CVE 多源同步、真实 snapshot、本地练习生命周期、学习写回、资产验证；
- Session Index 基础索引、相关历史展示、用户确认写入 CVE Note / Coding 输入 / CTF 复盘；
- 模型与凭据页普通入口简化、TokenFlux 中转站接入、Kimi/KouriChat 产品入口移除、fast/deep 按角色模型路由删除；
- M3 product-loop PR #1 合并。

## CTF 完成线

六赛道验收保持不变：Web、Pwn、Reverse、Crypto、Forensics、Misc 各至少一题真实 Judge-verified。

每题证据包必须包含：

- 授权题面和材料；
- Solver 轨迹与 Checkpoint；
- 候选 Flag 与依据；
- 平台 Judge 回执；
- 提示依赖、用户贡献和协作方式；
- 中断/恢复；
- 复盘、训练证据和是否进入 Memory。

Tool Builder 和 Strategist 不要求每题都调用；只需要至少各有一次跨赛道自然闭环。

## CVE 完成线

当前只做学习/追踪，不做红队 Agent。

短期可继续扩展：

- NVD、FIRST EPSS、OSV、GHSA、CISA KEV、Vulhub 等来源的缓存、更新时间、失败原因和引用；
- CVE → 练习环境 → 用户确认启动/停止/清理 → Agent 辅助学习 → 笔记/证据/Memory；
- 授权仓库内的只读影响检查和补丁阅读；
- 学习结论与资产验证必须进入 MilkSU 正式档案，不能只留在 localStorage 或聊天摘要。

明确后置：

- 未授权外部目标；
- 批量扫描、批量打靶、横向移动；
- 自动 PoC / exploit / 漏洞触发输入；
- 披露平台自动提交。

## Memory 完成线

- Memory 表示可复用经验；Ability Profile 表示有证据支持的用户能力。
- Judge 正确性和用户贡献度是两个维度。
- 用户独立能力只能来自显式用户操作或用户确认的结构化记录。
- Agent 总结、猜测和复盘文本不能自动变成用户能力事实。
- 推荐理由必须能链接到 Judge、提示、步骤、失败记录或用户确认材料。
- 当前题不能召回自己的复盘；无关题要作为负对照。

## NYU / Bench 完成线

- 先做 Runtime Reliability Bench，使用自建、安全、可复跑 fixture。
- NYU CTF Outcome Bench 后置到六赛道稳定之后，只用人工准入安全子集。
- 当前 safe-static 结果不能描述为 MilkSU 完整 CTF 成绩。

## 架构和文档规则

- 触碰 `CTFPage.vue`、`app.go`、`bridge-policy.js`、`internal/browsercap/manager.go`、CTF Runner/Recovery 时，避免继续塞新职责；能顺手抽出边界就抽。
- Wails 只做桌面调用和 DTO；领域层不依赖 Wails；Pi Runtime 不知道 NSSCTF/CTFshow 页面细节；平台 Adapter 不决定学习成功或用户能力。
- 文档保持三层：Current 入口、Evidence 索引、Historical/Research。不要把过程聊天、微提交、验收流水账继续堆进入口文档。
- 下一轮文档清理重点：继续压缩长设计文档和旧验收流水，但不要篡改 dated review / ADR 的历史语境。
