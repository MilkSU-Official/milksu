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

import { encryptCredentialSecret } from './credential-crypto'

// Re-export when Sandbox Durable Object is bound (CF Sandbox get-started).
export { Sandbox } from '@cloudflare/sandbox'

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

type SessionRow = {
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

type SessionEventRow = {
  id: string
  type: string
  turn_id: string
  timestamp_ms: number
  json_payload: string
}

/** Ephemeral until D1 binding is attached in milksu-admin deploy. */
const sessions = new Map<string, SessionRow>()

const FLAG_END_STREAM = 0x02
/** Workers wall budget for one Subscribe long-poll before EndStream + client resume. */
const SUBSCRIBE_WINDOW_MS = 25_000
const SUBSCRIBE_POLL_MS = 200

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

function enqueueEvent(row: SessionRow, type: string, turnId: string, payload: Json) {
  row.events.push({
    id: crypto.randomUUID(),
    type,
    turn_id: turnId,
    timestamp_ms: Date.now(),
    json_payload: JSON.stringify(payload ?? {}),
  })
  // Bound memory for long-lived stub sessions.
  if (row.events.length > 200) {
    row.events.splice(0, row.events.length - 200)
  }
  row.updated_at_ms = Date.now()
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

function enqueueStubTurn(row: SessionRow, turnId: string, userText: string) {
  const reply = userText.trim()
    ? '云沙箱尚未绑定：已收到你的消息，部署 Sandbox 后会在这里跑 Pi/DSH。 / Cloud sandbox is not bound yet; your message was accepted.'
    : '云沙箱尚未绑定。 / Cloud sandbox is not bound yet.'
  enqueueEvent(row, 'assistant.thinking_delta', turnId, {
    text: 'Preparing cloud turn…',
  })
  for (const part of chunkText(reply)) {
    enqueueEvent(row, 'assistant.delta', turnId, { text: part })
  }
  enqueueEvent(row, 'turn.settled', turnId, {
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
  enqueueEvent(row, 'assistant.settled', turnId, {})
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

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function assertAccount(env: Env, token: string): Promise<boolean> {
  const base = (env.ACCOUNT_API_URL || 'https://accounts.milksu.org').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/v1/account`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

function publicSession(row: SessionRow): Json {
  return {
    id: row.id,
    title: row.title,
    kernel: row.kernel,
    model: row.model,
    status: row.status,
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms,
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
    if (!token || !(await assertAccount(env, token))) {
      return unauthorized()
    }
    const tokenHash = await hashToken(token)

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
        const list = [...sessions.values()]
          .filter(row => row.owner_token_hash === tokenHash)
          .map(publicSession)
        return json({ sessions: list })
      }
      case 'CreateSession': {
        const now = Date.now()
        const row: SessionRow = {
          id: crypto.randomUUID(),
          title: String(body.title || ''),
          kernel: String(body.kernel || 'pi'),
          model: String(body.model || ''),
          status: 'ready',
          created_at_ms: now,
          updated_at_ms: now,
          transcript_json: '[]',
          owner_token_hash: tokenHash,
          events: [],
        }
        sessions.set(row.id, row)
        return json(publicSession(row))
      }
      case 'GetSession': {
        const id = String(body.session_id || '')
        const row = sessions.get(id)
        if (!row || row.owner_token_hash !== tokenHash) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        return json(publicSession(row))
      }
      case 'DeleteSession': {
        const id = String(body.session_id || '')
        const row = sessions.get(id)
        if (row && row.owner_token_hash === tokenHash) {
          sessions.delete(id)
        }
        return json({})
      }
      case 'SendTurn': {
        const sessionId = String(body.session_id || '').trim()
        const text = String(body.text || '')
        if (!sessionId) {
          return json({ code: 'invalid_argument', message: 'session_id required' }, 400)
        }
        const row = sessions.get(sessionId)
        if (!row || row.owner_token_hash !== tokenHash) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        const turnId = crypto.randomUUID()
        // Mature CF Sandbox path when Durable Object binding is present
        // (https://developers.cloudflare.com/sandbox/get-started/).
        if (env.Sandbox) {
          try {
            const { getSandbox } = await import('@cloudflare/sandbox')
            const sandbox = getSandbox(env.Sandbox, `sess-${sessionId}`)
            await sandbox.exec('true')
            row.status = 'running'
            row.updated_at_ms = Date.now()
            sessions.set(sessionId, row)
            enqueueEvent(row, 'assistant.delta', turnId, {
              text: 'Sandbox ready; Pi/DSH bridge not yet attached in this deploy.',
            })
            enqueueEvent(row, 'assistant.settled', turnId, {})
            row.status = 'ready'
            return json({ turn_id: turnId })
          } catch (error) {
            return json({
              code: 'unavailable',
              message: error instanceof Error ? error.message : 'Sandbox start failed',
            }, 503)
          }
        }
        // Stub path: accept the turn and emit chunked events so Subscribe /
        // desktop / mobile can exercise the Connect stream before Sandbox bind.
        row.status = 'running'
        enqueueStubTurn(row, turnId, text)
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        sessions.set(sessionId, row)
        return json({ turn_id: turnId })
      }
      case 'AbortTurn': {
        const sessionId = String(body.session_id || '').trim()
        const row = sessions.get(sessionId)
        if (!row || row.owner_token_hash !== tokenHash) {
          return json({ code: 'not_found', message: 'Session not found' }, 404)
        }
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        enqueueEvent(row, 'turn.aborted', '', {})
        return json({})
      }
      case 'Subscribe': {
        const sessionId = String(body.session_id || '').trim()
        const row = sessions.get(sessionId)
        if (!row || row.owner_token_hash !== tokenHash) {
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
                const live = sessions.get(sessionId)
                if (!live || live.owner_token_hash !== tokenHash) break
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
            const live = sessions.get(sessionId)
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
          title: 'Migrated',
          kernel: 'pi',
          model: '',
          status: 'migrating',
          created_at_ms: now,
          updated_at_ms: now,
          transcript_json: String(body.transcript_json || '[]'),
          owner_token_hash: tokenHash,
          events: [],
        }
        sessions.set(row.id, row)
        return json({
          target_session_id: row.id,
          ok: true,
          error: '',
        })
      }
      case 'MigrateFinalize': {
        const id = String(body.target_session_id || '')
        const row = sessions.get(id)
        if (!row || row.owner_token_hash !== tokenHash) {
          return json({ ok: false, error: 'target session not found' })
        }
        row.status = 'ready'
        row.updated_at_ms = Date.now()
        sessions.set(id, row)
        return json({ ok: true, error: '' })
      }
      case 'UpsertCredential': {
        const apiKey = String(body.api_key || '').trim()
        if (!apiKey) {
          return json({ code: 'invalid_argument', message: 'api_key required' }, 400)
        }
        const id = String(body.id || crypto.randomUUID())
        const label = String(body.label || '')
        const baseUrl = String(body.base_url || '')
        // Encrypt when CREDENTIAL_KEK is bound; never echo api_key back.
        if (!env.CREDENTIAL_KEK) {
          return json({
            code: 'failed_precondition',
            message: 'CREDENTIAL_KEK not bound; refuse to store cloud credentials',
          }, 503)
        }
        let sealed: { iv_b64: string; ciphertext_b64: string }
        try {
          sealed = await encryptCredentialSecret(env.CREDENTIAL_KEK, apiKey)
        } catch (error) {
          return json({
            code: 'internal',
            message: error instanceof Error ? error.message : 'encrypt failed',
          }, 500)
        }
        if (env.DB) {
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
            tokenHash,
            label,
            baseUrl,
            sealed.iv_b64,
            sealed.ciphertext_b64,
            now,
            now,
            tokenHash,
          ).run()
        }
        // Without D1 the ciphertext is discarded after this response — deploy
        // must bind DB before BYOK is durable. Still never return plaintext.
        return json({ id })
      }
      case 'DeleteCredential': {
        const id = String(body.id || '').trim()
        if (env.DB && id) {
          await env.DB.prepare(
            'DELETE FROM cloud_credentials WHERE id = ? AND owner_token_hash = ?',
          ).bind(id, tokenHash).run()
        }
        return json({})
      }
      default:
        return json({ code: 'unimplemented', message: `Method ${method}` }, 501)
    }
  },
}
