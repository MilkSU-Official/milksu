# ADR-0001：Agent Engine 与桌面进程边界

> 状态：Accepted for M0
>
> 日期：2026-07-19

## 决策

MilkSU 的默认工程起点采用：

- **Go + Wails v2.13.0**：桌面生命周期、本地存储、Sidecar 监管与 React 绑定；
- **Vue 3 + TypeScript**：当前桌面产品 UI；最初的 React 壳已由 [ADR-0008](/developer/adr/0008-vue-memoh-frontend) 取代；
- **Pi SDK v0.80.2 TypeScript Sidecar**：首选可改造 Agent Engine；
- **Codex app-server**：M0 对照基线，未来可作为 External Agent Runtime，不是默认 Harness；
- **版本化 JSONL 事件**：隔离 Go 与 Engine 的原生对象，不让 Pi 或 Codex 的类型进入 Role/Runtime。

这不是因为 Go 无法实现 Agent Loop，而是因为模型接入、流式输出、Session、Compaction 和通用 Tool Loop 已经由成熟项目解决。MilkSU 的 Go 核心应该把工程投入留给安全任务状态、Evidence、Effect、Evaluator、Recovery 和人机教学。

## M0 实跑结果

两条 Spike 使用同一份只读微型 CTF：Agent 必须读取 `artifact.txt`，解码十六进制内容，并给出带证据说明的 Flag。

| 比较项 | Pi SDK | Codex app-server |
| --- | --- | --- |
| 实跑结果 | 读取两份文件并得到正确 Flag | 读取两份文件并得到正确 Flag |
| 嵌入方式 | npm SDK，可直接选择模型、工具和订阅事件 | 外部 Codex 二进制，stdio JSON-RPC/JSONL |
| Provider | 多 Provider，适合 MilkSU 自己选择模型 | 主要服从 Codex 自己的 Provider、登录与配置体系 |
| Tool 控制 | 可以从零工具开始，只注册 MilkSU Adapter | 有完整 Coding Tool/Approval/Sandbox 体系，但改造成安全任务 Harness 的边界更深 |
| Session/Compaction | SDK 直接提供并可由宿主选择持久化方式 | Thread/Turn/Item 非常完整，但语义属于 Codex 产品 |
| 环境耦合 | 可以禁止用户级 Extension、Skill、Context 与默认 Coding Tools | 本轮会自动加载用户已有 Codex 配置和 MCP；一个无关 MCP 503 进入了 Spike 日志 |
| 上游变化 | 固定 npm 包和 JSONL Adapter；升级时跑契约测试 | app-server 官方仍标为 experimental，schema 与本机 Codex 版本绑定 |
| 适合的角色 | 默认可改造 Engine | 对照、兼容运行方式、Coding specialist |

因此首选 **Pi**。Codex 的实跑成功证明它能做不少 CTF，但没有证明“在 Codex Harness 外再套 MilkSU”是更小的改造。相反，用户配置/MCP 的隐式加载说明它天然是另一套完整产品运行时。

## 进程与所有权

```text
Vue UI
   │ Wails binding / engine-event
   v
Go Desktop Host
   ├─ Settings + Conversation compatibility store
   ├─ Engine Supervisor
   └─ later: Job Runtime / Event Store / Action Gateway
                 │ versioned JSONL over stdio
                 v
          Pi TypeScript Sidecar
          ├─ Model Provider adapter
          ├─ generic Session / Compaction / Tool Loop
          └─ MilkSU allowlisted Capability tools (from M2 onward)
```

边界规则：

1. Vue UI 只接收 MilkSU `engine-event`，不直接理解 Pi event；
2. Go 只监管 Sidecar 生命周期、凭据最小传递和稳定事件，不复制 Pi 的模型循环；
3. M0 通用聊天最初以 `noTools: "all"` 启动；2026-07-31 起，这一历史决策由 [ADR-0010](/developer/adr/0010-pi-coding-agent-workspace) 取代：用户明确选择项目后，通用 Coding Agent 获得项目范围内的 PI Coding Tools；用户级 Extension、Skill、Prompt Template 和 Theme 仍保持关闭；
4. Pi 从 M2 进入 Security Job 后，只有 MilkSU 显式注册的 Capability 能进入 Tool Loop；Pi 自带 `bash/edit/write` 不自动获得权限；
5. Sidecar 不继承宿主全部环境变量，只得到基础进程环境和当前 Provider 所需凭据；
6. Codex app-server 不进入默认进程树，避免 Codex 用户配置、插件、MCP 与 MilkSU Role 状态混在一起。

## M2 前置工程校准（2026-07-20）

开放 Browser、Shell 或 Lab 前，M0 的两个分发缺口已经按以下方式关闭：

- Provider 与 Relay 密钥保存在用户 Application Support 下独立的 `credentials.db`；目录权限为 `0700`、数据库为 `0600`，`settings.json` 只保留非敏感设置，Wails `GetSettings` 不返回密钥。SQLite 内容未额外加密，安全边界是当前系统账户与文件权限；旧版明文配置在首次启动时迁移并立即重写脱敏文件；
- 固定官方 Node.js `24.18.0` LTS 的 macOS arm64/x64 归档与 SHA-256，构建时先校验再使用；
- esbuild `0.28.1` 把 `bridge.js` 与 `security-bridge.js` 分别打成不依赖源码树和 `node_modules` 的 CommonJS bundle；
- Wails pre/post build hook 把官方 Node、两份 bundle、Node License 和含版本/哈希的 manifest 安装到 `.app/Contents/Resources/milksu-sidecar`；
- Go 优先启动 App Resources 中的运行时；仅源码开发回退系统 Node。随包 Node 使用 Permission Model，只开放 MilkSU 专用 Agent Workspace 的读写，不开放 child process、native addon、worker 或用户目录。Node 24 的 Permission Model 不限制网络；Sidecar 仍需访问 Model Provider，出站目标限制必须在后续 Network/Provider Policy 中单独实现，不能误写成已由 Node 沙箱解决。

这里选择“官方 Node LTS + bundle”，而不是复制 Homebrew Node 或采用 Node SEA。Homebrew Node 动态链接大量 Homebrew dylib，无法独立搬到另一台 Mac；Node SEA 仍处于 active development，本机 Homebrew 构建也不含 SEA fuse。固定官方 LTS 运行时体积更大，但升级、审计和兼容风险更清楚。

可运行 `npm run sidecar:smoke` 验证两份 Bridge 在独立 Workspace 和文件权限沙箱中启动，并确认 Security Bridge 返回零继承工具的协议声明。Wails 在 post-build hook 之前先自签，新增 Resources 会使旧签名失效，因此安装脚本会在最后重新签整个 App：开发构建默认 ad-hoc，发布构建通过 `MILKSU_CODESIGN_IDENTITY` 指定 Developer ID。最终公开发布仍需要对整个 `.app` 做 SBOM、公证和最终产物复验；当前 hook 解决的是“脱离源码树运行”和签名顺序，不等于已完成正式发行流程。

## 当前保留的技术债

- `bridge.js` 现服务项目范围内的 PI Coding Agent，具体权限与恢复边界见 ADR-0010。M2-A 的 `security-bridge.js` 与 Go `SecuritySupervisor` 仍是独立进程和协议，把 Projection 转为 Engine 输入并加入 Attempt 取消和设置重启；它不会继承通用 Coding Tools。
- Pi 固定在本轮实跑的 `0.80.2`；不能因为上游有新版本就运行时自动升级。升级必须重新跑微型 CTF、事件契约和依赖审查。
- 根目录 VitePress 开发依赖仍有只影响本地文档 Dev Server 的旧 esbuild advisory；它不在桌面产品运行链，但文档工具升级时应消除。

## 被否决的方案

- **从模型 API 重写通用 Agent Loop**：M0 没有发现足以抵消维护成本的收益；
- **Codex/Claude CLI 作为默认基座**：它们是完整 Coding Harness，不是 MilkSU 自己的可改造 Engine；
- **Python 主后端**：不符合当前并发、可 review 性与桌面进程目标；
- **Tauri/Rust 主壳**：旧 UI 已迁到 Wails，继续维护两个 Native Host 只会制造竞争主线；
- **把 Pi TypeScript 改写成 Go**：先通过 Sidecar 保留成熟实现，只有性能、分发或安全证据证明进程边界不可接受时才重新评估。

## 可重复验证

```bash
# 无模型协议检查
npm run spike:pi:protocol
npm run spike:codex:protocol

# 使用同一微型 CTF 的真实模型检查
MILKSU_SPIKE_PROVIDER=deepseek MILKSU_SPIKE_MODEL=deepseek-v4-flash npm run spike:pi
npm run spike:codex

# Go、Vue 与桌面打包
go test ./...
npm --prefix app run build
npm run sidecar:smoke
/Users/milksu/go/bin/wails build
```

Spike 源码和题目位于 `spikes/engine-comparison/`。真实 Provider 凭据由环境或本地登录提供，不写入仓库。

M2-A 的落地结果与新增分发安全门见 [ADR-0003](/developer/adr/0003-ctf-vertical-slice)。
