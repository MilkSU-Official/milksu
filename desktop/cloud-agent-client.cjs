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
}

module.exports = {
  ALLOWED_METHODS,
  CloudAgentClient,
  SERVICE,
  defaultCloudAgentBaseUrl,
}
