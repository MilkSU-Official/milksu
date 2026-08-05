# Runtime v1alpha1：M1 可恢复任务契约

> 文档状态：**Historical implementation contract**。
>
> 本页冻结 M1 当时的最小契约，不描述当前产品表面或任务顺序。当前 Runtime 事实见
> [当前系统与分层](/architecture/current-system)、代码、测试和 Git 历史。
>
> 日期：2026-07-19

> 实现结果：契约、SQLite Event Store、Artifact Store、Projection、桌面事件流、取消与恢复已完成并通过自动测试和 Wails 实跑。M2-A 只加入通用 `RoleFact` 与 Job-owned Artifact Admission，让 CTF 拥有自己的版本化 Projection；没有把 CTF 特有字段塞回 Shared Runtime。

本文冻结 M1 Walking Skeleton 的最小边界。它不是 CTF 或 Vuln Role，也不是另一套模型 Planner；它只证明 MilkSU 能把一次任务变成可保存、可验证、可恢复的事实链。

## 这批代码属于哪里

| 模块 | 层 | 最小职责 | M1 不做什么 |
| --- | --- | --- | --- |
| Desktop Runtime 页面 | L1 | 创建/取消 Fake Job，只读展示 Go Projection | 不在 React 中推导任务真相 |
| Fake Capability | L3 | 执行固定的 `fixture.inspect`，返回原始观察和待保存工件 | 不宣布任务成功，不运行 Shell |
| Event / Artifact / Projection / Recovery | L4 | 保存事实、形成只读视图、恢复中断 Attempt | 不实现 CTF Experiment Tree 或 Vuln Hypothesis |
| Fake Agent Engine | L5 测试替身 | 提出一条结构化 Action | 不复制 Pi 的会话、Compaction 或 Tool Loop |
| Fake Evaluator | L4 Evaluator | 从已提交 Artifact 独立核对候选结果 | 不相信模型摘要或 Action 返回的“成功”文字 |
| Fake Environment | L4 测试替身 | 提供确定性、无外部权限的运行环境引用 | 不管理 Docker；Compose/OCI Provider 到 M2 实跑 |

## v1alpha1 核心对象

```text
Job
└─ Attempt
   └─ Step
      ├─ Action
      ├─ Observation
      ├─ Artifact
      └─ Effect

Evidence ──引用──> Observation / Artifact
Evaluation ──读取──> Evidence
Outcome ──来源──> Evaluation 或控制面终止原因
```

- `Job`：用户要完成的一件事。本轮使用 `system.walking-skeleton`，不能冒充 CTF Role。
- `Attempt`：一次固定 Engine、Capability、Environment 和 Evaluator 的尝试；恢复会开始新的 Attempt。
- `Step`：可以独立提交的最小推进单元。
- `Action`：Engine 提议、Runtime 接受的一次类型化调用，包含预计副作用和幂等键。
- `Observation`：Capability 返回的原始事实，不等于 Agent 对事实的解释。
- `Artifact`：先写入文件系统、计算 SHA-256，再由事件引用的原始产物。
- `Effect`：本轮记录 `local_file.create` 是否首次提交或复用了已有内容寻址文件。
- `Evidence`：把一个候选结论连接到实际 Observation/Artifact。
- `Evaluation`：带版本的独立判分记录。
- `Outcome`：只有通过 Evaluation 才能是 `succeeded`；取消、运行错误可以产生非成功 Outcome。

M2-A 增加两个不绑定 CTF 的扩展点：`artifact.admitted` 表示用户或可信 Adapter 接入的 Job-owned 原始材料；`RoleFact` 是 `packageId / schemaVersion / kind / artifactIds / data` 的不可变信封。Shared Runtime 只验证身份和引用，CTF 自己解释 `ctf.milksu.dev/v1alpha1`；以后 Vuln 必须定义自己的 schema，不能复用 CTF 字段。

## 追加式事实链

M1 的正常事件顺序是：

```text
job.created
attempt.started
environment.prepared
step.started
action.proposed
action.started
observation.committed
artifact.committed
effect.committed | effect.reused
evidence.linked
step.completed
evaluation.recorded
outcome.decided
attempt.completed
environment.released
job.completed
```

CTF M2-A 会在 `job.created` 后、`attempt.started` 前先提交 `artifact.admitted` 与 `role.fact.committed`，把题目材料和角色状态固定下来；后续实验仍使用同一条 Shared Runtime 事实链。

事件使用 `runtime.milksu.dev/v1alpha1` 契约、每个 Job 内严格递增的 `sequence` 和 UTC 时间。SQLite 表禁止 `UPDATE` 与 `DELETE`；Projection 每次只从事件重建，不另设可以绕过事件修改的 Job 状态表。

M1 的 Artifact Store 使用 `Job ID + SHA-256` 内容寻址和原子创建。若进程在文件写入后、`effect.committed` 事件前崩溃，恢复后的新 Attempt 会发现同一文件并写入 `effect.reused`，不会再次制造副作用。

## 取消与恢复语义

- 用户取消：先提交 `job.cancel.requested`，再中断运行，最终得到 `cancelled` 非成功 Outcome。
- 正常关闭客户端：当前 Attempt 记为 interrupted，Job 保持可恢复；下次启动创建新 Attempt。
- 进程被强制终止：下次启动从事件发现非终态 Job，补记旧 Attempt 中断和 `job.recovery.started`，再创建新 Attempt。
- 已完成 Job 永不自动重跑；已提交 Artifact/Evidence 不因换 Attempt 丢失。

M1 不承诺恢复 Pi 的 token 级生成位置。它恢复的是 MilkSU 已提交的安全任务事实；M2-A 已把这些事实重新投影给真实 Pi Engine，但恢复粒度仍是新 Attempt，而不是 token 级续写。

## 四个可替换边界

M1 只定义 MilkSU 必须看到的窄接口：

1. `AgentEngine.Propose`：根据只读 Job Projection 提出下一 Action；M2-A 的 Pi Adapter 已在此边界归一化结果，但 Pi 仍拥有自己的通用 Loop。
2. `Capability.Execute`：执行一个已允许的类型化 Action，返回 Observation 和待保存 Artifact。
3. `Environment.Prepare/Release`：管理一个 Attempt 的环境租约；具体 Compose/OCI 状态机由后续 Provider 实现。
4. `Evaluator.Evaluate`：只读取已经提交的 Evidence 与 Artifact，产生可版本化 Verdict。

这些接口不能带入 Pi message、Codex item、MCP schema 或 Wails 类型。

## LabPackage v1alpha1 的 M1 冻结范围

M1 冻结 `source / revision / digest / platform / endpoint / readiness / reset / judge / security` 为必备字段，并冻结四种 Agent 可请求的类型化动作：

```text
lab.start / lab.reset / lab.stop / lab.submit
```

M1 只实现 manifest 校验和 Environment 接口测试替身，不执行 Docker。M2 的 Compose/OCI Provider 必须由 Go 确定性程序实现，并拒绝 privileged、host network、Docker socket、未批准主机挂载和非 loopback 公开端口；`lab.submit` 进入独立 Evaluator，不进入 EnvironmentProvider。

## Evidence、Evaluator、Effect 与基线

Walking Skeleton 的 Fake Engine 只会提出“检查固定材料”，Fake Capability 才能解码材料并产出 Artifact；Fake Evaluator 重新读取该文件，核对规定值并形成 `pass/fail`。因此删除 Artifact、篡改内容或绕过 Evaluation 都不能得到成功 Outcome。

M1 的对照不是“谁更会解 CTF”，而是同一个确定性任务的两种执行方式：

| 基线 | 正常完成 | 强制中断后恢复 | 重复 Effect | 成功依据 |
| --- | --- | --- | --- | --- |
| 直接调用 Fake | 可以 | 丢失过程 | 无账本 | 调用返回值 |
| MilkSU Runtime | 可以 | 新 Attempt 继续 | 内容寻址去重并留事件 | 版本化 Evaluator |

M1 验收测试必须证明：事件不可改写、序号稳定、Artifact 哈希可复核、取消可见、崩溃后能恢复、同一 Effect 不重复落盘、没有 `evaluation.recorded(pass)` 就不能产生成功 Outcome。
