# 产品闭环冲刺验收记录

> 文档状态：开发期 Evidence，不是最终发布说明。

本文件只记录当前冲刺期间已经执行过的可复核验收动作，避免后续 Agent 把口头进展误当成
已完成声明。最终架构、里程碑、状态页和发布说明仍按 `product-loop-sprint.md` 后置统一更新。

## 2026-08-04 · CTF default desk declutter

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交（见 Git log） |
| 窄测 | `npm --prefix app test -- CTFPageNavigationContract.test.ts CTFWorkspaceHeader.test.ts WorkspaceTopBar.test.ts` |
| 窄测结果 | 3 files / 10 tests passed |
| Build | `npm --prefix app run build` |
| Build 结果 | production build passed |

覆盖范围：

- CTF 默认题库桌面的“六赛道真实验收”从大块常驻卡片改为默认折叠状态条；
- 用户仍能看到 `0/6 Judge` 或 Ready 状态，也能展开查看缺失赛道；
- 折叠说明明确默认解题界面只保留题面、Agent/实验和当前授权/提交，避免把内部 Evidence/Judge/Memory 模型当默认信息架构；
- 仍保留“一题成功只算赛道 smoke，不能描述为完整 CTF 成绩”的文案和测试契约。

本次仍未证明：

- CTF 工作台整体信息架构已经完成重做；
- 真实 CTF job 中所有零值面板都已渐进展示；
- 打包 App 中用户实际进入 CTF 题库、解题会话和复盘模式后的视觉 QA。

## 2026-08-04 · CVE Coding conclusion write-back

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交（见 Git log） |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts VulnerabilityLoopPanel.test.ts vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 4 files / 37 tests passed |
| Build | `npm --prefix app run build` |
| Build 结果 | production build passed |

覆盖范围：

- CVE 研究笔记区新增“导入 Coding 结论”；
- 用户可以把 Coding Agent 完成后的摘要、材料链接或只读影响检查结论粘贴回当前 CVE；
- 导入结果同时写入“关键结论”和“学习笔记”，并标注为“用户粘贴/确认”的 Coding 结论回写；
- 下一步状态可从“补用户笔记”推进到“复制证据摘要”，让 CVE → Coding → CVE 的学习闭环可见；
- UI 明确该入口不自动提升用户能力画像，避免 Agent 输出直接变成用户能力事实。

本次仍未证明：

- Coding Agent 真实完成 CVE 影响检查后的自动回写；
- Memory / Ability Profile 对该笔记的端到端归因校准；
- 打包 App 中用户真实完成 CVE → Coding → CVE 回写的视觉验收。

## 2026-08-04 · CVE local practice catalog import

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交（见 Git log） |
| 窄测 | `npm --prefix app test -- useVulnerabilityDashboard.test.ts VulnPage.test.ts VulnerabilityLoopPanel.test.ts vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 4 files / 36 tests passed |
| Build | `npm --prefix app run build` |
| Build 结果 | production build passed |

覆盖范围：

- CVE 顶栏新增“导入练习”入口；
- 用户可以粘贴本地只读 practice catalog JSON，把已追踪 CVE 绑定到 Docker Compose 练习目录；
- 导入后练习环境计数、当前 CVE 详情、“确认练习计划”和 Coding 接力 prompt 都能立刻使用该匹配；
- 撤销本次练习导入会同时清掉对应本地 practice session，避免旧启动计划悬挂；
- 导入路径不联网、不拉镜像、不启动容器、不开放端口、不运行 PoC/exploit/漏洞触发输入，也不会把练习匹配写成真实资产验证。

本次仍未证明：

- Vulhub 官方 catalog 的真实拉取、固定 revision 扫描和许可证/供应链审查；
- Docker Compose 启动器、停止/清理器或端口 broker；
- 打包 App 中用户真实粘贴大型 catalog 后的性能和交互验收。

## 2026-08-04 · Coding recent activity routing

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交（见 Git log） |
| 窄测 | `npm --prefix app test -- workspaceSessionRouting.test.ts codingConversationGroups.test.ts AppSidebar.test.ts ChatPageRoutingContract.test.ts` |
| 窄测结果 | 4 files / 12 tests passed |

覆盖范围：

- Coding 会话列表和项目分组不再只按创建时间排序，而是优先按最后一条消息的 `timestamp`
  判断最近活动；
- 从 CTF/CVE 返回 Coding 时，如果没有明确 remembered Coding 会话，回退选择也按最近活动
  Coding 会话，而不是依赖存储数组里的第一个非 CTF 对话；
- CTF 会话仍被排除在 Coding 恢复与 Coding 历史分组外，避免解题 Agent 对话抢占 Coding 入口。

本次仍未证明：

- 打包 App 中真实点击 CTF → CVE → Coding 后的视觉验收；
- 用户所说“最顶部/最底部”是否还包含聊天滚动位置问题；当前代码已有 conversation id 和
  message count 的滚到底部 watcher，如复现仍存在，应作为新的 UI bug 登记。

## 2026-08-04 · M3 engineering release check

| 项目 | 记录 |
| --- | --- |
| Commit | `c625642` |
| 命令 | `npm run m3:release-check` |
| 结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU'` |

覆盖范围：

- Go 全量测试；
- Go vet；
- Node policy / bridge / runtime 契约测试；
- 前端 Vitest；
- 前端 lint；
- 前端 production build；
- Sidecar smoke；
- deterministic Coding delivery fixture；
- docs build；
- Wails production build；
- macOS self-sign 和 `codesign --verify --deep --strict`。

本次只证明工程 release check 和本机打包 App 产物成立。它不能外推为：

- 完整 “MilkSU develops MilkSU” 自举成绩；
- 六赛道 CTF 真实 Judge 成绩；
- NYU Outcome Bench；
- 外部 Beta / Developer ID / notarization / updater RC；
- Computer Use 外部 App 真实操作验收。

下一步用户可验收动作：

1. 打开 `/Users/milksu/code/milksu/build/bin/MilkSU.app`；
2. 检查 CTF / CVE / Coding 顶部标题和同类控件视觉是否一致；
3. 在 CVE 中建立一个研究任务，确认“当前研究焦点”和“下一步给 Agent 的明确任务”可读；
4. 选择/保留当前 Coding workspace，把 CVE 任务交给 Coding，确认跳转后的 Coding 会话标题、
   可见消息和授权 workspace 符合预期；
5. 若要验收 Computer Use，先在 macOS 中单独确认 Accessibility 与 Screen Recording，再用
   Browser/App 面板选择外部可见窗口。

## 2026-08-04 · CVE → Coding handoff contract

| 项目 | 记录 |
| --- | --- |
| Commit | `9ebdde1` |
| 窄测 | `npm run test -- --run src/lib/vulnerabilityCodingHandoff.test.ts src/components-vue/VulnPage.test.ts src/components-vue/VulnerabilityLoopPanel.test.ts` |
| 窄测结果 | 3 files / 15 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 45 files / 191 tests passed；production build passed |

覆盖范围：

- CVE 研究任务可以规划为 Coding 会话；
- 接力时保留当前授权 workspace；
- 会话标题使用 CVE 研究接力标题；
- 用户可见消息使用短 `visibleText`，不把完整 prompt 直接塞进聊天可见正文；
- Agent 仍收到完整 prompt，包括情报、资产、练习环境、安全边界和后续步骤。

本次仍未证明：

- 打包 App 中点击“交给 Coding”的真实交互；
- Agent 实际完成 CVE 影响检查；
- Docker/Vulhub 环境启动；
- 外部目标扫描或红队能力。上述能力也不在当前冲刺完成条件内。

## 2026-08-04 · CVE handoff completion semantics and latest App build

| 项目 | 记录 |
| --- | --- |
| Commit | `55fd04f` |
| 窄测 | `npm run test -- --run src/components-vue/VulnPage.test.ts src/lib/vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 2 files / 13 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 45 files / 193 tests passed；production build passed |
| 完整门禁 | `npm run m3:release-check` |
| 完整门禁结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU'` |

覆盖范围：

- CVE 页面点击“交给 Coding”后，不会在父级完成 Coding transition 前提前显示“最近 Coding 接力”；
- 父级完成 Coding 会话创建、workspace 继承、切换到 Coding 和消息发送后，再回调 CVE 页面记录
  handoff；
- 记录中的 workspace 来自父级完成后的当前 Coding workspace；
- 最新 HEAD 仍能通过 M3 工程门禁并重新生成本机可打开 App。

本次仍未证明：

- 用户在打包 App 里真实点击“交给 Coding”的视觉/交互验收；
- Agent 对 CVE 任务的实际研究质量；
- Computer Use 对外部 App 的真实可见操作。

## 2026-08-04 · Shared module topbar visual contract

| 项目 | 记录 |
| --- | --- |
| Commit | `d4df0f8` + 2026-08-04 follow-up topbar module contract |
| 窄测 | `npm run test -- --run src/components-vue/WorkspaceTopBar.test.ts src/components-vue/CTFWorkspaceHeader.test.ts src/components-vue/VulnPage.test.ts` |
| 窄测结果 | 3 files / 15 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 214 tests passed；production build passed |
| Browser 验证 | Vite dev preview `http://127.0.0.1:4178/`；依次进入 CTF / CVE / Coding |

覆盖范围：

- CTF、CVE、Coding 顶部标题都使用共享 `WorkspaceTopBar`；
- CTF 题库、CTF 解题会话、CVE 和 Coding 都显式写入 `module="ctf" / "cve" / "coding"`
  契约，DOM 暴露 `data-workspace-module`，避免后续页面换回私有标题栏；
- 三个一级菜单的 `data-workspace-topbar-title` computed font-size 均为 `14px`，line-height 均为
  `20px`；
- CTF / CVE / Coding 顶栏的主要按钮、筛选 Select、搜索 Input 均落在 `sm` 或 `icon-sm`
  尺寸，并由 shared TopBar CSS 统一到 `14px / 20px`；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn。

本次仍未证明：

- 三个模块所有深层表单、表格、详情卡片的完整视觉统一；
- 打包 Wails App 内的多窗口、多尺寸视觉回归；
- 小窗口和移动宽度下的完整响应式验收。

## 2026-08-04 · CVE handoff rejected-state semantics

| 项目 | 记录 |
| --- | --- |
| Commit | `42c392d` |
| 窄测 | `npm run test -- --run src/lib/vulnerabilityCodingHandoff.test.ts src/components-vue/VulnPage.test.ts src/components-vue/VulnerabilityLoopPanel.test.ts` |
| 窄测结果 | 3 files / 19 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 45 files / 196 tests passed；production build passed |

覆盖范围：

- `conversations.send()` 现在在 Agent 消息启动成功时返回 `true`，空输入或启动失败时返回 `false`；
- CVE → Coding handoff helper 把 `send=false` 或 `send` 抛错视为未接受；
- App 只有在 handoff 被接受后才回调 CVE 页面记录“最近 Coding 接力”；
- 失败时仍由 Coding 会话显示 `Agent 未启动：...`，但 CVE 页面不会把失败误记为“已交接”。

本次仍未证明：

- 打包 App 中真实模拟 Sidecar/Agent 启动失败后的 UI 视觉；
- CVE 任务交给 Coding 后 Agent 实际研究质量；
- Docker/Vulhub 练习启动链路。

## 2026-08-04 · Computer Use quick connection path

| 项目 | 记录 |
| --- | --- |
| Commit | `1698e39` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts src/components-vue/CodingComputerUsePanel.test.ts` |
| 窄测结果 | 2 files / 20 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 45 files / 197 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4173/`；进入 Coding，点击 Computer Use 快速接入 |

覆盖范围：

- Coding 产品闭环卡在 Computer Use 未检测、不可用、待授权或待启动时显示“Computer Use 快速接入”；
- 快速接入按钮会打开右侧“浏览器与 App”面板；
- “浏览器与 App”面板内可见 Computer Use 接入清单和“启动可见会话”；
- Browser preview 页面加载为 `MilkSU`，点击快速接入后无 relevant console error / warn。

本次仍未证明：

- macOS 打包 App 中真实弹出系统辅助功能/屏幕录制授权；
- Computer Use driver 对外部 App 的真实观察、点击或输入；
- “替我审批”下无意义审批的端到端消除。

## 2026-08-04 · CTF / CVE top-level workspace retention contract

| 项目 | 记录 |
| --- | --- |
| Commit | `eefa729` |
| 窄测 | `npm run test -- --run src/AppRoutingContract.test.ts src/lib/workspaceSessionRouting.test.ts src/components-vue/AppSidebar.test.ts` |
| 窄测结果 | 3 files / 8 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 199 tests passed；production build passed |

覆盖范围：

- App 顶层路由明确使用 `KeepAlive include="CTFPage,VulnPage"`；
- CTF 和 CVE 主工作区在一级菜单切换时保留页面状态，Coding Chat 不被这个 KeepAlive 误缓存；
- CTF Agent 聊天仍归属 CTF 侧栏 section；
- 返回 CTF 时通过 `ctfResumeJobId` 恢复最近 CTF job，而不是用当前 Coding conversation 覆盖。

本次仍未证明：

- 打包 App 中真实点击 CTF → CVE → CTF 后的视觉回归；
- 一个长时间运行的 CTF Agent 在跨模块切换后的完整恢复；
- CTF 题库滚动位置、筛选条件和所有子面板状态均永久保存。

## 2026-08-04 · Product-loop recovery point action

| 项目 | 记录 |
| --- | --- |
| Commit | `d23f7ff` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts src/components-vue/ChatPage.test.ts` |
| 窄测结果 | 1 file / 14 tests passed；当前没有独立 `ChatPage.test.ts` 文件，命令实际覆盖 CodingProductLoopPanel |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 199 tests passed；production build passed |

覆盖范围：

- Coding 产品闭环卡在已经有可见验证证据、下一步轮到恢复/继续时显示“生成恢复点”；
- “生成恢复点”复用现有 `compactContext`，由 ChatPage 透传到会话层；
- running 或 compacting 时按钮禁用，避免重复触发整理。

本次仍未证明：

- 打包 App 中真实完成一次 context compaction；
- compaction 后实际继续一次并证明不会重复已完成步骤；
- App 重启后的长任务恢复。

## 2026-08-04 · Latest product-loop M3 release check

| 项目 | 记录 |
| --- | --- |
| Checked commit | `18b50f0` |
| 命令 | `npm run m3:release-check` |
| 结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU'` |

覆盖范围：

- Go 全量测试；
- Go vet；
- Node policy / bridge / runtime 契约测试；
- 前端 Vitest；
- 前端 lint；
- 前端 production build；
- Sidecar smoke；
- deterministic Coding delivery fixture；
- docs build；
- Wails production build；
- macOS self-sign 和 `codesign --verify --deep --strict`。

本次只证明 `18b50f0` 的工程 release check 和本机打包 App 产物成立。它不能外推为：

- 完整 “MilkSU develops MilkSU” 自举成绩；
- 六赛道 CTF 真实 Judge 成绩；
- NYU Outcome Bench；
- 外部 Beta / Developer ID / notarization / updater RC；
- Computer Use 外部 App 真实操作验收；
- CVE 研究任务的真实情报质量或练习环境可用性。

## 2026-08-04 · CVE list loop status visibility

| 项目 | 记录 |
| --- | --- |
| Commit | `b15782f` |
| 窄测 | `npm run test -- --run src/components-vue/VulnPage.test.ts src/components-vue/VulnerabilityLoopPanel.test.ts src/lib/vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 3 files / 19 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 199 tests passed；production build passed |

覆盖范围：

- CVE 列表新增“闭环”列；
- 每条 CVE 直接展示现有本地状态投影：`待建立`、`有练习`、`研究任务`、`练习已确认`、
  `练习已停止`、`已接力`、`有笔记`；
- 状态来源复用现有 research task、practice session、Coding handoff 和用户笔记，不新增独立
  状态机；
- 自动化覆盖初始列表可见状态、建立研究任务后的状态、确认练习计划后的状态，以及 Coding
  接力成功后列表/详情里的 `已接力`。

本次仍未证明：

- 打包 App 中用户真实从列表扫状态、点击详情、交给 Coding 的完整交互；
- CVE 情报源实时同步；
- Vulhub catalog import、Docker 拉起、停止和清理；
- Agent 对 CVE 任务的实际研究质量。

## 2026-08-04 · Coding product-loop user acceptance checklist

| 项目 | 记录 |
| --- | --- |
| Commit | `bbcbdc1` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 14 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 199 tests passed；production build passed |

覆盖范围：

- Coding 产品闭环卡新增“用户验收清单”；
- 清单按用户可执行顺序展示：确认任务和仓库、核对自动化输出、做一次用户可见验证、验证
  失败/继续路径、收口 Git 交付、复制接力棒；
- 每项复用现有 workspace、tool message、Artifact/Browser/Computer Use evidence、compaction
  和 Git 状态，不新增独立完成状态；
- 接力棒摘要同步包含“用户验收清单”，方便下一轮 Agent 或用户继续按同一口径验收。

本次仍未证明：

- 打包 App 中用户真实按清单跑完整 “MilkSU develops MilkSU”；
- Computer Use 对外部 App 的真实操作；
- Artifact Preview / Browser / Git 全链路在同一原生会话里完成。

## 2026-08-04 · CVE selected item continuity

| 项目 | 记录 |
| --- | --- |
| Commit | `3a57d98` |
| 窄测 | `npm run test -- --run src/composables/useVulnerabilityDashboard.test.ts src/components-vue/VulnPage.test.ts` |
| 窄测结果 | 2 files / 12 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 201 tests passed；production build passed |

覆盖范围：

- CVE 工作台会记住用户最后选中的 CVE；
- 重新创建 dashboard 实例时恢复上次选中的 CVE，而不是总回到第一条；
- 如果记住的 CVE 已不存在，则回退到当前列表第一条，避免详情区空白或状态漂移；
- 不修改主 CVE 数据 schema，只增加独立 selected-id 本地状态。

本次仍未证明：

- 打包 App 中跨一级菜单切换、关闭窗口、重新打开后的真实视觉连续性；
- 自定义 CVE 记录被删除后的完整 UI 流程；
- CVE 研究任务、练习环境和 Coding 接力的真实质量。

## 2026-08-04 · Coding merge readiness indicator

| 项目 | 记录 |
| --- | --- |
| Commit | `0393f85` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 15 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 202 tests passed；production build passed |

覆盖范围：

- Coding 产品闭环卡顶部新增“合并状态”；
- 状态只由现有用户验收清单投影：有阻塞项显示 `阻塞`，仍缺证明显示 `待补证明`，六项全
  `已具备` 才显示 `合并就绪`；
- `待补证明` 会列出还差哪些项，例如用户可见验证、失败/继续路径、Git 交付；
- 接力棒摘要同步包含合并状态，避免下一轮 Agent 把局部测试通过误读成可合并。

本次仍未证明：

- 打包 App 中真实跑完六项用户验收清单；
- 完整 “MilkSU develops MilkSU” 自举任务；
- PR 合并前人工范围确认、托管平台 PR 和外部 App Computer Use 实操。

## 2026-08-04 · Coding checklist action links

| 项目 | 记录 |
| --- | --- |
| Commit | `c1af6d0` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 16 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 203 tests passed；production build passed |

覆盖范围：

- Coding 产品闭环卡的“用户验收清单”未完成项现在带有直接操作按钮；
- “核对自动化输出”打开终端/测试面板；
- “做一次用户可见验证”按当前证据入口打开产物预览或 Browser/App；
- “验证失败/继续路径”在待补时可直接生成恢复点；
- “收口 Git 交付”打开变更面板；
- 自动化覆盖从 checklist 行内按钮触发 `artifacts`、`changes` 和 `compactContext`。

本次仍未证明：

- 打包 App 中用户真实按 checklist 逐项点击并完成验收；
- 生成恢复点后实际重启/继续；
- Git stage/commit/push 在同一原生会话中由用户验收完成。

## 2026-08-04 · Coding focused follow-up prompt

| 项目 | 记录 |
| --- | --- |
| Commit | `b61749e` |
| 窄测 | `npm run test -- --run src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 17 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 204 tests passed；production build passed |

覆盖范围：

- Coding 产品闭环卡新增“复制待补任务”；
- 复制内容只包含未完成验收项、当前工作区、权限口径、合并状态和下一步建议；
- 已具备项不会进入待补任务，避免后续 Agent 重做已经完成的仓库确认或自动化输出核对；
- prompt 明确保留硬边界：不读取/迁移 Provider/API Key，不把 smoke/UI 架子写成完整成绩，
  真实 App、Computer Use、Browser、Git 和恢复证据要分开记录。

本次仍未证明：

- 新 prompt 被真实下一轮 MilkSU Agent 执行；
- 下一轮 Agent 能按 prompt 完成剩余验收；
- 原生 App 中复制到剪贴板的真实交互。

## 2026-08-04 · CVE focused follow-up prompt

| 项目 | 记录 |
| --- | --- |
| Commit | `498a515` |
| 窄测 | `npm run test -- --run src/components-vue/VulnerabilityLoopPanel.test.ts src/components-vue/VulnPage.test.ts src/lib/vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 3 files / 20 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 46 files / 205 tests passed；production build passed |

覆盖范围：

- CVE 最小闭环面板新增“复制待补任务”；
- prompt 只包含未完成 loop items、当前 CVE、授权项目状态、下一步建议和安全边界；
- 已完成项不会进入待补任务，例如已具备的情报快照和已完成的 Coding 接力；
- prompt 明确 CVE 模块只做学习/追踪、公告/补丁阅读、授权仓库只读影响检查和本地隔离练习计划；
  不自动拉镜像、启动容器、运行 PoC/exploit、访问外部目标或把练习结果写成真实资产已验证。

本次仍未证明：

- 新 prompt 被真实下一轮 MilkSU Agent 执行；
- CVE 情报质量、Vulhub catalog import 或 Docker 练习启动；
- 原生 App 中复制到剪贴板的真实交互。

## 2026-08-04 · Latest focused-prompt M3 release check

| 项目 | 记录 |
| --- | --- |
| Checked commit | `86ee5d9` |
| 命令 | `npm run m3:release-check` |
| 结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU'` |

覆盖范围：

- Go 全量测试；
- Node policy / bridge / runtime 契约测试，162 项通过；
- 前端 Vitest，46 files / 205 tests passed；
- 前端 lint；
- 前端 production build；
- Sidecar smoke；
- deterministic Coding delivery fixture，`score=100` 且 `passed=true`；
- docs build；
- Wails production build；
- macOS self-sign 和 App 打包。

本次只证明 `86ee5d9` 的工程 release check 和本机打包 App 产物成立。它不能外推为：

- 完整 “MilkSU develops MilkSU” 自举成绩；
- 用户在原生 App 中真实按 Coding 验收清单逐项完成；
- 外部 App Computer Use 实操；
- CVE 情报源实时同步、Vulhub catalog import 或 Docker 练习启动；
- 托管平台 PR、Developer ID、公证、升级或 RC 发布门禁。

## 2026-08-04 · CTF catalog escape hatch

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 窄测 | `npm run test -- --run src/components-vue/CTFPageNavigationContract.test.ts src/components-vue/CTFWorkspaceHeader.test.ts src/components-vue/WorkspaceTopBar.test.ts src/AppRoutingContract.test.ts` |
| 窄测结果 | 4 files / 11 tests passed |
| CVE 相关回归 | `npm run test -- --run src/components-vue/VulnPage.test.ts src/components-vue/VulnerabilityLoopPanel.test.ts src/composables/useVulnerabilityDashboard.test.ts src/lib/vulnerabilityCodingHandoff.test.ts` |
| CVE 相关结果 | 4 files / 24 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 207 tests passed；production build passed |
| 完整 M3 gate | `npm run m3:release-check` |
| 完整 M3 gate 结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |

覆盖范围：

- CTF 解题工作区顶部“返回题库”、正文“题库”、预算停止提示“返回题库”和空工作区“选择一道题”
  统一走强返回路径；
- 强返回会清理 NSSCTF 选中题、CTFshow 选中题、系列选择、本地附件错误和结果提示；
- CTFshow 当前题库会刷新，NSSCTF 公开题库会重新加载第一页；
- 契约测试锁定 CTF workspace header 仍使用共享 `WorkspaceTopBar`，同时返回动作不再退回半截题目详情。

本次仍未证明：

- 打包 App 中用户真实从 CTF 题目工作区切到 CVE、再切回 CTF 的肉眼验收；
- 模块级 rail 最终语义是否需要同时提供“回题库 / 回最近 Agent 对话 / 回当前工作区”三种入口；
- 六赛道真实 Judge 或新的 CTF 题目验收。

## 2026-08-04 · Computer Use ready-state wording

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 窄测 | `npm run test -- --run src/components-vue/CodingComputerUsePanel.test.ts src/lib/codingPolicy.test.ts src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 3 files / 34 tests passed |
| 前端构建 | `npm run build` |
| 前端构建结果 | production build passed |

覆盖范围：

- Browser/App 面板中的 Computer Use 状态从单一“未接入”细分为不可用、缺系统权限、待选择窗口、
  可启动、已接入当前任务、其他任务正在使用；
- 当辅助功能和屏幕录制已授权且已选中可见窗口时，状态显示为“可启动”，但不会把它标成“已接入”；
- 右侧能力列表在已经检测到 Computer Use 状态时使用同一口径：缺权限提示 macOS 辅助功能和屏幕录制，
  有窗口但未启动时显示需要进入 Browser/App 面板点击“启动可见会话”；
- 修复 `status` 存在但 `target` 为空时模板访问 `status.target.name` 导致渲染崩溃的问题；
- 仍保留硬边界：启动前不会操作可见 App；Plan/只读下即使检测到窗口也显示不会操作。

本次仍未证明：

- 打包 App 中真实选择外部 App 窗口、启动 Computer Use、点击/输入并留下截图或可见操作证据；
- macOS Accessibility / Screen Recording 系统设置在不同机器上的真实授权路径；
- 其他任务占用时的原生 App 释放/切换体验。

## 2026-08-04 · Browser preview Computer Use fallback

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 发现方式 | Browser 插件渲染检查 `http://127.0.0.1:1421/` |
| 目标流 | app loads → Coding → Browser / Computer Use → Computer Use fallback renders |
| 窄测 | `npm run test -- --run src/desktop.test.ts src/components-vue/CodingComputerUsePanel.test.ts src/lib/codingPolicy.test.ts` |
| 窄测结果 | 3 files / 27 tests passed |
| 前端构建 | `npm run build` |
| 前端构建结果 | production build passed |
| Browser 检查 | page identity `MilkSU`；非空；无 Vite overlay；console warn/error 为空；截图已采集；点击 `Coding` 和 `Browser / Computer Use` 后状态可见 |

覆盖范围：

- browser-preview adapter 现在支持 `get_coding_computer_use_status`、`request_coding_computer_use_permissions`
  和 `list_coding_computer_use_targets` 的友好 fallback；
- 普通浏览器预览中不再裸露 `Unsupported browser-preview command: get_coding_computer_use_status`；
- 预览中明确显示 `Computer Use 需要 MilkSU 桌面运行时；浏览器预览只能验证 UI 文案和入口。`；
- `start_coding_computer_use` / `stop_coding_computer_use` 在浏览器预览中仍失败关闭，并给出需要桌面运行时的中文错误；
- `CodingComputerUseStatus.target` 改为可空，匹配不可用、缺权限、未选窗口等真实状态。

额外观察：

- 已存在的 `http://127.0.0.1:1420/` dev server 在本轮 Browser 初查时仍显示旧 Vite overlay，
  但当前源码的 `npm run build` 通过；使用干净 `http://127.0.0.1:1421/` 复验无 overlay。
  这更像本机旧 dev server/HMR 状态，不记为产品代码缺陷。

本次仍未证明：

- 打包 App 中真实 Computer Use 外部窗口操作；
- Browser preview 能替代 Wails runtime；预览只用于 UI 文案和入口检查；
- 1420 端口旧 dev server 的生命周期管理。

## 2026-08-04 · CVE selected next-action summary

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 选择或更新当前 CVE → 顶部直接显示下一步 |
| 窄测 | `npm run test -- --run src/composables/useVulnerabilityDashboard.test.ts src/components-vue/VulnPage.test.ts src/components-vue/VulnerabilityLoopPanel.test.ts` |
| 窄测结果 | 3 files / 18 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 211 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4175/`；进入 CVE，选择 `CVE-2023-46604`，执行“建立研究任务” |

覆盖范围：

- CVE 顶部 metrics 新增“当前下一步”卡片；
- 下一步不是固定文案，而是按当前选中 CVE 的本地闭环证据推导；
- 状态递进覆盖：建立研究任务 → 确认练习计划 → 交给 Coding → 补用户笔记 → 复制证据摘要；
- 初始 CVE 页面无需点开右侧所有区块，也能看到当前 CVE 卡在哪里；
- Browser preview 中初始状态显示 `建立研究任务`，ActiveMQ 建立研究任务后推进到 `确认练习计划`；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn，无 Vite overlay；
- 不新增 schema，不接外部 Feed，不启动 Docker，不运行 PoC/exploit。

本次仍未证明：

- CVE 情报源实时同步；
- Vulhub catalog import 或 Docker 练习启动；
- Coding Agent 对 CVE 任务的实际研究质量；
- 打包 App 中用户真实点击完整 CVE → Coding → 回 CVE 的视觉验收。

## 2026-08-04 · Artifact preview browser-preview boundary

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 产物预览 → 浏览器预览环境下说明真实读取边界 |
| 窄测 | `npm run test -- --run src/components-vue/CodingArtifactPreviewPanel.test.ts src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 21 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 212 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4176/`；进入 Coding，点击 `产物预览` |

覆盖范围：

- Artifact Preview 面板在没有 MilkSU 桌面运行时时显示明确提示；
- 浏览器预览中点击 Markdown/HTML/图片候选不会伪造产物内容，也不会调用工作区读取命令；
- 文案区分“浏览器预览只能验证面板文案和入口”与“打包 App 才能验收真实工作区产物”；
- Browser preview 中 Coding → 产物预览 显示桌面运行时边界提示；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn，无 Vite overlay；
- 保留桌面运行时下 Markdown、HTML sandbox 和图片预览的原有测试覆盖。

本次仍未证明：

- 打包 App 中真实读取 Markdown、HTML 和图片产物；
- 原生 WebView 中 HTML sandbox/CSP 的负向验收；
- Browser preview 能替代桌面运行时读取工作区文件。

## 2026-08-04 · Git delivery browser-preview boundary

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → Git 交付 → 浏览器预览环境下说明真实 Git 边界 |
| 窄测 | `npm run test -- --run src/components-vue/CodingChangesPanel.test.ts src/components-vue/CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 26 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 214 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4177/`；进入 Coding，点击 `Git 交付` |

覆盖范围：

- Git 交付面板在没有 MilkSU 桌面运行时时显示明确提示；
- 浏览器预览中不再把“不能读取 Git 状态”误呈现成普通“当前目录不是 Git 仓库”；
- 文案区分“浏览器预览只能验证面板文案和入口”与“打包 App 才能验收真实 Diff/Hunk、stage、commit、push 和 PR 发布确认”；
- 桌面运行时但非 Git 仓库时仍显示真实目录问题，不混同为浏览器预览限制；
- Browser preview 中 Coding → Git 交付 显示桌面运行时边界提示；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn，无 Vite overlay；
- 保留 PR 一次性确认、私有 MilkSU 仓库限制和 Git 交付摘要的原有测试覆盖。

本次仍未证明：

- 打包 App 中真实 Diff/Hunk、stage、commit 和 push；
- 真实托管平台 Draft PR 发布；
- 浏览器预览能替代桌面运行时读取 Git 状态。

## 2026-08-04 · Terminal and background-task browser-preview boundary

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 终端/测试 → 浏览器预览环境下说明真实 Shell/后台任务边界 |
| 窄测 | `npm run test -- --run src/components-vue/CodingTerminalPanel.test.ts` |
| 窄测结果 | 1 file / 3 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 215 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4179/`；进入 Coding，点击 `终端/测试`，再切换 `后台任务` |

覆盖范围：

- 终端/测试面板在没有 MilkSU 桌面运行时时显示明确提示；
- 浏览器预览中不刷新后台任务、不启动后台命令、不把空列表误呈现为真实 runtime 状态；
- Shell 视图说明交互式 Shell 只会在 MilkSU 桌面应用中启动；
- 后台任务视图说明真实命令、端口、日志和跨应用重启恢复必须在打包 App 中验收；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn，无 Vite overlay；
- 保留桌面运行时下恢复后的后台任务状态、PID、端口、日志 tail 和 Credential 脱敏测试覆盖。

本次仍未证明：

- 打包 App 中真实启动 Shell；
- 打包 App 中真实后台任务、端口、日志和跨 App 重启恢复；
- 真实长任务超时/取消后的完整用户验收。

## 2026-08-04 · CVE isolated practice launch-plan checklist

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → ActiveMQ CVE → 建立研究任务 → 确认练习计划 → 查看/复制启动前清单 |
| 窄测 | `npm run test -- --run src/components-vue/VulnerabilityLoopPanel.test.ts src/components-vue/VulnPage.test.ts src/composables/useVulnerabilityDashboard.test.ts src/lib/vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 4 files / 26 tests passed |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 47 files / 216 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4180/`；进入 CVE，选择 `CVE-2023-46604`，连续执行“建立研究任务”和“确认练习计划” |

覆盖范围：

- CVE 最小闭环面板新增“本地练习启动前清单”；
- 清单结构化展示来源/固定 revision、目录、端口、资源、网络边界、清理方式和当前状态；
- “确认练习计划”后下一步会推进到“交给 Coding”，不再停在静态练习卡片；
- 用户可以复制“启动前计划”，交给后续 Coding Agent 做只读 Docker/Compose 启动前检查；
- 复制内容明确禁止自动拉取镜像、启动容器、开放端口、运行 PoC/exploit、发送漏洞触发输入或访问外部目标；
- Browser preview 页面加载为 `MilkSU`，无 relevant console error / warn，无 Vite overlay；
- 不新增 schema，不接外部 Feed，不启动 Docker，不运行 PoC/exploit。

本次仍未证明：

- Vulhub catalog import；
- Docker/Compose 真实启动、停止、清理；
- Agent 在本地隔离练习 Scope 内的真实观察、日志阅读和复盘质量；
- 打包 App 中用户真实完成 CVE → Coding → 回 CVE 的完整视觉验收。

## 2026-08-04 · Native App acceptance handoff card

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 产品闭环 → 打包 MilkSU App 验收接力 |
| 窄测 | `npm --prefix app test -- CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 18 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4181/`；进入 Coding，检查产品闭环面板 |

覆盖范围：

- Coding 产品闭环面板新增“打包 MilkSU App 验收”接力卡；
- 卡片明确区分 Browser preview、组件测试、smoke 与真实原生 App 验收；
- 清单覆盖最新 `build/bin/MilkSU.app`、Coding/CTF/CVE 顶部一致性、CTF/CVE 二层侧栏隐藏、Go + 替我审批/完全访问、小任务执行、测试/build、产物预览、Git Diff/Hunk/stage/commit/push、Browser/Computer Use 证据、跨模块继续和未修问题登记；
- 用户可以复制“原生 App 产品闭环验收”prompt 交给下一轮 Agent 或用户手动验收；
- 接力棒摘要会包含原生 App 验收接力，避免后续把 Vite preview 当作合并前原生验收；
- Browser preview 页面加载为 `MilkSU`，点击 `Coding` 后 DOM 中可见该卡片和复制入口，无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- 最新打包 App 中用户真实点击并复制该清单；
- 原生 App 中完成一条完整 MilkSU develops MilkSU 小任务；
- 外部 App Computer Use 真实窗口操作；
- Git stage/commit/push 在同一原生 App 会话中完成。

## 2026-08-04 · Recoverable interruption and context-limit detection

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding/CTF Agent failure → detect recoverable stop → show continue path |
| 窄测 | `npm --prefix app test -- agentRecovery.test.ts useConversations.test.ts` |
| 窄测结果 | 2 files / 14 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |

覆盖范围：

- `recoverableAgentFailureId()` 继续保留无活动、网络、Sidecar/protocol 停止识别；
- 新增用户中断/取消、`aborted`、`context canceled`、`operation was canceled` 等可恢复停止识别；
- 新增上下文窗口过长、`context_length_exceeded`、`maximum context length exceeded`、`token limit exceeded` 等可恢复停止识别；
- 如果用户在失败后又发了新要求，不会把旧失败继续按钮误绑定到新任务；
- Coding 恢复 prompt 明确说明超时、取消或上下文过长后应先压缩/概括已完成事实，再选择最小可验证下一步；
- 不改变 API Key / 模型不支持等配置错误的不可恢复口径。

本次仍未证明：

- 原生 App 中真实触发一次用户中断后继续；
- 原生 App 中真实触发上下文过长后继续；
- 继续后的 Agent 不重复已完成步骤的完整人工验收。

## 2026-08-04 · CVE Vulhub catalog match visibility

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 情报源状态 → Vulhub 练习目录匹配 → 选择 ActiveMQ |
| 外部只读核对 | `git ls-remote https://github.com/vulhub/vulhub.git HEAD` → `aeaf65793f147f29bd50841ef77f4e9cad07ecc7`；GitHub tree 只读检查当前内置 CVE 中仅 `activemq/CVE-2023-46604` 匹配 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts VulnerabilityLoopPanel.test.ts useVulnerabilityDashboard.test.ts` |
| 窄测结果 | 3 files / 20 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4182/`；进入 CVE，先看默认 `CVE-2024-3400` 未匹配，再点击 `Apache ActiveMQ OpenWire RCE` |

覆盖范围：

- CVE 页面新增“Vulhub 练习目录匹配”只读状态卡；
- 卡片显示固定快照 `aeaf657` 和完整 revision 证据；
- 默认选中 `CVE-2024-3400` 时明确说明当前快照未匹配目录，可交给 Coding Agent 做只读 catalog import 复核或由用户手动绑定材料；
- 选中 `CVE-2023-46604` 时显示已匹配 `vulhub/activemq/CVE-2023-46604`、目录、固定 revision 和启动前仍需确认 Docker/端口/网络/清理；
- 页面文案继续明确：只做只读匹配和启动前计划；拉取镜像、启动容器、开放端口或发送漏洞触发输入仍需用户逐次确认；
- Browser preview 页面加载为 `MilkSU`，点击 `CVE` 和 ActiveMQ 行后无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- 完整 Vulhub catalog import；
- Docker/Compose 真实启动、停止和清理；
- Agent 在本地隔离练习 Scope 内的观察、日志阅读和复盘；
- 任一练习结果可代表真实资产验证。

## 2026-08-04 · CVE handoff return path in Coding

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 建立研究任务 → 交给 Coding → Coding 顶栏显示 CVE 接力 → 返回 CVE |
| 窄测 | `npm --prefix app test -- chatTopbar.test.ts AppRoutingContract.test.ts ChatPageRoutingContract.test.ts vulnerabilityCodingHandoff.test.ts` |
| 窄测结果 | 4 files / 15 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4184/`；进入 CVE，执行“建立研究任务”和“交给 Coding”，再点“返回 CVE” |

覆盖范围：

- CVE handoff 成功创建/切到 Coding 对话后，App 记住当前 Coding conversation 来源于 CVE 工作台；
- Coding 顶栏仍使用 `Coding` 模块标题，但显示 `CVE 接力` badge 和 subtitle 来源上下文；
- Coding 顶栏新增“返回 CVE”按钮，回到 KeepAlive 中的 CVE 工作台；
- Browser preview 中即使 Wails Agent runtime 不可用、消息发送失败，已创建的 CVE 接力 Coding 对话仍显示来源与返回入口；
- 未把失败的 Browser preview handoff 记录成“已交接”，避免把 Agent 未启动误写成成功；
- 顺手锁住 ChatPage raw contract，避免后续把 CVE handoff 当普通 Coding 对话吞掉。

本次仍未证明：

- 原生 App 中真实 Agent 启动成功后的 CVE → Coding → CVE 完整交互；
- Coding Agent 完成 CVE 只读研究任务后把结论写回 CVE 笔记；
- 跨 App 重启后 CVE 接力来源标记仍保留。

## 2026-08-04 · Shared module topbar title contract

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | 进入 CTF / CVE / Coding 一级菜单 → 最上方模块标题使用同一组件和同一字号 |
| 窄测 | `npm --prefix app test -- WorkspaceTopBar.test.ts ChatPageRoutingContract.test.ts chatTopbar.test.ts AppRoutingContract.test.ts VulnPage.test.ts` |
| 窄测结果 | 5 files / 20 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4185/`；依次进入 CTF、CVE、Coding 并读取 `[data-workspace-topbar-title]` 渲染样式 |

覆盖范围：

- 顶栏模块标题抽为 `WorkspaceTopBarTitle.vue`，由 `WorkspaceTopBar.vue` 统一调用；
- CTF、CVE、Coding 顶栏继续只通过 `WorkspaceTopBar` 输出一级模块标题；
- Browser preview 读取到三页标题均为 `H1`、`workspace-topbar__title`，渲染字号均为 `14px`、行高 `20px`、字重 `450`；
- 顶栏 action 区同样继承 `WorkspaceTopBar` 的 `text-control` 控制字号，三页均为 `14px`；
- Browser preview 无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- 页面内部二级标题、统计数字、卡片按钮和下拉菜单已经完成全局视觉系统收敛；
- 打包原生 App 在不同窗口尺寸下的顶栏截屏回归；
- CTF 解题态、CVE 详情态和 Coding 右侧栏所有子组件的细节字号完全一致。

## 2026-08-04 · Compact form control visual contract

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CTF / CVE 主工作区里的同类搜索框、下拉和表单输入保持相同 compact 规格 |
| 窄测 | `npm --prefix app test -- globalStyleContract.test.ts WorkspaceTopBar.test.ts CTFEndpointAuthorization.test.ts VulnPage.test.ts CTFPageNavigationContract.test.ts` |
| 窄测结果 | 5 files / 20 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4186/`；进入 CVE，打开“新增追踪”，读取 Select/Input 的实际 computed style |

覆盖范围：

- `Input[data-size="sm"]`、`NativeSelect[data-size="sm"]` 和 `SelectTrigger[data-size="sm"]` 统一到同一 compact 字号与行高；
- CTF 顶部题库切换、CTFshow 搜索/题型筛选、手动题目导入的题型/入口 Select、Endpoint 协议/地址控件显式使用 `size="sm"`；
- CVE 新增追踪表单和资产表单的 Input 显式使用 `size="sm"`；
- Browser preview 复验 CVE 表单 Select 与 Input 均为 `14px` 字号、`20px` 行高、`32px` 高度；
- Browser preview 无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- Settings、Lab 计划页和所有深层详情卡片已经完成同一视觉规格；
- `Textarea`、Tabs、表格行高、统计卡和卡片按钮已经全局收敛；
- 原生 App 中不同窗口尺寸下的完整视觉 QA。

## 2026-08-04 · Latest HEAD M3 release check after UI sprint

| 项目 | 记录 |
| --- | --- |
| Commit | `02cd736` + 本批次门禁契约修正 |
| 命令 | `npm run m3:release-check` |
| 首次结果 | 失败于 `TestSelectControlsDoNotVerticallyClipTheirLabels`，原因是 Go 契约仍期待旧 `text-body` 行高，和本轮 compact 控件统一到 `text-control` 的新规格不一致 |
| 修正 | 更新 Go 侧样式契约，要求 `Input`、`NativeSelect`、`SelectTrigger` 的 compact 控件共享 `text-control` 行高 |
| 重跑结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU' in 22.135s.` |

覆盖范围：

- Go 全量测试；
- Node policy / bridge / runtime 契约测试：162 pass；
- 前端 Vitest：49 files / 223 tests passed；
- 前端 lint；
- 前端 production build；
- Sidecar packaged smoke；
- deterministic Coding delivery fixture，输出 `milksu-coding-delivery/v1alpha1`，score 100，外部 Provider cost 0；
- docs build；
- Wails production build；
- macOS self-sign；
- 最新 HEAD 的本地 `MilkSU.app` 重新生成。

本次仍未证明：

- 用户在原生 App 中真实点击完成 CTF / CVE / Coding 跨模块验收；
- 完整 “MilkSU develops MilkSU” Vue + Go 自举任务；
- 外部 App Computer Use 真实操作；
- Developer ID、公证、升级和外部 Beta 发行门禁。

## 2026-08-04 · CTF visible six-track smoke and shared topbar recheck

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | 进入 CTF / CVE / Coding 一级菜单 → 顶栏标题使用同一组件；进入 CTF 默认桌面 → 六赛道 Judge 状态可见且不夸大成绩 |
| 窄测 | `npm --prefix app test -- CTFPageNavigationContract.test.ts WorkspaceTopBar.test.ts chatTopbar.test.ts` |
| 窄测结果 | 3 files / 11 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4188/`；依次进入 CTF、CVE、Coding，读取 `[data-workspace-topbar-title]`；回到 CTF 读取 `aria-label="CTF 六赛道真实验收"` |

覆盖范围：

- CTF 默认题库桌面现在直接显示六赛道真实验收状态，而不是只藏在左侧能力 rail 或未渲染的 source 分支；
- CTF 六赛道卡明确显示 `0/6 Judge`、缺失赛道和“一题成功只算赛道 smoke，不能描述为完整 CTF 成绩”；
- CTF、CVE、Coding 三个一级菜单的顶栏标题都来自 `WorkspaceTopBarTitle`，DOM 均为 `[data-workspace-topbar-title]`，class 均为 `workspace-topbar__title truncate text-control font-medium tracking-[-0.01em]`；
- CVE 接力会话的 topbar module 计算已补成 `ctf / cve / coding` 三态，避免后续按模块样式时把 CVE 来源误归为普通 Coding；
- Browser preview 无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- 六赛道已经完成真实 Judge-verified；当前仍只有 smoke 状态展示；
- 原生 App 中不同窗口尺寸下的顶栏视觉截图回归；
- 页面内部所有二级标题、统计卡、Tabs、Textarea 和深层详情组件已经完全统一。

## 2026-08-04 · Shared CTF/CVE detail title contract

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | 打开 CTF / CVE 详情区 → 同层级详情主标题使用同一组件和同一视觉规格 |
| 窄测 | `npm --prefix app test -- WorkspaceVisualContract.test.ts CTFPageNavigationContract.test.ts VulnPage.test.ts WorkspaceTopBar.test.ts` |
| 窄测结果 | 4 files / 16 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4189/`；进入 CVE 详情，读取 `[data-workspace-detail-title]` |

覆盖范围：

- 新增 `WorkspaceDetailTitle.vue`，统一详情主标题为 `H2 + data-workspace-detail-title + text-2xl`；
- NSSCTF 详情、CTFshow 详情和 CVE 详情均改用同一个组件，避免 CTF/CVE 在同层级标题上出现不同字号；
- Browser preview 中 CVE 详情可见 `PAN-OS GlobalProtect Command Injection`，DOM 为 `H2`，class 包含 `workspace-detail-title mt-3 text-2xl font-semibold tracking-[-0.035em]`；
- Browser preview 无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- Browser preview 中 CTF 详情标题的可见截图；预览题库为空，CTF 详情渲染由源码契约测试覆盖；
- Coding 内部所有子面板标题也已经迁移到同一个详情标题组件；
- 统计卡、Tabs、Textarea、表格行和深层按钮已经完成全局视觉收敛。

## 2026-08-04 · CVE current-next-step action

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 选择 ActiveMQ CVE → 顶部“当前下一步”直接推进研究任务和练习计划 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts VulnerabilityLoopPanel.test.ts ChatPageRoutingContract.test.ts AppSidebar.test.ts` |
| 窄测结果 | 5 files / 24 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4190/`；选择 `CVE-2023-46604`，点击 `执行当前 CVE 下一步` 两次 |

覆盖范围：

- CVE 顶部 metrics 的“当前下一步”不再只是文字状态卡，新增同尺寸 `size="sm"` 动作按钮；
- 选中 `CVE-2023-46604` 后，顶部按钮从 `建立` 推进到 `确认`，再推进到 `交给 Coding`；
- 点击 `建立` 会建立研究任务并定位到研究工作区；点击 `确认` 只确认本地练习启动前计划，不拉镜像、不启动容器、不运行漏洞触发输入；
- Browser preview 最终状态显示 ActiveMQ 行已具备 `研究任务` 与 `练习已确认`，顶部显示 `当前下一步：交给 Coding`；
- 修正 `ChatPageRoutingContract.test.ts` 的旧 topbar module 断言，使契约匹配当前 `ctf / cve / coding` 三态；
- Browser preview 无 relevant console error / warn，无 Vite overlay。

本次仍未证明：

- 原生 App 中真实启动 Agent 并完成 CVE → Coding → CVE 的研究结果回写；
- Vulhub 完整 catalog import、Docker/Compose 启动、停止和清理；
- 任何 CVE 练习结果可代表真实资产已验证。

## 2026-08-04 · Coding self-bootstrap task prompt

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 右侧产品闭环 → 复制一个低风险、用户可见、可交给下一轮 Agent 的小自举任务 |
| 窄测 | `npm --prefix app test -- CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 19 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4191/`；进入 Coding，读取产品闭环卡和 console |

覆盖范围：

- Coding 产品闭环卡新增“推荐小自举任务”，不会自动启动 Agent，而是生成可复制的受限 prompt；
- prompt 固定要求先读 git 状态、`product-loop-sprint.md` 和 `objective-coverage-ledger.md`，避免长上下文压缩后重复旧功能；
- prompt 要求只选一个低风险、用户可见、几小时内能推进闭环的小切片，并把相邻非阻塞问题登记到覆盖台账；
- prompt 固定要求运行相关窄测试、`npm --prefix app run build`、Browser preview 验证、`git diff --check`、commit 和 push；
- prompt 明确继续禁止读取、输出或迁移 Provider/API Key，禁止把 smoke、UI 架子、Browser preview 或组件测试写成完整产品成绩；
- Browser preview 中 Coding 页面非空，`推荐小自举任务`、`复制任务`、`不会自动启动 Agent` 均可见，console 无 relevant error / warn。

本次仍未证明：

- 下一轮 Agent 真的已经使用该 prompt 完成一次完整 MilkSU 自举任务；
- 原生打包 App 中该复制动作的系统剪贴板权限和 UI 反馈；
- 完整 Vue + Go、跨应用重启、PR 发布确认和外部 Computer Use 真实操作。

## 2026-08-04 · CVE local intel snapshot review

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 情报源接入状态 → 刷新本机快照 → 仍清楚区分内置快照、待接入 Feed 和只读导入计划 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts` |
| 窄测结果 | 2 files / 17 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4192/`；进入 CVE，读取情报源区域，点击 `刷新 CVE 本机快照` |

覆盖范围：

- CVE 顶栏刷新按钮改为明确的 `刷新 CVE 本机快照`，不暗示已经接入实时 NVD/KEV/EPSS/OSV Feed；
- 情报源区域显示 `尚未复核` / `本机复核 rev 2`，并明确刷新只更新本机视图状态，不代表外部源已实时同步；
- 新增“下一步可交给 Coding Agent”的只读 Feed 导入计划，约束固定 NVD、CISA KEV、EPSS、OSV、GHSA、Vulhub revision、样本日期、来源哈希和失败原因；
- 计划继续声明不启动 Docker、不访问外部目标、不把情报命中写成验证；
- Browser preview 中 CVE 页面非空，刷新前后关键文案可见，console 无 relevant error / warn。

本次仍未证明：

- 已经接入真实 NVD、CISA KEV、EPSS、OSV、GHSA 或 Vulhub catalog import；
- 真实网络失败、缓存哈希、Feed 日期和导入差异 UI；
- Docker/Compose 练习环境的启动、停止、清理和原生 App 安全确认。

## 2026-08-04 · CTF session return-to-catalog reassurance

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CTF 解题会话 → 顶部返回题库入口 → 用户知道返回题库不会结束当前会话 |
| 窄测 | `npm --prefix app test -- CTFWorkspaceHeader.test.ts AppRoutingContract.test.ts workspaceSessionRouting.test.ts CTFPageNavigationContract.test.ts` |
| 窄测结果 | 4 files / 13 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4193/`；进入默认 CTF 页面，确认页面非空、六赛道 smoke 可见、console 无 relevant error / warn |

覆盖范围：

- CTF 解题会话顶部 subtitle 从 `解题会话` 改为 `解题会话 · 返回题库不会结束当前会话`；
- `CTFWorkspaceHeader.test.ts` 覆盖会话 header 渲染返回题库入口、题目 badge、打开题目、授权与模型，并显示“不结束当前会话”的说明；
- 路由契约测试继续覆盖 CTF/CVE 被 `KeepAlive` 保留、Coding chat 不被缓存、CTF resume point 和最近 Coding 会话回退逻辑；
- Browser preview 证明默认 CTF 题库桌面未被改坏，页面非空且无 console warn/error。

本次仍未证明：

- 原生 App 中已有真实 CTF job 时，用户点击返回题库再继续解题的完整可见流程；
- 从 CTF 切到 CVE 再回 CTF 的真实 job scroll position、选中题和 Agent 输出完全恢复；
- CTF 工作台整体信息架构已经完成简化。

## 2026-08-04 · CVE read-only feed import handoff prompt

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 情报源接入状态 → 复制只读 Feed/Catalog 导入任务 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts` |
| 窄测结果 | 2 files / 18 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4194/`；进入 CVE，读取 `CVE 情报导入接力` 卡 |

覆盖范围：

- CVE 情报导入接力卡新增 `复制导入任务` 按钮；
- 复制内容把下一轮 Coding Agent 任务限定为只读 Feed/Catalog 导入纵切；
- prompt 明确固定 NVD、CISA KEV、FIRST EPSS、OSV、GitHub Advisory 或 Vulhub catalog 的来源、样本日期、revision/digest、失败原因和缓存位置；
- prompt 明确禁止拉起 Docker、开放端口、发送漏洞触发输入、访问未经授权目标、读取/输出/迁移 Provider/API Key；
- UI 说明复制不会自动启动 Agent；
- Browser preview 中 `复制导入任务`、`不会自动启动 Agent`、`只读 Feed 导入器` 和安全边界文案均可见，console 无 relevant error / warn。

本次仍未证明：

- 真实 NVD/KEV/EPSS/OSV/GHSA/Vulhub 导入器已经实现或通过网络失败回归；
- 导入样本的 digest、缓存文件、日期和差异展示；
- 任何 CVE 练习环境启动、停止、清理或真实资产验证。

## 2026-08-04 · Shared module topbar for Coding / CTF / CVE

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CTF / CVE / Coding 一级菜单 → 同位置模块标题和顶部动作区使用同一组件 |
| 窄测 | `npm --prefix app test -- WorkspaceTopBar.test.ts ChatPageRoutingContract.test.ts CTFWorkspaceHeader.test.ts VulnPage.test.ts CTFPageNavigationContract.test.ts` |
| 窄测结果 | 5 files / 22 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | 本批次未新增 Browser preview；组件契约和生产构建已覆盖。下一次打包 App 视觉 sweep 时复验三菜单真实截图。 |

覆盖范围：

- 新增 `WorkspaceModuleTopBar`，把 `coding / ctf / cve` 三个一级模块的标题映射集中到同一个组件；
- Coding、CTF 题库、CTF 解题会话和 CVE 顶部导航条全部改为复用 `WorkspaceModuleTopBar`；
- 底层仍由 `WorkspaceTopBarTitle` 渲染同一个 `H1 + workspace-topbar__title + text-control` 标题节点；
- 测试锁住三大模块不再各自手写或传入模块标题，后续只能通过共享组件调整字号和顶栏结构。

本次仍未证明：

- 真实打包 App 中三个菜单截图的像素级对齐；
- 顶栏以外的统计卡、表格、Tab、Textarea 和深层按钮已完全统一；
- 不同窗口宽度下 CTF/CVE/Coding 顶栏动作区的换行和焦点顺序已经完成视觉 QA。

## 2026-08-04 · CVE local JSON intel import

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 导入 JSON → 粘贴本地 CVE 情报样本 → 成为可见追踪条目 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts WorkspaceTopBar.test.ts` |
| 窄测结果 | 3 files / 24 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4195/`；进入 CVE，点击 `导入 JSON`，粘贴本地 JSON，导入后追踪条目从 7 变 8，`CVE-2026-55555` 和标题可见，console 无 warn/error |

覆盖范围：

- CVE 顶栏新增 `导入 JSON`，让用户能把本地整理的 CVE 情报样本直接变成追踪条目；
- 支持粘贴对象、数组，或包含 `items` / `vulnerabilities` / `cves` / `results` 的对象；
- 支持常见字段 `id` / `cveId` / `cve`、`title`、`vendor`、`product`、`affected`、`summary/details` 和 `references.href/url`；
- 重复 CVE 会跳过并保留现有记录，格式错误会给出本地错误，不会把失败样本写入状态；
- 导入后仍显示 `尚未复核` 和 `刷新不会联网拉取 Feed`，避免把本地粘贴误呈现为实时 Feed 同步。

本次仍未证明：

- 真实 NVD、CISA KEV、EPSS、OSV、GitHub Advisory 或 Vulhub catalog 的联网导入、缓存和 digest；
- 大文件导入、字段冲突合并、导入预览/撤销和差异视图；
- 原生 App 内从文件选择器导入 JSON/CSV；
- 任何 Docker/Compose 练习环境启动或真实资产验证。

## 2026-08-04 · CVE local JSON import undo

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CVE → 导入 JSON → 看到导入结果 → 撤销本次导入 |
| 窄测 | `npm --prefix app test -- VulnPage.test.ts useVulnerabilityDashboard.test.ts` |
| 窄测结果 | 2 files / 21 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4196/`；进入 CVE，导入 `CVE-2026-66666` 后结果条和 `撤销本次导入` 可见，撤销后记录消失、追踪条目回到 7，console 无 warn/error |

覆盖范围：

- CVE JSON 导入结果从隐藏在表单内的短提示改为表单收起后仍可见的结果条；
- 导入返回 `importedIds`，页面只允许撤销本次新增的本地追踪项；
- 撤销会清理该批本地 CVE 的状态、资产、研究任务、笔记、练习计划和 Coding 接力记录；
- 重复内置 CVE 仍只跳过，不会被撤销误删。

本次仍未证明：

- 完整导入预览、字段级差异、逐项勾选和历史批次回滚；
- 大文件导入性能和原生文件选择器导入；
- 真实 Feed cache/digest 或任何漏洞验证能力。

## 2026-08-04 · Coding missing-proof shortlist

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 产品闭环卡 → 合并状态下直接看到待补证明项 |
| 窄测 | `npm --prefix app test -- CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 20 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 构建结果 | production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4197/`；进入 Coding，`本轮产品闭环` 和 `Coding 待补证明` 区域可见，短列表列出当前缺口，console 无 warn/error |

覆盖范围：

- 合并状态卡下方新增短的 `Coding 待补证明` 区域，不需要用户从长验收清单里拼当前缺口；
- 只列 `acceptanceChecklist` 中尚未完成的项，已具备项不会重复显示；
- 每个待补项保留状态 Badge，并在有具体面板/恢复动作时提供直接入口；
- 组件测试覆盖短列表、未完成项过滤，以及从短列表打开产物预览、生成恢复点、打开变更面板。

本次仍未证明：

- 原生 App 中绑定真实工作区后，短列表的真实状态与右侧面板完全同步；
- 短列表已经覆盖所有未来 Coding 能力项；
- 这等同于完整 MilkSU develops MilkSU Gate；它只是让下一步缺口更可见。

## 2026-08-04 · Root navigation contract and latest M3 App build

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CTF / CVE / Coding 一级菜单和 CTF 解题会话 → 顶部标题走同一共享组件 |
| 初次完整门禁 | `npm run m3:release-check` |
| 初次结果 | 失败于 `TestPrimaryNavigationUsesConciseProductNames`，原因是根 Go 契约仍查找旧 `<WorkspaceTopBar` 标记 |
| 修正 | 根契约改为要求 CTF、CVE、Coding 和 CTF 解题头部都 import/render `WorkspaceModuleTopBar`，标题由共享 module label 表和 `WorkspaceTopBarTitle` 输出 |
| 窄测 | `go test .` |
| 窄测结果 | passed |
| 完整门禁 | `npm run m3:release-check` |
| 完整门禁结果 | 通过，输出 `M3 engineering release checks passed.` |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails build 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU' in 21.855s.` |

覆盖范围：

- 根 Go 契约现在不再只靠页面局部字符串判断，而是锁定 `WorkspaceModuleTopBar` 作为 CTF、CVE、Coding 的模块顶栏入口；
- `WorkspaceModuleTopBar` 统一输出 `Coding`、`CTF`、`CVE` 三个一级标题；
- `WorkspaceTopBarTitle` 继续作为唯一顶栏标题节点，暴露 `data-workspace-topbar-title`；
- 顶栏标题字号继续由 `--module-topbar-title-size` 控制，顶栏 actions / filters 里的 `sm` 控件继续由同一 TopBar CSS 收敛；
- 最新 HEAD 已重新生成本地 `MilkSU.app`。

本次仍未证明：

- 用户在原生 App 中真实点击 CTF → CVE → CTF 后，CTF 解题会话、题库筛选和滚动位置都符合预期；
- 用户在原生 App 中真实点击 CTF → CVE → Coding 后，Coding 会话排序、回到底部和来源返回入口都符合预期；
- 三个模块所有深层卡片、表格、Tabs、Textarea、下拉菜单和按钮已经完成完整视觉系统收敛；
- 外部 App Computer Use、CVE 真实情报源、Vulhub/Docker 练习启动、Git stage/commit/push 和完整 MilkSU 自举任务。

## 2026-08-04 · CTF Agent return surface and chat latest-message continuity

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | CTF Agent 对话 → 切到 CVE/Coding → 再点 CTF → 回到上次 CTF Agent；换会话/来源后聊天滚到最新消息 |
| 窄测 | `npm --prefix app test -- AppRoutingContract.test.ts ChatPageRoutingContract.test.ts` |
| 窄测结果 | 2 files / 5 tests passed |
| 全量前端 | `npm --prefix app test` |
| 全量前端结果 | 50 files / 240 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Browser 插件路径 | in-app browser 与 Chrome extension 均对 `http://127.0.0.1:4198/` 返回 `net::ERR_BLOCKED_BY_CLIENT`，未作为产品代码缺陷 |
| 渲染 fallback | 使用系统 Chrome 可执行文件 + Playwright headless，访问 `http://127.0.0.1:4199/` |
| 渲染结果 | 页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空；CTF/CVE/Coding 顶栏均为 `14px / 20px`；CTF 六赛道状态、CVE 当前下一步、Coding 产品闭环均可见 |
| 截图 | `/tmp/milksu-route-continuity-qa.png` |

覆盖范围：

- App 现在记住 CTF 上次返回表面：从 CTF Agent 对话离开后，左侧再点 CTF 会优先恢复该 Agent
  对话，而不是直接落回工作台/题库；
- CTF Agent 顶栏“返回题库”仍然显式切回 CTF 工作台，并把返回表面重置为 workspace；
- 手动从历史中选中 CTF Agent 对话也会把 CTF 返回表面记为 agent；
- ChatPage 在 conversation id、消息数量、CTF 来源态或 CVE 接力来源态变化时都会滚到最新消息；
- 滚动到底部会在 `nextTick` 后再等一帧，降低 DOM 高度尚未稳定时滚早导致停在顶部/旧位置的风险；
- Browser 插件路径阻塞已记录，未用它冒充成功；渲染 QA 使用无登录态的系统 Chrome headless fallback。

本次仍未证明：

- 原生打包 App 中真实 CTF Agent 正在运行时切到 CVE/Coding 再回来，是否完整保留运行态、日志和右侧栏选择；
- 原生 App 中真实长聊天、图片/产物消息加载后的最终滚动位置；
- CTF 题库筛选、滚动位置和工作台/Agent 双入口是否已经达到最终 UX；
- Computer Use、Git 交付和完整 MilkSU 自举任务。

## 2026-08-04 · Computer Use next-step CTA

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → Browser / Computer Use → 看到当前应做的唯一下一步 |
| 窄测 | `npm --prefix app test -- CodingComputerUsePanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 27 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| 渲染 fallback | 使用系统 Chrome 可执行文件 + Playwright headless，访问 `http://127.0.0.1:4200/` |
| 渲染结果 | Coding → `Browser / Computer Use` 可见 `下一步`、`重新检测 Computer Use`、桌面运行时边界提示；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-computer-use-next-step-qa.png` |

覆盖范围：

- Computer Use 面板新增高亮“下一步”区；
- 不可用时主 CTA 是“重新检测 Computer Use”，并说明浏览器预览只能验证 UI 文案和入口；
- 缺系统权限时主 CTA 是“打开系统权限设置”，说明缺少辅助功能/屏幕录制，并提示授权后重新检测；
- 缺窗口时主 CTA 是“重新检测可见窗口”，提示先打开目标 App；
- 权限和窗口都具备时主 CTA 是“启动可见会话”，并显示即将锁定的 App / PID / Window Scope；
- 已接入当前任务时主 CTA 显示“已接入当前任务”，并保留停止入口；
- 底部原有重新检测、请求系统权限、启动/停止按钮保留，避免改变运行时权限模型。

本次仍未证明：

- 原生 App 中点击“打开系统权限设置”后 macOS 是否稳定跳到正确系统授权页；
- 原生 App 中真实选择外部 App 窗口、启动 Computer Use、观察/点击/输入并留下截图证据；
- 多任务占用时释放/切换 Computer Use 会话的完整体验；
- Computer Use 对任意外部 App 的定位质量；本次只改善入口和下一步可理解性。

## 2026-08-04 · Git delivery next-step CTA

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → Git 交付 → 直接看到当前交付下一步 |
| 窄测 | `npm --prefix app test -- CodingChangesPanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 30 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| 渲染 fallback | 使用系统 Chrome 可执行文件 + Playwright headless，访问 `http://127.0.0.1:4202/` |
| 渲染结果 | Coding → `Git 交付` 可见浏览器预览运行时边界、`下一步`、`打开桌面 App 验收 Git`、`重新读取 Git 状态`；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-git-next-step-qa.png` |

覆盖范围：

- Git 交付面板在仓库状态可读时新增默认可见的“Git 交付下一步”卡；
- 下一步由现有 Git 状态派生：冲突 → Agent 审阅；未暂存变更 → 全部暂存；已暂存但无提交说明 → 等待提交说明；ahead → 推送；干净同步 → 准备 PR；
- 不自动提交空 message，不跳过 PR 一次性确认，不改变 Pull Request 只能发布到 MilkSU 私有仓库的边界；
- 浏览器预览/非仓库状态也显示同一层级的下一步卡，明确真实 Diff/Hunk、stage、commit、push 和 PR 仍必须在 MilkSU 桌面 App 中验收；
- 原有 Git 交付摘要、逐文件 Diff、逐 Hunk 操作、commit/push/PR 按钮保留。

本次仍未证明：

- 原生 App 中真实读取当前仓库 Diff、逐 Hunk 暂存/撤销/丢弃、commit 和 push；
- 真实托管平台 Draft PR 准备、一次性确认、创建和读回验证；
- Git 下一步卡在大型 dirty worktree、冲突、多 remote 和 detached HEAD 下的完整 UX；
- 完整 MilkSU develops MilkSU 自举任务。

## 2026-08-04 · Artifact preview next-step CTA

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 产物预览 → 直接看到如何形成用户可见证据 |
| 窄测 | `npm --prefix app test -- CodingArtifactPreviewPanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 24 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| 渲染 fallback | 使用系统 Chrome 可执行文件 + Playwright headless，访问 `http://127.0.0.1:4203/` |
| 渲染结果 | Coding → `产物预览` 可见 `下一步`、`打开桌面 App 验收产物`、桌面运行时边界提示；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-artifact-next-step-qa.png` |

覆盖范围：

- 产物预览面板新增默认可见的“下一步”卡；
- 浏览器预览态明确提示只能验证入口，真实 Markdown、HTML 和图片读取必须在 MilkSU 桌面运行时完成；
- 有候选产物时下一步引导预览第一个安全候选；
- 已打开预览后下一步说明可把当前 Markdown/HTML/图片作为用户可见证据，并提示如需真实交互再补 Browser 或 Computer Use；
- 保留工作区相对路径校验、HTML 无脚本/无网络 sandbox、Provider Credential 文本脱敏和不伪造工作区文件内容的边界。

本次仍未证明：

- 原生 App 中真实读取 Markdown、HTML 和图片产物；
- 原生 WebView 中 HTML sandbox/CSP 的负向验收；
- 图片大文件、动图、长 Markdown 和复杂 HTML 的视觉 QA；
- 完整 MilkSU develops MilkSU 自举任务。

## 2026-08-04 · Terminal/background-task next-step CTA and shared topbar contract

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 终端/测试 → 直接看到 Shell / 后台任务的当前下一步；CTF / CVE / Coding 顶栏标题保持同一组件和字号 |
| 窄测 | `npm --prefix app test -- WorkspaceTopBar.test.ts CodingTerminalPanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 3 files / 27 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| Browser 插件路径 | Browser runtime 成功连接本地预览 `http://127.0.0.1:4204/` |
| 渲染结果 | CTF / CVE / Coding 顶栏均为共享 `WorkspaceModuleTopBar` 渲染的 `H1`，标题字号 `14px`、行高 `20px`，动作区字号 `14px`；Coding → `终端/测试` 可见 `终端与后台任务下一步`、`桌面 App 中验收` 和后台任务浏览器预览边界 |
| 截图 | `/tmp/milksu-module-topbar-qa.png`, `/tmp/milksu-terminal-next-step-qa.png` |

覆盖范围：

- `WorkspaceTopBar.test.ts` 现在真实 mount `WorkspaceModuleTopBar` 的 `coding`、`ctf`、`cve` 三种模块，不只做源码字符串检查；
- 三个一级工作区顶栏标题都通过同一个 `WorkspaceTopBarTitle` 组件输出 `H1`，并保持相同 title class、动作区 class、字号变量；
- 终端/测试面板新增默认可见的“终端与后台任务下一步”卡；
- Shell 视图会引导新建项目 Shell 或切到后台任务；后台任务视图会引导刷新运行中任务、复核最近结果或运行长任务；
- 浏览器预览态不会启动 Shell、不会读取后台任务，也不会伪造端口/日志/重启恢复，只提示必须在 MilkSU 桌面运行时验收。

本次仍未证明：

- 原生 App 中真实启动交互式 Shell；
- 原生 App 中真实后台任务端口、日志、停止、重启后恢复；
- 长任务超时、取消、失败分类和跨应用重启恢复的人工体验；
- CTF/CVE/Coding 顶栏在所有小窗口尺寸、极长 subtitle、极多 action 时的最终视觉 QA。

## 2026-08-04 · Broad-first issue ledger handoff

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → 产品闭环卡 → 发现非阻塞问题时复制 BUG/OBS 登记格式，而不是现场深挖 |
| 窄测 | `npm --prefix app test -- CodingProductLoopPanel.test.ts` |
| 窄测结果 | 1 file / 21 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| Browser 插件路径 | Browser runtime 成功连接本地预览 `http://127.0.0.1:4205/` |
| 渲染结果 | Coding 页面可见 `未修问题登记`、`广度优先`、`复制登记格式` 和“只有硬红线或阻塞主闭环才立即修”；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-issue-ledger-card-qa.png` |

覆盖范围：

- Coding 产品闭环卡新增“未修问题登记”区；
- 复制内容给出稳定 `BUG-* / OBS-*` 表格格式，包含问题、复现与证据、影响和计划处理层；
- 复制内容明确分类规则：证据不足先 `OBS-*`，确认产品缺陷再 `BUG-*`；
- 复制内容继续保留硬红线：Provider/API Key、workspace/Scope、Computer Use 可见会话、私有远端和 smoke/完整成绩区分；
- 这让当前冲刺的“发现问题先登记，后续批量修”成为用户可见工作流，而不是只写在目标文档里。

本次仍未证明：

- 原生 App 中点击复制后的系统剪贴板体验；
- 后续 Agent 是否会把实际新问题稳定写入 `objective-coverage-ledger.md`；
- 已登记问题的批量评估和修复优先级排序。

## 2026-08-04 · Latest M3 release check after product-loop cards

| 项目 | 记录 |
| --- | --- |
| Commit | `58a99a4` |
| 命令 | `npm run m3:release-check` |
| 结果 | 通过，输出 `M3 engineering release checks passed.` |
| 前端全量 | 50 files / 242 tests passed |
| Node policy / bridge / runtime | 162 tests passed |
| Coding delivery fixture | score 100；external Provider cost 0；deterministic local provider |
| 本地 App | `/Users/milksu/code/milksu/build/bin/MilkSU.app` |
| 生成入口 | Wails 输出 `Built '/Users/milksu/code/milksu/build/bin/MilkSU.app/Contents/MacOS/MilkSU' in 24.285s.` |

覆盖范围：

- 最新 Coding 产品闭环卡、未修问题登记卡、终端/后台任务下一步、共享顶栏契约和前端构建均纳入完整 M3 工程门禁；
- Go 测试、Go vet、Node policy / bridge / runtime 契约、前端 Vitest、lint、production build、Sidecar smoke、Coding delivery fixture、docs build、Wails production build、macOS self-sign 均通过；
- 最新本机可打开 App 产物已经重新生成到 `build/bin/MilkSU.app`。

本次仍未证明：

- 用户在原生 App 中真实完成完整 “MilkSU develops MilkSU” Vue + Go 自举任务；
- 原生 App 中 Computer Use 对外部 App 的真实可见操作；
- 真实托管平台 Draft PR 创建；
- 六赛道 CTF、NYU Outcome、Developer ID / notarization / updater RC。

## 2026-08-04 · PR publication acceptance handoff

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | Coding → Git 交付 → 明确 push 与托管平台 PR 发布是两步，并复制 PR 验收清单 |
| 窄测 | `npm --prefix app test -- CodingChangesPanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 2 files / 32 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| Browser 插件路径 | Browser runtime 成功连接本地预览 `http://127.0.0.1:4206/` |
| 渲染结果 | Coding → `Git 交付` 可见浏览器预览 Git runtime 边界、`PR 发布验收`、`单独确认`、`复制 PR 验收` 和 `Push 只证明 Git 远端同步`；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-pr-acceptance-card-qa.png` |

覆盖范围：

- Git 交付面板新增“PR 发布验收”接力卡；
- 浏览器预览、非仓库和真实仓库状态下都能看到 PR 是单独托管平台写入确认；
- 复制的验收清单要求先确认干净工作区和已 push，再预览 MilkSU 私有仓库、分支、目标分支和 HEAD commit；
- 验收清单明确一次性 confirmation token 不能进入 UI、日志、错误或复制文本；
- 验收清单明确不得向引用的开源项目、upstream 或非 MilkSU 私有仓库发布；
- 仍保留现有真实 PR 预览/确认/读回代码路径，不自动创建 PR。

本次仍未证明：

- 原生 App 中真实准备、确认、创建或复用 GitHub Draft PR；
- GitHub 读回验证在真实托管平台中的稳定性；
- 多 remote、已有 PR、过期 preview、无 upstream 等真实仓库场景的人工体验。

## 2026-08-04 · Unified CTF / CVE / Coding module topbar titles

| 项目 | 记录 |
| --- | --- |
| Commit | 本批次提交 |
| 目标流 | 左侧菜单切换 CTF → CVE → Coding → 顶部导航标题始终由同一组件渲染，并保持相同字号与行高 |
| 窄测 | `npm --prefix app test -- WorkspaceTopBar.test.ts ChatPageRoutingContract.test.ts chatTopbar.test.ts CodingChangesPanel.test.ts CodingProductLoopPanel.test.ts` |
| 窄测结果 | 5 files / 43 tests passed |
| 前端构建 | `npm --prefix app run build` |
| 前端构建结果 | production build passed |
| Lint | `npm --prefix app run lint` |
| Lint 结果 | passed |
| Browser 插件路径 | Browser runtime 成功连接本地预览 `http://127.0.0.1:4206/` |
| 渲染结果 | CTF、CVE、Coding 顶部标题均为 `[data-workspace-topbar-title]` H1，class 均为 `workspace-topbar__title truncate text-control font-medium tracking-[-0.01em]`，计算字号均为 `14px`、行高均为 `20px`；页面标题 `MilkSU`；无 Vite/framework overlay；console warn/error 为空 |
| 截图 | `/tmp/milksu-module-topbar-unified-qa.png` |

覆盖范围：

- `WorkspaceModuleTopBar` 继续作为 CTF、CVE、Coding 三个一级模块顶部标题入口；
- CVE 接力会话的 `chatTopbarPresentation` 语义标题从 `Coding` 收敛为 `CVE`，避免后续 Agent 或空状态标题继续混淆；
- 真实浏览器预览中依次点击 CTF、CVE、Coding，验证同一位置的标题标签、class、字号和行高一致；
- 这条只处理模块顶部导航标题一致性，不扩大到所有页面内部大标题。

本次仍未证明：

- 原生打包 App 在不同窗口尺寸下的完整视觉一致性；
- CTF 工作区内部题目标题、CVE 详情标题、Coding 空状态标题等页面内容区标题层级是否需要进一步统一；
- 所有下拉、按钮、Badge 等“用户看起来相同”的组件是否已经完成全局样式收敛。
