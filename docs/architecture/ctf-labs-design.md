# CTF Labs 设计摘要

> 文档状态：Long-term Design / Not shipped
>
> 本文是 **CTF 可重置训练环境**（Juice Shop / WebGoat / Vulhub 一类）的长期设计。
> 它不是主导航「实验室」。当前实验室是未知漏洞探测作业 + 活报告，见
> [当前开发目标](/developer/current-objectives)。
>
> 原始长设计已压缩。需要考古时使用：
>
> ```bash
> git show f4c8ae4:docs/architecture/ctf-labs-design.md
> ```

## 当前结论

CTF 可重置环境还没进发行包和当前完成线。这是现状，不是冻结，也不再挡住主导航实验室。

产品判断已经改口，见 [靶机、环境经纪与 CVE 复现](target-environments.md)：真实环境是研究工作台本体，不是「短中期不要管 Docker/VM」。Juice Shop / WebGoat / Vulhub 是 Environment Broker 的第一批包，CTF、CVE、实验室、评测共用，不把可重置环境锁死在 CTF 题库里。

外部平台仍然要接，但不能代替本机起靶：

- 辅助用户在 HTB、TryHackMe、pwn.college 等外部靶场学习；
- 追踪练习进度、笔记、提示依赖、复盘和能力画像；
- 在明确授权时记录题目/房间/模块状态和用户贡献；
- 复用 CTF 的 Evidence、Judge/验证、Memory 和 Agent 协作模型。

自建 HTB 级公网平台不做。本机 Docker 包、以及后续 Android / Apple 虚拟机和真机适配，属于经纪，不属于「另做一个靶场网站」。

## 真边界

- 不绕过外部平台规则、账号、付费或 API 限制。
- 不把外部靶场练习结果自动写成用户能力事实。
- 不把 Labs 当成 CTF 六赛道能不能验收的前置。

本地可重置环境、题目附件和授权范围内的触发输入都可以做。不要把“先有完整 Environment Broker /
默认拒绝漏洞触发”写成开工条件。需要时再补授权、资源上限、清理和 Evidence 归属。
