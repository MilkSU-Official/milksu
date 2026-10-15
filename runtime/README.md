# runtime/

TypeScript Runtime 是 Electron 对话的 JSONL 进程。Desktop 拉起 `runtime/dist/main.cjs`。

```
Electron BackendRuntime  --JSONL-->  node runtime/dist/main.cjs
                                      |-- 自有：全部 renderer RPC（会话、回合、设置、CVE、研究、Skills、插件、看板娘、实验室环境、git / diff / 产物、隔离浏览器、终端会话、Computer Use 会话层、Agent 控制面）
                                      |-- N-API：macOS 钥匙串 / 窗口列表、Windows 窗口列表（desktop/native）
                                      |-- node-pty：终端 PTY
                                      |-- fengari：Lua 插件
                                      |-- dbus-next：Linux XDG Desktop Portal
                                      |-- Electron hostCall：Computer Use TCC / 权限面板
```

开发构建：`npm run runtime:build`。`desktop:start` 和 `desktop:build-dev` 会先跑这一步，并编 renderer 与 N-API 模块。测试：`npm run runtime:test`。

## 协议

JSONL：ready、invoke、result、event、host_request、host_response、shutdown。方法名 PascalCase。凭据 RPC 只接受 `electron_host`。

## 操作系统层

| 能力 | 实现 |
| --- | --- |
| Darwin 凭据 | `macos-keychain.node`。默认 `~/.milksu` 用 service `dev.milksu.app.credentials`；其它 `MILKSU_HOME` 带 hash 后缀。addon 不可用时回退 sqlite |
| 终端 PTY | `node-pty`（`NodePtyDriver`） |
| Lua 插件 | fengari（base/string/table/math，`milksu.storage`） |
| Computer Use 权限 | Electron `computerUse.permissions` / `openPermissions` |
| 窗口列表 | Darwin / Windows N-API；Linux Portal |
| 签名身份 | `/usr/bin/codesign -dv --verbose=4` |
| 插件 MCP | `runtime/dist/plugin-mcp.cjs`（`@modelcontextprotocol/sdk` stdio） |
| 打包原生 | `scripts/lib/desktop-native.mjs`：三端重建 `node-pty`；Windows 用 node-gyp 编 `windows-windows.node` |

## 回合

`SendMessage` 由 `runtime/src/engine.ts` 写 sidecar command。字段含 prompt、locale、provider、model、thinking、sessionRole、执行档位、MCP、attachments、traceId、userMemories、customProvider、codingBrowser、computerUse、securityTools、workerModel、codingCollaboration。没有 Agent 命令时返回 `Agent command is not configured`。

Engine 按内核 + 工作区各养一条 sidecar，spawn cwd 即工作区。ACP Agent 再按 Agent id 分开。ACP 的 `MILKSU_DSH_IPC` 用工作区加 Agent id 的 hash。DSH 的 `--patch` / `--profile acp` 只在命令是 DeepSeek Harness 时加上。最多停放 3 条空闲 sidecar，闲置 15 分钟后驱逐。`DeleteConversation` 发 `destroy_session`（`deletePersisted=true`）。该工作区没有剩下的会话时停掉这条进程。闲置退出不广播 `engine.stopped`。Electron 产品二进制 spawn sidecar、看板娘或插件 MCP 时补 `ELECTRON_RUN_AS_NODE=1`。二进制文件名是 `node` 时不加这项。handoff 带目标 `acpAgentId`；切回 Pi 时清掉。

`exportSidecarProviderEnvironment` 合成 `MILKSU_DSH_PI_AI_ROUTES`。TokenFlux 走账户中转、个人 key，或指向 `https://tokenflux.dev/v1` 的自定义中转。自定义中转的 provider id 与 `tokenflux` 共用同一条路由。模型表来自 `data/services/model-catalog/tokenflux.json`。路由带 `compat.supportsDeveloperRole: false`。

Browser Use 扩展源目录：`MILKSU_ROOT`、`MILKSU_RESOURCES`、仓库根，最后才是 cwd。

`SaveSettingsCmd` 广播 `settings-changed`，renderer 据此重载设置。

## 数据

会话 JSON：`<MILKSU_HOME>/data/stores/conversations/`。`workspaceHome: "ctf"` 读成 Coding。旧 CTF 字段读入丢掉。

设置：`<MILKSU_HOME>/config/settings.json`。命名 Agent 写在 `acp_agents` 与 `default_acp_agent_id`。Key 不进这个文件。
