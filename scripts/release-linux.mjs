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
import { readLinuxPkgbuildTemplate, renderLinuxPkgbuild } from './lib/linux-packages.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const channelConfig = desktopChannelConfig('stable')
const platform = 'linux/amd64'
const outputDirectory = join(repositoryRoot, 'build', 'electron', 'linux', 'stable')
const releaseDirectory = join(repositoryRoot, 'build', 'release')
const backendPath = join(repositoryRoot, 'build', 'desktop', 'milksu-backend')
const sidecarPath = join(repositoryRoot, 'build', 'sidecar', 'linux-amd64')

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
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

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Linux release packaging must run natively on a Linux x64 runner')
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
  throw new Error('refusing to package a Linux Stable trial from a dirty worktree')
}

const stagingDirectory = join(repositoryRoot, 'build', 'desktop')
const trackingPath = join(stagingDirectory, 'build-tracking.stable.linux.json')
const accountConfigPath = join(stagingDirectory, 'account-config.stable.linux.json')
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
  'linux-desktop.cjs',
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
    homepage: 'https://github.com/MilkSU-Official/milksu',
    author: {
      name: 'MilkSU',
      email: 'milksu@proton.me',
    },
  },
  extraResources: [
    { from: join(repositoryRoot, 'app', 'dist'), to: 'renderer' },
    { from: backendPath, to: 'milksu-backend' },
    { from: sidecarPath, to: 'milksu-sidecar' },
    { from: trackingPath, to: BUILD_TRACKING_RESOURCE },
    { from: accountConfigPath, to: 'account-config.json' },
  ],
  directories: { output: outputDirectory },
  artifactName: 'MilkSU-Linux-x64-${version}.${ext}',
  linux: {
    icon: join(repositoryRoot, 'build', 'appicon.png'),
    target: [
      { target: 'deb', arch: ['x64'] },
      { target: 'tar.gz', arch: ['x64'] },
    ],
    category: 'Development',
    executableName: 'milksu',
    maintainer: 'MilkSU',
    synopsis: 'Personal security learning and research workspace',
    description: 'MilkSU desktop workspace for Coding, CTF and CVE learning workflows.',
  },
  deb: {
    // electron-builder default Recommends libappindicator3-1, which is Ubuntu-only.
    // Debian 13 ships libayatana-appindicator3-1 instead. Keep the shared DEB
    // installable on both without a missing recommend.
    recommends: [],
  },
}
delete builderConfig.mac
delete builderConfig.win
delete builderConfig.nsis
delete builderConfig.dmg

const configPath = join(stagingDirectory, 'electron-builder.stable.linux.json')
await writeFile(configPath, `${JSON.stringify(builderConfig, null, 2)}\n`)
await run(process.execPath, [
  join(repositoryRoot, 'desktop', 'node_modules', 'electron-builder', 'cli.js'),
  '--linux',
  'deb',
  'tar.gz',
  '--x64',
  `--config=${configPath}`,
  '--project',
  join(repositoryRoot, 'desktop'),
  '--publish',
  'never',
], {
  env: {
    ...process.env,
    MILKSU_CHANNEL: 'stable',
    MILKSU_DESKTOP_APP_ID: channelConfig.appId,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
})

const unpackedResources = join(outputDirectory, 'linux-unpacked', 'resources')
for (const required of [
  join(outputDirectory, 'linux-unpacked', 'milksu'),
  join(unpackedResources, 'renderer', 'index.html'),
  join(unpackedResources, 'milksu-backend'),
  join(unpackedResources, BUILD_TRACKING_RESOURCE),
  join(unpackedResources, 'milksu-sidecar', 'node'),
  join(unpackedResources, 'milksu-sidecar', 'chat-bridge.cjs'),
  join(unpackedResources, 'milksu-sidecar', 'manifest.json'),
]) {
  if (!await exists(required)) {
    throw new Error(`Linux package is missing required runtime artifact: ${required}`)
  }
}

const packageName = `MilkSU-Linux-x64-${version}.deb`
const builtPackage = join(outputDirectory, packageName)
if (!await exists(builtPackage)) {
  const candidates = (await readdir(outputDirectory)).filter(name => name.endsWith('.deb'))
  throw new Error(
    `electron-builder did not produce ${packageName}; candidates=${candidates.join(',')}`,
  )
}

await mkdir(releaseDirectory, { recursive: true })
const releasePackage = join(releaseDirectory, packageName)
await copyFile(builtPackage, releasePackage)

const tarballName = `MilkSU-Linux-x64-${version}.tar.gz`
const builtTarball = join(outputDirectory, tarballName)
if (!await exists(builtTarball)) {
  const candidates = (await readdir(outputDirectory)).filter(name => name.endsWith('.tar.gz'))
  throw new Error(
    `electron-builder did not produce ${tarballName}; candidates=${candidates.join(',')}`,
  )
}
const releaseTarball = join(releaseDirectory, tarballName)
await copyFile(builtTarball, releaseTarball)
const tarballSha256 = await sha256(releaseTarball)
const pkgbuildTemplate = await readLinuxPkgbuildTemplate(
  join(repositoryRoot, 'packaging', 'linux', 'PKGBUILD.in'),
)
await writeFile(
  join(releaseDirectory, 'PKGBUILD'),
  renderLinuxPkgbuild({ version, sha256: tarballSha256, template: pkgbuildTemplate }),
)
await copyFile(
  join(repositoryRoot, 'packaging', 'linux', 'milksu.desktop'),
  join(releaseDirectory, 'milksu.desktop'),
)
process.stdout.write(`${JSON.stringify({
  platform,
  version,
  package: releasePackage,
  tarball: releaseTarball,
  pkgbuild: join(releaseDirectory, 'PKGBUILD'),
  sha256: await sha256(releasePackage),
  tarballSha256,
  size: (await stat(releasePackage)).size,
  signed: false,
  localOcr: false,
  computerUse: false,
  tracking,
}, null, 2)}\n`)
