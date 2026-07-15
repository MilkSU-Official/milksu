# 变更日志

## 2026-07-16

### 将旧理解转成显式纠偏 TODO

- 将 `security-agent-boundary.md` 提升为当前架构目标与最高优先级设计依据；Roadmap 只负责任务排序，旧计划不得覆盖新的能力边界。
- 正式撤销“Prompt Injection / PolicyDecision 是安全 Agent 唯一核心闭环”的旧结论：该演示归入跨领域 Agent Integrity，而不是 Agent for Security 的专属差异化。
- Roadmap 改为双轨最小验证：一条通用 Integrity 演示，加一条由外部 evaluator 判分的 Role Package 闭环。
- 新增 `taskType` 兼容迁移 TODO，将角色、活动与能力从早期扁平枚举拆成正交的 Role/Profile 与 Capability Package。
- 新增包契约 TODO，区分 Role、Capability 与 Infrastructure，并把 outcome、environment、evidence、benchmark 和 integrity requirements 纳入目标契约。
- 将 `.codex/TASKS.md` 标为历史实施快照，防止后续 Agent 按已经过时的 Security Kernel、固定任务类型和面板假设继续开发。

## 2026-07-15

### 工作树审查与实现收口

- 完成中英文界面、运行时语言切换与设置持久化，并补齐开关的可访问名称。
- 子代理改为宿主绑定工具：一次最多 8 个任务、4 个并发，结果同时更新 UI 并返回父代理上下文；子会话不注入递归生成能力。
- Bridge 改用 Pi SDK 公开的 `customTools` 与 `tool_execution_*` 生命周期，避免私有字段和过早完成判定。
- 中继模式改为会话级 `milksu-relay` provider，保留所选模型 ID，避免非 OpenAI 模型在 OpenAI 内置模型表中查找失败。
- 忽略本地 `auth.json` 与 VitePress 缓存；将 CLAUDE.md 收束为规则和文档入口，将旧 DEVELOPMENT_PLAN 明确标记为历史快照。

### 核心架构目标校正

- 将 MilkSU 从“可扩展安全 Agent 平台”重新定义为“用户拥有的安全任务控制面”，把 Pi、Codex、Claude Code 和其他模型作为可替换 Worker。
- 明确 Model-as-Worker、Environment Adapter、Evaluator First、Trace as Data、Recoverable Execution、Role and Capability Packages 和 Evidence Projection 七项核心目标。
- 增加非目标：不复刻通用前沿模型，不把 prompt 循环、多 Agent、checkpoint、模型路由或领域 UI 单独视为竞争优势。
- 将长期价值收束为环境适配器、可靠判分器、真实任务轨迹、执行经济性和用户控制权。
- 新增架构验收门槛：同模型、同工具、同预算下，对比最小 Agent 基线，测量成功率、单位成功成本、误报成功、中断恢复、重复副作用和结果复现率。
- 路线图增加停止条件：如果没有可验证收益或基线无法接入的环境，相关能力应回退为 Skill、MCP 或 benchmark 工具，而不是扩张核心 Harness。

### 安全 Agent 能力边界研究

- 区分两个正交问题：Agent Security 保护 Agent 自身；Agent for Security 使用 Agent 执行红队、蓝队、CTF 和 AppSec 任务。
- 将 prompt injection、工具投毒、沙箱、凭据隔离和供应链安全移入跨领域 Agent Integrity Layer，不再把“所有输入都可能由攻击者控制”当作安全任务 Agent 的统一定义。
- 将单一 Security Kernel 拆成角色包：红队维护 Scope、AttackGraph 和 Effect；蓝队维护 EvidenceGraph、Hypothesis 和 Response；CTF 维护 Snapshot、Experiment 和 Judge；AppSec 维护 PoC、Patch 和 Regression。
- 新增带角色参数的集合模型 `D_r(M) = K_r(M) union O_r`，并将通用完整性基础设施 `G` 视为与安全角色正交的另一条轴。
- 区分三类边际效应：Prompt、固定工作流和泛化角色会被模型替代；通用 Agent Security 保持价值但不是安全任务护城河；角色环境、状态、判分器和真实轨迹与新模型互补。
- 新增二轴分类图和修订后的能力集合图，分别表达“Agent 自身安全”和“角色特定安全闭环”。
- 将研究文档改为面向项目作者的渐进阅读结构：先给人话结论和阅读路线，在复杂术语首次出现时就近解释，并把集合公式移入可跳过的技术附录。
- 新增 Role Package 与 Capability Package 的区分：角色决定目标、状态和判分，Binary、Web、Network、Mobile、Forensics、Fuzzing 等能力包作为跨角色共享工具箱。
- 明确二进制逆向不归 AppSec 独占；它可以服务 Red、CTF、AppSec、Malware Analysis 和 Vulnerability Research，由上层角色决定最终 outcome。
- 在文档站首页首屏增加“先看架构边界”主入口和常驻提醒卡片，并在顶部导航加入架构边界入口，提醒项目作者与后续 Agent 先区分 Agent Security、Role Package 和 Capability Package。

## 2026-07-09

### 计划调整
- **面试冲刺轨道**: 因求职 last day 为 7-31 (约 22 天窗口, 每天约 2 小时可投入), roadmap 新增"面试冲刺轨道", 把本轮唯一目标收束为最小可演示安全闭环 `Prompt Injection -> 危险工具调用 -> PolicyDecision -> 面板显示 -> JSONL trace`。
- **重排优先级**: 承认 07-04 已完成的地基 (E2E、skill 加载、面板数据流、子代理), 明确剩余关键路径只有 policy-engine 升级为 PolicyDecision + 一个攻击样例 + 一条 trace + 一次演示彩排。
- **移出关键路径**: Engagement Memory、Browser CDP 增强、Sub-agents 完整化、沙箱、Auto Mode、上下文管理、Marketplace 一律推迟到面试之后, 避免这 22 天被横向功能拖散。
- Demo-ready 目标定为 7 月中下旬, 赶在面试密集前。

## 2026-07-04

> 历史说明：本节记录当日实现。后续已把私有 `_customTools` 注入迁移到公开 `customTools` 参数，并把子代理完成判定改为 `agent_end`；当前设计以开发者文档为准。

### 缺陷修复
- **Bridge 事件协议**: Pi 的 subscribe 事件是双层结构 (message_update.assistantMessageEvent), bridge.js 之前直接匹配顶层类型导致所有流式事件被丢弃
- **模型名称不匹配**: PROVIDERS 列表使用 deepseek-chat 但 Pi 注册表中是 deepseek-v4-flash, 同步更新全部 5 个供应商的模型 ID
- **工具事件字段名**: Pi 用 toolCall.name/arguments, bridge.js 之前用 toolName/toolInput 导致前端收到 undefined
- **子代理事件订阅**: spawnSubagent() 的 subscribe 没有适配 Pi 嵌套事件结构, 导致子代理永远无法完成

### 新功能
- **技能手动注入**: bridge.js 在 createSession() 后通过 `_customTools.push()` + `_refreshToolRegistry()` 注入 18 个工具
- **Node --experimental-strip-types**: Tauri 启动 bridge.js 时添加 TypeScript 类型剥离标志, 实现 .ts 技能文件直接加载

### 验证
- P0 端到端测试通过: 用户输入 -> bridge -> Pi -> DeepSeek API -> 流式思考 (25 events) + 文本 (3 events) -> message_done
- P1 技能加载: 5 个 skill (18 工具) 成功注入, LLM 调用 panel_update 返回正确结果
- P1 面板数据流: panel_update tool call -> bridge panel_update 事件 -> Tauri panel-update emit (全链路)
- P1 子代理: 2 并发子代理各自独立回答, 7 个流式 delta + 正确最终结果
- 核心代理循环端到端成熟度从 L0 升至 L2, 技能系统从 L1 升至 L2

### 文档
- 全站 26 个文档页面中文化
- CLAUDE.md 精简: 架构和进度内容去重, 统一指向文档站

## 2026-07-03

### 文档
- VitePress 文档站点, 包含 4 个板块 (指南、开发者、用户、进展)
- 20+ 页面, 覆盖架构、模式、模块和对比

## 2026-07-02

### 缺陷修复
- **P1**: 子代理递归保护 -- `:sub:` 检查防止 fork 炸弹
- **P2**: 中继环境变量竞态条件 -- 将设置从逐会话移至 bridge 启动时

### 架构修复
- serde `rename_all = "camelCase"` -- 消除了手动字段映射
- 使用 `Arc<Mutex<...>>` 实现 Bridge 崩溃恢复
- App.tsx 钩子提取: `useConversations` + `useAgentEvents` (394 -> 181 行)
- TaskState 通过 `deriveTaskState()` 从 Engagement 派生
- Bridge 多路复用会话池 (单进程, 按对话隔离会话)

### 新功能
- 中继模式: 全局开关, 通过 OpenAI 兼容的中继服务路由请求
- 国际化: react-i18next, 支持 en/zh, 运行时语言切换
- 子代理: bridge 最多生成 4 个并发 Pi 会话
- 模块成熟度矩阵 (MODULE_STATUS.md)
- 与 Codex 和 Claude Code 的平台对比

### 早期 (2026-07-02 之前)
- Tauri v2 项目脚手架
- Codex 风格 UI, Geist 字体
- Pi 扩展骨架 (skill-loader, skill-router, policy-engine)
- 5 个技能: hello-world, browser-connect, network-recon, panel, subagent
- 流式文本输出管线
- 设置页面 (5 标签页, shadcn/ui)
- 对话持久化
- 任务类型系统, 含 4 个安全面板
