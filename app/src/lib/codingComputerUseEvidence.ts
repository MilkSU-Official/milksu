import type { Message } from '@/types'

export type ComputerUseOperationAction = 'click' | 'type' | 'key' | 'scroll'

export interface ComputerUseOperationEvidence {
  action: ComputerUseOperationAction
  targetName: string
  bundleId: string
  pid: number
  windowId: number
  windowTitle?: string
  durationMs?: number
  summary: string
}

const COMPUTER_USE_ACTIONS = new Set<ComputerUseOperationAction>([
  'click',
  'type',
  'key',
  'scroll',
])

const COMPUTER_USE_ACTION_ALIASES: Record<string, ComputerUseOperationAction> = {
  click: 'click',
  type: 'type',
  type_text: 'type',
  key: 'key',
  press_key: 'key',
  scroll: 'scroll',
}

function isComputerUseToolName(value: string | undefined) {
  const normalized = String(value ?? '').toLowerCase()
  return normalized.includes('computer_use')
    || normalized.includes('computer-use')
    || normalized.includes('computer use')
}

function parseJSONSegments(value: string) {
  const candidates = value
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
  const full = value.trim()
  if (full && !candidates.includes(full)) candidates.push(full)

  const parsed: unknown[] = []
  for (const candidate of candidates.reverse()) {
    try {
      parsed.push(JSON.parse(candidate))
      continue
    } catch {
      // Tool rows may contain a start summary followed by a formatted JSON
      // result. Fall back to the widest JSON-looking suffix without treating
      // arbitrary prose as evidence.
    }
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        parsed.push(JSON.parse(candidate.slice(start, end + 1)))
      } catch {
        // Ignore malformed or non-envelope segments.
      }
    }
  }
  return parsed
}

function stringField(record: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function numberField(record: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function operationAction(record: Record<string, unknown>): ComputerUseOperationAction | null {
  const explicitAction = stringField(record, 'action').toLowerCase()
  const driverTool = stringField(record, 'driverTool', 'driver_tool', 'tool').toLowerCase()
  const normalized = COMPUTER_USE_ACTION_ALIASES[explicitAction]
    ?? COMPUTER_USE_ACTION_ALIASES[driverTool]
    ?? null
  return normalized && COMPUTER_USE_ACTIONS.has(normalized) ? normalized : null
}

function operationFromEnvelope(
  envelope: unknown,
  durationMs: number | undefined,
): ComputerUseOperationEvidence | null {
  if (!envelope || typeof envelope !== 'object') return null
  const record = envelope as Record<string, unknown>
  const action = operationAction(record)
  if (!action) return null

  const target = record.target
  if (!target || typeof target !== 'object') return null
  const targetRecord = target as Record<string, unknown>
  const targetName = stringField(targetRecord, 'app', 'name', 'targetName')
  const bundleId = stringField(targetRecord, 'bundleId', 'bundle_id')
  const pid = numberField(targetRecord, 'pid')
  const windowId = numberField(targetRecord, 'windowId', 'window_id')
  if (!targetName || !bundleId || pid <= 0 || windowId <= 0) return null

  const windowTitle = stringField(targetRecord, 'title', 'windowTitle', 'window_title')
  const summary = [
    action,
    targetName,
    bundleId,
    `PID ${pid}`,
    `Window ${windowId}`,
    windowTitle,
  ].filter(Boolean).join(' · ')

  return {
    action,
    targetName,
    bundleId,
    pid,
    windowId,
    windowTitle: windowTitle || undefined,
    durationMs,
    summary,
  }
}

export function extractLatestComputerUseOperationEvidence(
  messages: Message[],
): ComputerUseOperationEvidence | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool' || message.status !== 'done') continue
    if (!isComputerUseToolName(message.toolName) && !message.content.includes('"driverTool"')) continue
    for (const parsed of parseJSONSegments(message.content)) {
      const operation = operationFromEnvelope(parsed, message.durationMs)
      if (operation) return operation
    }
  }
  return null
}
