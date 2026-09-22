import type { CompanionTranscriptEntry } from '@/types'
import { formatDemoElapsed, thinkingSummary } from '@/lib/agentConversation'
import { companionChatPlainText } from '@/lib/companionUserError'
import { t } from '@/lib/uiLocale'

/** Ignore gaps that are not one model step. The phone transcript has no separate thinking clock. */
const MAX_THINKING_GAP_MS = 30 * 60 * 1000

export interface CompanionProcessTool {
  id: string
  name: string
  detail: string
  running: boolean
  error?: string
}

export interface CompanionTurnProcess {
  thinking: string
  thinkingRunning: boolean
  thinkingStartedAt?: number
  thinkingDurationMs?: number
  tools: CompanionProcessTool[]
  reply: string
}

export function emptyCompanionTurnProcess(): CompanionTurnProcess {
  return {
    thinking: '',
    thinkingRunning: false,
    tools: [],
    reply: '',
  }
}

export function companionTurnHasProcess(process: CompanionTurnProcess | null | undefined) {
  if (!process) return false
  return Boolean(
    process.thinking.trim()
    || process.thinkingRunning
    || process.tools.length,
  )
}

export function companionEntryHasProcess(entry: CompanionTranscriptEntry) {
  return Boolean(String(entry.thinking ?? '').trim() || (entry.tools?.length ?? 0) > 0)
}

export function companionEntryIsProcessOnly(entry: CompanionTranscriptEntry) {
  if (entry.role !== 'assistant') return false
  const error = String(entry.error ?? '').trim()
  if (error && !/companion model returned no text|这一轮没有回复|did not produce a reply/i.test(error)) {
    return false
  }
  if (companionChatPlainText(entry)) return false
  return companionEntryHasProcess(entry)
}

export function transcriptInstantMs(timestamp: string | undefined) {
  const raw = String(timestamp ?? '').trim()
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function finiteThinkingDurationMs(value: unknown) {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration <= 0) return undefined
  return Math.floor(duration)
}

/**
 * Time from the previous visible transcript line to this assistant line.
 * Tool results are already omitted from the phone transcript, so this is the
 * step timing that line already carries, not a new clock.
 */
export function thinkingGapMs(
  previousAt: number | undefined,
  at: number | undefined,
  entry: CompanionTranscriptEntry,
) {
  if (!String(entry.thinking ?? '').trim()) return undefined
  if (previousAt === undefined || at === undefined) return undefined
  const delta = at - previousAt
  if (!Number.isFinite(delta) || delta <= 0 || delta > MAX_THINKING_GAP_MS) return undefined
  return Math.floor(delta)
}

export function withThinkingDuration(
  entry: CompanionTranscriptEntry,
  previousAt: number | undefined,
): CompanionTranscriptEntry {
  const explicit = finiteThinkingDurationMs(entry.thinkingDurationMs)
  if (explicit !== undefined) return { ...entry, thinkingDurationMs: explicit }
  const gap = thinkingGapMs(previousAt, transcriptInstantMs(entry.timestamp), entry)
  if (gap === undefined) return entry
  return { ...entry, thinkingDurationMs: gap }
}

export function stampMeasuredThinkingDuration(
  entries: CompanionTranscriptEntry[],
  measured: CompanionTurnProcess | null | undefined,
): CompanionTranscriptEntry[] {
  const duration = finiteThinkingDurationMs(measured?.thinkingDurationMs)
  const thinking = String(measured?.thinking ?? '').trim()
  if (duration === undefined || !thinking) return entries
  let index = -1
  for (let cursor = entries.length - 1; cursor >= 0; cursor -= 1) {
    const entry = entries[cursor]
    if (entry?.role === 'assistant' && String(entry.thinking ?? '').trim() === thinking) {
      index = cursor
      break
    }
  }
  if (index < 0) return entries
  if (entries[index]?.thinkingDurationMs === duration) return entries
  return entries.map((entry, entryIndex) => (
    entryIndex === index ? { ...entry, thinkingDurationMs: duration } : entry
  ))
}

export function processFromCompanionEntry(entry: CompanionTranscriptEntry): CompanionTurnProcess {
  return {
    thinking: String(entry.thinking ?? '').trim(),
    thinkingRunning: false,
    thinkingDurationMs: finiteThinkingDurationMs(entry.thinkingDurationMs),
    tools: (entry.tools ?? []).map((name, index) => ({
      id: `${entry.id}:tool:${index}:${name}`,
      name,
      detail: name,
      running: false,
    })),
    reply: '',
  }
}

export function mergeCompanionProcess(
  left: CompanionTurnProcess,
  right: CompanionTurnProcess,
): CompanionTurnProcess {
  const thinking = [left.thinking.trim(), right.thinking.trim()].filter(Boolean).join('\n\n')
  const tools = [...left.tools]
  for (const tool of right.tools) {
    if (tools.some(item => item.id === tool.id || (item.name === tool.name && item.detail === tool.detail))) {
      continue
    }
    tools.push(tool)
  }
  return {
    thinking,
    thinkingRunning: left.thinkingRunning || right.thinkingRunning,
    thinkingDurationMs: (left.thinkingDurationMs ?? 0) + (right.thinkingDurationMs ?? 0) || undefined,
    tools,
    reply: right.reply || left.reply,
  }
}

export type CompanionDisplayRow =
  | { kind: 'entry'; entry: CompanionTranscriptEntry }
  | { kind: 'process'; id: string; process: CompanionTurnProcess; foldable: boolean }

export function buildCompanionDisplayRows(
  entries: CompanionTranscriptEntry[],
): CompanionDisplayRow[] {
  const rows: CompanionDisplayRow[] = []
  let pending = emptyCompanionTurnProcess()
  let pendingId = ''

  const flushPending = (foldable: boolean) => {
    if (!companionTurnHasProcess(pending)) return
    rows.push({
      kind: 'process',
      id: pendingId || `process:${rows.length}`,
      process: pending,
      foldable,
    })
    pending = emptyCompanionTurnProcess()
    pendingId = ''
  }

  let previousAt: number | undefined
  for (const raw of entries) {
    const entry = withThinkingDuration(raw, previousAt)
    const at = transcriptInstantMs(entry.timestamp)
    if (at !== undefined) previousAt = at
    if (companionEntryIsProcessOnly(entry)) {
      if (!pendingId) pendingId = `process:${entry.id}`
      pending = mergeCompanionProcess(pending, processFromCompanionEntry(entry))
      continue
    }
    if (entry.role === 'assistant' && companionEntryHasProcess(entry)) {
      if (!pendingId) pendingId = `process:${entry.id}`
      pending = mergeCompanionProcess(pending, processFromCompanionEntry(entry))
      flushPending(true)
      rows.push({ kind: 'entry', entry })
      continue
    }
    if (entry.role === 'user') {
      flushPending(true)
    }
    rows.push({ kind: 'entry', entry })
  }
  flushPending(true)
  return rows
}

export function companionThinkingLabel(process: CompanionTurnProcess, liveElapsedMs?: number) {
  if (process.thinkingRunning) {
    const elapsed = liveElapsedMs !== undefined && liveElapsedMs >= 500
      ? formatDemoElapsed(liveElapsedMs)
      : ''
    return elapsed
      ? t(`正在思考 ${elapsed}`, `Thinking ${elapsed}`)
      : t('正在思考', 'Thinking')
  }
  const duration = finiteThinkingDurationMs(process.thinkingDurationMs)
  if (duration === undefined) return t('想了', 'Thought')
  return thinkingSummary(duration)
}

export function companionProcessSummary(process: CompanionTurnProcess, liveElapsedMs?: number) {
  const parts: string[] = []
  if (process.thinking.trim() || process.thinkingRunning) {
    parts.push(companionThinkingLabel(process, liveElapsedMs))
  }
  if (process.tools.length) {
    parts.push(t(`${process.tools.length} 个工具`, `${process.tools.length} tools`))
  }
  return parts.join(' · ')
}
