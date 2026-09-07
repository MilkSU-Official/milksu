# MilkSU 插件框架与皮肤扩展

> 文档状态：Stable v1 implementation contract
>
> 事实审计：2026-08-23
>
> 范围：本地签名包、作者工具、Lua/预编译 TypeScript、设置 iframe、皮肤表面、只读 Agent 工具和外部 MCP。三端发行 smoke 必须由同一提交的发行门禁完成；未取得回执前不得写成已发行。

`milksu.plugin/v1` 描述稳定的技术契约，但当前完整框架仍是未进入正式发行版的实验性能力。试用者请先阅读[插件框架实验性使用说明](./plugin-user-guide.md)；发行与治理状态仍以当前目标、文档状态、代码和真实回执为准。

## 稳定边界

公共 API 固定为 `milksu.plugin/v1`，使用严格 SemVer。Go 是 Manifest、签名、信任、安装状态、能力代理、存储事务和 MCP 的可信控制面；公共 Runtime 只有受限 Lua 和预编译单文件 TypeScript。Rust 原生 ABI、WASM、在线市场、远程自动更新和第三方写工具不属于 v1。

官方锁定插件可在一个发行周期内通过 `milksu.plugin/v1alpha1` 适配层运行；本地签名安装和开发模板只接受 v1。官方 ID 永远不能由第三方包覆盖；显式开发模式也不能覆盖官方 ID。

框架针对用户主动信任的发布者提供供应链和故障隔离，不宣称是同一操作系统用户下的强敌对多租户沙箱。

## 快速启动和作者命令

反复目视测试插件设置页：

```text
npm run plugins:dev -- --no-build --open-settings
```

首次或源码变化后去掉 `--no-build`。开发数据默认隔离在 `build/plugin-dev-appdata`；也可传 `--app-data=<绝对或相对目录>`。正式应用数据不会被开发插件读取。

完整作者流程：

```text
npm run plugins:keygen -- --publisher "Example Publisher" --out ./private/example.publisher-key.json
npm run plugins:create -- --runtime typescript --id example.text-tools --name "Example Tools" --publisher "Example Publisher" --key-id <fingerprint> --out ./plugins/dev/example.text-tools
npm run plugins:test -- --source ./plugins/dev/example.text-tools
npm run plugins:pack -- --source ./plugins/dev/example.text-tools --key ./private/example.publisher-key.json --out ./example.text-tools.milksu-plugin
npm run plugins:verify -- --package ./example.text-tools.milksu-plugin
```

`plugins:keygen` 只把 Ed25519 私钥写到用户指定文件，不打印私钥。`plugins:pack` 拒绝覆盖已有输出；同一源码和密钥生成确定性 ZIP。密钥轮换按“旧密钥、新密钥”的顺序重复传 `--key`，Manifest 的 `publisher.keyId` 指向新密钥。

## Manifest、Schema 和能力协商

稳定 Manifest 必须声明发布者、最低宿主版本、必需能力、`storageVersion`、权限、Runtime，以及每个工具的输入和输出 Schema。公开 Schema：

- [Manifest v1](./plugin-schemas/manifest-v1.schema.json)
- [Runtime invocation v1](./plugin-schemas/runtime-invocation-v1.schema.json)
- [Runtime result v1](./plugin-schemas/runtime-result-v1.schema.json)
- [SurfaceStyle v1](./plugin-schemas/surface-style-v1.schema.json)
- [签名包 v1](./plugin-schemas/signature-v1.schema.json)

宿主当前公布：`runtime.lua.v1`、`runtime.typescript.v1`、`ui.settings.v1`、`theme.surfaces.v1`、`theme.assets.v1`、`agent.read-tools.v1`、`mcp.external-read.v1` 和 `storage.v1`。缺少必需能力或宿主版本过低时，插件保持不可用并显示明确错误。

Lua 与 TypeScript 每次隔离调用都依次执行 `initialize`、业务方法、`dispose`，上下文一致包含插件 ID/版本、API/宿主版本、来源、权限和能力。上下文不含环境变量、凭据、原始文件路径或 preload。

第三方 v1 工具必须是 `read`。工具输出在存储写入前按 `outputSchema` 验证；能力信封、JSON 上限或 Schema 任一失败都不会提交存储。

## 签名包、信任和安装事务

`.milksu-plugin` 是最多 16 MiB、128 个条目的确定性 ZIP。解包前后拒绝路径逃逸、反斜线、符号链接、非普通文件、大小写冲突、重复条目、未知压缩方法和异常压缩比。包的路径与字节树摘要由 Ed25519 签名。

安装分两阶段：先在 app-data 的临时目录验证包、Manifest、宿主兼容、签名、主题、设置模块和 Runtime 健康检查，再向用户显示发布者指纹、权限、表面、工具和兼容范围。确认后以可回滚事务提交包目录、安装索引、插件状态和发布者信任；任一步失败都恢复旧索引和旧状态，不留下新信任或半安装版本。

升级要求插件 ID 不变、版本严格上升，发布者密钥不变；密钥轮换必须同时具有旧、新有效签名。权限扩大或主版本变化需要额外确认。同一主版本不能移除工具、收窄输入 Schema 或破坏输出 Schema。

每个插件存储最多 64 个键、单值 64 KiB、总计 256 KiB。`storageVersion` 上升且已有数据时，Manifest 必须声明直接迁移；缺少迁移时 UI 只允许“删除插件数据后继续”或取消。迁移结果先在内存副本验证，再与安装索引提交；上一版本和存储快照保留用于回滚。

卸载默认保留数据，也提供“卸载并删除数据”。撤销发布者信任会立即停用其本地插件和外部 MCP。插件执行与每次 MCP 调用都会重新检查启用状态、外部开关、发布者信任、签名和包摘要；磁盘篡改会 fail closed。

## 六个皮肤表面

官方 `milksu.skin-background` 使用六个固定宿主表面：

| 槽位 | 宿主范围 |
| --- | --- |
| `content-wallpaper` | AI 聊天画布与 CTF 题面 |
| `workspace-list` | 题目、会话、设置等标准列表 |
| `control-button` | 宿主标准按钮；危险、禁用、焦点状态仍由核心覆盖 |
| `workspace-topbar` | Coding/CTF/CVE 标题、筛选和操作区；不含原生标题栏或弹窗头 |
| `overlay-menu` | Select、Dropdown、ContextMenu、Popover、HoverCard |
| `chat-composer` | Composer 外壳、输入区和工具栏 |

每个表面初始为 `inherit`，完全保持核心原色。`solid` 提供系统原始、纸白、石墨、纯黑、青蓝、信号金、冷灰和自定义色；宿主自动选择黑/白前景并要求至少 4.5:1 对比度。`image` 为每个槽位选择独立 PNG/JPEG/WebP，限制 16 MiB 与 8192×8192，固定 `cover center`，可调 0..0.6 可见度与 0..24 模糊。

图片经 magic、解码头和尺寸检查后复制到插件 app-data。插件只得到资产句柄；渲染器通过受限 `milksu://app/__plugin-assets/...` 协议读取，不在活动主题里反复传 data URL。图片背景不参与命中测试，不改变按钮、输入、审批或 Judge 行为。

同一槽位的日间和夜间共用图片，但分别保存遮罩颜色与透明度。根 `data-theme`、组件库 `.dark`、全部遮罩和设置 iframe 在运行中同步；切换主题不重建 iframe、不丢失配置。每项可单独重置，也可恢复全部系统默认。

插件不能提交主页面 CSS 选择器或任意 `url()`。宿主通过 `data-plugin-surface`、`data-button`、`data-workspace-topbar` 和组件 `data-slot` 维护稳定接点。

## Runtime、设置 iframe 和 MCP

Lua 仅开放 base/string/table/math，禁用文件、网络、模块加载和 stdout。TypeScript 每次调用启动独立 Node 子进程，使用 64 MiB 老生代上限；Worker 删除环境变量和网络全局，入口限制为包内预编译 `.mjs/.js`，超时或取消会终止进程。两者都有 2 秒普通能力调用上限和 1 MiB 结果上限。

设置模块运行在 `sandbox="allow-scripts"`、无 `allow-same-origin` 的 iframe。父页只接受当前 frame、插件 ID、随机 nonce 和类型化方法；图片选择可等待用户，其余请求受 Runtime 超时约束。主题消息只传解析后的 `light`/`dark`。

外部 MCP 对所有插件默认关闭，用户逐插件开启。工具目录只包含当前已启用且允许外部暴露的只读工具，并同时发布审核过的输入、输出 Schema。安装、升级、卸载、权限、发布者信任或开关变化会使 MCP 重新载入注册表、增删工具并发送 `notifications/tools/list_changed`；每次调用仍重新验证签名、摘要、信任与开关。不协商动态通知的客户端需要按设置页提示重新连接。

官方 `milksu.tools-text` 贯通 Tool → TypeScript Runtime → Go Broker → Agent → 外部 MCP，提供本地文本统计和严格 Base64 编解码，不读取文件或网络。

## 发行检查表

```text
npm run plugins:build
npm run plugins:check
npm run plugins:test -- --source <template-or-plugin>
go test ./internal/plugin ./plugins
go test ./cmd/milksu-backend -run 'TestDesktop|TestInvoke|TestPluginMCP'
npm --prefix app run build
npm run test:sidecar
```

还必须在 Windows、macOS、Linux 从同一提交完成 Sidecar、Lua、TypeScript、签名安装和 MCP smoke，并执行 Electron 安装/信任/升级/回滚/卸载 E2E 与六表面日夜视觉 E2E。与插件无关的官方既有失败单独记录，不在插件周期顺手修改。

最终目视验收后删除 `build/plugin-*`、临时图片、测试 app-data 和测试密钥；一个 PR 只包含源码、Schema、模板、官方插件生成物、lock、测试和文档。
