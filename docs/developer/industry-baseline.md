# 开源项目基线与架构启示

> 文档状态：**Research catalog**，不是依赖清单、当前功能表或实施顺序。
>
> 项目必须经过源码阅读、实跑、许可证、供应链、权限面与真实任务审查后，才能进入正式
> Adapter 决策；正文中的 star、版本和项目状态是当日快照。
>
> 更新：2026-07-19
>
> 当前产品取舍：本页保留当日调研证据，不代表现行接入队列。现行顺序见
> [个人安全工作台计划：安全工具接入 Coding](./security-workspace-product-plan.md#4-安全工具接入-coding)。
> BoxPwnr、PentAGI 已明确不进入产品；CAI 保留为思想和评测参考，Shannon 保留为外部 Worker 候选。
>
> 后续专项调研：
> [Wallbreaker Harness 静态调研与 MilkSU 对照](./research/2026-08-03-wallbreaker-harness-review.md)。
> 该项目当前只作 `adapt` / `benchmark-only` 参考，不进入依赖或 External Worker。

## 为什么单独维护这份基线

早期 MilkSU 在不了解业界实现程度时，从聊天、Skill、子代理和专用面板自行推演架构。现在需要用已存在的项目校正判断：哪些能力已经被成熟通用 Agent 或安全产品解决，哪些机制值得接入，哪些只适合作为 benchmark。

调研项目时必须区分五种关系：

| 关系 | 含义 |
| --- | --- |
| `adapter` | 直接调用已有 CLI、API、MCP 或结构化输出 |
| `external-worker` | 把完整 Job 委派给外部安全 Agent，再收回 Evidence 与 Outcome |
| `adapt` | 学习其已验证的数据模型和运行行为，用 MilkSU 契约重做 |
| `benchmark-only` | 只用于任务、Judge、Ablation、失败分类和对照 |
| `reject` | 与原版通用 Agent 重复、无法验证收益或引入不可接受风险 |

“写在架构图上”不等于“把仓库加入依赖”。

## 第一批架构样本

| 项目 | 代表的现实能力 | 对 MilkSU 的用途 | 初始关系 |
| --- | --- | --- | --- |
| [BoxPwnr](https://github.com/0ca/BoxPwnr) | 目标平台、Attempt、Transcript、预算、Judge 和 benchmark | 首个 CTF Environment/Evaluator 参考 | `adapt` + `benchmark-only` |
| [PentAGI](https://github.com/vxcontrol/pentagi) | 完整红队产品、Flow/Task/Action、持久化、成本和监督 | 研究 Run Graph 和人工干预；也可作为黑盒 Worker | `external-worker` + `adapt` |
| [Shannon](https://github.com/KeygraphHQ/shannon) | 白盒 Web/AppSec，从源码分析到真实利用证明 | AppSec Role 的 PoC/Evidence/Effect 参考 | `external-worker` + `adapt` |
| [Agentic SOC Platform](https://github.com/FunnyWolf/agentic-soc-platform) | Alert、IOC、Case、Investigation、Playbook 和 Response | 校正 Blue Role 的 Case/Evidence 模型 | `adapt` |
| [Security Lab Taskflow Agent](https://github.com/GitHubSecurityLab/seclab-taskflow-agent) | 声明式任务、Schema、Toolbox、MCP 生命周期、确认和恢复 | Role/Capability Package 契约参考 | `adapt` |
| [CodeQL](https://github.com/github/codeql) | 确定性代码分析、可引用结果和 Query Pack | Source/Code Audit Capability 与 AppSec Evaluator 输入 | `adapter` |

这些项目不是六个同级竞品：BoxPwnr 更像 Harness/Evaluation，PentAGI 更像完整 Control Plane，Taskflow 更像 Package/Workflow，CodeQL 是确定性 Capability，Shannon 是 AppSec Role 实现，Agentic SOC 是 Blue Case 产品。

## 在六层中的定位

| 层 | 主要样本 | 要学习的内容 | 不应照搬的内容 |
| --- | --- | --- | --- |
| L1 Surface | PentAGI、Agentic SOC、redamon、Strix | Run/Case 视图、暂停恢复、成本、审批 | 把 Dashboard 数量当差异化 |
| L2 Role | Red: PentAGI/ARTEMIS；Blue: Agentic SOC；AppSec: Shannon；CTF: BoxPwnr；Vuln: Taskflow/Co-RedTeam | 角色状态、证据和成功条件 | 只换 system prompt 的角色人格 |
| L3 Capability | CodeQL、Burp、capa、IDA/Ghidra | 结构化工具 Adapter、Artifact 和权限 | 运行时临时安装几十个未知工具；不把 HexStrike 整包 MCP 做成产品页 |
| L4 Runtime | BoxPwnr、PentAGI、Taskflow、Shannon | Environment、Attempt、Trace、Effect、Judge、Recovery | 复制整个外部 Agent Loop |
| L5 Agent Engine | Pi SDK、Codex 开源核心、Claude Code、CAI、PentAGI、Shannon、Strix | 内嵌可扩展基座、模型替换与黑盒委派 | 从 API 重写成熟的通用 Planner/Tool Loop |
| L6 Integrity | Agentic Radar、Garak、PyRIT、RAMPART | Agent/MCP/Tool 的安全测试与策略回归 | 把 Agent Security 当成 Blue/Red Role |

## 六个 Role 的项目坐标

| Role | 代表项目 | 当前判断 |
| --- | --- | --- |
| Red | PentAGI、CAI、ARTEMIS、Strix、MAPTA、redamon，以及大量 AutoPentest 类项目 | 产品最拥挤；普通自动渗透 Harness 最容易被 SOTA Worker 覆盖 |
| Blue | Agentic SOC Platform、AI-SOC-Agent、Raptor | 项目较少，但 Case、Evidence、Approval 和 Response 数据模型更有长期价值 |
| AppSec | Shannon、LLMitM、Strix、NeuroSploit、MAPTA、Co-RedTeam | 与 Coding Agent 重叠最大；差异点是 PoC、Effect、Patch 和 Regression 闭环 |
| CTF | BoxPwnr、D-CIPHER/NYU CTF、HackSynth、CAI | Judge 和可重置环境最适合做架构基线，不代表最终主要市场 |
| Vulnerability Research | Co-RedTeam、Taskflow、Raptor、MAPTA、Shannon | 关键资产是版本、根因、可重复触发、利用条件和披露状态 |
| Malware | 暂无可信的完整 Role 样本；Operant MCP、HexStrike、Ghidra/JADX MCP 只是能力输入 | 保持空缺，不为了六角色对称而把工具包冒充 Role |

## 对新架构的直接推论

### 1. 不从零发明通用 Agent Loop

规划、模型调用、上下文压缩、普通代码修改和 Tool Loop 优先复用 Pi SDK、Codex 开源核心等成熟实现。复用不等于把整个安全 Job 黑盒委派出去：MilkSU 仍然拥有并改造自己的 Security Harness，负责 Job、角色状态、Experiment、Evidence、Effect、Evaluator、Recovery 和 Human Outcome。

优先顺序是：稳定 SDK/扩展点，其次是本地服务协议，最后才是可持续的小范围 fork。只有扩展点无法表达安全语义时才改上游核心，并记录 fork 差异和升级成本。

### 2. Package 不是 Prompt 加工具列表

一个可进入运行时的 Package 必须声明环境、版本、schema、权限、副作用、清理、Evidence 和 Evaluator。只包含说明文字或 MCP 清单的内容属于 Skill/Adapter，不是 Role Package。

### 3. 完整竞品优先作为 External Worker

对于 PentAGI、Shannon、CAI、Strix 等已有 Agent Loop 的项目，第一选择是黑盒委派和结果归一化。只有经过实测证明某个数据模型不可替代，才在 MilkSU 中原生复刻。

### 4. 确定性工具比普通安全 RAG 更值得接入

CodeQL、Fuzzer、Debugger、Judge、SIEM 查询和沙箱会产生可验证 Observation。普通漏洞知识、命令说明和专家人格更容易被上游模型吸收。

### 5. 行业缺口也是结果

当前开源清单明显偏红队和自动渗透。Blue 与 Malware 的成熟样本较少。MilkSU 应把“暂无足够证据”写出来，而不是用功能相似的 MCP 填满架构图。

## 项目升级为默认集成的门槛

每个候选项目必须产出一张拆解卡：

1. 一条根据源码和实跑得到的完整执行轨迹；
2. 核心数据模型和状态转换；
3. 它的价值来自模型、环境、Evaluator、Evidence 还是产品 UI；
4. 与相同 Agent Engine、模型、工具、预算的最小基线对照；
5. 选择 `adapter / external-worker / adapt / benchmark-only / reject` 的理由；
6. 许可证、维护状态、凭据、网络、沙箱和供应链风险。

没有拆解卡和 ADR，不进入默认 Runtime，也不因 Star、工具数量或演示视频改变核心架构。
