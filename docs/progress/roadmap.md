# 路线图

> 本文只负责把[安全 Agent 与通用 Agent 的能力边界](/developer/security-agent-boundary)转成阶段任务。能力边界文档是当前架构目标；本文与它冲突时，应修改 Roadmap，而不是恢复旧主线。

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

### 架构纠偏 TODO（2026-07-16，优先于旧冲刺计划）

> 2026-07-09 的计划把“防御 Prompt Injection 的 PolicyDecision 演示”当成了安全 Agent 的唯一核心闭环。这个理解不够准确：它证明的是 **Agent Security / Integrity**，即任何会读取外部内容并调用高权限工具的 Agent 都需要的通用防护；它不能单独证明 MilkSU 在“用 Agent 做安全任务”上的差异化。下面的 TODO 是对旧计划的正式修正，后续 Agent 不得继续把旧结论当作架构前提。

- [ ] **把 Integrity 演示重新归位**：保留 `Prompt Injection -> PolicyDecision -> Trace`，但明确标为跨领域完整性基础设施演示；不要再把拦截记录硬塞进 recon/pentest 角色面板，而应投影到通用运行/策略事件视图。
- [ ] **补一个角色特定的最小闭环**：在 CTF `Experiment -> Judge -> Flag` 与 AppSec `PoC -> Patch -> Regression` 中选择一个作为首个 Role Package 演示。成功必须由外部 evaluator 判定，并保留 artifact 与可重放 trace。
- [ ] **拆开当前 `taskType`**：把现有 `chat/pentest/ctf/recon/reverse` 明确为兼容旧数据的 UI/工作区 profile，不再视为完整领域模型；设计正交的 `Role/Profile` 与 `Capability Package`，其中 Binary、Web、Network、Mobile、Forensics、Fuzzing 是能力，不被某个角色独占。
- [ ] **升级包契约**：为模块增加 `role / capability / infrastructure` 分类，或拆成独立 manifest。Role 至少声明 outcome、environment、actions、evaluator、evidence schema、benchmark 与 integrity requirements；Capability 声明工具、环境依赖、副作用和清理语义。
- [ ] **拆分 benchmark**：分别测量 Worker 通用能力、Integrity 防护收益和 Role 闭环收益，不再把 prompt injection、CTF flag 与 PoC 回归混成一个无法解释的总分。
- [ ] **清理会误导 Agent 的旧计划**：`.codex/TASKS.md` 和 `DEVELOPMENT_PLAN.md` 只保留为历史快照；`docs-legacy/` 若要入库必须进入 archive 并标明 superseded，过时的根目录 `MODULE_STATUS.md` 不作为当前文档来源。

完成标准：新人或 Agent 只阅读 README、本文和架构边界文档时，能够清楚回答三件事——“Agent 自己如何不被攻击”“这个安全角色怎样才算赢”“它使用哪些跨角色能力”，且不会把三者合并成一个 Security Kernel。

### 已就位的地基 (截至 2026-07-04, 见 status.md)

演示需要的下层链路其实已经通了, 不要重复做:

- 模型名不一致已修复; 核心 loop E2E 已跑通 (DeepSeek, 流式思考 + 文本)。
- 5 个 skill / 18 工具已注入 Pi session; skill 加载 E2E 通过。
- 面板数据流全链路已验证 (`panel_update` tool call -> bridge event -> Tauri emit -> TaskPanel)。
- 子代理宿主执行路径已实现；新路径仍需使用真实模型确认结果能稳定返回父代理上下文。

这些地基足以继续做 Integrity 演示，但不能推出“安全任务闭环只差一层”。Role Package 仍缺少明确的环境、角色状态、外部 evaluator 和证据契约，必须按架构纠偏 TODO 另行补齐。

### 旧冲刺切片：PolicyDecision（保留，但不再是唯一架构目标）

`Prompt Injection -> 危险工具调用 -> PolicyDecision -> 面板显示 -> JSONL trace`

这条链仍适合作为工程演示，但它属于上面 TODO 中的 Integrity 轨道。面试演示应把它与一个 Role Package 的可判分闭环并列介绍，不能再用它代替“安全任务 Agent 的差异化”。

按依赖顺序, 做完即收手, 不横向扩张:

1. **policy-engine 从 stub 升级为风险决策** (核心): 给 `check()` 增加工具风险分级 (`read_only / network / file_read / file_write / shell / credential`), 输出结构化 `PolicyDecision { tool, args, risk, decision(allow|deny|require_approval), reason, evidence, trace_id }`。接入点 (`src/index.ts` 的 `tool_call` 钩子) 已存在, 这是增量改造不是从零。
2. **一个可复现攻击样例**: agent 浏览一个恶意网页, 网页诱导它读本地 secret 或调用高危工具; policy 判 `deny` 或 `require_approval`。放到 `skills/agent-security/attacks/` 下。
3. **一条 JSONL trace + 通用策略视图显示一次拦截**: 把这次 PolicyDecision 写入 trace，并投影到通用运行/策略事件视图；不得把 Agent 自身完整性事件伪装成 recon/pentest 的角色任务状态。
4. **一次端到端演示彩排**: 从恶意网页到面板拦截记录完整跑一遍, 确认可现场复现、可讲清每一步。

### 节奏

- Integrity 轨道是现有实现上的增量；真正的新设计工作是首个 Role Package 的环境、判分和证据闭环。
- Demo-ready 目标: **7 月中下旬**。面试 pitch 应同时展示“危险工具调用被拦截并留证”和“一个安全角色的结果由外部 evaluator 判定”，并能解释两者为什么是正交能力。
- 演示彩排要真跑, 不要只在脑子里过。面试现场最怕临时环境问题。

### 双轨演示后的第一项架构验证

完成 Integrity 与首个 Role Package 演示后，不立即扩张功能。先建立三个可分开解释的最小 benchmark 套件：

1. **Worker 基线**：测通用规划、编码、工具使用和领域推理，确认收益是否其实来自更强模型。
2. **Integrity 套件**：测 prompt injection、越权工具调用和数据外传的阻断与误报，不混入安全角色成败。
3. **Role 套件**：单独测 CTF flag、AppSec PoC/补丁回归等由角色 evaluator 判定的 outcome。
4. 每个套件都用相同模型、工具和预算比较最小 Pi Agent、成熟通用 Agent 与 MilkSU，记录 `success@1`、`success@N`、单次成功成本、完成时间、误报成功率、中断恢复率、重复副作用和结果复现率。
5. 只有当某一层产生可重复的指标提升，或接入基线无法使用的环境时，才继续扩展对应模块；不得用 Integrity 的成绩替 Role Package 证明差异化，反之亦然。

停止条件：如果 MilkSU 只是让同一个模型多跑几次，却没有更好的 evaluator、环境资产或执行经济性，就回退为 Skill / benchmark 工具，不继续重造通用 Agent。

### 面试后再做 (明确移出关键路径)

下面这些是平台完备性, 不是面试演示必需, 一律推迟到面试尘埃落定之后, 避免这 22 天被横向功能拖散:

- Engagement Memory (原 S1)
- Browser CDP 增强 (原 S4)
- Sub-agents 完整化 (原 S5)
- 沙箱、Auto Mode、上下文管理 (原 P2)
- Marketplace、CI 模式、代理角色 (原 P3)

> 判断标准：短期工作必须让 Integrity 演示或首个 Role Package 闭环更可信、更可判定、更可复现；不能只增加界面或通用 Agent 功能。

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
