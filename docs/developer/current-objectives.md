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

出厂默认官方 DeepSeek Flash、运行时 Pi。新对话可选 Pi 或 DeepSeek Harness；设置里的默认运行时只改新对话。工作树 Pi 钉 0.87.0，DSH 钉 `0.1.6-alpha.1`。DSH 是内核，不是 UI。

产品回归：`npm run test:product-loop`。见 [产品回归循环](product-regression-loop.md)。

## 未打进最近安装包

工作树里已有、最近一次正式包装（版本见 README）没有的，以代码为准。发下一版前仍缺的验收：

- Windows Computer Use 整段崩溃尚未真机验收。Windows / Linux 窗口铬尚未真机验收。
- 新会话不再默认继承最近项目（#169 改向），这条新行为还没有真机验收。
- 宽作业用 `recon-authorized-target` Skill，不造 typed sweep。Computer Use 选窗器仍是可选人工面。
- DSH `bash` 没有 MilkSU 侧超时上界。
- issue #117 的另外几问、#155、#156 还没接到决策这一层。

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
