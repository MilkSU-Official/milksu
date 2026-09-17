'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const test = require('node:test')
const { UpdateManager, versionNewer, desktopInstallBlocker, installError } = require('./update-manager.cjs')

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
    const downloadedFile = path.join(tmpdir(), 'milksu-fake-updater-download.bin')
    await writeFile(downloadedFile, ZIP_BYTES)
    this.downloadedFile = downloadedFile
    this.emit('update-downloaded', { version: '0.2.0', downloadedFile })
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

const ZIP_BYTES = Buffer.from('verified-zip-bytes')
const ZIP_SHA256 = createHash('sha256').update(ZIP_BYTES).digest('hex')

function latestRelease(downloads = {
  zip: {
    url: 'https://accounts.milksu.org/v1/releases/download/r1/zip',
    sha256: ZIP_SHA256,
    size: ZIP_BYTES.length,
  },
}) {
  return {
    version: '0.2.0',
    title: 'MilkSU 0.2.0',
    notes: '登录后安全下载更新。',
    publishedAt: '2026-08-13T12:00:00.000Z',
    downloads,
  }
}

function artifactFetch(url) {
  if (String(url).includes('/latest')) {
    return jsonResponse(200, { release: latestRelease() })
  }
  return {
    ok: true,
    status: 200,
    body: Readable.from([ZIP_BYTES]),
    headers: { 'content-length': String(ZIP_BYTES.length) },
  }
}

async function managerOptions(overrides = {}) {
  const userDataPath = overrides.userDataPath
    || await mkdtemp(path.join(tmpdir(), 'milksu-update-'))
  return {
    updater: new FakeUpdater(),
    currentVersion: '0.1.0',
    enabled: true,
    platform: 'darwin',
    arch: 'arm64',
    apiUrl: 'https://accounts.milksu.org',
    userDataPath,
    execPath: '/Applications/MilkSU.app/Contents/MacOS/MilkSU',
    getAuthorization: async () => 'desktop-session-secret',
    fetchImpl: artifactFetch,
    ...overrides,
    userDataPath,
  }
}

test('blocks macOS install from a disk image or unpackaged binary', () => {
  assert.equal(desktopInstallBlocker({
    platform: 'darwin',
    execPath: '/Volumes/MilkSU/MilkSU.app/Contents/MacOS/MilkSU',
  })?.code, 'not_installed_app')
  assert.equal(desktopInstallBlocker({
    platform: 'darwin',
    execPath: '/usr/local/bin/milksu',
  })?.code, 'not_installed_app')
  assert.equal(desktopInstallBlocker({
    platform: 'darwin',
    execPath: '/Applications/MilkSU.app/Contents/MacOS/MilkSU',
  }), null)
  assert.equal(desktopInstallBlocker({
    platform: 'darwin',
    execPath: '/private/var/folders/xx/AppTranslocation/MilkSU.app/Contents/MacOS/MilkSU',
  })?.code, 'not_installed_app')
  assert.equal(desktopInstallBlocker({
    platform: 'win32',
    execPath: 'C:\\Program Files\\MilkSU\\MilkSU.exe',
  }), null)
})

test('macOS prefers the notarized DMG and prepares it before ShipIt', async () => {
  const dmg = Buffer.from('notarized-dmg')
  const dmgSha = createHash('sha256').update(dmg).digest('hex')
  const prepared = []
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'milksu-update-'))
  const manager = new UpdateManager(await managerOptions({
    userDataPath,
    prepareMac: async (file, directory, currentApp, version) => {
      prepared.push({ file, currentApp, version })
      const zip = path.join(directory, 'MilkSU-arm64.zip')
      await writeFile(zip, ZIP_BYTES)
      return zip
    },
    fetchImpl: async (url) => {
      if (String(url).includes('/latest')) {
        return jsonResponse(200, {
          release: latestRelease({
            dmg: {
              url: 'https://accounts.milksu.org/v1/releases/download/r1/dmg',
              sha256: dmgSha,
              size: dmg.length,
            },
            zip: {
              url: 'https://accounts.milksu.org/v1/releases/download/r1/zip',
              sha256: ZIP_SHA256,
              size: ZIP_BYTES.length,
            },
          }),
        })
      }
      return {
        ok: true,
        status: 200,
        body: Readable.from([dmg]),
        headers: { 'content-length': String(dmg.length) },
      }
    },
  }))
  try {
    assert.equal((await manager.check()).state, 'available')
    assert.equal((await manager.download()).state, 'downloaded')
    assert.equal(prepared.length, 1)
    assert.match(prepared[0].file, /MilkSU-macOS-arm64-0\.2\.0\.dmg$/u)
    assert.equal(prepared[0].currentApp, '/Applications/MilkSU.app')
    assert.equal(prepared[0].version, '0.2.0')
    assert.equal(await manager.install(), true)
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('maps ShipIt quarantine failures to a writable-install error', () => {
  assert.equal(installError(new Error('Permission denied: quarantine')).code, 'install_permission')
  assert.equal(installError(new Error('other')).code, 'install_failed')
})

test('compares milkSU calendar versions', () => {
  assert.equal(versionNewer('26.826.1', '26.825.1'), true)
  assert.equal(versionNewer('26.825.1', '26.825.1'), false)
  assert.equal(versionNewer('26.824.1', '26.825.1'), false)
})

test('checks and downloads updates through a verified local feed', async () => {
  const events = []
  let seenAuth = ''
  const options = await managerOptions({
    onChanged: value => events.push(value),
    fetchImpl: async (url, init) => {
      seenAuth = init?.headers?.authorization || seenAuth
      return artifactFetch(url)
    },
  })
  const manager = new UpdateManager(options)
  try {
    const available = await manager.check()
    assert.equal(available.state, 'available')
    assert.equal(available.version, '0.2.0')
    assert.equal(seenAuth, 'Bearer desktop-session-secret')
    assert.doesNotMatch(JSON.stringify(events), /desktop-session-secret/u)

    const downloaded = await manager.download()
    assert.equal(downloaded.state, 'downloaded')
    assert.equal(events.some(event => event.state === 'downloading' && event.phase === 'checking'), true)
    assert.equal(events.some(event => event.state === 'downloading' && event.phase === 'downloading'), true)
    assert.equal(events.some(event => event.state === 'downloading' && event.phase === 'verifying'), true)
    assert.equal(events.some(event => event.state === 'downloading' && event.phase === 'preparing'), true)
    assert.equal(events.some(event => event.state === 'downloaded' && event.percent === 100), true)
    assert.match(options.updater.feed.url, /^http:\/\/127\.0\.0\.1:\d+\//u)
    assert.equal(options.updater.feed.useMultipleRangeRequest, false)
    assert.equal(await manager.install(), true)
    assert.deepEqual(options.updater.installArguments, [true, true])
    manager.clearAuthorization()
    assert.equal(manager.view().state, 'idle')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('surfaces a visible error when macOS is not running an installed app bundle', async () => {
  const options = await managerOptions({
    execPath: '/Volumes/MilkSU/MilkSU.app/Contents/MacOS/MilkSU',
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'available')
    assert.equal((await manager.download()).state, 'downloaded')
    assert.equal(await manager.install(), false)
    assert.equal(manager.view().state, 'error')
    assert.equal(manager.view().code, 'not_installed_app')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('reports the running version when polling Admin for the latest release', async () => {
  let polled = ''
  const options = await managerOptions({
    fetchImpl: async (url) => {
      polled = String(url)
      return jsonResponse(404, { release: null })
    },
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'idle')
    assert.match(polled, /\/v1\/releases\/latest\?/)
    assert.match(polled, /platform=darwin/)
    assert.match(polled, /arch=arm64/)
    assert.match(polled, /current=0\.1\.0/)
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('does not contact the feed or expose a prompt without an active account token', async () => {
  let fetches = 0
  const options = await managerOptions({
    getAuthorization: async () => '',
    fetchImpl: async () => {
      fetches += 1
      return jsonResponse(200, { release: { version: '0.2.0' } })
    },
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'idle')
    assert.equal(fetches, 0)
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('keeps updater disabled in development and Beta identities', async () => {
  const options = await managerOptions({ enabled: false })
  const manager = new UpdateManager(options)
  try {
    assert.deepEqual(await manager.check(), {
      state: 'idle',
      currentVersion: '0.1.0',
      enabled: false,
    })
    assert.equal(await manager.install(), false)
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('stays idle when Admin latest has no downloadable artifact', async () => {
  const options = await managerOptions({
    fetchImpl: async () => jsonResponse(200, {
      release: {
        version: '0.2.0',
        title: 'MilkSU 0.2.0',
        publishedAt: '2026-08-13T12:00:00.000Z',
        downloads: {},
      },
    }),
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'idle')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('does not mark the update ready when electron-updater emits update-downloaded early', async () => {
  const seen = []
  let manager
  const options = await managerOptions({
    downloadArtifact: async (url, file, size, sha256, hooks) => {
      options.updater.emit('update-downloaded', {
        version: '0.2.0',
        downloadedFile: path.join(options.userDataPath, 'early.bin'),
      })
      seen.push(manager.view().state)
      return require('./update-artifacts.cjs').downloadUpdateArtifact(url, file, size, sha256, hooks)
    },
  })
  manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'available')
    const downloaded = await manager.download()
    assert.deepEqual(seen, ['downloading'])
    assert.equal(downloaded.state, 'downloaded')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('cancel aborts an in-flight download without installing', async () => {
  const options = await managerOptions({
    downloadArtifact: (_url, _file, _size, _sha256, hooks) => new Promise((_, reject) => {
      const signal = hooks?.signal
      if (!signal) {
        reject(new Error('missing abort signal'))
        return
      }
      if (signal.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        return
      }
      signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }, { once: true })
    }),
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'available')
    const pending = manager.download()
    await new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (manager.view().state === 'downloading') {
          clearInterval(timer)
          resolve()
          return
        }
        if (Date.now() - started > 1000) {
          clearInterval(timer)
          reject(new Error('download did not start'))
        }
      }, 5)
    })
    manager.cancel()
    const failed = await pending
    assert.equal(failed.state, 'error')
    assert.equal(failed.code, 'cancelled')
    assert.equal(await manager.install(), false)
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('surfaces a visible error when the updater feed check fails', async () => {
  const updater = new FakeUpdater()
  updater.checkForUpdates = async () => {
    const error = new Error('release feed unavailable')
    updater.emit('error', error)
    throw error
  }
  const options = await managerOptions({ updater })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'available')
    const failed = await manager.download()
    assert.equal(failed.state, 'error')
    assert.equal(failed.code, 'download_failed')
    assert.equal(failed.message, '更新下载失败，请稍后重试')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('stays idle when Admin has no matching platform/arch pointer', async () => {
  const options = await managerOptions({
    platform: 'linux',
    arch: 'x64',
    fetchImpl: async () => jsonResponse(404, { release: null }),
    classifyLinux: () => ({ kind: 'deb', execPath: '/opt/MilkSU/milksu', prefix: '/opt/MilkSU' }),
  })
  const manager = new UpdateManager(options)
  try {
    assert.equal((await manager.check()).state, 'idle')
  } finally {
    await rm(options.userDataPath, { recursive: true, force: true })
  }
})

test('linux downloads the deb for a dpkg install and applies via the helper', async () => {
  const body = Buffer.from('deb-bytes')
  const sha256 = require('node:crypto').createHash('sha256').update(body).digest('hex')
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'milksu-update-'))
  const applied = []
  const manager = new UpdateManager(await managerOptions({
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
    assert.equal(await manager.install(), true)
    assert.equal(applied.length, 1)
    assert.equal(applied[0].plan.installKind, 'deb')
  } finally {
    await rm(userDataPath, { recursive: true, force: true })
  }
})
