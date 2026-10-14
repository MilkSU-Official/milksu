import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EVENT_SCHEMA_VERSION, type EventDraft, type JobProjection, type RuntimeEvent } from './types.ts'
import { formatRFC3339, newId, validateIdentifier } from './ids.ts'
import { projectEvents } from './projection.ts'

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

const V1_UP = [
  `CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL DEFAULT '',
    step_id TEXT NOT NULL DEFAULT '',
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    schema_version INTEGER NOT NULL,
    UNIQUE(job_id, sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS events_job_id_sequence ON events(job_id, sequence)`,
  `CREATE TRIGGER IF NOT EXISTS events_append_only_update
    BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS events_append_only_delete
    BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
]

export class EventStore {
  private readonly mutex = new Mutex()
  private readonly db: DatabaseSync
  readonly path: string

  constructor(db: DatabaseSync, path: string) {
    this.db = db
    this.path = path
  }

  static open(path: string): EventStore {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(path)
    try {
      chmodSync(path, 0o600)
    } catch {
      // Windows may ignore POSIX mode bits.
    }
    migrate(db)
    return new EventStore(db, path)
  }

  close(): void {
    this.db.close()
  }

  append(draft: EventDraft): Promise<RuntimeEvent> {
    return this.mutex.run(async () => this.appendSync(draft))
  }

  events(jobId: string): Promise<RuntimeEvent[]> {
    return this.mutex.run(async () => {
      validateIdentifier('job id', jobId)
      return this.queryEvents(jobId)
    })
  }

  projection(jobId: string): Promise<JobProjection> {
    return this.mutex.run(async () => this.projectionSync(jobId))
  }

  projections(): Promise<JobProjection[]> {
    return this.mutex.run(async () => {
      const rows = this.db.prepare('SELECT DISTINCT job_id AS jobId FROM events').all() as Array<{ jobId: string }>
      const values: JobProjection[] = []
      for (const row of rows) {
        values.push(this.projectionSync(row.jobId))
      }
      values.sort((left, right) => right.job.updatedAt.localeCompare(left.job.updatedAt))
      return values
    })
  }

  private projectionSync(jobId: string): JobProjection {
    validateIdentifier('job id', jobId)
    const events = this.queryEvents(jobId)
    if (events.length === 0) {
      const error = new Error(`ENOENT: job ${jobId}`)
      ;(error as NodeJS.ErrnoException).code = 'ENOENT'
      throw error
    }
    return projectEvents(events)
  }

  private appendSync(draft: EventDraft): RuntimeEvent {
    validateIdentifier('job id', draft.jobId)
    if (draft.attemptId) validateIdentifier('attempt id', draft.attemptId)
    if (draft.stepId) validateIdentifier('step id', draft.stepId)
    if (!draft.kind) throw new Error('event kind is required')
    const payload = JSON.stringify(draft.payload ?? {})
    this.db.exec('BEGIN')
    try {
      const seqRow = this.db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM events WHERE job_id = ?',
      ).get(draft.jobId) as { sequence: number }
      const event: RuntimeEvent = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: newId('evt'),
        jobId: draft.jobId,
        sequence: Number(seqRow.sequence),
        kind: draft.kind,
        occurredAt: formatRFC3339(),
        payload: JSON.parse(payload),
      }
      if (draft.attemptId) event.attemptId = draft.attemptId
      if (draft.stepId) event.stepId = draft.stepId
      const existing = this.queryEvents(draft.jobId)
      projectEvents([...existing, event])
      this.db.prepare(`
        INSERT INTO events(event_id, job_id, attempt_id, step_id, sequence, kind, occurred_at, payload, schema_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId,
        event.jobId,
        event.attemptId ?? '',
        event.stepId ?? '',
        event.sequence,
        event.kind,
        event.occurredAt,
        payload,
        event.schemaVersion,
      )
      this.db.exec('COMMIT')
      return event
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // ignore
      }
      throw error
    }
  }

  private queryEvents(jobId: string): RuntimeEvent[] {
    const rows = this.db.prepare(`
      SELECT event_id AS eventId, job_id AS jobId, attempt_id AS attemptId, step_id AS stepId,
             sequence, kind, occurred_at AS occurredAt, payload, schema_version AS schemaVersion
      FROM events WHERE job_id = ? ORDER BY sequence
    `).all(jobId) as Array<{
      eventId: string
      jobId: string
      attemptId: string
      stepId: string
      sequence: number
      kind: RuntimeEvent['kind']
      occurredAt: string
      payload: string
      schemaVersion: number
    }>
    return rows.map((row) => {
      const event: RuntimeEvent = {
        schemaVersion: Number(row.schemaVersion),
        eventId: row.eventId,
        jobId: row.jobId,
        sequence: Number(row.sequence),
        kind: row.kind,
        occurredAt: row.occurredAt,
        payload: JSON.parse(row.payload),
      }
      if (row.attemptId) event.attemptId = row.attemptId
      if (row.stepId) event.stepId = row.stepId
      return event
    })
  }
}

function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  const history = db.prepare(
    `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  ).get() as { count: number }
  let maxApplied = 0
  if (Number(history.count) > 0) {
    const versions = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
    for (const row of versions) {
      if (Number(row.version) > maxApplied) maxApplied = Number(row.version)
    }
  }
  if (maxApplied > 1) {
    throw new Error(`schema_migrations records version ${maxApplied}, but this app supports up to version 1`)
  }
  if (maxApplied >= 1) return
  db.exec('BEGIN')
  try {
    for (const statement of V1_UP) db.exec(statement)
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`)
    db.prepare(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
    ).run(1, 'create events store', formatRFC3339())
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  }
}

export function runtimeRoot(dataDir: string): string {
  return join(dataDir, 'runtime')
}
