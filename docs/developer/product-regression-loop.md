# 产品回归循环

> 文档状态：**Evidence / Living Runbook**
>
> 改完对话、引擎、DSH 或隔离浏览器之后，按用户上手顺序跑整条产品。这不是 Settings「评测」，
> 也不是 NYU safe-static 或 FrontierHarness 模型刷分。
>
> 协调器：`scripts/verify-product-loop.mjs`。不进 App 启动，不暴露测试专用 Desktop RPC。
> 禁止 `desktop:start:beta` / MilkSU Beta。TokenFlux 只用 `https://tokenflux.dev/v1`。
> 回执不写 Provider Key。上手顺序和本机 Key 填在
> [`product-loop.local.example.md`](product-loop.local.example.md)；复制成 gitignore 的
> `product-loop.local.md` / `product-loop.local.env` 再填，不要把 Key 写进仓库或回执。
> 测完会打印从大模块到小模块再到整体的文字报告，并写一份带每项截图的正式 HTML 报告。

## 和其它「评测」的区别

| 入口 | 问的问题 | 怎么跑 |
| --- | --- | --- |
| 本页 · 产品回归 | 改完功能后，上手、主页、看板娘、领域工作区、桌面执行面、资料和设置其余项还成不成立 | `npm run test:product-loop` |
| Settings → 评测 | 这个型号 + 内核，Cybench / SEC-bench / AutoPen 能得几分 | 产品设置页；数据在 `internal/evalsuite` |
| NYU safe-static | 窄域开发者静态题 | `docs/developer/nyu-ctf-bench-eval.md` |
| `test:dsh-complete-loop` | 独立的 DSH 桥脚本 | 不是 product-loop 的一套。产品回归走本页入口。 |

不要把 Pass@1、模糊指令或模型排名写进本回执。Computer Use 缺权限或没开计算器记失败，不偷偷改走隔离浏览器。隔离浏览器自己测打开、跳转、点击、打字、标签、后退和读标记。不把用户 Chrome 当 CU 目标。

## 怎么调用

在仓库根目录：

```bash
# 看默认模块
npm run test:product-loop -- --list

# 改上手登录 / 账户模型 / 自定义中转站
npm run test:product-loop -- --gui --suite first-use

# 整次产品回归（默认模块，会自己排好顺序）
npm run test:product-loop -- --gui --suite all

# 只跑一个小模块
npm run test:product-loop -- --gui --suite coding-pi,workspace-ctf
```

只走独立 Stable 窗口和官方 Desktop RPC。

套件目录自测（不启桌面、不打模型）：

```bash
npm run test:product-loop-catalog
```

## 结果怎么算

`PASS` / `FAIL` / `SKIP` / `BLOCKED` 必须诚实。不要把没测到、发不出、超时或平台不能测记成通过。

| 结果 | 含义 | 退出码 |
| --- | --- | ---: |
| PASS | 这次点名的每一项都是 PASS | 0 |
| FAIL | 任一项 FAIL / BLOCKED，或点名了却没记下结果 | 1 |
| SKIP | 没有 FAIL，但有 SKIP（平台不能测、前置没满足） | 1 |

SKIP 不会让整次回归或某个大模块看起来已经跑完。`expectedMiss`（账户没额度、本机没有 Key）只能是 SKIP 或 FAIL，不能是 PASS，也不能把 `sourcesReady` / `accountReady` 标成真。上手模块要有真实凭据路径才算过：GitHub 登录后账户文件循环 PASS，或个人中转站文件循环 PASS。只过登录门 +「暂不登录」不算。StartAccountLogin 已发出却一直没变成已登录：`login-github-active` 记 FAIL，不因本机已有 Key 改成 SKIP。上手已经开跑却没落到某一步：FAIL「上手没跑到」，不是 SKIP。看板娘 host 超时 / 取消对转达和模糊调度是错误，除非该项专门在测恢复。`--suite companion` 没有已验证的个人中转站、也没有已验证的账户模型时，`companion-ready` 和模型相关项 FAIL，回执要写下 `personal` / `account` / `none`。

操作前后扫描主窗口和看板娘的可见 DOM / a11y 文本，以及 `role=alert`、`text-destructive`、toast、看板娘气泡。截图里或页面上出现未翻译的 `Request aborted` / `AbortError`、`No API key for tokenflux/…`、设置 JSON、`[object Object]`、companion-host 请求号或其它实现泄漏，记硬异常并把该项改成 FAIL（`expectedMiss` SKIP 也不放过泄漏）。用例目录允许的确认框、故意提交后的表单错误、停轮次的「这一轮已取消」不算。异常写进正式报告，带着截图和原文。

## 测什么

默认按用户上手顺序，同一独立实例贯穿：

`上手 → 主页 Coding → 看板娘 → 领域工作区 → 桌面执行面 → 账户与更新 → 设置其余项`

不附着已经在首页的日常窗口。开测前和每条用例前检查本机 MilkSU 窗口，关掉日常安装包和残留 Electron，只留这一扇测试窗。不要越开越多。Key 打进设置密码框，不注入 sidecar。中转站能发之后，主页发送缺来源记 FAIL。

### 上手

冷启动两次。第一次走登录和配中转站，第二次确认「暂不登录」还能进首页。

| 测试项 | 测什么 |
| --- | --- |
| 登录门 | 新开一扇独立窗口，必须先停在登录页，看得见「使用 GitHub 登录」和「暂不登录」。已经进了首页算失败。 |
| GitHub 登录 | 点 GitHub，你在系统浏览器里授权，产品里变成已登录。回调进这一扇测试窗，不进日常 MilkSU。`StartAccountLogin` 已发出却一直没变成已登录：FAIL。本机已有中转站 Key 也不能改成 SKIP。 |
| 账户模型 | 用账户额度让模型列目录、写一份 `NOTES.md` 再读回来。没连上或没额度：SKIP，不记 PASS，也不把来源标就绪。Key 被拒或发不出：FAIL。 |
| 设置中转站 | 进设置 → 模型，把端点、名字、模型和 Key 打进密码框并保存。没有 Key、也没有已经存过的中转站，算失败。Key 被拒不是「记预期」通过。先试官方 DeepSeek，再试 TokenFlux。 |
| 中转站模型 | 用刚配好的中转站再让模型写一份 `NOTES.md`。写不出来就不能往下测，算失败。 |
| 暂不登录 | 关掉再开一次，必须再看见登录页。点「暂不登录」进首页，刚才的中转站还在。 |

### 主页 Coding（34）

离开设置，还在刚才那扇窗里。Pi 和 DSH 各走一遍日常开发，再测会话壳和输入栏。

| 测试项 | 测什么 |
| --- | --- |
| Pi 写文件 | 用 Pi 列目录、写出 `NOTES.md`、再读回来。只聊天不算。 |
| Pi 跑命令 | 用 shell 写出 `DATE.txt`。 |
| Pi 改文件 | 已有 `NOTES.md`，改成带标记的一行。 |
| Pi 整理上下文 | 写完一轮后发出整理上下文。 |
| Pi 插话 | 回合还在跑时插一句话，回合要收得住。 |
| Pi 停止 | 回合还在跑时按停止。 |
| Pi 选择卡 | 让模型出 `milksu_ask`，对话里出现待回答的选项。只聊天不算。 |
| Pi 选择卡答完续跑 | 选完一项（或 Other）后，同一回合继续跑完。 |
| 加入对话引用 | 选中对话正文，点「加入对话」，引用进输入栏后再发出去。 |
| 附件进回合 | 导入附件并随消息发出。必须附件进了当前回合，并且回复提到附件里的标记。 |
| Pi 接到 DSH | 先完成一轮 Pi 对话，再整理并开出新的 DSH 会话。 |
| Coding 用户记忆 | 用 Pi 说一句带唯一标记的稳定称呼。回合结束后记忆里必须有这条，依据是用户原话里的连续一段。对话里不能出现待批准、批准这条或已记下。忘掉之后不能再出现。不另开 DSH 回合去读请求副本；DSH 不把用户记忆塞进用户消息，由目录自测锁定。 |
| DSH 写文件 | 换成 DSH 再写一遍 `NOTES.md`。 |
| DSH 跑命令 | DSH 写出 `DATE.txt`。 |
| DSH 排队 | 回合还在跑时把下一句排进去。 |
| DSH 计划模式 | 打开计划模式。 |
| DSH 目标 | 给这条会话设一个目标。 |
| DSH 并行会话 | 主会话还在跑时再发一条，必须开出带父会话的 ACP 子会话。只开两条列表不算。 |
| DSH 停止 | 回合还在跑时按停止，回合要结束或留下中止回执。 |
| DSH 整理上下文 | 写完一轮后发出整理上下文。 |
| 新会话画布 | 加号打开「我们要构建什么」。 |
| 钉选顺序 | 两条会话钉住，顺序还在。 |
| 重命名会话 | 改名后列表里还是新名字。 |
| Fork 会话 | 有过一轮对话后再 Fork，必须开出新会话。 |
| 归档会话 | 归档后立刻离开活动列表。 |
| 删除会话 | 删掉后活动列表里没有它。 |
| 命令面板 | 侧栏搜索或快捷键打开命令面板。 |
| 输入栏模型 | 点开模型芯片，看得见模型、运行时、上下文。 |
| 输入栏运行时 | 点开模型芯片再悬停运行时，飞出面板里看得见 Pi / DSH。 |
| 输入栏 Git | 在带 Git 仓库的会话上打开分支菜单。 |
| 输入栏加号 | 点「添加内容与工具」，看得见附件、并行、目标。 |
| 右侧栏 | 打得开右栏。 |
| 底部终端 | 打得开底部终端。 |
| 会话右键菜单 | 右键能看到置顶、重命名、Fork、归档、删除。 |

### 看板娘（23）

看板娘的英文是 Companion。它以前叫「桌宠」。搜「桌宠」时指的就是看板娘；用例 id、代码标识和目录仍是 `companion`。

| 测试项 | 测什么 |
| --- | --- |
| 看板娘就绪 | 启动后 ready，能读到模型。没有已验证的个人中转站、也没有已验证的账户模型：FAIL。回执写下 personal / account / none。 |
| 看板娘手机对话 | 侧栏页脚点看板娘打开手机对话，角色收起，看得见输入框。不是主窗口整页，也不和角色并排。 |
| 看板娘右键菜单 | 悬浮窗右键出现对话 / 隐藏看板娘 / 打开主窗口 / 看板娘设置 / 退出；壳菜单栏和 Dock / 托盘右键是同一组动作。 |
| 看板娘身体拖拽 | 按住角色身体拖了之后窗口跟着走。Wayland 不能贴坐标：SKIP（平台），不记 PASS。 |
| 看板娘核心循环 | 用例开始时用 `SaveConversation` 把主窗口抄本写进这次独立实例：click#3840（WinError 87 / `edit_files`）、express#7362（`res.send(ArrayBuffer)` 变成 `{}`）、electron#38154（`pagesPerSheet` 仍是一页一张）、electron#28084（`setMinimumSize` 500 没有立刻变成 700），加上周末接孩子、界面语言、回复正文。不写进日常 MilkSU。写完才在手机里提问、按停止按钮、收尾。停止要出现「这一轮已取消。」。打招呼不展开旧任务。点名用对话标题。click / express 检出只读，HEAD 和工作区不能变，也不给上游开 PR。`MILKSU_EVAL_PROJECTS` 指向检出目录，默认是本机 `code/eval-projects`；没检出就只靠抄本。`MILKSU_EVAL_GITHUB_REPO` 若设置，只许提到那个测试仓库，断言仍是上游检出没动。 |
| 看板娘归档 | 能归档当前段，页上有归档。 |
| 看板娘记忆 | 说一句带唯一标记的稳定称呼。回复上屏后直接写下一条已留下的记忆，依据必须是这句原话里的连续一段。出现待批准、批准这条或已记下算失败。只看见记忆栏不算。忘掉之后不能再出现。不等待闲置提取。 |
| 看板娘记忆设置 | 设置 → 看板娘里，记忆在隐私前面。提取只有关闭、每轮结束、闲置后。点闲置后出现闲置档（5/10/15/30/60 分钟）并写成 idle；点关闭后闲置消失并写成 off。有记忆才出现检索。测完把提取时机放回去。 |
| 跨会话调度确认 | 看板娘 `stop` 必须停下来确认。没确认不算。 |
| 看板娘功能询问 | 用人话问看板娘能干啥、能不能改设置/开主窗口，再让它打开主窗口并读不含密钥的设置；要有助手回复且动过 companion_app 或看板。 |
| 看板娘停后再续跑 | 先完成一句，StopCompanion 后再发，前后用户句都在同一段抄本。这不是回合中途杀 sidecar。 |
| 换看板娘模型再发 | 换成另一台模型后再发出一句。只有一台或只有账户模型、没法换：SKIP，不记 PASS。 |
| 看板娘模型设置 | 设置 → 看板娘有模型选择。 |
| 跨会话调度设置 | 设置里有跨会话调度。 |
| 主动性设置 | 任务事件、教学提示、定时播报、闲聊都在。 |
| 悬浮窗设置 | 设置里有悬浮窗。Wayland 只说明不能贴坐标。 |
| 出厂皮肤 | 设置 → 看板娘的皮肤是 Milk，并且有添加皮肤入口。 |
| 导入第三方皮肤 | 导入一份合同夹具包后，皮肤列表里有它。 |
| 换上第三方皮肤 | 选中导入的皮肤后，设置里能看见它的名字；悬浮窗画的是导入的 PNG，不是出厂资源。测完会移除并回到默认。 |
| 悬浮窗出厂帧 | 悬浮窗页面画出出厂角色。不锁 PNG 哈希。Wayland 没有悬浮窗：SKIP（平台），不记 PASS。 |
| 隐藏看板娘 | 走产品隐藏路径后，壳报告看板娘已藏。接着打开主窗口，看板娘仍藏着。Wayland 没有悬浮窗可藏：SKIP。 |
| 显示看板娘 | 再显示后，悬浮窗回来。Wayland 没有悬浮窗可唤醒：SKIP。 |
| 关掉主窗口留桌面栏 | 关掉主窗口后应用还在：macOS 留 Dock，Windows 最小化留任务栏，Linux 留托盘。还能唤醒看板娘，再打开主窗口。 |

### 领域工作区（CTF 11 / CVE 12 / Lab 11）

CTF：

| 测试项 | 测什么 |
| --- | --- |
| 打开 CTF | 侧栏点进去就是题库。 |
| CTF 同步 | 空题库上看得见同步；有题就打开导入对话框，里面必须有手动同步。 |
| CTF 搜索 | 有按题号或题名搜的框。 |
| CTF 分类 | 有全部分类。 |
| CTF 列表 | 有题就列出；空着必须是空列表加同步。 |
| 打开一道 CTF | 点打开能进详情；没题就停在空态。 |
| CTF 训练平台 | 有选择训练平台。 |
| CTF 开始解题 | 打开一道题后必须有开始解题。空题库先点同步；同步后仍没题算失败。 |
| CTF 开始并留下任务 | 开始一道本地题，任务列表里必须留下这条。 |
| CTF 每日挑战 | 有每日挑战就看见；没有也不把题库判死。 |
| CTF 任务列表 | 任务列表不能是空的。 |

CVE：

| 测试项 | 测什么 |
| --- | --- |
| 打开 CVE | 侧栏点进去就是列表。 |
| CVE 搜索 | 有搜索我添加的 CVE。 |
| CVE 严重性 | 有严重性筛选。 |
| CVE 同步公开源 | 打开导入 CVE 后，对话框里有同步公开源。 |
| CVE 列表 | 列表在，能读到跟踪条数。 |
| 查找公开 CVE | 打开导入 CVE 后，对话框里有按编号或产品名查找。 |
| 打开一条 CVE | 点得开一行；没有行就停在列表。 |
| CVE 档案 | 打得开档案或报告。 |
| CVE 档案复盘 | 打开 CVE-2099-4242 的档案。空着时记下是关的。写下一条不含密钥的复盘，任务和学习记录文件里都有它。点忘掉之后两边都没有。文件里不能留下密钥或 Flag。 |
| CVE 复现入口 | 打开一条后点开始复现，对话框里必须有启动并复现或只写报告。 |
| CVE 开始并留下任务 | 留下一条 CVE 跟踪任务。 |
| CVE 跟踪列表 | 跟踪列表不能是空的。 |

Lab：

| 测试项 | 测什么 |
| --- | --- |
| 打开 Lab | 侧栏点进去就是题目包或分段。 |
| Lab 题目包 | 题目包分段在。 |
| Lab 题目包卡片 | 有卡片就看见；没有也不把分段判死。 |
| Lab 启动 | 点开一张题目包卡片后，必须看得见启动。 |
| Lab 自定义任务 | 自定义任务分段在。 |
| Lab 空任务 | 没有任务时能回到题目包。 |
| Lab 创建任务 | 打得开创建表单。 |
| Lab 开始并留下任务 | 保存一条自定义任务，列表里必须有它。 |
| Lab 本机环境 | 设置里看得到 Android SDK 和重新检测。 |
| Lab 环境状态 | 能读到这台电脑的 Lab 环境。 |
| Lab Docker | 页上或设置里能看到环境或题目包。 |

### 桌面执行面（9）

Computer Use 和隔离浏览器分开测。缺权限不能靠浏览器凑成通过。

| 测试项 | 测什么 |
| --- | --- |
| Computer Use 权限 | 读得到状态：好不好用、辅助功能、屏幕录制。 |
| Computer Use 观察计算器 | 必须有权限，而且本机开着计算器。观察并写下 `SURFACE.md`。缺权限或没开计算器都算失败，不改走浏览器。 |
| 隔离浏览器打开 | Ensure 之后浏览器真的起来。 |
| 隔离浏览器打开页面 | 打开本机 127.0.0.1 页面。 |
| 隔离浏览器点击 | 页上的按钮点得动，结果会变。 |
| 隔离浏览器打字 | 页上的输入框打得动字。 |
| 隔离浏览器标签 | 能再开一个标签。 |
| 隔离浏览器后退 | 前进后再后退。 |
| 隔离浏览器读标记 | 模型用隔离浏览器读到标记并写进 `SURFACE.md`。不点你日常 Chrome。 |

### 账户与更新（4）

| 测试项 | 测什么 |
| --- | --- |
| 打开个人资料 | 账户菜单打得开个人资料。 |
| 编辑资料 | 点编辑资料，改显示名称和介绍，保存后还在。 |
| 资料页页签 | 资料页里的 CTF / CVE / Coding 三个页签都能切，不点侧栏。 |
| 客户端更新 | 侧栏页脚有版本号。有更新才出现「更新」，只看不点安装。 |

### 设置其余项（13）

全部测完再回来看设置，不重填 Key。十二个分类都要能打开。

| 测试项 | 测什么 |
| --- | --- |
| 十二个设置分类 | 通用、模型、CTF、CVE、Lab、Skills、MCP、归档聊天、浏览器控制、评测、看板娘、插件都能点开。 |
| 通用 | 语言、强调色、字体、数据目录、调试模式都在；强调色改完即存。 |
| 模型 | 默认运行时、默认模型、忙碌时发送都在；上手配过的中转站还在。 |
| 设置 CTF | Arena 和题目浏览器扩展在。 |
| 设置 CVE | 同步公开源在。 |
| 设置 Lab | 本机 Android 检测在。 |
| Skills | 内置和用户两栏都在。 |
| MCP | 内置和用户两栏都在。 |
| 归档聊天 | 归档聊天页打得开。 |
| 浏览器控制 | Browser Use、Computer Use、CTF 站点都在。 |
| 评测 | 套件和开始都在。不在这里跑刷分。 |
| 设置看板娘 | 模型、调度、悬浮窗、出厂皮肤和添加皮肤都在。 |
| 插件 | 插件框架和安装插件都在。 |

## 凭据与回执

- 本机先填 `docs/developer/product-loop.local.env`（模板是旁边的 `.example.env`）。协调器读入公开字段；密钥只留在脚本内存，到设置密码框再填，不注入 sidecar。回执只写变量名。上手配好个人 TokenFlux / 中转站后，看板娘也会切到同一条 personal 来源，避免「暂不登录」或 GitHub 账户额度缺失时看板娘 toast「No API key for tokenflux/…」。
- 登录 / 账户模型 / 自定义中转站按上手手册走通之后，没可用来源的主页发送记 FAIL，不再 SKIP。
- 回执：`build/test-results/product-loop.json`。结束后 stdout 打印从大模块到小模块的文字报告。
- 正式报告：`build/test-results/product-loop-report/index.html`。每一项只拍该用例当时还在的窗（主窗口或看板娘），在拆掉 fixture 会话之前拍，并写窗口标签和页面摘录。表面异常会多挂看板娘窗（如果泄漏在看板娘上）并列出原文。开跑会清掉上次的 `shots/`，避免旧图挂到新项上。截图和回执都不写 Provider Key。
- `--gui` 测完会 `DeleteConversation` 清掉本机 fixture 会话，不留在侧栏。
- 不要把回执或截图提交进仓库。

## 不要做的

- 不要为了跑回归构建 MilkSU Beta。
- 不要把协调器挂进 Settings「评测」或 App 启动。
- 不要发明第二套 GUI runner；CDP 附着走 `scripts/lib/desktop-gui-driver.mjs`，产品接口是 `window.milksu.invoke`。`isMilkSUPage` 必须先排除标题或 URL 带 fixture 的页。
- 不要在 CI 默认跑 `--gui --suite all`（真 API、本机窗口）。
- 不要把本回执写成 Coding / CTF / Memory / 发版完成。

## 输入与焦点（诚实边界）

product-loop `--gui` **不是**用 OS 级 robot / nut.js 去抢全局鼠标键盘。主路径是：

| 手段 | 用途 | 是否抢用户前台 |
| --- | --- | --- |
| Electron CDP 附着 + `Runtime.evaluate` / `callFunction` | 点按钮、读 DOM、填输入栏 | 基本不抢；页内 `input.focus()` 在部分平台可能抬窗 |
| `window.milksu.invoke` Desktop RPC | SendCompanionMessage、ConfirmCompanionDispatch、MoveCompanionPet、开关看板娘窗 | 不抢（`ShowCompanion*` 传 `{ focus: false }` 时用 `showInactive`） |
| CDP `Page.captureScreenshot`（`fromSurface: true`） | 用例证据图 | **默认不** `Page.bringToFront` |
| CDP `Input.dispatchMouseEvent`（看板娘表面） | 看板娘右键菜单坐标 | 可能激活看板娘浮层，但不走系统鼠标 |
| `MoveCompanionPet` RPC | 拖看板娘测 bounds | 不需要全局焦点 |

仍需要用户前台 / 系统表面的项：

- **GitHub OAuth**：系统浏览器登录与回调（`openExternal`），无法 background 化。
- **Companion OS 右键菜单**（`Menu.popup`）：宿主会 `focus()` 目标窗再弹系统菜单。
- **Computer Use / 打包真机脚本**：故意驱动本机其他 App（计算器等），会占鼠标键盘；那不是 product-loop 主套件。
- **首次启动把窗口建出来**：第一次 `show()` 仍会进任务栏；之后复用会话不再每次 `ShowCompanionMainWindow` 抢焦点。

目标：你在旁边打字时，product-loop 尽量只动 MilkSU 自己的 CDP / RPC，不要每条用例都把窗口拽到最前。
看板娘工具历史：abort / host 超时可能留下未配对的 `toolCall`。sidecar 在下一轮 send / 换模型 / abort 后会补 synthetic error `toolResult`（与 Pi 截断工具批的做法同型），不要靠狂刷 `ArchiveCompanionTranscript` 或逼用户「开新对话」来续跑。「开新对话」只在**当前** live error 仍是断工具历史时出现，不因抄本里旧的 errorMessage 一直刷；手机忙时发送键变成停止（`AbortCompanionTurn`）。
