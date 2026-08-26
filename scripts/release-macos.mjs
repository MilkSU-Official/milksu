#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { writeReleaseUploadMetadata } from './lib/release-upload-metadata.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const identity = String(process.env.MILKSU_CODESIGN_IDENTITY ?? '').trim()
const expectedTeamId = String(process.env.APPLE_TEAM_ID ?? '').trim()
const notaryProfile = String(process.env.MILKSU_NOTARY_PROFILE ?? '').trim()
const apiKeyPath = String(process.env.APPLE_API_KEY_PATH ?? '').trim()
const apiKeyId = String(process.env.APPLE_API_KEY_ID ?? '').trim()
const apiIssuer = String(process.env.APPLE_API_ISSUER ?? '').trim()
const appPath = join(repositoryRoot, 'build', 'bin', 'MilkSU.app')
const releaseDirectory = join(repositoryRoot, 'build', 'release')
const metadataPath = join(releaseDirectory, 'release-metadata.json')
const dmgBackgroundSourcePath = join(repositoryRoot, 'desktop', 'build', 'dmg-background.svg')
const dmgBackgroundPath = join(repositoryRoot, 'build', 'desktop', 'dmg-background.png')
const dmgBuilderConfigPath = join(repositoryRoot, 'build', 'desktop', 'electron-builder.stable.dmg.json')
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
/** Filled after desktop package version is read — keep Win/Linux-style versioned names. */
let dmgPath = ''

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with status ${code}`)))
  })
}

function notaryArguments() {
  if (notaryProfile) return ['--keychain-profile', notaryProfile]
  if (apiKeyPath && apiKeyId && apiIssuer) {
    return ['--key', apiKeyPath, '--key-id', apiKeyId, '--issuer', apiIssuer]
  }
  throw new Error('set MILKSU_NOTARY_PROFILE or APPLE_API_KEY_PATH + APPLE_API_KEY_ID + APPLE_API_ISSUER')
}

async function assertSignedIdentity() {
  const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath])
  const details = `${stdout}\n${stderr}`
  if (!details.includes(`Authority=${identity}`)) {
    throw new Error('MilkSU.app was not signed with the requested Developer ID Application identity')
  }
  if (expectedTeamId && !details.includes(`TeamIdentifier=${expectedTeamId}`)) {
    throw new Error(`MilkSU.app TeamIdentifier does not match APPLE_TEAM_ID ${expectedTeamId}`)
  }
}

async function submitForNotarization(target, label) {
  const notaryArgs = notaryArguments()
  const { stdout } = await execFileAsync('/usr/bin/xcrun', [
    'notarytool',
    'submit',
    target,
    ...notaryArgs,
    '--no-s3-acceleration',
    '--wait',
    '--output-format', 'json',
  ], { maxBuffer: 10 * 1024 * 1024 })
  const result = JSON.parse(stdout)
  if (result.status !== 'Accepted') {
    if (result.id) {
      await run('/usr/bin/xcrun', ['notarytool', 'log', result.id, ...notaryArgs]).catch(() => {})
    }
    throw new Error(`${label} notarization was not accepted (status: ${result.status || 'unknown'})`)
  }
  process.stdout.write(`${label} notarization accepted: ${result.id}\n`)
}

async function digest(file, algorithm, encoding) {
  const hash = createHash(algorithm)
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('end', resolvePromise)
    stream.once('error', reject)
  })
  return hash.digest(encoding)
}

async function verifyDmgInstallLayout(targetDmgPath) {
  const mountPoint = await mkdtemp(join(tmpdir(), 'milksu-dmg-layout-'))
  let attached = false
  try {
    await run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint', mountPoint,
      targetDmgPath,
    ])
    attached = true
    await stat(join(mountPoint, 'MilkSU.app'))
    const applicationsTarget = await readlink(join(mountPoint, 'Applications'))
    if (applicationsTarget !== '/Applications') {
      throw new Error(`DMG Applications shortcut points to ${applicationsTarget}`)
    }
    await stat(join(mountPoint, '.DS_Store'))
    await stat(join(mountPoint, '.background.png'))
  } finally {
    if (attached) await run('/usr/bin/hdiutil', ['detach', mountPoint])
    await rm(mountPoint, { recursive: true, force: true })
  }
}

if (!identity.startsWith('Developer ID Application: ')) {
  throw new Error('MILKSU_CODESIGN_IDENTITY must be an exact Developer ID Application identity name')
}

await run(process.execPath, [join(repositoryRoot, 'scripts', 'package-electron.mjs'), 'build', '--channel=stable'], {
  env: {
    ...process.env,
    MILKSU_CODESIGN_IDENTITY: identity,
    MILKSU_REQUIRE_STABLE_CODESIGN: '1',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
})
await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
await assertSignedIdentity()

await mkdir(releaseDirectory, { recursive: true })
const desktopPackage = JSON.parse(await readFile(join(repositoryRoot, 'desktop', 'package.json'), 'utf8'))
const version = String(desktopPackage.version ?? '').trim()
const minimumVersion = String(process.env.MILKSU_MINIMUM_UPDATE_VERSION ?? '0.1.0').trim()
if (!semverPattern.test(version) || !semverPattern.test(minimumVersion)) {
  throw new Error('desktop package version and MILKSU_MINIMUM_UPDATE_VERSION must be stable semantic versions')
}
// Match Windows/Linux: platform-arch-version.ext (OTA zip already used this pattern).
dmgPath = join(releaseDirectory, `MilkSU-macOS-arm64-${version}.dmg`)
const zipPath = join(releaseDirectory, `MilkSU-macOS-arm64-${version}.zip`)
const notaryZipPath = join(releaseDirectory, 'MilkSU-macOS-arm64.notary.zip')
await rm(notaryZipPath, { force: true })
await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, notaryZipPath])
await submitForNotarization(notaryZipPath, 'MilkSU.app')
await run('/usr/bin/xcrun', ['stapler', 'staple', appPath])
await run('/usr/bin/xcrun', ['stapler', 'validate', appPath])
await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
await rm(notaryZipPath, { force: true })
await rm(zipPath, { force: true })
await rm(metadataPath, { force: true })
await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])

await run('/usr/bin/sips', [
  '-s', 'format', 'png',
  dmgBackgroundSourcePath,
  '--out', dmgBackgroundPath,
])
await writeFile(dmgBuilderConfigPath, `${JSON.stringify({
  appId: 'com.milksu.app',
  productName: 'MilkSU',
  directories: { output: releaseDirectory },
  mac: {
    icon: join(repositoryRoot, 'build', 'appicon.png'),
    identity: null,
  },
  dmg: {
    artifactName: basename(dmgPath),
    title: 'MilkSU',
    background: dmgBackgroundPath,
    iconSize: 104,
    iconTextSize: 13,
    format: 'UDZO',
    filesystem: 'APFS',
    sign: false,
    writeUpdateInfo: false,
    window: { width: 660, height: 440 },
    contents: [
      { x: 170, y: 250, type: 'file', path: appPath, name: 'MilkSU.app' },
      { x: 490, y: 250, type: 'link', path: '/Applications' },
    ],
  },
}, null, 2)}\n`)
await rm(dmgPath, { force: true })
await run(process.execPath, [
  join(repositoryRoot, 'desktop', 'node_modules', 'electron-builder', 'cli.js'),
  '--mac', 'dmg',
  '--arm64',
  '--prepackaged', appPath,
  `--config=${dmgBuilderConfigPath}`,
  '--project', join(repositoryRoot, 'desktop'),
  '--publish', 'never',
], {
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
})
await verifyDmgInstallLayout(dmgPath)
await run('/usr/bin/codesign', [
  '--force',
  '--timestamp',
  '--sign', identity,
  dmgPath,
])
await submitForNotarization(dmgPath, 'DMG')
await run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath])
await run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath])
await run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath])
await run('/usr/bin/codesign', ['--verify', '--verbose=4', dmgPath])

const tracking = JSON.parse(await readFile(join(appPath, 'Contents', 'Resources', 'build-tracking.json'), 'utf8'))
await writeReleaseUploadMetadata({
  releaseDirectory,
  platform: 'darwin',
  arch: 'arm64',
  version,
  tracking,
  artifacts: [
    { kind: 'zip', fileName: basename(zipPath) },
    { kind: 'dmg', fileName: basename(dmgPath) },
  ],
})

const artifacts = (await readdir(releaseDirectory)).filter(name => name.endsWith('.dmg'))
if (!artifacts.includes(basename(dmgPath))) throw new Error('notarized DMG disappeared after release verification')
process.stdout.write(`${dmgPath}\n`)
process.stdout.write(`${zipPath}\n`)
process.stdout.write(`${metadataPath}\n`)
