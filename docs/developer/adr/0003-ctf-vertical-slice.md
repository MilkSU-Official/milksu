# ADR-0003：M2-A CTF 纵切与 Pi Security Adapter

> 状态：Accepted for M2-A
>
> 日期：2026-07-20

## 结论

M2-A 先交付一条可以真实运行、但故意很窄的 CTF 单题纵切：用户粘贴题面、可选上传小型文件并提供本地正确答案；Pi 使用真实模型提出下一步；Go Runtime 校验并执行类型化动作；独立 Flag Judge 决定成功；桌面面板只读取事实投影。

它的用途是回答一个比“模型会不会解题”更重要的问题：**成熟 Coding Agent Engine 能否保留通用推理能力，同时把安全任务的状态、动作边界、证据和成功条件交还给 MilkSU。** 本轮答案是可以，但还没有证明 Browser、Shell、Lab 和长期教学闭环已经成立。

## 运行边界

```text
React CTF Workspace
        │ Wails commands / job-event
        v
Go CTF Role Service
  ├─ Challenge Admission + Role Projection
  ├─ Security Runtime + Artifact/Evidence Store
  ├─ CTF Capability Policy
  └─ Independent Flag Judge
        │ AgentEngine.Propose(JSON)
        v
Pi Security Sidecar
  ├─ real Model Provider
  ├─ Pi Session + generic Tool Loop
  ├─ no builtin coding tools
  └─ only three proposal tools
```

M2-A 只有以下三种模型可见动作：

| 动作 | 含义 | 谁执行 | 能否宣布成功 |
| --- | --- | --- | --- |
| `ctf.inspect_material` | 读取已经由用户接入、且属于当前 Job 的 Artifact | Go Capability | 不能 |
| `ctf.decode_hex` | 对当前 Job 的 Artifact 做确定性十六进制解码 | Go Capability | 不能 |
| `ctf.submit_flag` | 把候选值保存成 Artifact，交给本地 Judge | Go Capability + Judge | 只有 Judge 可以 |

Pi 自带的 `bash`、`read`、`write`、`edit` 等 Coding Tools 不进入这条 Session。用户级 Extension、Skill、Prompt Template、Theme 和 Context File 也全部关闭。模型选择动作，不直接获得文件系统、网络、Shell、浏览器或 Docker 权限。

## CTF Role 怎样落在 Shared Runtime 上

Shared Runtime 保留通用事实；CTF Role 通过版本化 `RoleFact` 保存自己的不可变状态：

```text
job.created
artifact.admitted          原始题目附件，带来源与 SHA-256
role.fact.committed        Challenge + Material + Judge 版本
attempt.started            固定 Engine / Model / Environment / Evaluator
step.started
action.proposed            模型理由 + 类型化输入 + 预计 Effect
observation.committed      工具实际看到的原始结果
artifact/effect/evidence   产物、副作用账本和证据引用
evaluation.recorded        独立 Judge 的 pass/fail
outcome.decided
job.completed
```

`ctf.milksu.dev/v1alpha1` Projection 把 Shared Runtime 事实整理成 Challenge、Experiment、Submission 和学习知识点。React 不根据聊天文字猜状态，也不能写 Outcome。空集合必须编码为 `[]`，避免任务刚启动时前端把 `null` 当数组而白屏。

## Judge 隔离

用户提供的正确 Flag 只在接入时计算 SHA-256；明文不写入事件、RoleFact 或模型 `ROLE_STATE`，哈希也不发送给模型。候选 Flag 会作为 Agent Action 和 Artifact 留在任务事实中，由 Go Judge 重新读取 Artifact、计算哈希并形成版本化 Evaluation。

这个 Judge 只适合本地练习和回归测试。在线比赛的页面响应、动态靶场判题和用户人工确认属于后续 `SubmissionJudge`，不能伪装成本地哈希比较。

## 为什么另建 Security Sidecar

通用聊天 `bridge.js` 仍服务自由对话，它的 Conversation 不是 Security Job 的事实源。M2-A 新建 `security-bridge.js` 和独立 Go `SecuritySupervisor`，原因是：

1. CTF Attempt 必须从 MilkSU Projection 重建结构化状态，而不是复用聊天上下文；
2. 允许的工具集合要按 Role/Capability 固定，不能继承聊天或 Coding Tools；
3. 取消 Attempt、修改 Provider 设置和关闭客户端时，必须能终止对应 Pi Session；
4. Pi 原生事件和对象不能渗入 L2/L4 领域模型。

这仍是在 Pi 上做最小改造，不是从模型 API 重写 Planner、Session、Context 或 Tool Loop。

## 已验证结果

- Go 单元与竞态测试覆盖正确提交、先错后对、答案隔离、取消和桌面空数组契约；
- JSONL 协议检查确认 Sidecar 没有继承内建工具，只暴露三种 CTF Capability；
- Wails 生产构建中，真实 `deepseek/deepseek-v4-flash` 从桌面运行内置 Hex 题；
- 模型先检查 Artifact，再提交候选；Go Judge 独立判定通过；
- 最终留下 27 个严格递增事件，包含 Admission、RoleFact、Attempt、Experiment、Evidence、Evaluation 与 Outcome；
- 运行中与完成后界面均已通过真实 macOS 桌面检查，任务刚启动、实验数组暂时为空时不会白屏。

这些结果只证明当前离线纵切，不代表对任意 CTF 网站或题型的成功率。

## M2-A 没有做什么

- 没有 Browser Use、Computer Use、Shell、Socket、SSH 或网络访问；
- 没有自动下载、启动、重置和清理本地靶场；
- 没有截图 OCR、本地目录授权或聊天附件路由；
- 没有比赛、训练计划、长期用户学习档案；
- 只有 Delegate，没有 Coach 与 Copilot；
- 只有已知答案的本地 SHA-256 Flag Judge；
- 没有证明 Pi 比原版 Coding Agent 的 benchmark 收益；
- 没有完成可独立分发的 Node/Sidecar 打包。

因此 M2 的下一个大模块不能自动开工。需要用户在以下路径中做产品选择并确认风险：先接受控本地 Lab + File/Shell，或先做 Managed Browser + 任意网站 Intake。无论选哪条，都必须先补齐凭据与 Sidecar 分发边界，并对新增第三方执行组件做固定版本和供应链评审。

## 保留技术债与安全门

1. **凭据**：旧设置层仍可能把 Provider Key 写入 `0600` JSON。M2-A 实跑使用进程环境；在开放 Browser/Shell/Lab 前必须迁移 macOS Keychain，JSON 只保存引用。
2. **Sidecar 分发**：开发构建从仓库启动 `security-bridge.js`，并依赖系统 Node 与 `node_modules`。可交付应用必须把固定、签名、可复核的 Sidecar Runtime 放入 App bundle。
3. **Intake 原子性**：Artifact 文件与追加事件已有恢复语义，但 Job 创建、多个材料接入和 Challenge RoleFact 还不是单一批次事务。扩大文件来源前要增加 admission transaction 或可恢复的 intake state。
4. **供应链**：桌面生产依赖 `npm audit --omit=dev` 为 0；VitePress 本地开发链仍报告 2 个 moderate、1 个 high advisory，当前没有上游可用修复，不进入桌面运行时。文档开发服务器只绑定本机，不对不可信网络开放。

## 可重复验证

```bash
npm run test:security-bridge
go test -race ./...
go vet ./...
npm --prefix app run build
npm --prefix app run lint
npm run docs:build
npm audit --omit=dev
/Users/milksu/go/bin/wails build
```

真实模型检查需要用户自己的 Provider 凭据；凭据只从本地设置或环境传给 Sidecar，不写入测试、日志或仓库。
