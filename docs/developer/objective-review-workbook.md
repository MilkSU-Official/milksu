# 目标共同评估工作簿摘要

> 文档状态：Historical / Superseded Summary
>
> 原始填写工作簿已压缩。需要查看当时逐项讨论时使用：
>
> ```bash
> git show f4c8ae4:docs/developer/objective-review-workbook.md
> ```

## 保留结论

这份工作簿的作用已经完成：它帮助把长对话中的大目标收敛为后来的
[当前开发目标](./current-objectives.md)。

后续 AI 只需要记住这些判断：

- MilkSU 的核心短期价值是让 Coding Agent 足够强，能在必要功能上自举和迭代 MilkSU 自己。
- CTF、CVE、Coding 是同级产品工作区，不能把内部证据模型直接摊成默认 UI。
- 目标推进应先广度跑真实闭环，再对阻塞问题集中修；不要用状态卡、提示卡和流水文档制造进度感。
- CVE 当前做学习/追踪和练习辅助，不做红队 Agent、批量打靶或自动 PoC。
- Lab 暂停；长期只考虑外部 HTB / TryHackMe / pwn.college 等靶场辅助和进度追踪，不自建大型 Lab 平台。
- Obelisk 形态 Session Index 被提升为核心长期记忆层，但 MilkSU 仍负责正式 Evidence、Judge、
  Ability Profile 和安全结论。
- 新 pre-release 代码可以破坏性地实现干净模型；旧 schema 最终统一收口，不在每个功能中维护临时兼容层。

本页不是 backlog，不授权开发。当前目标以 `current-objectives.md` 为准。
