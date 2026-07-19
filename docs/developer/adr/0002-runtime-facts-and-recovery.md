# ADR-0002：Runtime 事实、存储与恢复边界

> 状态：Accepted for M1
>
> 日期：2026-07-19

## 决策

M1 的 Shared Security Runtime 采用：

- **Go 领域契约**：`internal/securityruntime` 拥有 Job、Attempt、Step、Action、Observation、Artifact、Effect、Evidence、Evaluation、Outcome 与四个可替换边界；
- **SQLite 追加式 Event Store**：`modernc.org/sqlite v1.53.0`，通过 `database/sql` 使用，无 CGO；
- **文件系统 Artifact Store**：按 `Job ID + SHA-256` 内容寻址、原子创建，SQLite 只保存引用和来源；
- **事件重放 Projection**：任务状态不另设可修改的 `jobs.status` 真相表，每次从追加事件形成只读视图；
- **新 Attempt 恢复**：进程中断后保留已提交事实，在新 Attempt 中重试尚未形成 Outcome 的工作；已提交 Outcome 只补齐终态，不重复运行 Evaluator；
- **Wails 只读 Adapter**：React 通过 `ListJobs/GetJob` 读取 Projection，通过 `job-event` 获知变化，不能直接写事件或 Outcome。

SQLite 驱动选择 [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite)，是因为它提供标准 `database/sql` 接口且不需要 CGO，符合 macOS-first、以后可能支持 Windows 的单机桌面边界。M1 固定版本，不在运行时自动升级。

## 为什么先用事件，而不是可变 Job 表

安全任务不仅需要“现在是什么状态”，还要回答：

- 哪个 Engine 在哪个 Attempt 提议了什么；
- Capability 实际观察到什么；
- 哪个文件和哈希支撑结论；
- 副作用是首次发生还是恢复时复用；
- 哪个版本的 Evaluator 根据哪些 Evidence 判了 pass；
- 进程在什么事实之后中断，又从哪里恢复。

可变状态表适合快速读取，但会覆盖产生结果的过程。M1 规模很小，先用事件作为唯一事实源，可以直接测试不可改写和恢复语义；以后如果读取成本出现证据，再增加可删除、可重建的 Projection cache，不能把 cache 变成第二真相。

## 事务与不变量

每次 Append 都在同一 SQLite 事务中：

1. 分配 Job 内连续 `sequence`；
2. 读取已有事件并加上候选事件重放；
3. 检查对象引用、状态迁移和成功条件；
4. 只有 Projection 合法才插入；
5. commit 后才向 Wails 推送事件。

数据库 trigger 同时拒绝 `UPDATE` 与 `DELETE`。Runtime 还强制：

- Action 必须先声明 Effect class、幂等键、清理、审批和 scope check；
- Observation、Artifact、Effect 必须引用已经提交的 Action；
- Evidence 必须引用已经提交的 Observation 与 Artifact；
- Evaluation 必须引用 Evidence 和版本化 Evaluator；
- `succeeded` Outcome 必须引用 `pass` Evaluation；模型文字永远不能直接产生成功。

## Artifact 与 Effect 恢复

Artifact 文件先按 SHA-256 原子创建，再写 `artifact.committed` 与 Effect 事件。这个顺序故意允许出现“文件存在、事件尚未提交”的短暂窗口：如果进程此时退出，新 Attempt 写入相同内容会命中已有哈希，校验文件后记录 `effect.reused`，而不是再次制造副作用。

M1 的副作用只是 App 私有目录中的文件，因此内容寻址足以验证幂等机制。M2 的真实 Shell、Browser、Lab 与网络动作不能直接照搬这一实现；它们必须为各自的外部 Effect 提供幂等、查询、清理与审批策略。

## Fake 闭环的意义

M1 没有用 Fake Agent 假装 CTF Solver。它把四个角色分开：

```text
Fake AgentEngine  -> 只提出 fixture.inspect
Fake Capability   -> 解码固定材料并返回原始输出
Artifact Store    -> 保存并哈希结果
Fake Evaluator    -> 重新读取 Artifact 后独立判分
```

这证明的是 Harness 的事实和恢复语义，不是模型能力。Pi 仍是选定的 Embedded Agent Engine，但本轮不把旧聊天 `bridge.js` 强行改成 Runtime 协议。M2 会新增独立的 Pi `AgentEngine` Adapter，把 Runtime Projection 转成 Engine 输入，并只注册 MilkSU 明确允许的 Capability；通用聊天兼容桥继续与 Security Job 分开。

## 结果与代价

已验证：

- 并发 Append 仍保持连续 sequence；
- SQLite 事件不能更新或删除；
- 没有 passing Evaluation 的成功 Outcome 在写入事务内被拒绝；
- Artifact 可复核哈希且重复写入复用同一文件；
- 用户取消得到非成功 Outcome，不伪造 Evaluation；
- 正常关闭和强制中断后的 Job 都能恢复；
- 已提交 Outcome 后中断只补齐 Job 终态，不再跑一次 Evaluator；
- 真实 Wails binding 中的事件实时进入 React，并最终显示独立 Judge 的 pass。

当前代价与保留项：

- Projection 是 O(n) 事件重放，M1 不提前增加 snapshot 或 cache；
- SQLite 当前限制为单进程单 writer，符合首期单用户桌面产品；
- `time.Time` 与 `json.RawMessage` 由手写 TypeScript v1alpha1 类型接收，因为 Wails v2 的生成器会把它们降级成 `any` 或 `number[]`；进入稳定公开协议前应增加自动 schema 生成或显式 Desktop DTO；
- 真实 Pi Adapter、Action Gateway、PolicyDecision 和 Compose/OCI Provider 从 M2 的第一个 CTF 纵切开始实现。

## 被否决的方案

- **直接把 React 状态写入 SQLite**：会让 L1 成为任务真相，无法无 UI 测试与恢复；
- **只保存聊天 transcript**：无法可靠表达 Artifact、Effect、Evidence 和 Evaluator；
- **使用 CGO SQLite 驱动**：增加 macOS/Windows 构建和签名复杂度，本轮没有必要；
- **先建可变 jobs/steps 表、以后再补事件**：会让恢复和审计从一开始就依赖两套真相；
- **让 Fake Model 返回 success**：只能测试页面，不能验证 MilkSU 的差异化边界。

## 可重复验证

```bash
go test -race ./...
go vet ./...
npm --prefix app run build
npm --prefix app run lint
npm run docs:build
wails build
```
