import { chmodSync, mkdirSync, statSync } from 'node:fs'
import { dirname, basename, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { StoredConversation } from '../conversations.ts'

export const FACT_BOUNDARY =
  'Obelisk 结果只是历史线索；CVE source snapshots、实验室 report、Coding tests/commits/screenshots 才能成为 MilkSU 正式档案。'

const SOURCE_PREFIX = 'milksu'
const BUSY_TIMEOUT_MS = 5000
const CVE_ID_PATTERN = /\bCVE-\d{4}-\d{4,}\b/i

export type SourceCount = {
  source: string
  count: number
}

export type SessionIndexStatus = {
  available: boolean
  mode: string
  indexPath: string
  checkedAt: string
  readOnly: boolean
  reason?: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
  memoryCount: number
  sources: SourceCount[]
  factBoundary: string
  bytes?: number
}

export type RefreshResult = {
  indexedAt: string
  indexPath: string
  source: string
  sessionCount: number
  messageCount: number
  toolCallCount: number
}

export type SearchRequest = {
  query: string
  limit?: number
  project?: string
  source?: string
  module?: string
  since?: string
  until?: string
}

export type SearchResult = {
  messageUuid: string
  sessionId: string
  sessionName: string
  project?: string
  projectPath?: string
  source?: string
  role?: string
  model?: string
  cwd?: string
  skill?: string
  timestamp?: string
  snippet: string
  score?: number
}

export type SearchResponse = {
  query: string
  searchedAt: string
  status: SessionIndexStatus
  results: SearchResult[]
  factBoundary: string
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT,
    project TEXT,
    project_path TEXT,
    started_at TEXT,
    ended_at TEXT,
    git_branch TEXT,
    version TEXT,
    message_count INTEGER DEFAULT 0,
    jsonl_path TEXT,
    source TEXT DEFAULT 'milksu'
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    uuid TEXT PRIMARY KEY,
    session_id TEXT,
    type TEXT,
    parent_uuid TEXT,
    timestamp TEXT,
    role TEXT,
    text TEXT,
    content_type TEXT,
    is_meta INTEGER DEFAULT 0,
    visibility TEXT DEFAULT 'visible',
    model TEXT,
    is_sidechain INTEGER DEFAULT 0,
    agent_id TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cwd TEXT,
    skill TEXT,
    turn_duration_ms INTEGER,
    source TEXT DEFAULT 'milksu'
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    message_uuid TEXT,
    session_id TEXT,
    name TEXT,
    presentation TEXT DEFAULT 'default',
    input_json TEXT,
    file_path TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tool_results (
    tool_use_id TEXT PRIMARY KEY,
    message_uuid TEXT,
    session_id TEXT,
    content TEXT,
    file_path TEXT,
    is_error INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS subagents (
    agent_id TEXT PRIMARY KEY,
    session_id TEXT,
    parent_tool_use_id TEXT,
    agent_type TEXT,
    description TEXT,
    duration_ms INTEGER,
    total_tokens INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS workflows (
    run_id TEXT PRIMARY KEY,
    session_id TEXT,
    parent_tool_use_id TEXT,
    task_id TEXT,
    script TEXT,
    result_json TEXT,
    timestamp TEXT,
    agent_count INTEGER DEFAULT 0,
    duration_ms INTEGER,
    total_tokens INTEGER,
    status TEXT,
    workflow_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_agents (
    agent_id TEXT PRIMARY KEY,
    run_id TEXT,
    session_id TEXT,
    agent_type TEXT,
    description TEXT,
    phase TEXT,
    label TEXT,
    model TEXT,
    state TEXT,
    duration_ms INTEGER,
    tokens INTEGER,
    tool_calls INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS index_state (
    jsonl_path TEXT PRIMARY KEY,
    mtime REAL,
    lines_processed INTEGER,
    cursor TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    timestamp TEXT,
    source TEXT,
    content TEXT,
    visibility TEXT DEFAULT 'visible',
    input_tokens INTEGER,
    output_tokens INTEGER
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    uuid UNINDEXED,
    session_id UNINDEXED,
    text,
    content=messages,
    content_rowid=rowid
  )`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, uuid, session_id, text)
    VALUES (new.rowid, new.uuid, new.session_id, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, uuid, session_id, text)
    VALUES ('delete', old.rowid, old.uuid, old.session_id, old.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, uuid, session_id, text)
    VALUES ('delete', old.rowid, old.uuid, old.session_id, old.text);
    INSERT INTO messages_fts(rowid, uuid, session_id, text)
    VALUES (new.rowid, new.uuid, new.session_id, new.text);
  END`,
  `CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(session_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source)`,
  `CREATE INDEX IF NOT EXISTS idx_tc_session_name ON tool_calls(session_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_tc_message ON tool_calls(message_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_tc_file ON tool_calls(file_path)`,
  `CREATE INDEX IF NOT EXISTS idx_tr_session ON tool_results(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tr_message ON tool_results(message_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_sa_session ON subagents(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wf_session ON workflows(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wa_run ON workflow_agents(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id)`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    project TEXT,
    message_start TEXT,
    message_end TEXT,
    path TEXT,
    anchors TEXT,
    summary TEXT,
    created_at TEXT,
    deleted_at TEXT,
    deleted_reason TEXT
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    id UNINDEXED,
    path,
    summary,
    content=memories,
    content_rowid=rowid,
    tokenize='unicode61 remove_diacritics 1'
  )`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, id, path, summary)
    VALUES (new.rowid, new.id, new.path, new.summary);
  END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, id, path, summary)
    VALUES ('delete', old.rowid, old.id, old.path, old.summary);
  END`,
  `CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, id, path, summary)
    VALUES ('delete', old.rowid, old.id, old.path, old.summary);
    INSERT INTO memories_fts(rowid, id, path, summary)
    VALUES (new.rowid, new.id, new.path, new.summary);
  END`,
  `CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)`,
]

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

export class SessionIndexStore {
  readonly path: string
  now: () => Date
  private readonly mutex = new Mutex()

  constructor(path: string, now: () => Date = () => new Date()) {
    this.path = path
    this.now = now
  }

  static open(path: string): SessionIndexStore {
    const store = new SessionIndexStore(path)
    store.ensure()
    return store
  }

  private utcNow(): Date {
    const value = this.now()
    return new Date(value.getTime())
  }

  ensure(): void {
    if (!String(this.path ?? '').trim()) throw new Error('session index path is required')
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const db = openWritable(this.path)
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          db.exec(statement)
        } catch (error) {
          if (statement.includes('fts5') || statement.includes('_fts')) continue
          throw error
        }
      }
    } finally {
      db.close()
    }
    chmodSync(this.path, 0o600)
  }

  status(): SessionIndexStatus {
    const checkedAt = this.utcNow().toISOString()
    const status: SessionIndexStatus = {
      available: false,
      mode: 'milksu-obelisk-core',
      indexPath: this.path,
      checkedAt,
      readOnly: true,
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      memoryCount: 0,
      sources: [],
      factBoundary: FACT_BOUNDARY,
    }
    if (!String(this.path ?? '').trim()) {
      status.reason = 'Session Index 路径尚未配置。'
      return status
    }
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(this.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        status.reason = 'Session Index 尚未初始化。'
        return status
      }
      throw new Error(`inspect session index: ${error instanceof Error ? error.message : error}`)
    }
    if (info.isDirectory()) {
      status.reason = 'Session Index 路径是目录，不是 sqlite 文件。'
      return status
    }
    let db: DatabaseSync
    try {
      db = openReadOnly(this.path)
    } catch {
      status.reason = '无法以只读方式打开 Session Index。'
      return status
    }
    try {
      populateCounts(db, status)
      status.available = tableExists(db, 'sessions') && tableExists(db, 'messages')
      if (!status.available && !status.reason) {
        status.reason = 'Session Index 缺少 sessions/messages 表。'
      }
    } catch {
      status.reason = 'Session Index 不可读。'
    } finally {
      db.close()
    }
    return status
  }

  refresh(values: StoredConversation[]): Promise<RefreshResult> {
    return this.mutex.run(async () => {
      this.ensure()
      const db = openWritable(this.path)
      try {
        db.exec('BEGIN')
        try {
          const keepIds = values.map((value) => `milksu:${value.id}`)
          if (keepIds.length === 0) {
            db.exec(`DELETE FROM tool_results WHERE session_id LIKE 'milksu:%'`)
            db.exec(`DELETE FROM tool_calls WHERE session_id LIKE 'milksu:%'`)
            db.exec(`DELETE FROM messages WHERE session_id LIKE 'milksu:%'`)
            db.exec(`DELETE FROM sessions WHERE id LIKE 'milksu:%'`)
          } else {
            const placeholders = keepIds.map(() => '?').join(', ')
            db.prepare(
              `DELETE FROM tool_results WHERE session_id LIKE 'milksu:%' AND session_id NOT IN (${placeholders})`,
            ).run(...keepIds)
            db.prepare(
              `DELETE FROM tool_calls WHERE session_id LIKE 'milksu:%' AND session_id NOT IN (${placeholders})`,
            ).run(...keepIds)
            db.prepare(
              `DELETE FROM messages WHERE session_id LIKE 'milksu:%' AND session_id NOT IN (${placeholders})`,
            ).run(...keepIds)
            db.prepare(
              `DELETE FROM sessions WHERE id LIKE 'milksu:%' AND id NOT IN (${placeholders})`,
            ).run(...keepIds)
          }
          const indexedAt = this.utcNow().toISOString()
          const result: RefreshResult = {
            indexedAt,
            indexPath: this.path,
            source: SOURCE_PREFIX,
            sessionCount: 0,
            messageCount: 0,
            toolCallCount: 0,
          }
          for (const value of values) {
            const next = upsertIndexedConversation(db, value)
            result.sessionCount += next.sessionCount
            result.messageCount += next.messageCount
            result.toolCallCount += next.toolCallCount
          }
          db.prepare(`
            INSERT INTO index_state(jsonl_path, mtime, lines_processed, cursor)
            VALUES ('milksu:conversations', ?, ?, ?)
            ON CONFLICT(jsonl_path) DO UPDATE SET
              mtime = excluded.mtime,
              lines_processed = excluded.lines_processed,
              cursor = excluded.cursor
          `).run(this.utcNow().getTime() / 1000, result.messageCount, indexedAt)
          db.exec('COMMIT')
          return result
        } catch (error) {
          try { db.exec('ROLLBACK') } catch { /* already closed */ }
          throw error
        }
      } finally {
        db.close()
      }
    })
  }

  search(request: SearchRequest): SearchResponse {
    const query = normalizeSpace(request.query)
    if (!query) throw new Error('history search query is required')
    const since = normalizeTimeBoundary(request.since)
    const until = normalizeTimeBoundary(request.until)
    if (since && until && since > until) {
      throw new Error('history search since must not be after until')
    }
    const limit = clampLimit(request.limit ?? 0)
    const status = this.status()
    const response: SearchResponse = {
      query,
      searchedAt: this.utcNow().toISOString(),
      status,
      results: [],
      factBoundary: FACT_BOUNDARY,
    }
    if (!status.available) return response
    const db = openReadOnly(this.path)
    try {
      const next = { ...request, since, until }
      try {
        response.results = searchFTS(db, query, next, limit)
      } catch {
        response.results = []
      }
      if (response.results.length === 0) {
        response.results = searchLike(db, query, next, limit)
      }
    } finally {
      db.close()
    }
    return response
  }
}

function openWritable(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS })
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

function openReadOnly(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS })
  try { db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`) } catch { /* read-only connection */ }
  return db
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(name) as { count: number } | undefined
  return Number(row?.count ?? 0) > 0
}

function countTable(db: DatabaseSync, name: string): number {
  if (!tableExists(db, name)) return 0
  const allowed = new Set(['sessions', 'messages', 'tool_calls', 'tool_results', 'memories'])
  if (!allowed.has(name)) throw new Error('unsafe sqlite table name')
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get() as { count: number } | undefined
  return Number(row?.count ?? 0)
}

function populateCounts(db: DatabaseSync, status: SessionIndexStatus): void {
  status.sessionCount = countTable(db, 'sessions')
  status.messageCount = countTable(db, 'messages')
  status.toolCallCount = countTable(db, 'tool_calls')
  status.memoryCount = countTable(db, 'memories')
  status.sources = []
  if (!tableExists(db, 'sessions')) return
  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source, COUNT(*) AS count
    FROM sessions
    GROUP BY COALESCE(NULLIF(source, ''), 'unknown')
    ORDER BY source
  `).all() as Array<{ source: string; count: number }>
  status.sources = rows.map((row) => ({ source: String(row.source), count: Number(row.count) }))
}

function upsertIndexedConversation(db: DatabaseSync, value: StoredConversation): RefreshResult {
  const result: RefreshResult = {
    indexedAt: '',
    indexPath: '',
    source: '',
    sessionCount: 0,
    messageCount: 0,
    toolCallCount: 0,
  }
  const sessionId = `milksu:${value.id}`
  const source = sessionSource(value)
  const project = projectName(value.workspacePath)
  const startedAt = timestampToRFC3339(value.createdAt)
  deleteIndexedConversation(db, value.id)
  db.prepare(`
    INSERT INTO sessions(
      id, title, project, project_path, started_at, ended_at, git_branch,
      version, message_count, jsonl_path, source
    ) VALUES (?, ?, ?, ?, ?, '', '', '', ?, '', ?)
  `).run(
    sessionId,
    fallback(value.title, 'MilkSU 会话'),
    project,
    value.workspacePath ?? '',
    startedAt,
    value.messages?.length ?? 0,
    source,
  )
  result.sessionCount += 1
  for (const message of value.messages ?? []) {
    const messageId = `milksu:${value.id}:${message.id}`
    const text = truncateIndexedText(redactSnippet(message.content ?? ''))
    const skill = message.toolName ?? ''
    db.prepare(`
      INSERT INTO messages(
        uuid, session_id, type, parent_uuid, timestamp, role, text,
        content_type, is_meta, visibility, model, is_sidechain, agent_id,
        input_tokens, output_tokens, cwd, skill, turn_duration_ms, source
      ) VALUES (?, ?, ?, '', ?, ?, ?, 'text/plain', 0, 'visible', ?, 0, '', NULL, NULL, ?, ?, ?, ?)
    `).run(
      messageId,
      sessionId,
      message.role,
      timestampToRFC3339(message.timestamp),
      message.role,
      text,
      value.modelId ?? '',
      value.workspacePath ?? '',
      skill,
      message.durationMs ?? null,
      source,
    )
    result.messageCount += 1
    if (!message.toolName) continue
    let toolId = `milksu:${value.id}:tool:${message.id}`
    if (String(message.toolCallId ?? '').trim()) {
      toolId = `milksu:${value.id}:tool:${message.toolCallId}`
    }
    let inputJson = '{}'
    if (String(message.approvalInput ?? '').trim()) {
      inputJson = JSON.stringify({
        approvalInput: truncateIndexedText(redactSnippet(message.approvalInput ?? '')),
      })
    }
    db.prepare(`
      INSERT OR REPLACE INTO tool_calls(
        id, message_uuid, session_id, name, presentation, input_json, file_path
      ) VALUES (?, ?, ?, ?, 'default', ?, '')
    `).run(toolId, messageId, sessionId, message.toolName, inputJson)
    result.toolCallCount += 1
    if (message.role === 'tool') {
      db.prepare(`
        INSERT OR REPLACE INTO tool_results(
          tool_use_id, message_uuid, session_id, content, file_path, is_error
        ) VALUES (?, ?, ?, ?, '', ?)
      `).run(toolId, messageId, sessionId, text, message.status === 'error' ? 1 : 0)
    }
  }
  return result
}

function deleteIndexedConversation(db: DatabaseSync, id: string): void {
  const sessionId = `milksu:${id}`
  db.prepare('DELETE FROM tool_results WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

function requestSource(request: SearchRequest): string {
  const source = String(request.source ?? '').trim()
  if (source) return source
  switch (String(request.module ?? '').trim().toLowerCase()) {
    case 'coding':
    case 'ctf':
      return 'milksu-coding'
    case 'cve':
    case 'vuln':
    case 'vulnerability':
      return 'milksu-cve'
    default:
      return ''
  }
}

function searchFTS(db: DatabaseSync, query: string, request: SearchRequest, limit: number): SearchResult[] {
  if (!tableExists(db, 'messages_fts')) throw new Error('messages_fts table is unavailable')
  const source = requestSource(request)
  const rows = db.prepare(`
    SELECT
      m.uuid,
      m.session_id,
      COALESCE(s.title, '') AS title,
      COALESCE(s.project, '') AS project,
      COALESCE(s.project_path, '') AS project_path,
      COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') AS source,
      COALESCE(m.role, '') AS role,
      COALESCE(m.model, '') AS model,
      COALESCE(m.cwd, '') AS cwd,
      COALESCE(m.skill, '') AS skill,
      COALESCE(m.timestamp, '') AS timestamp,
      COALESCE(m.text, '') AS text,
      bm25(messages_fts) AS score
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    LEFT JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH ?
      AND COALESCE(m.visibility, 'visible') != 'hidden'
      AND (? = '' OR COALESCE(s.project, '') LIKE ? OR COALESCE(s.project_path, '') LIKE ? OR COALESCE(m.cwd, '') LIKE ?)
      AND (? = '' OR COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') = ?)
      AND (? = '' OR COALESCE(m.timestamp, '') >= ?)
      AND (? = '' OR COALESCE(m.timestamp, '') <= ?)
    ORDER BY score ASC, COALESCE(m.timestamp, '') DESC
    LIMIT ?
  `).all(
    ftsPhrase(query),
    String(request.project ?? '').trim(),
    likeContains(request.project ?? ''),
    likeContains(request.project ?? ''),
    likeContains(request.project ?? ''),
    source,
    source,
    request.since ?? '',
    request.since ?? '',
    request.until ?? '',
    request.until ?? '',
    limit,
  ) as Array<Record<string, unknown>>
  return scanResults(rows, query)
}

function searchLike(db: DatabaseSync, query: string, request: SearchRequest, limit: number): SearchResult[] {
  const source = requestSource(request)
  const rows = db.prepare(`
    SELECT
      m.uuid,
      m.session_id,
      COALESCE(s.title, '') AS title,
      COALESCE(s.project, '') AS project,
      COALESCE(s.project_path, '') AS project_path,
      COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') AS source,
      COALESCE(m.role, '') AS role,
      COALESCE(m.model, '') AS model,
      COALESCE(m.cwd, '') AS cwd,
      COALESCE(m.skill, '') AS skill,
      COALESCE(m.timestamp, '') AS timestamp,
      COALESCE(m.text, '') AS text,
      0.0 AS score
    FROM messages m
    LEFT JOIN sessions s ON s.id = m.session_id
    WHERE COALESCE(m.text, '') LIKE ? ESCAPE '\\'
      AND COALESCE(m.visibility, 'visible') != 'hidden'
      AND (? = '' OR COALESCE(s.project, '') LIKE ? OR COALESCE(s.project_path, '') LIKE ? OR COALESCE(m.cwd, '') LIKE ?)
      AND (? = '' OR COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') = ?)
      AND (? = '' OR COALESCE(m.timestamp, '') >= ?)
      AND (? = '' OR COALESCE(m.timestamp, '') <= ?)
    ORDER BY COALESCE(m.timestamp, '') DESC
    LIMIT ?
  `).all(
    likeContains(query),
    String(request.project ?? '').trim(),
    likeContains(request.project ?? ''),
    likeContains(request.project ?? ''),
    likeContains(request.project ?? ''),
    source,
    source,
    request.since ?? '',
    request.since ?? '',
    request.until ?? '',
    request.until ?? '',
    limit,
  ) as Array<Record<string, unknown>>
  return scanResults(rows, query)
}

function scanResults(rows: Array<Record<string, unknown>>, query: string): SearchResult[] {
  const values: SearchResult[] = rows.map((row) => {
    const text = String(row.text ?? '')
    return {
      messageUuid: String(row.uuid ?? ''),
      sessionId: String(row.session_id ?? ''),
      sessionName: fallback(String(row.title ?? ''), String(row.session_id ?? '')),
      project: String(row.project ?? '') || undefined,
      projectPath: String(row.project_path ?? '') || undefined,
      source: String(row.source ?? '') || undefined,
      role: String(row.role ?? '') || undefined,
      model: String(row.model ?? '') || undefined,
      cwd: String(row.cwd ?? '') || undefined,
      skill: String(row.skill ?? '') || undefined,
      timestamp: String(row.timestamp ?? '') || undefined,
      snippet: redactSnippet(extractSnippet(text, query, 520)),
      score: Number(row.score ?? 0),
    }
  })
  values.sort((left, right) => {
    if ((left.score ?? 0) !== (right.score ?? 0)) return (left.score ?? 0) - (right.score ?? 0)
    return String(right.timestamp ?? '').localeCompare(String(left.timestamp ?? ''))
  })
  return values
}

function clampLimit(value: number): number {
  if (value <= 0) return 6
  if (value > 20) return 20
  return value
}

function ftsPhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`
}

function likeContains(query: string): string {
  let value = String(query ?? '')
  value = value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
  return `%${value}%`
}

function normalizeSpace(value: string): string {
  return String(value ?? '').trim().split(/\s+/u).filter(Boolean).join(' ')
}

function fallback(value: string, fallbackValue: string): string {
  return String(value ?? '').trim() ? value : fallbackValue
}

function extractSnippet(text: string, query: string, maxRunes: number): string {
  text = normalizeVisibleText(text)
  if (!text) return ''
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return trimRunes(text, maxRunes)
  const chars = [...text]
  let startIndex = [...text.slice(0, index)].length
  const queryLen = [...query].length
  const start = Math.max(0, startIndex - Math.floor(maxRunes / 3))
  const end = Math.min(chars.length, startIndex + queryLen + Math.floor(maxRunes * 2 / 3))
  let snippet = chars.slice(start, end).join('').trim()
  if (start > 0) snippet = `…${snippet}`
  if (end < chars.length) snippet += '…'
  return snippet
}

function normalizeVisibleText(value: string): string {
  value = value.replace(/[\n\r\t]/gu, ' ').replace(/[\u0000-\u001f\u007f]/gu, '')
  return normalizeSpace(value)
}

function trimRunes(value: string, limit: number): string {
  const runes = [...value]
  if (runes.length <= limit) return value
  return `${runes.slice(0, limit).join('').trim()}…`
}

function truncateIndexedText(value: string): string {
  return trimRunes(normalizeVisibleText(value), 20000)
}

function timestampToRFC3339(value: number): string {
  if (!value) return ''
  if (value > 100_000_000_000) return new Date(value).toISOString()
  return new Date(value * 1000).toISOString()
}

function projectName(workspacePath: string | undefined): string {
  if (!String(workspacePath ?? '').trim()) return 'MilkSU'
  const name = basename(workspacePath as string)
  if (!name.trim() || name === '.' || name === sep) return 'MilkSU'
  return name
}

function sessionSource(value: StoredConversation): string {
  if (CVE_ID_PATTERN.test(value.title ?? '')) return 'milksu-cve'
  for (const [index, message] of (value.messages ?? []).entries()) {
    if (index >= 8) break
    if (CVE_ID_PATTERN.test(message.content ?? '')) return 'milksu-cve'
  }
  return 'milksu-coding'
}

function normalizeTimeBoundary(value: string | undefined): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) throw new Error('invalid history search time')
  return new Date(parsed).toISOString()
}

const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; keepPrefix: boolean }> = [
  { pattern: /\bBearer\s+(?:\[credential redacted\]|[A-Za-z0-9._~+/=-]{10,})/gi, keepPrefix: false },
  { pattern: /\bsk-[A-Za-z0-9_-]{10,}\b/g, keepPrefix: false },
  { pattern: /\bsess-[A-Za-z0-9_-]{10,}\b/g, keepPrefix: false },
  { pattern: /\b(?:OPENAI|KIMI|MOONSHOT|ANTHROPIC|DEEPSEEK|GEMINI|DASHSCOPE|VOLCENGINE)?_?API_KEY\s*[:=]\s*["']?(?:\[credential redacted\]|[^\s"',;]+)/gi, keepPrefix: false },
  { pattern: /([?&](?:api_key|apikey|access_token|token|secret|key)=)(?:\[credential redacted\]|[^&#\s]+)/gi, keepPrefix: true },
  { pattern: /\b(x-api-key|api-key|authorization)\s*[:=]\s*["']?(?:\[credential redacted\]|[^\s"',;]+)/gi, keepPrefix: false },
]

const REPEATED_CREDENTIAL_MARKER = /\[credential redacted\](?:\s+redacted\]?)+/gi
const QUERY_CREDENTIAL_MARKER_SUFFIX = /((?:[?&](?:api_key|apikey|access_token|token|secret|key|x-api-key)=\[credential redacted\](?:[&#][^"'<>\]\s]*)?))(?:\s+redacted\])+/gi

export function redactSnippet(value: string): string {
  value = normalizeRedactedCredentialMarkers(value)
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0
    value = value.replace(pattern, (match, prefix?: string) => {
      if (match.includes('?') || match.includes('&')) {
        if (typeof prefix === 'string' && prefix) return `${prefix}[credential redacted]`
      }
      if (match.includes('=')) {
        const parts = match.split('=')
        return `${parts[0]!.trim()}=[credential redacted]`
      }
      if (match.includes(':') && !match.toLowerCase().startsWith('http')) {
        const parts = match.split(':')
        return `${parts[0]!.trim()}: [credential redacted]`
      }
      return '[credential redacted]'
    })
  }
  return normalizeRedactedCredentialMarkers(value)
}

function normalizeRedactedCredentialMarkers(value: string): string {
  for (;;) {
    const next = value
      .replace(REPEATED_CREDENTIAL_MARKER, '[credential redacted]')
      .replace(QUERY_CREDENTIAL_MARKER_SUFFIX, '$1')
    if (next === value) return next
    value = next
  }
}

export function sessionIndexBytes(path: string): number {
  try {
    const info = statSync(path)
    return info.isDirectory() ? 0 : info.size
  } catch {
    return 0
  }
}
