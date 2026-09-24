# 产品回归循环

> 改完对话、引擎、DSH 或隔离浏览器之后跑。不是 Settings「评测」，也不是 NYU 或模型刷分。
>
> 协调器：`scripts/verify-product-loop.mjs`。不进 App 启动。禁止 MilkSU Beta。
> TokenFlux 只用 `https://tokenflux.dev/v1`。回执不写 Provider Key。
> 本机 Key 从 [`product-loop.local.example.md`](product-loop.local.example.md) 复制到 gitignore 的 env，不要写进仓库。

## 和其它入口

| 入口 | 问什么 | 怎么跑 |
| --- | --- | --- |
| 产品回归 | 上手到设置，产品还成不成立 | `npm run test:product-loop` |
| Settings → 评测 | Cybench / SEC-bench / AutoPen 分数 | 设置页，`internal/evalsuite` |
| NYU safe-static | 窄域静态题，不是 CTF 成绩 | `cmd/nyu-ctf-bench-*` |
| `test:dsh-complete-loop` | 单独的 DSH 桥 | 不是这套 |

Computer Use 缺权限或没开计算器记失败，不改走隔离浏览器。不把用户 Chrome 当 CU 目标。

## 怎么调用

```bash
npm run test:product-loop -- --list
npm run test:product-loop -- --gui --suite first-use
npm run test:product-loop -- --gui --suite all
npm run test:product-loop -- --gui --suite coding-pi,workspace-ctf
npm run test:product-loop-catalog
```

用例名单、顺序和判定在 `scripts/lib/product-loop-catalog.mjs` 与对应 runner。本页不复述每一项。

默认顺序：上手 → 主页 Coding → 看板娘 → 决策 → 领域工作区 → 桌面执行面 → 账户与更新 → 设置其余项。

只走独立 Stable 窗口。开测前关掉日常安装包。多出来的 MilkSU 窗口关掉，并让当前项失败。

## 监督者

跑命令的 agent 看着同一条 stdout，一项落地再看下一项。`PASS` / `FAIL` / `SKIP` 保持程序原文。`FAIL` 当时写一行：原因，以及后面会不会因此全失败。

网络、模型、Key、额度，或会让后面全失败的代码问题：停掉进程，修好再重跑。只影响当前项的失败让套件继续。不要把 Key 写进复查或回执。

## 结果

| 结果 | 含义 | 退出码 |
| --- | --- | ---: |
| PASS | 点名的每一项都是 PASS | 0 |
| FAIL | 任一项 FAIL / BLOCKED，或点名了却没结果 | 1 |
| SKIP | 没有 FAIL，但有 SKIP | 1 |

SKIP 不算整次通过。`expectedMiss` 只能是 SKIP 或 FAIL。只过登录门加「暂不登录」不算上手通过。页面上出现未翻译的实现泄漏（`Request aborted`、`No API key for tokenflux/…`、设置 JSON、`[object Object]`、companion-host 请求号）把该项改成 FAIL。

## 凭据

个人中转站只覆盖退出登录的那一段。再登录成功并且账户发下决策钥匙之后，后面的用例留在账户来源。文件循环没写出文件，不改走个人 Key。账户没回来时，也不改走个人 Key。

回执：`build/test-results/product-loop.json`。正式报告：`build/test-results/product-loop-report/index.html`（拆 fixture 之前截图）。`--gui` 测完删掉 fixture 会话。不要把回执或截图提交。

不要为回归构建 Beta，不要把协调器挂进设置或启动，不要在 CI 默认跑 `--gui --suite all`，不要把这次回执写成发版完成。

## 输入

主路径是 Electron CDP 和 `window.milksu.invoke`，不抢全局鼠标键盘。仍要前台的只有：GitHub OAuth、看板娘系统右键菜单、Computer Use 真机驱动其他 App、测试窗第一次 `show()`。
