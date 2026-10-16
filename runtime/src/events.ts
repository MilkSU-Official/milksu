const EVENT_SCHEMA_VERSION = 1

type BridgeEvent = {
  type?: string
  id?: string
  delta?: string
  content?: string
  text?: string
  stallStage?: string
  stallKind?: string
  budgetMs?: number
  payloadBytes?: number
  // R4 桌面可见性：引擎韧性批次（R1a/R1b，fix/engine-resilience，即将由 PR #228 带入
  // sidecar）五个新事件的原始载荷。message/messageEnglish 是中英双语提示对（投影到
  // EngineEvent 的 notice/noticeEnglish，与 guard.alarm 同一配对形状）；计数字段只在
  // 各自事件里有意义，落点见 projectBridgeEvent 的五个新 case。
  phase?: string
  message?: string
  messageEnglish?: string
  attempt?: number
  maxRetries?: number
  errorMessage?: string
  retryAt?: number
  stage?: string
  stalledSeconds?: number
  hardKillSeconds?: number
  position?: number
  total?: number
  submissionId?: string
  error?: string
  toolName?: string
  toolCallId?: string
  durationMs?: number
  isError?: boolean
  tools?: unknown
  extensions?: unknown
  skills?: unknown
  executionMode?: string
  approvalPolicy?: string
  capabilities?: unknown
  requestId?: string
  input?: string
  reason?: string
  approved?: boolean
  grantable?: boolean
  justification?: unknown
  choice?: string
  tasks?: unknown
  subagentTasks?: unknown
  researchRunId?: string
  researchTasks?: unknown
  jobs?: unknown
  commands?: unknown
  planMode?: unknown
  command?: unknown
  goal?: unknown
  resumed?: boolean
  aborted?: boolean
  compaction?: unknown
  steering?: unknown
  followUp?: unknown
  source?: string
  from?: string
  to?: string
  module?: string
  notice?: string
  noticeEnglish?: string
  usage?: unknown
  contextComposition?: unknown
  forkedSessionId?: string
}

export type EngineEvent = {
  schemaVersion: number
  engine: string
  sessionId?: string
  type: string
  timestamp: string
  text?: string
  toolName?: string
  toolCallId?: string
  durationMs?: number
  error?: string
  done?: boolean
  tools?: unknown
  extensions?: unknown
  skills?: unknown
  executionMode?: string
  approvalPolicy?: string
  capabilities?: unknown
  requestId?: string
  input?: string
  reason?: string
  approved?: boolean
  grantable?: boolean
  justification?: unknown
  notice?: string
  noticeEnglish?: string
  choice?: string
  backgroundTasks?: unknown
  subagentTasks?: unknown
  researchRunId?: string
  researchTasks?: unknown
  jobs?: unknown
  commands?: unknown
  planMode?: unknown
  command?: unknown
  goal?: unknown
  resumed?: boolean
  aborted?: boolean
  stallStage?: string
  stallKind?: string
  budgetMs?: number
  payloadBytes?: number
  // R4 桌面可见性：引擎韧性事件的载荷。phase 区分 model.retry / turn.active 的
  // start/end；notice/noticeEnglish 是事件自带的读者语言提示；其余计数只服务各自事件。
  phase?: string
  attempt?: number
  maxRetries?: number
  errorMessage?: string
  retryAt?: number
  stalledSeconds?: number
  hardKillSeconds?: number
  position?: number
  total?: number
  submissionId?: string
  compaction?: unknown
  steering?: unknown
  followUp?: unknown
  modelSource?: string
  module?: string
  usage?: unknown
  contextComposition?: unknown
  forkedSessionId?: string
}

const RAW_PASSTHROUGH = new Set(['destructive.blocked', 'agent.delivery', 'guard.alarm'])

export function projectBridgeEvent(raw: BridgeEvent, kernel: string): EngineEvent {
  const event: EngineEvent = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    engine: kernel,
    sessionId: raw.id,
    type: '',
    timestamp: new Date().toISOString(),
    text: raw.content,
    toolName: raw.toolName,
    toolCallId: raw.toolCallId,
    durationMs: raw.durationMs,
    tools: raw.tools,
    extensions: raw.extensions,
    skills: raw.skills,
    executionMode: raw.executionMode,
    approvalPolicy: raw.approvalPolicy,
    capabilities: raw.capabilities,
    requestId: raw.requestId,
    input: raw.input,
    reason: raw.reason,
    approved: raw.approved,
    grantable: raw.grantable,
    justification: raw.justification,
    choice: raw.choice,
    backgroundTasks: raw.tasks,
    subagentTasks: raw.subagentTasks,
    researchRunId: raw.researchRunId,
    researchTasks: raw.researchTasks,
    jobs: raw.jobs,
    commands: raw.commands,
    planMode: raw.planMode,
    command: raw.command,
    goal: raw.goal,
    resumed: raw.resumed,
    aborted: raw.aborted,
    compaction: raw.compaction,
    steering: raw.steering,
    followUp: raw.followUp,
    modelSource: raw.source,
    module: raw.module,
    usage: raw.usage,
    contextComposition: raw.contextComposition,
    forkedSessionId: raw.forkedSessionId,
    notice: raw.notice,
    noticeEnglish: raw.noticeEnglish,
  }

  const type = String(raw.type ?? '')
  switch (type) {
    case 'ready':
      event.type = 'session.ready'
      break
    case 'policy_updated':
      event.type = 'session.policy_updated'
      break
    case 'turn_policy':
      event.type = 'session.turn_policy'
      break
    case 'turn_policy_cleared':
      event.type = 'session.turn_policy_cleared'
      break
    case 'model_selected':
      event.type = 'session.model_selected'
      break
    case 'model_source_selected':
      event.type = 'session.model_source'
      break
    case 'model_source_fallback':
      event.type = 'session.model_source'
      event.modelSource = raw.to
      event.reason = raw.reason
      break
    case 'model_source_unavailable':
      event.type = 'session.model_source_unavailable'
      event.reason = raw.reason
      break
    case 'turn_started':
      event.type = 'assistant.started'
      break
    case 'goal_state':
      event.type = 'session.goal_updated'
      break
    case 'queue_update':
      event.type = 'session.queue_updated'
      break
    case 'queued_message_removed':
      event.type = 'runtime.queued_message_removed'
      event.error = raw.error
      event.done = true
      break
    case 'steer_rejected':
      event.type = 'session.steer_rejected'
      event.error = raw.error
      break
    case 'text_delta':
      event.type = 'assistant.delta'
      event.text = raw.delta
      break
    case 'thinking_start':
      event.type = 'assistant.thinking_started'
      break
    case 'thinking_delta':
      event.type = 'assistant.thinking_delta'
      event.text = raw.delta
      break
    case 'thinking_done':
      event.type = 'assistant.thinking_completed'
      event.text = raw.content
      break
    case 'message_done':
      event.type = 'assistant.completed'
      event.done = true
      break
    case 'message_segment_done':
      event.type = 'assistant.segment_completed'
      event.done = true
      break
    case 'turn_settled':
      event.type = 'assistant.settled'
      event.done = true
      break
    case 'tool_call_start':
      event.type = 'tool.started'
      break
    case 'tool_call_progress':
      event.type = 'tool.progress'
      event.text = ''
      break
    case 'tool_call_end':
      event.type = 'tool.completed'
      event.done = true
      if (raw.isError) event.error = raw.content
      break
    case 'usage_recorded':
      event.type = 'usage.recorded'
      break
    case 'context_composition':
      event.type = 'context.composition'
      break
    case 'approval_requested':
      event.type = 'approval.requested'
      break
    case 'turn.heartbeat':
      event.type = 'turn.heartbeat'
      break
    case 'turn_active':
      // R1b 回合生命周期：一个模型回合（generation）的 start/end。渲染层把它当作
      // 比 turn.heartbeat 更准的引擎心跳源（回合边界处的活跃证明），不是进展事件。
      event.type = 'turn.active'
      event.phase = raw.phase
      break
    case 'model_retry':
      // R1a 网络韧性：引擎 durable 重试排程。phase=start 报「重试中 x/N」，phase=end 收横幅。
      event.type = 'model.retry'
      event.phase = raw.phase
      event.attempt = raw.attempt
      event.maxRetries = raw.maxRetries
      event.errorMessage = raw.errorMessage
      event.retryAt = raw.retryAt
      event.notice = raw.message
      event.noticeEnglish = raw.messageEnglish
      break
    case 'model_stall':
      // R1a 看门狗软阈值：连接静默超过软阈值但还没硬掐。与 turn.stall_warning 同族
      //（预算告警），渲染层复用同一个停滞横幅面，展示事件自带的「连接无响应 x 秒」。
      event.type = 'model.stall'
      event.stallStage = raw.stage
      event.stallKind = 'connection'
      event.stalledSeconds = raw.stalledSeconds
      event.hardKillSeconds = raw.hardKillSeconds
      event.notice = raw.message
      event.noticeEnglish = raw.messageEnglish
      break
    case 'harness_recovery':
      // R1b 恢复可见：崩溃后重开进程附着、上一回合仍在飞行 ⇒ 渲染层挂「从断点恢复中」
      // 横幅并把会话标记回进行中（agentRecovery 的失败恢复横幅以 running 为门，自然让位）。
      event.type = 'session.recovery'
      event.notice = raw.message
      event.noticeEnglish = raw.messageEnglish
      break
    case 'message_queued':
      // R1b 排队可见：用户消息落库为 queued（前序回合未完）。排队文本走 text 字段
      //（message_queued 的 text），位次与总数驱动「排队中第 N 位」提示。
      event.type = 'session.message_queued'
      event.position = raw.position
      event.total = raw.total
      event.submissionId = raw.submissionId
      event.text = raw.text
      event.notice = raw.message
      event.noticeEnglish = raw.messageEnglish
      break
    case 'turn.stall_warning':
      event.type = 'turn.stall_warning'
      event.stallStage = raw.stallStage
      event.stallKind = raw.stallKind
      event.budgetMs = raw.budgetMs
      event.payloadBytes = raw.payloadBytes
      break
    case 'approval_resolved':
      event.type = 'approval.resolved'
      event.done = true
      break
    case 'session_destroyed':
      event.type = 'session.destroyed'
      event.done = true
      break
    case 'session_forked':
      event.type = 'session.forked'
      event.forkedSessionId = raw.forkedSessionId
      event.error = raw.error
      event.done = true
      break
    case 'session_rewound':
      event.type = 'session.rewound'
      event.error = raw.error
      event.done = true
      break
    case 'session_handoff':
      event.type = 'session.handoff'
      event.forkedSessionId = raw.forkedSessionId
      event.compaction = raw.compaction
      event.error = raw.error
      event.done = true
      break
    case 'background_tasks':
      event.type = 'runtime.background_tasks'
      break
    case 'subagent_tasks':
      event.type = 'runtime.subagent_tasks'
      break
    case 'research_tasks':
      event.type = 'runtime.research_tasks'
      break
    case 'research_cancel_unconfirmed':
      event.type = 'runtime.research_cancel_unconfirmed'
      break
    case 'research_cancel_confirmed':
      event.type = 'runtime.research_cancel_confirmed'
      break
    case 'dsh_jobs':
      event.type = 'runtime.dsh_jobs'
      break
    case 'dsh_commands':
      event.type = 'runtime.dsh_commands'
      event.done = true
      break
    case 'dsh_command':
      event.type = 'runtime.dsh_command'
      event.error = raw.error
      event.done = true
      break
    case 'dsh_job_killed':
      event.type = 'runtime.dsh_job_killed'
      event.error = raw.error
      event.done = true
      break
    case 'plan_updated':
      event.type = 'session.plan_updated'
      break
    case 'background_task_controlled':
      event.type = 'runtime.background_task_controlled'
      break
    case 'compaction_start':
      event.type = 'runtime.compaction_started'
      break
    case 'compaction_end':
      event.type = 'runtime.compaction_completed'
      event.error = raw.error
      event.done = true
      break
    case 'error':
      event.type = 'engine.error'
      event.error = raw.error
      event.done = true
      break
    default:
      event.type = RAW_PASSTHROUGH.has(type) ? type : `engine.raw.${type || 'unknown'}`
      if (type === 'destructive.blocked' || type === 'agent.delivery' || type === 'guard.alarm') {
        event.notice = (raw as { notice?: string }).notice
        event.noticeEnglish = (raw as { noticeEnglish?: string }).noticeEnglish
      }
      break
  }
  return event
}

export function engineLifecycleEvent(kernel: string, type: string, error = ''): EngineEvent {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    engine: kernel,
    type,
    timestamp: new Date().toISOString(),
    error: error || undefined,
    done: type === 'engine.stopped' || undefined,
  }
}
