# ADR-0007：CTF Agent Harness 与 NSSCTF Agent Arena 真实评测轨道

> 文档状态：**Historical ADR**。保留 Agent Arena 与真实 Judge 的决策来源，不把当时
> “未完成”列表恢复为当前任务。
>
> 状态：Accepted for M3 CTF Harness Baseline（2026-07-30）

## 背景

MilkSU 的 CTF 入口已经从“上传一道题”调整为赛事/平台工作台，但此前真实平台仍依赖用户手工打开题面和确认结果。与此同时，NSSCTF 发布了官方 [Agent Arena](https://www.nssctf.cn/ai/skill/nssctf-agent-arena)：Agent 使用独立 Token 领取一道限时题，读取题面、附件和容器，提交 Flag，或在无法推进时主动放弃；错误提交、超时、失败和成功都会影响 Agent rating。

这给 MilkSU 两个直接要求：

1. CTF 产品不能只是题面旁边的聊天框，必须有可恢复、可评测的 Agent Harness；
2. 用户与 Agent 参与一场 CTF 的方式不止“全自动解题”，协作模式和运行编排必须分开建模。

## 业界实现调研

本决策参考了 2026-07-30 仍公开可读的实现，所有成绩数字都视为项目方自述，除非另有独立评测：

| 项目 | 可吸收机制 | MilkSU 不直接照搬的部分 |
| --- | --- | --- |
| [verialabs/ctf-agent](https://github.com/verialabs/ctf-agent) | CTFd 轮询、比赛协调器、每题多模型竞速、每 Solver 独立 Docker、发现共享、操作员消息、Flag 去重与递增冷却、JSONL 轨迹、循环检测 | “永不放弃”不符合 Arena 的超时/主动放弃规则；周末项目和单场成绩不能代替长期 benchmark |
| [aliasrobotics/CAI](https://github.com/aliasrobotics/CAI) | Agent/Tool/Handoff/Pattern/Turn/Tracing/Guardrail/HITL 分层；专用 Agent 交接；多种编排模式；成本与轨迹可见 | 通用任意命令工具过宽，MilkSU 仍要求题目范围、环境和 Effect 约束 |
| [SWE-agent EnIGMA](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/index.md) / [Cyber-Zero EnIGMA+](https://github.com/amazon-science/Cyber-Zero/tree/main/enigma-plus) | 面向模型设计 ACI；调试器等交互工具保持会话；每次只执行一个动作；历史压缩；按 CTF 类别提供示例；统一 Step/Time/Trajectory 评测 | 旧 EnIGMA 绑定特定 SWE-agent 版本；提示词与工具脚本不能成为 MilkSU 的任务真相 |
| [NYU CTF Bench](https://github.com/NYU-LLM-CTF/NYU_CTF_Bench) / [CTF-Dojo](https://github.com/amazon-science/CTF-Dojo) | 题目元数据、附件、容器、Flag checker 的可执行数据集；开发集/测试集分离；固定环境；success、step、time 等指标 | 离线 benchmark 不能冒充真实比赛成绩；训练 writeup 不能泄漏到正式评测 |

共同结论是：模型本身不是产品护城河。真正影响 CTF Agent 效果的是题目归一化、工具接口、隔离环境、反馈格式、上下文维护、候选闸门、平台判题、循环/预算控制和可重放轨迹。

## 决策

### 1. 支持五种参与方式

协作方式描述人类怎样介入，编排方式描述运行多少 Agent；两者不再混成一个下拉框。

1. **Coach**：人类执行，Agent 根据证据提供分级提示和追问；成功同时关注 Flag 与用户独立步骤。
2. **Copilot**：人类与单 Agent 共用题目状态，双方都能提交观察，候选进入同一 Judge 闸门。
3. **Delegate**：单 Agent 在预算内自主推进；用户可暂停、补充提示、批准外部副作用。
4. **Race / Swarm**：多个隔离 Solver 对同一题并行，候选去重，发现通过消息总线共享，平台确认后取消其余分支。
5. **Benchmark / Replay**：固定题目、环境、模型、工具和预算重复运行；输出 success@N、时间、步骤、成本、错误提交和轨迹差异。

M3 可运行 Coach/Copilot/Delegate 的单 Agent 基线。Race/Swarm 与 Benchmark/Replay 进入稳定契约，但必须等真正的沙箱与工具层完成后才在 UI 标为可用。

### 2. 统一 Harness 状态机

所有来源最终进入同一条状态机：

```text
Platform/Fixture Intake
  → Challenge Admission
  → Environment Provision
  → Sense → Hypothesis → One Typed Action → Observation
  → Artifact + Evidence
  → Candidate Gate
  → Local or Platform Judge
  → Continue / Solved / Failed / Abandoned / Expired
  → Reflection + Metrics
```

`Job / Attempt / Step / Action / Observation / Artifact / Evidence / Effect / Evaluation / Outcome` 继续是唯一任务事实。聊天消息、模型自述和页面上的绿色状态都不能替代它们。

### 3. 正式接入 NSSCTF Agent Arena

Arena Adapter 只调用官方固定 API Origin：

- `GET /skill/agent/arena/current/`
- `POST /skill/agent/arena/next/`
- `GET /skill/agent/arena/attempt/{id}/`
- `POST /skill/agent/arena/attempt/{id}/submit/`
- `POST /skill/agent/arena/attempt/{id}/abandon/`

安全和一致性约束：

- Agent Token 保存到用户 Application Support 下权限为 `0600` 的独立 `credentials.db`；前端只读取 `has_token`，完整 Token 不进入 localStorage、日志、Event、Artifact、模型上下文或最终报告。SQLite 内容未额外加密，依赖当前系统账户和目录权限隔离；
- 浏览器 Cookie 与 Arena Token 不互换；API Adapter 不接收网页 Session；
- Arena 领题后先创建 `deferAgent=true` 的本地 CTF Job，使题目即使尚未配置模型也能保存和恢复；
- 候选先进入本地 External Submission Gate，形成 Action、Observation、Artifact、Evidence 和 `needs_review` Evaluation，再调用 Arena；
- 提交前保存平台 `wrong_count` 基线；网络中断或进程重启后先同步 attempt，若状态已 solved、错误数已增长或已进入终态，就回写该平台事实而不盲目再次提交；状态未变化时只允许重试同一 pending candidate，不同候选不能覆盖它；
- 官方 submit API 没有公开 idempotency key，因此 MilkSU 只能用上述对账缩小 at-least-once 风险，不能把传输超时描述成严格 exactly-once；
- `correct=false` 记录失败 Evaluation，不把 Job 标为成功，也不因模型缺 Key 自动启动失败的 Runner；
- 只有 `correct=true` 可以产生 succeeded Outcome；
- `abandoned / failed / expired / invalid` 是可解释终态，不能被 UI 改写为“已完成”；
- 错误提交次数和剩余时间必须在工作台可见。

### 4. 读题是 Intake/Capability 问题，不是单一页面问题

MilkSU 将逐步支持以下读题路径，归一化后共享同一个 Challenge：

- 官方 Platform Adapter：NSSCTF Arena、未来的 CTFd；
- 用户选择的公开题目 URL；
- Managed Browser 或用户显式分享的已登录标签页；
- 文件、截图、本地目录；
- Socket、SSH、远程连接说明；
- Docker 化 fixture/benchmark。

平台账户负责领题和判题，靶机环境负责实验，两者凭据和网络上下文必须隔离。

## M3 已完成与未完成

本 ADR 落地后，M3 CTF Harness Baseline 包含：

- NSSCTF 单题公开元数据导入，且不上传密码、Cookie 或整站题库；
- Arena Token 的用户目录 SQLite 凭据边界和官方 API 状态机；
- Arena 题目到可恢复 CTF Job 的映射；
- 候选、平台响应和 Outcome 的可验证证据链；
- Coach/Copilot/Delegate 现有单 Agent 任务状态；
- 学习观察写回下一轮 Agent 上下文；
- 明确标注的本地 fixture，不再冒充实时赛事。

它仍不等于“自主 CTF Agent 已完成”。当前 CTF Capability 只稳定支持材料读取、十六进制解码、分级提示和候选提交。要覆盖真实 Web/Pwn/Reverse/Crypto/Forensics，还需要：

- 每题独立的容器/VM Workspace；
- 受范围约束的 File、Shell、HTTP、Socket、Debugger 和 Vision Capability；
- 附件安全下载、哈希、解包和 provenance；
- 交互工具会话、输出截断、历史摘要和失败发现保留；
- 循环检测、步骤/时间/成本预算；
- Flag 格式检查、全局去重、递增冷却和剩余提交预算；
- Race/Swarm 调度、消息总线、赢家取消；
- 固定 benchmark 与重复运行统计。

因此，在真实 NSSCTF 返回第一次 `correct=true` 之前，项目只能声称“接入了真实评测轨道”，不能声称“已经打过并解出 NSSCTF”。

## 面试叙事与指标

这条主线可以清楚回答“为什么不直接套一个 Agent 框架”：

- MilkSU 把平台状态、模型运行和 Judge 分开，模型不能自报成功；
- 同一题支持从教学到全自动、从单 Agent 到多模型竞速，而任务事实不重写；
- 平台失败、Token、错误提交、超时和恢复都是一等状态；
- 所有优化用同一组指标比较：`solve@1 / solve@N`、time-to-flag、Agent steps、tool errors、wrong submissions、cost、recovery rate、hint dependency、human independent steps、trajectory replay consistency。

只有这些指标在固定环境下优于最小通用 Agent 基线，新的编排或 Capability 才进入 MilkSU 核心。
