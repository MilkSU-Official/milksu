# 目标覆盖台账摘要

> 文档状态：Retired / Historical Summary
>
> 原始百分比台账已压缩。需要查看旧逐项分数、提交流水或 OBS/BUG 原文时使用：
>
> ```bash
> git show f4c8ae4:docs/developer/objective-coverage-ledger.md
> ```

## 为什么退休

旧台账在 M3 冲刺中有用，但继续维护会有三个问题：

1. 百分比和逐项分数很快落后于代码；
2. 大量“已做/尚缺”可以直接从当前代码、测试和 Git 历史判断；
3. 未来 AI 容易把过期分数、流水 OBS 或合并前 PR 状态重新当作当前 backlog。

从现在开始：

- 当前目标和边界看 [当前开发目标](./current-objectives.md)；
- 当前实现事实看代码、测试、打包 App 验收和 Git history；
- 长期设计看 architecture / ADR / research 文档；
- 不再维护一张动态百分比台账。

## 仍有参考价值的台账结论

- M3 product-loop PR #1 已合并，不要继续围绕同一个 PR 收尾。
- Coding 已经有多个真实打包纵切，但还不能宣称等价 Codex。
- CVE 已经不是 mock 壳；它是学习/追踪 MVP，但不是红队/披露平台。
- CTF 主链存在，但六赛道 Judge-verified 仍是后续真实验收线。
- Memory 归属模型方向正确，但用户能力画像仍要靠真实轨迹校准。
- Runtime smoke 不等于完整 NYU CTF Outcome。
- Developer ID、公证、升级、新机器和正式性能矩阵仍属于 RC 阶段。

这些结论已经合并进 `current-objectives.md`，本页只保留历史定位。
