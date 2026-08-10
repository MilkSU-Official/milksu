/**
 * Canonical desktop channel identity for MilkSU stable/beta coexistence.
 * Keep packaging, Electron userData, and Go runtime data roots aligned here.
 */

export const STABLE_APP_ID = 'com.milksu.app'
export const BETA_APP_ID = 'com.milksu.app.beta'
export const STABLE_PRODUCT_NAME = 'MilkSU'
export const BETA_PRODUCT_NAME = 'MilkSU Beta'

/** @typedef {'stable' | 'beta'} DesktopChannel */

/**
 * @typedef {object} DesktopChannelConfig
 * @property {DesktopChannel} channel
 * @property {string} productName
 * @property {string} appId
 * @property {string} outputAppName
 * @property {string} iconRelative
 * @property {string} userDataDirName
 * @property {string} visibleBadge
 */

/** @type {Record<DesktopChannel, DesktopChannelConfig>} */
export const DESKTOP_CHANNELS = {
  stable: {
    channel: 'stable',
    productName: STABLE_PRODUCT_NAME,
    appId: STABLE_APP_ID,
    outputAppName: 'MilkSU.app',
    iconRelative: 'build/appicon.png',
    userDataDirName: STABLE_APP_ID,
    visibleBadge: '',
  },
  beta: {
    channel: 'beta',
    productName: BETA_PRODUCT_NAME,
    appId: BETA_APP_ID,
    outputAppName: 'MilkSU Beta.app',
    // Generated packaging artifact under the ignored build/desktop/ tree so it
    // never dirties git status / provenance dirty detection.
    iconRelative: 'build/desktop/appicon-beta.png',
    userDataDirName: BETA_APP_ID,
    visibleBadge: 'BETA',
  },
}

/**
 * @param {string | undefined | null} value
 * @returns {DesktopChannel | ''}
 */
export function normalizeDesktopChannel(value) {
  const channel = String(value ?? '').trim().toLowerCase()
  if (channel === 'beta' || channel === 'stable') return channel
  return ''
}

/**
 * Resolve channel from argv / env.
 * - Completely unspecified => default stable
 * - Explicit --channel / MILKSU_CHANNEL with invalid value => throw (never silent fallback)
 *
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {DesktopChannel}
 */
export function resolveDesktopChannel(argv = process.argv, env = process.env) {
  const inline = argv.find(value => value.startsWith('--channel='))
  if (inline) {
    const raw = inline.slice('--channel='.length)
    const normalized = normalizeDesktopChannel(raw)
    if (!normalized) {
      throw new Error(`unsupported desktop channel ${JSON.stringify(raw)}; expected stable|beta`)
    }
    return normalized
  }
  const index = argv.indexOf('--channel')
  if (index >= 0) {
    const raw = argv[index + 1]
    if (raw == null || String(raw).startsWith('--')) {
      throw new Error('missing value for --channel; expected stable|beta')
    }
    const normalized = normalizeDesktopChannel(raw)
    if (!normalized) {
      throw new Error(`unsupported desktop channel ${JSON.stringify(raw)}; expected stable|beta`)
    }
    return normalized
  }
  if (Object.prototype.hasOwnProperty.call(env, 'MILKSU_CHANNEL')) {
    const raw = env.MILKSU_CHANNEL
    const normalized = normalizeDesktopChannel(raw)
    if (!normalized) {
      throw new Error(`unsupported MILKSU_CHANNEL ${JSON.stringify(raw)}; expected stable|beta`)
    }
    return normalized
  }
  return 'stable'
}

/**
 * @param {DesktopChannel | string} channel
 * @param {{ allowDefault?: boolean }} [options]
 *   allowDefault=true (default): empty/undefined falls back to stable.
 *   allowDefault=false: empty/invalid throws — used by inspect and explicit callers.
 * @returns {DesktopChannelConfig}
 */
export function desktopChannelConfig(channel, options = {}) {
  const allowDefault = options.allowDefault !== false
  const raw = channel == null ? '' : String(channel).trim()
  if (!raw) {
    if (allowDefault) return DESKTOP_CHANNELS.stable
    throw new Error('desktop channel is required')
  }
  const normalized = normalizeDesktopChannel(raw)
  if (!normalized) {
    throw new Error(`unsupported desktop channel ${JSON.stringify(raw)}; expected stable|beta`)
  }
  return DESKTOP_CHANNELS[normalized]
}

/**
 * Electron userData directory name for a channel (under Application Support).
 * @param {DesktopChannel | string} channel
 */
export function userDataDirectoryName(channel) {
  return desktopChannelConfig(channel).userDataDirName
}

/**
 * Go runtime data root under a resolved Electron userData path.
 * @param {string} userDataPath
 */
export function runtimeDataDirectory(userDataPath) {
  return `${String(userDataPath).replace(/[/\\]+$/u, '')}/runtime-data`
}

/**
 * True when a Computer Use target is the current host identity.
 * Exact bundle match only — Beta must remain selectable from Stable.
 * @param {{ bundleId?: string, name?: string, pid?: number }} target
 * @param {{ hostBundleId?: string, hostPid?: number }} host
 */
export function isSelfComputerUseTarget(target, host = {}) {
  const hostBundleId = String(host.hostBundleId ?? '').trim().toLowerCase()
  const targetBundleId = String(target?.bundleId ?? '').trim().toLowerCase()
  if (hostBundleId && targetBundleId && hostBundleId === targetBundleId) {
    return true
  }
  const hostPid = Number(host.hostPid)
  const targetPid = Number(target?.pid)
  if (Number.isInteger(hostPid) && hostPid > 1 && Number.isInteger(targetPid) && targetPid === hostPid) {
    return true
  }
  return false
}

/**
 * Packaging / Info.plist contract checks for a channel config.
 * @param {DesktopChannelConfig} config
 * @param {{ productName?: string, appId?: string, iconRelative?: string }} observed
 */
export function channelIdentityIssues(config, observed = {}) {
  const issues = []
  if (observed.productName != null && observed.productName !== config.productName) {
    issues.push(`productName expected ${config.productName}, got ${observed.productName}`)
  }
  if (observed.appId != null && observed.appId !== config.appId) {
    issues.push(`appId expected ${config.appId}, got ${observed.appId}`)
  }
  if (observed.iconRelative != null && observed.iconRelative !== config.iconRelative) {
    issues.push(`icon expected ${config.iconRelative}, got ${observed.iconRelative}`)
  }
  if (config.channel === 'beta') {
    if (config.appId === STABLE_APP_ID) {
      issues.push('beta appId must differ from stable')
    }
    if (!config.visibleBadge) {
      issues.push('beta must expose a visible badge marker')
    }
    if (config.productName === STABLE_PRODUCT_NAME) {
      issues.push('beta productName must differ from stable')
    }
  }
  if (config.channel === 'stable' && config.appId !== STABLE_APP_ID) {
    issues.push('stable appId must remain com.milksu.app')
  }
  return issues
}

/**
 * Absolute packaged app path for a channel under the repo root.
 * @param {string} root
 * @param {DesktopChannel | string} channel
 */
export function packagedAppPath(root, channel = 'stable') {
  const config = desktopChannelConfig(channel)
  return `${String(root).replace(/[/\\]+$/u, '')}/build/bin/${config.outputAppName}`
}

/**
 * Decide how `desktop:start` should launch for a channel.
 * - stable/default (desktop:start): develop via desktop `electron .`
 * - beta (desktop:start:beta): ONLY launch an already-packaged, identity-verified
 *   MilkSU Beta.app. Never build implicitly and never fall back to electron .
 *
 * @param {DesktopChannel | string} channel
 * @param {{
 *   root: string,
 *   packagedAppExists?: boolean,
 *   identityVerified?: boolean,
 *   identityIssues?: string[],
 *   openBinary?: string,
 * }}
 * options
 */
export function resolveDesktopStartPlan(channel, options) {
  const config = desktopChannelConfig(channel)
  const openBinary = options.openBinary || '/usr/bin/open'
  if (config.channel === 'beta') {
    const appPath = packagedAppPath(options.root, 'beta')
    const exists = options.packagedAppExists === true
    const verified = options.identityVerified === true
    const identityIssues = Array.isArray(options.identityIssues)
      ? options.identityIssues.map(String)
      : []
    if (!exists) {
      return {
        mode: 'refuse',
        channel: 'beta',
        appPath,
        needsBuild: false,
        command: '',
        args: [],
        forbidsElectronDot: true,
        refuseReason: `packaged Beta app not found at ${appPath}; run a channel build first (desktop:start:beta never builds)`,
      }
    }
    if (!verified) {
      return {
        mode: 'refuse',
        channel: 'beta',
        appPath,
        needsBuild: false,
        command: '',
        args: [],
        forbidsElectronDot: true,
        refuseReason: identityIssues.length
          ? `packaged Beta identity check failed: ${identityIssues.join('; ')}`
          : `packaged Beta at ${appPath} failed identity verification`,
      }
    }
    return {
      mode: 'packaged',
      channel: 'beta',
      appPath,
      needsBuild: false,
      // Prefer absolute path + open -n so a second instance can launch beside Stable.
      command: openBinary,
      args: ['-n', appPath],
      // Guardrail: never encode a desktop electron / npm start fallback for beta.
      forbidsElectronDot: true,
      refuseReason: '',
    }
  }
  return {
    mode: 'development',
    channel: 'stable',
    appPath: '',
    needsBuild: false,
    command: 'npm',
    args: ['--prefix', 'desktop', 'start'],
    forbidsElectronDot: false,
    refuseReason: '',
  }
}
