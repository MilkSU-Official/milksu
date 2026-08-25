# Loop 切片：子 Agent 结构化回传与活状态

> 文档状态：**Target / Not implemented**
>
> 选定范围：父 Loop 的 `subagent` 工具如何收回结果，以及人如何看见子任务还在不在跑。继续用现有 Pi 子进程 + writer worktree，不造第二套 harness。
>
> 缺什么：父侧拿到散文；产品里没有子任务名单（id / 状态 / 结束码 / yield）。

## 目标

- 子 Agent 结束必须交出可校验 schema（至少：`status`、`cwd` 或 worktree id、`files[]`、`findings[]`、`exitCode`）。父 Loop 当 `tool_result` 字段用，不靠再理解一段话。
- 只读角色（planner / reviewer / scout / security-auditor）与 writer worktree 角色保持现有隔离；schema 不让只读子 Agent 变成可写。
- 产品上给一个 **名单/状态面**（环境栏或工具组，不是第二条聊天）：id、角色、状态、耗时、结束码；点开看 yield。这是本切片的测试操作面，也是以后只 steer 某一个子任务的入口。
- 父会话停止仍要停子进程。

## 现状

`subagent` 已在 Coding 工具表里；effectful 子进程有 worktree 与模型改写。回传是自然语言。前端几乎不投影子任务活状态（用量里只在结束后拆 usage）。没有这个面就无法稳定测「父 Agent 有没有读到字段」。

## 测试方式

1. **Schema 单测**  
   合法 yield 通过；缺字段失败；只读子 Agent 带写入路径必须拒绝。
2. **父 Loop 夹具**  
   子 Agent 交 `{ files: ["a.ts"], findings: [{ path: "a.ts", note: "renamed" }] }`。断言父模型在 **零次额外工具** 下能报出 `files[0]`（假 Provider 脚本直接读 tool_result，不依赖真模型发挥）。
3. **生命周期**  
   跑 / 停 / 成功 / 失败；父 abort 杀掉子进程；writer 不得改主会话 cwd。
4. **Vue**  
   名单在子任务 start 时出现，结束时变成成功/失败；空名单不画空卡片或「还没有子任务」说明（空白 + 控件自己的标签）。中英 `t()` 成对。视觉走现有事实面（工具组或环境栏），不新造一种卡片。

## 验收标准

- [ ] 假 Provider：父侧 tool_result 含约定字段，测试断言路径取值，不解析散文。
- [ ] 只读 vs writer 隔离回归（现有 `bridge-policy` / `pi-subagent-runner` 测试仍过）。
- [ ] 父 abort ⇒ 子进程退出（有测试，不只注释）。
- [ ] UI：至少一个活状态名单；设计语言合同覆盖该组件；无第二条对话、无空状态教练文案。
- [ ] 不把子 Agent 的 Key、绝对本机家目录或 relay 凭据写进 yield。
- [ ] 不把「有按钮」写成「父 Loop 已会用字段」；Loop 完成以夹具取字段为准。

## 非目标

Advisor 窗、OMP Agent Hub 全套 IRC、默认打开更多子 Agent 类型、替换 `pi-sub-agent`。

## UI

环境栏或工具活动组里的子任务名单。需要过设计语言五层：材质/壳/列表指挥面不新增；这是事实面。

## 删除路径

关掉 schema 校验则回散文回传；拿掉名单组件；`subagent` 工具仍可按现状调用。
