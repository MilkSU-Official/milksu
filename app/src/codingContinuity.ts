// Coding continuity is deliberately live-only. A persisted conversation does
// not become "resumed" until the current Pi runtime emits session.ready, and a
// manual compaction failure never writes a success marker.

export interface CodingContinuityState {
  ready: Set<string>
  resumed: Set<string>
  compacting: Set<string>
  compactedAt: Map<string, number>
  errors: Map<string, string>
}

export interface CodingContinuityEvent {
  type: string
  resumed?: boolean
  aborted?: boolean
  error?: string
}

export function createCodingContinuityState(): CodingContinuityState {
  return {
    ready: new Set(),
    resumed: new Set(),
    compacting: new Set(),
    compactedAt: new Map(),
    errors: new Map(),
  }
}

function cloneCodingContinuityState(
  state: CodingContinuityState,
): CodingContinuityState {
  return {
    ready: new Set(state.ready),
    resumed: new Set(state.resumed),
    compacting: new Set(state.compacting),
    compactedAt: new Map(state.compactedAt),
    errors: new Map(state.errors),
  }
}

export function applyCodingContinuityEvent(
  state: CodingContinuityState,
  sessionId: string,
  event: CodingContinuityEvent,
): CodingContinuityState {
  if (!sessionId) return state
  const next = cloneCodingContinuityState(state)
  if (event.type === 'session.ready') {
    next.ready.add(sessionId)
    if (event.resumed) next.resumed.add(sessionId)
    else next.resumed.delete(sessionId)
    return next
  }
  if (event.type === 'runtime.compaction_started') {
    next.compacting.add(sessionId)
    next.errors.delete(sessionId)
    return next
  }
  if (event.type === 'runtime.compaction_completed') {
    next.compacting.delete(sessionId)
    const message = String(
      event.error ?? (event.aborted ? 'Context compaction cancelled' : ''),
    )
      .split(/\r?\n/, 1)[0]
      .replace(/^(?:Error:\s*)+/i, '')
      .trim()
      .slice(0, 320)
    if (message) {
      next.errors.set(sessionId, message)
      return next
    }
    next.compactedAt.set(sessionId, Date.now())
    next.errors.delete(sessionId)
    return next
  }
  return state
}

export function removeCodingContinuitySession(
  state: CodingContinuityState,
  sessionId: string,
): CodingContinuityState {
  const next = cloneCodingContinuityState(state)
  next.ready.delete(sessionId)
  next.resumed.delete(sessionId)
  next.compacting.delete(sessionId)
  next.compactedAt.delete(sessionId)
  next.errors.delete(sessionId)
  return next
}

export function codingCompactionErrorMessage(value: unknown) {
  const raw = String(
    value instanceof Error
      ? value.message
      : (value as { message?: unknown } | null)?.message ?? value ?? '',
  )
  const message = raw
    .split(/\r?\n/, 1)[0]
    .replace(/^(?:Error:\s*)+/i, '')
    .trim()
  if (/session not found/i.test(message)) {
    return '当前任务还没有可整理的 Pi 会话；先发送一条消息创建会话后再整理。'
  }
  if (/Nothing to compact|already compacted/i.test(message)) {
    return '上下文还没有可压缩的内容（会话太小或已整理过）。'
  }
  if (/compaction timed out/i.test(message)) {
    return '上下文压缩超时，已取消。'
  }
  if (/context compaction stopped/i.test(message)) {
    return 'Agent 进程在整理上下文时停止，本次整理已中断。'
  }
  if (/already compacting/i.test(message)) {
    return '当前正在整理上下文，请等待完成。'
  }
  if (/session is busy/i.test(message)) {
    return 'Agent 正在执行回合，请等待当前回合结束再整理。'
  }
  return message || '上下文整理失败'
}
