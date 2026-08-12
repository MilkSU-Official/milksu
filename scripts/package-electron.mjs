import { spawn, execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  desktopChannelConfig,
  packagedAppPath,
  resolveDesktopChannel,
  resolveDesktopStartPlan,
  STABLE_APP_ID,
} from './lib/desktop-channel.mjs'
import {
  BUILD_TRACKING_RESOURCE,
  collectBuildTracking,
  writeBuildTrackingFile,
} from './lib/desktop-build-provenance.mjs'
import { desktopAccountConfigFromEnvironment } from './lib/desktop-account-config.mjs'
import { inspectPackagedApp } from './lib/desktop-package-inspect.mjs'
import { generateBetaAppIconFiles } from './generate-beta-appicon.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2] || 'build'
const channel = resolveDesktopChannel(process.argv, process.env)
const channelConfig = desktopChannelConfig(channel)
// Always prefer the current managed Node that launched this script.
const managedNode = process.execPath
const codesignIdentity = String(process.env.MILKSU_CODESIGN_IDENTITY ?? '').trim() || '-'

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with status ${code}`))
    })
  })
}

async function exists(candidate) {
  try {
    await stat(candidate)
    return true
  } catch {
    return false
  }
}

async function ensureBetaIcon() {
  if (channelConfig.channel !== 'beta') return
  const iconPath = join(root, channelConfig.iconRelative)
  // Always regenerate from the real brand asset so packaging never reuses a stale copy.
  await generateBetaAppIconFiles(root)
  if (!(await exists(iconPath))) {
    throw new Error(`beta icon missing after generation: ${iconPath}`)
  }
}

async function buildRuntime() {
  await run('npm', ['--prefix', 'app', 'run', 'build'])
  await mkdir(join(root, 'build', 'desktop'), { recursive: true })
  const backend = join(root, 'build', 'desktop', 'milksu-backend')
  // Provenance is sealed as extraResources/build-tracking.json before codesign.
  // Do not embed tracking via ldflags. Strip debug symbols (-s -w) so the local
  // darwin linker does not require dsymutil under constrained agent sandboxes.
  await run('go', [
    'build',
    '-trimpath',
    '-ldflags=-s -w',
    '-o', backend,
    './cmd/milksu-backend',
  ])
  await chmod(backend, 0o755)
}

async function writeBuilderConfig(trackingPath) {
  await ensureBetaIcon()
  const desktopPackage = JSON.parse(await readFile(join(root, 'desktop', 'package.json'), 'utf8'))
  const files = Array.isArray(desktopPackage.build?.files)
    ? [...desktopPackage.build.files]
    : []
  if (!files.includes('channel-identity.cjs')) files.push('channel-identity.cjs')
  if (!files.includes('computer-use-permissions.cjs')) files.push('computer-use-permissions.cjs')
  const extraResources = [
    ...(desktopPackage.build?.extraResources || []),
    {
      from: trackingPath,
      to: BUILD_TRACKING_RESOURCE,
    },
  ]
  const accountConfig = desktopAccountConfigFromEnvironment(process.env)
  if (accountConfig) {
    const accountConfigPath = join(root, 'build', 'desktop', `account-config.${channelConfig.channel}.json`)
    await writeFile(accountConfigPath, `${JSON.stringify(accountConfig, null, 2)}\n`, { mode: 0o600 })
    extraResources.push({ from: accountConfigPath, to: 'account-config.json' })
  }
  const build = {
    ...desktopPackage.build,
    appId: channelConfig.appId,
    productName: channelConfig.productName,
    protocols: [{
      name: `${channelConfig.productName} Account Login`,
      schemes: [channelConfig.accountProtocolScheme],
    }],
    files,
    extraMetadata: {
      ...(desktopPackage.build?.extraMetadata || {}),
      name: channelConfig.channel === 'beta' ? 'milksu-desktop-beta' : 'milksu-desktop',
      productName: channelConfig.productName,
    },
    extraResources,
    mac: {
      ...(desktopPackage.build?.mac || {}),
      icon: join(root, channelConfig.iconRelative),
      // Local Stable/Beta packages are deliberately ad-hoc until a Developer ID
      // is supplied. Explicit null prevents electron-builder from repeatedly
      // enumerating the user's Keychain during ordinary inner-loop builds.
      identity: codesignIdentity === '-' ? null : codesignIdentity,
      hardenedRuntime: codesignIdentity !== '-',
      entitlements: join(root, 'desktop', 'build', 'entitlements.mac.plist'),
      entitlementsInherit: join(root, 'desktop', 'build', 'entitlements.mac.inherit.plist'),
      timestamp: codesignIdentity === '-' ? undefined : 'http://timestamp.apple.com/ts01',
      gatekeeperAssess: false,
    },
    directories: {
      output: join(root, 'build', 'electron', channelConfig.channel),
    },
  }
  const configPath = join(root, 'build', 'desktop', `electron-builder.${channelConfig.channel}.json`)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(build, null, 2)}\n`)
  return configPath
}

async function buildApp() {
  const tracking = await collectBuildTracking(root, {
    channel: channelConfig.channel,
    productName: channelConfig.productName,
    appId: channelConfig.appId,
  })
  const trackingStage = join(root, 'build', 'desktop', `build-tracking.${channelConfig.channel}.json`)
  await mkdir(dirname(trackingStage), { recursive: true })
  await writeBuildTrackingFile(trackingStage, tracking)

  await buildRuntime()
  const configPath = await writeBuilderConfig(trackingStage)
  const electronBuilder = join(root, 'desktop', 'node_modules', '.bin', 'electron-builder')
  await run(electronBuilder, [
    '--mac', 'dir',
    '--arm64',
    `--config=${configPath}`,
    '--project', join(root, 'desktop'),
  ], {
    env: {
      ...process.env,
      MILKSU_CHANNEL: channelConfig.channel,
      MILKSU_DESKTOP_APP_ID: channelConfig.appId,
      CSC_IDENTITY_AUTO_DISCOVERY: codesignIdentity === '-' ? 'false' : 'true',
    },
  })

  const candidates = [
    join(root, 'build', 'electron', channelConfig.channel, 'mac-arm64', `${channelConfig.productName}.app`),
    join(root, 'build', 'electron', channelConfig.channel, 'mac', `${channelConfig.productName}.app`),
    join(root, 'build', 'electron', 'mac-arm64', `${channelConfig.productName}.app`),
    join(root, 'build', 'electron', 'mac', `${channelConfig.productName}.app`),
  ]
  let resolvedSource = ''
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      resolvedSource = candidate
      break
    }
  }
  if (!resolvedSource) {
    throw new Error(
      `electron-builder did not produce ${channelConfig.productName}.app for channel ${channelConfig.channel}`,
    )
  }

  // build-tracking.json must already be present from electron-builder extraResources
  // BEFORE package-sidecar re-signs. Missing resource is a hard failure — never cp after sign.
  const trackingInApp = join(resolvedSource, 'Contents', 'Resources', BUILD_TRACKING_RESOURCE)
  if (!(await exists(trackingInApp))) {
    throw new Error(
      `build-tracking.json missing from packaged resources before sidecar install: ${trackingInApp}`,
    )
  }

  const binaryName = channelConfig.productName
  const binaryPath = join(resolvedSource, 'Contents', 'MacOS', binaryName)
  const altBinary = join(resolvedSource, 'Contents', 'MacOS', 'MilkSU')
  const sidecarBin = (await exists(binaryPath))
    ? binaryPath
    : (await exists(altBinary) ? altBinary : '')
  if (!sidecarBin) {
    throw new Error(`packaged binary missing under ${resolvedSource}/Contents/MacOS`)
  }

  // Use the managed Node that launched packaging — never PATH system node.
  await run(managedNode, [
    join(root, 'scripts', 'package-sidecar.mjs'),
    'install',
    '--platform=darwin/arm64',
    `--bin=${sidecarBin}`,
  ], {
    env: {
      ...process.env,
      MILKSU_CODESIGN_IDENTITY: codesignIdentity,
      MILKSU_REQUIRE_STABLE_CODESIGN: codesignIdentity === '-' ? '0' : '1',
    },
  })

  // After sidecar install/re-sign, tracking must still be present (sealed). No late copy.
  if (!(await exists(trackingInApp))) {
    throw new Error(
      `build-tracking.json disappeared after sidecar install/re-sign: ${trackingInApp}`,
    )
  }

  // TCC probes run inside milksu-backend. Sign it with the channel bundle id so
  // AX/Screen Recording identity matches the shell (not a.out).
  const backendInApp = join(resolvedSource, 'Contents', 'Resources', 'milksu-backend')
  if (!(await exists(backendInApp))) {
    throw new Error(`packaged milksu-backend missing: ${backendInApp}`)
  }
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    ...(codesignIdentity === '-' ? [] : ['--options', 'runtime', '--timestamp']),
    '--sign', codesignIdentity,
    '--identifier', channelConfig.appId,
    backendInApp,
  ])
  // Re-seal the app bundle after mutating an embedded binary.
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    ...(codesignIdentity === '-'
      ? ['--deep']
      : [
          '--options', 'runtime',
          '--timestamp',
          '--entitlements', join(root, 'desktop', 'build', 'entitlements.mac.plist'),
        ]),
    '--sign', codesignIdentity,
    resolvedSource,
  ])

  const output = packagedAppPath(root, channelConfig.channel)
  await mkdir(dirname(output), { recursive: true })
  await rm(output, { recursive: true, force: true })
  await rename(resolvedSource, output)

  const inspection = await inspectPackagedApp(output, channelConfig.channel)
  if (!inspection.ok) {
    throw new Error(
      `packaged ${channelConfig.channel} identity/provenance rejected: ${inspection.issues.join('; ')}`,
    )
  }
  process.stdout.write(`${JSON.stringify({
    channel: channelConfig.channel,
    appPath: output,
    tracking: inspection.tracking,
    identity: {
      appId: inspection.plist?.bundleId,
      productName: inspection.plist?.name || inspection.plist?.displayName,
      codesign: inspection.codesign,
    },
  }, null, 2)}\n`)
}

async function startDevelopment() {
  await buildRuntime()
  await run('npm', ['--prefix', 'desktop', 'start'], {
    env: {
      ...process.env,
      MILKSU_CHANNEL: 'stable',
      MILKSU_DESKTOP_APP_ID: STABLE_APP_ID,
    },
  })
}

/**
 * desktop:start:beta — only open an already packaged, fully verified Beta app.
 * Never builds, never falls back to electron ./dev shell.
 */
async function startBetaPackagedOnly() {
  const appPath = packagedAppPath(root, 'beta')
  const present = await exists(appPath)
  let identityVerified = false
  let identityIssues = []
  if (present) {
    const inspection = await inspectPackagedApp(appPath, 'beta')
    identityVerified = inspection.ok
    identityIssues = inspection.issues
  }
  const plan = resolveDesktopStartPlan('beta', {
    root,
    packagedAppExists: present,
    identityVerified,
    identityIssues,
  })
  if (plan.mode !== 'packaged') {
    const reason = plan.refuseReason || 'desktop:start:beta refused to launch'
    process.stderr.write(`${reason}\n`)
    process.exit(1)
  }
  if (plan.forbidsElectronDot !== true) {
    throw new Error('internal guard: beta start plan must forbid electron .')
  }
  // Production path only: never accept test doubles or alternate launchers here.
  if (plan.command !== '/usr/bin/open') {
    throw new Error(`desktop:start:beta requires /usr/bin/open, got ${JSON.stringify(plan.command)}`)
  }
  if (!Array.isArray(plan.args) || plan.args[0] !== '-n' || plan.args[1] !== appPath) {
    throw new Error(`desktop:start:beta open args must be ['-n', appPath], got ${JSON.stringify(plan.args)}`)
  }
  await run(plan.command, plan.args)
}

if (action === 'start') {
  if (channel === 'beta') {
    await startBetaPackagedOnly()
  } else {
    await startDevelopment()
  }
} else if (action === 'start:beta') {
  await startBetaPackagedOnly()
} else if (action === 'build') {
  await buildApp()
} else if (action === 'inspect') {
  const appPath = process.argv.find(v => v.startsWith('--app='))?.slice('--app='.length)
    || packagedAppPath(root, channel)
  const inspection = await inspectPackagedApp(appPath, channel)
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`)
  if (!inspection.ok) process.exitCode = 2
} else {
  throw new Error(`unsupported Electron package action: ${action}`)
}
