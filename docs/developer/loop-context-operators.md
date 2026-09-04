# Loop 切片：rewind / handoff 上下文算子

> 文档状态：**Target / Not implemented**
>
> 选定范围：Pi compact 之外的上下文算子。摘要仍由 Pi `AgentSession.compact` 产生，不自写第二摘要器。
>
> 缺什么：只有 85% 空闲自动 compact 与 `/compact`。没有「丢掉最近一段探索」或「compact 后接到新会话」。更关键的是：**还没有失败轨迹证明 compact 不够。**

## 目标

1. **先证伪。** 用夹具跑「先走死胡同再改方向」。若现行 `/compact` 之后模型不再碰已放弃路径，**本切片关闭，不实现 rewind/handoff。**
2. 仅当 compact 后仍去改已放弃文件或把失败实验当约束时，才增加：
   - **rewind**：丢掉最近一段探索，留短报告在同一会话；
   - **handoff**：走现行 Pi compact，再开新会话接同一任务（复用 `/新任务` + 摘要，不新造会话类型）。
3. 斜杠最多加 `/rewind`、`/handoff`（或等价中文标签），叠在现有 `/compact`、`/新任务` 上。未证实前不要做 Composer 常驻按钮。
4. 一次性压缩仍显式 `cacheRetention: none`。长任务自动 compact 路径不变。

## 现状

问题未证实。compact 指令要求保留会影响后续的细节，失败实验也可能留下。这是假说，不是回执。本 PR 的第一验收是基线实验，不是先写算子。

## 测试方式

**阶段 A（必须先跑，写进 PR 评论或 Evidence）：**

- 固定仓库。任务：先按错误方案改一组文件，再要求改用正确方案并还原错误方案。
- 在错误方案完成后触发现行 `/compact`，再发正确方案。
- 记录：compact 后 context token、是否还 `edit`/`bash` 已放弃路径、最终 diff 是否含错误方案残留。

若阶段 A 显示 compact 已够：关闭实现，保留本文件结论为「不需要」。

**阶段 B（仅阶段 A 失败时）：**

1. rewind 后：已放弃路径不再出现在随后工具里；短报告可被下一跳读到。
2. handoff：新会话带摘要、无完整死胡同轨迹；旧会话仍可打开。
3. `/compact` 回归：85% 自动路径与任务 UI `/compact` 仍是同一 Pi API。
4. Vue：斜杠目录多两项，中英 `t()` 成对；`running` 时的 disabled 规则与 `/compact` 一致或写明差异。

## 验收标准

- [ ] 阶段 A 基线数字或结论在合并前可见。没有基线不得合并 rewind/handoff 实现。
- [ ] 阶段 A 已够用：本 PR 只留下「不需要」的结论，或关闭实现提交。
- [ ] 阶段 A 不够：rewind/handoff 有 Sidecar 测试；compact 回归通过；斜杠两项有 Composer 测试。
- [ ] 不新增第二套 MilkSU 摘要器。
- [ ] 空斜杠菜单行为不变；不写「还没有整理过上下文」一类空状态。
- [ ] 不把 rewind 做成静默自动（必须是用户斜杠或类型化产品动作）。

## 非目标

Advisor、默认自动 rewind、新会话类型、把 compact 换成 OMP snapcompact。

## UI

斜杠 1–2 项。视觉与现有 `/compact` 同一层。不要新页面。

## 删除路径

去掉斜杠与 Sidecar 动作；compact 保持现状。

## 本树状态（`feat/context-usage-categories`）

与 #21 / #33 以及 #35–#38 同树推进。阶段 A（真模型先走死胡同再 `/compact`）仍需用户授权的计费链路。按合同：**没有阶段 A 失败回执之前，不实现 `/rewind` / `/handoff`。** 斜杠与 compact 路径保持现状。

## 基线实测（当前架构，未实现本切片）

机器：macOS darwin arm64，Node v26.0.0，Pi 0.84.1。时间：2026-08-25T10:25:13Z。命令：`node --test sidecar/pi/loop-baseline-compact.test.js`（2 通过）。本轮 **未** 跑「先走死胡同再 `/compact`」的真模型阶段 A（需要用户授权的计费链路）。

构造：

1. `contextUsageSnapshot({ inputTokens: 85000 }, 100000)`。
2. 读 `compactionInstructions`。
3. 读 `ChatComposer.vue` 斜杠目录。

| 项 | 当前架构 |
| --- | --- |
| 自动 compact | 输入+缓存命中 ≥ 窗口 **85%** 且空闲 |
| 85000 / 100000 | `shouldCompact: true`，percent 85 |
| 摘要指令 | 「不要丢弃任何会改变后续行为的细节」；CTF 还要求保留失败实验 |
| `/compact` | 有 |
| `/rewind` | **无** |
| `/handoff` | **无** |
| rewind API | **无** |

**Summary：** compact 会把失败探索摘要进后续约束；没有丢掉探索的算子。阶段 A（真模型走错再 compact）还没跑，不能根据本次数值合并 rewind 实现。斜杠与指令的实机事实已经足够证明「现在只有 compact」。
