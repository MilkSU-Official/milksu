import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { ArtifactStore } from './artifacts.ts'
import { sanitizeResearchText, sanitizeSourceURL, validResearchRunId } from './sanitize.ts'
import { generateTraceId, normalizeTraceId } from '../trace.ts'
import {
  CITATION_SUPPORTED,
  CITATION_UNSUPPORTED,
  MAX_CITATION_CLAIM_CODE_POINTS,
  MAX_CITATION_REASON_CODE_POINTS,
  MAX_SOURCE_BYTES,
  RESEARCH_V1_MIGRATION_NAME,
  RESEARCH_V2_MIGRATION_NAME,
  RESEARCH_V3_MIGRATION_NAME,
  RESEARCH_V4_MIGRATION_NAME,
  RUN_CANCELLED,
  RUN_INTERRUPTED,
  RUN_RUNNING,
  ResearchNotFoundError,
  TASK_CANCELLED,
  TASK_INTERRUPTED,
  TASK_LAUNCHING,
  TASK_RUNNING,
  formatResearchTime,
  parseResearchTime,
  validRunPhase,
  validRunStatus,
  validTaskStatus,
  type Citation,
  type Run,
  type Source,
  type Task,
} from './types.ts'

const RUN_COLUMNS = 'id, conversation_id, query, status, phase, report, created_at, updated_at, worker_stop_unconfirmed, trace_id'

const MIGRATIONS: Array<{ version: number; name: string; up: (db: DatabaseSync) => void }> = [
  { version: 1, name: RESEARCH_V1_MIGRATION_NAME, up: migrateV1 },
  { version: 2, name: RESEARCH_V2_MIGRATION_NAME, up: migrateV2 },
  { version: 3, name: RESEARCH_V3_MIGRATION_NAME, up: migrateV3 },
  { version: 4, name: RESEARCH_V4_MIGRATION_NAME, up: migrateV4 },
]

type SqlRow = Record<string, unknown>

function migrateV1(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
      phase TEXT NOT NULL CHECK(phase IN (
        'collecting', 'waiting', 'synthesis_pending', 'synthesizing',
        'gap_fill_collecting', 'gap_fill_waiting', 'final_synthesis_pending', 'finalizing'
      )),
      report TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_runs_conversation_updated
      ON research_runs(conversation_id, updated_at DESC, id);
    CREATE TABLE IF NOT EXISTS research_tasks (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
      worker_id TEXT NOT NULL,
      batch INTEGER NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(run_id, id)
    );
    CREATE INDEX IF NOT EXISTS research_tasks_run_batch
      ON research_tasks(run_id, batch, id);
    CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      artifact_ref TEXT NOT NULL CHECK(
        length(artifact_ref) = 64 AND artifact_ref NOT GLOB '*[^0-9a-f]*'
      ),
      UNIQUE(run_id, id)
    );
    CREATE INDEX IF NOT EXISTS research_sources_run_retrieved
      ON research_sources(run_id, retrieved_at, id);
    CREATE TABLE IF NOT EXISTS research_citations (
      citation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      claim TEXT NOT NULL,
      source_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('supported', 'unsupported')),
      reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(run_id, source_id) REFERENCES research_sources(run_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS research_citations_run
      ON research_citations(run_id, citation_id);
  `)
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

function migrateV2(db: DatabaseSync): void {
  if (tableColumns(db, 'research_runs').includes('worker_stop_unconfirmed')) return
  db.exec(`ALTER TABLE research_runs
    ADD COLUMN worker_stop_unconfirmed INTEGER NOT NULL DEFAULT 0
    CHECK(worker_stop_unconfirmed IN (0, 1))`)
}

function migrateV3(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE research_tasks_v3 (
      id TEXT NOT NULL,
      run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('launching', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
      worker_id TEXT NOT NULL,
      batch INTEGER NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(run_id, id)
    );
    INSERT INTO research_tasks_v3 (id, run_id, prompt, status, worker_id, batch, result)
      SELECT id, run_id, prompt, status, worker_id, batch, result FROM research_tasks;
    DROP TABLE research_tasks;
    ALTER TABLE research_tasks_v3 RENAME TO research_tasks;
    CREATE INDEX IF NOT EXISTS research_tasks_run_batch
      ON research_tasks(run_id, batch, id);
  `)
}

function migrateV4(db: DatabaseSync): void {
  if (tableColumns(db, 'research_runs').includes('trace_id')) return
  db.exec(`ALTER TABLE research_runs ADD COLUMN trace_id TEXT NOT NULL DEFAULT ''`)
}

function applyPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
}

function migrate(db: DatabaseSync): void {
  applyPragmas(db)
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  ).all() as Array<{ name: string }>
  const applied = new Map<number, string>()
  if (tables.length > 0) {
    const columns = tableColumns(db, 'schema_migrations')
    const hasName = columns.includes('name')
    const rows = hasName
      ? db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{ version: number; name: string }>
      : db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    for (const row of rows) applied.set(Number(row.version), hasName ? String((row as { name: string }).name ?? '') : '')
  }
  const maxApplied = applied.size === 0 ? 0 : Math.max(...applied.keys())
  if (maxApplied > MIGRATIONS.length) {
    throw new Error(`database schema is newer than this app supports: ${maxApplied}`)
  }
  for (let version = 1; version <= maxApplied; version += 1) {
    if (!applied.has(version)) {
      throw new Error(`corrupt migration history: schema_migrations is missing version ${version}`)
    }
    const recorded = applied.get(version) ?? ''
    const expected = MIGRATIONS[version - 1]!.name
    if (recorded && recorded !== expected) {
      throw new Error(`migration name mismatch: schema_migrations records version ${version} as ${JSON.stringify(recorded)}, but the definition is ${JSON.stringify(expected)}`)
    }
  }
  db.exec('BEGIN')
  try {
    if (tables.length > 0 && !tableColumns(db, 'schema_migrations').includes('name')) {
      db.exec(`ALTER TABLE schema_migrations RENAME TO schema_migrations_legacy`)
      db.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`)
      db.exec(`INSERT INTO schema_migrations(version, name, applied_at)
        SELECT version, '', applied_at FROM schema_migrations_legacy`)
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) {
          db.prepare('UPDATE schema_migrations SET name = ? WHERE version = ?').run(migration.name, migration.version)
        }
      }
      db.exec('DROP TABLE schema_migrations_legacy')
    }
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`)
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // transaction may already be closed
    }
    throw error
  }
}

function scanRun(row: SqlRow | undefined): Run {
  if (!row) throw new ResearchNotFoundError()
  return {
    id: String(row.id ?? ''),
    conversationId: String(row.conversation_id ?? ''),
    query: String(row.query ?? ''),
    status: String(row.status ?? ''),
    phase: String(row.phase ?? ''),
    report: String(row.report ?? ''),
    workerStopUnconfirmed: Number(row.worker_stop_unconfirmed ?? 0) !== 0,
    traceId: normalizeTraceId(row.trace_id),
    createdAt: parseResearchTime(String(row.created_at ?? '')),
    updatedAt: parseResearchTime(String(row.updated_at ?? '')),
  }
}

function scanSource(row: SqlRow | undefined): Source {
  if (!row) throw new ResearchNotFoundError()
  return {
    id: String(row.id ?? ''),
    runId: String(row.run_id ?? ''),
    url: String(row.url ?? ''),
    title: String(row.title ?? ''),
    retrievedAt: parseResearchTime(String(row.retrieved_at ?? '')),
    artifactRef: String(row.artifact_ref ?? ''),
  }
}

function scanTask(row: SqlRow): Task {
  return {
    id: String(row.id ?? ''),
    runId: String(row.run_id ?? ''),
    prompt: String(row.prompt ?? ''),
    status: String(row.status ?? ''),
    workerId: String(row.worker_id ?? ''),
    batch: Number(row.batch ?? 0),
    result: String(row.result ?? ''),
  }
}

function normalizeRun(run: Run, creating: boolean): Run {
  const next: Run = {
    ...run,
    id: String(run.id ?? '').trim(),
    conversationId: String(run.conversationId ?? '').trim(),
    query: sanitizeResearchText(String(run.query ?? '')).trim(),
    status: String(run.status ?? '').trim(),
    phase: String(run.phase ?? '').trim(),
    report: sanitizeResearchText(String(run.report ?? '')),
    traceId: normalizeTraceId(run.traceId),
  }
  if (!validResearchRunId(next.id)) throw new Error('invalid research run id')
  if (!next.conversationId || !next.query) {
    throw new Error('research conversation id and query are required')
  }
  if (!validRunStatus(next.status)) throw new Error(`unsupported research run status ${JSON.stringify(next.status)}`)
  if (!validRunPhase(next.phase)) throw new Error(`unsupported research run phase ${JSON.stringify(next.phase)}`)
  if (creating && Number.isNaN(next.createdAt?.getTime?.() ?? Number.NaN)) {
    next.createdAt = new Date()
  }
  if (!next.updatedAt || Number.isNaN(next.updatedAt.getTime())) {
    next.updatedAt = creating ? next.createdAt : new Date()
  }
  return next
}

function normalizeTask(task: Task): Task {
  const next: Task = {
    ...task,
    id: String(task.id ?? '').trim(),
    runId: String(task.runId ?? '').trim(),
    prompt: sanitizeResearchText(String(task.prompt ?? '')),
    result: sanitizeResearchText(String(task.result ?? '')),
    workerId: String(task.workerId ?? ''),
    status: String(task.status ?? ''),
    batch: Number(task.batch ?? 0),
  }
  if (!next.id || !next.runId) throw new Error('research task id and run id are required')
  if (!validTaskStatus(next.status)) throw new Error(`unsupported research task status ${JSON.stringify(next.status)}`)
  return next
}

function upsertTask(db: DatabaseSync, task: Task): void {
  db.prepare(`INSERT INTO research_tasks (
    id, run_id, prompt, status, worker_id, batch, result
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(run_id, id) DO UPDATE SET
    prompt = excluded.prompt,
    status = excluded.status,
    worker_id = excluded.worker_id,
    batch = excluded.batch,
    result = excluded.result`).run(
    task.id,
    task.runId,
    task.prompt,
    task.status,
    task.workerId,
    task.batch,
    task.result,
  )
}

export function newCitation(
  runId: string,
  claim: string,
  sourceId: string,
  verdict: string,
  reason: string,
): Citation {
  const next: Citation = {
    runId: String(runId ?? '').trim(),
    claim: sanitizeResearchText(String(claim ?? '')).trim(),
    sourceId: String(sourceId ?? '').trim(),
    verdict: String(verdict ?? '').trim(),
    reason: sanitizeResearchText(String(reason ?? '')).trim(),
  }
  if (!next.runId) throw new Error('run ID is required')
  if (!next.claim) throw new Error('claim is required')
  if (!next.sourceId) throw new Error('source ID is required')
  if (next.verdict !== CITATION_SUPPORTED && next.verdict !== CITATION_UNSUPPORTED) {
    throw new Error('verdict must be supported or unsupported')
  }
  if ([...next.claim].length > MAX_CITATION_CLAIM_CODE_POINTS) {
    throw new Error('claim exceeds 2000 Unicode code points')
  }
  if ([...next.reason].length > MAX_CITATION_REASON_CODE_POINTS) {
    throw new Error('reason exceeds 1200 Unicode code points')
  }
  return next
}

export class ResearchStore {
  private readonly db: DatabaseSync
  readonly artifacts: ArtifactStore
  readonly directory: string

  constructor(db: DatabaseSync, artifacts: ArtifactStore, directory: string) {
    this.db = db
    this.artifacts = artifacts
    this.directory = directory
  }

  static open(dataDirectory: string): ResearchStore {
    const root = String(dataDirectory ?? '').trim()
    if (!root) throw new Error('research data directory is required')
    const directory = join(root, 'domain', 'research')
    const databasePath = join(directory, 'research.sqlite3')
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(databasePath)
    try {
      migrate(db)
    } catch (error) {
      db.close()
      throw error
    }
    const artifacts = new ArtifactStore(join(directory, 'artifacts'))
    return new ResearchStore(db, artifacts, directory)
  }

  close(): void {
    this.db.close()
  }

  deleteConversation(conversationId: string): void {
    const id = String(conversationId ?? '').trim()
    if (!id) throw new Error('conversation id is required')
    const rows = this.db.prepare('SELECT id FROM research_runs WHERE conversation_id = ?').all(id) as Array<{ id: string }>
    for (const row of rows) this.artifacts.removeJob(row.id)
    this.db.prepare('DELETE FROM research_runs WHERE conversation_id = ?').run(id)
  }

  createRun(run: Run): void {
    const next = normalizeRun(run, true)
    this.db.prepare(`INSERT INTO research_runs (
      id, conversation_id, query, status, phase, report, created_at, updated_at, trace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      next.id,
      next.conversationId,
      next.query,
      next.status,
      next.phase,
      next.report,
      formatResearchTime(next.createdAt),
      formatResearchTime(next.updatedAt),
      next.traceId,
    )
  }

  getRun(runId: string): Run {
    try {
      return scanRun(
        this.db.prepare(`SELECT ${RUN_COLUMNS} FROM research_runs WHERE id = ?`).get(String(runId ?? '').trim()) as SqlRow | undefined,
      )
    } catch (error) {
      if (error instanceof ResearchNotFoundError) throw new Error(`get research run: ${error.message}`)
      throw error
    }
  }

  findActiveRun(conversationId: string): Run {
    const id = String(conversationId ?? '').trim()
    if (!id) throw new Error('research conversation id is required')
    return scanRun(
      this.db.prepare(`SELECT ${RUN_COLUMNS}
        FROM research_runs
        WHERE conversation_id = ? AND status = ?
        ORDER BY updated_at DESC, created_at DESC, id
        LIMIT 1`).get(id, RUN_RUNNING) as SqlRow | undefined,
    )
  }

  findUnconfirmedWorkerStop(conversationId: string): Run {
    const id = String(conversationId ?? '').trim()
    if (!id) throw new Error('research conversation id is required')
    return scanRun(
      this.db.prepare(`SELECT ${RUN_COLUMNS}
        FROM research_runs
        WHERE conversation_id = ? AND status = ? AND worker_stop_unconfirmed = 1
        ORDER BY updated_at DESC, created_at DESC, id
        LIMIT 1`).get(id, RUN_CANCELLED) as SqlRow | undefined,
    )
  }

  listRuns(conversationId: string, limit: number): Run[] {
    const id = String(conversationId ?? '').trim()
    if (!id) throw new Error('research conversation id is required')
    if (limit <= 0) return []
    const rows = this.db.prepare(`SELECT ${RUN_COLUMNS}
      FROM research_runs
      WHERE conversation_id = ?
      ORDER BY updated_at DESC, created_at DESC, id
      LIMIT ?`).all(id, limit) as SqlRow[]
    return rows.map((row) => scanRun(row))
  }

  updateRun(run: Run): void {
    const next = normalizeRun(run, false)
    const result = this.db.prepare(`UPDATE research_runs
      SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
      WHERE id = ?`).run(
      next.conversationId,
      next.query,
      next.status,
      next.phase,
      next.report,
      formatResearchTime(next.updatedAt),
      next.id,
    )
    if (result.changes === 0) throw new ResearchNotFoundError('update research run: no rows')
  }

  setWorkerStopUnconfirmed(conversationId: string, runId: string, unconfirmed: boolean): void {
    const result = this.db.prepare(`UPDATE research_runs
      SET worker_stop_unconfirmed = ?
      WHERE id = ? AND conversation_id = ? AND status = ?`).run(
      unconfirmed ? 1 : 0,
      String(runId ?? '').trim(),
      String(conversationId ?? '').trim(),
      RUN_CANCELLED,
    )
    if (result.changes === 0) throw new ResearchNotFoundError('update research worker stop state: no rows')
  }

  upsertTask(task: Task): void {
    upsertTask(this.db, normalizeTask(task))
  }

  upsertTasksAndRun(tasks: Task[], run: Run): void {
    const nextRun = normalizeRun(run, false)
    const nextTasks = tasks.map((task) => {
      const next = normalizeTask(task)
      if (next.runId !== nextRun.id) throw new Error('research task belongs to a different run')
      return next
    })
    this.db.exec('BEGIN')
    try {
      for (const task of nextTasks) upsertTask(this.db, task)
      const result = this.db.prepare(`UPDATE research_runs
        SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
        WHERE id = ?`).run(
        nextRun.conversationId,
        nextRun.query,
        nextRun.status,
        nextRun.phase,
        nextRun.report,
        formatResearchTime(nextRun.updatedAt),
        nextRun.id,
      )
      if (result.changes === 0) throw new ResearchNotFoundError('update research worker batch run: no rows')
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // transaction may already be closed
      }
      throw error
    }
  }

  listTasks(runId: string): Task[] {
    const id = String(runId ?? '').trim()
    if (!id) throw new Error('research run id is required')
    const rows = this.db.prepare(
      `SELECT id, run_id, prompt, status, worker_id, batch, result
       FROM research_tasks WHERE run_id = ? ORDER BY batch, id`,
    ).all(id) as SqlRow[]
    return rows.map(scanTask)
  }

  addSource(runId: string, url: string, title: string, retrievedAt: Date, data: Uint8Array): Source {
    const id = String(runId ?? '').trim()
    const safeTitle = sanitizeResearchText(title).trim()
    const payload = Buffer.from(sanitizeResearchText(Buffer.from(data).toString('utf8')), 'utf8')
    if (!validResearchRunId(id)) throw new Error('invalid research run id')
    if (payload.length === 0 || payload.length > MAX_SOURCE_BYTES) {
      throw new Error(`research source content must be between 1 and ${MAX_SOURCE_BYTES} bytes`)
    }
    const safeURL = sanitizeSourceURL(url)
    const when = retrievedAt && !Number.isNaN(retrievedAt.getTime()) ? retrievedAt : new Date()
    const sourceId = `source_${randomUUID()}`
    this.db.exec('BEGIN')
    try {
      const exists = this.db.prepare('SELECT 1 AS ok FROM research_runs WHERE id = ?').get(id) as { ok?: number } | undefined
      if (!exists) throw new Error('check research source run: no rows')
      const artifact = this.artifacts.admit(id, `research-source:${sourceId}`, 'text/plain', payload)
      const source: Source = {
        id: sourceId,
        runId: id,
        url: safeURL,
        title: safeTitle,
        retrievedAt: when,
        artifactRef: artifact.sha256,
      }
      this.db.prepare(`INSERT INTO research_sources (
        id, run_id, url, title, retrieved_at, artifact_ref
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        source.id,
        source.runId,
        source.url,
        source.title,
        formatResearchTime(source.retrievedAt),
        source.artifactRef,
      )
      this.db.exec('COMMIT')
      return source
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // transaction may already be closed
      }
      throw error
    }
  }

  listSources(runId: string): Source[] {
    const id = String(runId ?? '').trim()
    if (!id) throw new Error('research run id is required')
    const rows = this.db.prepare(
      `SELECT id, run_id, url, title, retrieved_at, artifact_ref
       FROM research_sources WHERE run_id = ? ORDER BY retrieved_at, id`,
    ).all(id) as SqlRow[]
    return rows.map((row) => scanSource(row))
  }

  readSource(sourceId: string): { source: Source; data: Buffer } {
    const source = scanSource(
      this.db.prepare(
        `SELECT id, run_id, url, title, retrieved_at, artifact_ref
         FROM research_sources WHERE id = ?`,
      ).get(String(sourceId ?? '').trim()) as SqlRow | undefined,
    )
    if (!/^[0-9a-f]{64}$/.test(source.artifactRef)) {
      throw new Error('read research source: invalid artifact digest')
    }
    const data = this.artifacts.read(source.runId, source.artifactRef)
    return { source, data }
  }

  addCitation(citation: Citation): void {
    const validated = newCitation(
      citation.runId,
      citation.claim,
      citation.sourceId,
      citation.verdict,
      citation.reason,
    )
    this.db.prepare(`INSERT INTO research_citations (
      run_id, claim, source_id, verdict, reason
    ) VALUES (?, ?, ?, ?, ?)`).run(
      validated.runId,
      validated.claim,
      validated.sourceId,
      validated.verdict,
      validated.reason,
    )
  }

  listCitations(runId: string): Citation[] {
    const id = String(runId ?? '').trim()
    if (!id) throw new Error('research run id is required')
    const rows = this.db.prepare(
      `SELECT run_id, claim, source_id, verdict, reason
       FROM research_citations WHERE run_id = ? ORDER BY citation_id`,
    ).all(id) as SqlRow[]
    return rows.map((row) => ({
      runId: String(row.run_id ?? ''),
      claim: String(row.claim ?? ''),
      sourceId: String(row.source_id ?? ''),
      verdict: String(row.verdict ?? ''),
      reason: String(row.reason ?? ''),
    }))
  }

  interruptRunning(): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare(`UPDATE research_tasks
        SET status = ?
        WHERE status IN (?, ?) AND run_id IN (
          SELECT id FROM research_runs WHERE status = ?
        )`).run(TASK_INTERRUPTED, TASK_RUNNING, TASK_LAUNCHING, RUN_RUNNING)
      this.db.prepare(`UPDATE research_runs
        SET status = ?, updated_at = ?
        WHERE status = ?`).run(RUN_INTERRUPTED, formatResearchTime(new Date()), RUN_RUNNING)
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // transaction may already be closed
      }
      throw error
    }
  }

  cancelRun(run: Run): void {
    const next = normalizeRun(run, false)
    if (next.status !== RUN_CANCELLED) throw new Error('research run cancellation status is required')
    this.db.exec('BEGIN')
    try {
      this.db.prepare(`UPDATE research_tasks SET status = ?
        WHERE run_id = ? AND status IN (?, ?, ?)`).run(
        TASK_CANCELLED,
        next.id,
        TASK_RUNNING,
        TASK_LAUNCHING,
        TASK_INTERRUPTED,
      )
      const result = this.db.prepare(`UPDATE research_runs
        SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
        WHERE id = ? AND status IN (?, ?)`).run(
        next.conversationId,
        next.query,
        next.status,
        next.phase,
        next.report,
        formatResearchTime(next.updatedAt),
        next.id,
        RUN_RUNNING,
        RUN_INTERRUPTED,
      )
      if (result.changes === 0) throw new ResearchNotFoundError('cancel research run: no rows')
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // transaction may already be closed
      }
      throw error
    }
  }

  interruptRun(run: Run): void {
    const next = normalizeRun(run, false)
    if (next.status !== RUN_INTERRUPTED) throw new Error('research run interruption status is required')
    this.db.exec('BEGIN')
    try {
      this.db.prepare(`UPDATE research_tasks SET status = ?
        WHERE run_id = ? AND status IN (?, ?)`).run(
        TASK_INTERRUPTED,
        next.id,
        TASK_RUNNING,
        TASK_LAUNCHING,
      )
      const result = this.db.prepare(`UPDATE research_runs
        SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
        WHERE id = ? AND status = ?`).run(
        next.conversationId,
        next.query,
        next.status,
        next.phase,
        next.report,
        formatResearchTime(next.updatedAt),
        next.id,
        RUN_RUNNING,
      )
      if (result.changes === 0) throw new ResearchNotFoundError('interrupt research run: no rows')
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // transaction may already be closed
      }
      throw error
    }
  }
}

export { generateTraceId }
