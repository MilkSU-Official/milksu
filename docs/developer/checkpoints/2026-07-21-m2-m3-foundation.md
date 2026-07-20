# 2026-07-21 检查点：M2 → M3 授权学习能力基础

> 状态：工程检查点，不是 M2 或 M3 的产品验收
>
> 目的：把当前能力安全地保存到 GitHub，让下一次任务可以从明确边界继续，而不是从未记录的工作区恢复意图。

## 本检查点冻结了什么

这批代码建立了后续 M2/M3 共用、但仍保持最小化的能力基础：

- `ScopeGrant / Target / PolicyDecision`：授权由本地用户创建，模型只能消费，不能自行创建、扩展或续期；目标按 Origin、Directory、Socket、Lab、Browser Tab 精确归一化。
- CTF Challenge Intake 契约：保存来源、授权范围、Track、Human Goal，并支持本地哈希 Judge 与外部人工确认 Judge。
- Coach、Copilot、Delegate 领域契约：Coach 只能读取材料、做确定性解码和提供分级提示，不能代替学习者提交答案；提示、复盘和独立步骤进入 Human Outcome 投影。
- Managed Lab 基础：固定版本的 OWASP Juice Shop 由程序获取、启动、等待、重置和停止，默认只绑定回环地址并检查固定镜像与容器安全不变量。
- Managed Browser 与 User Browser Bridge 基础：隔离 Profile 的控制命令按授权 Origin 校验；用户浏览器必须通过扩展显式分享当前标签页，并经过本地配对令牌。浏览器网络层强制隔离仍属于未完成项。
- 本地 Vuln fixture：一个不会监听网络的 packet parser 教学样本，为 M3 的编译、触发、最小化和稳定复现闭环提供固定输入。
- 桌面命令契约：CTF 学习记录、继续 Coach 回合和外部提交人工确认已经暴露到 Wails/TypeScript 边界。

自动测试覆盖授权范围不可扩大、敏感 Effect 需要批准、固定 Lab 生命周期、浏览器标签页配对、Coach 不越权提交、外部 Judge 不伪造成功，以及学习记录投影。

## 明确没有完成什么

以下项目不属于这个检查点，不能因为包已经存在就宣称完成：

- `App` 尚未创建和管理 `labmanager.Manager`、`browsercap.Manager`，前端也没有 Lab/Browser 操作页面。
- CTF 界面尚未提供 Coach/Copilot 选择、来源类型选择、分级提示交互、外部平台结果确认和长期训练组织。
- Managed Browser 的真实 Chrome 回环测试需要显式启用；Juice Shop 真实 Docker 生命周期也尚未在本检查点运行。
- Origin 级命令校验还不是浏览器网络沙箱；在网络层 allowlist 完成前，不得把 Managed Browser 用于不受信任的外部目标自动化。
- 受控 File/Shell/Socket Capability、下载附件、截图 Intake、浏览器提交前批准和提交响应 Evidence 尚未接入完整 CTF Loop。
- Vuln 只有固定 fixture；`Target / Hypothesis / Experiment / Crash / Reproduction / Root Cause / Exploitability` 领域投影、能力、Evaluator、恢复和工作台仍未实现。
- M2 完成标志尚未满足，M3 MVP 也尚未开始验收。

## 下一次任务的 M3 发布门

下一次“一口气做到 M3 MVP”必须先做一次窄范围发布门检查：

1. 只在项目内置、本地、明确授权的 fixture 上执行；在权限和审批链进入产品界面前，不开放任意外部目标能力。
2. 确认模型凭据继续只通过 Keychain/进程边界传递，不进入事件、Artifact、日志或前端状态。
3. 复用现有 Job、Attempt、Step、Action、Observation、Artifact、Evidence、Evaluation 和 Outcome；只有 CTF 与 Vuln 都真实需要的概念才上提到共享 Runtime。
4. Vuln 的成功必须由干净环境中的稳定复现 Evaluator 决定，模型只能提出候选问题、根因和影响。
5. 同时交付 Domain Outcome 与 Human Outcome：用户能看到触发证据、复现次数、根因解释、提示依赖和可继续的下一步。

## M3 MVP 的最小验收路径

固定 packet-parser fixture → 记录目标版本和授权 → Agent/确定性能力编译并运行 → 保存 ASan Crash 与触发样本 → 最小化输入 → 在干净进程连续复现三次 → Evaluator 判定 → 工作台展示假设、证据、根因和学习复盘 → 重启后继续任务。

这条路径不得演化成通用互联网扫描器，也不得把未经授权的攻击动作包装成“学习”。MilkSU 的产品主线仍是人与安全 Agent 在明确授权环境中共同学习、实验、验证与复盘。
