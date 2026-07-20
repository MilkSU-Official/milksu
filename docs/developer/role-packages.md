# Role Packages：先做 CTF 与 Vulnerability Research

Role Package 不是一段“扮演安全专家”的 Prompt，也不是工具列表。它定义一类任务的目标、长期状态、允许动作、证据要求和独立判分方式，回答：**这场任务怎样才算赢，用户又从中学会了什么。**

## 产品使命与当前范围

**MilkSU 是一个一站式网络安全 AI 学习客户端，也是人与安全 Agent 共同工作的研究与训练环境。它既帮助用户在授权环境中完成更多真实学习任务，也通过可验证的实验、证据和复盘，让用户真正掌握完成这些任务的方法。**

当前只开发 CTF 与 Vulnerability Research 两个 Role。Red、Blue、AppSec 和 Malware 暂时只保留在总架构的角色坐标中，用于检验抽象是否可扩展；它们不能抢占这两个纵切的实现优先级。

未来的 Red/Blue 也首先是攻防学习 Workspace：练习范围、靶场或已授权资产必须可见，用户既要看到领域结果，也要学习攻击路径、检测推理、证据判断和复盘方法。它们不是对任意互联网资产批量作业的产品入口。

“研究与训练环境”意味着产品必须同时做到：

- 把 Agent 的假设、实验、观察、证据和判断暴露给人，而不是只返回答案；
- 让用户可以亲自执行关键步骤、要求分级提示、质疑结论并继续实验；
- 保存失败路径和复盘，使一次任务沉淀为下次可以迁移的方法；
- 用独立 Evaluator 判断安全结果，用可观察行为判断学习结果。

## 两个正交维度

每个 Job 同时选择安全角色和协作方式，两者不能混为一个枚举：

| 维度 | 可选值 | 它改变什么 |
| --- | --- | --- |
| `role` | CTF、Vuln，未来再扩展 Red、Blue、AppSec、Malware | 任务状态、Evidence 与 Evaluator |
| `collaboration_mode` | Coach、Copilot、Delegate | Agent 何时提示、何时等待人类、何时自主执行 |

- **Coach（带练）**：优先提问、分级提示和讲解，让人类亲自完成关键步骤。
- **Copilot（协作）**：人和 Agent 共同提出假设、运行实验、审阅证据。
- **Delegate（委派）**：Agent 可以自主推进，但仍要暴露关键决策、证据和复盘。

这意味着“CTF 教学”和“CTF 自主解题”共享同一个 CTF Role，只是协作方式不同；Vuln 也一样。

## 每个任务有双重 Outcome

```text
Job Outcome
├─ Domain Outcome：安全任务本身是否完成并被外部 Evaluator 验证
└─ Human Outcome：用户是否理解方法、修正误区并形成可迁移能力
```

Human Outcome 不能靠 Agent 说“用户已经学会”。它至少要引用一种可观察证据：用户独立完成关键步骤、解释根因、迁移到变体题、正确判断下一实验，或在减少提示后复现结果。

## CTF Role Package

CTF 的价值不只在提交 flag。它还要把解题过程变成可重复实验和可调节的带练过程。

它也不是一次性“解题聊天”。MilkSU 要长期陪伴 CTFer 训练和参加比赛，暂定用下面的层级组织事实：

```text
CTF Workspace
├─ Competition
│  └─ Challenge
│     └─ Attempt / Experiment
├─ Training Task
│  └─ Challenge
└─ Standalone Challenge
```

用户可以新建一场比赛、一组训练任务，或者只打开一道题。`CTF Workspace` 长期保存题型覆盖、知识点、常见失败、提示依赖、用户独立完成的关键步骤和复盘；Competition 和 Training Task 负责组织 Challenge，但不能替代每道题自己的 Judge 与 Evidence。这里先冻结信息含义，不提前锁定界面布局。

Challenge 的来源与运行位置不属于角色定义。它既可以来自 MilkSU 管理的本地 Lab，也可以来自用户登录的任意 CTF 网站、显式分享的浏览器标签页、聊天中粘贴的题面、上传的文件或截图、用户明确选择的本地目录，以及 URL/Socket/SSH 等远程连接。统一 Challenge Intake 负责保存原始材料、哈希、provenance 与授权，再产生规范化输入。Role 只依赖规范化后的 Challenge、Evidence 和 Submission Verdict，不能出现 Juice Shop、NSSCTF、Docker、“任务一定来自浏览器”或“平台一定有 API”等假设。

### 领域闭环

```text
Challenge -> Hypothesis -> Experiment -> Observation -> Artifact -> Flag Candidate -> Judge
```

| 项目 | CTF 需要保存的内容 |
| --- | --- |
| 状态 | 题目、分类、环境版本、Experiment Tree、失败原因、快照、预算 |
| Evidence | 命令输出、脚本、流量、反编译结果、flag 来源 |
| Evaluator | 平台 Flag Judge 或本地版本化 Judge |
| Recovery | 从最近一次已提交实验恢复，不重复有副作用的步骤 |
| 学习投影 | 当前知识点、误区、已用提示层级、用户独立完成的步骤 |

### Hint Ladder（提示阶梯）

Coach 模式不应第一步就给答案：

1. 指出观察方向；
2. 提醒相关概念或工具；
3. 给出下一实验的结构；
4. 展示关键命令或代码片段；
5. 最后才完整演示，并要求用户解释或迁移。

首批项目参考：BoxPwnr 用于 Environment、Attempt、Judge 与 benchmark；CAI、D-CIPHER、HackSynth 用于能力和对照研究。它们不是默认依赖。

## Vulnerability Research Role Package

Vuln 的目标也不只是“扫到一个洞”。它要帮助人类扩大覆盖面，同时把线索推进为可重复、可解释、可披露的漏洞证据。

### 领域闭环

```text
Target + Version -> Attack Surface -> Hypothesis -> Experiment / Fuzz
-> Crash or Behavior -> Reproduction -> Root Cause -> Exploitability -> Disclosure State
```

| 项目 | Vuln 需要保存的内容 |
| --- | --- |
| 状态 | 产品与版本、组件、攻击面、假设队列、实验、Crash、根因、披露状态 |
| Evidence | 最小触发样本、调用栈、覆盖率、数据流、环境与版本指纹 |
| Evaluator | 稳定重现、根因证据、影响验证和人工复核；必要时加入修复复测 |
| Recovery | 保存 corpus、最小化结果、环境快照与失败实验，避免重复扫描 |
| 学习投影 | 为什么选择这个攻击面、下一实验如何区分假设、用户能否解释根因 |

首批项目参考：Taskflow 用于 Package、Toolbox 与恢复；CodeQL 作为确定性 Source Capability；ARTEMIS、Co-RedTeam、MAPTA、Shannon 用于 benchmark、状态或外部 Worker 研究。是否接入必须经过实跑和 ADR。

## 面板不是数据库

旧聊天、配置和 UI 可以保留，但新面板必须按 Role 分开设计：

- CTF 面板投影 Challenge、Experiment Tree、Hint Ladder、Artifact 与 Judge。
- Vuln 面板投影 Attack Surface、Hypothesis Queue、Crash、Reproduction、Root Cause 与 Disclosure。
- 对话仍是一种 Task 入口，也可以路由到其他 Role；它不再保存唯一事实。
- 面板只读取 Runtime 已保存的状态、Evidence 与 Evaluation，不能接受模型直接宣布“已完成”。

UI/UX 的具体布局在实现纵切时再确定；以上数据边界先保持稳定。
