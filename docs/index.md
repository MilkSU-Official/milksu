---
layout: home

hero:
  name: MilkSU
  text: 用户拥有的安全任务控制面
  tagline: 让强模型在真实环境中形成可验证、可恢复、可积累的任务闭环。先分清 Agent 自身安全、任务角色和共享能力，再决定什么应该进入核心。
  actions:
    - theme: brand
      text: 先看架构边界
      link: /developer/security-agent-boundary
    - theme: alt
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 核心架构
      link: /developer/architecture

features:
  - title: 开始前，先提醒自己和 Agent
    details: "先问三件事：Agent 自己怎样保护；这个角色最终怎样才算成功；任务需要哪些共享技术。二进制逆向是能力，不是 AppSec 独占角色。"
    link: /developer/security-agent-boundary
    linkText: 阅读安全 Agent 能力边界
  - title: Model-as-Worker
    details: 将 Pi、Codex、Claude Code 和其他模型作为可替换执行器，不把系统状态绑定在单一模型会话中。
  - title: Environment Adapter
    details: 用标准接口管理靶场、内网、设备、专用工具、快照与清理动作。
  - title: Evaluator First
    details: 通过 flag、PoC、补丁回归、策略和证据判分器验证结果，不接受模型自报成功。
  - title: Trace as Data
    details: 持久化动作、观察、工件、决策和结果，用于回放、审计、评测与持续改进。
  - title: Recoverable Execution
    details: 使用 checkpoint、幂等键和分支状态恢复中断，避免重复有副作用的操作。
  - title: User-owned Control
    details: 用户拥有模型路由、策略边界、凭据引用、证据和运行数据。
---
