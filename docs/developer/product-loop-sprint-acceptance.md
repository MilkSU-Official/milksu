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
