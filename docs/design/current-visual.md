# 当前视觉约定

> 状态：Current
>
> 关联：[#15](https://github.com/MilkSU-Official/milksu/issues/15) · [PR 18](https://github.com/MilkSU-Official/milksu/pull/18)
>
> 产品表面按下面五层审。不要跨层发明第二套东西。旧「战术档案 / 酸绿」稿、`design-qa.md` 和
> `docs/design/game-ui/` 已删除，Git 历史可考古，不得再当实现约束。
>
> 审查：碰到新页面、Vue/CSS/文案的改动都按本页审一次。用户手动改了 UI，先问是否更新本页和
> `AGENTS.md`，不要默默改约定，也不要默默打回。

## 层级

| 层 | 管什么 | 实现落点 |
| --- | --- | --- |
| 1 材质 | token、颜色语义、字体 | `app/src/index.css`、`app/src/styles/` |
| 2 壳 | 模块轨、顶栏、页面栏 | `WorkspaceRail`、`WorkspaceTopBar` / `WorkspaceModuleTopBar`、`.page-column` |
| 3 列表指挥面 | 筛选、历史、执行按钮 | `.ak-segmented`、`WorkspaceCatalogActions`、`WorkspaceImportDialog` |
| 4 事实面 | 卡片、表、弹窗、浮层 | Felinic `SettingsSection` / `SettingsRow` / `ActionCard` / `ModelListRow`、`DialogPanel` |
| 5 文案 | 用户看得见的字 | `t('中文', 'English')` |
| 6 Agent 对话 | Coding / CTF / CVE / 实验室共用的对话区 | `[data-agent-conversation]`：思考条、工具行、审批、Prompt 岛；除代码块外不加对话卡片 |

行为仍走 Felinic。第 1–4 层（壳、列表、设置、档案）仍走 ak-ui token。不要把 `@yunyoujun/ak-ui` 写进 `app/package.json`。
**对话区是单独一套语言**，不要把设置卡片或列表指挥面套进 Agent 循环，也不要把对话区的芯片/思考条套回设置页。
功能、Desktop RPC、Judge、授权、Pi 工具循环不因换皮改语义。

## 1 材质

- 石墨指挥面、纸面事实、青、金。酸绿不进产品。
- 青 = 当前模块 / 主操作。金 = 次级强调 / 当前焦点条。成功绿只表示成功。
- 蓝只表示链接和明确的执行 / 诊断状态。不要用 `--info`、蓝边或蓝底去区分 CTF / CVE / 实验室 / Coding。Agent 对话区（第 6 层）可以用一条蓝做思考点和发送，不用于区分模块。
- 夜间用中性石墨，不要明显的蓝、绿、棕偏色。日间用纸面中性色；日间不要把指挥面钉成夜间石墨。
- 命令面（侧栏、会话历史、设置分类、右栏、输入框和菜单）走当前主题 token。事实面（题面、通知）走纸面。Agent 对话区走第 6 层，正文不加卡片。
- 字体：Inter Variable + Noto Sans SC Variable。不用宋体、Noto Serif 或系统 `serif`。
- 不用纸纹、碳纹、Showcase 角色图、理智条、3D 菜单。

## 2 壳

- 一级模块轨 `4.75rem` 图标栏。Coding 会话列表贴在同一条导航上。
- 设置、CTF / CVE / 实验室详情和个人资料共用 `--page-stack-width`（64rem）、`.page-scroll`、`.page-column`、`.page-stack`、`--page-card-radius`（0.45rem）。可编辑字段用 `--settings-field-fill`。活靶分栏时详情铺满左栏（`.page-stack--flush`）。
- 不要按页面再写 `max-w-3xl` / `4xl` / `5xl` / `6xl`。
- 全宽表保持全宽：CVE 列表、CTF 题库桌、实验室自定义任务。
- Coding 对话阅读仍用较窄的消息列。Composer 指挥面可以用 64rem 栏。
- Agent 对话区（消息流 + Composer）走第 6 层，不走第 4 层的 `SettingsSection` / `ak-notice`。

## 3 列表指挥面

CTF / CVE / 实验室列表页共用同一套指挥面，不要在某一页另做一套按钮或另开一页：

- 视图切换（全部 / 收藏，题目包 / 自定义任务）在顶栏 `#filters` 的 `.ak-segmented`。不要在标题栏 actions 里再放一套 Felinic SegmentedControl。
- 右上角是 **历史**（outline）+ 蓝色执行按钮（`--accent-blue-fill`，写在 `index.css` 的 `[data-workspace-catalog-actions]`）。
- **导入**只表示带入题目包 / 公开题库 / 公开 CVE。CTF 和 CVE 点开 `WorkspaceImportDialog`，同步和自定义都放在这个弹窗里。
- 实验室还没有题目包导入。执行按钮是 **创建**，弹窗是自定义任务。不要把创建叫成导入。
- 历史菜单行用 `WorkspaceCatalogHistoryItem`。不要在三个列表页各写一套 menu item。
- CTF **比赛模式**还没做。它不是练习列表上再塞一个金色按钮，而是另一套列表和操作（一场比赛、Agent 去比赛页打、以后组队）。实现前先过设计准入，并改本层约定。

## 4 事实面

- 卡片只用 Felinic `SettingsSection`、`SettingsRow`、`ActionCard`、`ModelListRow`。不要为单页再做一个卡片系统。
- 浮层用 `.tactical-floating-surface` 和 `--z-overlay`。不要发明第二套 z-index。
- 弹窗用 Felinic `Dialog` / `DialogPanel`。不要再用原生 `<dialog>` 做产品导入。
- 连接类微型状态用 `ConnectionLiveStatus`（`.ak-status.ak-status--compact` 的 LIVE / OFF）。列表或会话指挥面可以把芯片包进 outline 按钮（`[data-connection-live-action]`，CTF「浏览器已连接」）。设置页只显示芯片，检测 / 安装 / 授权仍是旁边的操作，不要把状态本身做成按钮，也不要用「已连接 / 未连接 / 已授权」纯文字当唯一状态。没有连接事实就不要硬放芯片；Browser Use「安装扩展」还没有本机连接回执。

## 5 文案

- 用户看得见的中文必须 `t('中文', 'English')`。改中文时同一编辑改英文。
- 空控件只留控件自己的标签。不要写「还没有 / 打开以后会出现」。
- 产品文案不放 harness 备注、内部阈值或「这不是 X」。
- Agent 循环的消息流叫 **对话区**，不叫「成绩单」。

## 6 Agent 对话

Coding Agent 的对话区（CTF / CVE / 实验室小窗共用同一套 `ChatPage`）按 Agent 循环来画，不按设置页来画。实现落在 `[data-agent-conversation]` 和 `app/src/styles/agent-conversation.css`。

- 材质：冷中性纸面。对话区几乎不加原生卡片：用户消息、助手正文、工具行、审批、压缩条都是排版，没有描边圆角底。代码块可以是深色圆角块（半径 8）。Prompt 岛仍是输入面（半径 16）。强调色可以是一条蓝（思考点、发送），不再用战术切角气泡或 YOU / MILKSU 字标。
- 列宽：思考、工具、回复、用户消息、Composer 共用中间一列，宽度约为对话主栏的 72%（小窗 88%），随窗口等比缩放。两侧留白，窗口变窄时留白变少。不钉死 `42rem` / `max-w-3xl`。用户消息贴这一列的右缘；思考和工具贴左缘。工具行的秒数跟在路径后面，不拉到列的右缘。
- 思考：Beautiful UI 式可展开「想了 Ns」，单独一行，不包进回复卡片。正文只来自 Pi 的 `thinking` 块。
- 工具：Codex 式一行文字（`Read` / `Edit +N -N` / `bash` + 路径 + 时长），没有芯片卡片。点开才看输入/结果；展开外层不加卡片，原文可以走代码块。
- 审批：同一列的标题 + 按钮，不加 HITL 卡片壳。按钮仍是拒绝 / 允许这一次 / 本对话始终允许。
- 回答：同一列里的正文，不另缩一截。来源是下划线链接，只接线真实 `https`。
- Composer：同一列宽的岛状输入。不使用青色左边条。

壳、列表、设置、档案仍用第 1–4 层。

## 已退役

这些不是当前约束，不要为它们写测试或文档禁令：

- 战术档案 / 酸绿 / `game-focus-panel` / `game-surface`
- CVE「添加 CVE」顶栏按钮、CTF「同步导入」顶栏按钮、自定义题目整页、`screen === 'source'` 训练步骤条
- 设置浏览器控制只用「已连接 / 已授权」描述、没有 LIVE/OFF
- 学习专题
- Agent 对话里的 YOU / MILKSU 字标、切角 `clip-path` 气泡、审批 ASK / HOLD / STOP 字标
- Agent 对话里的用户圆角气泡、工具芯片卡片、HITL 审批卡片壳
