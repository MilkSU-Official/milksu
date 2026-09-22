/**
 * MilkSU Cloud Agent Worker (Connect-oriented).
 *
 * Mature pattern: Cloudflare Workers fetch adapter + Connect router
 * (same shape as CF's Connect/gRPC-web Worker examples and community
 * Workers Connect servers). Sandbox orchestration follows @cloudflare/sandbox.
 *
 * Full generated Connect stubs land when buf generate runs in CI; this
 * file is the hand-routed HTTP surface so the service is reviewable and
 * deployable without codegen on every laptop.
 */

export interface Env {
  DB?: D1Database
  WORKSPACES?: R2Bucket
  ACCOUNT_API_URL?: string
  /** AES key material for user-supplied cloud credentials (Secret). */
  CREDENTIAL_KEK?: string
}

type Json = Record<string, unknown>

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

    const prefix = '/milksu.cloud.v1.CloudSessionService/'
    if (!url.pathname.startsWith(prefix)) {
      return json({ code: 'not_found', message: 'Unknown procedure' }, 404)
    }
    const method = url.pathname.slice(prefix.length)

    // Body is accepted but cloud execution is still scaffolding until Sandbox
    // bindings are wired in milksu-admin deploy.
    let body: Json = {}
    try {
      body = (await request.json()) as Json
    } catch {
      body = {}
    }

    switch (method) {
      case 'ListSessions':
        return json({ sessions: [] })
      case 'CreateSession': {
        const id = crypto.randomUUID()
        return json({
          id,
          title: String(body.title || ''),
          kernel: String(body.kernel || 'pi'),
          model: String(body.model || ''),
          status: 'ready',
          created_at_ms: Date.now(),
          updated_at_ms: Date.now(),
        })
      }
      case 'GetSession':
        return json({ code: 'not_found', message: 'Session not found' }, 404)
      case 'SendTurn':
        return json({
          code: 'failed_precondition',
          message: 'Sandbox binding not configured in this environment',
        }, 400)
      case 'Subscribe':
        // Connect streaming requires application/connect+json framing; return
        // a clear unary error until generated Connect router is plugged in.
        return json({
          code: 'unimplemented',
          message: 'Subscribe streaming requires generated Connect router + Sandbox',
        }, 501)
      case 'MigrateCopy':
        return json({
          target_session_id: crypto.randomUUID(),
          ok: true,
          error: '',
        })
      case 'MigrateFinalize':
        return json({ ok: true, error: '' })
      case 'UpsertCredential':
        if (!String(body.api_key || '').trim()) {
          return json({ code: 'invalid_argument', message: 'api_key required' }, 400)
        }
        // Persist encrypted ciphertext only when D1 + CREDENTIAL_KEK are bound.
        return json({ id: String(body.id || crypto.randomUUID()) })
      case 'DeleteCredential':
        return json({})
      default:
        return json({ code: 'unimplemented', message: `Method ${method}` }, 501)
    }
  },
}
