'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  STABLE_APP_ID,
  BETA_APP_ID,
  STABLE_PRODUCT_NAME,
  BETA_PRODUCT_NAME,
  STABLE_USER_DATA_DIR_NAME,
  BETA_USER_DATA_DIR_NAME,
  RUNTIME_DATA_SEGMENT,
  normalizeDesktopChannel,
  resolveDesktopChannel,
  channelIdentity,
  planChannelIsolation,
  applyChannelIsolation,
  browserProfileRoots,
  allowedProfilePath,
  resolveRuntimeAppDataDir,
} = require('./channel-identity.cjs')

test('channel constants match the stable/beta contract', () => {
  assert.equal(STABLE_APP_ID, 'com.milksu.app')
  assert.equal(BETA_APP_ID, 'com.milksu.app.beta')
  assert.equal(STABLE_PRODUCT_NAME, 'MilkSU')
  assert.equal(BETA_PRODUCT_NAME, 'MilkSU Beta')
  assert.equal(STABLE_USER_DATA_DIR_NAME, STABLE_APP_ID)
  assert.equal(BETA_USER_DATA_DIR_NAME, BETA_APP_ID)
  assert.notEqual(STABLE_APP_ID, BETA_APP_ID)
  assert.notEqual(STABLE_PRODUCT_NAME, BETA_PRODUCT_NAME)
})

test('resolveDesktopChannel prefers env, then app name, then desktop app id', () => {
  assert.equal(normalizeDesktopChannel('BETA'), 'beta')
  assert.equal(normalizeDesktopChannel('nope'), '')
  assert.equal(resolveDesktopChannel({ env: { MILKSU_CHANNEL: 'beta' } }), 'beta')
  assert.equal(resolveDesktopChannel({
    env: {},
    appName: 'MilkSU Beta',
  }), 'beta')
  assert.equal(resolveDesktopChannel({
    env: { MILKSU_DESKTOP_APP_ID: BETA_APP_ID },
  }), 'beta')
  assert.equal(resolveDesktopChannel({
    env: { MILKSU_DESKTOP_APP_ID: STABLE_APP_ID },
  }), 'stable')
  assert.equal(resolveDesktopChannel({ env: {} }), 'stable')
})

test('channelIdentity returns distinct product and userData names', () => {
  const stable = channelIdentity('stable')
  const beta = channelIdentity('beta')
  assert.deepEqual(stable, {
    channel: 'stable',
    productName: STABLE_PRODUCT_NAME,
    appId: STABLE_APP_ID,
    userDataDirName: STABLE_USER_DATA_DIR_NAME,
  })
  assert.deepEqual(beta, {
    channel: 'beta',
    productName: BETA_PRODUCT_NAME,
    appId: BETA_APP_ID,
    userDataDirName: BETA_USER_DATA_DIR_NAME,
  })
})

test('applyChannelIsolation pins beta userData under appData by appId', () => {
  const paths = {
    appData: '/Users/x/Library/Application Support',
    userData: '/Users/x/Library/Application Support/Electron',
  }
  const appLike = {
    names: [],
    setName(name) { this.names.push(name) },
    setPath(key, value) {
      if (key === 'userData') paths.userData = value
    },
    getPath(key) {
      if (key === 'appData') return paths.appData
      if (key === 'userData') return paths.userData
      throw new Error(`unexpected path ${key}`)
    },
  }

  const beta = applyChannelIsolation(channelIdentity('beta'), {
    app: appLike,
    instanceId: '',
  })
  assert.equal(
    beta.userData,
    path.join(paths.appData, BETA_USER_DATA_DIR_NAME),
  )
  assert.equal(beta.isolatedInstance, false)
  assert.deepEqual(appLike.names, [BETA_PRODUCT_NAME])
  assert.equal(paths.userData, beta.userData)

  const betaIsolated = applyChannelIsolation(channelIdentity('beta'), {
    app: {
      ...appLike,
      setPath(key, value) {
        if (key === 'userData') paths.userData = value
      },
      getPath(key) {
        if (key === 'appData') return paths.appData
        if (key === 'userData') return '/Users/x/Library/Application Support/Electron'
        throw new Error(`unexpected path ${key}`)
      },
    },
    instanceId: 'qa-1',
  })
  assert.equal(
    betaIsolated.userData,
    `${path.join(paths.appData, BETA_USER_DATA_DIR_NAME)}-qa-1`,
  )
  assert.equal(betaIsolated.isolatedInstance, true)
})

test('applyChannelIsolation keeps stable natural userData unless instance isolated', () => {
  const natural = '/Users/x/Library/Application Support/MilkSU-natural'
  const paths = {
    appData: '/Users/x/Library/Application Support',
    userData: natural,
  }
  const appLike = {
    setPath(key, value) {
      if (key === 'userData') paths.userData = value
    },
    getPath(key) {
      if (key === 'appData') return paths.appData
      if (key === 'userData') return paths.userData
      throw new Error(`unexpected path ${key}`)
    },
  }

  const stable = applyChannelIsolation(channelIdentity('stable'), {
    app: appLike,
    instanceId: '',
  })
  assert.equal(stable.userData, natural)
  assert.equal(stable.isolatedInstance, false)
  assert.equal(paths.userData, natural)

  const isolated = applyChannelIsolation(channelIdentity('stable'), {
    app: appLike,
    instanceId: 'fork-a',
  })
  assert.equal(isolated.userData, `${natural}-fork-a`)
  assert.equal(isolated.isolatedInstance, true)
})

test('planChannelIsolation is pure and does not require Electron', () => {
  const plan = planChannelIsolation(channelIdentity('beta'), {
    appDataPath: '/app-data',
    naturalUserDataPath: '/natural',
    instanceId: '',
  })
  assert.equal(plan.userData, path.join('/app-data', BETA_USER_DATA_DIR_NAME))
  assert.equal(plan.pinUserData, true)
  assert.equal(plan.setName, BETA_PRODUCT_NAME)
})

test('browserProfileRoots does not expand Stable to natural userData', () => {
  const appData = '/Users/x/Library/Application Support'
  const stableRoots = browserProfileRoots({
    channel: 'stable',
    appDataPath: appData,
    userDataPath: path.join(appData, 'Electron'),
    isolatedInstance: false,
  })
  assert.deepEqual(stableRoots, [path.join(appData, STABLE_USER_DATA_DIR_NAME)])

  const stableWithOverride = browserProfileRoots({
    channel: 'stable',
    appDataPath: appData,
    userDataPath: path.join(appData, 'Electron'),
    appDataOverride: '/tmp/custom-appdata',
  })
  assert.deepEqual(stableWithOverride, [
    path.join(appData, STABLE_USER_DATA_DIR_NAME),
    '/tmp/custom-appdata',
  ])

  const betaRoots = browserProfileRoots({
    channel: 'beta',
    appDataPath: appData,
    userDataPath: path.join(appData, BETA_USER_DATA_DIR_NAME),
  })
  // Beta channel root + current userData (deduped when identical after isolation pin).
  assert.deepEqual(betaRoots, [
    path.join(appData, BETA_USER_DATA_DIR_NAME),
  ])

  const betaIsolatedRoots = browserProfileRoots({
    channel: 'beta',
    appDataPath: appData,
    userDataPath: path.join(appData, `${BETA_USER_DATA_DIR_NAME}-qa`),
    isolatedInstance: true,
  })
  assert.deepEqual(betaIsolatedRoots, [
    path.join(appData, BETA_USER_DATA_DIR_NAME),
    path.join(appData, `${BETA_USER_DATA_DIR_NAME}-qa`),
  ])
  assert.ok(!betaIsolatedRoots.includes(path.join(appData, STABLE_USER_DATA_DIR_NAME)))

  const isolatedStableRoots = browserProfileRoots({
    channel: 'stable',
    appDataPath: appData,
    userDataPath: path.join(appData, 'MilkSU-natural-fork'),
    isolatedInstance: true,
  })
  assert.deepEqual(isolatedStableRoots, [
    path.join(appData, STABLE_USER_DATA_DIR_NAME),
    path.join(appData, 'MilkSU-natural-fork'),
  ])
})

test('allowedProfilePath only accepts configured roots', () => {
  const roots = [
    '/Users/x/Library/Application Support/com.milksu.app',
  ]
  assert.equal(
    allowedProfilePath('/Users/x/Library/Application Support/com.milksu.app/profiles/a', roots),
    path.resolve('/Users/x/Library/Application Support/com.milksu.app/profiles/a'),
  )
  assert.equal(
    allowedProfilePath('/Users/x/Library/Application Support/com.milksu.app.beta/profiles/a', roots),
    '',
  )
})

test('resolveRuntimeAppDataDir pins beta/instance under userData/runtime-data', () => {
  assert.equal(
    resolveRuntimeAppDataDir({
      channel: 'stable',
      userDataPath: '/natural',
    }),
    '',
  )
  assert.equal(
    resolveRuntimeAppDataDir({
      channel: 'beta',
      userDataPath: '/beta-user-data',
    }),
    path.join('/beta-user-data', RUNTIME_DATA_SEGMENT),
  )
  assert.equal(
    resolveRuntimeAppDataDir({
      channel: 'stable',
      isolatedInstance: true,
      userDataPath: '/natural-fork',
    }),
    path.join('/natural-fork', RUNTIME_DATA_SEGMENT),
  )
  assert.equal(
    resolveRuntimeAppDataDir({
      channel: 'beta',
      existingAppDataDir: '/explicit',
      userDataPath: '/beta-user-data',
    }),
    '/explicit',
  )
})
