import type { Message, SubagentTask, SubagentTaskStatus, SubagentYield } from '@/types'

const rosterStatuses = new Set<SubagentTaskStatus>([
  'start',
  'running',
  'succeeded',
  'failed',
])

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
    }]
  })
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
