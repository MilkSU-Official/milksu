import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  BETA_APP_ID,
  BETA_PRODUCT_NAME,
  STABLE_APP_ID,
  STABLE_PRODUCT_NAME,
  channelIdentityIssues,
  desktopChannelConfig,
  isSelfComputerUseTarget,
  packagedAppPath,
  resolveDesktopChannel,
  resolveDesktopStartPlan,
  runtimeDataDirectory,
  userDataDirectoryName,
} from '../../scripts/lib/desktop-channel.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const desktopIdentity = require('../../desktop/channel-identity.cjs')

test('stable and beta channel identities are distinct and stable', () => {
  const stable = desktopChannelConfig('stable')
  const beta = desktopChannelConfig('beta')

  assert.equal(stable.productName, STABLE_PRODUCT_NAME)
  assert.equal(stable.appId, STABLE_APP_ID)
  assert.equal(stable.outputAppName, 'MilkSU.app')
  assert.equal(stable.iconRelative, 'build/appicon.png')
  assert.equal(stable.visibleBadge, '')

  assert.equal(beta.productName, BETA_PRODUCT_NAME)
  assert.equal(beta.appId, BETA_APP_ID)
  assert.equal(beta.outputAppName, 'MilkSU Beta.app')
  assert.equal(beta.iconRelative, 'build/desktop/appicon-beta.png')
  assert.equal(beta.visibleBadge, 'BETA')

  assert.notEqual(stable.appId, beta.appId)
  assert.notEqual(stable.productName, beta.productName)
  assert.notEqual(stable.userDataDirName, beta.userDataDirName)
  assert.notEqual(stable.iconRelative, beta.iconRelative)

  assert.deepEqual(channelIdentityIssues(stable, {
    productName: stable.productName,
    appId: stable.appId,
    iconRelative: stable.iconRelative,
  }), [])
  assert.deepEqual(channelIdentityIssues(beta, {
    productName: beta.productName,
    appId: beta.appId,
    iconRelative: beta.iconRelative,
  }), [])
})

test('scripts and desktop CJS identity constants stay aligned', () => {
  assert.equal(desktopIdentity.STABLE_APP_ID, STABLE_APP_ID)
  assert.equal(desktopIdentity.BETA_APP_ID, BETA_APP_ID)
  assert.equal(desktopIdentity.STABLE_PRODUCT_NAME, STABLE_PRODUCT_NAME)
  assert.equal(desktopIdentity.BETA_PRODUCT_NAME, BETA_PRODUCT_NAME)
  assert.equal(desktopIdentity.STABLE_USER_DATA_DIR_NAME, userDataDirectoryName('stable'))
  assert.equal(desktopIdentity.BETA_USER_DATA_DIR_NAME, userDataDirectoryName('beta'))
  assert.equal(
    desktopIdentity.channelIdentity('beta').appId,
    desktopChannelConfig('beta').appId,
  )
  assert.equal(
    desktopIdentity.channelIdentity('stable').productName,
    desktopChannelConfig('stable').productName,
  )
})

test('resolveDesktopChannel reads --channel and MILKSU_CHANNEL', () => {
  assert.equal(resolveDesktopChannel(['node', 'script', '--channel=beta'], {}), 'beta')
  assert.equal(resolveDesktopChannel(['node', 'script', '--channel', 'beta'], {}), 'beta')
  assert.equal(resolveDesktopChannel(['node', 'script'], { MILKSU_CHANNEL: 'beta' }), 'beta')
  assert.equal(resolveDesktopChannel(['node', 'script', '--channel=stable'], { MILKSU_CHANNEL: 'beta' }), 'stable')
  assert.equal(resolveDesktopChannel(['node', 'script'], {}), 'stable')
})

test('explicit invalid channel never silently falls back to stable', () => {
  assert.throws(
    () => resolveDesktopChannel(['node', 'script', '--channel=canary'], {}),
    /unsupported desktop channel/,
  )
  assert.throws(
    () => resolveDesktopChannel(['node', 'script', '--channel', 'nightly'], {}),
    /unsupported desktop channel/,
  )
  assert.throws(
    () => resolveDesktopChannel(['node', 'script'], { MILKSU_CHANNEL: 'canary' }),
    /unsupported MILKSU_CHANNEL/,
  )
  assert.throws(
    () => desktopChannelConfig('canary'),
    /unsupported desktop channel/,
  )
  assert.throws(
    () => desktopChannelConfig('', { allowDefault: false }),
    /desktop channel is required/,
  )
  // Completely unspecified still defaults to stable.
  assert.equal(desktopChannelConfig('').channel, 'stable')
  assert.equal(desktopChannelConfig(undefined).channel, 'stable')
})

test('userData and runtime data roots are channel-isolated', () => {
  assert.equal(userDataDirectoryName('stable'), 'com.milksu.app')
  assert.equal(userDataDirectoryName('beta'), 'com.milksu.app.beta')
  assert.equal(
    runtimeDataDirectory('/Users/x/Library/Application Support/com.milksu.app.beta'),
    '/Users/x/Library/Application Support/com.milksu.app.beta/runtime-data',
  )
  assert.notEqual(
    runtimeDataDirectory('/tmp/stable-user-data'),
    runtimeDataDirectory('/tmp/beta-user-data'),
  )
})

test('CU self target uses host bundle id / pid, not fragile MilkSU name matching', () => {
  const stableHost = { hostBundleId: STABLE_APP_ID, hostPid: 100 }
  const betaHost = { hostBundleId: BETA_APP_ID, hostPid: 200 }

  assert.equal(isSelfComputerUseTarget({
    name: 'MilkSU',
    bundleId: STABLE_APP_ID,
    pid: 100,
  }, stableHost), true)

  assert.equal(isSelfComputerUseTarget({
    name: 'MilkSU Beta',
    bundleId: BETA_APP_ID,
    pid: 200,
  }, stableHost), false, 'Stable must still be able to target Beta')

  assert.equal(isSelfComputerUseTarget({
    name: 'MilkSU Beta',
    bundleId: BETA_APP_ID,
    pid: 200,
  }, betaHost), true)

  assert.equal(isSelfComputerUseTarget({
    name: 'TextEdit',
    bundleId: 'com.apple.TextEdit',
    pid: 300,
  }, stableHost), false)

  assert.equal(isSelfComputerUseTarget({
    name: 'Not MilkSU',
    bundleId: 'com.example.app',
    pid: 100,
  }, stableHost), true, 'same PID as host is self even with other name')
})

test('beta start plan targets packaged app path, never desktop electron .', () => {
  const betaMissing = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: false,
  })
  assert.equal(betaMissing.mode, 'refuse')
  assert.equal(betaMissing.channel, 'beta')
  assert.equal(betaMissing.needsBuild, false)
  assert.equal(betaMissing.forbidsElectronDot, true)
  assert.equal(betaMissing.command, '')
  assert.equal(
    betaMissing.appPath,
    join(root, 'build', 'bin', 'MilkSU Beta.app'),
  )
  assert.match(betaMissing.refuseReason, /never builds/i)
  assert.ok(!JSON.stringify(betaMissing).includes('electron .'))

  const betaUnverified = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: true,
    identityVerified: false,
    identityIssues: ['bad identity'],
  })
  assert.equal(betaUnverified.mode, 'refuse')
  assert.equal(betaUnverified.needsBuild, false)
  assert.match(betaUnverified.refuseReason, /identity/i)

  const betaReady = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: true,
    identityVerified: true,
    openBinary: '/usr/bin/open',
  })
  assert.equal(betaReady.needsBuild, false)
  assert.equal(betaReady.mode, 'packaged')
  assert.equal(betaReady.appPath, join(root, 'build', 'bin', 'MilkSU Beta.app'))
  assert.deepEqual(betaReady.args, ['-n', betaReady.appPath])
  assert.equal(betaReady.command, '/usr/bin/open')
  assert.ok(!betaReady.args.some(value => String(value).includes('electron')))
  assert.notEqual(betaReady.command, 'npm')

  const stable = resolveDesktopStartPlan('stable', { root })
  assert.equal(stable.mode, 'development')
  assert.equal(stable.channel, 'stable')
  assert.equal(stable.command, 'npm')
  assert.deepEqual(stable.args, ['--prefix', 'desktop', 'start'])
  assert.equal(stable.forbidsElectronDot, false)
})

test('packagedAppPath uses channel outputAppName under build/bin', () => {
  assert.equal(
    packagedAppPath('/repo', 'stable'),
    '/repo/build/bin/MilkSU.app',
  )
  assert.equal(
    packagedAppPath('/repo/', 'beta'),
    '/repo/build/bin/MilkSU Beta.app',
  )
})
