# 产品闭环冲刺验收索引

> 文档状态：Historical Evidence Index
>
> 原始 2026-08-04/05 流水验收记录已压缩。需要逐条考古时使用：
>
> ```bash
> git show f4c8ae4:docs/developer/product-loop-sprint-acceptance.md
> ```

## 保留的可复用证据入口

| 领域 | 代表性验证 | 证据位置 |
| --- | --- | --- |
| M3 工程门禁 | `npm run m3:release-check` 在合并后 main 基线通过 | Git history、`scripts/m3-release-check.sh` |
| Coding 自举 | deterministic delivery、MilkSU 源码隔离 clone、Git facade stage/commit/push | `scripts/test-coding-agent-delivery.mjs`、`scripts/test-packaged-milksu-source-self-bootstrap-live.mjs` |
| PR 发布确认 | prepare、一次性 token、publish、readback、临时新分支 Draft PR | `scripts/test-packaged-coding-pr-publish-live.mjs`、`scripts/test-packaged-coding-pr-create-live.mjs` |
| Artifact Preview | Markdown、HTML、PNG、HTML sandbox/CSP 负向 | `scripts/test-packaged-artifact-preview-live.mjs` |
| Computer Use | 外部 Calculator Scope、App facade、WebView 启停、辅助视觉 | `scripts/test-packaged-computer-use-*.mjs` |
| 后台任务恢复 | 打包 App / WebView 跨重启恢复和停止 | `scripts/test-packaged-coding-background-*.mjs` |
| CVE 情报与练习 | NVD、EPSS、OSV、GHSA、KEV、Vulhub、Docker lifecycle、学习写回、资产验证 | `scripts/test-packaged-vuln-*.mjs` |
| Session Index | MilkSU 会话索引、外部 JSONL 导入、相关历史确认写入 | `internal/sessionindex`、`scripts/test-packaged-session-history-*.mjs` |
| UI 收敛 | CTF/CVE/Coding 顶栏、设置入口、折叠开发者后台、按钮溢出修复 | `app/src/components-vue/*TopBar*`、相关 Vitest |

## 使用方式

- 想知道能力现在是否存在：看当前代码和测试。
- 想知道为什么当时判断可以合并：看本索引和 PR merge 前的 Git history。
- 不要把旧流水中的“下一步”“尚未证明”逐条恢复成当前 backlog；当前 backlog 只看
  [当前开发目标](./current-objectives.md)和最新代码事实。
