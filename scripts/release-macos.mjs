#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

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
const dmgPath = join(releaseDirectory, 'MilkSU-macOS-arm64.dmg')

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
await run('/usr/bin/hdiutil', [
  'create',
  '-volname', 'MilkSU',
  '-srcfolder', appPath,
  '-ov',
  '-format', 'UDZO',
  dmgPath,
])
await run('/usr/bin/codesign', [
  '--force',
  '--timestamp',
  '--sign', identity,
  dmgPath,
])
const notaryArgs = notaryArguments()
const { stdout: notaryOutput } = await execFileAsync('/usr/bin/xcrun', [
  'notarytool',
  'submit',
  dmgPath,
  ...notaryArgs,
  '--no-s3-acceleration',
  '--wait',
  '--output-format', 'json',
], { maxBuffer: 10 * 1024 * 1024 })
const notaryResult = JSON.parse(notaryOutput)
if (notaryResult.status !== 'Accepted') {
  if (notaryResult.id) {
    await run('/usr/bin/xcrun', ['notarytool', 'log', notaryResult.id, ...notaryArgs]).catch(() => {})
  }
  throw new Error(`Apple notarization was not accepted (status: ${notaryResult.status || 'unknown'})`)
}
process.stdout.write(`Apple notarization accepted: ${notaryResult.id}\n`)
await run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath])
await run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath])
await run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath])
await run('/usr/bin/codesign', ['--verify', '--verbose=4', dmgPath])

const artifacts = (await readdir(releaseDirectory)).filter(name => name.endsWith('.dmg'))
if (!artifacts.includes(basename(dmgPath))) throw new Error('notarized DMG disappeared after release verification')
process.stdout.write(`${dmgPath}\n`)
