import type { Message, SubagentTask, SubagentTaskStatus, SubagentYield } from '@/types'

const rosterStatuses = new Set<SubagentTaskStatus>([
  'start',
  'running',
  'succeeded',
  'failed',
])

function boundedText(value: unknown, limit: number) {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  return text.length > limit ? text.slice(text.length - limit) : text
}

export function subagentCitationText(task: {
  role?: string
  id?: string
  summary?: string
  transcript?: string
  liveTranscript?: string
}, limit = 2000) {
  const title = `${String(task.role ?? '').trim()} ${String(task.id ?? '').trim()}`.trim()
  const body = String(task.liveTranscript || task.transcript || task.summary || '').trim()
  const clipped = body.length > limit ? body.slice(0, limit) : body
  return clipped ? `${title}\n${clipped}` : title
}

function exactObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeYield(value: unknown): SubagentYield | undefined {
  if (!exactObject(value)) return undefined
  const status = String(value.status ?? '')
  if (status !== 'succeeded' && status !== 'failed' && status !== 'aborted') return undefined
  const files = Array.isArray(value.files)
    ? value.files.map(entry => String(entry ?? '').trim()).filter(Boolean)
    : []
  const findings = Array.isArray(value.findings)
    ? value.findings.flatMap((entry) => {
        if (!exactObject(entry)) return []
        const path = String(entry.path ?? '').trim()
        if (!path) return []
        return [{ path, note: String(entry.note ?? '') }]
      })
    : []
  const exitCode = Number(value.exitCode)
  if (!Number.isSafeInteger(exitCode)) return undefined
  const cwd = String(value.cwd ?? '').trim()
  const worktreeId = String(value.worktreeId ?? '').trim()
  return {
    status,
    cwd: cwd || undefined,
    worktreeId: worktreeId || undefined,
    files,
    findings,
    exitCode,
  }
}

export function normalizeSubagentTasks(value: unknown): SubagentTask[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!exactObject(entry)) return []
    const id = String(entry.id ?? '').trim()
    const role = String(entry.role ?? '').trim()
    const status = String(entry.status ?? '') as SubagentTaskStatus
    if (!id || !role || !rosterStatuses.has(status)) return []
    const durationMs = Number(entry.durationMs)
    const exitCode = Number(entry.exitCode)
    return [{
      id,
      role,
      status,
      toolCallId: typeof entry.toolCallId === 'string' ? entry.toolCallId : undefined,
      durationMs: Number.isFinite(durationMs) && durationMs >= 0
        ? Math.floor(durationMs)
        : undefined,
      exitCode: Number.isSafeInteger(exitCode) ? exitCode : undefined,
      yield: normalizeYield(entry.yield),
      summary: boundedText(entry.summary, 240),
      transcript: boundedText(entry.transcript, 8000),
    }]
  })
}

export function shouldHoldSubagentBackfill(input: {
  running: boolean
  aborting: boolean
  queued: boolean
  composing: boolean
}): boolean {
  return input.running || input.aborting || input.queued || input.composing
}

function liveTranscriptOf(task: SubagentTask) {
  return task.transcript || task.summary || undefined
}

function withLiveTranscript(task: SubagentTask): SubagentTask {
  return { ...task, liveTranscript: liveTranscriptOf(task) }
}

export function subagentRecordText(task: {
  liveTranscript?: string
  transcript?: string
  summary?: string
  yield?: SubagentYield
}) {
  return task.liveTranscript || task.transcript || task.summary || formatSubagentYield(task.yield)
}

export function projectSubagentBackfill(
  previous: readonly SubagentTask[],
  incoming: readonly SubagentTask[],
  hold: boolean,
): { tasks: SubagentTask[]; held: boolean } {
  if (!hold) return { tasks: incoming.map(withLiveTranscript), held: false }
  const prior = new Map(previous.map(task => [task.id, task]))
  let held = false
  const tasks = incoming.map((task) => {
    const liveTranscript = liveTranscriptOf(task)
    const old = prior.get(task.id)
    if (!old) {
      if (task.summary || task.transcript) held = true
      return { ...task, summary: undefined, transcript: undefined, liveTranscript }
    }
    if ((task.summary ?? '') !== (old.summary ?? '') || (task.transcript ?? '') !== (old.transcript ?? '')) {
      held = true
    }
    return {
      ...task,
      summary: old.summary,
      transcript: old.transcript,
      liveTranscript,
    }
  })
  return { tasks, held }
}

export function subagentTasksForActivity(
  tasks: readonly SubagentTask[] | undefined,
  messages: readonly Message[],
): SubagentTask[] {
  if (!tasks?.length) return []
  const callIds = new Set(
    messages
      .filter(message => String(message.toolName ?? '') === 'subagent')
      .map(message => String(message.toolCallId ?? '').trim())
      .filter(Boolean),
  )
  if (!callIds.size) return []
  return tasks.filter(task => (
    callIds.has(task.id)
    || (task.toolCallId ? callIds.has(task.toolCallId) : false)
    || [...callIds].some(id => task.id.startsWith(`${id}:`))
  ))
}

export function formatSubagentYield(value?: SubagentYield) {
  if (!value) return ''
  const lines = [
    ...value.files.map((file, index) => `files[${index}]=${file}`),
    ...value.findings.flatMap((finding, index) => ([
      `findings[${index}].path=${finding.path}`,
      finding.note ? `findings[${index}].note=${finding.note}` : '',
    ])),
    `exitCode=${value.exitCode}`,
    `status=${value.status}`,
    value.worktreeId ? `worktreeId=${value.worktreeId}` : value.cwd ? `cwd=${value.cwd}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}
