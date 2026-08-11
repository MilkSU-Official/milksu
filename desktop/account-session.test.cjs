'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { promises: fs } = require('node:fs')
const test = require('node:test')
const { AccountSession, accountRedirectURL, loadAccountConfig } = require('./account-session.cjs')

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: value => Buffer.from(value).toString('utf8'),
}

test('rejects non-HTTPS account endpoints and reports an unconfigured client', async () => {
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'http://unsafe.example',
  } })
  assert.equal(config.configured, false)
  const session = new AccountSession({ config, userDataPath: os.tmpdir(), safeStorage, openExternal: async () => {} })
  assert.deepEqual(await session.status(), { configured: false, state: 'unconfigured', authenticated: false })
})

test('keeps Stable and Beta OAuth callbacks on separate protocol handlers', async () => {
  assert.equal(accountRedirectURL('stable'), 'milksu://auth/callback')
  assert.equal(accountRedirectURL('beta'), 'milksu-beta://auth/callback')
  const config = await loadAccountConfig({
    channel: 'beta',
    env: {
      MILKSU_ACCOUNT_API_URL: 'https://account.example.test',
    },
  })
  assert.equal(config.redirectUrl, 'milksu-beta://auth/callback')
})

test('uses system-browser PKCE and returns no credential material to the renderer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-account-'))
  const opened = []
  const requests = []
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/v1/auth/exchange')) return {
      ok: true,
      json: async () => ({ accessToken: 'access-secret', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ account: { githubLogin: 'hunter', displayName: 'Hunter', avatarUrl: 'https://avatars.example/hunter', balanceCents: 1860, tokenFluxLinked: true } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, safeStorage, openExternal: async url => opened.push(url), fetchImpl })
  await session.startLogin()
  const authorize = new URL(opened[0])
  assert.equal(authorize.origin, 'https://account.example')
  assert.equal(authorize.pathname, '/auth/github/start')
  assert.equal(authorize.searchParams.get('return_to'), 'milksu://auth/callback')
  assert.ok(authorize.searchParams.get('code_challenge'))
  await session.handleCallback('milksu://auth/callback?code=authorization-code')
  const status = await session.status()
  assert.equal(status.state, 'active')
  assert.equal(status.balanceCents, 1860)
  assert.equal('accessToken' in status, false)
  assert.equal('refreshToken' in status, false)
  const exchangeBody = JSON.parse(requests[0].options.body)
  assert.equal(exchangeBody.code, 'authorization-code')
  assert.match(exchangeBody.codeVerifier, /^[A-Za-z0-9_-]{64}$/u)
  assert.doesNotMatch(JSON.stringify(status), /secret/)
})

test('projects only a bounded GitHub avatar as an inline image for the renderer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-avatar-'))
  await fs.writeFile(path.join(root, 'account-session.bin'), Buffer.from(JSON.stringify({
    accessToken: 'access-secret',
    expiresAt: Date.now() + 600_000,
  })))
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  let avatarRequests = 0
  const fetchImpl = async url => {
    if (url === 'https://avatars.githubusercontent.com/u/42') {
      avatarRequests += 1
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png', 'content-length': '4' }),
        arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ account: {
        githubLogin: 'hunter',
        displayName: 'Hunter',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        balanceCents: 500,
      } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, safeStorage, openExternal: async () => {}, fetchImpl })
  const first = await session.status()
  const second = await session.status()
  assert.match(first.user.avatarUrl, /^data:image\/png;base64,/)
  assert.equal(second.user.avatarUrl, first.user.avatarUrl)
  assert.equal(avatarRequests, 1)
})
