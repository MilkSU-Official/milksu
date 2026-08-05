# 产品闭环冲刺摘要

> 文档状态：Historical / Summary
>
> 原始长文已压缩。需要考古时使用：
>
> ```bash
> git show f4c8ae4:docs/developer/product-loop-sprint.md
> ```

## 结论

M3 product-loop PR #1 已于 2026-08-05 squash merge 到 `main`，合并基线 `108e0e3`。

这轮冲刺的价值不在文案或状态卡，而在把若干能力从“看起来有按钮”推进到“真实打包 App
可验证”：

- Coding 自举式 fixture、真实 MilkSU 源码隔离 clone、打包 App Git stage/commit/push；
- PR 预览、一次性确认、复用既有 Draft PR、临时分支新建 Draft PR；
- Artifact Preview 的 Markdown / HTML / PNG 打包 App 验收；
- Computer Use 外部 App / PID / Window Scope、Settings 权限检测、截图辅助视觉；
- 后台任务打包 App 与 WebView 跨重启恢复；
- CTF / CVE / Coding 顶栏、设置入口和部分基础控件收敛；
- CVE 多源情报同步、来源快照、Vulhub 目录绑定、本地练习生命周期、资产验证、学习写回；
- Session Index / Obelisk 形态相关历史，用户确认后可进入 Coding 输入、CVE Note 或 CTF 复盘草稿。

这些证据允许说：MilkSU 的 M3 产品壳已经能跑多个真实纵切。它不允许说：

- MilkSU 已经等价替代 Codex；
- CTF 已经有六赛道成绩；
- CVE 已经是红队 Agent、批量扫描器、自动 PoC 或披露平台；
- Labs 已经启用；
- Developer ID、公证、升级和发行门禁已完成。

## 后续保留的节奏原则

1. 一项工作必须以真实结果结束：真实测试/build、真实 App 验收、真实 Browser/Computer Use、
   真实 Feed、真实 commit/push 或真实 Judge。
2. 不再用状态卡、复制 Prompt、localStorage confirmed、工具存在、工作区干净来宣称能力完成。
3. 非阻塞问题先记录，避免深度优先绕圈；只有数据、Credential、Scope、私有远端、Judge 或
   验收失真类问题立即修。
4. 默认 UI 只显示当前任务需要处理的东西；内部验收和接力摘要进入折叠区或开发者视图。
5. 新批次从 [当前开发目标](./current-objectives.md) 选择，不从本文恢复旧冲刺队列。

## 为什么保留这页

这页只保留后续 AI 有用的判断：M3 product-loop 已经合并，哪些能力不要重复打开，哪些结论不能外推。
流水测试章节已经移出当前文档，因为代码、测试脚本和 Git 历史比手写台账更可靠。
