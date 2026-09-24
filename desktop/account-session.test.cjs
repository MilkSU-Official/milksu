'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { promises: fs } = require('node:fs')
const test = require('node:test')
const {
  AccountSession,
  accountCallbackForwardPlan,
  accountCallbackFromArgv,
  accountLoginClaimPath,
  accountIntentAuthorizationAction,
  accountModelAuthorizationAction,
  accountModelAuthorizationRefreshRequired,
  accountRedirectURL,
  desktopProtocolClientRegistration,
  loadAccountConfig,
  publicOAuthError,
  readAccountLoginClaim,
  routeAccountCallback,
  writeAccountLoginClaim,
} = require('./account-session.cjs')

test('preserves account model authorization during transient account status failures', () => {
  assert.equal(accountModelAuthorizationAction({ state: 'unavailable', authenticated: true }), 'preserve')
  assert.equal(accountModelAuthorizationAction({ state: 'authorizing', authenticated: false }), 'preserve')
  assert.equal(accountModelAuthorizationAction({
    state: 'active',
    provisional: true,
    tokenFluxLinked: true,
  }), 'preserve')
  assert.equal(accountModelAuthorizationAction({ state: 'active', tokenFluxLinked: true }), 'refresh')
  assert.equal(accountModelAuthorizationAction({ state: 'active', tokenFluxLinked: false }), 'clear')
  assert.equal(accountModelAuthorizationAction({ state: 'signed_out', authenticated: false }), 'clear')
  assert.equal(accountIntentAuthorizationAction({ state: 'active', tokenFluxLinked: false }), 'refresh')
  assert.equal(accountIntentAuthorizationAction({ provisional: true, state: 'active' }), 'preserve')
  assert.equal(accountIntentAuthorizationAction({ state: 'signed_out' }), 'clear')
})

test('refreshes account authorization only after a pre-Sidecar SendMessage rejection', () => {
  const unavailable = new Error(
    'tokenflux/grok-4.6 cannot start because both model sources are unavailable',
  )
  assert.equal(accountModelAuthorizationRefreshRequired('SendMessage', unavailable), true)
  assert.equal(accountModelAuthorizationRefreshRequired('GetSettings', unavailable), false)
  assert.equal(accountModelAuthorizationRefreshRequired('SendMessage', new Error('provider returned 401')), false)
})

test('rejects non-HTTPS account endpoints and reports an unconfigured client', async () => {
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'http://unsafe.example',
  } })
  assert.equal(config.configured, false)
  const session = new AccountSession({ config, userDataPath: os.tmpdir(), openExternal: async () => {} })
  assert.deepEqual(await session.status(), { configured: false, state: 'unconfigured', authenticated: false })
})

test('reads the Windows protocol callback from quoted process argv', () => {
  assert.equal(
    accountCallbackFromArgv([
      'C:\\electron.exe',
      'C:\\milksu\\desktop',
      '"milksu://auth/callback?code=one-time"',
    ], 'stable'),
    'milksu://auth/callback?code=one-time',
  )
  assert.equal(accountCallbackFromArgv(['electron', 'milksu-beta://auth/callback?code=x'], 'beta'), 'milksu-beta://auth/callback?code=x')
  assert.equal(accountCallbackFromArgv(['electron', 'milksu://auth/callback?code=x'], 'beta'), '')
})

test('registers unpackaged protocol clients with the Electron executable and app script', () => {
  const unpackaged = desktopProtocolClientRegistration({
    channel: 'stable',
    isPackaged: false,
    defaultApp: true,
    execPath: 'C:\\electron\\electron.exe',
    argv: ['C:\\electron\\electron.exe', 'C:\\milksu\\desktop'],
    platform: 'win32',
  })
  assert.deepEqual(unpackaged, {
    scheme: 'milksu',
    register: true,
    execPath: 'C:\\electron\\electron.exe',
    args: [path.resolve('C:\\milksu\\desktop')],
  })
  assert.deepEqual(desktopProtocolClientRegistration({
    channel: 'beta',
    isPackaged: true,
  }), { scheme: 'milksu-beta', register: true })
  assert.deepEqual(desktopProtocolClientRegistration({
    channel: 'stable',
    isPackaged: false,
    defaultApp: true,
    execPath: 'C:\\electron\\electron.exe',
    argv: ['C:\\electron\\electron.exe'],
    platform: 'win32',
  }), { scheme: 'milksu', register: false })
  assert.deepEqual(desktopProtocolClientRegistration({
    channel: 'stable',
    isPackaged: false,
    defaultApp: false,
    execPath: '/repo/node_modules/electron/dist/Electron',
    argv: ['/repo/node_modules/electron/dist/Electron', '/repo/desktop'],
    instanceId: 'plfu-1',
    platform: 'linux',
  }), {
    scheme: 'milksu',
    register: true,
    execPath: '/repo/node_modules/electron/dist/Electron',
    args: [path.resolve('/repo/desktop')],
  })
  assert.deepEqual(desktopProtocolClientRegistration({
    channel: 'stable',
    isPackaged: false,
    defaultApp: true,
    execPath: '/repo/node_modules/electron/dist/Electron',
    argv: ['/repo/node_modules/electron/dist/Electron', '/repo/desktop'],
    instanceId: 'plfu-1',
    platform: 'darwin',
  }), { scheme: 'milksu', register: false })
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
      json: async () => ({ account: { githubLogin: 'hunter', displayName: 'Hunter', avatarUrl: 'https://avatars.example/hunter', tokenFluxLinked: true } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, openExternal: async url => opened.push(url), fetchImpl })
  await session.startLogin()
  const authorize = new URL(opened[0])
  assert.equal(authorize.origin, 'https://account.example')
  assert.equal(authorize.pathname, '/auth/github/start')
  assert.equal(authorize.searchParams.get('return_to'), 'milksu://auth/callback')
  assert.ok(authorize.searchParams.get('code_challenge'))
  await session.handleCallback('milksu://auth/callback?code=authorization-code')
  const status = await session.status()
  assert.equal(status.state, 'active')
  assert.equal('accessToken' in status, false)
  assert.equal('refreshToken' in status, false)
  const exchangeBody = JSON.parse(requests[0].options.body)
  assert.equal(exchangeBody.code, 'authorization-code')
  assert.match(exchangeBody.codeVerifier, /^[A-Za-z0-9_-]{64}$/u)
  assert.doesNotMatch(JSON.stringify(status), /secret/)
  assert.equal(await session.activeAccessToken(), 'access-secret')
})

test('clears authorizing state when accounts redirects an OAuth error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-account-oauth-error-'))
  const opened = []
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  const session = new AccountSession({
    config,
    userDataPath: root,
    openExternal: async url => opened.push(url),
    fetchImpl: async () => {
      throw new Error('exchange must not run on oauth error callback')
    },
  })
  await session.startLogin()
  assert.equal((await session.status()).state, 'authorizing')
  await assert.rejects(
    () => session.handleCallback('milksu://auth/callback?error=github_oauth_bad_code'),
    /授权码已失效/,
  )
  assert.equal((await session.status()).state, 'signed_out')
  assert.equal(opened.length, 1)
})

test('defers GitHub avatar fetch so status() does not block startup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-avatar-'))
  await fs.writeFile(path.join(root, 'account-session.json'), JSON.stringify({
    accessToken: 'access-secret',
    expiresAt: Date.now() + 600_000,
  }), { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  let avatarRequests = 0
  let accountRequests = 0
  let avatarRelease
  const avatarGate = new Promise(resolve => { avatarRelease = resolve })
  const changed = []
  const fetchImpl = async url => {
    if (url === 'https://avatars.githubusercontent.com/u/42') {
      avatarRequests += 1
      await avatarGate
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png', 'content-length': '4' }),
        arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
      }
    }
    accountRequests += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({ account: {
        githubLogin: 'hunter',
        displayName: 'Hunter',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      } }),
    }
  }
  const session = new AccountSession({
    config,
    userDataPath: root,
    openExternal: async () => {},
    fetchImpl,
    onChanged: value => changed.push(value),
  })
  const first = await session.status()
  // Status returns before the avatar network completes.
  assert.equal(first.user.avatarUrl, '')
  assert.equal(first.state, 'active')
  assert.equal(avatarRequests, 1)
  assert.equal(accountRequests, 1)

  // Second call joins the short TTL cache — no second /v1/account hop.
  const second = await session.status()
  assert.equal(second.user.avatarUrl, '')
  assert.equal(accountRequests, 1)

  avatarRelease()
  await new Promise(resolve => setTimeout(resolve, 30))
  const filled = changed.find(value => value?.user?.avatarUrl?.startsWith('data:image/png;base64,'))
  assert.ok(filled, 'background avatar fill should emit account.changed')
  assert.match(filled.user.avatarUrl, /^data:image\/png;base64,/)
  assert.equal(avatarRequests, 1)

  // After fill, cached status includes the inline avatar.
  const third = await session.status()
  assert.equal(third.user.avatarUrl, filled.user.avatarUrl)
  assert.equal(accountRequests, 1)
})

test('bootstrapStatus returns provisional active without waiting on account API', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-bootstrap-'))
  await fs.writeFile(path.join(root, 'account-session.json'), JSON.stringify({
    accessToken: 'access-secret',
    expiresAt: Date.now() + 600_000,
  }), { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  let accountRequests = 0
  let releaseAccount
  const accountGate = new Promise(resolve => { releaseAccount = resolve })
  const changed = []
  const fetchImpl = async url => {
    if (String(url).endsWith('/v1/account')) {
      accountRequests += 1
      await accountGate
      return {
        ok: true,
        status: 200,
        json: async () => ({ account: {
          githubLogin: 'hunter',
          displayName: 'Hunter',
          avatarUrl: 'https://avatars.example/hunter',
          tokenFluxLinked: true,
        } }),
      }
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  const session = new AccountSession({
    config,
    userDataPath: root,
    openExternal: async () => {},
    fetchImpl,
    onChanged: value => changed.push(value),
  })
  const boot = await session.bootstrapStatus()
  assert.equal(boot.state, 'active')
  assert.equal(boot.provisional, true)
  assert.equal(boot.authenticated, true)
  // Bootstrap schedules network without onChanged (main publishes after paint).
  assert.equal(changed.length, 0)

  // Concurrent status() stays non-blocking on the provisional shell.
  const during = await session.status()
  assert.equal(during.provisional, true)
  assert.equal(during.state, 'active')

  releaseAccount()
  const settled = await session.statusSettled()
  assert.equal(settled.state, 'active')
  assert.equal(settled.provisional, undefined)
  assert.equal(settled.user.githubLogin, 'hunter')
  assert.equal(accountRequests, 1)
  // notify:false — settled does not auto-emit; main process emits after paint.
  assert.equal(changed.length, 0)

  const after = await session.status()
  assert.equal(after.user.githubLogin, 'hunter')
  assert.equal(accountRequests, 1)
})

test('bootstrapStatus without a session stays signed_out and does not hit the network', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-bootstrap-empty-'))
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  let accountRequests = 0
  const fetchImpl = async () => {
    accountRequests += 1
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const session = new AccountSession({ config, userDataPath: root, openExternal: async () => {}, fetchImpl })
  const boot = await session.bootstrapStatus()
  assert.deepEqual(boot, { configured: true, state: 'signed_out', authenticated: false })
  assert.equal(accountRequests, 0)
})

test('dedupes concurrent status and modelCredential network fetches', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-status-dedupe-'))
  await fs.writeFile(path.join(root, 'account-session.json'), JSON.stringify({
    accessToken: 'access-secret',
    expiresAt: Date.now() + 600_000,
  }), { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  let accountRequests = 0
  let credentialRequests = 0
  const fetchImpl = async url => {
    if (String(url).endsWith('/v1/account/model-credential')) {
      credentialRequests += 1
      await new Promise(resolve => setTimeout(resolve, 20))
      return {
        ok: true,
        status: 200,
        json: async () => ({ credential: {
          provider: 'tokenflux',
          baseUrl: 'https://tokenflux.dev/v1',
          apiKey: 'assigned-provider-secret',
          models: ['grok-4.6'],
        } }),
      }
    }
    accountRequests += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    return {
      ok: true,
      status: 200,
      json: async () => ({ account: {
        githubLogin: 'hunter',
        displayName: 'Hunter',
        avatarUrl: 'https://avatars.example/hunter',
        tokenFluxLinked: true,
      } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, openExternal: async () => {}, fetchImpl })
  const [a, b, c, d] = await Promise.all([
    session.status(),
    session.status(),
    session.modelCredential(),
    session.modelCredential(),
  ])
  assert.equal(a.state, 'active')
  assert.equal(b.state, 'active')
  assert.equal(c.apiKey, 'assigned-provider-secret')
  assert.equal(d.apiKey, 'assigned-provider-secret')
  assert.equal(accountRequests, 1)
  assert.equal(credentialRequests, 1)
})

test('retrieves the assigned TokenFlux credential only through the main-process account session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-model-credential-'))
  await fs.writeFile(path.join(root, 'account-session.json'), JSON.stringify({
    accessToken: 'account-session-secret',
    expiresAt: Date.now() + 600_000,
  }), { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, 'https://account.example/v1/account/model-credential')
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer account-session-secret')
    return {
      ok: true,
      status: 200,
      json: async () => ({ credential: {
        provider: 'tokenflux',
        baseUrl: 'https://tokenflux.dev/v1',
        apiKey: 'assigned-provider-secret',
        models: ['grok-4.5', 'grok-4.6'],
      } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, openExternal: async () => {}, fetchImpl })
  assert.deepEqual(await session.modelCredential(), {
    provider: 'tokenflux',
    baseUrl: 'https://tokenflux.dev/v1',
    apiKey: 'assigned-provider-secret',
    models: ['grok-4.5', 'grok-4.6'],
  })
})

test('retrieves the account decision credential only through the main-process account session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-decision-credential-'))
  await fs.writeFile(path.join(root, 'account-session.json'), JSON.stringify({
    accessToken: 'account-session-secret',
    expiresAt: Date.now() + 600_000,
  }), { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, 'https://account.example/v1/account/decision-credential')
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer account-session-secret')
    return {
      ok: true,
      status: 200,
      json: async () => ({ credential: {
        baseUrl: 'https://openrouter.ai/api/alpha',
        apiKey: 'account-issued-intent-key',
      } }),
    }
  }
  const session = new AccountSession({ config, userDataPath: root, openExternal: async () => {}, fetchImpl })
  assert.deepEqual(await session.decisionCredential(), {
    baseUrl: 'https://openrouter.ai/api/alpha',
    apiKey: 'account-issued-intent-key',
  })
})

test('stores the account session locally without reading the legacy Keychain payload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-account-local-'))
  const legacy = path.join(root, 'account-session.bin')
  await fs.writeFile(legacy, 'legacy-encrypted-payload', { mode: 0o600 })
  const config = await loadAccountConfig({ env: {
    MILKSU_ACCOUNT_API_URL: 'https://account.example',
  } })
  const session = new AccountSession({ config, userDataPath: root, openExternal: async () => {} })
  assert.equal(await session.readSession(), null)
  await assert.rejects(fs.stat(legacy), error => error?.code === 'ENOENT')

  const value = { accessToken: 'local-session', expiresAt: Date.now() + 600_000 }
  await session.writeSession(value)
  const saved = JSON.parse(await fs.readFile(path.join(root, 'account-session.json'), 'utf8'))
  assert.deepEqual(saved, value)
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(root, 'account-session.json'))).mode & 0o777, 0o600)
  }
})

test('oauth callback stays with the instance that started login', () => {
  assert.deepEqual(routeAccountCallback({
    hasPendingLogin: true,
    claim: { instanceId: 'other', pid: 42 },
    selfPid: 7,
  }), { action: 'accept' })
  assert.deepEqual(routeAccountCallback({
    hasPendingLogin: false,
    claim: { instanceId: 'loop-1', pid: 42 },
    selfPid: 7,
  }), { action: 'forward', instanceId: 'loop-1', pid: 42, execPath: '', script: '', appPath: '' })
  assert.deepEqual(routeAccountCallback({
    hasPendingLogin: false,
    claim: { instanceId: '', pid: 7 },
    selfPid: 7,
  }), { action: 'ignore' })
  assert.equal(routeAccountCallback({ hasPendingLogin: false, claim: null, selfPid: 7 }).action, 'ignore')
})

test('login claim records the instance and not an oauth code', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'milksu-login-claim-'))
  await writeAccountLoginClaim(dir, { instanceId: 'loop-1', pid: 42 })
  const raw = await fs.readFile(accountLoginClaimPath(dir), 'utf8')
  assert.doesNotMatch(raw, /code|token|verifier|secret/iu)
  assert.deepEqual(await readAccountLoginClaim(dir), {
    instanceId: 'loop-1',
    pid: 42,
    execPath: '',
    script: '',
    appPath: '',
  })
  await writeAccountLoginClaim(dir, {
    instanceId: 'loop-1',
    pid: 42,
    execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
    script: '/opt/milksu/desktop/main.cjs',
  })
  const recorded = await readAccountLoginClaim(dir)
  assert.equal(recorded.execPath, '/Applications/Electron.app/Contents/MacOS/Electron')
  assert.equal(recorded.script, '/opt/milksu/desktop/main.cjs')
  await writeAccountLoginClaim(dir, {
    instanceId: 'loop-1',
    pid: 42,
    execPath: 'relative/electron',
    script: 'https://evil.example/main.cjs',
  })
  const rejected = await readAccountLoginClaim(dir)
  assert.equal(rejected.execPath, '')
  assert.equal(rejected.script, '')
})

test('callback forward plan keeps the code out of the environment', () => {
  const callback = 'milksu://auth/callback?code=one-time'
  const plan = accountCallbackForwardPlan({
    execPath: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '/app/desktop/main.cjs'],
    instanceId: 'loop-1',
    callback,
  })
  assert.equal(plan.execPath, '/usr/bin/electron')
  assert.equal(plan.cwd, '')
  assert.equal(plan.envPatch.MILKSU_INSTANCE_ID, 'loop-1')
  assert.equal(Object.values(plan.envPatch).join(' ').includes('one-time'), false)
  assert.equal(plan.args.at(-1), callback)
  const daily = accountCallbackForwardPlan({
    execPath: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '/app/desktop/main.cjs'],
    instanceId: '',
    callback,
  })
  assert.equal(daily.envPatch.MILKSU_INSTANCE_ID, '')
  const dev = accountCallbackForwardPlan({
    execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
    argv: ['/Applications/Electron.app/Contents/MacOS/Electron'],
    appPath: '/opt/milksu/desktop',
    instanceId: 'loop-1',
    callback,
  })
  assert.equal(dev.cwd, '/opt/milksu/desktop')
  assert.equal(dev.args[0], '/opt/milksu/desktop')
  assert.equal(dev.args.at(-1), callback)
})

test('public oauth errors do not echo codes or callback urls', () => {
  assert.equal(publicOAuthError('GitHub 授权码已失效，请重新登录'), 'GitHub 授权码已失效，请重新登录')
  assert.equal(publicOAuthError('milksu://auth/callback?code=one-time'), '')
  assert.equal(publicOAuthError('exchange failed code=one-time'), '')
})
