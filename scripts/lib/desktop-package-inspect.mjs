/**
 * Packaged MilkSU Stable/Beta identity + sealed provenance inspection.
 * Used by build, inspect, and desktop:start:beta. expectedChannel is required.
 *
 * Always runs codesign --verify --deep --strict. No skip option.
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import {
  BETA_APP_ID,
  STABLE_APP_ID,
  desktopChannelConfig,
} from './desktop-channel.mjs'
import {
  BUILD_TRACKING_RESOURCE,
  readBuildTrackingFile,
  validateBuildTracking,
} from './desktop-build-provenance.mjs'

const execFileAsync = promisify(execFile)

/**
 * Compare already-canonical executable paths (typically realpath results).
 * No substring matching of outside lookalike paths.
 *
 * @param {string} codesignExecutablePath canonical codesign Executable path
 * @param {string} expectedExecutablePath canonical appPath/Contents/MacOS/CFBundleExecutable
 * @returns {string[]}
 */
export function codesignExecutablePathIssues(codesignExecutablePath, expectedExecutablePath) {
  const issues = []
  const expected = String(expectedExecutablePath ?? '').trim()
  const reported = String(codesignExecutablePath ?? '').trim()
  if (!expected) {
    issues.push('expected CFBundleExecutable path is missing')
    return issues
  }
  if (!reported) {
    issues.push('codesign Executable is missing')
    return issues
  }
  if (reported !== expected) {
    issues.push(
      `codesign Executable must equal ${expected}, got ${reported}`,
    )
  }
  return issues
}

/**
 * Inspector-side path check: realpath both sides, then require exact equality.
 * realpath failure itself is an issue (missing / unreadable path).
 *
 * @param {string} codesignExecutable raw codesign -dv Executable value
 * @param {string} appPath
 * @param {string} bundleExecutable CFBundleExecutable
 * @returns {Promise<string[]>}
 */
export async function inspectCodesignExecutablePaths(
  codesignExecutable,
  appPath,
  bundleExecutable,
) {
  const issues = []
  const execName = String(bundleExecutable ?? '').trim()
  if (!execName) {
    issues.push('CFBundleExecutable is missing')
    return issues
  }
  const reportedRaw = String(codesignExecutable ?? '').trim()
  if (!reportedRaw) {
    issues.push('codesign Executable is missing')
    return issues
  }

  const expectedLogical = resolvePath(String(appPath ?? ''), 'Contents', 'MacOS', execName)
  let expectedReal = ''
  let reportedReal = ''
  try {
    expectedReal = await fs.realpath(expectedLogical)
  } catch (error) {
    issues.push(
      `CFBundleExecutable realpath failed for ${expectedLogical}: ${error?.message || error}`,
    )
  }
  try {
    reportedReal = await fs.realpath(reportedRaw)
  } catch (error) {
    issues.push(
      `codesign Executable realpath failed for ${reportedRaw}: ${error?.message || error}`,
    )
  }
  if (!expectedReal || !reportedReal) return issues
  issues.push(...codesignExecutablePathIssues(reportedReal, expectedReal))
  return issues
}

/**
 * @param {string} appPath
 * @param {'stable' | 'beta' | string} expectedChannel
 */
export async function inspectPackagedApp(appPath, expectedChannel) {
  const issues = []
  let config
  try {
    // Explicit expected channel: never silent-default invalid values to stable.
    config = desktopChannelConfig(expectedChannel, { allowDefault: false })
  } catch (error) {
    return {
      ok: false,
      channel: '',
      expectedAppId: '',
      expectedProductName: '',
      appPath: String(appPath ?? ''),
      issues: [String(error?.message || error)],
      codesign: null,
      plist: null,
      tracking: null,
      icon: null,
    }
  }

  const result = {
    ok: false,
    channel: config.channel,
    expectedAppId: config.appId,
    expectedProductName: config.productName,
    appPath: String(appPath ?? ''),
    issues,
    codesign: null,
    plist: null,
    tracking: null,
    icon: null,
  }

  if (!result.appPath) {
    issues.push('app path is required')
    return result
  }
  try {
    const st = await fs.stat(result.appPath)
    if (!st.isDirectory()) issues.push(`app path is not a bundle directory: ${result.appPath}`)
  } catch {
    issues.push(`app missing: ${result.appPath}`)
    return result
  }

  // 1) Sealed signature verification — always required.
  try {
    await execFileAsync('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      result.appPath,
    ])
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim()
    issues.push(`codesign --verify --deep --strict failed: ${detail}`)
  }

  // 2) codesign identity details
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
      '-dv',
      '--verbose=4',
      result.appPath,
    ])
    const text = `${stdout}\n${stderr}`
    const fields = new Map()
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      const separator = line.indexOf('=')
      if (separator <= 0) continue
      fields.set(line.slice(0, separator), line.slice(separator + 1))
    }
    result.codesign = {
      identifier: fields.get('Identifier') || '',
      signature: fields.get('Signature') || '',
      teamIdentifier: fields.get('TeamIdentifier') || '',
      executable: fields.get('Executable') || '',
    }
    if (result.codesign.identifier !== config.appId) {
      issues.push(
        `codesign Identifier expected ${config.appId}, got ${result.codesign.identifier || '(empty)'}`,
      )
    }
  } catch (error) {
    issues.push(`codesign -dv failed: ${error?.message || error}`)
  }

  // 3) Info.plist identity
  const plistPath = join(result.appPath, 'Contents', 'Info.plist')
  try {
    const readPlist = async key => {
      const { stdout } = await execFileAsync('/usr/bin/plutil', [
        '-extract', key, 'raw', plistPath,
      ])
      return stdout.trim()
    }
    const bundleId = await readPlist('CFBundleIdentifier')
    const name = await readPlist('CFBundleName')
    let displayName = ''
    try {
      displayName = await readPlist('CFBundleDisplayName')
    } catch {
      displayName = ''
    }
    const executable = await readPlist('CFBundleExecutable')
    let accountProtocolScheme = ''
    try {
      accountProtocolScheme = await readPlist('CFBundleURLTypes.0.CFBundleURLSchemes.0')
    } catch {
      accountProtocolScheme = ''
    }
    let iconFile = ''
    try {
      iconFile = await readPlist('CFBundleIconFile')
    } catch {
      iconFile = ''
    }
    let screenCaptureUsageDescription = ''
    try {
      screenCaptureUsageDescription = await readPlist('NSScreenCaptureUsageDescription')
    } catch {
      screenCaptureUsageDescription = ''
    }
    result.plist = {
      bundleId,
      name,
      displayName,
      executable,
      iconFile,
      accountProtocolScheme,
      screenCaptureUsageDescription,
    }

    if (config.channel === 'stable' && bundleId !== STABLE_APP_ID) {
      issues.push(`stable CFBundleIdentifier must be ${STABLE_APP_ID}, got ${bundleId}`)
    }
    if (config.channel === 'beta' && bundleId !== BETA_APP_ID) {
      issues.push(`beta CFBundleIdentifier must be ${BETA_APP_ID}, got ${bundleId}`)
    }
    if (bundleId !== config.appId) {
      issues.push(`CFBundleIdentifier expected ${config.appId}, got ${bundleId}`)
    }
    if (name !== config.productName) {
      issues.push(`CFBundleName expected ${config.productName}, got ${name || '(empty)'}`)
    }
    if (!displayName) {
      issues.push('CFBundleDisplayName is required')
    } else if (displayName !== config.productName) {
      issues.push(
        `CFBundleDisplayName expected ${config.productName}, got ${displayName}`,
      )
    }
    if (!executable) {
      issues.push('CFBundleExecutable is missing')
    } else {
      const expectedExecPath = resolvePath(result.appPath, 'Contents', 'MacOS', executable)
      try {
        const st = await fs.stat(expectedExecPath)
        if (!st.isFile()) {
          issues.push(`CFBundleExecutable is not a regular file: ${expectedExecPath}`)
        } else if ((st.mode & 0o111) === 0) {
          issues.push(`CFBundleExecutable is not executable: ${expectedExecPath}`)
        }
      } catch {
        issues.push(`CFBundleExecutable missing on disk: ${expectedExecPath}`)
      }

      // realpath both sides, then exact equality — never substring lookalikes.
      issues.push(...await inspectCodesignExecutablePaths(
        result.codesign?.executable || '',
        result.appPath,
        executable,
      ))
    }
    if (accountProtocolScheme !== config.accountProtocolScheme) {
      issues.push(
        `account callback scheme expected ${config.accountProtocolScheme}, got ${accountProtocolScheme || '(empty)'}`,
      )
    }
    if (!iconFile) {
      issues.push('CFBundleIconFile is missing')
    } else {
      const resources = join(result.appPath, 'Contents', 'Resources')
      const candidates = [
        join(resources, iconFile),
        join(resources, `${iconFile}.icns`),
        join(resources, `${iconFile}.png`),
      ]
      let found = ''
      for (const candidate of candidates) {
        try {
          await fs.access(candidate)
          found = candidate
          break
        } catch {
          // try next
        }
      }
      result.icon = { iconFile, path: found }
      if (!found) {
        issues.push(`CFBundleIconFile resource missing for ${iconFile}`)
      }
    }
    if (!screenCaptureUsageDescription) {
      issues.push('NSScreenCaptureUsageDescription is required for Computer Use')
    }
  } catch (error) {
    issues.push(`Info.plist inspect failed: ${error?.message || error}`)
  }

  // 4) Sealed build-tracking resource + cross-check with plist
  const trackingPath = join(result.appPath, 'Contents', 'Resources', BUILD_TRACKING_RESOURCE)
  try {
    const tracking = await readBuildTrackingFile(trackingPath)
    result.tracking = tracking
    issues.push(...validateBuildTracking(tracking, {
      expectedChannel: config.channel,
      expectedAppId: config.appId,
    }))
    if (tracking.productName !== config.productName) {
      issues.push(
        `build-tracking productName expected ${config.productName}, got ${tracking.productName}`,
      )
    }
    if (result.plist?.bundleId && tracking.appId !== result.plist.bundleId) {
      issues.push(
        `build-tracking appId ${tracking.appId} does not match CFBundleIdentifier ${result.plist.bundleId}`,
      )
    }
    if (tracking.productName && result.plist && result.plist.name !== tracking.productName) {
      issues.push(
        `build-tracking productName ${tracking.productName} does not match CFBundleName ${result.plist.name}`,
      )
    }
    if (
      tracking.productName
      && result.plist?.displayName
      && result.plist.displayName !== tracking.productName
    ) {
      issues.push(
        `build-tracking productName ${tracking.productName} does not match CFBundleDisplayName ${result.plist.displayName}`,
      )
    }
  } catch (error) {
    issues.push(`sealed build tracking missing or unreadable: ${error?.message || error}`)
  }

  // 5) TCC-bearing Go runtime must share the channel bundle identity with the shell.
  // Permission probes (AX/Screen Recording) run inside milksu-backend, not the Electron
  // main binary. Identifier=a.out would create a separate TCC principal and stage-lock
  // ad-hoc pre-release bootstrap.
  const backendPath = join(result.appPath, 'Contents', 'Resources', 'milksu-backend')
  try {
    await fs.access(backendPath)
    const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
      '-dv',
      '--verbose=4',
      backendPath,
    ])
    const text = `${stdout}\n${stderr}`
    let backendIdentifier = ''
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line.startsWith('Identifier=')) {
        backendIdentifier = line.slice('Identifier='.length).trim()
        break
      }
    }
    result.backend = { path: backendPath, identifier: backendIdentifier }
    if (!backendIdentifier) {
      issues.push('milksu-backend codesign Identifier is missing')
    } else if (backendIdentifier !== config.appId) {
      issues.push(
        `milksu-backend codesign Identifier expected ${config.appId}, got ${backendIdentifier}`,
      )
    }
  } catch (error) {
    issues.push(`milksu-backend signing inspect failed: ${error?.message || error}`)
  }

  result.ok = issues.length === 0
  return result
}
