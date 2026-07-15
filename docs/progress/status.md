# 项目状态

最后更新: 2026-07-15

## 模块成熟度概览

| 模块 | 代码 | 类型 | 端到端 | 用户体验 | 综合 |
|------|------|------|--------|----------|------|
| 核心代理循环 (Agent Loop) | L2 | L2 | L2 | L2 | **L2** |
| 子代理 (Sub-agents) | L2 | L2 | L2 | L2 | **L2** |
| 安全面板 | L2 | L2 | L2 | L3 | **L2** |
| 任务管理 (Engagement) | L1 | L1 | L0 | L2 | **L1** |
| 设置与供应商 | L2 | L2 | L0 | L3 | **L2** |
| 国际化 (i18n) | L3 | L3 | L3 | L3 | **L3** |
| 技能系统 (Skills) | L2 | L1 | L2 | -- | **L2** |
| UI 外壳 | L2 | L2 | L0 | L3 | **L2** |

详细的子模块分解请参见[模块状态 (详细)](/developer/module-status)。

## 完成度清单

### 已完成

- [x] Tauri v2 项目脚手架 (React + Rust + Vite)
- [x] Codex 风格 UI: 居中欢迎页、侧边栏、聊天视图
- [x] 浅色/白色主题, Geist 字体
- [x] 自定义应用图标
- [x] 前后端 IPC: invoke + 事件通道
- [x] Tauri v2 能力/权限配置
- [x] Pi 扩展骨架: skill-loader, skill-router, policy-engine
- [x] 5 个技能: hello-world, browser-connect, network-recon, panel, subagent
- [x] Bridge.js: 多路复用会话池, stdio JSON lines
- [x] 流式文本输出: text_delta 事件 -> 增量渲染
- [x] 设置页面: 5 标签页布局, 使用 shadcn/ui
- [x] 模型选择器: 按供应商分组的下拉菜单
- [x] 对话持久化: 自动保存为 JSON 文件
- [x] 侧边栏搜索与删除
- [x] 工具结果渲染: 可折叠卡片, 带状态指示
- [x] 用量统计面板
- [x] 浏览器预览回退 (localStorage 桩)
- [x] shadcn/ui 迁移: Button, Card, Switch, Input, Badge, Separator, Label
- [x] 任务类型系统: 按对话划分 (chat/pentest/ctf/recon/reverse)
- [x] 安全面板: pentest (阶段、漏洞、端口), CTF (flag), recon (主机、服务), reverse (保护机制、函数)
- [x] 面板覆盖布局
- [x] serde rename_all camelCase
- [x] Bridge 崩溃恢复
- [x] Hook 提取: useConversations + useAgentEvents
- [x] TaskState 从 Engagement 派生
- [x] Bridge 多路复用会话池
- [x] 中继模式 (Relay)
- [x] 国际化: react-i18next (en/zh)
- [x] 子代理: 工具即触发器模式, 最多 4 个并发, 流式结果卡片
- [x] P1 修复: 子代理递归保护
- [x] P2 修复: 中继环境变量竞态条件
- [x] 模块成熟度矩阵
- [x] 顶级平台对比 (Codex + Claude Code)
- [x] 文档站点 (VitePress)
- [x] 文档站全站中文化
- [x] P0: 模型名称不匹配修复 (deepseek-v4-flash vs deepseek-chat)
- [x] P0: Bridge 事件协议修复 (Pi 嵌套事件结构 message_update.assistantMessageEvent)
- [x] P0: 端到端测试通过 (DeepSeek deepseek-v4-flash, 流式思考 + 文本)
- [x] P1: 技能加载端到端 -- 18 工具 (5 skill) 通过 _customTools 注入 Pi session
- [x] P1: 面板数据流 -- panel_update 从 LLM tool call 到 bridge event 到 Tauri emit 全链路验证
- [x] P1: 子代理端到端 -- 2 并发子代理, 流式 delta, 正确返回结果
- [x] P1: bridge 事件字段名修复 (toolCall.name/arguments vs toolName/toolInput)
- [x] P1: 子代理事件订阅适配 Pi 嵌套事件结构

### 进行中

(无)

### 计划中

| 优先级 | 事项 |
|--------|------|
| P0 | 固定安全任务 benchmark 与最小 Agent 基线 |
| P0 | Evaluator 接口与版本化判定结果 |
| P0 | Trace 数据模型 (Run 到 Outcome) |
| P1 | Environment Adapter 生命周期协议 |
| P1 | PolicyDecision 演示闭环 |
| P1 | checkpoint、幂等键与恢复语义 |
| P1 | 面板/报告改为 Evidence 投影视图 |
| P2 | 沙箱与完整策略引擎 |
| P2 | 上下文、预算和执行成本管理 |
| P3 | /goal (长时间自主任务) |
| P3 | /fork (对话分支) |
| P3 | 视觉循环 (browser_vision_act) |
| P3 | 导出 (对话历史、扫描报告) |
| P3 | CI/无头模式 |
