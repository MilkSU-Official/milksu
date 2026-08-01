# Challenge Intake、Browser Use 与 Computer Use

> 状态：**Implemented / Partial**。本地文字/附件/目录、URL/Socket/SSH 和显式 User Browser
> Bridge 已接线；Managed Browser、普通 Coding Browser/MCP 与 Computer Use 仍是 Planned。
> 本文中的第三方候选仍只是准入研究，不代表已安装。
>
> 评审日期：2026-07-19

## 先纠正一个边界：浏览器不是任务入口

CTF 用户不一定从网站开始任务。用户可能直接在聊天中粘贴题面、上传附件或截图、选择一个本地目录、提供 URL/Socket/SSH，也可能让 MilkSU 接管一个已经登录的比赛标签页。**Browser Use 只是其中一种采集和操作能力，不能成为 CTF Agent 本身。**

M2 需要先建立统一的 `Challenge Intake`：保存原始输入和授权范围，再把不同来源归一化成 CTF Role 能理解的 Challenge 与 Material。Role 不应知道材料最初来自 QQ 文本、文件选择器、浏览器还是本地 Lab。

```text
聊天文字 ───────────────┐
附件 / 压缩包 ──────────┤
截图 ───────────────────┤
显式选择的本地目录 ─────┼─> Challenge Intake
Managed Browser ────────┤      ├─ 原始 Artifact + 哈希 + provenance
用户批准的浏览器标签页 ─┤      ├─ 解析后的 Challenge Draft / Material
URL / Socket / SSH ─────┤      └─ 授权、可信度、可用 Capability
MilkSU 管理的本地 Lab ──┘                    │
                                              v
                                  CTF Role + Security Loop
```

### Intake 至少保存什么

| 字段 | 人话解释 |
| --- | --- |
| `source_kind` | chat、attachment、image、directory、browser、remote、managed_lab |
| `original_artifact` | 未被模型改写的原文、文件、截图或页面快照 |
| `content_hash` | 证明后续分析引用的是哪一份输入 |
| `provenance` | 谁提供、从哪里取得、何时取得、是否可能被目标控制 |
| `authorization` | 可以读哪个目录、操作哪个标签页、连接哪个目标；不能从一个输入推导出全局权限 |
| `derived_observations` | 解压目录、OCR、视觉描述、页面结构、附件类型等可重新生成的解析结果 |
| `available_actions` | 当前来源支持读取、下载、启动、重置、提交还是只能由用户确认 |

安全默认值：附件先复制到任务工作区并哈希，不自动执行；本地目录默认只读且限制在用户明确选择的根目录；截图同时保存原图和派生解析；归档文件先做路径穿越、大小和文件数限制；页面文本、文件名和 OCR 结果都只是 Observation，不能因为其中写着“执行某命令”就直接越过 Action Gateway。

## “完整 Agent 能力”仍由 Harness 提供

无论 Challenge 从哪里进入，CTF Agent 都必须能：

1. 通过对话澄清目标、规则、题型和用户希望采用的 Coach/Copilot/Delegate 方式；
2. 联合理解文字、图片、附件、目录结构、网页状态和工具输出；
3. 维护 Challenge、Experiment Tree、假设、失败分支、Evidence、Judge 和教学进度；
4. 根据问题选择 Browser、Shell/File、Binary、Network 等 Capability，而不是把一切都变成浏览器点击；
5. 在每次有副作用的动作前经过 scope、policy 和 approval，执行后先保存证据再继续规划；
6. 中断后从持久事实恢复，而不是依赖一段越来越长的聊天上下文。

因此 Playwright、Cua 或其他 Browser/Computer Use 项目位于 L3 Capability / L5 Tool Executor 边界；它们不会接管 MilkSU 的 Agent Engine、Role 状态、Evidence、Evaluator 或教学闭环。

## 近三年候选项目

Star 是 2026-07-19 的筛选快照，只用于衡量社区采用度，不代表安全背书。

### Browser Use

| 项目 | Star / 主要语言 / 许可证 | 定位 | MilkSU 判断 |
| --- | --- | --- | --- |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 35,262 / TypeScript / Apache-2.0 | 基于可访问性树和 Playwright 的浏览器工具服务，支持独立 Profile 与用户批准的现有标签页 | **M2 首选 PoC**；只复用浏览器能力，不复用另一套 Agent |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 47,175 / TypeScript / Apache-2.0 | Chrome 调试、网络与性能分析能力 | 作为后续 Web 调试 Capability 研究；不做默认 CTF 浏览器入口 |
| [Stagehand](https://github.com/browserbase/stagehand) | 23,554 / TypeScript / MIT | 在 Playwright/CDP 上再加入自然语言 action、agent、缓存与模型调用 | 与 Pi/MilkSU 的规划层重叠；先参考可靠动作与缓存设计，不直接嵌入 |
| [Browser Use](https://github.com/browser-use/browser-use) | 105,518 / Python + Rust / MIT | 完整 Browser Agent、模型循环和云浏览器产品 | 社区规模最大，但语言与 Harness 重叠明显；作为 benchmark/设计参考，不做默认基座 |

### Computer Use

| 项目 | Star / 主要语言 / 许可证 | 定位 | MilkSU 判断 |
| --- | --- | --- | --- |
| [Cua](https://github.com/trycua/cua) | 20,171 / Rust、Swift、Python、TypeScript / MIT | 桌面驱动、VM/容器沙箱、MCP、Agent 与 benchmark 的大型 monorepo | **只考虑复用 Rust `cua-driver`**；完整项目和一键安装方式不准直接进入 |
| [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) | 38,112 / TypeScript / Apache-2.0 | 完整多模态桌面 Agent 与应用 | 产品/Harness 重叠过大；用于视觉 GUI Agent 对照和 benchmark |
| [Agent-S](https://github.com/simular-ai/Agent-S) | 12,035 / Python / Apache-2.0 | 研究型跨平台 GUI Agent | Python 且带完整 Agent Loop；只研究规划与评测 |
| [Microsoft UFO](https://github.com/microsoft/UFO) | 9,295 / Python / MIT | Windows UIA/Win32/COM 与多 Agent 桌面编排 | Windows 后续参考；不适合 macOS-first M2 |

结论不是“Star 最大的最好”。MilkSU 应优先复用**能力执行层**，把完整 Agent 产品留作基线或外部 Runtime，避免在 Pi 和 Security Harness 外再套第三套 Planner、Memory 与模型调用。

## Playwright MCP 准入评审

本轮固定并检查：

- Release：`v0.0.78`
- Git commit：`5f8fc00210b27b4407c375b59cda4838045d429c`
- npm：`@playwright/mcp@0.0.78`
- npm integrity：`sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ==`
- 实际核心依赖：`playwright-core@1.62.0-alpha-1783623505000`
- core integrity：`sha512-CPJZdsA/KGT2QQlekiV6Wt+QlQrZHVSZ6oiNtOI/bYYOIVLM8jfKGWTM4zQiyd4UN+40Cq4cA6lxmZHZbtPvJQ==`

### 看到的事实

- GitHub 仓库外壳很薄；运行逻辑主要来自精确锁定的 `playwright-core`。根包没有 `preinstall/postinstall/prepare` 生命周期脚本，运行依赖只有精确版本的 `playwright` 与 `playwright-core`。
- 固定 commit 的 GitHub 签名验证为 `valid`；下载的 core tarball SHA-512 与 lockfile integrity 一致。
- 在检查的 MCP/Playwright 代码中没有发现默认产品遥测端点；浏览器下载会访问 Microsoft 的 Playwright CDN，这属于显式安装阶段的供应链行为。
- 上游自己明确说明 Playwright MCP **不是安全边界**。它支持网络监听、关闭浏览器沙箱、读取 storage state、连接现有 Profile、加载 init script 和扩大本地文件访问；这些是功能，不应原样暴露给模型。
- `v0.0.78` 顶层声明 Node `>=18`，但锁定的 Playwright 依赖声明 Node `>=20`；这更像版本声明不一致而非后门，但说明我们必须固定并实测自己的运行时，不能照抄 `npx ...@latest`。
- Playwright Extension 第一次连接会让用户选择具体标签页并批准连接；可配置 token 绕过后续批准。MilkSU 不应默认配置这个绕过 token。

### 允许进入 PoC 的条件

1. 使用固定 `0.0.78`、lockfile integrity 和受控 Node 20 runtime；禁止 `@latest`、`--pull=always` 和运行时静默升级。
2. 只用子进程 `stdio`，不开放 SSE/HTTP 端口，不绑定 `0.0.0.0`。
3. 显式保持 Chromium sandbox；禁用 `allow-unrestricted-file-access`、任意 init script、共享浏览器上下文和由 Agent 指定 executable/endpoint。
4. Managed Browser 使用 MilkSU 独立 Profile；比赛平台 Profile 与不可信 Target Profile 分开，下载只能落入当前 Attempt 工作区。
5. User Browser Bridge 保留扩展的“选择标签页 + 每次批准”流程，不默认保存绕过批准的 token；连接期间持续显示共享状态并可立即撤销。
6. MCP 工具 schema 不能直接注册给模型。MilkSU Adapter 只暴露允许的动作，并在 Action Gateway 中检查域名、下载路径、提交 Flag、速率和 Evidence。
7. 上游升级先固定新版本、复跑准入检查和回归测试，再人工更新；不能让用户机器自行滚动到新版本。

当前判断：**没有发现故意后门的直接证据，可以做受限 PoC；这不是“安全审计通过”，更不是允许无边界运行。**

## Chrome DevTools MCP 为什么不是默认入口

Chrome DevTools MCP 的优势是 DevTools 网络、Console、Trace 和性能分析，但当前版本：

- 使用统计默认开启并发送到 Google Clearcut；
- 默认定期查询 npm registry 检查更新；
- 性能功能可能把 trace URL 发给 Google CrUX；
- 能连接正在运行的 Chrome 调试端口并读取该浏览器实例中的内容。

这些行为都可以关闭，但 M2 只需要可靠读取和操作任意 CTF 页面，Playwright MCP 的能力更小、更接近目标。以后若 Web Capability 真正需要 HAR、DevTools Trace 或深层网络调试，再为 Chrome DevTools MCP 做一次独立准入评审，并默认关闭遥测、CrUX 和更新检查。

## Cua `cua-driver` 准入评审

本轮固定并检查：

- Git commit：`0b798a59cbe7f9e628ae488cb8023b9b6f990bd6`
- 当前 Rust Driver release：`cua-driver-rs-v0.8.3`
- 根许可证：MIT

### 值得复用的部分

- Rust Driver 可以通过 stdio MCP/CLI 驱动 macOS、Windows、Linux 的窗口截图、Accessibility/UIA 树、点击、输入和录制；它不是必须依赖 Python Agent 的黑盒。
- macOS 有明确的 Embedded 模式：由宿主 App 直接 spawn Driver，使它继承宿主的 Accessibility 与 Screen Recording 身份，不需要第二套产品界面和权限主体。
- 它区分 window、auto、desktop capture scope，并要求从窗口能力升级到桌面能力时显式 `escalate_session`。这种“先窗口、后桌面”的边界适合被 MilkSU 再收紧。
- Rust `Cargo.lock` 没有 Git 来源依赖；本轮看到的 build script 只调用本机 Xcode/Swift 工具，没有发现构建期从陌生站点下载代码。

### 阻止直接接入的问题

1. **一键安装链不可接受**：README 推荐 `curl | bash`；脚本还会继续从 `cua.ai` 拉辅助脚本和提示，再下载 GitHub Release 二进制。Release 已发布 `checksums.txt` 和 SHA-256 digest，但当前 Unix 安装器下载后直接解压，没有核对 checksum。
2. **遥测默认开启**：Driver 默认向 `https://eu.i.posthog.com/capture/` 发送伪匿名安装 ID、版本、平台、命令/工具类别、成功与耗时等元数据。代码明确避免发送 prompt、typed text、截图、URL 和路径，但对本地安全工作台仍应默认零遥测。
3. **HTTP MCP 不适合作为边界**：可选 HTTP transport 监听 `127.0.0.1`，但没有认证，解析后也没有强制请求 path 必须是 `/mcp`。回环地址只减少远程暴露，不能阻止同机进程或恶意网页发起有副作用的请求。
4. **权限本身很大**：Accessibility + Screen Recording + 输入控制足以读取和操作大量桌面内容。即使代码没有后门，这个进程被劫持或错误授权也会形成高影响入口。
5. **本地 socket 仍需宿主加固**：Unix daemon 没有在 bind 后显式收紧 socket mode 或验证 peer identity。MilkSU 不能依赖用户目录恰好不可被其他本地用户遍历。

### 未来允许 PoC 的条件

1. 不执行上游 `curl | bash` 安装器；从固定 source commit 使用 `cargo build --locked` 构建，或下载固定 release 后同时验证 GitHub asset digest、`checksums.txt` 与 macOS 签名/公证。
2. 由 MilkSU App 以 Embedded 模式直接 spawn；二进制放在签名 App bundle 内并纳入 MilkSU 自己的更新签名链。
3. 启动前设置 `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`，写入持久 opt-out，并用默认拒绝的 egress policy 验证没有遥测请求。
4. 禁用 `CUA_DRIVER_RS_MCP_HTTP_PORT`；只允许 stdio proxy + 每次运行创建的私有 Unix socket，父目录 `0700`、socket `0600`，任务结束即删除。
5. MilkSU 只暴露 allowlist 后的窗口级 screenshot/AX/click/type 工具；`launch_app`、desktop capture、全局热键、录制和 scope escalation 分别审批。
6. Computer Use 不是 M2 的前置条件。等 CTF/Vuln 确实需要操作 Burp、Ghidra、VM Console 或其他本地 GUI 时，再做单独 PoC 和完整仓库扫描。

当前判断：**没有发现故意后门的直接证据，但不接受直接安装或默认运行；保留 Rust Driver 为有条件的后期候选。**

## 建议的 M2 顺序

以下只是 M2 内部的交付顺序，不改变全局 M0 → M1 → M2 里程碑。M2-A 已先完成最小 Offline Intake 与真实 CTF Loop；Browser 与完整 Intake 仍需单独确认和准入。

```text
M2-A  Offline Challenge Slice                         已完成工程验证
      pasted statement / small attachment / Pi / typed tools / local judge
                       │
M2-B  Managed Local Lab                               待确认
      controlled file / shell / socket + lifecycle provider
                       │
M2-C  Managed Browser Capability                      待确认
      Playwright MCP / dedicated profile / stdio / Action Gateway
                       │
M2-D  User Browser Bridge                             待确认
      selected tab / explicit approval / visible sharing / revocation

M2-E  Teaching and long-term Workspace                待确认
      Coach / Copilot / competition / learning record

Later  Computer Use
       only after a native-GUI use case proves Browser + CLI is insufficient
```

这份评审只授权继续讨论和做最小 Spike，不代表已经同意把浏览器依赖写入产品。真正动工前还需要确认 Playwright PoC 的范围；Computer Use 必须等独立模块评审。

## 审查覆盖与限制

本轮没有运行候选项目的安装脚本或二进制。检查覆盖固定仓库 revision、manifest/lockfile、安装与更新脚本、遥测端点、远程监听、浏览器 Profile/Extension、macOS 权限嵌入和关键供应链路径。

Codex Security 的标准全仓穷举扫描要求 6 个可用 worker，本次会话只有 3 个，因此没有把结果包装成“完整全仓安全审计”。未发现后门迹象只代表已检查范围内没有直接证据；正式随 MilkSU 分发前仍需对最终固定的源代码、构建产物和 Adapter 做完整扫描、SBOM、签名与行为测试。
