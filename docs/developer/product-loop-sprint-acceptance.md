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
