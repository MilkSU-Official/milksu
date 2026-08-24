# MilkSU 插件框架试用指南

> 状态：实验性功能，尚未随当前正式版发布
>
> 事实审计：2026-08-24
>
> 本页面向插件使用者和作者，介绍当前开发版本中的功能与使用方法。正式发行状态以[当前开发目标](./current-objectives.md)、[文档与事实状态](./document-status.md)、GitHub Release 和维护者公告为准。

## 欢迎体验

MilkSU 插件框架为桌面端提供本地、可审阅的扩展方式。它已经贯通创建、测试、签名、安装、信任、启用、升级、回滚和卸载流程，并以 `milksu.plugin/v1` 作为稳定的包与 API 契约。

框架目前处于正式发行前的试用阶段。这个状态表示我们仍在收集 Windows、macOS、Linux 和更多真实界面的使用反馈，不影响你体验现有功能或按 v1 契约开发插件。

当前可以使用：

- 本地签名 `.milksu-plugin` 包；
- 受限 Lua 和预编译 TypeScript Runtime；
- 插件自己的隔离设置页面；
- 只读 Agent 工具；
- 默认关闭、可逐插件开启的只读外部 MCP；
- 六个可独立配置的皮肤表面；
- 创建模板、生成密钥、测试、打包和验证工具。

v1 暂不包含在线插件市场、远程自动更新、原生 Rust ABI、WASM Runtime 和第三方写工具。这些是当前版本的明确范围，不影响本地插件的完整使用循环。

## 安装和管理插件

在“设置 → 插件”中可以完成日常管理：

1. 点击“安装插件”，选择本机 `.milksu-plugin` 文件。
2. 查看插件名称、版本、发布者指纹、权限、表面、工具和宿主兼容范围。
3. 首次安装某位发布者的插件时，核对指纹并确认信任。
4. 安装完成后启用插件；需要暂时停用时，已有配置会继续保留。
5. 安装新版本时查看权限和版本变化；框架会保留上一版本用于健康检查失败后的回滚。
6. 不再使用时，可选择“卸载并保留数据”或“卸载并删除数据”。

已信任发布者可以在同一页面管理。撤销信任后，该发布者的插件和外部 MCP 会停用；以后仍可通过重新安装并确认指纹恢复信任。

插件签名用于确认发布者身份和包内容完整性。它让安装和升级过程更容易核对，但不自动表示该插件是 MilkSU 官方插件；官方插件身份和发行收录仍由项目维护流程决定。

## 设置背景皮肤

官方 `milksu.skin-background` 提供六个独立表面：

| 表面 | 影响范围 |
| --- | --- |
| 内容壁纸 | AI 聊天画布和 CTF 题面 |
| 工作区列表 | 题目、会话、设置等标准列表和列表行 |
| 控制按钮 | 宿主标准按钮；危险、禁用和焦点状态继续由核心样式控制 |
| 工作区顶部栏 | Coding、CTF、CVE 的标题、筛选和操作区，不包含系统标题栏或普通弹窗头 |
| 下拉表面 | Select、Dropdown、ContextMenu、Popover 等共享菜单 |
| Composer | 输入外壳、编辑区和工具栏，不改变输入和点击行为 |

所有表面的初始值都是“跟随系统原始样式”。未配置皮肤时，页面继续使用 MilkSU 原有颜色和日夜主题。

每个表面都可以单独选择：

- 系统默认；
- 纸白、石墨、纯黑、青蓝、信号金、冷灰等预设纯色；
- 自动适配黑白文字的自定义纯色；
- 独立的 PNG、JPEG 或 WebP 图片。

选择图片后，可以调整图片可见度、模糊，以及日间和夜间各自的遮罩颜色与强度。同一表面在日夜模式下共用图片，切换主题时会自动切换遮罩并保留配置。背景图层不会拦截按钮、输入框、Judge 或菜单操作。

如果希望回到原始外观，可以重置单个表面，也可以使用“恢复全部系统默认”。导入的图片会复制到插件 app-data，以资产句柄使用，不依赖原图片继续保留在原目录。

## 使用只读工具和外部 MCP

第三方 v1 工具目前只提供只读能力。工具的输入和输出都会按声明的 Schema 校验，从而让 Agent 和外部客户端获得稳定、可预期的结果。

外部 MCP 默认关闭。需要时，在插件详情中单独打开“外部 MCP”即可；只有已启用、发布者受信任且完整性检查通过的插件工具会进入工具列表。关闭开关或停用插件后，工具会从目录移除。不支持工具列表动态通知的客户端重新连接一次即可看到最新目录。

官方 `milksu.tools-text` 是完整链路示例，提供本地文本统计和 Base64 编解码，可用于确认 Tool → Runtime → Broker → Agent → 外部 MCP 是否工作正常。

## 开发自己的插件

先在仓库根目录安装项目依赖。首次启动开发环境：

```text
npm run plugins:dev -- --open-settings
```

重复进行目视测试且源码和官方插件生成物没有变化时，可以快速启动：

```text
npm run plugins:dev -- --no-build --open-settings
```

开发模式默认使用 `build/plugin-dev-appdata`，与正式应用数据隔离。也可以通过 `--app-data=<目录>` 指定其他测试目录。

创建、测试和签名一个 TypeScript 只读工具插件：

```text
npm run plugins:keygen -- --publisher "Example Publisher" --out ./private/example.publisher-key.json
npm run plugins:create -- --runtime typescript --id example.text-tools --name "Example Tools" --publisher "Example Publisher" --key-id <fingerprint> --out ./plugins/dev/example.text-tools
npm run plugins:test -- --source ./plugins/dev/example.text-tools
npm run plugins:pack -- --source ./plugins/dev/example.text-tools --key ./private/example.publisher-key.json --out ./example.text-tools.milksu-plugin
npm run plugins:verify -- --package ./example.text-tools.milksu-plugin
```

创建 Lua 皮肤模板时，把命令中的 `--runtime typescript` 改为 `--runtime lua`。私钥只会写入作者指定的位置，不会打印到终端；建议将私钥目录加入本机忽略规则，不随源码提交。

完整 Manifest、Runtime、签名包、存储、MCP 和主题约束见[插件框架技术契约](./plugin-framework.md)。

## 兼容性与维护方式

v1 使用严格 SemVer。插件会声明最低宿主版本和必需能力；条件不满足时，设置页会保持插件不可用并显示原因。升级需要保持插件 ID 和发布者身份，版本必须上升；权限扩大或主版本变化会再次提示确认。

框架通过签名验证、包完整性复核、权限确认、受限 Runtime、事务存储和可回滚升级降低扩展带来的意外影响。像使用其他本机扩展一样，选择来源明确、指纹可核对的插件即可获得更顺畅的体验。

反馈问题时，提供以下信息通常最有帮助：

- MilkSU 源码提交或正式版本号；
- 操作系统和架构；
- 插件 ID、版本、Runtime 和发布者指纹；
- 简短的复现步骤、预期结果和实际结果；
- 停用、回滚或恢复系统默认后是否恢复。

日志或截图中的访问令牌、私钥、个人路径和敏感题目内容请先隐去。

## 与项目治理文档的关系

本指南只补充使用方法，不改变项目现有治理和发行规则：

- 当前代码、测试和真实平台回执仍是实现事实；
- 正式发行状态由[当前开发目标](./current-objectives.md)和[文档与事实状态](./document-status.md)维护；
- 运行结构和安全边界分别以[当前系统与分层](../architecture/current-system.md)和[安全能力边界](./security-agent-boundary.md)为准；
- 官方插件 ID、内置收录、发布节奏和支持范围由维护者依照现有贡献与发行流程决定。

如果本指南与上述文档或当前实现不一致，应以上述事实入口为准，并欢迎提交文档修正。
