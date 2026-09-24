# 动效

> 文档状态：Current / Implementation and verification
>
> 最后收口：2026-09-21
>
> 规则本身（用哪条曲线、用哪档时长、哪里不许动）只写在 `AGENTS.md` 的
> 「产品 UI 设计语言」。本页写的是**动效落在哪里、怎么量、还没做什么**，
> 供后续优化时有据可查。数值若与本页描述冲突，以 `AGENTS.md` 和
> `app/src/index.css` 为准。

## 动效在哪里定义

| 项 | 位置 |
| --- | --- |
| 曲线与时长 token | `app/src/index.css` 的 `:root`（`--ease-*`、`--motion-*`、`--pressed-row`） |
| 浮层开合 | `app/src/index.css`（`[data-slot='…-content']` 的 `data-state='closed'` 规则） |
| 按下反馈（按钮/芯片） | `app/src/components/ui/button.tsx` 的 `buttonVariants` 基类 |
| 按下反馈（整行宽的行） | `app/src/components/ContextSidebar.tsx` 的 `contextSidebarCss`；`app/src/index.css`（`.tactical-row`） |
| toast 进出 | `app/src/lib/appToast.ts`（`TOAST_EXIT_MS` 与 `leaving`）+ `app/src/components/ui/toaster.tsx` |
| 对话区动效 | `app/src/styles/agent-conversation.css`（由 `index.css` 顶部 `@import` 引入，排在其余规则之前） |

组件内部的样式字符串（`ContextSidebar`、`ChatComposer`、`WorkspaceRail`）在文档流里
晚于 `index.css`，**同特异性下它们赢**。所以给这些类加覆盖规则时不要靠顺序，
要么写进它们自己的样式字符串，要么把选择器写得更具体。

## 动效面清单

| 表面 | 现在怎么动 | 由谁驱动 |
| --- | --- | --- |
| shadcn Button 全部变体（发送、停止、图标按钮…） | 按下 `scale(0.97)`；颜色变化走同一档时长 | `button.tsx` 基类；`link` / `link-static` / `link-draw` 变体显式关掉缩放 |
| 输入栏芯片（模型、分支、工作区、加号） | 悬停改底色；按下缩放 | `ChatComposer.tsx` 的 `.chat-composer__chip` |
| 侧栏会话行、项目行、CTF/CVE/Lab 导航、设置图标 | 悬停与选中改底色；按下加深底色（不缩放） | `ContextSidebar.tsx` 的 `.agent-sidebar-row` / `.agent-sidebar-item` |
| 工作区图标栏 | 悬停改底色 | `WorkspaceRail.tsx` 的 `.workspace-rail-item`（未加按下反馈） |
| 工具行（`.agent-chip`） | 悬停与展开同一底色；按下即加深 | `agent-conversation.css` |
| 工具/思考披露展开 | 高度用 `grid-template-rows` 过渡，箭头旋转 | `agent-conversation.css` |
| 每个回合（`.agent-turn`）进场 | 短促淡入 + 4px 上移，`both` 填充 | `agent-conversation.css` 的 `agent-turn-in` |
| Working 胶囊与面板 | 胶囊按下缩放；面板从胶囊原点淡入放大（`@starting-style`） | `agent-conversation.css` |
| Working 面板里的子任务行 | 淡入 + 上移 | `agent-conversation.css` 的 `agent-fade-up` |
| Popover / DropdownMenu / Select / Tooltip | 从 Radix 算好的触发点原点缩放进入，关闭同路退出 | `index.css`；`popover.tsx` / `dropdown-menu.tsx` 带 `data-slot` 供选择器命中 |
| 输入栏芯片的二级面板 | 从被悬停那一行的边缘飞入（`origin-left` / `origin-right`） | `ComposerAgentMenu.tsx` 的 `starting:` 变体 |
| Dialog | 淡入 + `scale(0.98)`，**原点保持居中**（模态不跟触发点） | `index.css` |
| Toast | 从下进、同方向出；退出时先标记 `leaving` 再卸载 | `appToast.ts` + `toaster.tsx` |
| 侧栏拖宽、右栏拖宽 | 拖动中不参与过渡（拖动时加 `is-resizing` 关掉 transition），松手后夹回 | `ContextSidebar.tsx`、`ContextRail.tsx` |
| 思考像素加载、标签呼吸、流式光标、任务环、看板娘角色循环 | 常驻循环，仅 `opacity` / `transform` | `agent-conversation.css`、`index.css` |
| 主对话折叠头的当前动作 | 状态词用 `background-position` 从左到右扫过高光。换动作时旧句上移淡出、新句上移淡入，只动 `transform` / `opacity`，`--motion-base`。`prefers-reduced-motion` 时不扫光、不交叠 | `ChatWorkFold`、`agent-conversation.css` |
| 看板娘角色显隐、说话气泡、手机开合 | 开合是竖向合页：`clip-path: inset()` 把手机从上、下收到中线一条亮缝，缝再淡出；打开是同一条路倒放。角色停在手机底部，下半截让开或盖回去。合页播完清掉 `clip-path`，免得磨砂层的 `backdrop-filter` 被祖先裁切空掉。关对话时壳先保持 320×696；合页 260ms 后渲染器换成贴在底部的角色，再留一小段绘制时间才缩窗口。气泡：`scale` + `opacity` | `index.css`；壳在 `companion-shell.cjs` 推迟 `setBounds`；角色让位由 `CompanionPetWindow` 短持 |
| 看板娘手机状态岛 | 状态栏中间的实心黑胶囊。点开后固定盒子用 `clip-path: inset()` 向下展开，同时交叉淡入展开文案。只过渡 `clip-path` 和 `opacity`，`--motion-slow` + `--ease-drawer`。`prefers-reduced-motion` 直接跳到终态。不加 `backdrop-filter`，`clip-path` 只在这座黑胶囊上，不加在磨砂层 | `CompanionPhoneStatusBar`、`index.css` |
| 看板娘手机消息 / 确认卡 / 附件条 | 文档流列表：新的历史行 `opacity` + `translateY(4px)` 入场，离开对称淡出；刷新时用指纹把 pending / live-stream 接到持久 id，避免重播入场。正在回复的行不入场、不离场，长高时也不做 FLIP。回合之外，同列气泡才滑到新位置。确认 / 记忆 / 错误条同路淡入 | `companionChatMotion.ts`、`CompanionPage`、`index.css` |
| 看板娘过程披露、设置页、换肤 | 过程展开淡入（关闭即卸，避免折叠正文留在 DOM）。名字胶囊打开设置，整页从右侧 `translateX` 推入再弹出；手机设置是一块玻璃上的内缩分组列表。皮肤 `img` 重挂淡入 | `CompanionTurnProcessView`、`index.css` |
| 看板娘按下 | 角色本体、名字胶囊、玻璃图标与附件芯片 `scale(0.97)`；右键菜单行（若渲染）`--pressed-row` | `index.css`；发送 / 加号走 `button.tsx` |

## 刻意不动的地方

这些不是漏做，是决定：

- **命令面板（Cmd/Ctrl+K）、设置页、会话列表 hover**：键盘触发或每天上百次，加动效只会变慢。主窗口设置 → 看板娘也走这条；手机里名字胶囊打开的看板娘设置从右侧推入，可以动。
- **看板娘拖动中 / 松手夹回**：拖的时候停浮动，坐标由 Electron 跟着光标；松手夹回是窗口移动，不加 CSS settle，避免和 `setBounds` 打架。
- **看板娘隐藏、Dock 停主窗、原生右键菜单**：`BrowserWindow.hide` / 最小化 / Electron `Menu` 是系统面。显示角色时有短入场；隐藏不把窗口留 180ms 再关（会抢焦点、也会让回归截图拍到还在的窗）。右键只有 Preload 一个入口，渲染器不再另弹一层。
- **看板娘手机首屏灌入**：第一次 `list_companion_transcript` 灌满历史时不级联入场。之后的新行、离开和重排才动。
- **列表级联（stagger）**：同一批元素依次入场看着好，但会话列表和工具列表是高频面。
- **窗口 vibrancy 与浮层材质**：窗口的 `vibrancy: 'under-window'` /
  `backgroundMaterial: 'acrylic'` 仍归 `desktop/window-chrome.cjs`。浮层材质以
  `AGENTS.md` 为准，落在 `index.css`。看板娘手机屏幕里的玻璃控件模糊的是屏幕内的记录，不采样桌面。磨砂层不加 `clip-path`。
- **动画库**：没有 Motion / Framer Motion / GSAP。继续用 CSS keyframes + transition；
  只有真出现"可抛掷的手势"时才值得重新评估。
- **`transition: all`**：全仓没有带时长的 `transition: all`，保持这个状态。

## 怎么量

改完动效不要只靠眼睛。运行时可以用 CDP 直接读真实计算样式。

```bash
# 开发运行时监听 127.0.0.1 的调试端口；先看它开在哪个端口
lsof -nP -iTCP -sTCP:LISTEN | grep -i electron

# 页面 target（主窗与看板娘窗各一个）
curl -s http://127.0.0.1:<port>/json/list
```

量这几件事：

1. **时长与曲线档位数**：遍历所有元素，收集
   `getComputedStyle(el).transitionDuration` 与 `transitionTimingFunction`，
   按出现次数聚合。档位数量应该保持收敛；冒出新曲线就是又有人手打了。
2. **可点元素的按下反馈覆盖率**：统计 `button, [role=button], summary` 里
   `transitionProperty` 含 `transform`，或命中 `--pressed-row` 规则的比例。
3. **布局属性有没有被过渡**：`transitionProperty` 只应出现 `opacity` / `transform` /
   `scale` / `translate` / 颜色类。出现 `width` / `height` / `margin` / `padding` / `top` / `left`
   要问清楚原因（`grid-template-rows` 是展开折叠的既定手法，属于已知例外）。
   看板娘手机合页用 keyframes 动 `clip-path`，不放进 `transition`；播完即卸，静止时手机上没有 `clip-path`。
4. **`prefers-reduced-motion`**：在 DevTools Rendering 面板切到 reduce，
   确认循环动画停下、位移类消失、颜色和透明度反馈还在（减弱动效不等于没有反馈）。

时序手感靠眼睛和慢放，不靠上面这些数字：

- DevTools Animations 面板把播放速度调到 10%，逐帧看开合、披露、toast。
- 悬停输入栏模型芯片的每一行，确认二级面板是从那一行的边缘长出来，不是从中心。
- 快速连续开关同一个披露，确认它从当前位置接着走，不是从零重播。
- toast 连点几次，确认进出走同一条边、不闪。
