# CTF Intake → Agent → Judge → Memory

> 状态：CTF 主链 **Implemented**；部分平台与原生 UI 回归仍属于发布门。本文不包含已暂停的
> Managed Labs。

## 数据模型

```mermaid
erDiagram
    CHALLENGE ||--o{ MATERIAL : admits
    CHALLENGE ||--o{ ATTEMPT : has
    ATTEMPT ||--o{ STEP : contains
    STEP ||--o{ ACTION : proposes
    ACTION ||--o{ OBSERVATION : commits
    ACTION ||--o{ ARTIFACT : creates
    ACTION ||--o{ EFFECT : records
    OBSERVATION }o--o{ EVIDENCE : supports
    ARTIFACT }o--o{ EVIDENCE : supports
    CHALLENGE ||--o{ AGENT_RUN : records
    AGENT_RUN ||--o{ AGENT_CANDIDATE : proposes
    AGENT_CANDIDATE ||--o{ SUBMISSION_GATE : enters
    SUBMISSION_GATE ||--o{ JUDGE_RECEIPT : receives
    JUDGE_RECEIPT ||--o{ EVALUATION : produces
    EVALUATION ||--o| OUTCOME : authorizes
    CHALLENGE ||--o{ LEARNING_RECORD : records
    OUTCOME ||--o| TRAINING_MEMORY : permits
    LEARNING_RECORD ||--o| TRAINING_MEMORY : requires_reflection
```

关键不变量：

1. `AgentCandidate` 不是 `Outcome`。
2. 成功 `Outcome` 必须引用一条 `pass` Evaluation。
3. 外部题只有平台明确回执或受控人工确认可以把候选判为通过。
4. Memory 是用户确认后的综合缓存；原始 Event、Artifact、Trajectory 和 Judge Receipt
   才是证据层。

## 主时序

```mermaid
sequenceDiagram
    autonumber
    actor U as 学习者
    participant UI as Vue CTF Workspace
    participant A as Wails App
    participant P as Platform / Browser Adapter
    participant C as internal/ctf Service
    participant R as Security Runtime
    participant W as Challenge Workspace
    participant PI as Pi Coding Agent
    participant J as Platform Judge
    participant M as CTF Memory Store

    U->>UI: 选择题目、协作模式、材料
    UI->>A: StartCTFChallenge / 平台 Intake
    A->>P: 获取公开元数据或配对页材料
    P-->>A: 题面、附件、来源与授权范围
    A->>C: ChallengeRequest
    C->>R: CreateJob + AdmitArtifact
    C->>R: CommitRoleFact(challenge.admitted)
    R-->>UI: CTF Projection

    U->>UI: 用 Agent 开始 / 继续
    UI->>A: PrepareCTFAgentWorkspace
    A->>M: RecallForChallenge
    M-->>A: 有界、可解释的待验证记忆
    A->>W: 写 challenge.json / TASK.md / materials / MEMORY.md
    A-->>UI: Handoff + 固定 Conversation ID
    UI->>PI: 在固定工作区启动或恢复会话

    loop 每个可见 Agent 回合
        PI->>W: 读取材料、写 notes/work、调用受控工具
        PI->>W: 追加 candidate-flags.txt（仅在有候选时）
        PI-->>A: JSONL 工具与完成事件
        A->>W: 追加 trajectory.jsonl + 原子更新 run.json
        A->>C: RecordCodingAgentTurn
        C->>R: Attempt/Step/Action/Observation/Artifact/Evidence
        opt 显式候选存在
            A->>C: RecordCodingAgentCandidate
            C->>R: CommitRoleFact(agent.candidate)
        end
    end

    U->>UI: 审阅并点击提交
    UI->>A: PrepareExternalSubmission
    A->>C: 候选 + 证据解释
    C->>R: needs_review Evaluation
    A->>J: 仅向已授权平台提交
    J-->>P: Accepted / Rejected / Inconclusive
    P-->>A: 类型化 Judge Receipt
    A->>C: Record Judge Receipt / Verdict
    C->>R: Evaluation

    alt 明确 Accepted
        C->>R: OutcomeSucceeded + FinishJob
    else Rejected
        C->>R: 保留失败证据，可继续训练
    else Inconclusive
        C->>R: 记录不明确结果，允许受控重试或人工核对
    end

    U->>UI: 写自己的 Reflection
    UI->>C: RecordLearning
    U->>UI: 沉淀为可复用技法
    UI->>A: SaveCTFTrainingMemory
    A->>M: SaveFromProjection
    M-->>UI: 已脱敏 Markdown + SQLite 索引
```

## 每一步的事实归属

| 阶段 | 真相归属 | 主要实现 | 状态 |
| --- | --- | --- | --- |
| Catalog / Intake | 平台 Adapter 提供来源；CTF Service 归一化 | `internal/nssctf`、`internal/ctfshow`、`internal/browsercap`、`ctf.validateRequest` | **Implemented** |
| Artifact admission | Security Runtime 计算 SHA-256 并保存 | `internal/securityruntime/artifact_store.go` | **Implemented** |
| Challenge fact | `challenge.admitted` Role Fact | `internal/ctf/service.go`、`internal/ctf/model.go` | **Implemented** |
| Workspace handoff | 每题固定目录和固定会话 ID | `internal/ctf/workspace.go`、`app.go` | **Implemented** |
| Agent execution | Pi 负责通用 Loop；MilkSU 负责策略和工作区 | `bridge.js`、`bridge-policy.js`、`internal/engine` | **Implemented / Partial** |
| Trajectory checkpoint | Recorder + `trajectory.jsonl` + `run.json` | `ctf_agent_recorder.go`、`internal/ctf/run_checkpoint.go` | **Implemented** |
| Candidate gate | 只读显式候选文件，不从聊天猜 Flag | `ReadAgentWorkspaceResult`、`RecordCodingAgentCandidate` | **Implemented** |
| External Judge | 平台或受控人工确认 | `PrepareExternalSubmission`、NSSCTF/CTFshow Bridge、Arena | **Implemented** |
| Recovery | Event Projection、PI checkpoint、inconclusive 重试 | `securityruntime.Recover`、`ctf.Service.Recover` | **Implemented** |
| Debrief | 由已提交事实确定性投影 | `internal/ctf/projection.go`、`training_report.go` | **Implemented** |
| Long-term memory | Reflection 后显式保存，候选和凭据脱敏 | `internal/ctf/memory.go` | **Implemented** |

## 持久化位置

```mermaid
flowchart LR
    event["Event Store<br/>runtime/events.sqlite3"]
    artifact["Artifact Store<br/>runtime/artifacts"]
    workspace["Challenge Workspace<br/>ctf-workspaces/&lt;job&gt;"]
    memoryIndex["Memory Index<br/>ctf/memory.sqlite3"]
    memoryDoc["Memory Synthesis<br/>ctf/memories/*.md"]

    event -->|"投影"| workspace
    workspace -->|"轨迹回流"| event
    event -->|"证据引用"| artifact
    event -->|"完成状态 + Reflection"| memoryIndex
    artifact -. "来源引用" .-> memoryDoc
    memoryIndex --> memoryDoc
    memoryDoc -. "新题中的待验证先验" .-> workspace
```

Memory 不复制原始 Flag、API Key、Bearer Token 或 URL Secret。新题召回按分类、题名、
知识点、标签、置信度和时间做本地可解释排序；同一 Job 不召回自己的综合记忆。

## 明确未完成

- 动态 endpoint 从题面发现后仍需要完整的用户确认 UI，文字本身不能自动扩大 Scope。
- 宿主机 PI Shell 不是容器；macOS Seatbelt 也不是跨平台的精确网络隔离。
- CTFshow 适配代码存在，但真实账号 E2E 需要持续作为发布回归保存。
- NYU CTF Bench 已接入固定索引、fail-closed safe-static one-shot Runner、两回合 Pi
  只读 Agent Runtime、Digest Judge 和静态报告；完整挑战 Runner、作用型 Agent 工具链与
  代表性真实成绩仍不存在。
- Managed Labs 已暂停，不属于本时序的可用入口或完成条件。
