#!/usr/bin/env node

/**
 * Local Developer ID macOS release.
 *
 * Loads signing assets from the Personal Vault (never prints secret values),
 * imports the .p12 into an ephemeral Keychain, runs desktop:release:mac, then
 * deletes the temp Keychain. Prefer this over GitHub-hosted macOS runners.
 *
 * Usage (after release:verify on a clean pushed main):
 *   npm run release:mac:local -- \
 *     --release-title "MilkSU 26.818.1 内测版" \
 *     --release-notes "…"
 */

import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultVault = join(homedir(), 'Documents', 'MilkSU Personal Vault')

function option(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function loadVaultEnv(vaultDir) {
  const envPath = join(vaultDir, 'macos-signing-secrets.env')
  const env = {}
  const stream = createReadStream(envPath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env,
    })
    child.once('error', rejectPromise)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${command} exited with status ${code}`)))
  })
}

async function listUserKeychains() {
  const { stdout } = await execFileAsync('/usr/bin/security', ['list-keychains', '-d', 'user'])
  return stdout
    .split('\n')
    .map(line => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

async function main() {
  const vaultDir = option('vault', process.env.MILKSU_SIGNING_VAULT || defaultVault)
  const vault = await loadVaultEnv(vaultDir)
  const required = [
    'MACOS_CSC_LINK_FILE',
    'MACOS_CSC_KEY_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY_FILE',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]
  for (const key of required) {
    if (!String(vault[key] ?? '').trim()) {
      throw new Error(`Personal Vault macos-signing-secrets.env missing ${key}`)
    }
  }

  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const version = String(rootPackage.version ?? '')
  const tempDir = await mkdtemp(join(tmpdir(), 'milksu-signing.'))
  const keychain = join(tempDir, 'milksu-signing.keychain-db')
  const keychainPassword = randomBytes(24).toString('hex')
  const p12 = join(vaultDir, vault.MACOS_CSC_LINK_FILE)
  const apiKey = join(tempDir, `AuthKey_${vault.APPLE_API_KEY_ID}.p8`)
  await copyFile(join(vaultDir, vault.APPLE_API_KEY_FILE), apiKey)
  await execFileAsync('/bin/chmod', ['600', apiKey])

  const previousKeychains = await listUserKeychains()
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    try {
      await execFileAsync('/usr/bin/security', ['delete-keychain', keychain])
    } catch {
      // Already removed.
    }
    try {
      if (previousKeychains.length) {
        await execFileAsync('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...previousKeychains])
      }
    } catch {
      // Best effort restore.
    }
    await rm(tempDir, { recursive: true, force: true })
  }
  process.on('exit', () => {
    // Sync best-effort; async cleanup also runs in finally.
  })
  process.on('SIGINT', () => {
    void cleanup().finally(() => process.exit(130))
  })

  try {
    await execFileAsync('/usr/bin/security', ['create-keychain', '-p', keychainPassword, keychain])
    await execFileAsync('/usr/bin/security', ['set-keychain-settings', '-lut', '21600', keychain])
    await execFileAsync('/usr/bin/security', ['unlock-keychain', '-p', keychainPassword, keychain])
    await execFileAsync('/usr/bin/security', [
      'import', p12, '-k', keychain, '-P', vault.MACOS_CSC_KEY_PASSWORD,
      '-T', '/usr/bin/codesign', '-T', '/usr/bin/security',
    ])
    await execFileAsync('/usr/bin/security', [
      'set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychain,
    ])
    await execFileAsync('/usr/bin/security', [
      'list-keychains', '-d', 'user', '-s', keychain, ...previousKeychains,
    ])

    const { stdout: identities } = await execFileAsync('/usr/bin/security', [
      'find-identity', '-v', '-p', 'codesigning', keychain,
    ])
    const identity = identities
      .split('\n')
      .map(line => line.match(/"(Developer ID Application:[^"]+)"/)?.[1])
      .find(Boolean)
    if (!identity) {
      throw new Error('Developer ID Application identity not found after importing Personal Vault .p12')
    }
    process.stdout.write(`Using local signing identity: ${identity}\n`)

    const env = {
      ...process.env,
      MILKSU_CODESIGN_IDENTITY: identity,
      APPLE_TEAM_ID: vault.APPLE_TEAM_ID,
      APPLE_API_KEY_PATH: apiKey,
      APPLE_API_KEY_ID: vault.APPLE_API_KEY_ID,
      APPLE_API_ISSUER: vault.APPLE_API_ISSUER,
      MILKSU_ACCOUNT_API_URL: process.env.MILKSU_ACCOUNT_API_URL || 'https://accounts.milksu.org',
      MILKSU_RELEASE_TITLE: option('release-title', `MilkSU ${version} 内测版`),
      MILKSU_RELEASE_NOTES: option('release-notes', `MilkSU ${version} 内测版`),
      MILKSU_MINIMUM_UPDATE_VERSION: option('minimum-version', '0.1.0'),
      MILKSU_BUILD_OTA: process.argv.includes('--upload-release') ? '1' : '0',
    }

    await run('npm', ['run', 'desktop:release:mac'], env)
    const desktopPackage = JSON.parse(
      await readFile(join(repositoryRoot, 'desktop', 'package.json'), 'utf8'),
    )
    const version = String(desktopPackage.version ?? '').trim()
    process.stdout.write(
      `${join(repositoryRoot, 'build', 'release', `MilkSU-macOS-arm64-${version}.dmg`)}\n`,
    )
  } finally {
    await cleanup()
  }
}

await main()
