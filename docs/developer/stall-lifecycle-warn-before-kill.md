# 挂死生命周期：预算先告警后掐死，引擎重启兜底

状态：已实现。

## 1. 现场与两处抢跑

系统里有两道机制管同一个回合的「不响应」：

- 预算守卫 `sidecar/pi/bridge-request-budget.js`：请求发出后，首字节预算到点就主动
  `abort`，抛出 `RequestBudgetError`，这一回合直接判失败。读者看到的是「Agent 运行失败」
  红叉横幅，没有重试机会。
- 看门狗 `app/src/lib/turnStall.ts` + `useConversations.notifyTurnStall`：连接还活着但长时间
  没有数据就发「疑似挂死」软告警，不杀回合，等读者决定。

2026-09-29 实测：DeepSeek 读一个 3.16MB 请求要 51s 以上首字节，预算守卫先动手掐死，看门狗
根本来不及举牌。而 DeepSeek 在 60-80s 之后仍可能真的回话，那一刀里有相当一部分是误杀。

另一处来自上游 #208 的评审留言：`wakeStuckTurn` 在 sidecar 不响应 `abort_session` 时，
重发的 prompt 只会排在挂死 prompt 之后，永远轮不到。真正的兜底是重启 sidecar。再发一条
没有用。

这两件事是同一根生命周期的两端：**判死要晚，告警要早，退出要交回读者手里。**

## 2. 修一：预算到点转告警，硬掐只作最后手段

### 2.1 行为变化

| 时刻 | 现在的行为 | 改后行为 |
| --- | --- | --- |
| 首字节软预算到点 | 立刻 `abort`，判失败 | 发 `turn.stall_warning`，转「疑似挂死」态，继续等 |
| 首字节软预算 + 宽限到点 | 不适用（已判死） | 才 `abort`，抛 `RequestBudgetError` |
| 首字节之后断流软阈值到点 | 立刻 `abort`，判失败 | 发 `turn.stall_warning`，继续等 |
| 断流软阈值 + 宽限到点 | 不适用（已判死） | 才 `abort`，抛 `RequestBudgetError` |

`turn.stall_warning` 走渲染层已有的停滞通道：横幅、`stalled` 第四类通知、侧栏状态位都是
同一套，不另造一套。硬掐仍然抛 `RequestBudgetError`，所以「Agent 运行失败」红叉横幅这条
既有路径原样保留。三者的串接是：

```
软预算到点 → turn.stall_warning → 看门狗 stalled 呈现 + 第四类通知（读者可重试/停止/重启）
宽限到点   → RequestBudgetError → 既有失败路径 → 红叉横幅 + 失败通知
```

### 2.2 新阈值与依据

预算对象从「两个闹钟」变成「每个阶段两个闹钟：一软一硬」。默认值集中在
`DEFAULT_REQUEST_BUDGET`，环境变量可覆盖。

| 阈值 | 默认 | 作用 |
| --- | ---: | --- |
| `ttfbBaseMs` | 20_000 | 首字节软预算基数（#212 调宽后的组合口径） |
| `ttfbPerMbMs` | 10_000 | 每 MB 追加（#212 调宽后的组合口径） |
| `ttfbMaxMs` | 300_000 | 首字节软预算封顶（#212 调宽后的组合口径） |
| `stallMs` | 30_000 | 首字节之后的断流软阈值，不变 |
| `killGraceMs` | 120_000 | 软告警之后还给多久（新增） |
| `killMaxMs` | 480_000 | 单阶段硬掐的绝对上限（新增） |

硬掐时刻 = `min(软阈值 + killGraceMs, killMaxMs)`：

- 宽限取 120s，是因为实测模型在 60-80s 才回话；给到两倍余量，误杀那部分就被覆盖掉了。
- 上限取 8 分钟，是因为一个 sidecar 是每 (内核, 工作区) 一个进程，一个挂死的请求会挡住
  同工作区其它会话。8 分钟是「读者一直看着明确的疑似挂死横幅、随时能手动退出」能接受的
  最长占用；再长就不是等待，是占着茅坑。
- 上限必须 ≥ `ttfbMaxMs + killGraceMs`（300s + 120s = 420s，取 480s 留余量）：否则软预算
  已到封顶的请求（≥28MB）宽限归零，告警和硬掐同刻触发，「先告警后掐死」失效。这是
  #212 与本 PR 合并时定下的组合约束，改 `ttfbMaxMs` 时要跟着看它。

### 2.3 事件字段

sidecar 新增事件 `turn.stall_warning`，载荷：

- `stallStage`：`ttfb` 或 `stream`。
- `stallKind`：`ttfb` 或 `stall`（与 stallStage 一一对应，透传备用）。
- `budgetMs`：触发告警的软阈值。
- `payloadBytes`：请求体积估算值，便于读者判断是不是请求太大。

引擎改名表必须认领它（`runtime/src/events.ts`），否则会落到 `engine.raw.` 前缀，
渲染层收不到。新增带点号的 sidecar 事件名仍要人工核对改名表里有对应分支。

## 3. 修二：sidecar 不响应 abort 时，读者亲手重启引擎

### 3.1 「不响应」的判据

`abort_session` 发出去之后，满足下面任一条就算 sidecar 不响应：

1. 心跳已停（`engine-gone`）。心跳都断了，说明进程大概率已经没了，abort 无从投递。
   `turnStall.ts` 的 `heartbeatGraceMs` (15s) + `engineGoneMs` (45s) 已经在判定这件事。
2. 心跳还在（`model-stalled`），但 abort 发出满 `abortResponseGraceMs`（15s）之后，
   这个对话再没有任何新的流事件（心跳不算进展），回合仍在跑。

判据集中在 `app/src/lib/engineRestart.ts`，纯函数 `decideEngineRestart`，阈值可用
`VITE_MILKSU_ABORT_RESPONSE_GRACE_MS` 覆盖。15s 的依据：正常 abort 的回应是本地 IPC 加
一次进程内取消，毫秒级；15s 已经比正常回应大三个数量级，再等只会浪费读者时间。

### 3.2 动作

读者点「重启引擎」时：

1. 渲染层调 `restart_engine`，后端 `Supervisor.RestartEngine` 立刻杀掉服务该会话的
   sidecar 进程（不响应 abort 的进程只能杀掉），把它从轮换位和 parked 集合里摘掉，
   并忘掉它服务的会话，这样下一次派发会拉起一个全新的 sidecar。
2. 本地结算当前回合：清 running、清停滞标记、清队列停滞；给这个会话写一条说明
   「引擎已重启，当前回合已中断」。
3. 用新引擎重发最后一条没有被回答的用户消息（复用 `wakeStuckTurn` 的重发路径）。此时
   sidecar 是新的，那条重发不会再排在挂死 prompt 的后面。

**不自动重启。** 只有读者点按钮才执行。UI 上把代价说清：当前回合会丢，同工作区其它
正在跑的会话也会被这个 sidecar 的退出中断。

### 3.3 事件

sidecar 退出后，引擎给每个受影响会话发 `engine.restarted`（`done: true`，不带 `error`）。
它和 `engine.stopped` 同一条结算路径，只是文案不同。读者自己要求的动作不该报成故障，
所以不触发「Agent 运行失败」红叉横幅。

## 4. 测试

- sidecar：`bridge-request-budget.test.js` 改断言（软告警不再 abort）、
  `bridge-request-budget-stream.test.js` 改断言（首字节预算到点先告警，宽限后才报错）。
- 前端：`turnStall.test.js`（新增 `engineWarned` 输入）、
  `engineRestart.test.js`（abort 判据真值表）、
  `useConversationsTurnStallNotify.test.js`（告警事件链路）。
- 桌面：`node --test`（Electron 侧不涉及本次改动，仍跑一遍回归）。
- Go：`supervisor_restart_engine_test.go`（重启杀进程 + 发 `engine.restarted`）。
- 类型：`app` 的 `tsc -b`。

## 5. 不做与遗留

- 不做「连续告警 N 次后自动掐死」：硬掐只按时间上限，不为告警次数增加状态机。
- 不做跨工作区的引擎健康面板：重启入口只挂在停滞横幅上。
- `abortResponseGraceMs` 只覆盖「读者已按过停止/重试」这个场景；没按过任何按钮时，仅
  `engine-gone` 会给出重启入口。
