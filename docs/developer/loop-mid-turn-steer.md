# Loop 切片：回合中途引导（Codex 语义）

> 文档状态：**Target / Not implemented**
>
> 选定范围：运行中用户输入如何进入 **当前** Pi 回合。这是人在同一条 Loop 里插话，不是第二模型，也不是新开一条用户回合。
>
> 缺什么：`steer_message` 已存在，但 Pi 要等当前工具批次结束才把引导交给下一次模型调用。Composer 显示「N 条引导已排队」。模型正在流式打字时，引导进不了当前那一跳。

## 目标

运行中发送不再当成「排队等下一条对话」，而是并进本回合。

- 打断当前 **模型 stream**（assistant 文本正在输出时），把这段话作为本回合下一次模型调用的 steering，而不是新的 user 回合。
- 当前 **不可安全中断的工具**（例如已启动的 bash）可以跑完，但不要再等整段尚未完成的 assistant 文本流。
- 现有 `steer_rejected`、缺 session 时回退到普通 `send` 的路径保留。
- 不扫用户句子做关键词路由。GUI 发送仍是「正在跑 → steer」，不是解析「继续/停/改」。
- **不是 advisor。** 不要旁路聊天窗。

可选同 PR 窄闸（自动，默关或仅夹具）：对正在流出的 `edit`/`write`/`bash` 参数做规则检查，命中则 block + 注入 reminder。不扫用户句子。没有流量证据前，不得把该闸写成产品完成。

## 现状

问题对用户是真的：`ChatComposer` 在 `running` 时仍接收输入，文案是「发送引导」和「N 条引导已排队」。Sidecar 注释写明 `steer()` 排在当前 tool batch 之后、下一次模型调用之前。这与 Codex「打进去就进当前回合」差在 stream 阶段。

## 测试方式

先在 `main` 上量：运行中发送之后，到该句出现在模型上下文的延迟。

1. **Sidecar**  
   - 假 Provider 正在流式输出时 `steer`：断言 abort 当前 stream，引导进入当前 turn 的 steering 队列并触发下一跳，不新建 user 消息回合。  
   - 假 Provider 正在执行不可中断 bash 时 `steer`：bash 可结束；结束后的下一跳必须带上引导；不得另开对话。  
   - `steer_rejected` 与 session 丢失回退：字不能丢。
2. **Vue**  
   运行中发送后：引导气泡不是普通待发送的下一回合；排队计数在「已并入本回合」后更新或清零；撤回仍走 `remove_queued_message`。
3. **手工**  
   真会话里模型还在打字时发送一句纠正，确认下一跳按纠正走，而不是等整轮工具循环结束才看到。

## 验收标准

- [ ] 运行中发送不创建第二条并列的 user 回合来代表「下一条对话」。
- [ ] assistant 纯文本流式阶段：从发送到模型上下文包含该句的延迟有上限（秒级 abort，而不是等完整 assistant 消息）。
- [ ] 工具执行阶段：引导最晚在该工具结束后的下一次模型调用出现。
- [ ] Composer：中英 `t()` 成对。「已排队」改为能区分「等待当前工具结束」与「已并入本回合」。空控件保持空白，不写教练式说明。
- [ ] 附件在 steering 路径仍拒绝（现状），或在本 PR 写明为何改变并补测。
- [ ] 自动参数闸若未做：PR 标明未做，不把 3a 写成已完成。
- [ ] 无侧边聊天、无顾问模型。

## 非目标

Advisor、关键词切模式、新斜杠、子 Agent Hub（那是另一切片）。

## UI

Composer 演化：运行中发送 = 本回合引导。设计语言走现有 Composer / 队列条，不新开卡片层。视觉合同：若改文案或队列条，补 `ChatComposer` 测试；不改全局 token。

## 删除路径

Steer 退回「等 tool batch」。Composer 文案退回「引导已排队」。

## 基线实测（当前架构，未实现本切片）

机器：macOS darwin arm64，Node v26.0.0，Pi 0.84.1。时间：2026-08-25T10:25:13Z。命令：`node --test sidecar/pi/loop-baseline-steer.test.js`（2 通过）。

构造：

1. 读本机 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` 里 `steer()` 注释。
2. 调用 MilkSU `steerSession`，断言只 `session.steer`，不 `prompt()`。
3. Composer 源码：`running` 时发送文案为「发送引导」/「N 条引导已排队」。

实测合同（Pi 0.84.1 源码原句）：

> Delivered after the current assistant turn finishes executing its tool calls, before the next LLM call.

| 项 | 当前架构 |
| --- | --- |
| 是否 abort 当前 assistant 文本流 | 否 |
| 引导何时进入下一跳模型 | 当前 **工具调用批次结束之后** |
| MilkSU 是否另写循环 | 否，只转 `session.steer` |
| Composer | 引导显示为 queued |

**Summary：** 实机合同与 Claude Code 接近（等当前工具结束），与 Codex Enter 默认中途注入不同。没有 stream abort。本切片要对齐 Codex 的缺口，在这台机器上的代码路径里可以直接读到。
