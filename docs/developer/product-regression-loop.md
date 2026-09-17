# 产品回归循环

> 文档状态：**Evidence / Living Runbook**
>
> 改完对话、引擎、DSH 或隔离浏览器之后，选套件跑产品契约。这不是 Settings「评测」，
> 也不是 NYU safe-static 或 FrontierHarness 模型刷分。
>
> 协调器：`scripts/verify-product-loop.mjs`。不进 App 启动，不暴露测试专用 Desktop RPC。
> 禁止 `desktop:start:beta` / MilkSU Beta。TokenFlux 只用 `https://tokenflux.dev/v1`。
> 回执不写 Provider Key。

## 和其它「评测」的区别

| 入口 | 问的问题 | 怎么跑 |
| --- | --- | --- |
| 本页 · 产品回归 | 改完功能后，停会话、钉选、文件循环、隔离浏览器、审批边界还成不成立 | `npm run test:product-loop` |
| Settings → 评测 | 这个型号 + 内核，Cybench / SEC-bench / AutoPen 能得几分 | 产品设置页；数据在 `internal/evalsuite` |
| NYU safe-static | 窄域开发者静态题 | `docs/developer/nyu-ctf-bench-eval.md` |
| `test:dsh-complete-loop` | 只跑 DSH A/B/C | 仍可用；等价于下面的 `--suite dsh`。新回归请走本页入口。 |

不要把 Pass@1、模糊指令或模型排名写进本回执。`desktop-surface` 优先 Computer Use 观察计算器；TCC / 平台不可用 / 没打开计算器时降级隔离浏览器 CDP，降级成功仍算 PASS，回执写明 `degraded`。计算器已在、CU 回合失败则 FAIL，不静默降级。不把用户 Chrome 当 CU 目标。

## 怎么调用

在仓库根目录：

```bash
# 看套件
npm run test:product-loop -- --list

# 改停会话 / 钉选：不启桌面也能跑逻辑
npm run test:product-loop -- --bridge --suite stop-scope,composer-runtime,chat-pin

# 改 DSH / 隔离浏览器 / 审批
npm run test:product-loop -- --gui --suite dsh

# 改默认 Pi 文件循环
npm run test:product-loop -- --gui --suite pi-files

# 改 Computer Use / 隔离浏览器执行面（CU 不可用会降级）
npm run test:product-loop -- --gui --suite desktop-surface

# 功能改动后的整次产品回归（默认套件，会自己排好顺序）
npm run test:product-loop -- --gui --suite all
```

`--gui` 是默认。`--bridge` 只跑不需要窗口的部分，并把 `dsh` 交给 sidecar 桥（没有 Ensure 隔离浏览器）。

套件目录自测（不启桌面、不打模型）：

```bash
npm run test:product-loop-catalog
```

## 选哪一套

协调器会按 `stop-scope → composer-runtime → dsh → chat-pin → pi-files → desktop-surface` 排序。DSH 必须先于其它 GUI 套件，单独启停 Stable 窗口；叠在 Pi 会话上会把官方 Playwright MCP 弄坏。

| 套件 | 改了什么时跑 | 断言 | 要桌面 | 要 Key / 账户 |
| --- | --- | --- | --- | --- |
| `stop-scope` | 引擎停会话、Sidecar 回收 | `engine.stopped` 只打到带 `sessions` 的对话；没有身份不广播 | 否 | 否 |
| `composer-runtime` | 作曲栏 Stop/Send、Working、Multitask、DSH host 投影、设置落盘 | DSH Working 时 Send 不是 Stop；host `commands`/`plan`/`goal`/`inbox`/`jobs`；整理上下文 / 接到新会话；子代理跑完收掉 `runningIds`；Pi 子代理仍 Stop；compact/abort 仍 Stop；默认运行时 / 忙碌发送 / 模型 / 界面语言 Save 后再读 | 否 | 否 |
| `dsh` | DSH 内核、Messages 根、隔离浏览器、审批 | 文件循环、本机标记、工作区写入自动过、区外删除被拦 | DSH 自己拉 Stable | 是 |
| `chat-pin` | 侧栏钉选、会话 store | 钉选顺序落盘；`--gui` 再走 `SaveConversation` / `ListConversations` | 仅 GUI 落盘 | 否 |
| `pi-files` | 默认 Pi 工具循环 | 写出 `NOTES.md` 且出现文件工具 | 是 | 是 |
| `desktop-surface` | Computer Use 或隔离浏览器 | 有计算器则 CU 观察并写 `SURFACE.md`；否则 Ensure 隔离浏览器读本机标记 | 是 | 是 |

草稿按对话隔离没有 Desktop RPC，本套件不假装测过。计划卡回合结束隐藏、长对话分片挂载在运行中的窗口里看，不要用 Vue mount 单测锁。

## 凭据与回执

- `dsh` / `pi-files` 认账户会话、设置里已存的 Provider，或环境变量 `DEEPSEEK_API_KEY` / `TOKENFLUX_API_KEY`。缺了记 `SKIP`，整次运行仍 exit 0（除非别的套件 FAIL）。
- 回执：`build/test-results/product-loop.json`。DSH 子回执仍是 `build/test-results/dsh-complete-loop.json`。
- 不要把回执提交进仓库。

## 不要做的

- 不要为了跑回归构建 MilkSU Beta。
- 不要把协调器挂进 Settings「评测」或 App 启动。
- 不要发明第二套 GUI runner；CDP 附着走 `scripts/lib/desktop-gui-driver.mjs`，产品接口是 `window.milksu.invoke`。`isMilkSUPage` 必须先排除标题或 URL 带 fixture 的页（例如 `MilkSU DSH fixture`）；那些隔离浏览器页会抢走 CDP，主窗的 `window.milksu` 就连不上。
- 不要在 CI 默认跑 `--gui --suite all`（真 API、本机窗口）。
- 不要把本回执写成 Coding / CTF / Memory / 发版完成。
