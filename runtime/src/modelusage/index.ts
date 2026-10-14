import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SUPPORTED_DATABASE_VERSION = 1
const USAGE_V1_MIGRATION_NAME = 'create Coding Agent usage ledger'
const MAXIMUM_TEXT_RUNES = 512
const MAXIMUM_TOKEN_COUNT = 1_000_000_000_000

export type UsageKind = 'model' | 'tool'

export type UsageRecord = {
  id: string
  conversationId: string
  kind: UsageKind
  occurredAt: Date
  provider?: string
  model?: string
  source?: string
  toolName?: string
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  totalTokens?: number
  costUsd?: number
  durationMs?: number
  success?: boolean
}

export type ModelBreakdown = {
  provider: string
  model: string
  source: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  calls: number
}

export type ToolBreakdown = {
  name: string
  calls: number
  failures: number
  durationMs: number
}

export type UsageDay = {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  modelCalls: number
  toolCalls: number
  models: ModelBreakdown[]
  tools: ToolBreakdown[]
}

export type UsageSnapshot = {
  from: string
  to: string
  activeDays: number
  modelCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  days: UsageDay[]
}

export class ModelUsageStore {
  readonly path: string
  private db: DatabaseSync

  constructor(path: string) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try { chmodSync(dirname(path), 0o700) } catch { /* already 700 */ }
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    migrate(this.db)
    protectSqliteFiles(path)
  }

  static open(path: string): ModelUsageStore {
    return new ModelUsageStore(path)
  }

  record(record: UsageRecord): void {
    const normalized = normalizeRecord(record)
    this.db.prepare(`INSERT OR IGNORE INTO usage_events (
      id, conversation_id, kind, occurred_at_ms, provider, model, source,
      tool_name, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, reasoning_tokens, total_tokens, cost_usd,
      duration_ms, success
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      normalized.id,
      normalized.conversationId,
      normalized.kind,
      normalized.occurredAt.getTime(),
      normalized.provider ?? '',
      normalized.model ?? '',
      normalized.source ?? '',
      normalized.toolName ?? '',
      normalized.inputTokens ?? 0,
      normalized.outputTokens ?? 0,
      normalized.cacheRead ?? 0,
      normalized.cacheWrite ?? 0,
      normalized.reasoning ?? 0,
      normalized.totalTokens ?? 0,
      normalized.costUsd ?? 0,
      normalized.durationMs ?? 0,
      normalized.success ? 1 : 0,
    )
  }

  snapshot(now = new Date()): UsageSnapshot {
    const locationNow = now
    const tomorrow = new Date(locationNow.getFullYear(), locationNow.getMonth(), locationNow.getDate() + 1)
    const from = new Date(tomorrow)
    from.setDate(from.getDate() - 365)
    const rows = this.db.prepare(`SELECT
      kind, occurred_at_ms, provider, model, source, tool_name,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      reasoning_tokens, total_tokens, cost_usd, duration_ms, success
      FROM usage_events
      WHERE occurred_at_ms >= ? AND occurred_at_ms < ?
      ORDER BY occurred_at_ms ASC, id ASC`).all(from.getTime(), tomorrow.getTime()) as Array<Record<string, unknown>>

    const toDate = new Date(tomorrow)
    toDate.setDate(toDate.getDate() - 1)
    const snapshot: UsageSnapshot = {
      from: formatDay(from),
      to: formatDay(toDate),
      activeDays: 0,
      modelCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      days: [],
    }
    const dayIndex = new Map<string, number>()
    for (const row of rows) {
      const occurred = new Date(Number(row.occurred_at_ms))
      const date = formatDay(occurred)
      let index = dayIndex.get(date)
      if (index === undefined) {
        index = snapshot.days.length
        dayIndex.set(date, index)
        snapshot.days.push(emptyDay(date))
      }
      const day = snapshot.days[index]!
      const kind = String(row.kind)
      if (kind === 'model') {
        const inputTokens = Number(row.input_tokens)
        const outputTokens = Number(row.output_tokens)
        const cacheRead = Number(row.cache_read_tokens)
        const cacheWrite = Number(row.cache_write_tokens)
        const reasoning = Number(row.reasoning_tokens)
        const totalTokens = Number(row.total_tokens)
        const costUsd = Number(row.cost_usd)
        day.inputTokens += inputTokens
        day.outputTokens += outputTokens
        day.cacheReadTokens += cacheRead
        day.cacheWriteTokens += cacheWrite
        day.reasoningTokens += reasoning
        day.totalTokens += totalTokens
        day.costUsd += costUsd
        day.modelCalls += 1
        snapshot.inputTokens += inputTokens
        snapshot.outputTokens += outputTokens
        snapshot.cacheReadTokens += cacheRead
        snapshot.cacheWriteTokens += cacheWrite
        snapshot.reasoningTokens += reasoning
        snapshot.totalTokens += totalTokens
        snapshot.modelCalls += 1
        const provider = String(row.provider ?? '')
        const model = String(row.model ?? '')
        const source = String(row.source ?? '')
        const key = `${provider}\0${model}\0${source}`
        let breakdown = day.models.find((item) => `${item.provider}\0${item.model}\0${item.source}` === key)
        if (!breakdown) {
          breakdown = {
            provider, model, source,
            inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            reasoningTokens: 0, totalTokens: 0, costUsd: 0, calls: 0,
          }
          day.models.push(breakdown)
        }
        breakdown.inputTokens += inputTokens
        breakdown.outputTokens += outputTokens
        breakdown.cacheReadTokens += cacheRead
        breakdown.cacheWriteTokens += cacheWrite
        breakdown.reasoningTokens += reasoning
        breakdown.totalTokens += totalTokens
        breakdown.costUsd += costUsd
        breakdown.calls += 1
      } else if (kind === 'tool') {
        day.toolCalls += 1
        snapshot.toolCalls += 1
        const toolName = String(row.tool_name ?? '')
        let breakdown = day.tools.find((item) => item.name === toolName)
        if (!breakdown) {
          breakdown = { name: toolName, calls: 0, failures: 0, durationMs: 0 }
          day.tools.push(breakdown)
        }
        breakdown.calls += 1
        breakdown.durationMs += Number(row.duration_ms)
        if (Number(row.success) === 0) breakdown.failures += 1
      }
    }
    for (const day of snapshot.days) {
      day.models.sort((left, right) => {
        if (left.totalTokens === right.totalTokens) return left.model.localeCompare(right.model)
        return right.totalTokens - left.totalTokens
      })
      day.tools.sort((left, right) => {
        if (left.calls === right.calls) return left.name.localeCompare(right.name)
        return right.calls - left.calls
      })
    }
    snapshot.activeDays = snapshot.days.length
    return snapshot
  }

  close(): void {
    this.db.close()
  }
}

function emptyDay(date: string): UsageDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    modelCalls: 0,
    toolCalls: 0,
    models: [],
    tools: [],
  }
}

function formatDay(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
  const applied = new Set(rows.map((row) => Number(row.version)))
  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('model', 'tool')),
        occurred_at_ms INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL CHECK(success IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS usage_events_occurred_at
        ON usage_events(occurred_at_ms, kind);
      CREATE INDEX IF NOT EXISTS usage_events_model
        ON usage_events(model, source, occurred_at_ms);
      CREATE INDEX IF NOT EXISTS usage_events_tool
        ON usage_events(tool_name, occurred_at_ms);
    `)
    db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      USAGE_V1_MIGRATION_NAME,
      new Date().toISOString(),
    )
  }
}

function trimBounded(value: string): string {
  const runes = [...String(value ?? '').trim()]
  return runes.slice(0, MAXIMUM_TEXT_RUNES).join('')
}

function normalizeRecord(record: UsageRecord): UsageRecord {
  const next: UsageRecord = {
    ...record,
    id: String(record.id ?? '').trim(),
    conversationId: String(record.conversationId ?? '').trim(),
    provider: trimBounded(record.provider ?? ''),
    model: trimBounded(record.model ?? ''),
    source: trimBounded(record.source ?? '').toLowerCase(),
    toolName: trimBounded(record.toolName ?? ''),
  }
  if (!next.id || [...next.id].length > MAXIMUM_TEXT_RUNES) {
    throw new Error('usage record id is required and must be bounded')
  }
  if (!next.conversationId || [...next.conversationId].length > 128) {
    throw new Error('usage conversation id is required and must be bounded')
  }
  if (!(next.occurredAt instanceof Date) || Number.isNaN(next.occurredAt.getTime())) {
    throw new Error('usage occurrence time is required')
  }
  if (next.kind === 'model') {
    if (!next.model) throw new Error('model usage record requires a model')
    next.toolName = ''
  } else if (next.kind === 'tool') {
    if (!next.toolName) throw new Error('tool usage record requires a tool name')
    next.provider = ''
    next.model = ''
    next.source = ''
    next.inputTokens = 0
    next.outputTokens = 0
    next.cacheRead = 0
    next.cacheWrite = 0
    next.reasoning = 0
    next.totalTokens = 0
    next.costUsd = 0
  } else {
    throw new Error(`unsupported usage record kind ${JSON.stringify(next.kind)}`)
  }
  for (const [label, value] of [
    ['input tokens', next.inputTokens ?? 0],
    ['output tokens', next.outputTokens ?? 0],
    ['cache read tokens', next.cacheRead ?? 0],
    ['cache write tokens', next.cacheWrite ?? 0],
    ['reasoning tokens', next.reasoning ?? 0],
    ['total tokens', next.totalTokens ?? 0],
    ['duration', next.durationMs ?? 0],
  ] as Array<[string, number]>) {
    if (value < 0 || value > MAXIMUM_TOKEN_COUNT) {
      throw new Error(`usage ${label} is outside the supported range`)
    }
  }
  const cost = next.costUsd ?? 0
  if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) {
    throw new Error('usage cost is outside the supported range')
  }
  if (next.kind === 'model' && !next.totalTokens) {
    next.totalTokens = (next.inputTokens ?? 0) + (next.outputTokens ?? 0) + (next.cacheRead ?? 0) + (next.cacheWrite ?? 0)
    if (next.totalTokens > MAXIMUM_TOKEN_COUNT) {
      throw new Error('usage total tokens are outside the supported range')
    }
  }
  return next
}

function protectSqliteFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    if (!existsSync(candidate)) continue
    try { chmodSync(candidate, 0o600) } catch { /* ignore missing sidecar files */ }
  }
}

export function usageFromEngineEvent(event: {
  type: string
  sessionId?: string
  timestamp?: string
  error?: string
  module?: string
  toolName?: string
  toolCallId?: string
  durationMs?: number
  usage?: unknown
}): UsageRecord | null {
  const occurredAt = event.timestamp ? new Date(event.timestamp) : new Date()
  if (Number.isNaN(occurredAt.getTime())) return null
  if (event.type === 'usage.recorded') {
    const usage = event.usage && typeof event.usage === 'object'
      ? event.usage as Record<string, unknown>
      : null
    if (!usage || String(usage.module ?? '') !== 'coding') return null
    const at = String(usage.occurredAt ?? '')
    const when = at ? new Date(at) : occurredAt
    if (Number.isNaN(when.getTime())) return null
    return {
      id: String(usage.recordId ?? ''),
      conversationId: String(event.sessionId ?? '').trim(),
      kind: 'model',
      occurredAt: when,
      provider: String(usage.provider ?? ''),
      model: String(usage.model ?? ''),
      source: String(usage.source ?? ''),
      inputTokens: Number(usage.inputTokens ?? 0),
      outputTokens: Number(usage.outputTokens ?? 0),
      cacheRead: Number(usage.cacheReadTokens ?? 0),
      cacheWrite: Number(usage.cacheWriteTokens ?? 0),
      reasoning: Number(usage.reasoningTokens ?? 0),
      totalTokens: Number(usage.totalTokens ?? 0),
      costUsd: Number(usage.costUsd ?? 0),
      success: usage.success !== false,
    }
  }
  if (event.type === 'tool.completed') {
    if (String(event.module ?? '') !== 'coding') return null
    const toolCallId = String(event.toolCallId ?? '').trim()
    if (!toolCallId) return null
    return {
      id: `tool:${event.sessionId}:${toolCallId}`,
      conversationId: String(event.sessionId ?? '').trim(),
      kind: 'tool',
      occurredAt,
      toolName: String(event.toolName ?? ''),
      durationMs: Number(event.durationMs ?? 0),
      success: !event.error,
    }
  }
  return null
}
