# Loop 切片：rewind / handoff 上下文算子

> 文档状态：**Implemented / unreleased**
>
> 选定范围：Pi compact 之外的上下文算子。摘要仍由 Pi `AgentSession.compact` 产生，不自写第二摘要器。

## 目标

1. **rewind**：丢掉最近一段探索，留在同一会话。
2. **handoff**：先用 Pi `createBranchedSession` 分叉，再对分叉走现行 `AgentSession.compact`，新会话继续同一任务；旧会话仍可打开。
3. 斜杠 `/rewind`、`/handoff` 叠在现有 `/compact`、`/新任务` 上。不做 Composer 常驻按钮。主入口分别在最后一条用户消息和上下文用量面板。
4. 一次性压缩仍显式 `cacheRetention: none`。长任务自动 compact 路径不变。

## 现状

Pi 没有独立的 `/rewind` / `/handoff` 会话 API。产品接到已有能力：

- rewind → `AgentSession.navigateTree`（丢掉最近一段用户回合之后的探索）
- handoff → `SessionManager.createBranchedSession` + 现行 `compactSession`

用户授权后直接落地，不再等阶段 A 计费夹具。Pi 示例扩展 `examples/extensions/handoff.ts` 会自写第二摘要器，不采用。

## 测试方式

1. rewind 后：已放弃路径不再出现在随后工具里；短报告可被下一跳读到。
2. handoff：新会话带 Pi compact 摘要、无完整死胡同轨迹；旧会话仍可打开。
3. `/compact` 回归：85% 自动路径与任务 UI `/compact` 仍是同一 Pi API。
4. Vue：斜杠两项中英 `t()` 成对；最后一条可丢掉的用户消息显示「丢掉这段」；用量环面板提供「整理上下文」和「接到新会话」。`running` 时 rewind 可点（先 abort），handoff 与 `/新任务` 一样禁用；compaction 进行中两项都禁用。任意更早的用户消息仍走「编辑并从这里重发」。

## 验收标准

- [x] rewind/handoff 有 Sidecar 测试；斜杠两项有 Composer 测试。
- [x] 不新增第二套 MilkSU 摘要器。
- [x] 空斜杠菜单行为不变。
- [x] 不把 rewind 做成静默自动（必须是用户斜杠或消息上的「丢掉这段」）。

## 非目标

Advisor、默认自动 rewind、新会话类型、把 compact 换成 OMP snapcompact、Pi 示例 `/handoff` 第二摘要器。

## UI

斜杠 2 项，与现有 `/compact` 同一层。最后一条可丢掉的用户消息悬停条常显「丢掉这段」。用量环面板提供「整理上下文」和「接到新会话」。不要新页面，不要 Composer 常驻按钮。设计预览：`app/context-operators-preview.html`（开发时打开 `http://127.0.0.1:1420/context-operators-preview.html`，不进产品入口）。

## 删除路径

去掉斜杠与 Sidecar `rewind_session` / `handoff_session`；compact 与 fork 保持现状。
