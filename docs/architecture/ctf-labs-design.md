# CTF Labs 设计摘要

> 文档状态：Paused / Design Summary
>
> 原始长设计已压缩。需要考古时使用：
>
> ```bash
> git show f4c8ae4:docs/architecture/ctf-labs-design.md
> ```

## 当前结论

Labs 纵深闭环暂停，不进入当前完成条件。

用户当前想要的 Lab 方向不是自建 HTB/TryHackMe 级平台，也不是在 MilkSU 里管理一整套 VM /
Docker 靶场后端；短中期只考虑：

- 辅助用户在 HTB、TryHackMe、pwn.college 等外部靶场学习；
- 追踪练习进度、笔记、提示依赖、复盘和能力画像；
- 在明确授权时记录题目/房间/模块状态和用户贡献；
- 复用 CTF 的 Evidence、Judge/验证、Memory 和 Agent 协作模型。

## 不做什么

- 不自建通用 Lab 平台；
- 不默认拉取或启动大规模 VM / Docker 靶场；
- 不绕过外部平台规则、账号、付费或 API 限制；
- 不把外部靶场练习结果自动写成用户能力事实；
- 不把 Labs 作为当前 CTF 六赛道验收前置。

## 未来如果解冻

必须先确定：

1. 外部平台条款、账号和数据来源授权；
2. 本地环境 Provider 的安全边界、资源上限和清理策略；
3. 与 CTF Evidence / Memory / Ability Profile 的归属规则；
4. 不运行未审核附件、服务或漏洞触发输入的默认策略；
5. 用户如何看到“正在练习什么、证据在哪里、下一步是什么”。

在这些条件满足前，Labs 只作为未来设计参考。
