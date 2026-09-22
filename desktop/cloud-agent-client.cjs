'use strict'

/**
 * Electron-main Connect-JSON client for MilkSU Cloud Agent.
 * Mirrors UpdateManager's getAuthorization pattern: Bearer stays in main,
 * renderer only sees method name + JSON bodies (never accessToken).
 */

const SERVICE = 'milksu.cloud.v1.CloudSessionService'

const ALLOWED_METHODS = Object.freeze([
  'ListSessions',
  'CreateSession',
  'GetSession',
  'DeleteSession',
  'SendTurn',
  'AbortTurn',
  'RespondApproval',
  'RespondAsk',
  'MigrateCopy',
  'MigrateFinalize',
  'UpsertCredential',
  'DeleteCredential',
])

function defaultCloudAgentBaseUrl(env = process.env) {
  const raw = String(env.MILKSU_CLOUD_AGENT_URL || 'https://agent.milksu.org').trim()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) {
      return 'https://agent.milksu.org'
    }
    return url.toString().replace(/\/$/u, '')
  } catch {
    return 'https://agent.milksu.org'
  }
}

class CloudAgentClient {
  constructor({
    baseUrl = defaultCloudAgentBaseUrl(),
    getAccessToken,
    fetchImpl = globalThis.fetch.bind(globalThis),
  } = {}) {
    if (typeof getAccessToken !== 'function') {
      throw new Error('CloudAgentClient requires getAccessToken')
    }
    this.baseUrl = String(baseUrl || '').replace(/\/$/u, '')
    this.getAccessToken = getAccessToken
    this.fetchImpl = fetchImpl
  }

  async call(method, body = {}) {
    const name = String(method || '').trim()
    if (!ALLOWED_METHODS.includes(name)) {
      throw new Error(`Cloud Agent method not allowed: ${name || '(empty)'}`)
    }
    const token = String(await this.getAccessToken() || '').trim()
    if (!token) {
      throw new Error('Cloud Agent requires a signed-in MilkSU account')
    }
    const response = await this.fetchImpl(`${this.baseUrl}/${SERVICE}/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body && typeof body === 'object' ? body : {}),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = typeof json?.message === 'string' && json.message.trim()
        ? json.message.trim()
        : `Cloud Agent ${name} failed (${response.status})`
      const error = new Error(message)
      error.status = response.status
      error.code = typeof json?.code === 'string' ? json.code : ''
      throw error
    }
    return json
  }

  /**
   * Server-stream Subscribe (application/connect+json envelopes).
   * onEvent receives decoded SessionEvent JSON objects until end-stream.
   */
  async subscribe(sessionId, { afterEventId = '', onEvent, signal } = {}) {
    const id = String(sessionId || '').trim()
    if (!id) throw new Error('session_id required')
    const token = String(await this.getAccessToken() || '').trim()
    if (!token) throw new Error('Cloud Agent requires a signed-in MilkSU account')
    const response = await this.fetchImpl(`${this.baseUrl}/${SERVICE}/Subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session_id: id,
        after_event_id: String(afterEventId || ''),
      }),
      signal,
    })
    if (!response.ok) {
      const json = await response.json().catch(() => ({}))
      const message = typeof json?.message === 'string' && json.message.trim()
        ? json.message.trim()
        : `Cloud Agent Subscribe failed (${response.status})`
      throw new Error(message)
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('Cloud Agent Subscribe response is not a stream')
    }
    const reader = response.body.getReader()
    let pending = Buffer.alloc(0)
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pending = Buffer.concat([pending, Buffer.from(value)])
      const { envelopes, rest } = decodeEnvelopes(pending)
      pending = rest
      for (const envelope of envelopes) {
        if (envelope.endStream) return
        if (typeof onEvent === 'function') onEvent(envelope.json)
      }
    }
  }
}

const FLAG_END_STREAM = 0x02

function decodeEnvelopes(buffer) {
  let offset = 0
  const envelopes = []
  while (offset + 5 <= buffer.length) {
    const flags = buffer.readUInt8(offset)
    const length = buffer.readUInt32BE(offset + 1)
    if (offset + 5 + length > buffer.length) break
    const slice = buffer.subarray(offset + 5, offset + 5 + length)
    offset += 5 + length
    let json = {}
    try {
      json = JSON.parse(slice.toString('utf8') || '{}')
    } catch {
      json = {}
    }
    envelopes.push({ flags, json, endStream: Boolean(flags & FLAG_END_STREAM) })
  }
  return { envelopes, rest: buffer.subarray(offset) }
}

module.exports = {
  ALLOWED_METHODS,
  CloudAgentClient,
  SERVICE,
  defaultCloudAgentBaseUrl,
  decodeEnvelopes,
  FLAG_END_STREAM,
}
