'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { writeCompanionSkinFixture } = require('./companion-skin.cjs')
const { createCompanionSkinHost } = require('./companion-skin-host.cjs')

test('folder import, select, and remove stay on the product RPCs', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'milksu-skin-host-'))
  const fixture = await mkdtemp(join(tmpdir(), 'milksu-skin-fixture-'))
  await writeCompanionSkinFixture(fixture, { id: 'loop.skin', name: { zh: '回路皮肤', en: 'Loop skin' } })
  const events = []
  const host = createCompanionSkinHost({
    userDataPath,
    openDirectory: async () => fixture,
    listPetPlugins: async () => [],
    emit: (event, value) => events.push({ event, value }),
  })

  const listed = await host.handleHostMethod('ListCompanionSkins')
  assert.equal(listed.skins[0].id, 'default')
  assert.equal(listed.skins.length, 1)

  const imported = await host.handleHostMethod('ImportCompanionSkin', { directory: fixture })
  assert.equal(imported.canceled, false)
  assert.equal(imported.imported.id, 'imported:loop.skin')
  assert.equal(imported.imported.name.zh, '回路皮肤')

  const resolved = await host.handleHostMethod('GetCompanionSkin', { id: 'imported:loop.skin' })
  assert.match(resolved.frames.idle, /^data:image\/png;base64,/)
  assert.equal(resolved.source, 'imported')

  const notified = host.handleHostMethod('NotifyCompanionSkinChanged', { id: 'imported:loop.skin' })
  assert.equal(notified.id, 'imported:loop.skin')
  assert.equal(events[0].event, 'companion-skin.changed')

  const removed = await host.handleHostMethod('RemoveCompanionSkin', { id: 'imported:loop.skin' })
  assert.equal(removed.skins.length, 1)
  const fallback = await host.handleHostMethod('GetCompanionSkin', { id: 'imported:loop.skin' })
  assert.equal(fallback.factory, true)
})

test('plugin pet packages appear only when the host can read a valid skin.json', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'milksu-skin-plugin-'))
  const pluginDir = await mkdtemp(join(tmpdir(), 'milksu-pet-plugin-'))
  await writeCompanionSkinFixture(pluginDir, { id: 'plugin.skin', name: { zh: '插件皮肤', en: 'Plugin skin' } })
  const host = createCompanionSkinHost({
    userDataPath,
    openDirectory: async () => '',
    listPetPlugins: async () => [{ id: 'pet.plugin', name: 'Pet', directory: pluginDir }],
  })
  const listed = await host.handleHostMethod('ListCompanionSkins')
  assert.equal(listed.skins.some(item => item.id === 'plugin:pet.plugin'), true)
  const resolved = await host.handleHostMethod('GetCompanionSkin', { id: 'plugin:pet.plugin' })
  assert.equal(resolved.source, 'plugin')
  assert.match(resolved.frames.talk, /^data:image\/png;base64,/)
})
