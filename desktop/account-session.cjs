'use strict'

const crypto = require('node:crypto')
const { promises: fs } = require('node:fs')
const path = require('node:path')

const MAX_AVATAR_BYTES = 1024 * 1024
const GITHUB_AVATAR_HOST = 'avatars.githubusercontent.com'

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

function cleanHTTPS(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.protocol === 'https:' ? url.toString().replace(/\/$/u, '') : ''
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

async function loadAccountConfig({ env = process.env, resourcesPath = '', isPackaged = false, channel = 'stable' } = {}) {
  const sealed = isPackaged && resourcesPath
    ? await readJSON(path.join(resourcesPath, 'account-config.json'))
    : {}
  const supabaseUrl = cleanHTTPS(env.MILKSU_SUPABASE_URL || sealed.supabaseUrl)
  const apiUrl = cleanHTTPS(env.MILKSU_ACCOUNT_API_URL || sealed.apiUrl)
  const anonKey = String(env.MILKSU_SUPABASE_ANON_KEY || sealed.supabaseAnonKey || '').trim()
  return {
    configured: Boolean(supabaseUrl && apiUrl && anonKey),
    supabaseUrl,
    apiUrl,
    anonKey,
    redirectUrl: accountRedirectURL(channel),
  }
}

class AccountSession {
  constructor({ config, userDataPath, safeStorage, openExternal, fetchImpl = fetch, onChanged = () => {} }) {
    this.config = config
    this.safeStorage = safeStorage
    this.openExternal = openExternal
    this.fetch = fetchImpl
    this.onChanged = onChanged
    this.sessionPath = path.join(userDataPath, 'account-session.bin')
    this.pending = null
    this.avatarCache = new Map()
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

  async readSession() {
    if (!this.safeStorage.isEncryptionAvailable()) return null
    try {
      const encrypted = await fs.readFile(this.sessionPath)
      const value = JSON.parse(this.safeStorage.decryptString(encrypted))
      return value?.accessToken && value?.refreshToken ? value : null
    } catch {
      return null
    }
  }

  async writeSession(session) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
    const encrypted = this.safeStorage.encryptString(JSON.stringify(session))
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true })
    await fs.writeFile(this.sessionPath, encrypted, { mode: 0o600 })
    await fs.chmod(this.sessionPath, 0o600)
  }

  async refreshSession(session) {
    const response = await this.fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.config.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    })
    if (!response.ok) {
      await fs.unlink(this.sessionPath).catch(() => {})
      return null
    }
    const token = await response.json()
    const next = {
      accessToken: String(token.access_token ?? ''),
      refreshToken: String(token.refresh_token ?? session.refreshToken),
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    }
    if (!next.accessToken || !next.refreshToken) return null
    await this.writeSession(next)
    return next
  }

  async activeSession() {
    const session = await this.readSession()
    if (!session) return null
    return Number(session.expiresAt) > Date.now() + 60_000 ? session : this.refreshSession(session)
  }

  async status() {
    if (!this.config.configured) return { configured: false, state: 'unconfigured', authenticated: false }
    const session = await this.activeSession()
    if (!session) return { configured: true, state: this.pending ? 'authorizing' : 'signed_out', authenticated: false }
    const response = await this.fetch(`${this.config.apiUrl}/v1/account`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 403) {
      return {
        configured: true,
        authenticated: true,
        state: payload.error === 'access_suspended' ? 'suspended' : 'invitation_required',
      }
    }
    if (!response.ok || !payload.account) return { configured: true, authenticated: true, state: 'unavailable' }
    const avatarUrl = await this.avatarDataURL(payload.account.avatarUrl)
    return {
      configured: true,
      authenticated: true,
      state: 'active',
      user: {
        githubLogin: String(payload.account.githubLogin ?? ''),
        displayName: String(payload.account.displayName ?? payload.account.githubLogin ?? ''),
        avatarUrl,
      },
      balanceCents: Number(payload.account.balanceCents ?? 0),
      tokenFluxLinked: payload.account.tokenFluxLinked === true,
    }
  }

  async startLogin() {
    if (!this.config.configured) throw new Error('内测账户尚未配置')
    const verifier = base64url(crypto.randomBytes(48))
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
    const state = base64url(crypto.randomBytes(24))
    const redirect = new URL(this.config.redirectUrl)
    redirect.searchParams.set('state', state)
    const authorize = new URL(`${this.config.supabaseUrl}/auth/v1/authorize`)
    authorize.searchParams.set('provider', 'github')
    authorize.searchParams.set('redirect_to', redirect.toString())
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 's256')
    this.pending = { state, verifier }
    await this.openExternal(authorize.toString())
    return this.status()
  }

  async handleCallback(rawURL) {
    if (!this.pending) return false
    let url
    try { url = new URL(rawURL) } catch { return false }
    const expected = new URL(this.config.redirectUrl)
    if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.pathname !== expected.pathname) return false
    if (url.searchParams.get('state') !== this.pending.state) throw new Error('登录回调校验失败')
    const code = String(url.searchParams.get('code') ?? '')
    if (!code) throw new Error('登录回调缺少授权码')
    const pending = this.pending
    this.pending = null
    const response = await this.fetch(`${this.config.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: { apikey: this.config.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ auth_code: code, code_verifier: pending.verifier }),
    })
    if (!response.ok) throw new Error('GitHub 登录失败')
    const token = await response.json()
    const session = {
      accessToken: String(token.access_token ?? ''),
      refreshToken: String(token.refresh_token ?? ''),
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
    }
    if (!session.accessToken || !session.refreshToken) throw new Error('登录响应不完整')
    await this.writeSession(session)
    this.onChanged(await this.status())
    return true
  }

  async logout() {
    this.pending = null
    await fs.unlink(this.sessionPath).catch(() => {})
    const next = await this.status()
    this.onChanged(next)
    return next
  }
}

module.exports = { AccountSession, accountRedirectURL, loadAccountConfig }
