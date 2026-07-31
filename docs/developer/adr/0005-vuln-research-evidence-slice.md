# ADR-0005：M3 Vuln Research 证据纵切

> 状态：Accepted for M3-A
>
> 日期：2026-07-30

## 决策

M3-A 在共享 `securityruntime` 上增加独立的 `vuln.research` Role Package，不把 Vulnerability Research 写进 CTF 服务，也不增加第二套任务真相。

首条纵切只使用项目内置、版本固定、不会监听网络的 `packet-parser@local-v1`：

```text
Target + Version + Scope
  -> deterministic source review
  -> Attack Surface
  -> Hypothesis
  -> static Root Cause candidate
  -> external three-run ASan evidence import
  -> deterministic evidence evaluator
  -> Domain Outcome + Human Outcome
```

Runtime 继续拥有 Job、Attempt、Step、Action、Observation、Artifact、Evidence、Evaluation、Outcome 与恢复事件；Vuln Role 只通过 `RoleFact` 保存 Target、Attack Surface、Hypothesis、Reproduction、Root Cause 和 Learning Record。

## 发布门结果

本纵切通过窄范围 M3 发布门：

- 只开放内置本地 fixture，不提供 URL、Socket、任意目录或目标列表入口；
- Scope 由本机用户动作创建，精确绑定 `packet-parser@local-v1`；
- Provider 密钥由用户级本地凭据数据库与 Sidecar 进程边界管理，不进入 Vuln 事件、Artifact 或前端；
- Browser、Network、Shell 和 Lab 外部执行能力没有因 M3 工作台而扩大；
- 页面同时显示 Domain Outcome、Evidence/Evaluator 与 Human Outcome。

因此它可以进入 Core 桌面开发，但不构成 External Bridge 或通用漏洞扫描产品。

## Evidence 与 Evaluator

静态检查只建立候选根因，不能产生成功 Outcome。确定性 source reviewer 保存：

- 固定源码 Artifact 与 SHA-256；
- `main -> parse_packet` 入口；
- 2 字节长度字段到 `memcpy` 长度参数的数据流；
- 16 字节目标缓冲区缺少独立上界检查的候选根因；
- 不推断外部产品影响、不评估利用链。

动态证据由用户显式导入，MilkSU 只接收：

- 同一触发样本的 SHA-256 与字节数；
- 编译器、Sanitizer、操作系统和架构；
- 三个独立进程的 Sanitizer 日志；
- 用户对干净本地进程与授权 fixture 的确认。

MilkSU 不接收、生成或执行触发样本字节。`vuln-external-reproduction-evidence@1` 独立检查三份日志是否都包含一致的 `AddressSanitizer / stack-buffer-overflow / parse_packet` 指纹；只有 3/3 一致并有用户确认时才记录 passing Evaluation。这个结论准确描述为“外部复现证据通过一致性核验”，不能写成 MilkSU 已在自己的干净环境重新执行了样本。

## L2/L3/L4 边界

| 层 | 本轮实现 | 不属于本轮 |
| --- | --- | --- |
| L2 Vuln Role | Target、Attack Surface、Hypothesis、Reproduction、Root Cause、Human Outcome 投影 | 通用扫描器、Disclosure 流程、利用开发 |
| L3 Capability | 固定源码只读检查、外部日志与元数据导入 | 触发输入生成/最小化/执行、任意 Shell/Fuzzer |
| L4 Runtime | 追加事件、Artifact/Evidence、Evaluator、Outcome、恢复 | 新的可变 Vuln 数据库或 React 直写事实 |
| L1 Desktop | 长期研究记录、实验轨迹、证据、根因、评估与复盘 | 一次性扫描向导 |

## 恢复

创建 fixture 与导入证据都用同步、可提交的 Runtime Step。应用在 Step 中断时，启动恢复会把尚未完成的 Action/Step/Attempt 标记为失败/中断，保留已提交 Artifact 和 RoleFact；Workspace 继续等待用户重新导入证据，不会重放外部动作或伪造 Outcome。

## 基线与停止条件

本轮比较的是事实边界，不是模型找洞成功率。最小通用聊天基线只能返回一段源码解释，不能独立保存 Target/Version/Scope、原始 Artifact、Evidence 引用、三次日志一致性 Evaluation、可恢复研究记录或 Human Outcome；M3-A 则用与 CTF 相同的 Runtime 契约保存这些外部事实。

这个结果只证明第二个 Role 可以复用 Security Harness，不证明它比成熟 Coding Agent 更会发现漏洞。进入更广 Target、真实 Fuzz 或自动复现前，必须在同一源码、模型、工具和预算下比较候选发现率、错误成功率、复现证据完整度和恢复行为；如果新 Capability 只增加流程而不改善这些指标，就留在外部 Adapter 或研究实验，不进入默认 Core。

## 结果与保留项

M3-A 已验证第二个 Role 能复用同一 Runtime，并在桌面形成可继续的研究工作台。原开发计划中“MilkSU 自动编译、运行、最小化触发输入并在干净进程重放三次”的严格完成标志没有在本 ADR 中宣称完成；当前实现是安全的外部证据导入纵切。自动本地复现 Runner、真实最小化 Capability 和更完整的 Exploitability/Disclosure 状态需要单独安全评审与后续 ADR。
