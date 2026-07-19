# ADR-0001：Agent Engine 与桌面进程边界

> 状态：Accepted for M0
>
> 日期：2026-07-19

## 决策

MilkSU 的默认工程起点采用：

- **Go + Wails v2.13.0**：桌面生命周期、本地存储、Sidecar 监管与 React 绑定；
- **React + TypeScript**：保留已有聊天、配置、会话与工具输出 UI，后续再增加独立的 CTF/Vuln 面板；
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
React UI
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
          └─ MilkSU allowlisted Capability tools (from M1 onward)
```

边界规则：

1. React 只接收 MilkSU `engine-event`，不直接理解 Pi event；
2. Go 只监管 Sidecar 生命周期、凭据最小传递和稳定事件，不复制 Pi 的模型循环；
3. M0 通用聊天以 `noTools: "all"` 启动，并关闭 Pi 用户级 Extension、Skill、Prompt Template、Theme 和 Context File；
4. M1 起只有 MilkSU 显式注册的 Capability 能进入 Tool Loop；Pi 自带 `bash/edit/write` 不自动获得权限；
5. Sidecar 不继承宿主全部环境变量，只得到基础进程环境和当前 Provider 所需凭据；
6. Codex app-server 不进入默认进程树，避免 Codex 用户配置、插件、MCP 与 MilkSU Role 状态混在一起。

## 当前保留的技术债

- 旧配置兼容层仍把 Provider Key 保存在权限为 `0600` 的 JSON 文件中。进入 M2 前应迁移到 macOS Keychain，JSON 只保留非秘密配置和 Key 引用。
- 开发态依赖系统 Node；产品打包前必须选择固定、签名的 Node/Sidecar 分发方式，不能假设用户已经安装 Node。
- `bridge.js` 目前只有对话事件。M1 应将其改成正式的 `AgentEngine v1alpha1` Adapter，并加入取消、恢复、错误类别和契约测试。
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

# Go、React 与桌面打包
go test ./...
npm --prefix app run build
/Users/milksu/go/bin/wails build
```

Spike 源码和题目位于 `spikes/engine-comparison/`。真实 Provider 凭据由环境或本地登录提供，不写入仓库。
