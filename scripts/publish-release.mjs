#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadataPath = join(repositoryRoot, 'build', 'release', 'release-metadata.json')

function required(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required for release upload`)
  return value
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with status ${code}`)))
  })
}

async function sha256(file) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('end', resolvePromise)
    stream.once('error', reject)
  })
  return hash.digest('hex')
}

const accountId = required('CLOUDFLARE_R2_ACCOUNT_ID')
const accessKey = required('CLOUDFLARE_R2_ACCESS_KEY_ID')
const secretKey = required('CLOUDFLARE_R2_SECRET_ACCESS_KEY')
const bucket = required('MILKSU_R2_BUCKET')
const publishToken = required('MILKSU_RELEASE_PUBLISH_TOKEN')
const releaseAPI = new URL(required('MILKSU_RELEASE_API_URL'))
if (releaseAPI.protocol !== 'https:' || releaseAPI.username || releaseAPI.password) {
  throw new Error('MILKSU_RELEASE_API_URL must be a credential-free HTTPS URL')
}

const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
if (metadata.schema !== 'milksu.release-upload/v1') throw new Error('release metadata schema is unsupported')
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(String(metadata.version ?? ''))) {
  throw new Error('release metadata version is invalid')
}
const expectedPrefix = `releases/stable/darwin/arm64/${metadata.version}/`
for (const key of [metadata.zipObjectKey, metadata.dmgObjectKey, metadata.manifestObjectKey]) {
  if (!String(key ?? '').startsWith(expectedPrefix)
      || !/^[0-9A-Za-z._/-]+$/u.test(key)
      || String(key).slice(expectedPrefix.length).includes('/')) {
    throw new Error('release metadata contains an invalid R2 object key')
  }
}
const releaseDirectory = dirname(metadataPath)
const releaseFile = name => {
  const file = resolve(releaseDirectory, String(name ?? ''))
  if (dirname(file) !== releaseDirectory) throw new Error('release metadata contains an invalid local file name')
  return file
}
const remoteEnvironment = {
  ...process.env,
  RCLONE_CONFIG_R2_TYPE: 's3',
  RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
  RCLONE_CONFIG_R2_ACCESS_KEY_ID: accessKey,
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: secretKey,
  RCLONE_CONFIG_R2_ENDPOINT: `https://${accountId}.r2.cloudflarestorage.com`,
}
const remote = key => `r2:${bucket}/${key}`
const uploads = [
  { local: releaseFile(metadata.files.zip), key: metadata.zipObjectKey, sha256: metadata.zipSha256 },
  { local: releaseFile(metadata.files.dmg), key: metadata.dmgObjectKey, sha256: metadata.dmgSha256 },
  { local: metadataPath, key: metadata.manifestObjectKey, sha256: await sha256(metadataPath) },
]

const readbackRoot = await mkdtemp(join(tmpdir(), 'milksu-release-readback-'))
try {
  for (const upload of uploads) {
    await run('rclone', [
      'copyto', upload.local, remote(upload.key), '--s3-no-check-bucket', '--immutable',
    ], {
      env: remoteEnvironment,
    })
    const readback = join(readbackRoot, basename(upload.key))
    await run('rclone', ['copyto', remote(upload.key), readback, '--s3-no-check-bucket'], {
      env: remoteEnvironment,
    })
    if (await sha256(readback) !== upload.sha256) {
      throw new Error(`R2 readback digest mismatch for ${upload.key}`)
    }
  }
} finally {
  await rm(readbackRoot, { recursive: true, force: true })
}

const draft = {
  channel: metadata.channel,
  platform: metadata.platform,
  arch: metadata.arch,
  version: metadata.version,
  minimumVersion: metadata.minimumVersion,
  commitSha: metadata.commitSha,
  trackingId: metadata.trackingId,
  title: metadata.title,
  notes: metadata.notes,
  zipObjectKey: metadata.zipObjectKey,
  zipSha512: metadata.zipSha512,
  zipSha256: metadata.zipSha256,
  zipSize: metadata.zipSize,
  dmgObjectKey: metadata.dmgObjectKey,
  dmgSha256: metadata.dmgSha256,
  dmgSize: metadata.dmgSize,
}
const response = await fetch(new URL('/v1/internal/releases', releaseAPI), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${publishToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(draft),
})
const payload = await response.json().catch(() => ({}))
if (!response.ok || !payload.release?.id) {
  throw new Error(`Admin release draft creation failed (${response.status}: ${payload.error || 'unknown_error'})`)
}
process.stdout.write(`release draft created: ${payload.release.id} (${payload.release.version})\n`)
