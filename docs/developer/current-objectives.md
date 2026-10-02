# 当前开发目标

> Current。最后收口：2026-09-25。
>
> 只回答现在处于什么阶段、下一版要什么。实现以代码、测试和安装包回执为准。
> 可下载版本只写在 README。产品 UI 只写在 `AGENTS.md`。

## 工作规则

1. 先读代码、Git、本文件、[文档状态](document-status.md)、[当前系统](../architecture/current-system.md)。
2. 新能力写当前模型，不为已放弃设计加迁移层。上游有的能力不另造 harness。
3. Provider Key 不进模型上下文、日志、文档或普通文件。只推授权远端。
4. 自动审批不绕过付费、外部账户、Scope 扩大、不可逆外部效果和危险大目录删除。
5. CTF、CVE、实验室、Coding 同级。领域事实和 Judge 由 MilkSU 持有。
6. 未打包或未经真机验收的，不得写成已发行。发版流程见 [三端打包](release-process.md)。

## 阶段

内测迭代。不再按 M3/M4 排期。M3 product-loop 已在 `108e0e3`（2026-08-05）合并，只供追溯。

出厂默认官方 DeepSeek Flash、运行时 Pi。新对话可选 Pi 或 DeepSeek Harness；设置里的默认运行时只改新对话。工作树 Pi 钉 `1.0.0`，DSH 钉 `0.2.0-rc.2`。DSH 是内核，不是 UI。

产品回归：`npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。

## 26.927.3 发行回执（tag v26.927.3 → `9e2825f3`，2026-09-27）

本版能力记录：全部运行时状态统一到 `~/.milksu`（data / config / workspaces / desktop /
backups），默认根首次启动自动迁移旧平台数据目录，旧目录改名加 `.pre-milksu-home` 保留（#188）；
`MILKSU_APPDATA_DIR` 语义变为整个状态根的别名；Electron stable 的 userData 迁入 `<root>/desktop`；
修复 macOS 更新下载失败（ensureOwnerWritable 改用 original-fs）；Sidecar 按目标平台裁剪外来平台
二进制（#185）；修复 #178–#183 六个 product-loop 回归（#186）。本轮按用户指示不跑 product-loop，
`release:verify` 与三端云端门禁全部通过。
tag 与分发 source 同为 `9e2825f3`。

| 平台 | workflow | 文件名 | 大小（字节） | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS | build-macos | MilkSU-macOS-arm64-26.927.3.dmg | 392,863,105 | e3c8560da804962913ccdb0178c8cf6ed98ec35ffff82be9538e2bdb9a1b594a |
| Windows | build-windows | MilkSU-Windows-x64-26.927.3-Setup.exe | 310,049,583 | ba9574e15c77b9e7a7b2309d7955e4f76f36f80efa07ea8cd2293b108f48231c |
| Linux | build-linux | MilkSU-Linux-x64-26.927.3.deb | 282,066,116 | bd99d9b48b88b5fef26c945c7a93de0e1741be433ece5fdd7da6d80f216bed21 |
| Linux | build-linux | MilkSU-Linux-x64-26.927.3.tar.gz | 345,524,160 | c6d5104a33a39a0685f80a366852b7d22d791635a65e8835e484f65610096fdc |

## 26.927.2 发行回执（tag v26.927.2 → `6680ec9c`，2026-09-27）

本版能力记录：压缩阈值改为按「窗口 − 最大输出 − 一步余量」计算，修长对话在撞模型输入上限
（HTTP 400）之前自动整理上下文（#173）；`context_composition` 事件与落库记录带上
`maxOutput` / `usableWindow`，用量面板标出「可用输入上限」分界线与越线提示；Computer Use
的 Cua Driver 升到 0.29.1（#184）。
tag 与分发 source 同为 `6680ec9c`；tag 之后只有 README 文档提交（开源组件清单、鸣谢），
无未打进安装包的产品代码。

| 平台 | workflow | 文件名 | 大小（字节） | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS | build-macos | MilkSU-macOS-arm64-26.927.2.dmg | 509,037,625 | 753e3a739102143a28db943945e8a4c94b5ac1d888db16fc7d328e30c6c9535c |
| Windows | build-windows | MilkSU-Windows-x64-26.927.2-Setup.exe | 392,623,388 | b7eae613b21c39e5cb6037e7ff88509374e7a52a0d09ff5347e77d636c166209 |
| Linux | build-linux | MilkSU-Linux-x64-26.927.2.deb | 376,300,744 | 5bf590d945c6aa09f4d8effb1d73967831028cee0a184b61d38265851d9c09c9 |
| Linux | build-linux | MilkSU-Linux-x64-26.927.2.tar.gz | 456,421,263 | c79954ecf3287276b8c2f69ef47aec749af02ba96f1ba8a3fc68427084d4122c |

## 26.927.1 发行回执（tag v26.927.1 → `92d6a97b`，2026-09-27）

本版能力记录：深色模式明度阶调整（侧栏与页面背景对调，对话内卡片、胶囊再提亮一档）；
AGENTS.md 设计语言补「明度阶」「强调面」两条；测试修复（Node 26 下 jsdom localStorage 垫片、
product-loop 外部浏览器「管理」按钮匹配）；对照 models.dev 刷新钉死的模型事实。
tag 与分发 source `a654c4d5` 之间只差测试与文档提交，无未打进安装包的产品代码。

| 平台 | workflow | 文件名 | 大小（字节） | SHA-256 |
| --- | --- | --- | ---: | --- |
| macOS | build-macos | MilkSU-macOS-arm64-26.927.1.dmg | 506,801,799 | 8354f41b0d5159200bc680707778d409de1824999585e0ee964298d57a7dd612 |
| Windows | build-windows | MilkSU-Windows-x64-26.927.1-Setup.exe | 391,898,080 | 80fc49eec99bcb7146fe854cf0ab6815fea1121e948db03bd67bb8566f3587a2 |
| Linux | build-linux | MilkSU-Linux-x64-26.927.1.deb | 376,293,012 | 6d84fbf1dd20f96069f03029ee0518745eed841d0a6aadd4247c65ba4fe0c815 |
| Linux | build-linux | MilkSU-Linux-x64-26.927.1.tar.gz | 456,422,578 | 51f6ca7f3016150ea588bc54a605afbf69d491c68da365db94967bb4ac14b0e0 |

## 未打进最近安装包

工作树里已有、最近一次正式包装（版本见 README）没有的，以代码为准。tag `9e2825f3`
之后已合入 #190–#210 等一批修复与功能（详见 Git 历史），均未经真机验收。发下一版前仍缺的验收：

- Windows Computer Use 整段崩溃尚未真机验收。Windows / Linux 窗口铬尚未真机验收。
- 本机安全工具 capa 当前仅支持 macOS arm64/amd64（PR #193 在途）；Linux / Windows 上设置页
  显示「暂不支持」，不提供准备动作，也不提供「在 Coding 中配置」。
- 新会话不再默认继承最近项目（#169 改向），这条新行为还没有真机验收。
- 宽作业用 `recon-authorized-target` Skill，不造 typed sweep。Computer Use 选窗器仍是可选人工面。
- DSH `bash` 没有 MilkSU 侧超时上界。
- Deep Research durable 工作流已合入（#206 经 `integration/deep-research` 集成）：Pi 会话走
  typed research 动作 + research store（`data/domain/research/`）+ Research 浏览器 egress
  隔离；DSH 会话用轻量 `deep-research-web` Skill。已知待修（作者后续 PR 跟进）：
  sidecar 失联后 worker-stop-unconfirmed 无出口（该会话被禁止新 run，只能 Resume 后再
  Cancel 解开）；强杀后孤儿 worker 无清理（detached 子代理可能继续消耗 API 额度）；
  research store 带 v1→v2→v3 迁移阶梯（schema 从未发行，待收平成最终形态）；
  `MILKSU_ELECTRON_USER_DATA_DIR` 隐藏 env 无调用方待删；删除会话的研究数据级联非原子。
  Windows / Linux 原生完整研究任务未验收；Pi 同轮 worker overlap 未验证。
- 任务状况桌面通知（#210）当前只在 macOS / Windows 弹；Linux 返回 `unsupported`，
  设置页已注明「Linux 暂不支持桌面通知」。五类开关全默认关。
- issue #117 的另外几问、#155、#156 还没接到决策这一层。
- DSH 升到 `0.2.0-rc.2`（rc，尚无 stable）并经 dsh-llm-pi-ai 打开多 provider 模型：
  TokenFlux 模型表从产品目录快照合成（思考档位沿用内置事实），各官方 Provider key
  走 pi-ai 目录路由；官方 DeepSeek key 仍走 llm-deepseek（0.2 起 Anthropic Messages
  专用，`MILKSU_DSH_LLM_PROTOCOL` 机制删除）。`dsh-experimental-computer-use-cua-driver-mcp`
  0.2 缺版且产品路径无调用者，已从 sidecar 闭包移除。验收：官方 DeepSeek 路径
  `test:dsh-complete-loop --gui` A/B/C 全 PASS；TokenFlux 多模型路径用户实测可用。
  `test:product-loop` 本轮未跑。

## 完成线

1. 改对话、引擎、DSH 或隔离浏览器后跑产品回归。失败先修。
2. 用户要求发版时：先跑 `npm run test:product-loop -- --gui --suite all`。看 FAIL 项，有必要就查、修，再重跑失败套件。这些失败项通过之后才对照 models.dev（[发版流程](release-process.md) §1.5）→ 升版本号并推送 → 干净的 `main` 跑 `release:verify` → 新的三端回执。不挪已发出的 tag。Release 页创建成功后，按发版流程 §7 回写 README（版本、鸣谢、开源组件、截图和开篇介绍）。

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| P0 | 产品回归 | `npm run test:product-loop`。Settings「评测」不替代。 |
| P0 | Pi 真机 | 跨目录读写、CTF/CVE 交接、长输出续跑、重启恢复。 |
| P1 | 下一版三端回执 | 新版本号、同一 source commit、三端产物、SHA-256。安装包见 README。 |
| P1 | OTA | 侧栏下载，用户点安装并重启。有任务先确认退出。 |
| 未接线 | 远程控制 | 手机连本机，不是云 Agent。见 [远程控制](remote-control.md)，[#131](https://github.com/MilkSU-Official/milksu/issues/131)。 |
| 未接线 | CTF 比赛模式 / 实验室红队面 | 尚未设计准入。 |

只在新复现或用户明确要求时重开：已撤单会话图谱、Wails/CEF、关键词扫描用户句子做路由、自建计费、把 dirty HEAD 写成已发版、M3/M4 台账。
