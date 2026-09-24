'use strict'

const crypto = require('node:crypto')
const { promises: fs, readFileSync, writeFileSync, renameSync } = require('node:fs')
const path = require('node:path')

const MAX_AVATAR_BYTES = 1024 * 1024
const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com'
const TOKENFLUX_BASE_URL = 'https://tokenflux.dev/v1'
const DECISION_BASE_URL = 'https://openrouter.ai/api/alpha'
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

function stripArgQuotes(value) {
  return String(value ?? '').trim().replace(/^"+|"+$/gu, '')
}

function accountCallbackFromArgv(argv = [], channel = 'stable') {
  const expected = accountRedirectURL(channel)
  for (const raw of argv) {
    const value = stripArgQuotes(raw)
    if (value.toLowerCase().startsWith(expected.toLowerCase())) return value
  }
  return ''
}

function firstProtocolClientScript(argv = [], execPath = '') {
  const resolvedExec = execPath ? path.resolve(execPath) : ''
  return argv.find((value, index) => {
    if (index === 0) return false
    const text = stripArgQuotes(value)
    if (!text || text.startsWith('-') || /:\/\//u.test(text)) return false
    return !resolvedExec || path.resolve(text) !== resolvedExec
  }) || ''
}

// Unpackaged Electron must pass execPath + the app script, otherwise Windows
// registers a bare electron.exe handler and the GitHub callback never returns.
function desktopProtocolClientRegistration({
  channel = 'stable',
  isPackaged = false,
  defaultApp = false,
  execPath = '',
  argv = [],
  instanceId = '',
  platform = '',
} = {}) {
  const scheme = new URL(accountRedirectURL(channel)).protocol.replace(/:$/u, '')
  if (isPackaged) return { scheme, register: true }
  // Launch Services binds milksu:// to the bundle id. Unpackaged Electron is
  // always com.github.electron, so the callback opens some other checkout's
  // Electron.app and shows its default page.
  if ((platform || process.platform) === 'darwin') return { scheme, register: false }
  const isolated = /^[A-Za-z0-9_.-]{1,64}$/u.test(String(instanceId ?? '').trim())
  if ((!defaultApp && !isolated) || !execPath) return { scheme, register: false }
  const script = firstProtocolClientScript(argv, execPath)
  if (!script) return { scheme, register: false }
  return { scheme, register: true, execPath, args: [path.resolve(script)] }
}

function accountIntentAuthorizationAction(status) {
  if (status?.provisional) return 'preserve'
  if (status?.state === 'active') return 'refresh'
  if (status?.state === 'unavailable' || status?.state === 'authorizing') return 'preserve'
  return 'clear'
}

function accountModelAuthorizationAction(status) {
  // Local bootstrap marks a provisional active session before /v1/account returns.
  // Keep any previously persisted account relay until the network status confirms.
  if (status?.provisional) return 'preserve'
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

function desktopOAuthErrorMessage(code) {
  switch (String(code || '')) {
    case 'github_oauth_rate_limited':
      return 'GitHub 暂时限制了登录请求，请稍后再试'
    case 'github_oauth_bad_code':
      return 'GitHub 授权码已失效，请重新登录'
    case 'github_oauth_misconfigured':
      return '账户登录配置异常，请联系维护者'
    case 'github_identity_failed':
      return '无法读取 GitHub 身份，请稍后重试'
    case 'access_denied':
    case 'github_oauth_denied':
      return '已取消 GitHub 登录'
    default:
      return 'GitHub 登录失败'
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
    this.decisionCache = null
    this.decisionInflight = null
    this.avatarFillInflight = new Map()
  }

  clearNetworkCaches() {
    this.statusCache = null
    this.statusInflight = null
    this.credentialCache = null
    this.credentialInflight = null
    this.decisionCache = null
    this.decisionInflight = null
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

  // Local-only gate for first paint: never waits on account API / avatar / credentials.
  // When a session file is still valid, return provisional active and refresh in background.
  async bootstrapStatus() {
    const started = Date.now()
    if (!this.config.configured) {
      const value = { configured: false, state: 'unconfigured', authenticated: false }
      console.info(`[startup] account.bootstrap unconfigured ${Date.now() - started}ms`)
      return this.rememberStatus(value)
    }
    const session = await this.activeSession()
    if (!session) {
      const state = this.pending ? 'authorizing' : 'signed_out'
      const value = { configured: true, state, authenticated: false }
      console.info(`[startup] account.bootstrap local-only state=${state} ${Date.now() - started}ms`)
      return this.rememberStatus(value)
    }
    const provisional = {
      configured: true,
      authenticated: true,
      state: 'active',
      provisional: true,
      // Optimistic: refresh path is gated by accountModelAuthorizationAction(provisional)=preserve
      // until the network status confirms tokenFluxLinked.
      tokenFluxLinked: true,
      user: {
        githubLogin: '',
        displayName: '',
        avatarUrl: '',
      },
    }
    this.rememberStatus(provisional)
    // Refresh without onChanged here: main emits after first paint so the
    // renderer has listeners (avoids a silent pre-mount account.changed).
    this.ensureStatusRefresh({ notify: false })
    console.info(`[startup] account.bootstrap provisional-active ${Date.now() - started}ms`)
    return provisional
  }

  ensureStatusRefresh({ notify = false } = {}) {
    if (this.statusInflight) return this.statusInflight
    this.statusInflight = this.loadStatus()
      .then(value => {
        const remembered = this.rememberStatus(value)
        if (notify) this.onChanged(remembered)
        return remembered
      })
      .finally(() => {
        this.statusInflight = null
      })
    return this.statusInflight
  }

  async status() {
    const cached = this.statusCache
    const cacheAge = cached ? Date.now() - cached.at : Infinity
    // Confirmed (non-provisional) status is safe to reuse for the short startup window.
    if (cached && !cached.value?.provisional && cacheAge < STATUS_CACHE_TTL_MS) {
      console.info(`[startup] account.status cache-hit age=${cacheAge}ms state=${cached.value?.state ?? 'unknown'}`)
      return cached.value
    }
    // While the network refresh is in flight, keep returning the provisional shell
    // so the renderer is not blocked on /v1/account.
    if (cached?.value?.provisional && this.statusInflight) {
      console.info('[startup] account.status provisional-while-refresh')
      return cached.value
    }
    if (this.statusInflight) {
      console.info('[startup] account.status join-inflight')
      return this.statusInflight
    }
    return this.ensureStatusRefresh({ notify: false })
  }

  // Wait for any in-flight network status (used after first paint).
  async statusSettled() {
    if (this.statusInflight) return this.statusInflight
    return this.status()
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
        displayName: String(payload.account.displayName ?? payload.account.username ?? payload.account.githubLogin ?? ''),
        avatarUrl,
        username: String(payload.account.username ?? ''),
      },
      hasPassword: payload.account.hasPassword === true,
      mustChangePassword: payload.account.mustChangePassword === true,
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

  async decisionCredential() {
    if (this.decisionCache && Date.now() - this.decisionCache.at < CREDENTIAL_CACHE_TTL_MS) {
      return this.decisionCache.value
    }
    if (this.decisionInflight) return this.decisionInflight
    this.decisionInflight = this.loadDecisionCredential()
      .then(value => {
        this.decisionCache = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        this.decisionInflight = null
      })
    return this.decisionInflight
  }

  async loadDecisionCredential() {
    if (!this.config.configured) return null
    const session = await this.activeSession()
    if (!session) return null
    const response = await this.fetch(`${this.config.apiUrl}/v1/account/decision-credential`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error('账户决策凭据同步失败')
    const payload = await response.json().catch(() => ({}))
    const credential = payload?.credential
    const apiKey = String(credential?.apiKey ?? '').trim()
    const baseUrl = String(credential?.baseUrl ?? '').replace(/\/+$/u, '')
    if (baseUrl !== DECISION_BASE_URL || !apiKey) throw new Error('账户决策凭据无效')
    return { baseUrl, apiKey }
  }

  hasPendingLogin() {
    return Boolean(this.pending)
  }

  async activeAccessToken() {
    const status = await this.status()
    if (status.state !== 'active') return ''
    const session = await this.activeSession()
    return String(session?.accessToken ?? '')
  }

  async passwordRequest(path, body) {
    const session = path === '/v1/auth/password' ? null : await this.activeSession()
    const headers = { 'content-type': 'application/json' }
    if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`
    const response = await this.fetch(`${this.config.apiUrl}${path}`, {
      method: path.endsWith('/password') && body.currentPassword ? 'PATCH' : 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(`account_password:${payload.error || 'invalid_credentials'}`)
      throw error
    }
    return payload
  }

  async startPasswordLogin(username, password) {
    if (!this.config.configured) throw new Error('内测账户尚未配置')
    const payload = await this.passwordRequest('/v1/auth/password', { username, password })
    const session = {
      accessToken: String(payload.accessToken ?? ''),
      expiresAt: Date.parse(String(payload.expiresAt ?? '')),
    }
    if (!session.accessToken || !Number.isFinite(session.expiresAt)) {
      throw new Error('account_password:invalid_credentials')
    }
    await this.writeSession(session)
    this.pending = null
    const status = await this.loadStatus()
    this.rememberStatus(status)
    this.onChanged(status)
    return status
  }

  async changeAccountPassword(currentPassword, newPassword) {
    await this.passwordRequest('/v1/account/password', { currentPassword, newPassword })
    this.clearNetworkCaches()
    const status = await this.loadStatus()
    this.rememberStatus(status)
    this.onChanged(status)
    return status
  }

  async setAccountPassword(username, password) {
    await this.passwordRequest('/v1/account/password', { username, password })
    this.clearNetworkCaches()
    const status = await this.loadStatus()
    this.rememberStatus(status)
    this.onChanged(status)
    return status
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
    const oauthError = String(url.searchParams.get('error') ?? '').trim()
    if (oauthError) {
      this.pending = null
      this.clearNetworkCaches()
      this.onChanged(await this.status())
      throw new Error(desktopOAuthErrorMessage(oauthError))
    }
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

function accountLoginClaimPath(directory) {
  return path.join(String(directory ?? ''), 'milksu-pending-account-login.json')
}

function accountCallbackHandoffPath(directory, pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return ''
  return path.join(String(directory ?? ''), `milksu-account-callback-${id}`)
}

function writeAccountCallbackHandoff(directory, pid, callback) {
  const file = accountCallbackHandoffPath(directory, pid)
  const text = String(callback ?? '').trim()
  if (!file || !text || text.length > 2048) return false
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, file)
  return true
}

function readAccountCallbackHandoff(directory, pid) {
  const file = accountCallbackHandoffPath(directory, pid)
  if (!file) return ''
  try {
    const text = readFileSync(file, 'utf8').trim()
    fs.unlink(file).catch(() => {})
    return text
  } catch {
    return ''
  }
}

function safeClaimPath(value) {
  const text = String(value ?? '').trim()
  if (!text || text.length > 512 || text.includes('\0') || /[\r\n]/u.test(text)) return ''
  if (!path.isAbsolute(text) || text.includes('://')) return ''
  return text
}

function routeAccountCallback({ hasPendingLogin = false, claim = null, selfPid = 0 } = {}) {
  if (hasPendingLogin) return { action: 'accept' }
  const pid = Number(claim?.pid)
  if (Number.isInteger(pid) && pid > 0 && pid !== selfPid) {
    return {
      action: 'forward',
      instanceId: String(claim.instanceId ?? ''),
      pid,
      execPath: safeClaimPath(claim.execPath),
      script: safeClaimPath(claim.script),
      appPath: safeClaimPath(claim.appPath),
    }
  }
  return { action: 'ignore' }
}

function accountCallbackForwardPlan({
  execPath = '',
  argv = [],
  appPath = '',
  instanceId = '',
  callback = '',
} = {}) {
  const resolvedExec = safeClaimPath(execPath)
  const script = firstProtocolClientScript(argv, resolvedExec || execPath)
  const resolvedApp = safeClaimPath(appPath)
  const args = []
  if (script) args.push(script)
  else if (resolvedApp) args.push(resolvedApp)
  if (callback) args.push(callback)
  const id = String(instanceId ?? '').trim()
  const envPatch = {
    MILKSU_INSTANCE_ID: /^[A-Za-z0-9_.-]{1,64}$/u.test(id) ? id : '',
  }
  return { execPath: resolvedExec, args, cwd: script ? '' : resolvedApp, envPatch }
}

function publicOAuthError(message) {
  const text = String(message ?? '').trim()
  if (!text || /:\/\//u.test(text) || /(?:code|token|verifier)=/iu.test(text) || text.length > 180) {
    return ''
  }
  return text
}

async function writeAccountLoginClaim(directory, {
  instanceId = '',
  pid = process.pid,
  execPath = '',
  script = '',
  appPath = '',
} = {}) {
  const file = accountLoginClaimPath(directory)
  const body = JSON.stringify({
    instanceId: String(instanceId ?? ''),
    pid: Number(pid),
    execPath: safeClaimPath(execPath),
    script: safeClaimPath(script),
    appPath: safeClaimPath(appPath),
    at: Date.now(),
  })
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, body, { mode: 0o600 })
  await fs.rename(temporary, file)
}

function accountLoginClaimFromJSON(raw) {
  const parsed = JSON.parse(raw)
  const pid = Number(parsed?.pid)
  if (!Number.isInteger(pid) || pid <= 0) return null
  return {
    instanceId: String(parsed.instanceId ?? ''),
    pid,
    execPath: safeClaimPath(parsed.execPath),
    script: safeClaimPath(parsed.script),
    appPath: safeClaimPath(parsed.appPath),
  }
}

function readAccountLoginClaimSync(directory) {
  try {
    return accountLoginClaimFromJSON(readFileSync(accountLoginClaimPath(directory), 'utf8'))
  } catch {
    return null
  }
}

async function readAccountLoginClaim(directory) {
  try {
    return accountLoginClaimFromJSON(await fs.readFile(accountLoginClaimPath(directory), 'utf8'))
  } catch {
    return null
  }
}

async function clearAccountLoginClaim(directory, pid) {
  const current = await readAccountLoginClaim(directory)
  if (!current || current.pid !== Number(pid)) return
  await fs.unlink(accountLoginClaimPath(directory)).catch(() => {})
}

module.exports = {
  AccountSession,
  accountCallbackFromArgv,
  accountIntentAuthorizationAction,
  accountModelAuthorizationAction,
  accountModelAuthorizationRefreshRequired,
  accountRedirectURL,
  accountCallbackForwardPlan,
  accountCallbackHandoffPath,
  readAccountCallbackHandoff,
  writeAccountCallbackHandoff,
  firstProtocolClientScript,
  accountLoginClaimPath,
  clearAccountLoginClaim,
  desktopProtocolClientRegistration,
  loadAccountConfig,
  publicOAuthError,
  readAccountLoginClaim,
  readAccountLoginClaimSync,
  routeAccountCallback,
  writeAccountLoginClaim,
}
