# 子 Agent 工作代理模型合同

> 文档状态：**Current / Design contract**
>
> 最后对齐：2026-09-06
>
> 本文记录已锁定的产品合同，供 Product UI / Platform 在 PR 评论中会签。
> 它不是实施队列，也不是发版宣称。实现是会签之后的后续切片。

当前发行事实仍以 [当前开发目标](current-objectives.md)、[文档状态](document-status.md)、
当前代码和真实平台回执为准。不要把本页写成已接线能力。

## 状态

Current / Design contract。不是实施队列。

Milk SU 与产品表面负责人已对齐 v1 口径。本页只把合同写清楚，便于 Product UI Lead /
Platform Lead 在对应 draft PR 评论中会签。会签完成前不实现、不把该能力写进
`current-objectives.md` 的发行或完成线。

## 问题

用户希望主 Agent 继续用强模型，子 Agent 对小任务改用更便宜或更快的模型。

今天 MilkSU 子 Agent 在 `milksu-route → milksu-relay` 改写之后继承父会话模型。
Composer 只有一个主模型选择器。没有「工作代理模型」设置，也没有每次派出子 Agent
时的模型菜单。

## 跨产品对照（短、以当前事实为准）

这些对照只说明别家怎么选模型，不构成 MilkSU 要抄的 UI。

| 产品 | 当前做法 | 对 MilkSU 的含义 |
| --- | --- | --- |
| Cursor | 默认继承；角色可钉模型；存在 “subagent default model”，但父 Task 常常覆盖 | 不要做成「设置里有默认、派出时再被父任务盖掉」的债 |
| Hermes | 只有全局 `delegation.model`；有意不做按任务混用 | 全局覆盖可以，不要做成每条任务另选 |
| Pi / MilkSU 今天 | 见下一节 | 只改 spawn 时选哪个 `--model`，不另造分发器 |
| DSH | 模型在 provider / `agentOptions` 配置里 | 这是配置，不是对话里每次派出的选择器 |

### Pi / MilkSU 今天（实现锚点）

- 打包后的 `pi-sub-agent` 经 patch 改到 MilkSU runner：`patches/pi-sub-agent+0.1.5.patch`。
- 子进程由 `sidecar/pi/pi-subagent-runner.cjs` 拉起。`resolveAgentModel(agent, fallbackModel)`
  选出模型后写入子进程 `--model`。父会话的虚拟 `milksu-route/…` 经
  `rewriteRoutedModelArguments` 改写成 `milksu-relay/…`，并写临时 `models.json`，
  凭据引用 `$MILKSU_RELAY_KEY`。
- 路由与来源选择在 `sidecar/pi/model-source-routing.js`。Key 与父会话同一账户 /
  个人来源，不进入模型上下文、工具输出、日志或普通文件。

后续实现只能接着这条路径改「子进程拿到哪个 `--model`」，不能另开一条 Desktop RPC
或第二套 harness。

## 已锁定的产品合同（v1）

1. **Composer 只保留一个主模型选择器。** 对话栏不出现第二份模型菜单。
2. **子 Agent 默认继承父会话模型。** 未设置覆盖时，行为与今天一致。
3. **可选全局覆盖：** 设置 → Coding →「工作代理模型」（worker model）。
   这是**一条**全局覆盖；空 / 未设置 = 跟随主会话。将来做 UI 时，中英文必须同一处
   `t('工作代理模型', 'Worker model')`。本页不实现该控件。
4. **v1 不得在每次派出子 Agent 时弹出模型菜单。**
5. **v1 不出现按角色堆叠的可见选择器。** 不要做成 planner / reviewer / writer 各选一个模型。
6. **不要发明第二套 harness、dispatcher 或 Desktop RPC 路由。** 继续走现有 Pi 子进程 +
   `milksu-route → milksu-relay` 改写。

空控件保持空白，只显示控件自己的标签，不加「还没有 / 打开以后会出现」说明。

## 平台 / harness 边界

后续实现（不在本文、不在本 PR）只允许改子进程 spawn 时 `--model`（或 Pi
`defaultModel` / `agentOverrides`）怎么选，并且仍然经过现有
`milksu-route → milksu-relay` 改写和凭据边界。

- Key 继续与父会话同一账户 / 个人来源。磁盘上不写明文 Key。不另开第二个计费账户。
- 三端 sandbox 差异（macOS `sandbox-exec`、Windows / Linux 路径与权限）与本能力正交，
  不要绑进 v1。
- Coding Agent Lead 否决第二套 harness。Security Key 规则不变：Key 不进模型上下文、
  工具输出、日志、诊断、文档或普通文件。

## 本 PR 明确不做

任何产品代码、Vue、Settings UI、Sidecar runner 改动、打包，或把该能力接入生产依赖图。
本页只是合同。会签之后另开实现切片。

## 会签清单（写在 PR 评论，不写进代码）

- [ ] Product UI Lead：Composer 只有一个主模型选择器；默认继承；可选一条全局工作代理模型；不出现每次派出的模型菜单
- [ ] Platform Lead：只改 spawn `--model` 路径；不新增 Desktop RPC / 第二路由；Key 同源、不落盘明文
- [ ] Coding Agent Lead：harness 合同以本文为准
