'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, mkdir } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const {
  CompanionSkinError,
  FACTORY_COMPANION_SKIN_ID,
  inspectCompanionPng,
  parseCompanionSkinManifest,
  parseCompanionSkinSelection,
  readCompanionSkinPackage,
  rgbaPng1x1,
  writeCompanionSkinFixture,
} = require('./companion-skin.cjs')

test('factory selection is the reserved default id', () => {
  assert.deepEqual(parseCompanionSkinSelection(''), { id: FACTORY_COMPANION_SKIN_ID, source: 'factory' })
  assert.deepEqual(parseCompanionSkinSelection('imported:loop.skin'), {
    id: 'imported:loop.skin',
    source: 'imported',
    packageId: 'loop.skin',
  })
  assert.deepEqual(parseCompanionSkinSelection('plugin:pet.plugin'), {
    id: 'plugin:pet.plugin',
    source: 'plugin',
    pluginId: 'pet.plugin',
  })
  assert.equal(parseCompanionSkinSelection('../etc').source, 'factory')
})

test('skin.json requires the contract, paired names, and three frames', () => {
  const parsed = parseCompanionSkinManifest({
    api: 'milksu.companion-skin/v1',
    id: 'example.default',
    name: { zh: '默认', en: 'Default' },
    frames: { idle: 'idle.png', talk: 'talk.png', decide: 'decide.png' },
  })
  assert.equal(parsed.id, 'example.default')
  assert.equal(parsed.overlay.think, 'spin')
  assert.equal(parsed.mark.cy, 0.24)
  assert.throws(
    () => parseCompanionSkinManifest({ api: 'milksu.companion-skin/v1', id: 'default', name: { zh: '甲', en: 'A' }, frames: { idle: 'idle.png', talk: 'talk.png', decide: 'decide.png' } }),
    (error) => error instanceof CompanionSkinError && error.code === 'RESERVED_ID',
  )
  assert.throws(
    () => parseCompanionSkinManifest({ api: 'nope', id: 'a', name: { zh: '甲', en: 'A' }, frames: { idle: 'idle.png', talk: 'talk.png', decide: 'decide.png' } }),
    (error) => error.code === 'INVALID_API',
  )
  assert.throws(
    () => parseCompanionSkinManifest({
      api: 'milksu.companion-skin/v1',
      id: 'a',
      name: { zh: '甲', en: 'A' },
      frames: { idle: '../idle.png', talk: 'talk.png', decide: 'decide.png' },
    }),
    (error) => error.code === 'UNSAFE_PATH',
  )
})

test('PNG frames must be transparent and within the contract size', () => {
  const png = rgbaPng1x1()
  assert.equal(inspectCompanionPng(png).width, 1)
  assert.throws(() => inspectCompanionPng(Buffer.from('not-png')), (error) => error.code === 'INVALID_IMAGE')
})

test('readCompanionSkinPackage loads a fixture folder', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-skin-'))
  const written = await writeCompanionSkinFixture(directory, { id: 'loop.skin', think: true })
  const parsed = await readCompanionSkinPackage(directory)
  assert.equal(parsed.id, 'loop.skin')
  assert.equal(written.frames.think, 'think.png')
  assert.ok(parsed.buffers.idle.length > 0)
  assert.ok(parsed.buffers.think.length > 0)
})

test('missing decide frame is a package error, not a silent fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-skin-missing-'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'skin.json'), JSON.stringify({
    api: 'milksu.companion-skin/v1',
    id: 'broken.skin',
    name: { zh: '坏', en: 'Broken' },
    frames: { idle: 'idle.png', talk: 'talk.png', decide: 'decide.png' },
  }))
  await writeFile(join(directory, 'idle.png'), rgbaPng1x1())
  await writeFile(join(directory, 'talk.png'), rgbaPng1x1())
  await assert.rejects(
    () => readCompanionSkinPackage(directory),
    (error) => error instanceof CompanionSkinError && error.code === 'MISSING_FRAMES',
  )
})
