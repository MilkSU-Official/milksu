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
  /** Wall clock for the whole live turn. Step clocks must not replace this. */
  turnStartedAt?: number
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
    turnStartedAt: left.turnStartedAt ?? right.turnStartedAt,
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

export function companionToolActivity(name: string) {
  const tool = name.trim().toLowerCase()
  if (tool === 'bash' || tool === 'shell') return t('正在等命令', 'Waiting for the command')
  if (tool === 'read') return t('正在读文件', 'Reading a file')
  if (tool === 'grep' || tool === 'find' || tool === 'ls' || tool === 'glob') {
    return t('正在检索', 'Searching')
  }
  if (tool === 'edit' || tool === 'write') return t('正在改文件', 'Editing a file')
  if (tool === 'companion_dispatch') return t('正在等对话', 'Waiting for the conversation')
  if (tool === 'companion_board') return t('正在看看板', 'Checking the board')
  if (tool === 'companion_memory') return t('正在查记忆', 'Checking memory')
  if (tool === 'companion_app') return t('正在处理应用', 'Working in the app')
  if (tool === 'milksu_workspace') return t('正在处理会话', 'Working on a conversation')
  return t('正在调用工具', 'Running a tool')
}

/** What the live turn is doing now. Tool count stays on the whole turn. */
export function companionLiveActivity(process: CompanionTurnProcess) {
  const running = [...process.tools].reverse().find(tool => tool.running)
  if (running) return companionToolActivity(running.name)
  if (process.reply.trim() && !process.thinkingRunning) return t('正在回复', 'Replying')
  return t('正在思考', 'Thinking')
}

export function companionToolCountLabel(count: number) {
  return t(
    `${count} 次工具调用`,
    count === 1 ? '1 tool call' : `${count} tool calls`,
  )
}

export function companionLiveSummary(process: CompanionTurnProcess, now: number) {
  const elapsedMs = process.turnStartedAt != null
    ? Math.max(0, now - process.turnStartedAt)
    : 0
  return {
    activity: companionLiveActivity(process),
    elapsed: elapsedMs >= 500 ? formatDemoElapsed(elapsedMs) : '',
    tools: process.tools.length ? companionToolCountLabel(process.tools.length) : '',
  }
}

/** Keep the number the user was watching: the whole turn, not the last thinking step. */
export function finishCompanionTurn(
  process: CompanionTurnProcess,
  now = Date.now(),
): CompanionTurnProcess {
  const wall = process.turnStartedAt != null
    ? Math.floor(Math.max(0, now - process.turnStartedAt))
    : undefined
  return {
    ...process,
    thinkingRunning: false,
    thinkingStartedAt: undefined,
    thinkingDurationMs: wall && wall > 0 ? wall : process.thinkingDurationMs,
    tools: process.tools.map(tool => ({ ...tool, running: false })),
  }
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
  if (
    process.thinking.trim()
    || process.thinkingRunning
    || finiteThinkingDurationMs(process.thinkingDurationMs) !== undefined
  ) {
    parts.push(companionThinkingLabel(process, liveElapsedMs))
  }
  if (process.tools.length) {
    parts.push(companionToolCountLabel(process.tools.length))
  }
  return parts.join(' · ')
}
