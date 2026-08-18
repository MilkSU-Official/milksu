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
  totalTokens: number
  model?: string
  provider?: string
  /** Unix ms when this usage row was recorded. */
  recordedAt: number
}

export interface SessionTurnSnapshot {
  usage?: SessionTurnUsage
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

export function applySessionUsageRecorded(
  state: SessionTurnSnapshot,
  usage: Partial<SessionTurnUsage> | null | undefined,
  now = Date.now(),
): SessionTurnSnapshot {
  if (!usage) return state
  const inputTokens = nonNegativeInt(usage.inputTokens)
  const outputTokens = nonNegativeInt(usage.outputTokens)
  const cacheReadTokens = nonNegativeInt(usage.cacheReadTokens)
  const cacheWriteTokens = nonNegativeInt(usage.cacheWriteTokens)
  const totalTokens = nonNegativeInt(usage.totalTokens)
    || (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens)
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return state
  return {
    ...state,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      model: usage.model ? String(usage.model) : state.usage?.model,
      provider: usage.provider ? String(usage.provider) : state.usage?.provider,
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

export interface ContextUsagePresentation {
  /** Short line for composer strip, e.g. "12k / 128k · 入 10k 出 2k". */
  strip: string
  /** Percent of context window used by last prompt (input+cache), 0–100 when known. */
  percent?: number
  /** True when last usage is near the window. */
  nearLimit: boolean
  inputLabel: string
  outputLabel: string
  windowLabel: string
  totalLabel: string
}

export function presentContextUsage(
  snapshot: SessionTurnSnapshot,
): ContextUsagePresentation | null {
  const usage = snapshot.usage
  if (!usage) return null
  const input = usage.inputTokens + usage.cacheReadTokens
  const output = usage.outputTokens
  const window = snapshot.contextWindow
  const inputLabel = formatTokenCount(input)
  const outputLabel = formatTokenCount(output)
  const totalLabel = formatTokenCount(usage.totalTokens || input + output)
  const windowLabel = window ? formatTokenCount(window) : ''
  let percent: number | undefined
  let nearLimit = false
  if (window && window > 0) {
    percent = Math.min(100, Math.round((input / window) * 100))
    nearLimit = percent >= 85
  }
  const ratio = windowLabel ? `${inputLabel} / ${windowLabel}` : totalLabel
  const io = `入 ${inputLabel} 出 ${outputLabel}`
  const compacting = snapshot.compacting ? ' · 整理中' : ''
  return {
    strip: `${ratio} · ${io}${compacting}`,
    percent,
    nearLimit,
    inputLabel,
    outputLabel,
    windowLabel,
    totalLabel,
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
