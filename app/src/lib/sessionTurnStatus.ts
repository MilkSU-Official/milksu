/**
 * Thin session-turn projection for Coding UI: last model usage, context window,
 * compaction flag, and wall-clock run timing. Values come from Pi events and the
 * model catalog — not a second harness.
 */

import { t } from '@/lib/uiLocale'

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

export type ContextCompositionCategoryId =
  | 'system'
  | 'tools'
  | 'skills'
  | 'mcp'
  | 'subagent'
  | 'conversation'

export const CONTEXT_COMPOSITION_CATEGORY_IDS = [
  'system',
  'tools',
  'skills',
  'mcp',
  'subagent',
  'conversation',
] as const satisfies readonly ContextCompositionCategoryId[]

export interface ContextCompositionCategory {
  id: ContextCompositionCategoryId
  tokens: number
}

export interface ContextComposition {
  estimatedTokens: number
  contextWindow?: number
  categories: ContextCompositionCategory[]
}

export interface SessionTurnSnapshot {
  usage?: SessionTurnUsage
  /** Sum of model calls in this conversation, for cache-hit diagnosis. */
  session?: SessionTokenTotals
  /** Model context window in tokens, from the callable catalog when known. */
  contextWindow?: number
  /** Sidecar/Go context.composition projection; category tokens are estimates. */
  composition?: ContextComposition
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

function isCompositionCategoryId(value: string): value is ContextCompositionCategoryId {
  return (CONTEXT_COMPOSITION_CATEGORY_IDS as readonly string[]).includes(value)
}

export function contextCompositionCategoryLabel(id: ContextCompositionCategoryId): string {
  switch (id) {
    case 'system':
      return t('系统提示', 'System prompt')
    case 'tools':
      return t('工具定义', 'Tool definitions')
    case 'skills':
      return t('Skills', 'Skills')
    case 'mcp':
      return t('MCP 与动态工具', 'MCP & dynamic tools')
    case 'subagent':
      return t('子 Agent 定义', 'Subagent definitions')
    case 'conversation':
      return t('对话', 'Conversation')
  }
}

/** Go persists estimatedTokens/categories on lastContextUsage; Vue also keeps a nested composition. */
export function compositionFromStoredUsage(raw: unknown): ContextComposition | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  return normalizeContextComposition(value.composition)
    ?? normalizeContextComposition({
      estimatedTokens: value.estimatedTokens,
      contextWindow: value.contextWindow,
      categories: value.categories,
    })
}

export function normalizeContextComposition(raw: unknown): ContextComposition | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const merged = new Map<ContextCompositionCategoryId, number>()
  const rows = Array.isArray(value.categories) ? value.categories : []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const item = row as Record<string, unknown>
    const id = String(item.id ?? '').trim()
    if (!isCompositionCategoryId(id)) continue
    const tokens = nonNegativeInt(item.tokens)
    if (tokens <= 0) continue
    merged.set(id, (merged.get(id) ?? 0) + tokens)
  }
  const categories = CONTEXT_COMPOSITION_CATEGORY_IDS
    .flatMap(id => {
      const tokens = merged.get(id)
      return tokens ? [{ id, tokens }] : []
    })
  const estimatedTokens = nonNegativeInt(value.estimatedTokens)
    || categories.reduce((sum, item) => sum + item.tokens, 0)
  if (estimatedTokens <= 0 && categories.length === 0) return undefined
  const contextWindow = nonNegativeInt(value.contextWindow)
  return {
    estimatedTokens,
    contextWindow: contextWindow || undefined,
    categories,
  }
}

/** Accept context.composition, a nested contextComposition field, or flattened payload. */
export function readContextCompositionFromEvent(event: {
  type?: string
  contextComposition?: unknown
  usage?: { contextComposition?: unknown } | null
  estimatedTokens?: unknown
  contextWindow?: unknown
  categories?: unknown
} | null | undefined): ContextComposition | undefined {
  if (!event) return undefined
  const nested = normalizeContextComposition(event.contextComposition)
    ?? normalizeContextComposition(event.usage?.contextComposition)
  if (nested) return nested
  if (event.type === 'context.composition') {
    return normalizeContextComposition(event)
  }
  return undefined
}

export function applySessionContextComposition(
  state: SessionTurnSnapshot,
  composition: ContextComposition | Partial<ContextComposition> | null | undefined,
): SessionTurnSnapshot {
  const normalized = normalizeContextComposition(composition)
  if (!normalized) return state
  const next = { ...state, composition: normalized }
  return normalized.contextWindow
    ? applySessionContextWindow(next, normalized.contextWindow)
    : next
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
    composition: undefined,
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
    composition?: ContextComposition | null
    estimatedTokens?: number
    categories?: ContextComposition['categories']
  }) | null | undefined,
  now = Date.now(),
): SessionTurnSnapshot {
  if (!usage) return emptySessionTurnSnapshot()
  const recorded = applySessionUsageRecorded(
    emptySessionTurnSnapshot(),
    usage,
    usage.recordedAt || now,
  )
  return applySessionContextComposition(applySessionContextWindow({
    ...recorded,
    session: storedSessionTotals(usage) ?? recorded.session,
  }, usage.contextWindow), compositionFromStoredUsage(usage))
}

export function storedContextUsageFromSnapshot(snapshot: SessionTurnSnapshot) {
  const usage = snapshot.usage
  const composition = snapshot.composition
  if (!usage && !composition) return undefined
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    contextWindow: snapshot.contextWindow,
    model: usage?.model,
    provider: usage?.provider,
    recordedAt: usage?.recordedAt ?? 0,
    sessionInputTokens: snapshot.session?.inputTokens,
    sessionOutputTokens: snapshot.session?.outputTokens,
    sessionCacheReadTokens: snapshot.session?.cacheReadTokens,
    sessionCacheWriteTokens: snapshot.session?.cacheWriteTokens,
    sessionReasoningTokens: snapshot.session?.reasoningTokens,
    sessionTotalTokens: snapshot.session?.totalTokens,
    sessionTurns: snapshot.session?.turns,
    ...(composition
      ? {
          composition,
          estimatedTokens: composition.estimatedTokens,
          categories: composition.categories,
        }
      : {}),
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

/** Composition estimates: 35.7K / 1M. */
export function formatCompositionTokenCount(value: number | undefined): string {
  const n = nonNegativeInt(value)
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const thousands = n / 1000
    const label = thousands >= 100
      ? String(Math.round(thousands))
      : thousands.toFixed(1).replace(/\.0$/, '')
    return `${label}K`
  }
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

export interface ContextUsageCategoryPresentation {
  id: ContextCompositionCategoryId
  label: string
  tokens: number
  tokenLabel: string
  percent: number
}

export interface ContextUsagePresentation {
  /** Short line for composer strip, e.g. "↑10k ↓1.8k · 12k/128k". */
  strip: string
  /** Percent of context window used by last prompt (input+cache), 0–100 when known. */
  percent?: number
  /** Uncached last-prompt share of the window, 0–percent. Sums with cachePercent. */
  uncachedPercent?: number
  /** Cache-read share of the window, 0–percent. Provider-native, not a file/search split. */
  cachePercent?: number
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
  categories?: ContextUsageCategoryPresentation[]
  /** e.g. "4% 已用" / "4% Full". */
  usedLabel?: string
  /** e.g. "~35.7K / 1M" when categories are estimates. */
  tokenRatioLabel?: string
  estimatedTokens?: number
  windowTokens?: number
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

/** Split last-prompt occupancy into Provider-native uncached vs cache-read shares. */
export function contextOccupancyShares(
  uncachedTokens: number,
  cacheReadTokens: number,
  windowTokens: number,
): { percent: number, uncachedPercent: number, cachePercent: number } | undefined {
  const window = nonNegativeInt(windowTokens)
  if (!window) return undefined
  const uncached = nonNegativeInt(uncachedTokens)
  const cacheRead = nonNegativeInt(cacheReadTokens)
  const occupied = uncached + cacheRead
  const percent = Math.min(100, Math.round((occupied / window) * 100))
  if (percent <= 0) return { percent: 0, uncachedPercent: 0, cachePercent: 0 }
  const cachePercent = occupied > 0
    ? Math.min(percent, Math.round(percent * (cacheRead / occupied)))
    : 0
  return {
    percent,
    uncachedPercent: percent - cachePercent,
    cachePercent,
  }
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

function presentCompositionCategories(
  composition: ContextComposition,
  windowTokens: number | undefined,
): ContextUsageCategoryPresentation[] {
  const denominator = (windowTokens && windowTokens > 0)
    ? windowTokens
    : composition.estimatedTokens
  return composition.categories
    .filter(item => item.tokens > 0)
    .map(item => ({
      id: item.id,
      label: contextCompositionCategoryLabel(item.id),
      tokens: item.tokens,
      tokenLabel: formatCompositionTokenCount(item.tokens),
      percent: denominator > 0
        ? Math.round((item.tokens / denominator) * 100)
        : 0,
    }))
}

export function presentContextUsage(
  snapshot: SessionTurnSnapshot,
): ContextUsagePresentation | null {
  const usage = snapshot.usage
  const composition = snapshot.composition
  const compacting = Boolean(snapshot.compacting)
  if (!usage && !composition) {
    if (!compacting) return null
    const compactingLabel = t('整理中', 'Compacting')
    return {
      strip: compactingLabel,
      nearLimit: false,
      inputLabel: '—',
      outputLabel: '—',
      windowLabel: '',
      totalLabel: '—',
      ioLabel: compactingLabel,
      compacting: true,
      usedLabel: compactingLabel,
    }
  }
  const input = usage ? usage.inputTokens + usage.cacheReadTokens : 0
  const output = usage?.outputTokens ?? 0
  const window = snapshot.contextWindow || composition?.contextWindow
  const occupied = composition?.estimatedTokens ?? input
  const inputLabel = usage ? formatTokenCount(input) : formatCompositionTokenCount(occupied)
  const outputLabel = usage ? formatTokenCount(output) : '—'
  const totalLabel = usage
    ? formatTokenCount(usage.totalTokens || input + output)
    : formatCompositionTokenCount(occupied)
  const windowLabel = window
    ? (composition ? formatCompositionTokenCount(window) : formatTokenCount(window))
    : ''
  const ioLabel = usage
    ? `↑${inputLabel} ↓${outputLabel}`
    : t('整理中', 'Compacting')
  const occupancy = !composition && usage && window && window > 0
    ? contextOccupancyShares(usage.inputTokens, usage.cacheReadTokens, window)
    : undefined
  const compositionPercent = composition && window && window > 0
    ? Math.min(100, Math.round((occupied / window) * 100))
    : undefined
  const percent = compositionPercent ?? occupancy?.percent
  const nearLimit = (percent ?? 0) >= 85
  const ratio = windowLabel ? `${inputLabel}/${windowLabel}` : ''
  const compactingMark = compacting ? t(' · 整理中', ' · Compacting') : ''
  const compactingLabel = t('整理中', 'Compacting')
  const strip = usage
    ? (ratio ? `${ioLabel} · ${ratio}${compactingMark}` : `${ioLabel}${compactingMark}`)
    : (compacting && !composition
      ? compactingLabel
      : [percent !== undefined ? `${percent}%` : '', ratio].filter(Boolean).join(' · ')
        + compactingMark)
  const last = usage ? presentUsageBreakdown(usage) : undefined
  const session = snapshot.session && snapshot.session.turns > 1
    ? presentUsageBreakdown(snapshot.session, snapshot.session.turns)
    : undefined
  const categories = composition
    ? presentCompositionCategories(composition, window)
    : undefined
  const usedLabel = compacting && percent === undefined
    ? compactingLabel
    : percent !== undefined
      ? t(`${percent}% 已用`, `${percent}% Full`)
      : ''
  const tokenRatioLabel = composition && (occupied > 0 || window)
    ? [
        occupied > 0 ? `~${formatCompositionTokenCount(occupied)}` : '',
        window ? formatCompositionTokenCount(window) : '',
      ].filter(Boolean).join(' / ')
    : windowLabel
      ? `${inputLabel} / ${windowLabel}`
      : ''
  return {
    strip,
    percent,
    uncachedPercent: occupancy?.uncachedPercent,
    cachePercent: occupancy?.cachePercent,
    nearLimit,
    inputLabel,
    outputLabel,
    windowLabel,
    totalLabel,
    ioLabel: usage ? ioLabel : (usedLabel || tokenRatioLabel || compactingLabel),
    compacting,
    last,
    session,
    categories: categories?.length ? categories : undefined,
    usedLabel,
    tokenRatioLabel,
    estimatedTokens: composition?.estimatedTokens,
    windowTokens: window,
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
