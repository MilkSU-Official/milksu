import type { CompanionTranscriptComponent, CompanionTranscriptEntry } from '@/types'
import { formatDemoElapsed, thinkingSummary } from '@/lib/agentConversation'
import { companionChatPlainText } from '@/lib/companionUserError'
import { t } from '@/lib/uiLocale'

/** Ignore gaps that are not one model step. The phone transcript has no separate thinking clock. */
const MAX_THINKING_GAP_MS = 30 * 60 * 1000

/** One harness piece inside a turn fold. Kind is open so a new component still renders. */
export interface CompanionProcessComponent {
  id: string
  kind: string
  title: string
  detail: string
  running: boolean
  error?: string
  startedAt?: number
  durationMs?: number
}

export interface CompanionTurnProcess {
  components: CompanionProcessComponent[]
  reply: string
}

export function emptyCompanionTurnProcess(): CompanionTurnProcess {
  return {
    components: [],
    reply: '',
  }
}

export function upsertProcessComponent(
  components: CompanionProcessComponent[],
  next: CompanionProcessComponent,
): CompanionProcessComponent[] {
  const index = components.findIndex(item => item.id === next.id)
  if (index < 0) return [...components, next]
  const copy = components.slice()
  copy[index] = { ...copy[index], ...next }
  return copy
}

export function patchProcessComponent(
  process: CompanionTurnProcess,
  next: CompanionProcessComponent,
): CompanionTurnProcess {
  return {
    ...process,
    components: upsertProcessComponent(process.components, next),
  }
}

export function processComponent(
  process: CompanionTurnProcess | null | undefined,
  kind: string,
): CompanionProcessComponent | undefined {
  return process?.components.find(item => item.kind === kind)
}

export function processComponents(
  process: CompanionTurnProcess | null | undefined,
  kind: string,
): CompanionProcessComponent[] {
  return process?.components.filter(item => item.kind === kind) ?? []
}

function componentHasBody(component: CompanionProcessComponent) {
  return Boolean(
    component.running
    || component.title.trim()
    || component.detail.trim()
    || component.error?.trim(),
  )
}

export function companionTurnHasProcess(process: CompanionTurnProcess | null | undefined) {
  if (!process) return false
  return process.components.some(componentHasBody)
}

export function companionEntryHasProcess(entry: CompanionTranscriptEntry) {
  return Boolean(
    String(entry.thinking ?? '').trim()
    || (entry.tools?.length ?? 0) > 0
    || (entry.components?.length ?? 0) > 0,
  )
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
  const thinking = processComponent(measured, 'thinking')
  const duration = finiteThinkingDurationMs(thinking?.durationMs)
  const text = String(thinking?.detail ?? '').trim()
  if (duration === undefined || !text) return entries
  let index = -1
  for (let cursor = entries.length - 1; cursor >= 0; cursor -= 1) {
    const entry = entries[cursor]
    if (entry?.role === 'assistant' && String(entry.thinking ?? '').trim() === text) {
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

function componentFromTranscript(
  entryId: string,
  component: CompanionTranscriptComponent,
  index: number,
): CompanionProcessComponent | null {
  const kind = String(component.kind ?? '').trim()
  const detail = String(component.detail ?? '').trim()
  const title = String(component.title ?? '').trim()
  if (!kind || (!detail && !title)) return null
  return {
    id: String(component.id ?? '').trim() || `${entryId}:${kind}:${index}`,
    kind,
    title,
    detail,
    running: false,
  }
}

export function processFromCompanionEntry(entry: CompanionTranscriptEntry): CompanionTurnProcess {
  const components: CompanionProcessComponent[] = []
  const memory: CompanionProcessComponent[] = []
  ;(entry.components ?? []).forEach((component, index) => {
    const next = componentFromTranscript(entry.id, component, index)
    if (!next) return
    if (next.kind === 'memory') memory.push(next)
    else components.push(next)
  })
  const thinking = String(entry.thinking ?? '').trim()
  if (thinking) {
    components.push({
      id: `${entry.id}:thinking`,
      kind: 'thinking',
      title: '',
      detail: thinking,
      running: false,
      durationMs: finiteThinkingDurationMs(entry.thinkingDurationMs),
    })
  }
  ;(entry.tools ?? []).forEach((name, index) => {
    components.push({
      id: `${entry.id}:tool:${index}:${name}`,
      kind: 'tool',
      title: name,
      detail: name,
      running: false,
    })
  })
  components.push(...memory)
  return { components, reply: '' }
}

export function mergeCompanionProcess(
  left: CompanionTurnProcess,
  right: CompanionTurnProcess,
): CompanionTurnProcess {
  const components = [...left.components]
  for (const next of right.components) {
    if (next.kind === 'thinking') {
      const index = components.findIndex(item => item.kind === 'thinking')
      if (index >= 0) {
        const current = components[index]!
        const duration = (current.durationMs ?? 0) + (next.durationMs ?? 0)
        components[index] = {
          ...current,
          detail: [current.detail.trim(), next.detail.trim()].filter(Boolean).join('\n\n'),
          running: current.running || next.running,
          durationMs: duration > 0 ? duration : undefined,
          startedAt: current.startedAt ?? next.startedAt,
        }
        continue
      }
    }
    if (components.some(item => item.id === next.id)) continue
    components.push(next)
  }
  return {
    components,
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
  let turnEntries: CompanionDisplayRow[] = []

  const flushTurn = () => {
    if (companionTurnHasProcess(pending)) {
      rows.push({
        kind: 'process',
        id: pendingId || `process:${rows.length}`,
        process: pending,
        foldable: true,
      })
    }
    rows.push(...turnEntries)
    pending = emptyCompanionTurnProcess()
    pendingId = ''
    turnEntries = []
  }

  let previousAt: number | undefined
  for (const raw of entries) {
    const entry = withThinkingDuration(raw, previousAt)
    const at = transcriptInstantMs(entry.timestamp)
    if (at !== undefined) previousAt = at
    if (entry.role === 'user') {
      flushTurn()
      rows.push({ kind: 'entry', entry })
      continue
    }
    if (companionEntryIsProcessOnly(entry) || (entry.role === 'assistant' && companionEntryHasProcess(entry))) {
      if (!pendingId) pendingId = `process:${entry.id}`
      pending = mergeCompanionProcess(pending, processFromCompanionEntry(entry))
    }
    if (companionEntryIsProcessOnly(entry)) continue
    turnEntries.push({ kind: 'entry', entry })
  }
  flushTurn()
  return rows
}

export function companionThinkingLabel(process: CompanionTurnProcess, liveElapsedMs?: number) {
  const thinking = processComponent(process, 'thinking')
  if (thinking?.running) {
    const elapsed = liveElapsedMs !== undefined && liveElapsedMs >= 500
      ? formatDemoElapsed(liveElapsedMs)
      : ''
    return elapsed
      ? t(`正在思考 ${elapsed}`, `Thinking ${elapsed}`)
      : t('正在思考', 'Thinking')
  }
  const duration = finiteThinkingDurationMs(thinking?.durationMs)
  if (duration === undefined) return t('想了', 'Thought')
  return thinkingSummary(duration)
}

export type CompanionLiveStreamState = {
  held: string
  anchorUserId: string
}

/**
 * The phone keeps the in-flight draft after the transcript has the reviewed
 * reply, because those strings differ. The draft then stays under the next
 * user line, so the new question renders above the previous answer.
 * Drop it once that turn has an assistant reply, or once a newer user line exists.
 */
export function resolveCompanionLiveStream(
  entries: CompanionTranscriptEntry[],
  streaming: string,
  state: CompanionLiveStreamState,
): { text: string; held: string; anchorUserId: string } {
  const live = String(streaming ?? '')
  const held = state.held
  const anchorUserId = state.anchorUserId
  let lastUserIndex = -1
  entries.forEach((entry, index) => {
    if (entry.role === 'user') lastUserIndex = index
  })
  const lastUser = lastUserIndex >= 0 ? entries[lastUserIndex] : undefined
  const anchorForLive = lastUser?.id || anchorUserId
  const landedAfter = (anchorId: string) => {
    const anchorIndex = anchorId
      ? entries.findIndex(entry => entry.id === anchorId)
      : lastUserIndex
    const after = anchorIndex >= 0 ? entries.slice(anchorIndex + 1) : []
    return after.some(entry => (
      entry.role === 'assistant'
      && !companionEntryIsProcessOnly(entry)
      && Boolean(companionChatPlainText(entry) || String(entry.error ?? '').trim())
    ))
  }
  if (live.trim()) {
    if (landedAfter(anchorForLive)) return { text: '', held: '', anchorUserId: '' }
    return {
      text: live,
      held: live,
      anchorUserId: anchorForLive,
    }
  }
  if (!held.trim()) return { text: '', held: '', anchorUserId: '' }
  const landed = landedAfter(anchorUserId || lastUser?.id || '')
  const sameTurn = Boolean(lastUser && lastUser.id === anchorUserId)
  if (landed || !sameTurn) return { text: '', held: '', anchorUserId: '' }
  return { text: held, held, anchorUserId }
}

export function companionProcessSummary(process: CompanionTurnProcess, liveElapsedMs?: number) {
  const parts: string[] = []
  const thinking = processComponent(process, 'thinking')
  if (thinking && (thinking.detail.trim() || thinking.running)) {
    parts.push(companionThinkingLabel(process, liveElapsedMs))
  }
  const tools = processComponents(process, 'tool')
  if (tools.length) {
    parts.push(t(`${tools.length} 个工具`, `${tools.length} tools`))
  }
  if (!parts.length && process.components.some(item => item.kind !== 'thinking' && item.kind !== 'tool')) {
    parts.push(t('过程', 'Process'))
  }
  return parts.join(' · ')
}
