'use strict'

/**
 * Pure desktop channel identity + isolation helpers for Electron main.
 * Keep constants aligned with scripts/lib/desktop-channel.mjs (locked by tests).
 */

const path = require('node:path')

const STABLE_APP_ID = 'com.milksu.app'
const BETA_APP_ID = 'com.milksu.app.beta'
const STABLE_PRODUCT_NAME = 'MilkSU'
const BETA_PRODUCT_NAME = 'MilkSU Beta'
const STABLE_USER_DATA_DIR_NAME = STABLE_APP_ID
const BETA_USER_DATA_DIR_NAME = BETA_APP_ID
const RUNTIME_DATA_SEGMENT = 'runtime-data'
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u

/**
 * @param {unknown} value
 * @returns {'stable' | 'beta' | ''}
 */
function normalizeDesktopChannel(value) {
  const channel = String(value ?? '').trim().toLowerCase()
  return channel === 'beta' || channel === 'stable' ? channel : ''
}

/**
 * Resolve channel from env / packaged app name / desktop app id hints.
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   appName?: string,
 *   desktopAppId?: string,
 * }} [input]
 * @returns {'stable' | 'beta'}
 */
function resolveDesktopChannel(input = {}) {
  const env = input.env ?? {}
  const fromEnv = normalizeDesktopChannel(env.MILKSU_CHANNEL)
  if (fromEnv) return fromEnv

  const appName = String(input.appName ?? '').trim().toLowerCase()
  if (appName.includes('beta')) return 'beta'

  const desktopAppId = String(
    input.desktopAppId ?? env.MILKSU_DESKTOP_APP_ID ?? '',
  ).trim().toLowerCase()
  if (desktopAppId === BETA_APP_ID) return 'beta'
  if (desktopAppId === STABLE_APP_ID) return 'stable'
  return 'stable'
}

/**
 * @param {'stable' | 'beta' | string} channel
 */
function channelIdentity(channel) {
  if (channel === 'beta') {
    return {
      channel: 'beta',
      productName: BETA_PRODUCT_NAME,
      appId: BETA_APP_ID,
      userDataDirName: BETA_USER_DATA_DIR_NAME,
    }
  }
  return {
    channel: 'stable',
    productName: STABLE_PRODUCT_NAME,
    appId: STABLE_APP_ID,
    userDataDirName: STABLE_USER_DATA_DIR_NAME,
  }
}

/**
 * Compute isolation plan without touching Electron APIs.
 * @param {{ channel: string, productName: string, userDataDirName: string }} identity
 * @param {{
 *   appDataPath: string,
 *   naturalUserDataPath: string,
 *   instanceId?: string,
 * }} paths
 */
function planChannelIsolation(identity, paths) {
  const instanceSuffix = String(paths.instanceId ?? '').trim()
  const isolatedInstance = INSTANCE_ID_PATTERN.test(instanceSuffix)
  if (identity.channel === 'beta') {
    let userData = path.join(paths.appDataPath, identity.userDataDirName)
    if (isolatedInstance) userData = `${userData}-${instanceSuffix}`
    return {
      userData,
      isolatedInstance,
      setName: identity.productName,
      pinUserData: true,
    }
  }
  if (isolatedInstance) {
    const userData = `${paths.naturalUserDataPath}-${instanceSuffix}`
    return {
      userData,
      isolatedInstance: true,
      setName: '',
      pinUserData: true,
    }
  }
  return {
    userData: paths.naturalUserDataPath,
    isolatedInstance: false,
    setName: '',
    pinUserData: false,
  }
}

/**
 * Apply a pure isolation plan to an Electron-like app facade.
 * @param {{
 *   setName?: (name: string) => void,
 *   setPath: (name: string, value: string) => void,
 *   getPath: (name: string) => string,
 * }} appLike
 * @param {ReturnType<typeof planChannelIsolation>} plan
 */
function applyChannelIsolationPlan(appLike, plan) {
  if (plan.setName) {
    try {
      appLike.setName?.(plan.setName)
    } catch {
      // Electron may throw before ready in some test doubles; ignore.
    }
  }
  if (plan.pinUserData) {
    appLike.setPath('userData', plan.userData)
  }
  return {
    userData: plan.pinUserData ? plan.userData : appLike.getPath('userData'),
    isolatedInstance: plan.isolatedInstance,
  }
}

/**
 * Convenience wrapper used by main.cjs.
 * @param {{ channel: string, productName: string, userDataDirName: string }} identity
 * @param {{
 *   app: {
 *     setName?: (name: string) => void,
 *     setPath: (name: string, value: string) => void,
 *     getPath: (name: string) => string,
 *   },
 *   instanceId?: string,
 * }} options
 */
function applyChannelIsolation(identity, options) {
  const appLike = options.app
  const plan = planChannelIsolation(identity, {
    appDataPath: appLike.getPath('appData'),
    naturalUserDataPath: appLike.getPath('userData'),
    instanceId: options.instanceId,
  })
  return applyChannelIsolationPlan(appLike, plan)
}

/**
 * Browser profile path roots.
 * Stable keeps only the historical appData/com.milksu.app root
 * (plus explicit MILKSU_APPDATA_DIR). Beta uses its own appId root and,
 * like explicit isolated instances, may also allow current Electron userData.
 *
 * @param {{
 *   channel: string,
 *   appDataPath: string,
 *   userDataPath: string,
 *   historicalStableRoot?: string,
 *   appDataOverride?: string,
 *   isolatedInstance?: boolean,
 * }} input
 * @returns {string[]}
 */
function browserProfileRoots(input) {
  const roots = []
  if (input.channel === 'beta') {
    roots.push(path.join(input.appDataPath, BETA_USER_DATA_DIR_NAME))
  } else {
    // Stable historical root — do not auto-expand to natural Electron userData.
    roots.push(String(
      input.historicalStableRoot
        ?? path.join(input.appDataPath, STABLE_USER_DATA_DIR_NAME),
    ))
  }

  const allowCurrentUserData = input.channel === 'beta' || Boolean(input.isolatedInstance)
  if (allowCurrentUserData) {
    const userDataPath = String(input.userDataPath ?? '').trim()
    if (userDataPath) roots.push(path.resolve(userDataPath))
  }

  const override = String(input.appDataOverride ?? '').trim()
  if (override && path.isAbsolute(override)) {
    roots.push(path.resolve(override))
  }

  // De-dupe while preserving order.
  const seen = new Set()
  return roots.filter(root => {
    const key = path.resolve(root)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * @param {string} profilePath
 * @param {string[]} roots
 * @returns {string}
 */
function allowedProfilePath(profilePath, roots) {
  const resolved = path.resolve(String(profilePath ?? ''))
  const allowed = roots.some(root => {
    const normalizedRoot = path.resolve(root)
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`)
  })
  return allowed ? resolved : ''
}

/**
 * Resolve Go runtime MILKSU_APPDATA_DIR for the desktop backend.
 * @param {{
 *   channel: string,
 *   isolatedInstance?: boolean,
 *   existingAppDataDir?: string,
 *   userDataPath: string,
 * }} input
 * @returns {string}
 */
function resolveRuntimeAppDataDir(input) {
  const existing = String(input.existingAppDataDir ?? '').trim()
  if (existing) return existing
  if (input.channel === 'beta' || input.isolatedInstance) {
    return path.join(String(input.userDataPath), RUNTIME_DATA_SEGMENT)
  }
  return ''
}

module.exports = {
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
  applyChannelIsolationPlan,
  applyChannelIsolation,
  browserProfileRoots,
  allowedProfilePath,
  resolveRuntimeAppDataDir,
}
