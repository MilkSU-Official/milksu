# CTF Labs 设计摘要

> 文档状态：Long-term Design / Not shipped
>
> 原始长设计已压缩。需要考古时使用：
>
> ```bash
> git show f4c8ae4:docs/architecture/ctf-labs-design.md
> ```

## 当前结论

Labs 还没进发行包和当前完成线。这是现状，不是冻结。用户明确要做时可以直接开切片。

当前更想先碰的方向不是自建 HTB/TryHackMe 级平台，也不是在 MilkSU 里管理一整套 VM /
Docker 靶场后端；短中期可以先做：

- 辅助用户在 HTB、TryHackMe、pwn.college 等外部靶场学习；
- 追踪练习进度、笔记、提示依赖、复盘和能力画像；
- 在明确授权时记录题目/房间/模块状态和用户贡献；
- 复用 CTF 的 Evidence、Judge/验证、Memory 和 Agent 协作模型。

## 真边界

- 不绕过外部平台规则、账号、付费或 API 限制。
- 不把外部靶场练习结果自动写成用户能力事实。
- 不把 Labs 当成 CTF 六赛道能不能验收的前置。

本地可重置环境、题目附件和授权范围内的触发输入都可以做。不要把“先有完整 Environment Broker /
默认拒绝漏洞触发”写成开工条件。需要时再补授权、资源上限、清理和 Evidence 归属。
