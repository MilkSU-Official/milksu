# MilkSU 仓库指南

## 先读这些

动手改任何东西之前，先读：

1. `docs/developer/current-objectives.md`；
2. `docs/developer/document-status.md`；
3. `docs/architecture/current-system.md`；
4. 当前 Git 分支、HEAD 和工作树。

改模型窗口、输出上限或思考档位时，先查下面的「模型事实（models.dev）」。
不要给已知系列编造 128000 / 32768 / 16384 这种占位数。

产品 UI 语言只写在本文件（下面的「产品 UI 设计语言」）。
其他文档不要复述层级表、token 名或原语数字。

M3 product-loop 已在 2026-08-05 squash 合并进 `main`。从 `current-objectives.md`、
当前代码、测试和 Git 历史继续，不要重开那个已合并的 PR、退役台账或旧 sprint 缺口。
做下一个有界纵切；相邻的非阻塞 bug 记在对应代码旁或当前目标笔记里，不要顺手修。
只有在问题挡住当前纵切、威胁数据/凭据/Scope/私有远端边界，或让验收结论失效时，才立刻修。

不要把旧里程碑、ADR 后续项、带日期的评审、检查点、调研笔记或设计审计当成实现队列。
`docs/developer/development-plan.md` 不存在，也不得重建。

## 产品代码准入

在这些决策点读 `docs/developer/product-code-admission.md`：

- 设计新产品能力、公开 Desktop RPC API、持久化状态、Sidecar 资源或 feature flag 之前，
  以及检查该能力三端产品化的时候；
- 新增用户可见页面或改动设计语言之前；
- 实现 Agent Harness 行为、兼容/迁移逻辑、实验性产品表面，或实现一项已由 Pi、DSH
  或其他已评审上游组件拥有的能力之前；
- 新增 smoke、fixture、benchmark、浏览器预览或发版验收基础设施之前；
- 评审与交付收口时，判断一项已实现但未验证的能力是否应留在生产依赖图里。

套用它的四道门：设计准入、开发边界、测试/验收分离、评审/留存。
小修和纯文档改动不必重读，除非它们改变了上述某个决策。

## 协作

- 除非用户另有要求，用中文交流。
- 代码、注释、文档、UI 文案和提交信息里不使用 emoji。
- 当 Agent Harness 概念对产品决策，或对用户的面试与演示准备有实际帮助时，解释清楚。

## 模型事实（models.dev）

<https://models.dev/> 是上下文、输出、推理和工具调用事实的公开基线
（`https://models.dev/api.json`）。写 MilkSU 默认值之前先查那里或下面这张表。
不要给已知系列编造 128000 / 32768 / 16384 占位数。

产品运行时不要去拉 models.dev。TokenFlux / 官方 Provider 目录才是线上产品来源，
models.dev 只用来补目录里缺失或占位的字段。

2026-09-22 对照各官方实验室（deepseek、openai、anthropic、xai、google、alibaba）核过一次。
**每次发版前**再对照一次（见 [三端打包与发版流程](docs/developer/release-process.md) §1.5）。
下表任一数字与 models.dev 不一致时，连同下列代码副本一起改：

- 上下文 / 输出：`internal/modelcatalog/context_window.go`、`app/src/lib/knownContextWindow.ts`、`sidecar/pi/known-context-window.cjs`
- 思考档位：`internal/config/model_thinking.go`、`app/src/lib/modelThinking.ts`（models.dev 的 `none` 映射成 Pi 的 `off`）
- 用量美金估算价目：`app/src/lib/knownModelPricing.ts`（个人资料 Coding 页；标成估算，不是账单）

| 系列 | 上下文 | 输出 | 思考 |
| --- | ---: | ---: | --- |
| DeepSeek Flash / V4 Flash / V4 Pro | 1,000,000 | 384,000 | `low / high / max`（默认 high） |
| Grok 4.6 | 500,000 | 500,000 | `low / medium / high / xhigh` |
| Grok 4.5 | 500,000 | 500,000 | `low / medium / high` |
| Grok 4.3 / 4.20 | 1,000,000 | 30,000 | 4.3：`off / low / medium / high` |
| Grok Build 0.1 | 256,000 | 256,000 | 有推理，无档位清单 |
| GPT-6 Astra | 1,050,000 | 128,000 | `low / medium / high / xhigh / max` |
| GPT-5.6 / 5.5 / 5.4 | 1,050,000 | 128,000 | `off / low / medium / high / xhigh`（5.6 另有 `max`） |
| GPT-5.4 mini / nano | 400,000 | 128,000 | `off / low / medium / high / xhigh` |
| GPT-5.3 Codex | 400,000 | 128,000 | `off / low / medium / high / xhigh` |
| GPT-5.3 Chat | 128,000 | 16,384 | 无推理 |
| GPT-5.2 / 5 | 400,000 | 128,000 | 见代码 |
| GPT-4.1 | 1,047,576 | 32,768 | 无 |
| Claude Fable 5 / 5.1、Opus 5、Sonnet 5、Opus 4.8 / 4.7 | 1,000,000 | 128,000 | `low / medium / high / xhigh / max` |
| Claude Opus 4.6 / Sonnet 4.6 | 1,000,000 | 128,000 | `low / medium / high / max` |
| Claude Sonnet 4.5 | 1,000,000 | 64,000 | 有推理，档位为空 |
| Claude Opus 4.5 / Haiku 4.5 | 200,000 | 64,000 | Opus 4.5：`low / medium / high` |
| Gemini 3.x Flash / Pro | 1,048,576 | 65,536 | 3.8 / 3.7 / 3.1 Pro：`low / medium / high` |
| Qwen3.8 Flash / Max | 1,000,000 | 131,072 | `low / medium / xhigh` |
| Qwen3 Coder Plus | 1,048,576 | 65,536 | 无 |

## 用户可见文案

产品 UI、聊天气泡、通知、错误、slash 描述、按钮标题和工具结果的 `detail` 文本都是给用户看的。
不要把只给 Agent 看的实现说明、harness 注释、内部阈值，或者「这不是 X / 不拦手动」这类解释
写进那些文案。那些事实留在 AGENTS.md、current-objectives、代码注释，
或者像 `codingWorkspaceGuidance()` 这样只给模型的指引里。

不要用可有可无的旁白、教学口吻或者「还没有 / 打开以后会出现」这类状态文案去填空状态。
控件没有值就让表面留白，只显示控件自己的标签，比如「选择项目」。
Coding 新对话画布可以显示产品标题「我们要构建什么」或「我们在 {project} 中构建什么」。

产品 UI 是双语：简体中文和英文。设置 → 界面语言 / Interface language 同时切换两者，默认中文。
React 组件、hooks 和前端 lib 文案里每一条用户可见的中文串，都必须用
`app/src/lib/uiLocale.ts` 的 `t('中文', 'English')` 包起来。
新增或修改中文 UI 文案时，在同一次编辑里改掉英文参数。
不要留下只有中文的控件、通知、空状态、aria-label、placeholder 或按钮。
模块名 CTF、CVE、Lab 和 Coding 在两种语言下都保持产品名不变。
强制手段：`app/src/lib/uiLocaleCoverage.test.ts`。

看板娘的英文是 Companion。它以前叫「桌宠」。开发、测试和搜旧记录时，桌宠就是看板娘。代码标识、测试 id、目录和插件槽位仍是 companion / `app.pet`。

## 产品 UI 设计语言

本节是唯一的产品 UI 语言。其他文档指向这里，不得复制层级表、token 名或原语数字。

新 UI 和每一次重构都用 **React + [shadcn/ui](https://ui.shadcn.com/)（New York、zinc）**。
不新开 Vue 页面，不加 Felinic。不跟 DeepSeek Harness 的 web GUI。
不要把 Beautiful UI 夜间玻璃、战术 / 游戏感 chrome 和 ak-ui 混在同一个表面上。
所有 UI 功能先联网搜索成熟实现作为参考，并套进本节已有的 React + shadcn、token 和动效规则；不要手搓一次性的控件、图标或布局，除非用户明确确认要手搓。
所有 UI 功能先联网搜索成熟实现作为参考，并套进本节已有的 React + shadcn、token 和动效规则；不要手搓一次性的控件、图标或布局，除非用户明确确认要手搓。

MilkSU 仍然自己持有：双语 `t('中文', 'English')`、空控件留白、三端窗口框、
CTF / CVE / 实验室领域 chrome，以及桌面授权。
不要 vendor Beautiful UI 的 React 运行时、`globals.css` 或付费的 `@central-icons-react`。
不要加 `@yunyoujun/ak-ui`。彩蛋（ak-ui 芯片、LIVE 花活）已推迟，重写页面时不要顺手加回来。
不要把 DeepSeek Harness 商标当成 MilkSU 的产品名。

下表是现行事实。更早的 Vue + Felinic 安装包不是现行语言。

| 层 | 负责 | 怎么用 |
| --- | --- | --- |
| 材料 | token、颜色、字体、动效 | shadcn 结构，Cursor Light / Cursor Dark 表面。页面和侧栏填充保持高不透明度（约 70–90%），好让 macOS `under-window` vibrancy 和 Windows acrylic 透出一丝壁纸；Linux 保持不透明。夜间页面 `#181818` / 侧栏 `#141414`；浅色页面 `#fcfcfc` / 侧栏 `#f3f3f3`。浮层 Dialog / Popover / Sheet / DropdownMenu / 菜单 / toast 是液态玻璃，不是实心板：半透明填充、`backdrop-filter`（blur + saturate）、顶缘高光和发丝边。浅色是白玻璃，夜间是深色玻璃（不要铺平的 `#141414`，也不要 OLED 纯黑）。填充要够厚，Windows Chromium 不给毛玻璃时仍是一块能读的面板，不会透出洞。磨砂层不加 `clip-path`。不要 OLED 纯黑（`#09090b`），不要 zinc-950，不要纯白 `#ffffff` 页底，不要洗色叠层，不要碳纤维纹理，不要页面级 cyan。出厂 `--primary` 是高对比墨色（夜间 `#f0f0f0`、浅色 `#141414`）。设置 → 通用「强调色」预设（默认墨色、blue、violet、teal、amber、rose；实时生效）驱动 `--emphasis`；彩色预设还会重映射 `--primary` / `--primary-foreground` / 焦点 `--ring`，让发送与品牌按钮、选中的筛选芯片、Switch / Checkbox、进度条、侧栏与工具选中态的内嵌条、以及 `text-primary` 的勾都跟着强调色走。默认预设清掉这些重映射，保持墨色。不要用颜色去洗页面或侧栏填充，浮层保持灰阶。侧栏更新动作固定用 `--update`（Cursor 那种蓝：夜间 `#5b9fff` / 浅色 `#2563eb`），不跟用户强调色。shadcn 的 `--accent` 仍然是悬停灰面，不是品牌色。圆角 8px（`rounded-md`）。产品外观不是 Mica。字体默认 Inter Variable + Noto Sans SC Variable。设置 → 通用可以改界面字体、对话字体及其字号（预设，实时生效）。动效三条曲线（`--ease-out` / `--ease-in-out` / `--ease-drawer`）三档时长（`--motion-fast` / `--motion-base` / `--motion-slow`），纯变色用 `ease`，UI 动效不超过 300ms。按下反馈落在按下那一刻：按钮和芯片缩放 0.97，整行宽的行改用加深底色 `--pressed-row`，不加缩放。浮层从触发点缩放进入、模态保持居中；只动 `transform` / `scale` / `opacity`，不要 `transition: all`；会被反复触发的用 transition 不用 keyframes。命令面板、设置页这类键盘触发的高频路径不加动效。新增动效统一挂在 `prefers-reduced-motion: no-preference` 白名单下。实现位置、动效面清单与验证方法见 `docs/developer/motion.md`。 |
| 壳 | 侧栏、顶栏、页面列 | 一个侧栏 + 一个页面列。折叠 52px；展开最小 224px、默认 264px，拖右边缘调宽。选中行是 8px 圆角矩形。会话行右键出上下文菜单（拦掉浏览器菜单）：置顶 / 取消置顶、已置顶时的排序、重命名、Fork、复制、归档、删除。归档立即执行，只有永久删除二次确认。会话行右侧显示相对活跃时间（`1m` / `16h` / `5d`，和命令面板同一个 helper）。悬停时钉选和归档占用那个位置。不要在行上放三点按钮。同样是 8px 命中区和 `--hover-2`。置顶分组用图钉标记，不是文件夹。项目文件夹折叠时用 `Folder`、展开时用 `FolderOpen`。侧栏搜索（以及 Cmd/Ctrl+K）打开同一个居中的液态玻璃命令面板：齐平搜索框、筛选芯片 全部 / 会话 / 设置 / 命令、带强调色圆点 + 工作区名 + 相对时间的最近会话，然后在那些筛选（或查询）需要时才出设置或 slash。页脚显示 打开 / 选择 / 关闭 三个键位。它不是第二个侧栏，不是行内列表过滤，也不是带边框、配空文档图标的表单对话框。浮层用同一套液态玻璃，不要再铺一层实心填充把模糊盖住。侧栏页脚：版本号，有更新时是一个蓝色 `--update` 文字控件「更新」/ Update（下载进度就显示在这个控件上的百分比，不是一个灰色下载图标），然后是主题和设置图标；折叠时这两个图标都保留。工作区头像菜单只和它的条目一样宽。设置直接替换掉同一个侧栏变成分类列表，不要保留工作区侧栏再叠第二列设置导航。设置返回是整行宽的头部（chevron + 设置 / Settings），不是一个纯图标按钮。`--page-stack-width` 是 64rem。窗口框只有一套壳：macOS 用 `hiddenInset`，红绿灯压在侧栏上；Windows 和 Linux 隐藏原生标题栏与窗口内菜单，画一层画布色 overlay，系统按钮放右上。Windows / Linux 上不要留 mac 红绿灯的洞，也不要第二条白色标题栏。 |
| 列表 chrome | 筛选、历史、主操作 | shadcn Button / Input / Select / Badge。筛选是一排 `Button`（`outline` / 选中 `default`，`rounded-md` 或 `rounded-full`）。目录表格用画布色或卡片填充加普通的 caption 表头，不是等宽大写的「调度台」表头。分类 / 难度 / 严重度用 `Badge`。会话列表 chrome 和侧栏一致：悬停钉选 / 归档，右键出完整动作菜单，行上没有三点。命令面板筛选芯片用同一套「选中填充 / 未选中只有文字」的行。 |
| 事实 | 卡片、表格、对话框、状态 | shadcn Card / Table / Dialog / Alert / Switch。设置跟 Cursor：一组 `SettingsSection` 列表，`SettingsRow` 是左边标签、右边一个紧凑控件。标签和控件共用 `--text-label`（13px），控件高 28px。改完即存，不要页面级的「保存」/「保存并验证」。厂商 / 应用标记（编辑器、模型）放在 Select 选项和收起的 trigger 里面，不是控件旁边的兄弟图标。不要嵌套卡片，不要 workbench 分栏，不要在一个分类里堆 ActionCard。审批、凭据和就地表单错误仍用 `Alert`。后台和短时失败用 toast（`Toaster`，同一套液态玻璃）。不要把 API Key 放进 toast。更新重启对话框就是同一套液态玻璃 Dialog：有回合在跑时先问要不要退出，然后一次确认就应用已下载的更新并重启。 |
| 文案 | 用户可见字符串 | `t('中文', 'English')`；空控件留白 |
| Agent 对话 | Coding / CTF / CVE / 实验室聊天 | chrome 用 shadcn。空的新对话把标题和输入栏居中放在列里；发出第一条消息之后输入栏固定在底部。产品契约不变：常驻输入栏、忙时 Queue / Steer、过程与工具披露、`milksu_ask` 行（最后一行是 其他 / Other）、计划、代码块、真实 harness token。选中对话正文会浮出一个贴边不出屏的「加入对话」菜单，引用落进输入栏上方的引用列表，可以单条移除；只有对话正文里的真实选区能被引用。输入栏模型芯片只出一级菜单：模型、推理强度（模型有档位时）、上下文大小（只读展示）、运行时。首次点击或聚焦时不要展开任何二级菜单；只有悬停某一行才把第二块面板飞出来（向右，会被裁掉时向左）。飞出面板要留在窗口内：贴着第一块面板底部、靠近输入栏，并随列表滚动收缩。不要在输入栏上另留一个思考芯片。输入栏 Git 芯片打开一个紧凑的可搜索 popover：搜索框、限高滚动、当前项打勾，以及用输入的名字创建分支。不要把本地分支全量列出来。设置页的默认 / subagent 选择器仍是单个可搜索 popover。输入栏图片附件用缩略图；`@` 走现有的选文件 / 附件 RPC，不要另造工作区索引器。右栏和底部终端是普通 `aside` / Card（可调宽的右列用 `ContextRail`）。 |

首页聊天填满侧栏右边那一列。CTF / CVE / 实验室默认是一个可关闭的 dock（关闭就是 X 卸载）。
最大化覆盖侧栏右边的全部区域，右栏仍在流内、贴着对话。
不要叠 dock，不要把会话列表塞进 dock，也不要把 `MissionOperationPanel`、领域任务 chrome
或者「返回 CTF」放进对话列。

共享样式在 `app/src/index.css`、`app/src/styles/agent-conversation.css` 和
`app/src/components/ui`。不要为一个新表面加 Felinic、Vue SFC 或第二套 chrome 样式表。
已退役的 graphite / paper / 战术 / 酸绿 / Beautiful UI / DSH-web-GUI 草稿都不是现行语言。

插件（`milksu.plugin/v1`）可以在自己的主题槽位里换皮，但插件皮肤不是核心设计语言：
产品自身的 chrome 仍以本节为准，不要为了迁就某个插件预设去改共享 token。

新页面、设置分类、档案页、对话框、预览、CSS / 文案改动、外来 PR 或重构，
都要对着本节审一次。截图不算评审。
不要为了做完一个页面就发明一次性的最大宽度、圆角、内边距、卡片或颜色。
不要写 UI 单元测试来「强制」这套语言。对着跑起来的 App 审。

### 用户改了 UI 时

在选定的新表面或重构表面上跟着 React + shadcn 走，这就是本语言，不是一次性决定。
不要反过来问要不要改回 Vue、Felinic、Beautiful UI 或 DeepSeek Harness web GUI。

如果是用户（不是 Agent）把布局、颜色、间距、排版或组件选择改到了别的方向
（工作树、贴的截图、后续指令，或者他们在 App 里自己改的），
既不要悄悄回滚到本节，也不要悄悄改写本节去迁就那一次改动。用中文问：

1. 更新设计语言（本节和共享 CSS / token），让后面的页面都跟新规则；还是
2. 保持本语言，把那次改动当成一次性，去对齐或隔离它。

不要写或刷新 visual-contract / style-contract / 挂载断言 class 的测试来锁住新外观。

## 产品化与三端支持

MilkSU 发 macOS、Windows 和 Linux。每一项新产品能力都要为这三端设计，
也要为一个不是本开发者的用户设计。

- 不要硬编码操作系统路径或本机路径。产品 Go、Electron、Sidecar、renderer 和打包里
  禁止出现：`/tmp`、`/private/tmp`、`/var/tmp`、`/run/user/<uid>`、`/Users/...`、
  `C:\Users\...`、Homebrew 前缀、`/usr/bin/open`、一个恰好在这台机器上存在的 Docker socket，
  或者只存在于这份 checkout 里的二进制。
  Unix domain socket 撑爆 `sockaddr_un` 不是粘 `/tmp` 或 `/private/tmp` 的理由，
  应该在平台临时根目录下把文件名缩短。
- 路径通过 Go / Electron 平台 API 和现有的 app-data / 文档目录 `MilkSU` 布局解析。
  临时 / 运行时目录用 `os.TempDir()`、Node `os.tmpdir()`，Linux 用 `$XDG_RUNTIME_DIR`，
  统一走 `internal/hostpath` 和 `sidecar/hostpath.js`。Go、Sidecar 和测试都必须调那个 helper；
  测试不得把 `/private/tmp/milksu-...` 粘成期望的产品路径。
  读过平台环境变量之后，像 `%SystemRoot%\System32` 这样有文档的 OS 默认值是允许的。
  打开文件夹用 Go 给出的可信路径加宿主 shell，不是只在 macOS 上能跑的命令。
- 首次运行必须是产品路径：检测机器上有什么、显示设置、给一个默认值，
  并让用户指到某个路径或登录。别的用户必须能在不读仓库、不导出环境变量、
  不复制个人配置的情况下把这个功能打开。
- 隐藏环境变量、没有文档的 CLI flag，以及「从 checkout 里跑这个脚本」都不是配置面。
  某个工具需要本机安装（IDA、Docker、Android SDK）时，由设置去检测、点名缺什么、并给出下一步。
- 某个平台暂时支持不了这项能力，就在产品 UI 和 `current-objectives.md` 里说明。
  不要把 macOS 那条路径当成产品交付，也不要让 Windows / Linux 变成未处理的崩溃或一个空控件。
- 凭据、TCC / 辅助功能和代码签名停在各自现有边界上。
  一个必须由本开发者额外授予 OS 权限才能用的功能，在产品内权限路径出现之前不算完成。

## Beta 自举边界

- `MilkSU Beta.app` 只为 MilkSU 自己的自举循环存在：由一个 Stable MilkSU 审阅者控制一个
  身份独立的 Beta 构建，并核对它的分支、commit、追踪 ID 和用户可见任务。
- 实现代理在日常实现、调试、UI 验证或发版准备期间不得构建或刷新 Beta App。
  改用逻辑 / RPC / Sidecar 测试、浏览器预览，或 Stable 开发运行时。不要加 UI 单元测试。
- 只有用户明确要求跑一次 MilkSU 自举演练时才构建 Beta。
  「测一下这个功能」「看看桌面 UI」「打一个普通包」都不是自举授权。

## 当前产品边界

MilkSU 是 Electron/Chromium 桌面 App，配一个受管 Go Runtime 和 Agent Sidecar。
产品 UI 是 React + shadcn。

TokenFlux 的 API 流量必须走 `https://tokenflux.dev/v1`。
产品代码、配置、测试默认值和文档里都不得出现 `tokenflux.ai` 域名。

- 当前有两个已接入的 Agent 内核：Pi（`@earendil-works/pi-coding-agent`，工作树钉 0.84.1）
  和 DeepSeek Harness（`@deepseek-ai/dsh`，走 ACP，工作树钉 0.1.6-alpha.1）。
  新对话二选一，出厂默认 Pi；设置 → 模型的「默认运行时」只决定新对话，不改写已有会话。
  DSH 是可选内核，不是 UI 参考：不要复刻它的 `dsh web` 皮肤。
- 内核拥有通用的模型会话、上下文压缩和工具循环。
- MilkSU 拥有桌面授权、工作区与凭据边界、事件投影和产品 UI。
- MilkSU 以 AGPL-3.0-only 发布，以便嵌入 Obelisk 这类 AGPL 组件。
  宽松的 MIT/Apache/BSD 插件在保留其声明的前提下仍可使用。
  不要引入 GPL-2.0-only、SSPL 或专有内核。
- CTF 领域拥有 Challenge、Evidence、Candidate、Judge 回执、Recovery、Memory 和学习事实。
- CTF、CVE、实验室和 Coding 是同级工作区。今天发出来的东西是当前事实，不是天花板：
  CVE 跟踪与复现报告、CTF 解题循环、实验室探测和 Coding Agent 都可能长成
  初轮审计、披露草稿、二进制 / 源码接入和安全工作区 UI。
- 缺一个表面不等于禁止。不要在能力存在之前先加解冻清单、冻结门禁或者
  「不要做 PoC」这种产品身份。「不在这条发行线里」只表示它不是当前的交付宣称，不表示禁止选它做纵切。
- NYU safe-static 是一项窄域开发者评测，不是 MilkSU 的 CTF 成绩。

套用上游优先的实现阶梯：先用现成的平台或内核能力，再用固定且可评审的 Skill、MCP server、
插件、包或平台 CLI，再用一个许可证兼容的小规模 vendored 机制或成熟设计，
最后才写最小的 MilkSU 自有实现。记录清楚前一级为什么不够。
「成熟」要求源码可查、许可证兼容、权限有界、有维护的发布，以及针对该用例的证据；光靠流行度不够。
上游组件已经拥有某项能力时，不要再长出第二套通用 Coding Agent harness。
当选定的 Agent Harness 已经暴露了可评审的会话 API、生命周期钩子、扩展点、工具、压缩机制、
运行时上下文机制或其他对应原语时，通过那个原语接入并保留该 harness 的语义，
不要用 MilkSU 自有的 prompt 路由、正则、并行状态机或第二套 harness 去重造那个行为。
MilkSU 只补 harness 不拥有的那部分：产品 UI、桌面授权、持久化和 Evidence 投影；
在准入一个替代机制之前，先把具体的 harness 缺口写清楚。

渐进披露由当前会话选定的那个内核拥有。
Pi 会话：Skill 目录只留 `name` + 说明何时使用的 `description`，正文用 `read` 或 `/skill:name` 载入，
只走 slash 的 Skill 用 `disable-model-invocation`，重量级可选工具先 `registerTool`、
再通过 harness 激活（Pi Dynamic Tool Loading 或一个 typed 产品动作）。
DSH 会话用 DSH 自己的 Skill 与工具披露，不要把 Pi 的目录格式照搬过去。
两种情况下都不要加一个 MilkSU 自有的注入器去扫描用户文本、把 Skill 正文或工具说明贴进系统提示词，
或者靠猜来决定什么时候注入上下文；也不要维护一个「在每个 harness 上看起来都一样」的披露适配层。

## 不可谈判的边界

- 绝不读取、打印、迁移 Provider API Key，也绝不把它放进模型上下文、工具输出、日志、
  诊断、文档或普通文件。
- 绝不向被引用的开源仓库发布。GitHub 写操作只限于明确授权的 MilkSU 远端
  （`MilkSU-Official/milksu`），并且仍然需要产品里那次有意义的发布确认。
  签名、公证和 R2 机密留在 `macos-release` 环境 / 个人 Vault，绝不进仓库。
- 完全访问和自动审批不绕过付费动作、外部账户授权、Scope 扩大、路径限定或不可逆的外部效果。
- 对用户未授权的目标做安全动作需要可见、精确的授权。
  不要把任意目标清单、互联网网段扫描、凭据喷洒或隐蔽 / 规避做成产品功能。
  已授权的 CTF 题目、用户选定的本地文件 / 仓库，以及用户授权的研究目标，
  可以做分析、复现和 PoC 工作。
- 模型可以提出 CTF 候选，但只有独立 Judge 或用户明确授权的结果才能确立成功。
- 不要把部分 smoke 测试描述成完整的 Coding、CTF、Memory、NYU 或发版结果。
- Computer Use 自举验收必须用已安装的、Developer ID 签名的 Stable MilkSU 当操作者。
  绝不用本机重新构建的 ad-hoc Stable App 做 TCC 验收；MilkSU Beta 是受控目标，
  不会拿到操作者的辅助功能或屏幕录制授权。

## 架构方向

目标依赖方向是：

```text
React -> Electron Preload / Desktop RPC -> Application Service -> Domain / Runtime -> Infrastructure Adapter
```

不要单独开一个架构清理里程碑。当选定的产品纵切碰到 `CTFPage.tsx`、
`cmd/milksu-backend/app.go`、`sidecar/pi/bridge-policy.js`、`internal/browsercap/manager.go`
或 CTF Runner/Recovery 时，不要再往里加新职责，可行的话顺手把碰到的那份职责抽出来。

发行前的新代码直接实现干净的当前模型。不要为已放弃的发行前设计加迁移、双写、
回退或兼容分支。现存可用 schema 的清理，推迟到产品纵切稳定之后的一次破坏性发行前合并。

## Agent 意图与产品 UI 工具

- 渐进披露归当前内核所有，不归 MilkSU 的 prompt 路由。把「何时使用」写在 Skill 或工具的
  `description` 上；不要在系统提示词里重复成一篇 MUST 长文；不要把 Skill 正文贴进系统提示词。
  Pi 会话跟 Pi 的披露，DSH 会话跟 DSH 的披露。
- 不要用关键词或正则扫描用户文本来决定跑哪个工具、开哪个标签页、开哪一页或走哪种审批。
  模型看得懂自然语言。GUI 一键操作发的是 typed 产品动作。
  隔离浏览器之所以启动，是因为用户打开了右栏，或者模型调用了 typed 的 `milksu_workspace`
  浏览器动作（`EnsureCodingBrowser`），不是因为提示词里出现了「打开浏览器」，
  也不是因为发过一句 Go 的问候语。
- `milksu_workspace` 是 typed 的产品 UI 工具。它可以列出、聚焦或关闭隔离浏览器标签页，
  列出或预览产物，打开环境、diff、终端或后台任务表面。
  Coding、CTF、CVE 和实验室共用这个表面；领域工具和 Judge 叠在 Coding 循环之上，而不是取代它。
  它不得修改设置、凭据、审批策略，也不得附着到用户自己的 Chrome。
- `milksu_ask` 是 typed 的产品 UI 工具，用来出对话选择卡。
  用户需要在 2–6 个具体选项里挑一个时模型调用它；对话里显示一个问题加若干可选行，
  最后一行是 其他 / Other 输入框，然后暂停。
  选中某一行或提交 Other（包括直接在输入栏发一条新消息）就算回答了这张卡，并继续同一个回合；
  不要把那段文字当成排在 ask 后面的 steering。
  不要为「给我几个选项」去正则匹配提示词，也不要把它当成工具权限 HITL
  （拒绝 / 允许一次 / 始终允许）。
- 不要从 CTF、CVE 或实验室会话里剥掉 Coding 能力。那些工作区保留完整的内核工具循环
  （文件、Shell、后台任务、浏览器、LSP、compact、goal、subagent）外加领域扩展。
  有界的题目工作区、未授权目标门禁和独立 Judge 保留。
- 压缩归内核所有。Coding、CTF、CVE 和实验室会话都保持自动压缩开启，
  不要按角色去跳过 `/compact`、`compact_session` 或 80% 空闲那条路径。
  Pi 的自动压缩和 `/compact` 走同一条路径：输入加缓存读取的 token 达到 `contextWindow` 约 80%
  且会话空闲时触发；不要等整个回合跑完，也不要再加第二个 MilkSU 摘要器。
  DSH 用它自己的压缩，同样不要在客户端复刻第二套。
- 工具结果通过内核自己的 `tool_result` 上界进入模型上下文（Pi 约 50KB 或 2000 行），
  溢出部分留给 `read` + offset。不要把完整的命令、HTTP 或文件正文塞进 `content`。
- `workspace-auto` 会自动运行隔离的 `milksu-playwright`。
  Ask 卡可以为可授予的工具给出整段对话的允许。
  ImageGen、外部账户授权和破坏性删除仍然逐次确认；
  危险的大目录删除在执行前先测量、再判定、再记录。

## 发行口径

- 可下载的最新版本只写在 `README.md`。不要在本文件、`current-objectives.md`、
  `current-system.md`、`document-status.md` 或任何其他文档里写「当前最新版是 VERSION_OR_COMMIT」。
  历史 changelog 条目可以点名它所描述的那个 tag。
- 发完 GitHub Release 之后，更新 README 的徽章、下载链接和当前状态。
  其他 Current 文档记录那个 tag 发了什么、代码现在怎么工作。
- 升版本号、空 tag、本地脏包或更新的 `main` 都不算新的发行，
  直到 README 按一次有回执的 GitHub Release 更新为止。
- GitHub 写操作只留在授权的 MilkSU 远端（`MilkSU-Official/milksu`），
  并且仍然需要产品里那次有意义的发布确认。

## 验证与交付

- 用仓库里 canonical 的脚本，不要另造平行 runner。
- 改完对话、引擎、DSH 或隔离浏览器之后，跑 `docs/developer/product-regression-loop.md`
  里的产品回归套件（`npm run test:product-loop`）。
  那不是 Settings → 评测，不是 NYU safe-static，也不是拿 `test:dsh-complete-loop` 当主入口。
- Pull Request 上由 `.github/workflows/pr-checks.yml` 跑 Sidecar、Go 和 renderer 三组套件。
  CI 绿不替代产品回归，产品回归也不替代安装包上的真机验收。
- 按 `docs/developer/product-code-admission.md` 的要求，
  把 smoke、fixture、benchmark 和验收协调器放在生产启动路径、Desktop RPC 和 renderer 入口之外。
- 不要写 UI 单元测试。挂载一个组件去断言 class 名、token、文案、slot 或者「它渲染出了 X」
  是没有意义的：jsdom 不会把产品画出来，而 `?raw` / `readFileSync` 那种源码字符串契约
  只是把 chrome 冻住。不要新增或扩展 `*VisualContract*`、`*StyleContract*`、
  列表 chrome / 顶栏 / LIVE 芯片挂载测试，或者锁 CSS 和 class 名的模板 grep 测试。
  一次 UI 改动如果弄坏了这类既有测试，删掉那条断言或那个文件，不要为了让 CI 变绿去改快照。
  保留针对逻辑、Desktop RPC、凭据、路由 / 状态机、文案配对（`uiLocaleCoverage`）
  和 Sidecar / Go 契约的测试。UI 对着跑起来的 App、按本文件的设计语言审。
- 碰到产品 UI 的外来 PR 和选定纵切，必须过本文件的设计语言评审。
  新增能力的外来 PR 和选定纵切，必须过产品化 / 三端评审。
- 一项能力不会因为存在一个按钮、一个包或一个 fixture 就算完成；要留一个真实任务的结果。
- 保住用户那些与本次改动无关的工作树变更。
- 每个选定的纵切都要评审、测试、提交，并且只推到 MilkSU 授权的远端。
- 开发期文档记录测试、回执、检查点和必要的 ADR。
  最终的架构、里程碑、状态和发行宣称只在最后一次文档收口时更新。
