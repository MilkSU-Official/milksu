'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { UpdateManager } = require('./update-manager.cjs')

class FakeUpdater extends EventEmitter {
  async checkForUpdates() {
    this.emit('checking-for-update')
    this.emit('update-available', {
      version: '0.2.0',
      releaseName: 'MilkSU 0.2.0',
      releaseNotes: '登录后安全下载更新。',
      releaseDate: '2026-08-13T12:00:00.000Z',
    })
  }

  async downloadUpdate() {
    this.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
    this.emit('update-downloaded', { version: '0.2.0' })
  }

  quitAndInstall(silent, forceRunAfter) {
    this.installArguments = [silent, forceRunAfter]
  }
}

test('checks and downloads updates with a main-process authorization header', async () => {
  const updater = new FakeUpdater()
  const events = []
  const manager = new UpdateManager({
    updater,
    currentVersion: '0.1.0',
    enabled: true,
    getAuthorization: async () => 'desktop-session-secret',
    onChanged: value => events.push(value),
  })

  const available = await manager.check()
  assert.equal(available.state, 'available')
  assert.equal(available.version, '0.2.0')
  assert.deepEqual(updater.requestHeaders, { authorization: 'Bearer desktop-session-secret' })
  assert.doesNotMatch(JSON.stringify(events), /desktop-session-secret/u)

  const downloaded = await manager.download()
  assert.equal(downloaded.state, 'downloaded')
  assert.equal(events.some(event => event.state === 'downloading' && event.percent === 42), true)
  assert.equal(manager.install(), true)
  assert.deepEqual(updater.installArguments, [false, true])
  manager.clearAuthorization()
  assert.equal(updater.requestHeaders, undefined)
  assert.equal(manager.view().state, 'idle')
})

test('does not contact the feed or expose a prompt without an active account token', async () => {
  const updater = new FakeUpdater()
  let checks = 0
  updater.checkForUpdates = async () => { checks += 1 }
  const manager = new UpdateManager({
    updater,
    currentVersion: '0.1.0',
    enabled: true,
    getAuthorization: async () => '',
  })
  assert.equal((await manager.check()).state, 'idle')
  assert.equal(checks, 0)
  assert.equal(updater.requestHeaders, undefined)
})

test('keeps updater disabled in development and Beta identities', async () => {
  const updater = new FakeUpdater()
  const manager = new UpdateManager({
    updater,
    currentVersion: '0.1.0',
    enabled: false,
    getAuthorization: async () => 'unused',
  })
  assert.deepEqual(await manager.check(), {
    state: 'idle',
    currentVersion: '0.1.0',
    enabled: false,
  })
  assert.equal(manager.install(), false)
})
