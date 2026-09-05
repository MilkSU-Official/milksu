'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const test = require('node:test')
const { UpdateManager, versionNewer } = require('./update-manager.cjs')

class FakeUpdater extends EventEmitter {
  constructor() {
    super()
    this.feed = null
    this.updateInfoAndProvider = null
  }

  setFeedURL(value) {
    this.feed = value
  }

  async checkForUpdates() {
    this.emit('checking-for-update')
    const updateInfo = {
      version: '0.2.0',
      releaseName: 'MilkSU 0.2.0',
      releaseNotes: '登录后安全下载更新。',
      releaseDate: '2026-08-13T12:00:00.000Z',
    }
    this.updateInfoAndProvider = { info: updateInfo }
    this.emit('update-available', updateInfo)
    return { isUpdateAvailable: true, updateInfo }
  }

  async downloadUpdate() {
    if (!this.updateInfoAndProvider) {
      const error = new Error('Please check update first')
      this.emit('error', error)
      throw error
    }
    this.emit('download-progress', { percent: 42, transferred: 42, total: 100 })
    this.emit('update-downloaded', { version: '0.2.0' })
  }

  quitAndInstall(silent, forceRunAfter) {
    this.installArguments = [silent, forceRunAfter]
  }
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

function managerOptions(overrides = {}) {
  return {
    updater: new FakeUpdater(),
    currentVersion: '0.1.0',
    enabled: true,
    platform: 'darwin',
    arch: 'arm64',
    apiUrl: 'https://accounts.milksu.org',
    userDataPath: '/var/folders/xx/milksu',
    getAuthorization: async () => 'desktop-session-secret',
    fetchImpl: async () => jsonResponse(200, {
      release: {
        version: '0.2.0',
        title: 'MilkSU 0.2.0',
        notes: '登录后安全下载更新。',
        publishedAt: '2026-08-13T12:00:00.000Z',
        downloads: {
          zip: { url: 'https://accounts.milksu.org/v1/releases/download/r1/zip', sha256: 'ab', sha512: 'cd', size: 10 },
        },
      },
    }),
    ...overrides,
  }
}

test('compares milkSU calendar versions', () => {
  assert.equal(versionNewer('26.826.1', '26.825.1'), true)
  assert.equal(versionNewer('26.825.1', '26.825.1'), false)
  assert.equal(versionNewer('26.824.1', '26.825.1'), false)
})

test('checks and downloads updates with a main-process authorization header', async () => {
  const events = []
  const options = managerOptions({ onChanged: value => events.push(value) })
  const manager = new UpdateManager(options)
  const available = await manager.check()
  assert.equal(available.state, 'available')
  assert.equal(available.version, '0.2.0')
  assert.deepEqual(options.updater.requestHeaders, { authorization: 'Bearer desktop-session-secret' })
  assert.doesNotMatch(JSON.stringify(events), /desktop-session-secret/u)

  const downloaded = await manager.download()
  assert.equal(downloaded.state, 'downloaded')
  assert.equal(events.some(event => event.state === 'downloading' && event.percent === 42), true)
  assert.equal(options.updater.feed.url, 'https://accounts.milksu.org/v1/releases/feed/stable/darwin/arm64')
  assert.equal(manager.install(), true)
  assert.deepEqual(options.updater.installArguments, [false, true])
  manager.clearAuthorization()
  assert.equal(options.updater.requestHeaders, undefined)
  assert.equal(manager.view().state, 'idle')
})

test('reports the running version when polling Admin for the latest release', async () => {
  let polled = ''
  const manager = new UpdateManager(managerOptions({
    fetchImpl: async (url) => {
      polled = String(url)
      return jsonResponse(404, { release: null })
    },
  }))
  assert.equal((await manager.check()).state, 'idle')
  assert.match(polled, /\/v1\/releases\/latest\?/)
  assert.match(polled, /platform=darwin/)
  assert.match(polled, /arch=arm64/)
  assert.match(polled, /current=0\.1\.0/)
})

test('does not contact the feed or expose a prompt without an active account token', async () => {
  let fetches = 0
  const manager = new UpdateManager(managerOptions({
    getAuthorization: async () => '',
    fetchImpl: async () => {
      fetches += 1
      return jsonResponse(200, { release: { version: '0.2.0' } })
    },
  }))
  assert.equal((await manager.check()).state, 'idle')
  assert.equal(fetches, 0)
  assert.equal(manager.updater.requestHeaders, undefined)
})

test('keeps updater disabled in development and Beta identities', async () => {
  const manager = new UpdateManager(managerOptions({ enabled: false }))
  assert.deepEqual(await manager.check(), {
    state: 'idle',
    currentVersion: '0.1.0',
    enabled: false,
  })
  assert.equal(manager.install(), false)
})

test('stays idle when Admin latest has no downloadable artifact', async () => {
  const manager = new UpdateManager(managerOptions({
    fetchImpl: async () => jsonResponse(200, {
      release: {
        version: '0.2.0',
        title: 'MilkSU 0.2.0',
        publishedAt: '2026-08-13T12:00:00.000Z',
        downloads: {},
      },
    }),
  }))
  assert.equal((await manager.check()).state, 'idle')
})

test('surfaces a visible error when the updater feed check fails', async () => {
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => {
    const error = new Error('release feed unavailable')
    updater.emit('error', error)
    throw error
  }
  const manager = new UpdateManager(managerOptions({ updater }))
  assert.equal((await manager.check()).state, 'available')
  const failed = await manager.download()
  assert.equal(failed.state, 'error')
  assert.equal(failed.code, 'download_failed')
  assert.equal(failed.message, '更新下载失败，请稍后重试')
})

test('stays idle when Admin has no matching platform/arch pointer', async () => {
  const manager = new UpdateManager(managerOptions({
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async () => jsonResponse(404, { release: null }),
    classifyLinux: () => ({ kind: 'deb', execPath: '/opt/MilkSU/milksu', prefix: '/opt/MilkSU' }),
  }))
  assert.equal((await manager.check()).state, 'idle')
})

test('linux downloads the deb for a dpkg install and applies via the helper', async () => {
  const body = Buffer.from('deb-bytes')
  const sha256 = require('node:crypto').createHash('sha256').update(body).digest('hex')
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'milksu-update-'))
  const applied = []
  const manager = new UpdateManager(managerOptions({
    platform: 'linux',
    arch: 'x64',
    userDataPath,
    updater: new FakeUpdater(),
    classifyLinux: () => ({ kind: 'deb', execPath: '/opt/MilkSU/milksu', prefix: '/opt/MilkSU' }),
    buildLinuxPlan: () => ({
      ok: true,
      installKind: 'deb',
      shell: '/bin/sh',
      relaunch: '/opt/MilkSU/milksu',
      commands: [['/usr/bin/pkexec', '/usr/bin/dpkg', '--install', 'artifact.deb']],
    }),
    applyLinux: plan => { applied.push(plan) },
    fetchImpl: async (url) => {
      if (String(url).includes('/latest')) {
        return jsonResponse(200, {
          release: {
            version: '0.2.0',
            title: 'MilkSU 0.2.0',
            notes: 'linux',
            downloads: {
              deb: {
                url: 'https://accounts.milksu.org/v1/releases/download/r1/deb',
                sha256,
                size: body.length,
              },
            },
          },
        })
      }
      return {
        ok: true,
        status: 200,
        body: Readable.from([body]),
      }
    },
  }))
  try {
    const available = await manager.check()
    assert.equal(available.state, 'available')
    const downloaded = await manager.download()
    assert.equal(downloaded.state, 'downloaded')
    assert.equal(manager.install(), true)
    assert.equal(applied.length, 1)
    assert.equal(applied[0].plan.installKind, 'deb')
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})
