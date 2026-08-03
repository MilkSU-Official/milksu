# 产品闭环冲刺验收记录

> 文档状态：开发期 Evidence，不是最终发布说明。

本文件只记录当前冲刺期间已经执行过的可复核验收动作，避免后续 Agent 把口头进展误当成
已完成声明。最终架构、里程碑、状态页和发布说明仍按 `product-loop-sprint.md` 后置统一更新。

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
| Commit | `d4df0f8` |
| 窄测 | `npm run test -- --run src/components-vue/WorkspaceTopBar.test.ts src/components-vue/CTFPage.test.ts src/components-vue/VulnPage.test.ts` |
| 窄测结果 | 2 files / 12 tests passed；当前没有独立 `CTFPage.test.ts` 文件，命令实际覆盖 WorkspaceTopBar 与 VulnPage |
| 全量前端 | `npm run test && npm run build` |
| 全量前端结果 | 45 files / 194 tests passed；production build passed |
| Browser 验证 | Vite preview `http://127.0.0.1:4173/`；依次进入 CTF / CVE / Coding |

覆盖范围：

- CTF、CVE、Coding 顶部标题都使用共享 `WorkspaceTopBar`；
- 三个一级菜单的 `data-workspace-topbar-title` computed font-size 均为 `14px`，line-height 均为
  `20px`；
- CTF / CVE 顶栏的主要按钮、筛选 Select、搜索 Input 均落在 `sm` 或 `icon-sm` 尺寸；
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
