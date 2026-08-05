# Wallbreaker Harness 静态调研与 MilkSU 对照

> 文档状态：**Research / Static review**
>
> 审阅日期：2026-08-03
>
> 审阅对象：[`JailbrokenAI/wallbreaker`](https://github.com/JailbrokenAI/wallbreaker)，固定源码
> 快照
> [`bfd1d646b2d5ca5aff38b6876ab914c664a20e0e`](https://github.com/JailbrokenAI/wallbreaker/tree/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e)
>
> 边界：本次只阅读公开帖子、仓库、源码、测试和项目元数据，没有运行攻击、目标交互、
> 模型越狱、Shell、HTTP 或 MCP。本页不是接入授权、依赖决策或新的开发任务。

## 结论

转发帖将 Wallbreaker 称为“最强 AI 红队 Harness”，但截至审阅日期，公开证据不足以支持
“最强”：

- 项目定位是专门面向 **LLM guardrail / jailbreak 实验**的终端和 Dashboard，不是覆盖
  Web、Pwn、主机、网络或 AppSec 的通用红队 Agent；
- 仓库仍为 `0.1.0`，没有正式 Release 或 Tag；
- 没有论文、官方 HarmBench/JailbreakBench 榜单成绩或第三方复现；
- 唯一公开效果是作者在 5 个目标上的初步记录：成功 3 个、60% ASR；样本很小，
  `PARTIAL` 也计入成功，并且仓库没有对应的完整运行产物；
- 工程规模、测试数量和功能广度是真实的，但主分支没有持续运行完整测试的正式 CI；
- 当前工具执行边界明显弱于 MilkSU，不能直接嵌入正式 Runtime。

更准确的评价是：

> Wallbreaker 是一个功能面宽、迭代快、针对 LLM 越狱实验优化的早期工作台。它有值得学习
> 的实验 Harness 设计，但还不是经过公开基准证明的最强产品。

## 公开证据

| 项目 | 静态审阅结果 | 能证明什么 |
| --- | --- | --- |
| 社区传播 | [用户看到的转发帖](https://x.com/LinearUncle/status/2084087599145374021)；[项目发布帖](https://x.com/VittoStack/status/2074849010578252239) | 说明项目得到关注，不证明效果领先 |
| 仓库活跃度 | 审阅时约 839 stars、146 forks、264 commits | 说明社区兴趣和迭代速度 |
| 版本成熟度 | 包版本 `0.1.0`，无 Release/Tag | 仍是早期项目，没有稳定发行承诺 |
| 工程规模 | 约 145 个源码 Python 文件、134 个测试文件、1,072 个测试函数 | 不是只有 Demo 或 Prompt 的空壳 |
| 自动化 | 只有示例 `redteam-gate` Workflow，主分支没有正式 CI Gate | 测试数量不等于持续通过 |
| 效果 | [CHANGELOG](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/CHANGELOG.md) 记录 5 个目标、3 个 `PARTIAL+`、60% ASR | 只是一条作者初步 smoke，不能外推为 SOTA |
| 标准数据 | 可加载 HarmBench 行为数据和多种 Transform，但跳过 contextual 类别 | 使用标准数据源不等于执行官方评测协议 |
| 许可证 | [AGPL-3.0-or-later](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/LICENSE) | 不适合直接嵌入 MilkSU 私有 Runtime |

## 它真正做得好的地方

Wallbreaker 的核心不是某一种攻击提示，而是把一次越狱实验组织成可重复的运行：

1. attacker、target、judge 使用不同 Profile；
2. Agent 在轮数、预算、停止条件内迭代；
3. Technique 和 Transform 作为显式变量参与实验；
4. `validate` 可以对候选重复采样；
5. vote/siege 可以产生少量候选并由 Judge 排序；
6. 每回合自动保存，运行轨迹写入 JSONL；
7. 同一引擎服务 TUI、Dashboard、批量执行和示例 CI；
8. 报告按 Technique、目标和结果聚合。

这使它比“一个 System Prompt 加几个工具”的项目更像真正的实验 Harness。

## 不能忽略的边界

以下问题来自固定提交的静态源码阅读，并不表示已经在真实环境利用：

- [`run_shell`](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/wallbreaker/tools/shell.py)
  直接使用宿主 `/bin/sh -c`，没有与项目权限模型等价的 OS 沙箱；
- [`read_file`](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/wallbreaker/tools/files.py)
  对绝对读取路径没有与写入相同的工作目录约束；
- [`http_request`](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/wallbreaker/tools/http_tool.py)
  可请求任意 URL 并跟随重定向；
- [`MCP bridge`](https://github.com/JailbrokenAI/wallbreaker/blob/bfd1d646b2d5ca5aff38b6876ab914c664a20e0e/wallbreaker/tools/mcp_bridge.py)
  启动子进程时继承完整环境变量；
- Judge 失败时存在启发式降级路径；这适合探索性实验，不能等价于 MilkSU 的权威 Judge
  Receipt；
- JSONL 和报告有利于分析，同时可能保存系统提示、完整输出和敏感工具结果；
- 尚未合并的
  [安全加固 PR #21](https://github.com/JailbrokenAI/wallbreaker/pull/21)
  仍在补 Dashboard 鉴权、SSRF、防泄密、工具权限和日志完整性等基础能力。

因此，功能数量和攻击 Technique 数量不能替代执行安全、结果可信度与第三方复现。

## 与 MilkSU 的对照

| 维度 | Wallbreaker | MilkSU 当前方向 |
| --- | --- | --- |
| 产品对象 | LLM 越狱与 Guardrail 评测 | Coding 自举、CTF 学习与可验证能力成长 |
| Agent Loop | 自研轻量循环，针对越狱优化 | 固定版本 Pi 提供通用循环，MilkSU 不再重造 |
| 工具面 | Technique 丰富，注册简单，权限元数据较弱 | 工具较少，但强调项目、Scope、权限、Evidence 和隔离 |
| 网络与进程 | Host Shell、任意 HTTP、MCP 继承环境 | Shell 默认无网络、精确 Endpoint、Browser/Profile 与凭据隔离 |
| Judge | 模型 Judge、重复采样、启发式降级 | 模型只给 Candidate；平台 Judge Receipt 才是成功事实 |
| Trace | 每轮 JSONL，分析效率高 | Append-only Event、Artifact Hash、Evidence、Checkpoint 和 Recovery |
| 多 Agent | vote/siege 面向候选生成和排序 | 面向通用协作、worktree 隔离和 CTF 角色移交 |
| Memory | BreakVault 保存目标/Technique 经验 | 必须分开 Agent 经验、题目 Memory 与用户 Ability Profile |
| 当前最大缺口 | 公开基准、边界和发行成熟度 | 长时真实任务与六赛道结果不足，尚不能证明整体可用性 |

Wallbreaker 不是 MilkSU 的直接替代品。MilkSU 若能形成壁垒，应该来自安全执行、长时恢复、
权威 Judge、完整证据链，以及能证明用户实际学会了什么，而不是工具数量。

## MilkSU 应吸收的七个机制

### 1. 固定 Run Manifest

每次验收固定记录模型、Provider 版本、工具集、任务或数据集 Digest、Seed、Temperature、
时间/Token/工具预算和 MilkSU Commit。没有固定 Manifest 的两次结果不能直接比较。

### 2. 重复验证和不确定性

真实任务不能只因一次成功就标记可靠。对可重复 Fixture 运行 N 次，记录成功率、方差、成本和
人工接管；Judge 自测失败时必须 fail closed，不能继续记为成功。

### 3. 失败分类

将 `finished / ask_operator / stuck / max_rounds / timeout / cancelled / tool_error /
permission_blocked / judge_uncertain` 分开，避免所有失败都落成一个模糊的“未完成”。

### 4. 有限候选并行

只在单 Agent 基线证明不足时，引入少量候选并行和 Judge 排序；设置 stall budget、总成本和
提前停止，不能把 Agent 数量本身当成进展。

### 5. 能力归因计分板

按任务类型、阶段、工具、失败原因、时间、成本、恢复和人工接管展示结果。CTF 还要单独记录
平台 Judge、提示依赖和用户贡献，不能压成一个总成功率。

### 6. 同一引擎服务产品与回归

CLI/Fixture、原生 App 和未来 Dashboard 应调用同一正式 Runtime 与 Evidence 模型，避免为
演示或 Benchmark 另造一个更容易通过的 Runner。

### 7. 策略 Memory 与用户画像分离

Agent 成功经验可以进入策略 Memory；只有明确归属于用户的步骤和结果才能影响 Ability
Profile。模型 Judge 或 Agent 总结不能把前者变成用户能力事实。

## 不应吸收

- 不直接依赖或复制 AGPL Runtime；
- 不再建一套通用 Agent Loop；
- 不把 Technique、Tool、Agent 或 Dashboard 数量当产品指标；
- 不开放任意宿主 Shell、任意 URL 或完整环境变量；
- 不把 `COMPLIED/PARTIAL` 或模型自评直接写成权威成功；
- 不默认保存完整 Prompt、Reasoning、凭据或原始敏感输出；
- 不在运行时拉取未固定 Commit/Digest 的语料和攻击库；
- 当前不投入 Wallbreaker External Worker 集成。

## 对当前目标的影响

本次调研**不增加任何产品范围**。产品开发恢复后，它继续强化
[当前目标](/developer/current-objectives)已经确定的优先级：

1. 停止继续扩大通用 Harness；
2. 先用固定模型、工具和预算完成一个长时自举开发任务；
3. 用少量代表性真实任务对比 MilkSU 与纯 Pi/Codex 基线；
4. 只看成功率、人工接管、恢复、成本/时间、Evidence 完整度和学习价值；
5. 若 MilkSU 不能在结果、恢复或学习体验上明显胜出，就缩小控制面，而不是继续堆功能。

Wallbreaker 给 MilkSU 最重要的启发不是再增加一批攻击能力，而是让一次产品实验在一天内
回答：**MilkSU 是否真的比裸 Agent 更有价值？**
