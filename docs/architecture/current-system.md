# 当前系统与分层

> 文档状态：Current
>
> 事实审计：2026-09-15。本页描述当前代码结构，不安排任务。
> 发行回执见 [当前开发目标](/developer/current-objectives)。产品 UI 只写在 `AGENTS.md`。

## 系统上下文

```mermaid
flowchart LR
    learner["学习者"]
    provider["模型 Provider"]
    local_tools["本机安全工具"]
    user_browser["用户真实浏览器"]
    native_apps["外部原生 App"]
    ctf_platforms["CTF 平台"]
    account_cloud["账户与发行服务"]

    subgraph milksu["MilkSU 本地桌面"]
        chromium["Electron / Vue"]
        go["Go Runtime"]
        pi["Pi Sidecar"]
        security["CTF / CVE / Judge"]
        local["SQLite + Artifact"]
        deliverables["Documents/MilkSU"]
    end

    learner --> chromium
    chromium <--> go
    go <--> pi
    pi --> provider
    pi <--> local_tools
    go --> security --> local
    go --> deliverables
    chromium <--> user_browser
    chromium <--> native_apps
    chromium <--> ctf_platforms
    chromium <--> account_cloud
```

桌面壳是 Electron/Chromium：Vue 在主 `BrowserWindow`，右栏浏览器是同壳 `WebContentsView`。Go 是受管 Runtime，不拥有 GUI。

## 桌面执行表面

Pi 拥有会话、压缩和工具循环。桌面 GUI 把外部动作变成可见、可限定、可接管的表面。

| 表面 | 对象 | 边界 |
| --- | --- | --- |
| 浏览器 | 会话隔离 `WebContentsView` | 不是用户 Chrome |
| Browser Use | 用户明确选择的 Chrome/Edge 标签 | 不拿整个 Profile，不替代 Judge |
| Computer Use | macOS/Windows：可见 App/PID/Window；Linux GNOME：整桌面 Portal | 模型列窗 / 认窗 / 锁定；选窗器可选。不替代另外两面；Hyprland/Xorg unavailable |

面板显隐只改观察，不改执行 Session。停止、撤 Scope、任务结束或进程退出才终止。

## 当前能力

| 边界 | 状态 | 事实 |
| --- | --- | --- |
| 桌面壳 | packaged | `desktop/main.cjs` + Preload allowlist。macOS `hiddenInset`；Windows/Linux 画布色 overlay，系统按钮右上。 |
| Vue 表面 | partial | CTF / CVE / 实验室 / Coding / 设置 / Composer / 右栏 / Bottom Dock。CVE、实验室用对话小窗 + `report.md`。设计语言见 `AGENTS.md`。 |
| 账户与模型 | packaged | GitHub PKCE；TokenFlux Key 只进 Go Credential Store，请求 `https://tokenflux.dev/v1`。账户目录优先，可安全回退个人来源。 |
| OTA | implemented | 已登录 Stable 轮询 Admin latest；macOS/Windows 走 electron-updater，Linux dpkg/tarball。GitHub Release 不上 OTA ZIP。 |
| Go Runtime | implemented | JSONL RPC。Sidecar 停靠保活；凭据轮换惰性、撤回立即停。Pi `bash` 缺省 600 秒。 |
| 插件 | packaged | `milksu.plugin/v1`：签名包、发布者信任、六个主题表面。 |
| Pi | verified core | Session / Compaction / Tool Loop。Coding/CTF/CVE/实验室共用完整循环与 80% 自动压缩。`milksu_workspace`、`milksu_ask` 是产品工具。新对话可选 DSH（ACP，工作树钉 `0.1.6-alpha.1`）。 |
| 安全工具 | setup 已通 | 设置 → MCP：IDA / capa 可准备。CodeQL / Burp / Shannon 仅检测。 |
| 浏览器三面 | packaged / pairing pending | 隔离浏览器按会话；Browser Use 待桌面配对回执；Computer Use：模型列窗锁定，macOS/Windows 窗口 Scope + CUA `0.27.0`，Linux GNOME Portal。 |
| CTF / CVE / 实验室 | implemented | CTF 持题目、Evidence、Judge。CVE 点进档案复现。实验室起本机 Docker / AVD 或用户地址。CTF 本地房还不能引用环境经纪。 |
| Worktree | opt-in | 子 Agent 默认主工作区；writer 只在模型调用 `prepare_coding_worktree` 时准备。脏主区不进 writer。 |
| 持久化 | implemented | 产物在文档目录 `MilkSU`；Runtime、凭据、Obelisk、浏览器 Profile 在用户配置目录。 |
| 产品回归 | partial / 未进安装包 | `npm run test:product-loop`，见 [产品回归循环](/developer/product-regression-loop)。`desktop-surface` 优先 Computer Use，不可用降级隔离浏览器。Settings「评测」是另一条。 |

## 进程与 IPC

```mermaid
flowchart TB
    subgraph electron["Electron 主进程"]
        window["BrowserWindow"]
        preload["Preload"]
        host["Host"]
        browser["WebContentsView"]
        proxy["Scoped CDP"]
    end

    subgraph go_process["Go Runtime"]
        rpc["JSONL RPC"]
        app["Application Services"]
        runtime["CTF / CVE Runtime"]
        plugins["Plugin"]
        supervisors["Pi Supervisor"]
        tool_catalog["Security Tool Service"]
    end

    subgraph sidecar["Sidecar"]
        pi["Pi Session"]
        policy["Approval"]
        resources["Skills / MCP / LSP"]
        adapters["IDA / capa"]
        playwright["Playwright MCP"]
    end

    window --> preload --> host
    host <--> rpc --> app
    app --> runtime
    app --> plugins
    app --> supervisors <--> pi
    app --> tool_catalog --> supervisors
    pi --> policy
    pi --> resources
    pi --> adapters
    pi <--> playwright
    host --> browser
    browser <--> proxy <--> playwright
```

Vue 只经 `window.milksu.invoke`。Electron 不拥有 CTF/CVE 事实，Go 不拥有通用模型循环，Pi 不拥有桌面授权。

隔离浏览器的 Agent 控制走 `ScopedCDPProxy`：只公布当前一个 Target，拒绝创建 Target / Context 或关 Browser。

安全工具：设置页准备到 `ready + enabled` 后进入 Pi 目录。IDA 是 lazy MCP，capa 是原生工具。CodeQL / Burp / Shannon 不进描述符。

Beta 是独立 Bundle ID 与 userData，只用于明确要求的自举。Stable Computer Use 排除自身。

## 六层与依赖

```text
Vue → Electron Preload / Host → Desktop JSONL RPC → Go Application Service → Domain / Runtime → Adapter
```

| 层 | 判断 |
| --- | --- |
| L1 产品面 | 主面可用；三端权限与发行 UI 仍需扩样 |
| L2 桌面边界 | Preload + JSONL；`app.go` 仍集中 |
| L3 Agent / 平台 | Pi、Playwright、Computer Use 已接；其余安全工具在准入队列 |
| L4 领域 | 模型不能越过 Judge / 正式事实 |
| L5 Evidence | 事件、Artifact、Projection、Recovery 已实现 |
| L6 完整性 | 工作区、审批、凭据边界在；宿主不是容器 |

触碰 `app.go`、`CTFPage.vue`、`bridge-policy.js`、`browsercap/manager.go` 或 Runner/Recovery 时，随纵切抽出职责，不另开纯架构清理。

## 发行

干净已推送的 `main` 上跑一次 canonical 验证，再三端 `workflow_dispatch`。macOS 用 `macos-release` 签名公证。正式包装 OTA 到私有 R2 并发布 current pointer。GitHub Release 只上用户安装包。三端回执不等于功能等价。
