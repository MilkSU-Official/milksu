#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUILD_TRACKING_RESOURCE,
  collectBuildTracking,
  writeBuildTrackingFile,
} from './lib/desktop-build-provenance.mjs'
import { desktopAccountConfigFromEnvironment } from './lib/desktop-account-config.mjs'
import { desktopChannelConfig } from './lib/desktop-channel.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const channelConfig = desktopChannelConfig('stable')
const platform = 'windows/amd64'
const outputDirectory = join(repositoryRoot, 'build', 'electron', 'windows', 'stable')
const releaseDirectory = join(repositoryRoot, 'build', 'release')
const backendPath = join(repositoryRoot, 'build', 'desktop', 'milksu-backend.exe')
const sidecarPath = join(repositoryRoot, 'build', 'sidecar', 'windows-amd64')

function run(command, args, options = {}) {
  let executable = command
  let commandArgs = args
  if (process.platform === 'win32' && command === 'npm') {
    const npmCLI = String(process.env.npm_execpath ?? '').trim()
    if (!npmCLI) throw new Error('npm_execpath is required for native Windows packaging')
    executable = process.execPath
    commandArgs = [npmCLI, ...args]
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, commandArgs, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      ...options,
    })
    child.once('error', rejectPromise)
    child.once('exit', code => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} exited with status ${code}`))
    })
  })
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('end', resolvePromise)
    stream.once('error', rejectPromise)
  })
  return hash.digest('hex')
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows release packaging must run natively on a Windows x64 runner')
}

const desktopPackage = JSON.parse(
  await readFile(join(repositoryRoot, 'desktop', 'package.json'), 'utf8'),
)
const version = String(desktopPackage.version ?? '').trim()
if (!/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error(`desktop package version is not a stable semantic version: ${version}`)
}

const tracking = await collectBuildTracking(repositoryRoot, {
  channel: 'stable',
  productName: channelConfig.productName,
  appId: channelConfig.appId,
})
if (tracking.dirty) {
  throw new Error('refusing to package a Windows Stable release from a dirty worktree')
}

const stagingDirectory = join(repositoryRoot, 'build', 'desktop')
const trackingPath = join(stagingDirectory, 'build-tracking.stable.windows.json')
const accountConfigPath = join(stagingDirectory, 'account-config.stable.windows.json')
await mkdir(stagingDirectory, { recursive: true })
await writeBuildTrackingFile(trackingPath, tracking)
await writeFile(
  accountConfigPath,
  `${JSON.stringify(desktopAccountConfigFromEnvironment(process.env), null, 2)}\n`,
  { mode: 0o600 },
)

await run('npm', ['--prefix', 'app', 'run', 'build'])
await run('go', [
  'build',
  '-trimpath',
  '-ldflags=-s -w',
  '-o',
  backendPath,
  './cmd/milksu-backend',
])
await chmod(backendPath, 0o755)
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'package-sidecar.mjs'),
  'build',
  `--platform=${platform}`,
])

const files = Array.isArray(desktopPackage.build?.files)
  ? [...desktopPackage.build.files]
  : []
for (const file of [
  'channel-identity.cjs',
  'computer-use-permissions.cjs',
  'macos-screen-permission.cjs',
]) {
  if (!files.includes(file)) files.push(file)
}

const builderConfig = {
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
    name: 'milksu-desktop',
    productName: channelConfig.productName,
  },
  extraResources: [
    { from: join(repositoryRoot, 'app', 'dist'), to: 'renderer' },
    { from: backendPath, to: 'milksu-backend.exe' },
    { from: sidecarPath, to: 'milksu-sidecar' },
    { from: trackingPath, to: BUILD_TRACKING_RESOURCE },
    { from: accountConfigPath, to: 'account-config.json' },
  ],
  directories: { output: outputDirectory },
  artifactName: 'MilkSU-Windows-x64-${version}-Setup.${ext}',
  win: {
    icon: join(repositoryRoot, 'build', 'appicon.png'),
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MilkSU',
  },
}
delete builderConfig.mac

const configPath = join(stagingDirectory, 'electron-builder.stable.windows.json')
await writeFile(configPath, `${JSON.stringify(builderConfig, null, 2)}\n`)
await run(process.execPath, [
  join(repositoryRoot, 'desktop', 'node_modules', 'electron-builder', 'cli.js'),
  '--win',
  'nsis',
  '--x64',
  `--config=${configPath}`,
  '--project',
  join(repositoryRoot, 'desktop'),
], {
  env: {
    ...process.env,
    MILKSU_CHANNEL: 'stable',
    MILKSU_DESKTOP_APP_ID: channelConfig.appId,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
})

const unpackedResources = join(outputDirectory, 'win-unpacked', 'resources')
for (const required of [
  join(outputDirectory, 'win-unpacked', 'MilkSU.exe'),
  join(unpackedResources, 'renderer', 'index.html'),
  join(unpackedResources, 'milksu-backend.exe'),
  join(unpackedResources, BUILD_TRACKING_RESOURCE),
  join(unpackedResources, 'milksu-sidecar', 'node.exe'),
  join(unpackedResources, 'milksu-sidecar', 'chat-bridge.cjs'),
  join(unpackedResources, 'milksu-sidecar', 'manifest.json'),
]) {
  if (!await exists(required)) {
    throw new Error(`Windows package is missing required runtime artifact: ${required}`)
  }
}

const installerName = `MilkSU-Windows-x64-${version}-Setup.exe`
const builtInstaller = join(outputDirectory, installerName)
if (!await exists(builtInstaller)) {
  const candidates = (await readdir(outputDirectory))
    .filter(name => name.endsWith('.exe') && name.includes('Setup'))
  throw new Error(
    `electron-builder did not produce ${installerName}; candidates=${candidates.join(',')}`,
  )
}

await mkdir(releaseDirectory, { recursive: true })
const releaseInstaller = join(releaseDirectory, installerName)
await copyFile(builtInstaller, releaseInstaller)
process.stdout.write(`${JSON.stringify({
  platform,
  version,
  installer: releaseInstaller,
  sha256: await sha256(releaseInstaller),
  size: (await stat(releaseInstaller)).size,
  signed: false,
  tracking,
}, null, 2)}\n`)
