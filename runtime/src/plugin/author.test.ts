import assert from 'node:assert/strict'
import { lstat, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createPluginTemplate,
  generatePublisherKey,
  packPlugin,
  testPluginSource,
  verifyPluginPackage,
} from './author.ts'

const worker = join(dirname(fileURLToPath(import.meta.url)), '../../../sidecar/plugin-runtime/worker.mjs')

test('generatePublisherKey writes an exclusive publisher key file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-plugin-author-'))
  const path = join(root, 'publisher-key.json')
  const descriptor = await generatePublisherKey('MilkSU Plugin Gate', path)
  assert.equal(descriptor.publisher, 'MilkSU Plugin Gate')
  assert.match(descriptor.key_id, /^[a-f0-9]{64}$/)
  assert.equal(descriptor.path, path)
  const parsed = JSON.parse(await readFile(path, 'utf8')) as {
    schema: string
    publisher: string
    keyId: string
    publicKey: string
    privateKey: string
  }
  assert.equal(parsed.schema, 'milksu.publisher-key/v1')
  assert.equal(parsed.publisher, 'MilkSU Plugin Gate')
  assert.equal(parsed.keyId, descriptor.key_id)
  assert.ok(parsed.publicKey)
  assert.ok(parsed.privateKey)
  if (process.platform !== 'win32') {
    const info = await lstat(path)
    assert.equal(info.mode & 0o777, 0o600)
  }
  await assert.rejects(() => generatePublisherKey('MilkSU Plugin Gate', path), /already exists/)
})

test('pack and verify round-trip a TypeScript plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-plugin-author-'))
  const keyPath = join(root, 'publisher-key.json')
  const key = await generatePublisherKey('MilkSU Plugin Gate', keyPath)
  const source = join(root, 'gate.tools')
  await createPluginTemplate({
    runtime: 'typescript',
    id: 'gate.tools',
    name: 'Gate Tools',
    publisher: key.publisher,
    keyId: key.key_id,
    out: source,
  })
  const first = join(root, 'gate-tools-a.milksu-plugin')
  const second = join(root, 'gate-tools-b.milksu-plugin')
  const packed = await packPlugin(source, first, [keyPath])
  assert.equal(packed.manifest.id, 'gate.tools')
  assert.equal(packed.compatible, true)
  assert.equal(packed.signers?.length, 1)
  assert.equal(packed.signers?.[0], key.key_id)
  await packPlugin(source, second, [keyPath])
  const left = await readFile(first)
  const right = await readFile(second)
  assert.equal(left.equals(right), true)
  const inspection = await verifyPluginPackage(first, '26.823.1')
  assert.equal(inspection.compatible, true)
  assert.equal(inspection.manifest.id, 'gate.tools')
  assert.equal(inspection.signers?.length, 1)
  const health = await testPluginSource(source, {
    hostVersion: '26.823.1',
    nodeExecutable: process.execPath,
    typeScriptWorker: worker,
  })
  assert.equal(health.manifest.id, 'gate.tools')
  assert.equal(health.compatible, true)
})

test('createPluginTemplate rejects an existing output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'milksu-plugin-author-'))
  const keyPath = join(root, 'publisher-key.json')
  const key = await generatePublisherKey('MilkSU Plugin Gate', keyPath)
  const out = join(root, 'gate.skin')
  await createPluginTemplate({
    runtime: 'lua',
    id: 'gate.skin',
    name: 'Gate Skin',
    publisher: key.publisher,
    keyId: key.key_id,
    out,
  })
  await assert.rejects(() => createPluginTemplate({
    runtime: 'lua',
    id: 'gate.skin',
    name: 'Gate Skin',
    publisher: key.publisher,
    keyId: key.key_id,
    out,
  }), /already exists/)
})
