# 模块状态

各模块详细成熟度评估。概览请参见[进度状态](/progress/status)。

::: tip 成熟度等级
- **L0 桩代码**: 仅有代码骨架，无实际逻辑
- **L1 已编码**: 逻辑已实现，未经测试
- **L2 已验证**: 通过语法/类型检查，基本冒烟测试
- **L3 端到端**: 使用真实数据完成端到端测试
- **L4 生产就绪**: 具备完善的错误处理，可用于生产环境
:::

## 核心代理循环

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 桥接进程管理 | lib.rs | ~80 | L2 | Arc Mutex 崩溃恢复，bridge-error 事件 |
| 会话池 | bridge.js | ~100 | L2 | 按对话分配 Pi 会话，提示队列 |
| 流式管线 | bridge.js -> lib.rs -> useAgentEvents | ~200 | L2 | 10 种事件类型，text_delta 累积 |
| 模型选择 | bridge.js | ~30 | L1 | Pi modelRegistry.find() |
| 中继模式 | bridge.js + settings.rs + SettingsPage | ~80 | L1 | 会话级临时 provider，已验证会话创建，未验证真实中继请求 |

**风险**: 以上所有模块均未对接真实 LLM API 运行。一次端到端测试即可验证或暴露整条链路的问题。

## 子代理

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 生成逻辑 | bridge.js | ~140 | L1 | 每次最多 8 个任务、4 个并发，Promise.allSettled；待真实模型回归 |
| 递归边界 | bridge.js | ~5 | L2 | 子会话不注入 spawn_subagents 工具 |
| Rust 事件转发 | lib.rs | ~60 | L2 | 5 种事件类型 |
| 前端渲染 | useAgentEvents + ChatView | ~120 | L2 | 可折叠卡片，按代理显示结果 |
| Pi 技能 | skills/subagent/ | ~30 | L1 | 桥接层为父会话绑定宿主执行器 |

## 安全面板

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 渗透测试面板 | TaskPanel.tsx | ~80 | L2 | 6 阶段追踪器，漏洞/端口表 |
| CTF 面板 | TaskPanel.tsx | ~60 | L2 | Flag 列表，已解决标记 |
| 侦察面板 | TaskPanel.tsx | ~70 | L2 | 主机、服务、发现 |
| 逆向面板 | TaskPanel.tsx | ~80 | L2 | 保护标记，函数表 |
| 面板覆盖层 | ChatView.tsx | ~10 | L3 | position:absolute，已验证 |
| panel_update 工具 | skills/panel/ + bridge.js | ~30 | L2 | 工具即触发器 |

## 任务管理

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| Rust CRUD | engagement.rs | ~150 | L1 | 基于文件的 JSON 持久化 |
| 任务选择器 | EngagementSelector.tsx | ~100 | L2 | 选择器 + 创建对话框 |
| 派生状态 | useDerivedState.ts | ~80 | L1 | deriveTaskState() |

## 设置与供应商

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 设置页面 | SettingsPage.tsx | ~635 | L2 | 5 个标签页：通用、API 密钥、中继、用量、关于 |
| 设置持久化 | settings.rs | ~120 | L2 | JSON 文件 + Tauri 状态 |
| 供应商/模型配置 | types.ts (PROVIDERS) | ~100 | L2 | 5 个供应商，按供应商分列模型列表 |
| 浏览器桩 | tauri.ts | ~262 | L2 | 开发用 localStorage 后备 |

## 国际化

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 翻译文件 | i18n/en.json, i18n/zh.json | ~472 | L3 | 各 236 个键 |
| 初始化配置 | i18n/index.ts | ~20 | L3 | react-i18next, fallbackLng='en' |
| 语言选择器 | SettingsPage.tsx | 内联 | L3 | 通用标签页中的下拉菜单 |

## 技能系统

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 技能加载器 | src/skill-loader.ts | ~120 | L1 | SKILL.md 解析，工具发现 |
| 技能路由器 | src/skill-router.ts | ~80 | L1 | 路由提示，关键词匹配 |
| 策略引擎 | src/policy-engine.ts | ~50 | L0 | 仅有桩代码 |
| Hello World | skills/hello-world/ | ~30 | L1 | 演示模板 |
| 浏览器连接 | skills/browser-connect/ | ~200 | L1 | 6 个浏览器自动化工具 |
| 网络侦察 | skills/network-recon/ | ~100 | L1 | nmap、报告、目标管理 |

## UI 外壳

| 子模块 | 文件 | 代码行数 | 等级 | 备注 |
|--------|------|----------|------|------|
| 应用布局 | App.tsx | ~215 | L2 | 侧边栏 + 内容区 + 设置路由 |
| 侧边栏 | Sidebar.tsx | ~150 | L2 | 搜索、任务图标、删除 |
| 聊天视图 | ChatView.tsx | ~345 | L2 | 欢迎页、流式输出、工具卡片 |
| 输出面板 | OutputPanel.tsx | ~80 | L2 | 工具输出侧面板 |
| 模型选择器 | ModelSelector.tsx | ~60 | L2 | 输入栏下拉菜单 |
| shadcn/ui | components/ui/ | ~300 | L3 | Button, Card, Switch, Input, Badge 等 |
