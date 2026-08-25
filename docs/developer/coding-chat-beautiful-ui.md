# Coding 对话：Beautiful UI 原语对照与沿用切片

> 文档状态：**Target / Implementing in this PR**
>
> 选定范围：Coding Agent 对话框（`ChatPage` 对话区 + Composer）。CTF / CVE / 实验室小窗走同一套对话组件，换皮会一起变，除非显式做成 Coding-only 分支。
>
> 缺什么：桌面点选真实工具 + 思考回合仍待验收。实现已落在 `[data-agent-conversation]`。
>
> 来源：[Beautiful UI](https://www.beautifului.dev/) · [slev12397/beautiful-ui](https://github.com/slev12397/beautiful-ui) · MIT · 审阅提交 `fa3ed75`（2026-08-24）。版权 Shane Levine, 2026。

## 目标

让 Coding Agent 对话框读起来像为工具循环、思考轨迹、人机审批和流式回答准备的，而不是把通用设置卡片硬套进聊天。

- 沿用 Beautiful UI **已经验证过的交互骨架**（工具行、可展开思考、审批操作、Prompt 岛、流式正文后的来源/追问），不是把它的 React 演示或冰淇淋主题整包搬进来。对话区视觉跟 Codex：除代码块外几乎不加原生卡片。
- 视觉仍落在 MilkSU 五层约定上，或在动手前明确改约定。禁止默默引入第二套材质。
- 行为仍走 Felinic。不把 `@yunyoujun/ak-ui` 写进 `app/package.json`。不引入 React 运行时、`@central-icons-react` 商用图标，也不整份粘贴对方的 `globals.css`。

## 现状

Beautiful UI 自称「给 AI-native 产品用的 copy-paste 原语」。仓库是 Next.js App Router + React 19 + Tailwind CSS v4，每个原语一个 `components/primitives/*.tsx`。图库组件几乎都是带 `setTimeout` 的演示：写死的冰淇淋文案、按节拍播放，然后停在可展开状态。它**不是** npm 组件库，也接不上 Pi 事件。

MilkSU 对话面已经有完整产品职责，只是形态偏通用指挥面：

| 当前落点 | 现在长什么样 |
| --- | --- |
| `ChatPage.vue` | 对话区列（宽约 `max-w-3xl`）+ 空画布标题「我们要构建什么」+ compacting 条 |
| `ChatMessageItem.vue` | YOU / MILKSU 气泡、附件芯片、`MarkdownContent`、`AkLoadingMark`；审批是 `ak-notice` + HOLD / OK / STOP |
| `ChatActivityGroup.vue` | 一轮工具的 `<details>`：摘要行 + 每条工具的 `<pre>` 输入/结果 |
| `ChatComposer.vue` | slash、附件、模型、思考档位、审批策略、上下文环、运行时长、steer 队列、Skill / Scope token |
| `AgentExecutionPlan.vue` | `milksu_progress` 步骤列表（完成 / 进行中 / 待开始） |
| `AkLoadingMark.vue` | ak-ui 紧凑转圈 |
| `MarkdownContent.vue` | markdown-it HTML；代码块没有独立复制条 |
| `CodingChangesPanel.vue` + `CodingDiffHunks.vue` | 右栏 Git diff，不在对话区里 |
| `ConversationDock.vue` | CTF / CVE / 实验室对话小窗，复用同一 `ChatPage` |

`app` 已经用 Tailwind v4，这一点和 Beautiful UI 的工具链重合；冲突在材质层（石墨 / 纸面 / 青 / 金 vs 冷蓝中性 + 单一蓝色强调），以及框架（Vue 3 + Felinic vs React 19 + 自有 Button / `glimm` 着色器）。

对方 `package.json` 还依赖 `motion`、`glimm`、`cuelume`、`dialkit`、`liveline`，以及 **付费** `@central-icons-react`（`SidebarNav` 在 `npm install` 时做许可证检查）。这些都不能进 MilkSU 产品链。

## 原语对照

图库首页 12 块，加上仓库里未上首页的原语。判定只针对 **Coding 对话框**，不是整站换皮。

| Beautiful UI | MilkSU 当前 | 判定 | 沿用什么 |
| --- | --- | --- | --- |
| **Tool Chips** | `ChatActivityGroup` 把工具输入/结果整段倒进 `<pre>` | **优先沿用交互，去掉芯片卡片** | 一行文字（`Read greet.ts`、`Edit +13 −41`），点开再看原文。语义仍绑 Pi 工具事件，不播演示节拍，外层不加圆角卡片。 |
| **Thinking**（Steps / Reasoning / Search / Coding） | Composer 有思考档位滑块；对话区没有可展开推理轨迹 | **有事件才沿用** | 可展开「想了 Ns」+ 步骤 / 检索 / 编码轨迹。没有 Pi reasoning / step 事件就不要演一段假思考。 |
| **Approval Card** | `ChatMessageItem` 的 `ak-notice`：拒绝 / 允许这一次 / 本对话始终允许 | **沿用语义，去掉卡片壳** | 同一列标题 + 按钮。选项必须仍是 MilkSU 审批策略（once / conversation、grantable）。不要换成多选题问卷，也不要 HITL 圆角卡片。 |
| **Prompt Bar** | `ChatComposer` 已经有 `@`/`/`、附件、模型、发送 | **沿用密度，不换职责** | 岛状输入、@ 来源菜单、/ 命令、模型选择。保留上下文环、steer 队列、思考档位、审批策略、Skill / Scope。不要 `glimm` 彩虹扫光，也不要 Figma / Slack / Gmail 连接器。听写要三端权限面，本切片不做。 |
| **Streaming Text** | `MarkdownContent` 一次渲染整段 Markdown | **部分沿用** | 流式过程中的稳定排版；回答结束后的来源链接，且来源必须来自真实 `web_search` / `web_fetch`。追问可以接 Composer，但空画布不许写「还没有 / 打开以后会出现」式教练文案。不要 blur-to-text 表演。 |
| **Loading State** | `AkLoadingMark` + Composer 运行时长 | **弱沿用** | 保留「进行中 + 已用时间」。像素格 Drive / Dots / Orbit / Surfer 和 meme 视频不进产品。 |
| **Task Rows** | `AgentExecutionPlan` | **形态可并** | 进行中 / 失败 / 完成 + 可展开子步骤。不要和第二套工具组抢事件；计划仍来自 `milksu_progress`。 |
| **Chat**（带标签的整页 harness） | `ChatPage` + 轨上会话列表 + `ConversationDock` | **不替换** | 我们已有会话轨和小窗。不要冰淇淋主题的 Flavors / Suppliers 标签页。 |
| **CodeBlock** | `MarkdownContent` 的 `<pre>` | **可沿用壳** | 语言标记、复制、行内等宽。高亮走现有 Markdown 管道，不引入对方写死的 token 调色。 |
| **Context Cards** | `DomainTaskContextPanel`、CTF 题面 / 证据；对话里没有 RAG 卡片 | **领域有块再做** | 检索块 + 来源文件名的形态，可投影 Evidence / Memory / 附件切片。没有检索子系统就不要空卡片。 |
| **Recommendation Card** | 无；MCP 审阅是设置/环境里的 `SettingsSection` | **默认不做** | 假置信度条会把内部阈值漏到用户文案。Agent 建议继续用审批操作或计划行。 |
| **Diff Table** | `CodingChangesPanel` 是文件 diff，不是表行编辑 | **不进对话区** | 「点行切换是否应用」可作右栏审阅参考，不把 CRM 表塞进气泡。 |
| **Records Table** / **FilterTable** | CTF / CVE / 实验室列表已有指挥面 | **对话框外** | 不换列表页。 |
| **SidebarNav** | `WorkspaceRail` | **禁止** | 壳层已有模块轨。该原语绑付费 Central Icons。 |
| **FineTuneCard** / **InsightCards** / **GlideMenu** / **Flowchart** / **SearchList** / **SelectionActions** | 无对应对话职责 | **不做** | Fine-tune 不是产品面。流程图已有 `milksu_archify`。 |

## 设计语言分叉（动手前必须选定）

Beautiful UI 的材质是冷蓝中性、实线 hairline、单一蓝色强调、chip 6 / control 8 / card 10 的半径、Inter + JetBrains Mono。MilkSU 当前约定是石墨指挥面 / 纸面事实 / 青 / 金，蓝只表示链接和执行，字体是 Inter Variable + Noto Sans SC Variable，事实卡片走 Felinic `SettingsSection` / `ActionCard`。

这不是小修。用户（不是代理）提出沿用该库后，必须在下面两选一，禁止默默改约定，也禁止默默打回：

1. **更新设计语言**：改 [当前视觉约定](../design/current-visual.md)、`AGENTS.md` 本段、共享 CSS / token，以及 `WorkspaceVisualContract` / `globalStyleContract`。第 6 层为 Agent 对话区增加一族原语（工具行、思考轨迹、扁平审批、Prompt 岛；除代码块外不加对话卡片），设置页卡片不变。后续页面跟新规则。
2. **保持当前语言，把对话对话区当一处特例**：沿用交互骨架，颜色 / 半径 / 字体仍走现有 token。隔离在 `ChatPage` / `ChatMessageItem` / `ChatActivityGroup` / `ChatComposer` / `AgentExecutionPlan`，并在视觉合同测试里写明「对话特例、不是第二套全站卡片」。

未选定前，本切片不改 Vue。

## 产品代码准入

1. **用户看见什么**：同一轮里，工具调用是一行文字、思考可展开、审批是标题加按钮而不是卡片、Composer 仍能完成现有发送职责。
2. **最小纵切**：先把 `ChatActivityGroup` 收成 Tool Chips 形态，事件源仍是现有 `chatActivity` 投影。
3. **上游阶梯**：不能把 React 图库当 npm 依赖丢进 Vue（第一层不够）。Beautiful UI 是 MIT、源码可审阅的 copy-paste 原语（第三层：抽最小片段并改成 Vue）。第二层没有现成的 Vue / Felinic Agent 原语包。Star 数（审阅时约 27）不构成成熟性；用处是图库里的交互证据，不是供应链背书。
4. **成功怎么判**：固定一轮「多次 `read`/`edit`/`bash` + 一次审批」的真实任务。对话区默认折叠工具细节，展开能看到同一条输入/结果；审批仍是拒绝 / 一次 / 本对话；中英 `t()` 成对。截图不能代替走一遍。
5. **怎么删**：去掉 Vue 端口文件，对话区回到当前 `<details>` / `ak-notice`。NOTICE 里若已记 Beautiful UI 归属则一并删。
6. **三端**：只动 Vue / CSS，走现有 token。不写本机路径、不绑 macOS 听写、不把 Windows / Linux 留成空白。听写 / 系统图标若以后做，必须三端都有产品路径。
7. **视觉**：必须先回答上一节的分叉。新对话原语不得发明第二套 `--info` 蓝底来区分模块。

许可证：MilkSU 是 AGPL-3.0-only，可以纳入 MIT 片段；若复制 substantial 代码，保留 Shane Levine 版权声明，并在 `NOTICE` / `third_party/licenses/` 记一笔。**不要**纳入 `@central-icons-react`。

## 从 Beautiful UI 反推：Pi 已有、对话区没投影

ak-ui 是指挥面 / 设置卡片用的。Pi 自己的 TUI 已经按「思考块、工具行、审批、压缩、用量、会话树」在画 Agent 循环。Beautiful UI 的原语和 Pi TUI 同一类，正好用来核对：**Pi 事件到了 Sidecar，桌面对话区有没有把它画出来。**

审阅对象是钉住的 Pi `0.84.1`（`@earendil-works/pi-ai` / `pi-coding-agent`）。桥在 `sidecar/pi/bridge.js` 的 `message_update` / `message_end`。

### 桥接层已经丢掉的块

Pi 助手消息的 content 是分类型的：`text` / `thinking` / `image` / `toolCall`。流式事件有 `text_delta` 也有 `thinking_start` / `thinking_delta` / `thinking_end`。

当前桥只转发 `text_delta`，`projectAssistantMessageEnd` 的 `textContent()` 只拼接 `type === "text"`。思考正文、思考签名、红acted 思考都不进 Desktop RPC，也不进 `Message.content`。Composer 的思考档位滑块只改请求参数，对话区上看不到「想了 Ns」。

`edit` / `write` 的 `formatToolInput` 只留下路径，没有 `+N / −N` 芯片；工具结果里的图（Computer Use / 浏览器截图）除了纯文本模型的 OCR 旁路，不会作为对话区里的图芯片出现。

### 对照：Beautiful UI 原语 → Pi 能力 → 当前桌面

| Beautiful UI 在问什么 | Pi 已经有 | 当前桌面 | 重构后应看见 |
| --- | --- | --- | --- |
| **Thinking** 可展开轨迹 | `ThinkingContent`；`thinking_*` 流；TUI 可用 Ctrl+T 折叠；压缩序列化写成 `[Assistant thinking]` | 档位滑块 + 用量环上的 reasoning token。对话区无思考块 | 「想了 Ns」展开条，正文来自 Pi，不演假步骤 |
| **Tool Chips** 一行摘要 + 文件名 | `tool_execution_start/update/end`；args / result；edit/write/bash | `ChatActivityGroup` 把输入/结果倒进 `<pre>` | 一行文字：`Read greet.ts`、`Edit +12 −4`、`bash npm test`；展开才是原文，外层不加卡片 |
| **Approval Card** HITL | 审批 broker；once / conversation | `ak-notice` + HOLD / OK / STOP | 同一语义，去掉卡片壳 |
| **Streaming Text** 来源 / 追问 | `text_delta` 已投影；`web_search` / `web_fetch` 结果在工具输出里 | 正文进气泡；来源埋在工具 `<pre>` | 回答下沿用来源链接，只接线真实工具结果 |
| **Task Rows** 活任务 | `milksu_progress`；`subagent`（含 usage）；`bg_task` / `bg_status`；Goal | 计划在右栏；子 Agent / 后台是普通工具行或右栏面板 | 计划 + 子 Agent + 后台失败/完成收进同一族行，不另造循环 |
| **Context Cards** 检索块 | 压缩 `fileOps` / read-files / modified-files；附件切片 | compacting 只有「正在整理上下文」，没有文件清单 | 压缩结束给一条横幅：整理了哪些旧消息、保留哪些文件 |
| **Prompt Bar** @ / / / 模型 / 队列 | TUI：`@` 文件、`/` 命令、Shift+Tab 思考档、Enter 转向、Alt+Enter 追问、`!command` | Composer 已有 slash、附件、模型、steer 队列、上下文环 | 岛状密度；补 `@` 项目文件模糊查找（Pi 已有，桌面未做） |
| **CodeBlock** | 助手 Markdown / 工具里的代码 | `MarkdownContent` `<pre>`，无复制条 | 语言 + 复制，高亮仍走现有 Markdown |
| **Chat / 会话树** | `/tree` `/fork` `/clone` `/resume`；session JSONL 是树 | 会话列表在轨上；没有「从某条用户消息分叉」 | 本切片不做树导航，只记缺口 |
| **Loading** 进行中 + 时长 | 回合计时、tool duration | `AkLoadingMark` + Composer 时长 | 保留时长；不要像素格 |

Pi TUI 还有、Beautiful UI 没有单独原语、桌面也几乎没画的：编辑器边框色随思考档位变化、页脚 cost、隐藏思考标签、`!` / `!!` shell、把上一轮助手消息复制出来。这些不从该图库反推，不塞进本切片。

### 不是图库发明的产品职责

下面这些是 MilkSU 已经投影、只是形态不对，不是「Pi 没做」：

- 审批策略、Skill / Scope token、隔离浏览器、Computer Use、Goal、LSP、ImageGen 付费确认。
- 上下文环把 cache-read 和 reasoning 分开：环上有，对话区没有。

不要为了填满 Beautiful UI 的 Recommendation Card / Records Table 去造假置信度或 CRM 表。

## 重构效果预览

选定设计语言之前，不改生产 Vue。预览稿：

`app/coding-chat-preview.html`

同一轮「改 `greet` + 跑测试」可在 **现在** 和 **重构** 之间切换。重构侧用 Tool Chips / Thinking / Approval Card / Prompt 岛接上面那张表；现在侧模拟当前 YOU/MILKSU 气泡 + `<details>` 工具组 + `ak-notice`。右侧说明当前点中的块接到哪条 Pi 事件、对话区现在丢掉了什么。

在 `app/` 下 `npm run dev`，打开 `/coding-chat-preview.html`。这不是产品面，不进发行包入口。

## 建议落地顺序（选定设计语言之后）

1. `ChatActivityGroup` → Tool Chips 骨架（最大阅读收益）。
2. 审批改成同一列标题 + 按钮，不改 once / conversation 语义，不加卡片壳。
3. Composer 岛的间距与 @ / / 菜单密度；不换现有命令表。
4. 若 Sidecar 已投影 reasoning / step：Thinking 展开条。没有事件就停。
5. Markdown 代码块壳（复制 / 语言）；来源芯片只接真实引用。

同一 `ChatPage` 被 Coding 整页和 CTF / CVE / 实验室小窗共用。默认四条工作区一起改。若只要 Coding 整页，必须加 `surface` 分支，并说明小窗为什么留旧形态。

## 测试方式

本 PR 只锁对照与准入，不改外观。

1. **合同测试（无窗口）**  
   `WorkspaceVisualContract`：对话源码和 `app/package.json` 不得出现 Beautiful UI 的 React 依赖、`@central-icons-react`、`glimm`、`bg-ink` / `text-ink-3`，也不得把 `@yunyoujun/ak-ui` 加进依赖。
2. **以后实现时**  
   现有 `ChatActivityGroup` / `ChatMessageItem` / `ChatComposer` 单测继续过。补：芯片默认折叠、展开揭示同一工具输入/结果、审批三按钮仍在、空画布仍只有产品标题。改过的对话面要在桌面运行时点一遍，不能只截一张静图。
3. **负向**  
   设置 / CTF 列表 / 模块轨不得被这族原语换掉。用户文案不得出现「Beautiful UI」「芯片原语」或内部阈值。

## 验收标准

- [x] 对照表覆盖图库 12 块和仓库其余原语，并标明优先 / 有事件才做 / 不做。
- [x] 写明不能 npm 整包、不能拷 `globals.css`、不能引入付费图标和 React 运行时。
- [x] 设计语言已选定：对话区为第 6 层，不是全站换皮。
- [x] 合同测试锁住依赖与 token 边界。
- [x] 选定设计语言：对话区单独成为第 6 层，设置/列表仍走 ak-ui。
- [x] 对话区实现思考条、工具行、扁平审批、压缩状态条；Pi `thinking_*` 已投影。除代码块外不加对话卡片。
- [ ] 未在桌面点选真实工具回合之前，不把换皮写成已发行完成。

## 非目标

- 把 Beautiful UI 的 `/harness` 冰淇淋会话当成产品。
- 为对话再开一套 React 岛或 iframe。
- 换掉 `WorkspaceRail`、设置页、CTF / CVE / 实验室列表指挥面。
- 听写、外部 SaaS 连接器、假置信度、像素格 loader、meme 视频。
- 改 Pi 工具循环、审批策略、Judge 或凭据边界。

## 删除路径

不合并后续实现 PR 即可。若已端口：还原五个对话组件和相关 CSS，合同测试应继续红灯直到依赖/token 泄漏消失。

## UI

对话区已换成思考条、工具行、扁平审批和岛状 Composer；用户消息与工具不加圆角卡片。文案继续 `t('中文', 'English')`。
