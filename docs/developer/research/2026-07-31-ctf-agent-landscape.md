# CTF Agent 开源项目对照与 MilkSU 取舍

> 调研日期：2026-07-31
> 范围：只阅读公开仓库、配置、Prompt 与实现；不把第三方 Agent 作为运行时依赖。

## 结论

MilkSU 当前并不缺一个“能跑命令的 ReAct Agent”。PI 已经提供 Coding Loop、自动
Compaction、持久会话和文件工具；MilkSU 也已经补上题目 Scope、材料分诊、题型路由、
预算、失败环检测、候选闸门、平台 Judge、工具工坊和训练记忆。

对 DeepSeek 这类模型最值得补的缺口是：执行器卡住后，不能继续在同一上下文中自己说服
自己。首个采纳项因此是一个隔离的 `strategist`：它独立审阅已有证据，诊断路线，交付
一个信息增益最高的下一步，但没有 Shell、网络和候选写权限。解题 Agent 返回后必须亲自
验证，策略建议不直接成为事实。

## 一手项目

| 项目 | 公开机制 | 与 MilkSU 的关系 | 决策 |
| --- | --- | --- | --- |
| [NYU D-CIPHER](https://github.com/NYU-LLM-CTF/nyuctf_agents) | Planner 将单一任务委托给临时 Executor；Executor 返回强制摘要；按 Web/Pwn/Rev/Crypto/Forensics/Misc 分 Prompt；可先用 Auto-prompter 探索题目 | MilkSU 已有按题型路由和工具构建者，但缺少独立路线审阅 | 采纳职责分离；不复制其 Python Runtime、Prompt 或 Docker 网络模型 |
| [EnIGMA+ / Cyber-Zero](https://github.com/amazon-science/Cyber-Zero/tree/main/enigma-plus) | 交互式反编译/调试工具；长输出保存原文后摘要；只保留最近观察；统一 Challenge 与轨迹用于多 Benchmark | PI 已有自动 Compaction，MilkSU Evidence 保留完整输出；当前更缺真实平台成功样本 | 保留原文 + 有界 UI 已存在；后续为固定回归集采用统一 Challenge 规范 |
| [CAI](https://github.com/aliasrobotics/cai) | Agent、Tools、Handoffs、Patterns、Turns、Tracing、Guardrails、HITL；专业 Agent 可作为工具或正式移交 | MilkSU 的显式用户控制、执行边界和独立轨迹方向一致 | 采纳显式角色与产物交接；不引入通用 Swarm |
| [HackSynth](https://github.com/aielte-research/HackSynth) | Planner + Summarizer 双模块；PicoCTF/OverTheWire 固定评测集 | 证明规划与观察压缩应和模型能力分开评测 | M6 再建立可复跑基线；不把“Benchmark 能跑”冒充真实平台 MVP |
| [ctf-skills](https://github.com/ljagiello/ctf-skills) | 按题型按需加载的广覆盖 Skill 包和工具前置条件 | MilkSU 当前 playbook 较小，未来需要按题型扩充，但海量技巧不能一次注入上下文 | 采纳“按需加载”结构；真实题失败后再增加最小 Skill，不整体 vendoring |
| [Buttercup](https://github.com/trailofbits/buttercup) | Orchestrator、Seed Generator、Fuzzer、Program Model、Patcher，多 Agent 组件与完整可观测性 | 面向 AIxCC 漏洞发现/修复，不是训练型 CTF 的首要路径 | 仅参考预算、轨迹和组件可观测性；不纳入 CTF MVP |

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
