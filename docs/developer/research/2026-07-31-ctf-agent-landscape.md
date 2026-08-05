# CTF Agent 开源项目对照与 MilkSU 取舍

> 文档状态：**Historical research snapshot**。不表示列出的项目已安装，也不安排当前任务；
> 当前 reuse-first 决策见 [当前开发目标](/developer/current-objectives)。
>
> 调研日期：2026-07-31
>
> 范围：只阅读公开仓库、配置、Prompt 与实现；不把第三方 Agent 作为运行时依赖。

## 底座结论

MilkSU 当前并不缺一个“能跑命令的 ReAct Agent”。PI 已经提供 Coding Loop、自动
Compaction、持久会话和文件工具；MilkSU 也已经补上题目 Scope、材料分诊、题型路由、
预算、失败环检测、候选闸门、平台 Judge、工具工坊和训练记忆。

最接近“可直接拿来当底座”的是
[BoxPwnr](https://github.com/0ca/BoxPwnr)：它已经把平台、执行器、Solver、预算、
Trace、失败分析和恢复拆成稳定接口，并真实覆盖 HTB、HTB CTF、HTB Challenges、
TryHackMe、PortSwigger、CTFd、picoCTF、Cybench 等平台。但 MilkSU 不直接嵌入它：

- BoxPwnr 是 AGPL-3.0，作为桌面产品运行时依赖会增加分发和衍生作品边界的不确定性；
- 它的 Python + Docker + Solver Loop 会与 PI、Wails 和 MilkSU 现有 Runtime 重叠；
- 它优化的是自主解题与 Benchmark，MilkSU 的产品核心是“学习者可见的过程、候选闸门、
  权威 Judge 回执、能力画像和训练记忆”；
- 因此采用它的**接口形状和回归思想**，不复制实现：`PlatformAdapter`、`Executor`、
  `AttemptBudget`、`Trace`、`ProgressHandoff` 和 `Resume` 会成为 MilkSU CTF Harness
  的对照契约。

对 DeepSeek 这类模型最值得补的缺口是：执行器卡住后，不能继续在同一上下文中自己说服
自己。首个采纳项因此是一个隔离的 `strategist`：它独立审阅已有证据，诊断路线，交付
一个信息增益最高的下一步，但没有 Shell、网络和候选写权限。解题 Agent 返回后必须亲自
验证，策略建议不直接成为事实。

## 一手项目

| 项目 | 公开机制 | 与 MilkSU 的关系 | 决策 |
| --- | --- | --- | --- |
| [BoxPwnr](https://github.com/0ca/BoxPwnr) | 平台 / Solver / Executor 插件化；默认 Docker Kali；支持 HTB、HTB CTF、HTB Challenges、TryHackMe、PortSwigger、CTFd、picoCTF 等；记录完整 Trace、Token/成本/轮次；可生成 `progress.md` 并恢复；AGPL-3.0 | 是当前最成熟的跨平台 CTF Agent Harness，对 HTB 接入和真实回归最有参考价值 | **接口对照底座**：复用设计与测试方法，不作为发行依赖、不复制 AGPL 实现 |
| [NYU D-CIPHER](https://github.com/NYU-LLM-CTF/nyuctf_agents) | Planner 将单一任务委托给临时 Executor；Executor 返回强制摘要；按 Web/Pwn/Rev/Crypto/Forensics/Misc 分 Prompt；可先用 Auto-prompter 探索题目 | MilkSU 已有按题型路由和工具构建者，但缺少独立路线审阅 | 采纳职责分离；不复制其 Python Runtime、Prompt 或 Docker 网络模型 |
| [EnIGMA+ / Cyber-Zero](https://github.com/amazon-science/Cyber-Zero/tree/main/enigma-plus) | 交互式反编译/调试工具；长输出保存原文后摘要；只保留最近观察；统一 Challenge 与轨迹用于多 Benchmark；CC-BY-NC-4.0 | PI 已有自动 Compaction，MilkSU Evidence 保留完整输出；当前更缺真实平台成功样本 | 保留原文 + 有界 UI 已存在；后续为固定回归集采用统一 Challenge 规范；不作商业发行依赖 |
| [CAI](https://github.com/aliasrobotics/cai) | Agent、Tools、Handoffs、Patterns、Turns、Tracing、Guardrails、HITL；专业 Agent 可作为工具或正式移交 | MilkSU 的显式用户控制、执行边界和独立轨迹方向一致 | 采纳显式角色与产物交接；不引入通用 Swarm |
| [HackSynth](https://github.com/aielte-research/HackSynth) | Planner + Summarizer 双模块；PicoCTF/OverTheWire 固定评测集 | 证明规划与观察压缩应和模型能力分开评测 | M6 再建立可复跑基线；不把“Benchmark 能跑”冒充真实平台 MVP |
| [ctf-skills](https://github.com/ljagiello/ctf-skills) | 按题型按需加载的广覆盖 Skill 包和工具前置条件 | MilkSU 当前 playbook 较小，未来需要按题型扩充，但海量技巧不能一次注入上下文 | 采纳“按需加载”结构；真实题失败后再增加最小 Skill，不整体 vendoring |
| [Buttercup](https://github.com/trailofbits/buttercup) | Orchestrator、Seed Generator、Fuzzer、Program Model、Patcher，多 Agent 组件与完整可观测性 | 面向 AIxCC 漏洞发现/修复，不是训练型 CTF 的首要路径 | 仅参考预算、轨迹和组件可观测性；不纳入 CTF MVP |

## 框架取舍矩阵

评分只回答“是否适合作为 MilkSU 当前底座”，不是项目优劣排名。`高` 表示 MilkSU 能以
较低风险获得直接价值。

| 维度 | BoxPwnr | D-CIPHER | EnIGMA+ | CAI | MilkSU 当前选择 |
| --- | --- | --- | --- | --- | --- |
| 真实平台适配 | 高：HTB / THM / CTFd / PicoCTF 等 | 低：以 NYU Benchmark 为中心 | 低：Benchmark / 轨迹生成 | 中：工具丰富，平台产品层较弱 | 保留本地 Adapter；按 BoxPwnr 契约补齐 HTB |
| 执行隔离 | 高：Docker / SSH / Platform Executor | 高：Docker | 高：基于 SWE-agent | 中：通用工具与 Guardrails | 继续 MilkSU Docker Lab + workspace policy |
| Trace / Resume | 高：完整 Trace、预算、`progress.md` | 中：Executor 摘要 | 高：长轨迹和压缩 | 高：Tracing / history / compact | MilkSU Evidence + Checkpoint；补一组 BoxPwnr 兼容回归指标 |
| 教学产品契合 | 低：Benchmark / 自主解题 | 低 | 低 | 中：HITL | 高：Coach / Copilot / Delegate、复盘、能力画像 |
| 与 PI 重叠 | 高 | 高 | 高 | 高 | 不替换 PI；只引入缺失的 CTF 契约 |
| 许可证 / 分发 | 低：AGPL-3.0 | 高：MIT | 低：CC-BY-NC-4.0 | 中：MIT 仓库 + 商业版边界需单独复核 | 不把第三方 CTF Runtime 打进发行包 |
| 当前采纳级别 | 设计对照 | 角色模式 | 轨迹规范 | Handoff / Guardrail 模式 | PI Core + MilkSU CTF Harness |

## 立即进入实现的对照项

1. 把 HTB 接入按 `list / open / start / stop / submit / receipt` 的 Platform Adapter
   契约验收，禁止把“打开配置页”算接入；
2. 为每次 Attempt 记录模型、Solver 角色、轮次、耗时、Token、工具错误、候选和权威
   Judge 状态，能与 BoxPwnr Trace 指标横向比较；
3. 失败或中断必须生成结构化 Handoff，并能从最后一次已验证 Checkpoint 恢复；
4. 固定回归集同时包含本地 Fixture、NSSCTF 真实题和 HTB 真实 Lab，三者分别证明
   可重复性、平台 Judge 和高交互环境；
5. 对外部 Skill 采用按题型、按需、白名单加载，不允许整个技能仓库自动进入 Agent
   上下文或继承用户主机权限。

## 能力对照

| 机制 | MilkSU 状态 |
| --- | --- |
| 单题可恢复工作区 | 已有：`challenge.json / TASK.md / AGENTS.md / notes.md / work / evidence` |
| 长上下文压缩 | 已有：PI 自动 Compaction；MilkSU 断点保留事实、候选摘要和失败指纹 |
| 题型专门提示 | 已有轻量 Web/Pwn/Reverse/Crypto/Forensics/Misc 路由 |
| 执行工具 | 已有受限 File/Bash，加 `ctf_triage / inspect / decode / http / socket` |
| 动态编写工具 | 已有 `solver → tool request → tool-builder → solver 验收` |
| 独立规划/批判 | 本轮新增 `strategist → work/strategy-review.md → solver 验证` |
| Flag 判定隔离 | 已有候选文件、MilkSU Judge 与平台正确回执；Agent 不能直接提交 |
| 人在回路 | 已有 Coach/Copilot/Delegate，外部提交仍由用户控制 |
| 跨题记忆 | 已有用户确认后才保存的本地 SQLite 综合记忆，召回后必须重验 |
| 固定 Benchmark | 未完成；M6 建设，不能替代第一次 NSSCTF `correct=true` |

## 新增策略 Agent 契约

`strategist` 使用独立 Conversation ID 和
`evidence/strategist-trajectory.jsonl`。它只可读取题面、笔记、记忆、断点和轨迹，
并覆盖写入 `work/strategy-review.md`。执行层保护：

- 无 `bash`、`ctf_http`、`ctf_socket`；
- 禁止修改 `notes.md`、`candidate-flags.txt`；
- 禁止修改 `work/tool-requests/` 与 `work/tools/`；
- 不覆盖 Solver 的 `evidence/run.json`；
- 不把建议写成已验证事实，不直接触发 Judge。

复盘必须包含证据快照、路线诊断、最多三个方向、唯一下一步、成功/失败两种转向和停止
条件。这保留 Planner 的价值，同时避免两个 Agent 共享一个不透明聊天上下文。

## 下一步验证顺序

1. 在真实 NSSCTF 题目中跑 Solver；只有出现真实卡点时调用 Strategist；
2. 返回 Solver，验证策略建议是否改变下一步且没有污染已确认事实；
3. 由浏览器 Bridge 获取第一次平台 `correct=true`；
4. 把这条完整轨迹加入固定回归样本，再决定扩充哪个题型 Skill；
5. 累积多次真实结果后，才评估自动角色路由、并行 Executor 或 Benchmark 批跑。
