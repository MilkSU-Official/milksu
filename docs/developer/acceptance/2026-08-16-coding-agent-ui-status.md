# Coding Agent GUI 测试状态表

更新时间：2026-08-18

这是本轮唯一状态表。已 Pass 的 C1 / C3 / C4 / C6 / C7 / C13 / C14 / C17 / C18 / C19 / C21 不再占本页。后续只更新现有未闭环编号的状态和证据。

| 编号 | 场景 | 当前状态 | 证据/问题 |
| --- | --- | --- | --- |
| C2 | 工具错误展示 | 已修 / 暂不验收 | 代码已收敛为可行动中文提示。用户要求先不占验收时间。 |
| C5 | 架构图 | TODO / 本轮后置 | 删除特殊页面，改为自然语言确认对接要求 → 生成普通 HTML → 内置浏览器展示。不是本轮 GUI 回归。 |
| C8 | 斜杠菜单选中动作 | 自动化通过 / 待用户验收 | 键盘 Enter 与点击选项都会发出已有产品动作，而不是把 `/diff` 当普通消息发送。仍需 Stable 里点选一次。 |
| C9 | `+` → 本机文件或图片 | Pass | 在 `pointerdown` 时启动系统文件框，避免下拉关闭后丢失 Electron 用户手势；同一手势的 `select` 不再重复打开。`⌘V` 粘贴路径保持不变。用户已在本地 dirty Stable 包 `a7fb23c564b0d4a706e26a577b28e8d520aed0a07c601e126c44410db8d4ca7d` 确认通过 |
| C10 | subagent | 已修 / 待复验 | 委托已发生。随后发现子进程不认识父会话的虚拟 `milksu-route/...` 模型，报 Model not found 后主 Agent 自己改用 web_search。子 Agent 启动时已把 `milksu-route/` 改写成账户 TokenFlux 的 `milksu-relay/`。 |
| C11 | 替我审批 / 完全访问 | 部分 Pass | 三档菜单可见。还要用真实改文件/联网任务验权限效果。 |
| C12 | 常规改文件 / 跑测试 | 待测 | 要用安全小文件和只读命令做一次真实任务回归。 |
| C15 | 右侧栏拖拽调整宽度 | Pass | 左缘拖动手柄，宽度限制在 288–720px，写入 `localStorage`。环境、变更、产物、浏览器共用同一栏宽。用户已在同一本地 Stable 包确认通过 |
| C16 | 内置浏览器多标签 | Pass | `+` 在浏览器未启动时也可见。普通 Coding Go 或打开右栏会自动拉起隔离浏览器，不再要求设置或批准。每个标签是独立 `WebContentsView`；切换会换页并更新地址。用户已在本地 dirty Stable 包 `55773222cd27a0befd57d1d20b78005ac44eff84cfa3b22b1e7206080aec741b` 确认点击操作和标签切换通过。 |
| C20 | 输入框撤销 | Pass | 输入框自管撤销/重做栈。`⌘Z` / `Ctrl+Z` 撤销，`⌘⇧Z` / `Ctrl+Y` 重做；覆盖打字、粘贴、斜杠替换和提交清空。用户已在同一本地 Stable 包确认通过 |

## 使用规则

- 自动化测试只能把对应项更新为“自动化通过”，不能代替 Computer Use 用户视角验收。
- 当前所有 C 项完成后，再执行交付文档中的通用发版前 Agent GUI 基线门禁。
- 新发现的问题从 C14 开始继续追加，不重排现有编号。

## 本轮正式内测发行

- 版本：`26.817.1`
- Tag / 源码：`v26.817.1` / `main@783679f02e6586c624efc50164fa8c8c402bbda1`
- GitHub Release：`https://github.com/MilkSU-Official/milksu/releases/tag/v26.817.1`
- macOS ARM64 DMG SHA-256：`cb92f640132e984e2bf1139f19204c831b44e1d41da0733e918756ee6d08a60b`
- Windows x64 EXE SHA-256：`22ccae2f67bee571e759e69a5390f2b0891b04e165d9dcddcc1f4327a3ee1c91`
- macOS：标准拖拽安装布局、Developer ID 严格签名、Apple 公证、stapler 与 Gatekeeper 均通过。
- Windows：打包 Runtime 与首次启动检查通过；当前仍为未签名内测安装程序，可能显示 SmartScreen 提示。
- OTA：未发布。R2/Admin 草稿步骤因 GitHub `release` Environment 缺少 Cloudflare 与 publisher secrets 失败；GitHub DMG/EXE 内测分发不受影响，current pointer 未改变。
