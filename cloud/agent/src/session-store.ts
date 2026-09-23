/**
 * Session persistence: in-memory Map until D1 is bound, then D1-backed.
 * Shape mirrors Workers + D1 examples — no second store inventing.
 */

export type SessionEventRow = {
  id: string
  type: string
  turn_id: string
  timestamp_ms: number
  json_payload: string
}

export type SessionRow = {
  id: string
  title: string
  kernel: string
  model: string
  status: string
  created_at_ms: number
  updated_at_ms: number
  transcript_json: string
  owner_token_hash: string
  events: SessionEventRow[]
}

const memory = new Map<string, SessionRow>()

export function memoryGet(id: string): SessionRow | undefined {
  return memory.get(id)
}

export function memorySet(row: SessionRow): void {
  memory.set(row.id, row)
}

export function memoryDelete(id: string): void {
  memory.delete(id)
}

/** Test helper: drop in-memory sessions between integration cases. */
export function memoryClear(): void {
  memory.clear()
}

export function memoryList(ownerTokenHash: string): SessionRow[] {
  return [...memory.values()].filter(row => row.owner_token_hash === ownerTokenHash)
}

export async function d1LoadSession(db: D1Database, id: string): Promise<SessionRow | null> {
  const row = await db.prepare(
    `SELECT id, owner_token_hash, title, kernel, model, status, transcript_json,
            created_at_ms, updated_at_ms
     FROM cloud_sessions WHERE id = ?`,
  ).bind(id).first<{
    id: string
    owner_token_hash: string
    title: string
    kernel: string
    model: string
    status: string
    transcript_json: string
    created_at_ms: number
    updated_at_ms: number
  }>()
  if (!row) return null
  const eventsResult = await db.prepare(
    `SELECT id, type, turn_id, timestamp_ms, json_payload
     FROM cloud_session_events WHERE session_id = ?
     ORDER BY timestamp_ms ASC LIMIT 200`,
  ).bind(id).all<SessionEventRow>()
  return {
    ...row,
    events: eventsResult.results ?? [],
  }
}

export async function d1SaveSession(db: D1Database, row: SessionRow): Promise<void> {
  await db.prepare(
    `INSERT INTO cloud_sessions
      (id, owner_token_hash, title, kernel, model, status, transcript_json, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title,
       kernel=excluded.kernel,
       model=excluded.model,
       status=excluded.status,
       transcript_json=excluded.transcript_json,
       updated_at_ms=excluded.updated_at_ms`,
  ).bind(
    row.id,
    row.owner_token_hash,
    row.title,
    row.kernel,
    row.model,
    row.status,
    row.transcript_json,
    row.created_at_ms,
    row.updated_at_ms,
  ).run()
}

export async function d1AppendEvent(db: D1Database, sessionId: string, event: SessionEventRow): Promise<void> {
  await db.prepare(
    `INSERT INTO cloud_session_events
      (id, session_id, type, turn_id, timestamp_ms, json_payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    sessionId,
    event.type,
    event.turn_id,
    event.timestamp_ms,
    event.json_payload,
  ).run()
}

export async function d1ListSessions(db: D1Database, ownerTokenHash: string): Promise<SessionRow[]> {
  const result = await db.prepare(
    `SELECT id, owner_token_hash, title, kernel, model, status, transcript_json,
            created_at_ms, updated_at_ms
     FROM cloud_sessions
     WHERE owner_token_hash = ?
     ORDER BY updated_at_ms DESC
     LIMIT 100`,
  ).bind(ownerTokenHash).all<{
    id: string
    owner_token_hash: string
    title: string
    kernel: string
    model: string
    status: string
    transcript_json: string
    created_at_ms: number
    updated_at_ms: number
  }>()
  return (result.results ?? []).map(row => ({ ...row, events: [] }))
}

export async function d1DeleteSession(db: D1Database, id: string, ownerTokenHash: string): Promise<void> {
  await db.prepare(
    'DELETE FROM cloud_sessions WHERE id = ? AND owner_token_hash = ?',
  ).bind(id, ownerTokenHash).run()
}
