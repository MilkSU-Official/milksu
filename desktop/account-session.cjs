'use strict'

const crypto = require('node:crypto')
const { promises: fs } = require('node:fs')
const path = require('node:path')

const MAX_AVATAR_BYTES = 1024 * 1024
const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com'
const TOKENFLUX_BASE_URL = 'https://tokenflux.dev/v1'
// Startup often calls status()/modelCredential() twice (main pre-load + renderer).
// Short TTL + in-flight dedupe avoids a second network round-trip without stale login UX.
const STATUS_CACHE_TTL_MS = 15_000
const CREDENTIAL_CACHE_TTL_MS = 15_000

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function cleanHTTPS(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.toString().replace(/\/$/u, '')
      : ''
  } catch {
    return ''
  }
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return {}
  }
}

function accountRedirectURL(channel = 'stable') {
  return channel === 'beta'
    ? 'milksu-beta://auth/callback'
    : 'milksu://auth/callback'
}

function accountModelAuthorizationAction(status) {
  if (status?.state === 'active' && status?.tokenFluxLinked === true) return 'refresh'
  if (status?.state === 'unavailable' || status?.state === 'authorizing') return 'preserve'
  return 'clear'
}

function accountModelAuthorizationRefreshRequired(method, error) {
  return method === 'SendMessage'
    && /both model sources are unavailable/i.test(String(error?.message ?? error ?? ''))
}

async function loadAccountConfig({ env = process.env, resourcesPath = '', isPackaged = false, channel = 'stable' } = {}) {
  const sealed = isPackaged && resourcesPath
    ? await readJSON(path.join(resourcesPath, 'account-config.json'))
    : {}
  const apiUrl = cleanHTTPS(env.MILKSU_ACCOUNT_API_URL || sealed.apiUrl)
  return {
    configured: Boolean(apiUrl),
    apiUrl,
    redirectUrl: accountRedirectURL(channel),
  }
}

class AccountSession {
  constructor({ config, userDataPath, openExternal, fetchImpl = fetch, onChanged = () => {} }) {
    this.config = config
    this.openExternal = openExternal
    this.fetch = fetchImpl
    this.onChanged = onChanged
    this.sessionPath = path.join(userDataPath, 'account-session.json')
    this.legacySessionPath = path.join(userDataPath, 'account-session.bin')
    this.pending = null
    this.avatarCache = new Map()
    this.sessionLoaded = false
    this.sessionValue = null
    this.statusCache = null
    this.statusInflight = null
    this.credentialCache = null
    this.credentialInflight = null
    this.avatarFillInflight = new Map()
  }

  clearNetworkCaches() {
    this.statusCache = null
    this.statusInflight = null
    this.credentialCache = null
    this.credentialInflight = null
  }

  cachedAvatarDataURL(rawURL) {
    let url
    try { url = new URL(String(rawURL ?? '')) } catch { return '' }
    if (url.protocol !== 'https:' || url.hostname !== GITHUB_AVATAR_HOST) return ''
    return this.avatarCache.get(url.href) || ''
  }

  async avatarDataURL(rawURL) {
    let url
    try { url = new URL(String(rawURL ?? '')) } catch { return '' }
    if (url.protocol !== 'https:' || url.hostname !== GITHUB_AVATAR_HOST) return ''
    if (this.avatarCache.has(url.href)) return this.avatarCache.get(url.href)
    const response = await this.fetch(url.href, { redirect: 'error' }).catch(() => null)
    const contentType = String(response?.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!response?.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return ''
    const declaredLength = Number(response.headers?.get?.('content-length') ?? 0)
    if (declaredLength > MAX_AVATAR_BYTES) return ''
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) return ''
    const value = `data:${contentType};base64,${bytes.toString('base64')}`
    this.avatarCache.set(url.href, value)
    return value
  }

  // Do not block status()/startup on GitHub avatar bytes. Emit account.changed when ready.
  scheduleAvatarFill(remoteURL, baseStatus) {
    const remote = String(remoteURL ?? '')
    if (!remote || baseStatus?.state !== 'active') return
    if (this.cachedAvatarDataURL(remote)) return
    if (this.avatarFillInflight.has(remote)) return
    const work = this.avatarDataURL(remote)
      .then(avatarUrl => {
        if (!avatarUrl) return
        const login = String(baseStatus?.user?.githubLogin ?? '')
        const cached = this.statusCache?.value
        if (
          cached?.state === 'active'
          && String(cached?.user?.githubLogin ?? '') === login
        ) {
          const next = {
            ...cached,
            user: {
              ...cached.user,
              avatarUrl,
            },
          }
          this.statusCache = { value: next, at: Date.now() }
          this.onChanged(next)
          return
        }
        this.onChanged({
          ...baseStatus,
          user: {
            ...baseStatus.user,
            avatarUrl,
          },
        })
      })
      .catch(() => {})
      .finally(() => {
        this.avatarFillInflight.delete(remote)
      })
    this.avatarFillInflight.set(remote, work)
  }

  async readSession() {
    if (this.sessionLoaded) return this.sessionValue
    try {
      // Never decrypt the pre-release safeStorage payload. On some macOS
      // setups that prompts for the login Keychain again after every rebuild.
      await fs.unlink(this.legacySessionPath).catch(() => {})
      const value = JSON.parse(await fs.readFile(this.sessionPath, 'utf8'))
      this.sessionValue = value?.accessToken && Number(value?.expiresAt) > 0 ? value : null
    } catch {
      this.sessionValue = null
    }
    this.sessionLoaded = true
    return this.sessionValue
  }

  async writeSession(session) {
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true })
    const temporary = `${this.sessionPath}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(session)}\n`, { mode: 0o600 })
    await fs.rename(temporary, this.sessionPath)
    await fs.chmod(this.sessionPath, 0o600)
    this.sessionValue = session
    this.sessionLoaded = true
    this.clearNetworkCaches()
  }

  async activeSession() {
    const session = await this.readSession()
    if (!session) return null
    if (Number(session.expiresAt) > Date.now() + 60_000) return session
    await fs.unlink(this.sessionPath).catch(() => {})
    this.sessionValue = null
    this.sessionLoaded = true
    this.clearNetworkCaches()
    return null
  }

  rememberStatus(value) {
    this.statusCache = { value, at: Date.now() }
    return value
  }

  async status() {
    if (this.statusCache && Date.now() - this.statusCache.at < STATUS_CACHE_TTL_MS) {
      console.info(`[startup] account.status cache-hit age=${Date.now() - this.statusCache.at}ms state=${this.statusCache.value?.state ?? 'unknown'}`)
      return this.statusCache.value
    }
    if (this.statusInflight) {
      console.info('[startup] account.status join-inflight')
      return this.statusInflight
    }
    this.statusInflight = this.loadStatus()
      .then(value => this.rememberStatus(value))
      .finally(() => {
        this.statusInflight = null
      })
    return this.statusInflight
  }

  async loadStatus() {
    const started = Date.now()
    if (!this.config.configured) {
      console.info(`[startup] account.status skip unconfigured ${Date.now() - started}ms`)
      return { configured: false, state: 'unconfigured', authenticated: false }
    }
    const session = await this.activeSession()
    if (!session) {
      const state = this.pending ? 'authorizing' : 'signed_out'
      console.info(`[startup] account.status local-only state=${state} ${Date.now() - started}ms`)
      return { configured: true, state, authenticated: false }
    }
    const networkStarted = Date.now()
    const response = await this.fetch(`${this.config.apiUrl}/v1/account`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    }).catch(() => null)
    const networkMs = Date.now() - networkStarted
    if (!response) {
      console.info(`[startup] account.status network-fail ${networkMs}ms total=${Date.now() - started}ms`)
      return { configured: true, authenticated: true, state: 'unavailable' }
    }
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401) {
      await fs.unlink(this.sessionPath).catch(() => {})
      this.sessionValue = null
      this.sessionLoaded = true
      this.clearNetworkCaches()
      console.info(`[startup] account.status 401 network=${networkMs}ms total=${Date.now() - started}ms`)
      return { configured: true, authenticated: false, state: 'signed_out' }
    }
    if (response.status === 403) {
      const state = payload.error === 'access_suspended' ? 'suspended' : 'invitation_required'
      console.info(`[startup] account.status 403 state=${state} network=${networkMs}ms total=${Date.now() - started}ms`)
      return {
        configured: true,
        authenticated: true,
        state,
      }
    }
    if (!response.ok || !payload.account) {
      console.info(`[startup] account.status http=${response.status} network=${networkMs}ms total=${Date.now() - started}ms`)
      return { configured: true, authenticated: true, state: 'unavailable' }
    }
    const remoteAvatar = String(payload.account.avatarUrl ?? '')
    // Prefer an already-downloaded data URL; never await network for the avatar here.
    const avatarUrl = this.cachedAvatarDataURL(remoteAvatar)
    const result = {
      configured: true,
      authenticated: true,
      state: 'active',
      user: {
        githubLogin: String(payload.account.githubLogin ?? ''),
        displayName: String(payload.account.displayName ?? payload.account.githubLogin ?? ''),
        avatarUrl,
      },
      tokenFluxLinked: payload.account.tokenFluxLinked === true,
    }
    console.info(
      `[startup] account.status active network=${networkMs}ms avatar=${avatarUrl ? 'cache' : 'deferred'} total=${Date.now() - started}ms tokenFlux=${result.tokenFluxLinked}`,
    )
    this.scheduleAvatarFill(remoteAvatar, result)
    return result
  }

  async modelCredential() {
    if (this.credentialCache && Date.now() - this.credentialCache.at < CREDENTIAL_CACHE_TTL_MS) {
      console.info(`[startup] account.modelCredential cache-hit age=${Date.now() - this.credentialCache.at}ms`)
      return this.credentialCache.value
    }
    if (this.credentialInflight) {
      console.info('[startup] account.modelCredential join-inflight')
      return this.credentialInflight
    }
    this.credentialInflight = this.loadModelCredential()
      .then(value => {
        this.credentialCache = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        this.credentialInflight = null
      })
    return this.credentialInflight
  }

  async loadModelCredential() {
    const started = Date.now()
    if (!this.config.configured) {
      console.info(`[startup] account.modelCredential skip unconfigured ${Date.now() - started}ms`)
      return null
    }
    const session = await this.activeSession()
    if (!session) {
      console.info(`[startup] account.modelCredential no-session ${Date.now() - started}ms`)
      return null
    }
    const networkStarted = Date.now()
    const response = await this.fetch(`${this.config.apiUrl}/v1/account/model-credential`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    const networkMs = Date.now() - networkStarted
    if (response.status === 404) {
      console.info(`[startup] account.modelCredential 404 network=${networkMs}ms total=${Date.now() - started}ms`)
      return null
    }
    if (!response.ok) {
      console.info(`[startup] account.modelCredential fail http=${response.status} network=${networkMs}ms total=${Date.now() - started}ms`)
      throw new Error('账户模型凭据同步失败')
    }
    const payload = await response.json().catch(() => ({}))
    const credential = payload?.credential
    const apiKey = String(credential?.apiKey ?? '').trim()
    const baseUrl = String(credential?.baseUrl ?? '').replace(/\/+$/u, '')
    if (credential?.provider !== 'tokenflux' || baseUrl !== TOKENFLUX_BASE_URL || !apiKey) {
      console.info(`[startup] account.modelCredential invalid network=${networkMs}ms total=${Date.now() - started}ms`)
      throw new Error('账户模型凭据无效')
    }
    console.info(`[startup] account.modelCredential ok network=${networkMs}ms total=${Date.now() - started}ms`)
    return {
      provider: 'tokenflux',
      baseUrl,
      apiKey,
      models: Array.isArray(credential.models)
        ? credential.models.map(value => String(value).trim()).filter(Boolean)
        : [],
    }
  }

  async activeAccessToken() {
    const status = await this.status()
    if (status.state !== 'active') return ''
    const session = await this.activeSession()
    return String(session?.accessToken ?? '')
  }

  async startLogin() {
    if (!this.config.configured) throw new Error('内测账户尚未配置')
    const verifier = base64url(crypto.randomBytes(48))
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
    const authorize = new URL(`${this.config.apiUrl}/auth/github/start`)
    authorize.searchParams.set('return_to', this.config.redirectUrl)
    authorize.searchParams.set('code_challenge', challenge)
    this.pending = { verifier }
    await this.openExternal(authorize.toString())
    return this.status()
  }

  async handleCallback(rawURL) {
    if (!this.pending) return false
    let url
    try { url = new URL(rawURL) } catch { return false }
    const expected = new URL(this.config.redirectUrl)
    if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.pathname !== expected.pathname) return false
    const code = String(url.searchParams.get('code') ?? '')
    if (!code) throw new Error('登录回调缺少授权码')
    const response = await this.fetch(`${this.config.apiUrl}/v1/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: this.pending.verifier }),
    })
    if (!response.ok) throw new Error('GitHub 登录失败')
    const token = await response.json()
    const session = {
      accessToken: String(token.accessToken ?? ''),
      expiresAt: Date.parse(String(token.expiresAt ?? '')),
    }
    if (!session.accessToken || !Number.isFinite(session.expiresAt)) throw new Error('登录响应不完整')
    await this.writeSession(session)
    this.pending = null
    this.onChanged(await this.status())
    return true
  }

  async logout() {
    this.pending = null
    const session = await this.readSession()
    if (session?.accessToken && this.config.configured) {
      await this.fetch(`${this.config.apiUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.accessToken}` },
      }).catch(() => null)
    }
    await fs.unlink(this.sessionPath).catch(() => {})
    this.sessionValue = null
    this.sessionLoaded = true
    this.clearNetworkCaches()
    const next = await this.status()
    this.onChanged(next)
    return next
  }
}

module.exports = {
  AccountSession,
  accountModelAuthorizationAction,
  accountModelAuthorizationRefreshRequired,
  accountRedirectURL,
  loadAccountConfig,
}
