# 路线图

## 面试冲刺轨道 (2026-07, 最高优先)

背景: 求职 last day 为 2026-07-31, 约 22 天窗口。在职交接期每天约 2 小时可投入开发, 其余时间用于面试准备。这段时间 MilkSU 的目标不是把平台做全, 而是产出一个**能在面试现场演示、能讲清取舍**的安全切片。功能数量不是目标, 一个跑得通的闭环才是。

### 架构护栏

从 2026-07-15 起，MilkSU 不再把“比 Codex/Claude Code 多一个功能”视为架构目标。所有核心工作必须至少满足一项：

- 接入最小 Agent 基线无法稳定使用的真实环境或专用工具。
- 引入独立于模型自评的 evaluator。
- 产出可复现、可比较的 trace 与 artifact。
- 显著改善成功率、单位成功成本、恢复率或副作用控制。
- 让模型、策略、证据和运行数据真正由用户拥有。

checkpoint、多 Agent、模型路由、领域 UI 和 prompt 循环本身只属于工程能力。若没有真实任务资产和量化收益，应实现为外围 Skill、MCP 或实验，不进入核心。

### 已就位的地基 (截至 2026-07-04, 见 status.md)

演示需要的下层链路其实已经通了, 不要重复做:

- 模型名不一致已修复; 核心 loop E2E 已跑通 (DeepSeek, 流式思考 + 文本)。
- 5 个 skill / 18 工具已注入 Pi session; skill 加载 E2E 通过。
- 面板数据流全链路已验证 (`panel_update` tool call -> bridge event -> Tauri emit -> TaskPanel)。
- 子代理 E2E 通过。

也就是说, 距离"可演示安全闭环"只差**策略判定与证据这一层**, 而不是整条链。

### 唯一冲刺目标: 补上 PolicyDecision 这一层

`Prompt Injection -> 危险工具调用 -> PolicyDecision -> 面板显示 -> JSONL trace`

按依赖顺序, 做完即收手, 不横向扩张:

1. **policy-engine 从 stub 升级为风险决策** (核心): 给 `check()` 增加工具风险分级 (`read_only / network / file_read / file_write / shell / credential`), 输出结构化 `PolicyDecision { tool, args, risk, decision(allow|deny|require_approval), reason, evidence, trace_id }`。接入点 (`src/index.ts` 的 `tool_call` 钩子) 已存在, 这是增量改造不是从零。
2. **一个可复现攻击样例**: agent 浏览一个恶意网页, 网页诱导它读本地 secret 或调用高危工具; policy 判 `deny` 或 `require_approval`。放到 `skills/agent-security/attacks/` 下。
3. **一条 JSONL trace + 面板显示一次拦截**: 把这次 PolicyDecision 写入 trace, 并复用已验证的 `panel_update` 管道, 在 recon/pentest 面板显示一条真实的 blocked 记录。
4. **一次端到端演示彩排**: 从恶意网页到面板拦截记录完整跑一遍, 确认可现场复现、可讲清每一步。

### 节奏

- 只差一层, 加上 AI 辅助, 实现量不大; 真正花时间的是设计风险分级、造攻击样例和把演示打磨顺。
- Demo-ready 目标: **7 月中下旬**, 赶在面试循环密集之前就绪。就绪后, 面试 pitch 从"还早"升级为"可现场演示一次危险工具调用被拦截并留证"。
- 演示彩排要真跑, 不要只在脑子里过。面试现场最怕临时环境问题。

### 演示后的第一项架构验证

完成 PolicyDecision 演示后，不立即扩张功能。先建立一个最小 benchmark：

1. 选择可机器判定结果的窄任务集，例如 prompt injection 策略判定、CTF flag 或 PoC/补丁回归。
2. 基线 A 使用相同模型、相同工具和相同预算的最小 Pi Agent，不启用 MilkSU 领域控制面。
3. 基线 B 使用固定预算运行 Codex 或 Claude Code，作为成熟通用 Agent 的外部参照。
4. MilkSU 运行同一任务集，记录 `success@1`、`success@N`、单次成功成本、完成时间、误报成功率、中断恢复率、重复副作用和结果复现率。
5. 只有当控制面产生可重复的指标提升，或完成基线无法接入的环境任务时，才继续扩展对应核心模块。

停止条件：如果 MilkSU 只是让同一个模型多跑几次，却没有更好的 evaluator、环境资产或执行经济性，就回退为 Skill / benchmark 工具，不继续重造通用 Agent。

### 面试后再做 (明确移出关键路径)

下面这些是平台完备性, 不是面试演示必需, 一律推迟到面试尘埃落定之后, 避免这 22 天被横向功能拖散:

- Engagement Memory (原 S1)
- Browser CDP 增强 (原 S4)
- Sub-agents 完整化 (原 S5)
- 沙箱、Auto Mode、上下文管理 (原 P2)
- Marketplace、CI 模式、代理角色 (原 P3)

> 判断标准: 如果一个任务不能让"面试现场演示的那次拦截"更可信或更顺, 这 22 天就先不做。

## 优先级矩阵

### P0 -- 验证核心 (阻塞一切)

- **固定任务 benchmark**: 建立最小 Agent、成熟通用 Agent 与 MilkSU 的可重复对照，验证控制面是否真实改善结果。
- **Evaluator 接口**: 统一 evaluator 输入、证据引用、判定结果和版本，使任务成功独立于模型自评。
- **Trace 数据模型**: 规范 Run、Step、ToolResult、Artifact、PolicyDecision、Evaluation 和 Outcome。

### P1 -- 补齐模块缺口

- **Environment Adapter 协议**: 定义目标、资源、工具、凭据引用、快照、重置和清理生命周期。
- **恢复与幂等**: 工具结果先落盘，checkpoint 后续跑；有副作用动作带幂等键和清理信息。
- **证据投影**: 面板与报告只消费 Trace / Artifact / Evaluation，不把聊天文本当作事实来源。

### P2 -- 基础设施加固

- **策略引擎 (Policy Engine)**: 实现 `policy-engine.ts`, 包含真实的 PreToolUse/Stop/Notification 钩子。目标: 至少达到 Codex 的三层模型。
- **自动模式 (Auto Mode)**: 为安全工具构建权限分类器。参考: Claude Code 的两阶段 ML 分类器 (假阳性率 8.5% -> 0.4%)。
- **上下文管理**: token 跟踪 + 自动压缩。参考: Codex 的 `approximate-tokens-used.ts`。
- **沙箱 (Sandbox)**: 操作系统级别的工具执行沙箱。参考: Codex 的 Seatbelt/Landlock 方案。

### P3 -- 功能扩展

- **/goal**: 长时间自主安全扫描 (类似 Codex 的 `/goal` 命令)
- **/fork**: 对话分支, 用于攻击路径探索
- **视觉循环**: `browser_vision_act` 工具, 使用视觉语言模型实现浏览器自动化
- **导出**: 对话历史和扫描报告生成
- **代理角色**: 专用子代理角色 (扫描器、分析器、利用器)
- **CI 模式**: 用于自动化流水线的无头运行
- **暗色模式**: 设置中的主题切换

## 核心任务闭环差距

| 目标 | 当前状态 | 下一验收门槛 |
|------|----------|--------------|
| Agent Loop | 真实 API 手工 E2E 已通过 | 固定任务集自动回归，不再只验证“能回复” |
| Environment Adapter | 工具按 Skill 零散接入 | 定义资源生命周期、快照、重置和清理协议 |
| Evaluator | 无统一接口 | 至少一个任务由外部判分器产生版本化 Outcome |
| Trace as Data | 事件与对话可持久化，但缺少统一 Run 模型 | 从 ToolCall 到 Evaluation 全链路可回放 |
| Recoverable Execution | 会话池支持多会话，恢复语义不完整 | 注入超时后从 checkpoint 续跑且不重复副作用 |
| Evidence Projection | 面板可接收结构化更新 | 每个关键结论可回溯到 Artifact 或 Evaluation |
| Policy / Sandbox | policy-engine 仍为 stub，无完整沙箱 | PolicyDecision 演示闭环并保留证据 |
| Execution Economics | 无统一预算和成本指标 | 同任务基线对照，记录单次成功成本与时间 |
