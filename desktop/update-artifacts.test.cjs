'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  createPreparedUpdateFeed,
  downloadUpdateArtifact,
  verifyArtifact,
} = require('./update-artifacts.cjs')

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'milksu-update-artifact-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('download validates the entire body before promoting .part to an installable file', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'update.zip')
  const data = Buffer.alloc(1024, 17)
  let count = 0
  await downloadUpdateArtifact(
    'https://accounts.example/artifact',
    file,
    data.length,
    sha256(data),
    {
      onProgress(received) { count = received },
      fetchImpl: async () => new Response(data),
    },
  )
  await verifyArtifact(file, data.length, sha256(data))
  assert.equal(count, data.length)
  assert.deepEqual(await readFile(file), data)
  assert.deepEqual(await readdir(dir), ['update.zip'])
})

test('wrong hashes, truncation, oversized response and interrupted download leave no installer', async t => {
  const dir = await temporary(t)
  const expected = Buffer.alloc(100, 1)
  const digest = sha256(expected)
  for (const [name, response] of [
    ['hash', () => new Response(Buffer.alloc(100, 2))],
    ['short', () => new Response(Buffer.alloc(90, 1))],
    ['large', () => new Response(Buffer.alloc(101, 1))],
    ['error', () => new Response('<Error>Expired</Error>', { status: 403 })],
    ['length', () => new Response(Buffer.alloc(100, 1), { headers: { 'content-length': '120' } })],
    ['interrupted', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(20))
        controller.error(new Error('offline'))
      },
    }))],
  ]) {
    await assert.rejects(downloadUpdateArtifact(
      'https://accounts.example/artifact',
      path.join(dir, name),
      100,
      digest,
      { fetchImpl: async () => response() },
    ))
    assert.deepEqual(await readdir(dir), [], name)
  }
})

test('private feed serves exactly the verified file without exposing other paths', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'MilkSU-macOS-arm64-26.912.2.zip')
  const content = Buffer.from('prepared archive fixture')
  await writeFile(file, content)
  const feed = await createPreparedUpdateFeed(file, '26.912.2')
  t.after(() => feed.close())
  const info = await (await fetch(`${feed.url}latest-mac.yml?noCache=1`)).json()
  assert.equal(info.version, '26.912.2')
  assert.equal(info.files[0].sha512, createHash('sha512').update(content).digest('base64'))
  assert.deepEqual(Buffer.from(await (await fetch(`${feed.url}${info.files[0].url}`)).arrayBuffer()), content)
  for (const requestPath of ['unknown', '../MilkSU-macOS-arm64-26.912.2.zip', '../../etc/passwd']) {
    assert.equal((await fetch(`${feed.url}${requestPath}`)).status, 404)
  }
  assert.equal((await fetch(`${feed.url}latest-mac.yml`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(new URL('/', feed.url))).status, 404)
})

test('install-time checksum detects a package changed after download', async t => {
  const dir = await temporary(t)
  const file = path.join(dir, 'changed.exe')
  await writeFile(file, 'bad')
  await assert.rejects(verifyArtifact(file, 3, sha256('old')))
})
