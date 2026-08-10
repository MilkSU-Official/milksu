# Electron/Chromium 桌面壳与内置浏览器

> 状态：Accepted / implemented for macOS ARM64 vertical slice
>
> 日期：2026-08-10

## 背景

MilkSU 的 Coding 工作台已经同时需要聊天、右栏页面、终端 Bottom Dock、Browser Use、Computer
Use 和自举 UI 验收。CEF 原型能在保留 Wails 的前提下嵌入 Chromium，但会让 WKWebView 与 CEF
两套 GUI 系统共同维护坐标、焦点、输入、生命周期、helper、签名和平台桥。该原型只开发了一个
短纵切，尚无需要兼容的已发布数据或 API。

用户明确选择 Codex 式方向：让整个桌面壳运行在 Chromium 上，内置浏览器成为同一 compositor
中的独立页面，而不是覆盖在 Wails View 上的第二套原生表面。

## 决策

1. MilkSU 桌面壳使用固定 Electron/Chromium；Vue 继续作为产品 UI。
2. Go 保留应用服务、领域 Runtime、持久化、工作区、凭据与 Sidecar 监管，通过本地 JSONL RPC
   作为受管 Runtime 进程运行。
3. Preload 只暴露 `invoke` 与事件订阅；renderer 不启用 Node Integration，不直接访问 Go 进程、
   文件系统或 DevTools。
4. 产品右栏“浏览器”使用 `WebContentsView` 和每会话独立 `session.fromPath`。页面权限默认拒绝，
   用户与 Agent 操作同一页面。
5. Agent 通过 loopback `ScopedCDPProxy` 连接固定 Playwright MCP。Proxy 只暴露当前单一 Target，
   过滤其他 Target/Session，并拒绝创建 Target/BrowserContext 与关闭 Browser。
6. 真实用户 Chrome/Edge 继续走 Playwright MCP extension mode；外部原生 App 继续走 Computer Use。
   三者不互相降级或继承授权。
7. 直接删除 Wails 配置、Wails 绑定、CEF Bridge、CEF helper 和其打包脚本；不保留旧壳 fallback、
   兼容开关或双写。

## 为什么不是继续 CEF

CEF 本身是成熟 Chromium 嵌入方案，当初作为“保留 Wails、只替换浏览器表面”的最小原型并非错误。
但现在浏览器、终端、右栏和 Computer Use 已共同决定工作台布局，局部 CEF 方案会永久保留两套 GUI
生命周期。Electron 的包体和基础内存更高，但它把主 UI 和浏览器统一到同一 Chromium 进程模型，
并为 macOS/Windows 提供同一种 WebContents/Session 抽象。

本次没有抽象一套通用桌面框架。Electron Host 只实现 MilkSU 当前使用的窗口、对话框、外链、事件
和浏览器能力；Go App 方法继续保持领域无关的 JSON DTO。

## 安全边界

- `milksu://app` 只从打包 renderer 根目录读取规范化路径，使用 CSP 与 `nosniff`；主 renderer 的
  外部导航被阻止。
- IPC 校验发送者、方法名和事件名；Go RPC 有消息上限，不将 Provider Credential 返回 renderer。
- 浏览器 profile 位于 MilkSU 用户数据根，默认不共享日常浏览器 Cookie；页面权限默认拒绝。
- Electron 全局 DevTools 端口只监听 loopback，模型只收到按会话生成的 Target Proxy；描述符不
  持久化、不进入 Vue。
- 固定 Sidecar 仍由现有上游审阅与打包脚本安装；Electron 不复制 Pi 或 Playwright Harness。

## 验收

- Go 全量测试、Vue 全量测试、Vue 生产构建和 Electron CDP Proxy 测试通过；
- Electron Builder 生成 `build/bin/MilkSU.app`，固定 Node/Pi/Playwright Sidecar 随包安装；
- macOS 深度签名检查通过当前 ad-hoc 开发门；
- Computer Use 观察到主 `milksu://app` renderer 与同窗口 `WebContentsView`，用户可直接操作右栏页面；
- TokenFlux `grok-4.5` 只调用浏览器工具完成顺序点击挑战并取得 `flag{browser_agent_ok}`、填写表单并
  取得 `FORM_OK:MilkSU:browser-qa:collapsed-continuity`、阅读 Electron 官方文档并归纳
  `WebContentsView` 与旧 `BrowserView` 的关系，没有调用 Shell；
- 三个任务都在 Agent 开始后折叠右栏，执行没有暂停；重新展开后仍是同一页面与最终状态；
- 裸域名补全 HTTPS，普通文字进入搜索；公开 X 页面只做过一次可达性 spot-check，不据此外推登录态、
  发帖或广泛社交网站兼容能力；
- 本地交付脚本在隔离无 Provider 配置下两次记录 663–3,442 ms 生命周期启动标记、400.5–409.3 MiB
  空闲进程树 RSS、628.8 MiB App 逻辑体积、5 个进程和正常退出；这些是单机 pre-release 基线，
  不是 RC 承诺。

## 后续

- Windows 构建与签名评估；
- 浏览器下载、弹窗、权限拒绝、renderer 崩溃与恢复矩阵；
- 稳定 Developer ID、hardened runtime、公证、stapling 与自动更新；
- `MilkSU Beta` 的独立产品名、图标、Bundle ID、数据目录与 TCC 身份。

这些后续不恢复 Wails/CEF 双壳，也不改变 Browser Use 和 Computer Use 的独立授权语义。
