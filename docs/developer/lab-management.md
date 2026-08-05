# 靶场与环境管理历史摘要

> 文档状态：Historical / Superseded Summary
>
> 原始长文已压缩。需要考古时使用：
>
> ```bash
> git show f4c8ae4:docs/developer/lab-management.md
> ```

## 保留结论

早期讨论确认过：本地 Lab、外部 CTF 网站和 CVE 练习环境不是同一种生命周期。

当前采用的边界是：

- CTF 题库与平台 Judge 继续走 CTF 工作区；
- CVE 练习只做用户确认的本地隔离环境和学习记录；
- Labs 自建平台暂停；
- HTB / TryHackMe / pwn.college 等更适合作为未来外部靶场辅助与进度追踪；
- 任意 Docker/VM 环境都必须有固定来源、资源上限、网络边界、停止/清理和证据记录。

本页不是 backlog。当前目标见 [当前开发目标](./current-objectives.md)。
