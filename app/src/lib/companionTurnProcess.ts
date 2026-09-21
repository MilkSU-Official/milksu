import type { CompanionTranscriptEntry } from '@/types'
import { companionChatPlainText } from '@/lib/companionUserError'
import { t } from '@/lib/uiLocale'

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

export function processFromCompanionEntry(entry: CompanionTranscriptEntry): CompanionTurnProcess {
  return {
    thinking: String(entry.thinking ?? '').trim(),
    thinkingRunning: false,
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

  for (const entry of entries) {
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

export function companionProcessSummary(process: CompanionTurnProcess) {
  const parts: string[] = []
  if (process.thinking.trim() || process.thinkingRunning) {
    parts.push(process.thinkingRunning ? t('正在思考', 'Thinking') : t('想了', 'Thought'))
  }
  if (process.tools.length) {
    parts.push(t(`${process.tools.length} 个工具`, `${process.tools.length} tools`))
  }
  return parts.join(' · ')
}
