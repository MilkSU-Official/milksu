/**
 * MilkSU Cloud Agent Worker (Connect-oriented).
 *
 * Mature pattern: Cloudflare Workers fetch adapter + Connect router
 * (same shape as CF's Connect/gRPC-web Worker examples and community
 * Workers Connect servers). Sandbox orchestration follows @cloudflare/sandbox.
 *
 * Subscribe uses Connect enveloped application/connect+json
 * (https://connectrpc.com/docs/protocol/) with a short-lived long-poll window
 * and after_event_id resume — same reconnect shape as Connect-ES clients and
 * Cursor-style event streams, without inventing non-envelope keepalive frames.
 *
 * Full generated Connect stubs land when buf generate runs in CI; this
 * file is the hand-routed HTTP surface so the service is reviewable and
 * deployable without codegen on every laptop.
 */

import { accountOwnerFromPayload, type AccountOwner } from './account-owner.ts'
import { encryptCredentialSecret } from './credential-crypto.ts'
import {
  d1AppendEvent,
  d1DeleteSession,
  d1ListSessions,
  d1LoadSession,
  d1SaveSession,
  memoryDelete,
  memoryGet,
  memoryList,
  memorySet,
  type SessionEventRow,
  type SessionRow,
} from './session-store.ts'

// Sandbox Durable Object class is re-exported from ./index.ts (wrangler main)
// so unit/integration tests can import this module without resolving
// @cloudflare/sandbox.

export interface Env {
  DB?: D1Database
  WORKSPACES?: R2Bucket
  ACCOUNT_API_URL?: string
  /** Present after milksu-admin wires CF Sandbox Durable Object. */
  Sandbox?: DurableObjectNamespace
  /** AES key material for user-supplied cloud credentials (Secret). */
  CREDENTIAL_KEK?: string
}

type Json = Record<string, unknown>

const FLAG_END_STREAM = 0x02
/** Workers wall budget for one Subscribe long-poll before EndStream + client resume. */
const SUBSCRIBE_WINDOW_MS = 25_000
const SUBSCRIBE_POLL_MS = 200

async function loadSession(env: Env, id: string): Promise<SessionRow | undefined> {
  const cached = memoryGet(id)
  if (cached) return cached
  if (env.DB) {
    const row = await d1LoadSession(env.DB, id)
    if (row) {
      memorySet(row)
      return row
    }
  }
  return undefined
}

async function saveSession(env: Env, row: SessionRow): Promise<void> {
  memorySet(row)
  if (env.DB) await d1SaveSession(env.DB, row)
}

async function listOwnerSessions(env: Env, ownerKey: string): Promise<SessionRow[]> {
  if (env.DB) return d1ListSessions(env.DB, ownerKey)
  return memoryList(ownerKey)
}

async function removeSession(env: Env, id: string, ownerKey: string): Promise<void> {
  memoryDelete(id)
  if (env.DB) await d1DeleteSession(env.DB, id, ownerKey)
}

function encodeEnvelope(message: Json, flags = 0): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message ?? {}))
  const out = new Uint8Array(5 + payload.length)
  out[0] = flags & 0xff
  const view = new DataView(out.buffer)
  view.setUint32(1, payload.length, false)
  out.set(payload, 5)
  return out
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function enqueueEvent(
  env: Env,
  row: SessionRow,
  type: string,
  turnId: string,
  payload: Json,
): Promise<SessionEventRow> {
  const event: SessionEventRow = {
    id: crypto.randomUUID(),
    type,
    turn_id: turnId,
    timestamp_ms: Date.now(),
    json_payload: JSON.stringify(payload ?? {}),
  }
  row.events.push(event)
  if (row.events.length > 200) {
    row.events.splice(0, row.events.length - 200)
  }
  row.updated_at_ms = Date.now()
  memorySet(row)
  if (env.DB) {
    await d1AppendEvent(env.DB, row.id, event)
    await d1SaveSession(env.DB, row)
  }
  return event
}

function sessionEventWire(row: SessionRow, event: SessionEventRow): Json {
  return {
    id: event.id,
    type: event.type,
    session_id: row.id,
    turn_id: event.turn_id,
    timestamp_ms: event.timestamp_ms,
    json_payload: event.json_payload,
  }
}

function chunkText(text: string, size = 48): string[] {
  const trimmed = text.trim()
  if (!trimmed) return ['']
  const parts: string[] = []
  for (let i = 0; i < trimmed.length; i += size) {
    parts.push(trimmed.slice(i, i + size))
  }
  return parts
}

function publicSession(row: SessionRow, opts?: { includeTranscript?: boolean }): Json {
  const out: Json = {
    id: row.id,
    title: row.title,
    kernel: row.kernel,
    model: row.model,
    status: row.status,
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms,
  }
  if (opts?.includeTranscript) {
    out.transcript_json = row.transcript_json || '[]'
  }
  return out
}

type TranscriptLine = { role: string; content: string }

function readTranscript(row: SessionRow): TranscriptLine[] {
  try {
    const parsed = JSON.parse(row.transcript_json || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is TranscriptLine => (
        item
        && typeof item === 'object'
        && typeof (item as TranscriptLine).role === 'string'
        && typeof (item as TranscriptLine).content === 'string'
      ))
      .map(item => ({ role: item.role, content: item.content }))
  } catch {
    return []
  }
}

function appendTranscript(row: SessionRow, role: string, content: string): void {
  const lines = readTranscript(row)
  lines.push({ role, content })
  // Keep transcript bounded for memory / D1 row size.
  const capped = lines.length > 200 ? lines.slice(lines.length - 200) : lines
  row.transcript_json = JSON.stringify(capped)
  if (!row.title.trim() && role === 'user' && content.trim()) {
    row.title = content.trim().slice(0, 48)
  }
}

async function enqueueStubTurn(env: Env, row: SessionRow, turnId: string, userText: string) {
  const reply = userText.trim()
    ? (
      '已收到。当前 Worker 未绑定 Cloudflare Sandbox：协议与抄本已写入，'
      + '部署 Sandbox 后这里会跑钉版 Pi/DSH。 / '
      + 'Received. Cloudflare Sandbox is not bound yet; protocol and transcript are saved. '
      + 'Pi/DSH will run here after Sandbox deploy.'
    )
    : (
      '云沙箱尚未绑定。发一条消息可验证 Subscribe 与抄本落盘。 / '
      + 'Cloud sandbox is not bound yet. Send a message to verify Subscribe and transcript persistence.'
    )
  await enqueueEvent(env, row, 'assistant.thinking_delta', turnId, {
    text: 'Preparing cloud turn…',
  })
  for (const part of chunkText(reply)) {
    await enqueueEvent(env, row, 'assistant.delta', turnId, { text: part })
  }
  await enqueueEvent(env, row, 'turn.settled', turnId, {
    usage: {
      input_tokens: Math.max(1, Math.ceil(userText.length / 4)),
      output_tokens: Math.max(1, Math.ceil(reply.length / 4)),
      cache_read_tokens: 0,
      model_cost_est_usd: 0,
      sandbox_cost_est_usd: 0,
      sandbox_seconds: 0,
    },
    disclaimer: '根据 models.dev 估算，方便统计，不是账单',
  })
  await enqueueEvent(env, row, 'assistant.settled', turnId, {})
  appendTranscript(row, 'assistant', reply)
}

function json(data: Json, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'connect-protocol-version': '1',
    },
  })
}

function unauthorized(): Response {
  return json({ code: 'unauthenticated', message: 'Bearer session required' }, 401)
}

function bearer(request: Request): string | null {
  const raw = request.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return m ? m[1].trim() : null
}

/**
 * Resolve a stable account owner from /v1/account.
 * Ownership keys are derived from account.id / githubLogin — never from the
 * access token — so refresh does not orphan cloud sessions or BYOK rows.
 */
async function assertAccount(env: Env, token: string): Promise<AccountOwner | null> {
  const base = (env.ACCOUNT_API_URL || 'https://accounts.milksu.org').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/v1/account`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const payload = await res.json().catch(() => null)
    return accountOwnerFromPayload(payload)
  } catch {
    return null
  }
}

/**
 * Connect-JSON unary path: POST /milksu.cloud.v1.CloudSessionService/{Method}
 * with application/json and Connect-Protocol-Version: 1
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) {
      return json({ ok: true, service: 'milksu-cloud-agent' })
    }

    if (request.method !== 'POST') {
      return json({ code: 'unimplemented', message: 'Use Connect POST' }, 405)
    }

    const token = bearer(request)
    const owner = token ? await assertAccount(env, token) : null
    if (!owner) {
      return unauthorized()
    }
    // ownerKey is SHA-256(account subject); column name stays owner_token_hash.
    const ownerKey = owner.ownerKey

    const prefix = '/milksu.cloud.v1.CloudSessionService/'
    if (!url.pathname.startsWith(prefix)) {
      return json({ code: 'not_found', message: 'Unknown procedure' }, 404)
    }
    const method = url.pathname.slice(prefix.length)

    let body: Json = {}
    try {
      body = (await request.json()) as Json
    } catch {
      body = {}
    }

    switch (method) {
      case 'ListSessions': {
        const list = (await listOwnerSessions(env, ownerKey)).map(publicSession)
        return json({ sessions: list })
      }
      case 'CreateSession': {
        const now = Date.now()
        const title = String(body.title || '').trim()
        const row: SessionRow = {
          id: crypto.randomUUID(),
          title,
          kernel: String(body.kernel || 'pi'),
          model: String(body.model || ''),
          status: 'ready',
          created_at_ms: now,
          updated_at_ms: now,
          transcript_json: '[]',
          owner_token_hash: ownerKey,
          events: [],
        }
        await saveSession(env, row)
        return json(publicSession(row))
      }
      case 'GetSession': {
        const id = String(body.session_id || '')
        const row = await loadSession(env, id)
        if (!row || row.owner_token_hash !== ownerKey) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        return json(publicSession(row, { includeTranscript: true }))
      }
      case 'DeleteSession': {
        const id = String(body.session_id || '')
        const row = await loadSession(env, id)
        if (row && row.owner_token_hash === ownerKey) {
          await removeSession(env, id, ownerKey)
        }
        return json({})
      }
      case 'SendTurn': {
        const sessionId = String(body.session_id || '').trim()
        const text = String(body.text || '')
        if (!sessionId) {
          return json({ code: 'invalid_argument', message: 'session_id required' }, 400)
        }
        const row = await loadSession(env, sessionId)
        if (!row || row.owner_token_hash !== ownerKey) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        const turnId = crypto.randomUUID()
        if (text.trim()) {
          appendTranscript(row, 'user', text.trim())
        }
        // Mature CF Sandbox path when Durable Object binding is present
        // (https://developers.cloudflare.com/sandbox/get-started/ + exec stdin).
        if (env.Sandbox) {
          try {
            const { getSandbox, parseSSEStream } = await import('@cloudflare/sandbox')
            const sandbox = getSandbox(env.Sandbox, `sess-${sessionId}`)
            const kernel = row.kernel === 'dsh' ? 'dsh' : 'pi'
            const startedAt = Date.now()
            row.status = 'running'
            row.updated_at_ms = Date.now()
            await saveSession(env, row)
            await enqueueEvent(env, row, 'assistant.thinking_delta', turnId, {
              text: `Starting ${kernel} in sandbox…`,
            })
            const stream = await sandbox.execStream('node /workspace/milksu/turn-runner.mjs', {
              cwd: '/workspace/milksu',
              env: {
                MILKSU_CLOUD_KERNEL: kernel,
                MILKSU_CLOUD_KERNEL_ROOT: '/workspace/milksu/node_modules',
              },
              stdin: JSON.stringify({
                session_id: sessionId,
                turn_id: turnId,
                text,
                model: row.model,
              }),
              timeout: 120_000,
            })
            let assistantText = ''
            for await (const event of parseSSEStream(stream)) {
              if (event.type === 'stdout' && typeof event.data === 'string' && event.data) {
                assistantText += event.data
                await enqueueEvent(env, row, 'assistant.delta', turnId, { text: event.data })
              } else if (event.type === 'stderr' && typeof event.data === 'string' && event.data.trim()) {
                await enqueueEvent(env, row, 'assistant.delta', turnId, {
                  text: `[stderr] ${event.data}`,
                })
              } else if (event.type === 'error') {
                throw new Error(String(event.error || 'Sandbox exec failed'))
              }
            }
            if (!assistantText) {
              assistantText = 'Sandbox finished with empty stdout; Pi/DSH bridge not attached yet.'
              await enqueueEvent(env, row, 'assistant.delta', turnId, { text: assistantText })
            }
            const sandboxSeconds = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000))
            await enqueueEvent(env, row, 'turn.settled', turnId, {
              usage: {
                input_tokens: Math.max(1, Math.ceil(text.length / 4)),
                output_tokens: Math.max(1, Math.ceil(assistantText.length / 4)),
                cache_read_tokens: 0,
                model_cost_est_usd: 0,
                sandbox_cost_est_usd: 0,
                sandbox_seconds: sandboxSeconds,
              },
              disclaimer: '根据 models.dev 估算，方便统计，不是账单',
            })
            await enqueueEvent(env, row, 'assistant.settled', turnId, {})
            appendTranscript(row, 'assistant', assistantText)
            row.status = 'ready'
            await saveSession(env, row)
            return json({ turn_id: turnId })
          } catch (error) {
            row.status = 'ready'
            await saveSession(env, row)
            return json({
              code: 'unavailable',
              message: error instanceof Error ? error.message : 'Sandbox start failed',
            }, 503)
          }
        }
        // Stub path: accept the turn and emit chunked events so Subscribe /
        // desktop / mobile can exercise the Connect stream before Sandbox bind.
        row.status = 'running'
        await enqueueStubTurn(env, row, turnId, text)
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        await saveSession(env, row)
        return json({ turn_id: turnId })
      }
      case 'AbortTurn': {
        const sessionId = String(body.session_id || '').trim()
        const row = await loadSession(env, sessionId)
        if (!row || row.owner_token_hash !== ownerKey) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        await enqueueEvent(env, row, 'turn.aborted', '', {})
        await saveSession(env, row)
        return json({})
      }
      case 'Subscribe': {
        const sessionId = String(body.session_id || '').trim()
        const row = await loadSession(env, sessionId)
        if (!row || row.owner_token_hash !== ownerKey) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        let cursor = 0
        const after = String(body.after_event_id || '').trim()
        if (after) {
          const idx = row.events.findIndex(event => event.id === after)
          cursor = idx >= 0 ? idx + 1 : 0
        }
        const signal = request.signal
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encodeEnvelope({
              id: crypto.randomUUID(),
              type: 'session.snapshot',
              session_id: row.id,
              turn_id: '',
              timestamp_ms: Date.now(),
              json_payload: JSON.stringify(publicSession(row)),
            }))
            const started = Date.now()
            try {
              while (Date.now() - started < SUBSCRIBE_WINDOW_MS) {
                if (signal.aborted) break
                let live = memoryGet(sessionId)
                if (env.DB) {
                  const fresh = await d1LoadSession(env.DB, sessionId)
                  if (fresh) {
                    memorySet(fresh)
                    live = fresh
                  }
                }
                if (!live || live.owner_token_hash !== ownerKey) break
                while (cursor < live.events.length) {
                  const event = live.events[cursor]
                  cursor += 1
                  controller.enqueue(encodeEnvelope(sessionEventWire(live, event)))
                }
                await sleep(SUBSCRIBE_POLL_MS, signal)
              }
            } catch (error) {
              if (!(error instanceof DOMException && error.name === 'AbortError')) {
                controller.enqueue(encodeEnvelope({
                  error: {
                    code: 'internal',
                    message: error instanceof Error ? error.message : 'Subscribe failed',
                  },
                }, FLAG_END_STREAM))
                controller.close()
                return
              }
            }
            const live = memoryGet(sessionId) || await loadSession(env, sessionId)
            if (live) {
              while (cursor < live.events.length) {
                const event = live.events[cursor]
                cursor += 1
                controller.enqueue(encodeEnvelope(sessionEventWire(live, event)))
              }
            }
            controller.enqueue(encodeEnvelope({}, FLAG_END_STREAM))
            controller.close()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/connect+json',
            'connect-protocol-version': '1',
            'cache-control': 'no-cache',
          },
        })
      }
      case 'MigrateCopy': {
        const now = Date.now()
        const row: SessionRow = {
          id: crypto.randomUUID(),
          title: String(body.title || 'Migrated'),
          kernel: String(body.kernel || 'pi'),
          model: String(body.model || ''),
          status: 'migrating',
          created_at_ms: now,
          updated_at_ms: now,
          transcript_json: String(body.transcript_json || '[]'),
          owner_token_hash: ownerKey,
          events: [],
        }
        await saveSession(env, row)
        return json({
          target_session_id: row.id,
          ok: true,
          error: '',
        })
      }
      case 'MigrateFinalize': {
        const id = String(body.target_session_id || '')
        const row = await loadSession(env, id)
        if (!row || row.owner_token_hash !== ownerKey) {
          return json({ ok: false, error: 'target session not found' })
        }
        if (row.status !== 'migrating' && row.status !== 'ready') {
          return json({ ok: false, error: `cannot finalize status=${row.status}` })
        }
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        await saveSession(env, row)
        return json({ ok: true, error: '' })
      }
      case 'UpsertCredential': {
        const apiKey = String(body.api_key || '').trim()
        if (!apiKey) {
          return json({ code: 'invalid_argument', message: 'api_key required' }, 400)
        }
        // Durable BYOK requires both KEK and D1. Never return a fake success id
        // when ciphertext would be discarded.
        if (!env.CREDENTIAL_KEK) {
          return json({
            code: 'failed_precondition',
            message: 'CREDENTIAL_KEK not bound; refuse to store cloud credentials',
          }, 503)
        }
        if (!env.DB) {
          return json({
            code: 'failed_precondition',
            message: 'D1 not bound; refuse to store cloud credentials without durable storage',
          }, 503)
        }
        const id = String(body.id || crypto.randomUUID())
        const label = String(body.label || '')
        const baseUrl = String(body.base_url || '')
        let sealed: { iv_b64: string; ciphertext_b64: string }
        try {
          sealed = await encryptCredentialSecret(env.CREDENTIAL_KEK, apiKey)
        } catch (error) {
          return json({
            code: 'internal',
            message: error instanceof Error ? error.message : 'encrypt failed',
          }, 500)
        }
        const now = Date.now()
        await env.DB.prepare(
          `INSERT INTO cloud_credentials
            (id, owner_token_hash, label, base_url, iv_b64, ciphertext_b64, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label=excluded.label,
             base_url=excluded.base_url,
             iv_b64=excluded.iv_b64,
             ciphertext_b64=excluded.ciphertext_b64,
             updated_at_ms=excluded.updated_at_ms
           WHERE owner_token_hash=?`,
        ).bind(
          id,
          ownerKey,
          label,
          baseUrl,
          sealed.iv_b64,
          sealed.ciphertext_b64,
          now,
          now,
          ownerKey,
        ).run()
        return json({ id })
      }
      case 'DeleteCredential': {
        const id = String(body.id || '').trim()
        if (env.DB && id) {
          await env.DB.prepare(
            'DELETE FROM cloud_credentials WHERE id = ? AND owner_token_hash = ?',
          ).bind(id, ownerKey).run()
        }
        return json({})
      }
      default:
        return json({ code: 'unimplemented', message: `Method ${method}` }, 501)
    }
  },
}
