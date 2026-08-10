# Browser 三面与 Coding → Security 能力迁移

> 状态：Superseded on 2026-08-10
>
> 日期：2026-08-09
>
> 后继：[Electron/Chromium 桌面壳与内置浏览器](./2026-08-10-electron-chromium-desktop-shell.md)。
> 本文保留当时“先在 Wails 中验证 CEF”的决策背景，不再描述当前实现或任务。

## 背景

MilkSU 同时需要可重置的研究浏览器、复用用户登录态的真实浏览器，以及没有浏览器 API 的原生
App 控制。把三者塞进一个“Browser/Computer Use”面板会导致 Scope 含义漂移，也会诱使产品自建
一套通用浏览器 Harness。

Coding Agent 社区的价值不只在代码生成。它已经验证了 workspace、tool loop、上下文压缩、
Plan/Execute/Review、Diff、测试、恢复与人工授权等工程机制。MilkSU 要复用这些通用机制，同时把
Challenge/Evidence/Judge、漏洞研究事实和安全验证工作流继续沉淀在自己的领域层。

## 决策

### 1. 沙箱浏览器

右栏手动入口只表示 MilkSU 管理的会话隔离浏览器：独立 profile、独立状态、Agent 与用户共用同一
页面会话。当前实现是独立 Chrome + CDP/Playwright，已经能做 Agent E2E，但不是内嵌 Chromium。

下一纵切以 [CEF 官方用法](https://chromiumembedded.github.io/cef/general_usage.html) 和
[cef-project 官方示例](https://github.com/chromiumembedded/cef-project) 为上游基线，先验证 macOS
ARM64 的原生 View、helper/framework/resources、签名与 Wails 适配。不会用截图坐标层、iframe 或
外部 Chrome 窗口冒充内嵌完成；也不采用长期未维护、停留在旧 Go/Chromium 版本的 `cef2go`。

### 2. `/browser-use`

真实用户浏览器直接复用仓库已固定的 `@playwright/mcp` extension mode。Playwright 官方说明该模式
用于连接既有标签页并复用当前 profile 状态，首次连接由用户选择具体标签页：
[Playwright MCP](https://github.com/microsoft/playwright-mcp)、
[Playwright Chrome Extension](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)。

MilkSU 负责：

- Composer 中可删除的 `/browser-use` 授权状态；
- 只在当前回合加载固定上游 MCP；
- 项目权限、工具审批、证据路径和语言稳定；
- 明确禁止自动降级到沙箱浏览器或 Computer Use。

MilkSU 不再为这个通用用途扩写自己的浏览器控制协议。

### 3. CTF/CVE 领域浏览器能力

“不重造通用协议”不等于“不发展自己的扩展”。MilkSU 的 NSSCTF/CTFshow 扩展继续负责登录态下的
题面、附件、平台目录和独立 Judge 回执。未来 CVE/CTF 可在 Playwright/Chromium 的通用 click、DOM、
network、screenshot 之上实现自己的授权边界测试、证据采集、复现 Receipt 和学习事实；这些领域
能力不能上推给通用 MCP，也不能用页面文本代替 Judge。

### 4. `/computer-use`

Computer Use 只接受非浏览器原生 App 的 App/PID/Window Scope。浏览器由 Playwright 的结构化 DOM/
accessibility 工具负责；视觉坐标控制只留给缺少更成熟接口的原生 GUI。

### 5. Composer 能力与授权

Slash 命令与“+”菜单修改同一输入/会话状态，不直接发送。“+”统一展示附件、Goal、Plan、沙箱
浏览器、Browser Use、Computer Use、已审核 Pi Skills 和项目 MCP；未选择 Plan 时默认就是 Go，
不提供 `/go`。沙箱浏览器/MCP 只打开现有管理面；Browser/Computer Scope 和 Skill 插在用户文字中，
可点击移除，也会在 Backspace/Delete 或覆盖删除后从结构化状态清除。Skill 发送时复用 Pi 原生
`/skill:name`，MilkSU 不建立第二套 Skill 执行器。发送前由 Runtime 校验能力和准确 Scope，不能只给
模型拼一段“已经授权”的自然语言。

### 6. MilkSU Beta 自举

自举只面向开发者。稳定版从源码构建另一份 `MilkSU Beta`，Beta 使用不同产品名、图标标记、Bundle
ID、数据目录与 TCC 身份。稳定版通过 Computer Use 操作 Beta 完成 UI 验收；两份 App 不共享数据、
权限或进程身份，也不让 App 控制自己。

## Coding → CTF/CVE 迁移准则

| Coding 已验证机制 | CTF/CVE 领域落点 |
| --- | --- |
| worktree / workspace | 题目尝试、漏洞复现环境与失败实验隔离 |
| Plan → Execute → Review | 假设 → 验证 → Judge/Receipt |
| Diff / test evidence | Exploit/配置差异、运行证据与复现 Receipt |
| Browser Scope | 靶场页面、登录边界、网络/Console 证据 |
| recovery / compaction | 长任务恢复且不改变 Challenge/CVE 事实 |
| human approval | 付费、外部账号、目标扩大、提交与披露闸门 |

采用顺序保持：成熟平台/Pi → 固定 Skill/MCP/插件/CLI → 许可证兼容的最小上游机制 → 最小自有实现。
领域事实、Judge 和学习归因始终由 MilkSU 持有。

安全工具 MCP 按同一迁移门槛处理：IDA Pro/idalib、Burp、radare2、Ghidra 和 Semgrep 先在 Coding
使用固定版本与最小工具面完成一项真实任务和一项越权拒绝，再决定是否进入 CTF/CVE。连接成功、
工具可见或模型生成报告都不能替代 Challenge、Evidence、Finding、Reproduction 或 Judge Receipt。
