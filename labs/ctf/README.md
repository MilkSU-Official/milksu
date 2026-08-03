# MilkSU 本地 CTF 靶场

> 状态：**Paused developer fixtures**。当前目标不启动或扩展 Labs；本目录的脚本、候选调研
> 和固定镜像只保留为历史/开发回归材料，不是 MilkSU 当前用户能力。

这里存放可重复、可重置、只绑定本机回环地址的 CTF 测试夹具。它们用于验证
MilkSU 的 CTF Role、Environment、Evidence 与 Evaluator，不是公网攻击目标清单。

## 候选调研（2026-07-19）

Star 和仓库体积来自 GitHub API 的当日快照；体积是 GitHub 报告的仓库数据量，
不是本目录实际增加的大小。

| 候选 | Star / 最近维护 | 许可证 / 仓库体积 | 题型与本地判题 | Apple Silicon / Docker | 结论 |
| --- | --- | --- | --- | --- | --- |
| [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) | 13,513 / 源码 2026-07-15；v20.1.1（2026-06-23） | MIT / 约 295 MiB | Web、OWASP Top 10 及其他真实应用漏洞；内置 Score Board 与挑战完成状态，也支持 CTF 平台集成 | 官方 v20.1.1 镜像同时发布 `linux/amd64`、`linux/arm64`；单容器 | **选择**：覆盖面、可验证性、可靠性和启动成本最平衡 |
| [OWASP WrongSecrets](https://github.com/OWASP/wrongsecrets) | 1,451 / 源码 2026-07-17；1.13.5（2026-05-19） | AGPL-3.0 / 约 155 MiB | 67 个密钥泄露与管理题；应用内提交答案，并支持 CTFd | `latest-no-vault` 镜像同时发布 amd64/arm64；基础模式单容器，高级题需要 K8s/云环境 | 很适合后续 Secrets 能力包，但首个 CTF 夹具过窄 |
| [OWASP crAPI](https://github.com/OWASP/crAPI) | 1,547 / 源码 2026-05-14；v1.1.6（2025-09-30） | Apache-2.0 / 约 8.8 MiB | API Security 与微服务漏洞；有挑战说明，但没有同等直接的统一 flag/judge 接口 | 官方 Web 镜像有 amd64/arm64；完整 Compose 约 10 个服务，含 PostgreSQL、MongoDB、ChromaDB | 适合 Vuln Role 的 API 场景，作为第一个 CTF 夹具偏重 |
| [CI/CD Goat](https://github.com/cider-security-research/cicd-goat) | 2,279 / 源码与 1.2.7 均为 2024-07-14 | Apache-2.0 / 约 69 MiB | 11 个 CI/CD 攻击题；内置 CTFd flag 判题 | Jenkins 主镜像有 amd64/arm64，但完整环境包含 GitLab、Docker-in-Docker 等 9 个服务，未逐个确认 ARM64 | 判题明确，但资源占用和环境复杂度不适合 Harness MVP |
| [Frida Labs](https://github.com/DERE-ad2001/Frida-Labs) | 1,301 / 创建 2023-11-27，源码 2026-02-22 | MIT / 约 30 MiB | Android Frida、Java/Native Hook、x86/ARM64；APK 内有 flag，没有统一本地 judge | 需要 Android 设备或模拟器与 Frida，不是 Docker 单容器 | 满足“近三年新项目”，适合以后 Mobile/Reverse 能力包，不适合作为首个通用夹具 |

## 为什么第一项选择 Juice Shop

它不是创建于近三年的新仓库，但近三年持续维护并在 2026 年发布了新版本；相比
更新但较窄或较重的候选，它更适合第一条端到端链路：一个容器即可覆盖启动、
观察、解题、证据采集、挑战状态判定和环境重置。我们只保存一份固定版本的本地
运行描述，不复制约 295 MiB 的上游源码，也不提交镜像或运行数据。

当前夹具：[`juice-shop/`](./juice-shop/)
