// Coding continuity is deliberately live-only. A persisted conversation does
// not become "resumed" until the current Pi runtime emits session.ready, and a
// manual compaction failure never writes a success marker.

import { t } from '@/lib/uiLocale'

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

export const COMPACTION_ERROR_VISIBLE_MS = 4000

export function clearCodingContinuityError(
  state: CodingContinuityState,
  sessionId: string,
): CodingContinuityState {
  if (!sessionId || !state.errors.has(sessionId)) return state
  const next = cloneCodingContinuityState(state)
  next.errors.delete(sessionId)
  return next
}

export function armCompactionErrorDismiss(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  sessionId: string,
  dismiss: (id: string) => void,
  options?: {
    delayMs?: number
    setTimer?: typeof setTimeout
    clearTimer?: typeof clearTimeout
  },
) {
  const id = String(sessionId ?? '').trim()
  if (!id) return
  const setTimer = options?.setTimer ?? setTimeout
  const clearTimer = options?.clearTimer ?? clearTimeout
  const previous = timers.get(id)
  if (previous !== undefined) clearTimer(previous)
  const timer = setTimer(() => {
    timers.delete(id)
    dismiss(id)
  }, options?.delayMs ?? COMPACTION_ERROR_VISIBLE_MS)
  timers.set(id, timer)
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
    return t('发送消息后再整理。', 'Send a message before compacting.')
  }
  if (/Nothing to compact|already compacted|session too small/i.test(message)) {
    return t('会话还太短或刚整理过。', 'Session is still too short or was just compacted.')
  }
  if (/compaction timed out/i.test(message)) {
    return t('上下文压缩超时，已取消。', 'Context compaction timed out and was cancelled.')
  }
  if (/context overflow recovery failed|auto-compaction failed/i.test(message)) {
    return t('自动整理上下文失败，请手动整理后再继续。', 'Automatic context compaction failed. Compact manually, then continue.')
  }
  if (/context compaction stopped/i.test(message)) {
    return t('Agent 进程在整理上下文时停止，本次整理已中断。', 'The Agent process stopped during compaction. This compaction was interrupted.')
  }
  if (/already compacting/i.test(message)) {
    return t('当前正在整理上下文，请等待完成。', 'Context is already being compacted. Wait until it finishes.')
  }
  if (/session is busy/i.test(message)) {
    return t('Agent 正在执行回合，请等待当前回合结束再整理。', 'The Agent is still running this turn. Wait until it finishes before compacting.')
  }
  return message || t('上下文整理失败', 'Context compaction failed')
}
