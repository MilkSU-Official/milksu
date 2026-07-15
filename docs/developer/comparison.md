# 平台对比

MilkSU 与 Codex (OpenAI) 及 Claude Code (Anthropic) 的对比，截至 2026-07。

这份对比区分三类概念：

1. **模型能力**：底层模型完成安全任务的推理能力。
2. **平台功能**：UI、路由、checkpoint、子代理等可被多个平台实现的能力。
3. **任务资产**：环境、判分器、真实轨迹和执行规模，是 MilkSU 需要长期积累的核心价值。

功能数量不能代替任务结果。MilkSU 不以复刻 Codex 或 Claude Code 的全部功能为目标，也不因为某项 UI 或编排功能暂时独有就把它称为护城河。

## 平台概览

| | MilkSU | Codex CLI (OSS) | Claude Code |
|---|---|---|---|
| 语言 | TypeScript + Rust | Rust (94.9%) + TypeScript | TypeScript |
| 运行时 | Node.js (bridge) + Tauri | 原生二进制 (codex-rs) | Bun（原生二进制） |
| 界面 | React (Tauri webview) | React + Ink（终端） | React + Ink（终端） |
| 代码行数 | ~4,500 | ~120 crates | ~64,000（有效代码） |
| 许可证 | MIT | Apache 2.0 | 专有 |

## 代理循环

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 架构 | Pi 会话 + 桥接 IPC | 单进程 OpenAI SDK | AsyncGenerator yield |
| API | Pi SDK（多供应商） | OpenAI Responses API | Claude Messages API |
| 状态 | 会话池（按对话分配） | 无状态（每次传入完整历史） | 仅追加消息数组 |
| 会话持久化 | JSON 文件 | JSONL rollout 文件 | JSONL 文件 |
| 上下文管理 | 无（由 Pi 处理） | `approximate-tokens-used.ts` + `/responses/compact` | 5 阶段压缩管线 |

## 工具系统

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 内置工具 | 0（基于技能） | 2 (shell, apply_patch) | 43 |
| 插件工具 | Pi 技能 (SKILL.md) | Skills 市场 (90+) | MCP 服务 |
| 工具执行 | Pi 沙箱 | 操作系统级沙箱 (seatbelt/seccomp) | StreamingToolExecutor |
| 并行执行 | 顺序执行 | 顺序执行 | 只读并行，写入顺序 |

## 权限与安全

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 权限模型 | 无（计划中） | 3 级 (suggest/auto-edit/full-auto) | 7 层默认拒绝 |
| 自动模式 | 计划中 | 权限配置文件 | ML 分类器（0.4% 误报率） |
| 沙箱 | 无 | 操作系统级 (seatbelt, Landlock+seccomp) | 进程级 |
| 策略钩子 | 仅有桩代码 | PostToolUse | 28 种事件类型 (Pre/Post/Stop/Notification) |

## 子代理

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 最大并发数 | 4 | 6（可配置） | 每个工作流 16 |
| 最大深度 | 1 | 1（可配置） | 5 层 |
| 编排方式 | 工具即触发器 | Symphony SPEC.md | Workflow JS 脚本 |
| 单次运行最大代理数 | 4 | ~6 | 1000 |
| 代理角色 | 统一 | 3 个内置 + 自定义 TOML | 5 个内置 + 自定义 |

## 扩展系统

| | MilkSU | Codex CLI | Claude Code |
|---|---|---|---|
| 插件格式 | Pi 扩展 (TypeScript) | Skills + Plugins 市场 | MCP 服务 |
| 发现方式 | SKILL.md 扫描 | Skills 市场 UI | MCP 注册中心 |
| 项目规则 | SKILL.md | AGENTS.md（4 级层次结构） | CLAUDE.md（4 级层次结构） |
| 上下文预算 | 匹配时加载完整 SKILL.md | 2% 上限，命中时加载 | 按目录惰性加载 |

## 桌面应用

| | MilkSU | Codex Desktop | Claude Code |
|---|---|---|---|
| 框架 | Tauri v2 | Electron | 仅 CLI（无桌面应用） |
| 二进制大小 | ~10 MB | ~150 MB | ~50 MB (CLI 二进制) |
| 内存 | ~30 MB | ~150 MB | 可变 |
| 国际化 | en/zh（运行时切换） | 基础设施存在，功能标志关闭 | 无 |
| 多供应商 | 5 + 中继 | OpenAI/Azure/Ollama/Groq/LMStudio | 以 Anthropic 为主 |

## 当前产品特征

以下特征可以改善使用体验或工程质量，但不自动构成长期优势：

1. **安全面板**：渗透测试、CTF、侦察和逆向的结构化任务视图。
2. **任务管理**：带时间线的安全 Engagement。
3. **工具即触发器模式**：把 LLM 内容与宿主级副作用分离。
4. **Tauri v2**：轻量桌面宿主与原生 Rust 后端。
5. **实时国际化**：运行时中英文切换。
6. **多供应商与中继**：允许用户选择模型和网络路径。

这些能力可以是购买理由，但也可能被 Codex、Claude Code、MCP 或用户脚本复制。架构评审中应称其为“产品特征”，不能直接称为“安全 Harness 的竞争优势”。

## 目标差异化

| 目标资产 | MilkSU 需要拥有的内容 | 为什么不是普通套壳 |
|----------|----------------------|--------------------|
| 环境适配器 | 长期靶场、内网、设备、Burp、Ghidra、扫描器、快照和清理协议 | 统一管理真实资源生命周期，而不只是暴露一个工具 |
| 判分器 | flag、PoC、补丁回归、策略命中、证据完整性 | 独立验证模型结论，形成可靠 outcome |
| 轨迹数据 | action、observation、artifact、decision、evaluation、成本与失败原因 | 支持可复现评测和持续改进 |
| 可恢复执行 | checkpoint、幂等键、分支状态、错误隔离 | 长期任务中断后继续，避免重复副作用 |
| 执行经济性 | 并行尝试、缓存、模型分工、预算和资源调度 | 在相同模型下提高单位成本的有效成功次数 |
| 用户控制面 | 用户拥有策略、模型路由、凭据引用、证据和数据 | 不被单一模型供应商的会话和产品边界绑定 |

### 不成立的情况

如果任务是一次性的，普通 MCP 已能接入环境，没有可靠 evaluator，也没有固定任务集用于对照，那么直接使用 Codex 或 Claude Code 通常更合理。MilkSU 不应通过堆叠多 Agent、prompt 或 UI 来掩盖这一点。

## 关键差距

| 差距 | 影响 | 优先级 |
|------|------|--------|
| 无固定安全任务 benchmark | 无法证明控制面优于最小 Agent 基线 | P0 |
| 无统一 evaluator 接口 | 模型可能自行宣布成功，结果不可比较 | P0 |
| Trace 尚未成为规范化数据模型 | 运行难以回放、审计和形成反馈闭环 | P0 |
| Environment Adapter 未定义 | Skill 容易退化为 prompt 加工具列表 | P1 |
| 无沙箱和完整策略引擎 | 高副作用工具缺少可靠边界 | P1 |
| 恢复语义与幂等协议不完整 | 中断后可能重放副作用 | P1 |
| 无 CI/无头模式 | 无法批量评测和规模化运行 | P2 |
| 无上下文与预算管理 | 无法稳定比较成本和长任务表现 | P2 |
