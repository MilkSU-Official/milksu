/**
 * Thin session-turn projection for Coding UI: last model usage, context window,
 * compaction flag, and wall-clock run timing. Values come from Pi events and the
 * model catalog — not a second harness.
 */

export interface SessionTurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  model?: string
  provider?: string
  /** Stable usage.recorded id; duplicate events must not double-count session totals. */
  recordId?: string
  /** Unix ms when this usage row was recorded. */
  recordedAt: number
}

export interface SessionTokenTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  turns: number
}

export interface SessionTurnSnapshot {
  usage?: SessionTurnUsage
  /** Sum of model calls in this conversation, for cache-hit diagnosis. */
  session?: SessionTokenTotals
  /** Model context window in tokens, from the callable catalog when known. */
  contextWindow?: number
  compacting: boolean
  /** Unix ms when the current agent turn started; cleared when the turn ends. */
  runStartedAt?: number
  /** Last finished turn wall-clock duration in ms (kept after settle). */
  lastElapsedMs?: number
}

export function emptySessionTurnSnapshot(): SessionTurnSnapshot {
  return { compacting: false }
}

function addSessionTotals(
  current: SessionTokenTotals | undefined,
  usage: SessionTurnUsage,
): SessionTokenTotals {
  return {
    inputTokens: (current?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + usage.outputTokens,
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
    cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + usage.cacheWriteTokens,
    reasoningTokens: (current?.reasoningTokens ?? 0) + usage.reasoningTokens,
    totalTokens: (current?.totalTokens ?? 0) + usage.totalTokens,
    turns: (current?.turns ?? 0) + 1,
  }
}

function storedSessionTotals(usage: {
  sessionInputTokens?: number
  sessionOutputTokens?: number
  sessionCacheReadTokens?: number
  sessionCacheWriteTokens?: number
  sessionReasoningTokens?: number
  sessionTotalTokens?: number
  sessionTurns?: number
}): SessionTokenTotals | undefined {
  const turns = nonNegativeInt(usage.sessionTurns)
  if (!turns) return undefined
  return {
    inputTokens: nonNegativeInt(usage.sessionInputTokens),
    outputTokens: nonNegativeInt(usage.sessionOutputTokens),
    cacheReadTokens: nonNegativeInt(usage.sessionCacheReadTokens),
    cacheWriteTokens: nonNegativeInt(usage.sessionCacheWriteTokens),
    reasoningTokens: nonNegativeInt(usage.sessionReasoningTokens),
    totalTokens: nonNegativeInt(usage.sessionTotalTokens),
    turns,
  }
}

export function applySessionUsageRecorded(
  state: SessionTurnSnapshot,
  usage: Partial<SessionTurnUsage> | null | undefined,
  now = Date.now(),
): SessionTurnSnapshot {
  if (!usage) return state
  const recordId = String(usage.recordId ?? '').trim() || undefined
  if (recordId && state.usage?.recordId === recordId) return state
  const inputTokens = nonNegativeInt(usage.inputTokens)
  const outputTokens = nonNegativeInt(usage.outputTokens)
  const cacheReadTokens = nonNegativeInt(usage.cacheReadTokens)
  const cacheWriteTokens = nonNegativeInt(usage.cacheWriteTokens)
  const reasoningTokens = nonNegativeInt(usage.reasoningTokens)
  const totalTokens = nonNegativeInt(usage.totalTokens)
    || (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens)
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return state
  const nextUsage: SessionTurnUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    model: usage.model ? String(usage.model) : state.usage?.model,
    provider: usage.provider ? String(usage.provider) : state.usage?.provider,
    recordId,
    recordedAt: now,
  }
  return {
    ...state,
    usage: nextUsage,
    session: addSessionTotals(state.session, nextUsage),
  }
}

/** After Pi compact, the ring should show the estimated remaining context, not the last prompt. */
export function applySessionUsageAfterCompaction(
  state: SessionTurnSnapshot,
  estimatedTokensAfter: number | undefined,
  now = Date.now(),
): SessionTurnSnapshot {
  const inputTokens = nonNegativeInt(estimatedTokensAfter)
  if (!inputTokens) return state
  return {
    ...state,
    usage: {
      inputTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: inputTokens,
      model: state.usage?.model,
      provider: state.usage?.provider,
      recordedAt: now,
    },
  }
}

export function applySessionContextWindow(
  state: SessionTurnSnapshot,
  contextWindow: number | undefined,
): SessionTurnSnapshot {
  const window = nonNegativeInt(contextWindow)
  if (!window) return { ...state, contextWindow: undefined }
  return { ...state, contextWindow: window }
}

/** Restore the composer occupancy ring from a persisted conversation row. */
export function snapshotFromStoredContextUsage(
  usage: (Partial<SessionTurnUsage> & {
    contextWindow?: number
    sessionInputTokens?: number
    sessionOutputTokens?: number
    sessionCacheReadTokens?: number
    sessionCacheWriteTokens?: number
    sessionReasoningTokens?: number
    sessionTotalTokens?: number
    sessionTurns?: number
  }) | null | undefined,
  now = Date.now(),
): SessionTurnSnapshot {
  if (!usage) return emptySessionTurnSnapshot()
  const recorded = applySessionUsageRecorded(
    emptySessionTurnSnapshot(),
    usage,
    usage.recordedAt || now,
  )
  return applySessionContextWindow({
    ...recorded,
    session: storedSessionTotals(usage) ?? recorded.session,
  }, usage.contextWindow)
}

export function storedContextUsageFromSnapshot(snapshot: SessionTurnSnapshot) {
  const usage = snapshot.usage
  if (!usage) return undefined
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    contextWindow: snapshot.contextWindow,
    model: usage.model,
    provider: usage.provider,
    recordedAt: usage.recordedAt,
    sessionInputTokens: snapshot.session?.inputTokens,
    sessionOutputTokens: snapshot.session?.outputTokens,
    sessionCacheReadTokens: snapshot.session?.cacheReadTokens,
    sessionCacheWriteTokens: snapshot.session?.cacheWriteTokens,
    sessionReasoningTokens: snapshot.session?.reasoningTokens,
    sessionTotalTokens: snapshot.session?.totalTokens,
    sessionTurns: snapshot.session?.turns,
  }
}

export function applySessionCompacting(
  state: SessionTurnSnapshot,
  compacting: boolean,
): SessionTurnSnapshot {
  return { ...state, compacting: Boolean(compacting) }
}

export function applySessionRunStarted(
  state: SessionTurnSnapshot,
  startedAt = Date.now(),
): SessionTurnSnapshot {
  return { ...state, runStartedAt: startedAt }
}

export function applySessionRunFinished(
  state: SessionTurnSnapshot,
  endedAt = Date.now(),
): SessionTurnSnapshot {
  if (state.runStartedAt === undefined) return state
  const lastElapsedMs = Math.max(0, endedAt - state.runStartedAt)
  return { ...state, runStartedAt: undefined, lastElapsedMs }
}

function nonNegativeInt(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.floor(number)
}

/** Compact token count for chrome: 1.2k / 3.4M style. */
export function formatTokenCount(value: number | undefined): string {
  const n = nonNegativeInt(value)
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(n / 1_000_000)}M`
}

/** Elapsed wall time from runStartedAt to now (or finished). */
export function formatElapsedMs(elapsedMs: number | undefined): string {
  const ms = Math.max(0, Math.floor(Number(elapsedMs) || 0))
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export interface ContextUsageBreakdown {
  uncachedLabel: string
  cacheReadLabel: string
  cacheWriteLabel: string
  outputLabel: string
  reasoningLabel: string
  /** Cache-read / (uncached input + cache-read). */
  hitRateLabel?: string
  turns?: number
}

export interface ContextUsagePresentation {
  /** Short line for composer strip, e.g. "↑10k ↓1.8k · 12k/128k". */
  strip: string
  /** Percent of context window used by last prompt (input+cache), 0–100 when known. */
  percent?: number
  /** True when last usage is near the window. */
  nearLimit: boolean
  inputLabel: string
  outputLabel: string
  windowLabel: string
  totalLabel: string
  /** Compact I/O line using up/down arrows. */
  ioLabel: string
  /** True while Pi is compacting the current session. */
  compacting: boolean
  last?: ContextUsageBreakdown
  session?: ContextUsageBreakdown
}

/** Cache hit rate: cache-read tokens / last prompt (uncached + cache-read). */
export function formatHitRate(cacheReadTokens: number, promptTokens: number): string | undefined {
  const read = nonNegativeInt(cacheReadTokens)
  const prompt = nonNegativeInt(promptTokens)
  if (prompt <= 0) return undefined
  const percent = (read / prompt) * 100
  if (percent <= 0) return '0%'
  if (percent >= 99.5 && read < prompt) return '99%'
  if (percent >= 10) return `${Math.round(percent)}%`
  return `${percent.toFixed(1).replace(/\.0$/, '')}%`
}

function presentUsageBreakdown(
  usage: Pick<SessionTurnUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'>,
  turns?: number,
): ContextUsageBreakdown {
  const prompt = usage.inputTokens + usage.cacheReadTokens
  return {
    uncachedLabel: formatTokenCount(usage.inputTokens),
    cacheReadLabel: formatTokenCount(usage.cacheReadTokens),
    cacheWriteLabel: formatTokenCount(usage.cacheWriteTokens),
    outputLabel: formatTokenCount(usage.outputTokens),
    reasoningLabel: formatTokenCount(usage.reasoningTokens),
    hitRateLabel: formatHitRate(usage.cacheReadTokens, prompt),
    turns,
  }
}

export function presentContextUsage(
  snapshot: SessionTurnSnapshot,
): ContextUsagePresentation | null {
  const usage = snapshot.usage
  const compacting = Boolean(snapshot.compacting)
  if (!usage) {
    if (!compacting) return null
    return {
      strip: '整理中',
      nearLimit: false,
      inputLabel: '—',
      outputLabel: '—',
      windowLabel: '',
      totalLabel: '—',
      ioLabel: '整理中',
      compacting: true,
    }
  }
  const input = usage.inputTokens + usage.cacheReadTokens
  const output = usage.outputTokens
  const window = snapshot.contextWindow
  const inputLabel = formatTokenCount(input)
  const outputLabel = formatTokenCount(output)
  const totalLabel = formatTokenCount(usage.totalTokens || input + output)
  const windowLabel = window ? formatTokenCount(window) : ''
  const ioLabel = `↑${inputLabel} ↓${outputLabel}`
  let percent: number | undefined
  let nearLimit = false
  if (window && window > 0) {
    percent = Math.min(100, Math.round((input / window) * 100))
    nearLimit = percent >= 85
  }
  const ratio = windowLabel ? `${inputLabel}/${windowLabel}` : ''
  const compactingMark = compacting ? ' · 整理中' : ''
  const strip = ratio
    ? `${ioLabel} · ${ratio}${compactingMark}`
    : `${ioLabel}${compactingMark}`
  const last = presentUsageBreakdown(usage)
  const session = snapshot.session && snapshot.session.turns > 1
    ? presentUsageBreakdown(snapshot.session, snapshot.session.turns)
    : undefined
  return {
    strip,
    percent,
    nearLimit,
    inputLabel,
    outputLabel,
    windowLabel,
    totalLabel,
    ioLabel,
    compacting,
    last,
    session,
  }
}

export interface RunTimingPresentation {
  label: string
  running: boolean
}

export function presentRunTiming(
  snapshot: SessionTurnSnapshot,
  now = Date.now(),
): RunTimingPresentation | null {
  if (snapshot.runStartedAt !== undefined) {
    return {
      label: formatElapsedMs(Math.max(0, now - snapshot.runStartedAt)),
      running: true,
    }
  }
  if (snapshot.lastElapsedMs !== undefined) {
    return {
      label: formatElapsedMs(snapshot.lastElapsedMs),
      running: false,
    }
  }
  return null
}
