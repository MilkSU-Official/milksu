# 靶场与环境管理

> 状态：**Historical / Superseded**。Labs 当前保持 `Paused / Designed`，后继设计见
> [CTF Labs 顶层与详细设计](/architecture/ctf-labs-design)；本页只保留早期
> `LabPackage v1alpha1` 决策。
>
> 日期：2026-07-19

## 先说结论

用户不应该先阅读 README、手动执行 `docker compose up`，再把地址复制给 Agent。创建 CTF Challenge 或 Vuln Target 时，MilkSU 应自动完成获取、校验、启动、等待就绪、重置、停止和清理。

这个想法已经被多个项目分别验证，但业界还没有一个同时覆盖 CTF、漏洞靶场、容器、VM、教学和 Judge 的通用格式。MilkSU 不需要重做 Docker 或 Kubernetes，只需要提供一层很薄的归一化控制面：

```text
外部项目格式
ctfcli / Vulhub / pwn.college / 自定义目录
                 │
          LabSourceAdapter
                 │
             LabPackage
                 │
       EnvironmentProvider ─── Judge
       获取/启动/重置/清理      独立判题
```

- **LabSourceAdapter**：翻译外部项目自己的格式，人话说就是“导入器”。
- **LabPackage**：MilkSU 归一化后的靶场说明，记录固定版本、运行方法、端口、健康检查、重置、Judge 和风险。
- **EnvironmentProvider**：确定性生命周期程序；首期使用 OCI Image 和 Docker Compose，后期才考虑 VM。
- **Judge**：独立判断 Flag、漏洞效果或证据是否成立。服务能访问不等于任务已经完成。

## 为什么不能让 Agent 自己管理 Docker

Agent 可以建议“现在应该重置环境”，也可以调用类型化的 `lab.reset` 工具，但不能直接持有 Docker socket 或临时拼装任意 Compose 参数。

确定性程序必须负责：

- 固定源码 revision、镜像 digest 和许可证；
- 检查 Apple Silicon/amd64 架构、资源和依赖；
- 分配只绑定到本机的临时端口；
- 拒绝未批准的 privileged、host network、设备、Docker socket 和主机目录挂载；
- 执行 start、readiness、reset、stop、cleanup 和崩溃后的孤儿回收；
- 运行受信 Judge，保存日志、Artifact 和状态事件。

Agent 只能：

- 推荐适合目标或知识点的 LabPackage；
- 请求 `start / reset / stop / submit`；
- 在已批准的 Capability 中运行实验；
- 提交 Flag、PoC 或 Evidence 给 Judge；
- 解释状态和建议下一步。

一句话：**Agent 是 Lab Manager 的智能调用者，不是拥有 root 权限的靶场管理员。**

## 本地 Lab 和外部 CTF 网站不是一种生命周期

MilkSU 必须用同一个 CTF Role 接受两类目标，但不能假装自己能重置所有目标：

```text
ChallengeSource
├─ LocalLabSource        → Lab Manager 可以 start/reset/stop
├─ ManagedBrowserSource  → 独立浏览器中登录和操作任意网站
├─ UserTabSource         → 用户显式分享已登录的当前标签页
├─ ManualImport          → 用户提供描述、附件、URL 或 Socket
└─ PlatformAPIAdapter    → 仅作可选体验优化

TargetProvider
├─ ManagedEnvironment    → MilkSU 拥有完整生命周期
└─ ExternalTarget        → 只记录授权、连接、到期和平台返回状态

SubmissionJudge
├─ LocalJudge
├─ PlatformJudge
└─ UserConfirmedJudge
```

例如 NSSCTF 页面可以提供题目和“开启环境”，但用户不可能保证任意小众比赛都提供 API。MilkSU 的通用能力必须来自浏览器：用户在独立 Profile 登录，或显式分享已经打开的标签页；Agent 从页面读取题目、下载附件、点击开启环境并在批准后填写 Flag。深度 API 适配只能作为后续优化。

这层兼容性也有明确边界：

- 任意网站首先做到“浏览器中导入并协作”；页面结构、验证码或比赛规则仍可能要求用户点击，不能承诺对所有网站完全无人值守；
- Managed Browser 使用独立 Profile；User Browser Bridge 只分享用户选择的标签页，Agent 不默认读取整个浏览器或所有 Cookie；
- Platform Browser Context 与 Target Browser Context 分开，平台账户 Cookie 不能发送到题目靶机；
- 自动提交必须经过用户启用、平台规则检查、频率限制和完整审计；
- 远程网站返回的正确/错误提示可以成为 Evaluation Evidence，但模型自己说“提交成功”仍不算；
- Juice Shop、CTFd、NSSCTF 的字段只能存在于来源 Adapter 或 Browser Observation，不能进入 `Challenge` 核心对象。

## 业界已经做到哪里

| 项目 | 已有能力 | MilkSU 怎样使用 |
| --- | --- | --- |
| [CTFd/ctfcli](https://docs.ctfd.io/docs/management/ctfcli/challenges/) | `challenge.yml` 包含名称、类别、Flag、Hint、文件和部分部署字段 | 写 Source Adapter；不把仍为 `0.1` 的格式当通用标准 |
| [kCTF](https://google.github.io/kctf/introduction.html) | Kubernetes Challenge、健康检查、重部署和 nsjail 隔离 | 学习硬化与大规模运行；本地 MVP 不引入 Kubernetes |
| [pwn.college Dojo](https://github.com/pwncollege/dojo/blob/master/docs/challenge.md) | 每用户 Challenge、动态 Flag、启动/重启和教学组织 | 已有成熟引导体验；不接入 MilkSU 普通用户题库 |
| [BoxPwnr](https://github.com/0ca/BoxPwnr/tree/main/src/boxpwnr/platforms) | 平台初始化、清理、目标列表、Flag 验证和多种 Executor | 学习 Platform/Executor/Solver 边界与 benchmark |
| [Vulhub](https://github.com/vulhub/vulhub) | 大量 CVE 目录和 Compose 环境 | 首批规模化靶场来源；只接 MilkSU 白名单固定版本，不直接执行任意上游目录 |
| [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) | arm64/amd64 镜像、自重置应用、挑战、Hint 和 CTF Flag | M3 收口后第一间用户可见的一键 Web 靶场 |
| [OWASP WebGoat](https://github.com/WebGoat/WebGoat) | 按漏洞主题组织的引导式 Web 课程与本地环境 | Juice Shop 后的引导式 Web 学习房间 |
| [NYU CTF Bench](https://github.com/NYU-LLM-CTF/NYU_CTF_Bench) | 55 道 development、200 道 test，覆盖六类 CTF 且多数可执行 | 仅用于开发者模型/Harness 基准，不进入普通用户题库 |
| [Amazon CTF-Dojo](https://github.com/amazon-science/CTF-Dojo) | 将公开 CTF Artifact 转成可执行环境 | 学习批量导入与修复；模型生成的 Compose 必须再验证 |

共同执行底座已经存在：[OCI Image/Runtime](https://specs.opencontainers.org/) 负责镜像和容器规范，[Compose Specification](https://compose-spec.io/) 负责多服务、网络、卷和健康检查。它们不理解 Challenge、学习目标、Evidence 或 Judge，这部分才由 MilkSU 补上。

## LabPackage v1alpha1 最小契约

```yaml
apiVersion: labs.milksu.dev/v1alpha1
kind: LabPackage
metadata:
  id: example.challenge
  title: Example Challenge
  version: "1"
  license: MIT
  source:
    url: https://github.com/example/challenge
    revision: <git-commit>
    digest: sha256:<package-digest>
spec:
  role: ctf                    # ctf | vuln
  categories: [web]
  runtime:
    provider: compose          # oci | compose；vm 后置
    entry: compose.yaml
    platforms: [linux/arm64]
    endpoints:
      - name: web
        service: app
        targetPort: 3000
        protocol: http
        publish: loopback-ephemeral
    network:
      ingress: loopback
      egress: deny
  readiness:
    - type: http
      endpoint: web
      path: /
      timeout: 90s
  reset:
    strategy: recreate-with-volumes
  judge:
    type: flag                 # flag | command | http-effect | artifact | manual
    ref: judge/...
  security:
    privileged: false
    hostNetwork: false
    dockerSocket: false
    hostMounts: []
```

必须是一等字段的内容：来源和固定版本、目标架构、Endpoint、Readiness、Reset、Judge 与 Security Policy。导入第三方项目时可以在旁边生成 MilkSU manifest，不要求上游修改仓库。

M1 只冻结字段、校验器和类型化 `lab.start / lab.reset / lab.stop / lab.submit` 请求，不执行 Docker。这样可以先证明 Agent 不能绕过 Runtime 获得任意 Shell 或 Docker socket；真正的 Compose/OCI Provider 在 M2 与固定本地 fixture 一起实跑。

### Readiness 和 Judge 必须分开

- **Readiness**：环境准备好了没有。例如 HTTP 返回 200，可以开始实验。
- **Judge**：任务完成了没有。例如 Flag 正确、PoC 触发了规定效果、Crash 能稳定重现。

训练用 Vuln 靶场可以有确定性 Oracle（已知答案的判定程序）；真实漏洞研究往往没有标准答案，只能形成 Evidence Sufficiency 与 Human Review，不能伪装成二元 Judge。

## EnvironmentProvider 最小状态机

```text
Absent → Fetching → Verified → Prepared → Starting → Ready
                                                   │
                         Dirty → Resetting ─────────┘
                                                   │
                              Stopping → Stopped → Cleaning → Removed
```

任何阶段都可能进入 `Failed`，但 `Stop` 与 `Destroy` 必须幂等：重复调用不会误删别人的容器或产生额外副作用。每个 Attempt 使用单独的 project、label、network 和 volume namespace。

首期 Go 接口只暴露类型化生命周期，不暴露任意 shell：

```go
type EnvironmentProvider interface {
    Preflight(context.Context, ResolvedLab) (Report, error)
    Prepare(context.Context, ResolvedLab, AttemptID) (Lease, error)
    Start(context.Context, Lease) (Instance, error)
    WaitReady(context.Context, InstanceID) (Connections, error)
    Inspect(context.Context, InstanceID) (State, error)
    Reset(context.Context, InstanceID, ResetMode) (Instance, error)
    Collect(context.Context, InstanceID) ([]Artifact, error)
    Stop(context.Context, InstanceID) error
    Destroy(context.Context, InstanceID) error
}
```

获取与校验属于 Package Store/Source Adapter；结果验证仍属于独立 Judge，而不是塞进 EnvironmentProvider。

## macOS 与 Apple Silicon 的首期约束

- 优先选择原生 `linux/arm64` 镜像；amd64 模拟必须在 UI 明示，不能静默回退。Docker 也说明模拟对编译等任务会明显变慢：[Multi-platform builds](https://docs.docker.com/build/building/multi-platform/)。
- 所有公开 Endpoint 默认绑定 `127.0.0.1` 与临时端口；Compose 未指定 host IP 时可能绑定 `0.0.0.0`：[Port publishing](https://docs.docker.com/engine/network/port-publishing/)。
- 运行靶场默认禁止外网；联网下载和离线运行分为 Acquire/Run 两个阶段。
- Compose/Dockerfile 本身就是代码。导入时先解析 resolved config，拒绝危险权限和挂载，不能直接执行模型生成的配置。
- 清理只按 MilkSU 自己的 label/project 精确执行，绝不运行全局 `docker system prune`。
- kernel exploit、恶意软件和必须依赖真实内核语义的实验不以普通容器作为最终隔离，留给后续 VMProvider。

## 实施顺序

1. `LabPackage v1alpha1 + ComposeProvider + OCIProvider + Flag/HTTP Judge`。
2. 接入已经固定版本并在 Apple Silicon 实跑的 OWASP Juice Shop CTF fixture（`labs/ctf/juice-shop`），做到一键启动、重置、判题和清理。
3. 把 Juice Shop 生命周期接入 CTF 用户界面，验证 Web/Vuln/教学、自重置与 Apple Silicon。
4. 接入 WebGoat，补引导式 Web 学习房间。
5. 增加经过白名单审查的 Vulhub Source Adapter。
6. 在开发者模式接入 NYU CTF Bench development/test 隔离和量化报告。
7. 再研究 ctfcli importer、VMProvider 与远端 kCTF Provider。

这个顺序会根据本地 CTF 靶场选型实跑结果调整。任何第三方项目进入默认集成前，仍须经过许可证、供应链、架构、离线性和 Judge 审查。
