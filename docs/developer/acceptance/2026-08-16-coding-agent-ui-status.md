# Coding Agent GUI 测试状态表

更新时间：2026-08-17

这是本轮唯一状态表。后续只更新现有 C 编号的状态和证据；新增场景继续顺延编号，不用通用发版门禁替代本表。

| 编号 | 场景 | 当前状态 | 证据/问题 |
| --- | --- | --- | --- |
| C1 | 中文任务操作语言 | Pass | Desktop 把界面语言随每轮 Runtime 命令传给 Sidecar；Pi Harness 的 `before_agent_start` 扩展统一注入目标可见语言，以及真实 OS、架构、Shell 和路径规则，覆盖普通输入、产品动作、快捷动作、进度、图表和生成产物。Go Runtime、应用生产构建、Sidecar 252/252 通过；用户已在本地 Stable 包完成真实界面验收并确认通过 |
| C2 | 工具错误展示 | 已修 / 暂不验收 | Runtime 启动与运行错误已收敛为可行动中文提示；本次补齐工具卡片错误投影，`Access to this API has been restricted`、`--allow-fs-read/write`、401、`baseUrl`、Node/bridge 内部异常不再显示原文，普通测试失败输出仍保留；原始错误只进入既有脱敏诊断记录。`useConversations` 25/25 与后台诊断测试通过；用户要求当前先不处理 C2，保留改动、暂不占用验收时间 |
| C3 | 跨目录文件与 Shell | 已修 / 待用户验收 | 普通 Coding 已删除 Desktop 会话授权根、`milksu_workspace_*` 工具、Node `--allow-fs-*`、后台任务授权令牌和 `sandbox-exec` workspace-only 路径，文件读写与 Bash 恢复为 Pi 内置工具及当前系统用户权限；宿主只记录会话 cwd、隔离 Provider 凭据与后台私有日志，并在递归删除 Home、当前 cwd 或大型目录前二次确认。重启后如果前端仍持有旧 Pi session ID，steering 会清理旧运行态并自动按普通消息重建 session，不再把 ID 错误显示给用户。前端 447/447、Sidecar 258/258、Go 全仓、Vue 生产构建和 lint 通过；仍需用户在新 Stable 包里复测绝对路径真实读写和重启后的连续对话，未确认前不记 Pass |
| C4 | 内置浏览器右栏 | Pass | Stable 包用 Computer Use 打开 `https://example.com`：菜单可显示在网页上层；切回“环境信息”后网页从视觉层和 AX 树完全消失；再切回浏览器时原页面与地址仍保留。隐藏时卸载原生 View、显示时重新挂载的生命周期通过实机验收 |
| C5 | 架构图 | TODO / 本轮后置 | 删除特殊页面，改为自然语言确认对接要求 → 用户回答 → 生成普通 HTML → 内置浏览器展示 → 询问是否调整；禁止向用户展示 JSON 草稿 |
| C6 | 底部终端 | Pass | Computer Use 先复现 Stop 后输入无效且无恢复入口、每个 Tab 无关闭；现已提供单 Tab 关闭和停止后的“重新启动当前 Shell”。本地 Stable 包实测：停止后输入区只读并出现重启按钮，重启后 `printf C6RESTARTED` 正常返回，关闭 Tab 后从栏中移除。Go terminal/backend、Vue 组件测试及生产构建通过 |
| C7 | 新建编码任务点击区 | Pass | Computer Use 先复现按钮上半区无响应、下半区一次创建；抽屉内容改为避开 macOS `hiddenInset` 标题栏拖拽区后重新构建，在按钮最上方约 5px 处一次点击即创建新任务；`AppSidebar.test.ts` 9/9 通过 |
| C8 | 斜杠菜单 | 初步 Pass | `/` 菜单可打开，条目和禁用状态可读；还需验选择动作 |
| C9 | 附件与图片输入 | 部分 Pass / 点击入口后置 | 用户已确认 `⌘V` 粘贴图片可以进入附件栏并发送；“+ → 本机文件或图片”仍存在真实点击无响应。附件顺序、预览、移除及 Pi 图片协议保留现有实现；按本轮发版优先级，点击入口不再阻塞当前 C18/C19 收口，后续单独修复 |
| C10 | subagent | Fail / 后续修复 | 用户明确要求“开个 subagent 帮我查 subapi 信息”，Agent 未委托子 Agent，反而调用 MCP 并检查 IDA Pro 的进程、端口和本地目录。需验证多 Agent 工具的真实暴露、能力说明和自然语言路由，禁止把 `subapi` 误判为 IDA Pro |
| C11 | 替我审批/完全访问 | 部分 Pass | 菜单三档可见；还需验真实权限效果 |
| C12 | 常规改文件/跑测试 | 待测 | 要用安全小文件/只读命令回归 |
| C13 | 单会话相关历史前端 | Pass | Coding 右栏和 CTF 工作区已移除 `SessionHistoryPanel`、图谱/过滤/搜索/引用入口；保留底层 Obelisk 与 CTF 训练记忆。25 项路由契约测试通过；本地 Stable 包用 Computer Use 展开右栏菜单，仅有“环境信息、变更、产物、浏览器”，页面 AX 树无“相关历史”入口或面板 |
| C14 | Stable 验收包启动完整性 | Pass | 已把 `browser-view-attachment.cjs` 加入 `app.asar` 白名单，并增加本地 `require` 打包完整性测试；4/4 定向测试通过。重新构建后先检查整屏，主界面正常启动、无主进程报错，Computer Use 可读取 Stable 界面 |
| C15 | 右侧栏拖拽调整宽度 | TODO | 左边缘提供拖拽手柄，设置合理最小/最大宽度并记住用户选择；环境、变更、产物和浏览器内容随宽度重排。先完成 C4 生命周期验收，再单独实现和验收 |
| C16 | 内置浏览器标签页 | Fail | Computer Use 确认“新标签页”目前只是标题文本，未接操作；应提供 `+` 新建、单标签关闭和独立保留地址/前进后退状态，不能用重置当前页面冒充新标签页 |
| C17 | 大范围删除二次确认 | Pass / 用户接受自动化证据 | 按 Pi 官方 Permission Gate 模式接入 `tool_call` 前置钩子，而不是只写 Skill。执行递归删除前展开 `~`、POSIX/PowerShell/Windows 环境变量，解析相对路径、通配符和符号链接；用户 Home、文件系统根、当前会话 cwd、超过 1000 项或 1 GiB 的目录即使在“完全访问”也会展示规范化路径、影响和原命令并单独确认。无法规范化的变量/命令替换直接阻止并要求模型改用明确绝对路径；普通文件和小目录不增加确认。跨平台解析与大小边界及 Sidecar 全量通过；用户明确接受自动化证据，不再要求本轮手工验收 |
| C18 | 多模态模型身份与图片路由 | Pass | 修复 TokenFlux 模型目录缓存未就绪时把 Grok 4.5 兜底注册为 `text-only` 的问题：已确认的 `grok-4.5` 与 `x-ai/grok-4.5` 现在注册 `text + image`，未知模型仍保守保持纯文本。Pi `before_agent_start` 同步注入当前模型真实图片能力，禁止多模态模型声称自己纯文本或在没有 OCR 证据时声称使用 OCR。焦点 20/20、Sidecar 全量 261/261 通过；用户已在本地 Stable 包完成真实验收并确认通过 |
| C19 | 实时网页搜索与查证 | Pass | 已直接装载 Pi PR `#3080`、revision `53e430c` 的 `web_search` / `web_fetch` Extension；MilkSU 只接入现有 Coding 工具档位，不增加搜索关键词路由或第二套 harness。Sidecar 263/263、Go 全仓、前端 448/448 通过；真实联网工具测试以“Grok 4.5 是否支持图片输入”为题，先得到 xAI 官方文档搜索结果，再成功读取该官方页面。首次包验发现 Extension 被误当工厂提前执行，已改为直接交给 Pi Resource Loader；重打包后真实 `create_session` 返回 `web_search` / `web_fetch` 且 `extensionErrors=[]`，用户已完成 Stable GUI 验收并确认通过 |
| C20 | 输入框原生撤销 | Fail / 本轮后置 | 用户确认当前编辑器按 `⌘Z` 无法撤销。发版优先级低于 C18/C19，本轮不扩展修改面；后续应补标准文本编辑器撤销/重做语义与真实键盘验收 |
| C21 | 普通 Coding 回答风格 | 已修 / 待用户验收 | 已删除普通 Coding 的 workspace policy guidance、目录授权 broker prompt 和客服式回答约束；没有 typed 产品动作时，MilkSU 不再追加回答结构、收尾话术或“下一步”模板，保留的无凭据 Runtime context 只提供界面语言、OS、架构、路径分隔符、Shell、当前模型图片能力与实时查证事实。模型正文按 Pi 原生会话输出投影；Sidecar 258/258 通过，仍需新 Stable 包用普通 `hi`、简短任务和跨目录任务确认无固定长尾 |

## 使用规则

- 自动化测试只能把对应项更新为“自动化通过”，不能代替 Computer Use 用户视角验收。
- 当前所有 C 项完成后，再执行交付文档中的通用发版前 Agent GUI 基线门禁。
- 新发现的问题从 C14 开始继续追加，不重排现有编号。

## 本轮用户验收包

- 路径：`/Users/milksu/code/milksu/build/bin/MilkSU.app`
- 渠道：Stable 本地验收包；ad-hoc 签名，不用于正式发布或 macOS TCC/Computer Use 权限结论
- 源码：`main@f65c0a7` + 当前 C3/C21 未提交工作树；source fingerprint `176d46be5d03846104ca85f4b03edd74d898c0f9f27e980c49f347fcafdbd8f9f`
- 版本：`26.816.2`
- Tracking ID：`8bed3ff820cf591201dd64d3a2ea72f7d72ad004463cbf6a942a2e270483bbfe`
- 构建时间：`2026-08-16T20:18:49.142Z`
- 本轮重点：C3 Pi 原生跨目录文件与 Shell、C21 Pi 原生回答风格。C19 Pi `web_search` / `web_fetch` 已通过用户验收，不再重复测试。C3 新包验收提示词：`进入 /Users/milksu/code/milksu，创建 test1234.md，写入 C3_OK，再读取确认。` 预期直接使用 Pi 文件或 Bash 工具完成；不得出现 MilkSU workspace 授权工具、权限组件启动失败、`Operation not permitted` 或 `PI session not found`。再重启 App 并在同一会话继续一次只读命令，确认旧 session 自动重建。验收后删除探针文件。C21 用普通 `hi`、简短任务和跨目录任务确认回复没有固定客服长尾、编号菜单或“下一步”模板。C9 的加号点击与 C20 原生撤销明确后置
