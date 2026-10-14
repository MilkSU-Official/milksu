# runtime/

TypeScript Runtime 是 Electron 对话的 JSONL 进程。Desktop 拉起 `runtime/dist/main.cjs`，再拉起 Go `milksu-backend` 当原生助手。

```
Electron BackendRuntime  --JSONL-->  node runtime/dist/main.cjs
                                      |-- 自有：全部 renderer RPC（会话、回合、设置、CVE、研究、Skills、插件、看板娘、实验室环境、git / diff / 产物、隔离浏览器、终端会话、Computer Use 会话层、Agent 控制面）
                                      |-- 子进程 milksu-backend：钥匙串 CGO、PTY、Lua 解释器、Computer Use 的 AX / 屏幕录制 / Portal / 签名身份
```

开发构建：`npm run runtime:build`。`desktop:start` 和 `desktop:build-dev` 会先跑这一步，并编 renderer 与原生助手。测试：`npm run runtime:test`。

## 协议

与 `cmd/milksu-backend/desktop_rpc.go` 同一套 JSONL：ready、invoke、result、event、host_request、host_response、shutdown。方法名 PascalCase。凭据和助手薄 RPC 只接受 `electron_host`。

## 助手还做什么

| 方法 | 用途 |
| --- | --- |
| `GetPlatformSecret` / `SetPlatformSecret` / `DeletePlatformSecret` | macOS 钥匙串（Security.framework CGO） |
| `OpenPty` / `PtyWrite` / `PtyResize` / `ClosePty` | 终端 PTY（`creack/pty`） |
| `RunLuaPlugin` | Lua 插件（`gopher-lua`） |
| `ComputerUseAccessibilityStatus` 等 9 个 | AX、屏幕录制、窗口列表、签名身份、Linux Portal |

Windows / Linux 的 sqlite secret store 在 Runtime 里。spawn sidecar 前用 `electron_host` 调 `ExportSidecarEnvironment` 的实现已在 TS：从水合后的 settings 组装环境，darwin 上 secret 向助手读。

Go 里仍有会话 / CVE / 插件等旧实现副本，Desktop 路径不调用它们。

## 回合

`SendMessage` 由 `runtime/src/engine.ts` 写 sidecar command。字段对齐原 Go supervisor：prompt、locale、provider、model、thinking、sessionRole、执行档位、MCP、attachments、traceId、userMemories、customProvider、codingBrowser、computerUse、securityTools、workerModel、codingCollaboration。没有 `acp_guest.command` 时 Agent 会话返回 `Agent command is not configured`。

Engine 按内核 + 工作区各养一条 sidecar，spawn cwd 即工作区。`DeleteConversation` 发 `destroy_session`（`deletePersisted=true`）。该工作区没有剩下的会话时停掉这条进程。闲置退出不广播 `engine.stopped`。未打包 spawn 若 node 二进制不叫 `node`，补 `ELECTRON_RUN_AS_NODE=1`。Pi、Agent、看板娘因此以 Node 进程跑。

`exportSidecarProviderEnvironment` 合成 `MILKSU_DSH_PI_AI_ROUTES`。TokenFlux 走账户中转、个人 key，或指向 `https://tokenflux.dev/v1` 的自定义中转。自定义中转的 provider id 与 `tokenflux` 共用同一条路由。模型表来自 `data/services/model-catalog/tokenflux.json`。路由带 `compat.supportsDeveloperRole: false`。

Browser Use 扩展源目录：`MILKSU_ROOT`、`MILKSU_RESOURCES`、仓库根，最后才是 cwd。

`SaveSettingsCmd` 广播 `settings-changed`，renderer 据此重载设置。

## 数据

会话 JSON：`<MILKSU_HOME>/data/stores/conversations/`。`workspaceHome: "ctf"` 读成 Coding。旧 CTF 字段读入丢掉。

设置：`<MILKSU_HOME>/config/settings.json`。Key 不进这个文件。
