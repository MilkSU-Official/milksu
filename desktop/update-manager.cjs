'use strict'

const { createHash } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { mkdir, mkdtemp, readFile, unlink, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const {
  buildLinuxInstallPlan,
  classifyLinuxInstall,
  linuxArtifactKind,
  spawnLinuxApply,
} = require('./linux-update-apply.cjs')
const {
  createPreparedUpdateFeed,
  downloadUpdateArtifact,
  removeUpdateDirectory,
  verifyArtifact,
} = require('./update-artifacts.cjs')

const UPDATE_STATES = new Set(['idle', 'checking', 'available', 'downloading', 'downloaded', 'error'])
const POLL_MS = 60_000

function boundedText(value, limit) {
  return String(value ?? '').replace(/\0/gu, '').trim().slice(0, limit)
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return boundedText(value.map(item => item?.note ?? item).filter(Boolean).join('\n'), 5000)
  }
  return boundedText(value, 5000)
}

function parseVersion(value) {
  return boundedText(value, 64).split('.').map(part => Number.parseInt(part, 10) || 0)
}

function versionNewer(latest, current) {
  const left = parseVersion(latest)
  const right = parseVersion(current)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] || 0
    const b = right[index] || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

function updaterPlatform(platform) {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform
  return ''
}

function updaterArch(arch) {
  if (arch === 'arm64' || arch === 'x64') return arch
  return ''
}

function desktopInstallBlocker({ platform, execPath }) {
  if (platform !== 'darwin') return null
  const path = String(execPath || '')
  if (
    /\/Volumes\//u.test(path)
    || path.includes('/AppTranslocation/')
    || !/\.app\/Contents\/MacOS\//u.test(path)
  ) {
    return {
      code: 'not_installed_app',
      message: '请先把 MilkSU 安装到应用程序文件夹，再安装这次更新',
    }
  }
  return null
}

class UpdateManager {
  constructor({
    updater,
    currentVersion,
    enabled,
    platform = process.platform,
    arch = process.arch,
    apiUrl = '',
    userDataPath = '',
    execPath = process.execPath,
    getAuthorization,
    fetchImpl = fetch,
    classifyLinux = classifyLinuxInstall,
    buildLinuxPlan = buildLinuxInstallPlan,
    applyLinux = spawnLinuxApply,
    downloadArtifact = downloadUpdateArtifact,
    verifyDownloaded = verifyArtifact,
    createFeed = createPreparedUpdateFeed,
    now = () => Date.now(),
    onChanged = () => {},
    pollIntervalMs = POLL_MS,
  }) {
    this.updater = updater
    this.currentVersion = boundedText(currentVersion, 64)
    this.platform = updaterPlatform(platform)
    this.arch = updaterArch(arch)
    this.apiUrl = boundedText(apiUrl, 300).replace(/\/$/u, '')
    this.userDataPath = userDataPath
    this.execPath = execPath
    this.getAuthorization = getAuthorization
    this.fetchImpl = fetchImpl
    this.classifyLinux = classifyLinux
    this.buildLinuxPlan = buildLinuxPlan
    this.applyLinux = applyLinux
    this.downloadArtifact = downloadArtifact
    this.verifyDownloaded = verifyDownloaded
    this.createFeed = createFeed
    this.now = now
    this.onChanged = onChanged
    this.pollIntervalMs = Number(pollIntervalMs) > 0 ? Number(pollIntervalMs) : POLL_MS
    this.linuxInstall = this.platform === 'linux'
      ? this.classifyLinux({ execPath: this.execPath })
      : null
    this.enabled = enabled === true && Boolean(this.platform && this.arch && this.apiUrl)
    this.status = {
      state: 'idle',
      currentVersion: this.currentVersion,
      enabled: this.enabled,
    }
    this.release = null
    this.checkPromise = null
    this.downloadRequested = false
    this.pollTimer = null
    this.downloadedPath = ''
    this.verified = null
    this.feed = null
    this.updateDirectory = ''
    if (!this.enabled) return

    if (this.updater && this.platform !== 'linux') {
      this.updater.autoDownload = false
      this.updater.autoInstallOnAppQuit = false
      this.updater.autoRunAppAfterInstall = true
      this.updater.allowDowngrade = false
      this.updater.disableDifferentialDownload = true
      this.updater.logger = null
      this.updater.on('download-progress', progress => {
        this.setStatus({
          state: 'downloading',
          percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
          transferred: Math.max(0, Number(progress?.transferred) || 0),
          total: Math.max(0, Number(progress?.total) || 0),
        })
      })
      this.updater.on('update-downloaded', info => {
        this.setStatus({
          state: 'downloaded',
          version: boundedText(info?.version, 64) || this.status.version,
        })
      })
      this.updater.on('error', () => {
        if (!this.downloadRequested) {
          this.setStatus({ state: 'idle' }, false)
          return
        }
        this.setStatus({
          state: 'error',
          code: 'download_failed',
          message: '更新下载失败，请稍后重试',
        })
      })
    }
  }

  view() {
    return { ...this.status }
  }

  setStatus(next, notify = true) {
    if (!UPDATE_STATES.has(next.state)) return
    this.status = {
      ...this.status,
      ...next,
      currentVersion: this.currentVersion,
      enabled: this.enabled,
    }
    if (notify) this.onChanged(this.view())
  }

  async authorize() {
    const token = boundedText(await this.getAuthorization(), 4096)
    if (!token) return ''
    return token
  }

  startPolling() {
    if (!this.enabled || this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (['downloading', 'downloaded'].includes(this.status.state)) return
      void this.check()
    }, this.pollIntervalMs)
  }

  stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async discardPreparedUpdate() {
    this.downloadedPath = ''
    this.verified = null
    if (this.feed) {
      await this.feed.close().catch(() => {})
      this.feed = null
    }
    if (this.updateDirectory) {
      await removeUpdateDirectory(this.updateDirectory).catch(() => {})
      this.updateDirectory = ''
    }
  }

  clearAuthorization() {
    this.stopPolling()
    this.downloadRequested = false
    this.release = null
    void this.discardPreparedUpdate()
    this.setStatus({ state: 'idle', message: '', code: '', version: '', title: '', notes: '' })
  }

  linuxCanApply() {
    return this.platform !== 'linux' || ['deb', 'tarball'].includes(this.linuxInstall?.kind)
  }

  async fetchLatest(token) {
    const response = await this.fetchImpl(
      `${this.apiUrl}/v1/releases/latest?channel=stable&platform=${encodeURIComponent(this.platform)}&arch=${encodeURIComponent(this.arch)}&current=${encodeURIComponent(this.currentVersion)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
        },
      },
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error('latest_unavailable')
    const payload = await response.json()
    return payload?.release ?? null
  }

  async check() {
    if (!this.enabled) return this.view()
    if (['downloading', 'downloaded'].includes(this.status.state)) return this.view()
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = (async () => {
      const token = await this.authorize()
      if (!token) {
        this.setStatus({ state: 'idle' }, false)
        return this.view()
      }
      try {
        const release = await this.fetchLatest(token)
        if (!release || !versionNewer(release.version, this.currentVersion) || !this.linuxCanApply()) {
          this.release = null
          this.setStatus({ state: 'idle', version: '', title: '', notes: '', message: '', code: '' })
          return this.view()
        }
        this.release = release
        if (!this.selectedDownload()) {
          this.release = null
          this.setStatus({ state: 'idle', version: '', title: '', notes: '', message: '', code: '' })
          return this.view()
        }
        this.setStatus({
          state: 'available',
          version: boundedText(release.version, 64),
          title: boundedText(release.title, 160) || `MilkSU ${boundedText(release.version, 64)}`,
          notes: normalizeReleaseNotes(release.notes),
          releaseDate: boundedText(release.publishedAt, 64),
        })
      } catch {
        this.setStatus({ state: 'idle' }, false)
      }
      return this.view()
    })().finally(() => { this.checkPromise = null })
    return this.checkPromise
  }

  selectedDownload() {
    const downloads = this.release?.downloads || {}
    if (this.platform === 'linux') {
      const kind = linuxArtifactKind(this.linuxInstall?.kind)
      return downloads[kind] ? { kind, ...downloads[kind] } : null
    }
    if (this.platform === 'win32') return downloads.nsis ? { kind: 'nsis', ...downloads.nsis } : null
    return downloads.zip ? { kind: 'zip', ...downloads.zip } : null
  }

  artifactFileName() {
    const version = boundedText(this.release?.version, 64)
    if (this.platform === 'win32') return `MilkSU-Windows-x64-${version}-Setup.exe`
    if (this.platform === 'linux') {
      const selected = this.selectedDownload()
      return `MilkSU-${version}.${selected?.kind === 'tar.gz' ? 'tar.gz' : 'deb'}`
    }
    return `MilkSU-macOS-arm64-${version}.zip`
  }

  async download() {
    if (!this.enabled || !['available', 'error'].includes(this.status.state)) return this.view()
    const token = await this.authorize()
    if (!token) {
      this.setStatus({
        state: 'error',
        code: 'login_required',
        message: '请先登录可用的 MilkSU 账户再下载更新',
      })
      return this.view()
    }
    this.downloadRequested = true
    this.setStatus({ state: 'downloading', percent: 0, message: '', code: '' })
    try {
      if (this.platform === 'linux') {
        await this.downloadLinux(token)
      } else {
        await this.downloadDesktop(token)
      }
    } catch {
      await this.discardPreparedUpdate()
      this.setStatus({
        state: 'error',
        code: 'download_failed',
        message: '更新下载失败，请稍后重试',
      })
    }
    return this.view()
  }

  async downloadDesktop(token) {
    const selected = this.selectedDownload()
    if (!selected?.url || !selected.sha256) throw new Error('artifact_missing')
    const size = Number(selected.size) || 0
    const root = path.join(this.userDataPath, 'updates')
    await mkdir(root, { recursive: true, mode: 0o700 })
    await this.discardPreparedUpdate()
    this.updateDirectory = await mkdtemp(path.join(root, 'update-'))
    const destination = path.join(this.updateDirectory, this.artifactFileName())
    const headers = { authorization: `Bearer ${token}` }
    let lastError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.downloadArtifact(selected.url, destination, size, selected.sha256, {
          headers,
          fetchImpl: this.fetchImpl,
          onProgress: received => {
            const percent = size > 0 ? Math.max(0, Math.min(100, (received / size) * 100)) : 0
            this.setStatus({
              state: 'downloading',
              percent,
              transferred: received,
              total: size,
            })
          },
        })
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt >= 1 || /校验|完整性|大小|SHA-256/u.test(String(error?.message || error))) {
          throw error
        }
      }
    }
    if (lastError) throw lastError
    await this.verifyDownloaded(destination, size, selected.sha256)
    if (typeof this.updater?.setFeedURL !== 'function'
      || typeof this.updater?.checkForUpdates !== 'function'
      || typeof this.updater?.downloadUpdate !== 'function') {
      throw new Error('updater_unavailable')
    }
    this.feed = await this.createFeed(destination, this.release.version)
    const configPath = path.join(this.updateDirectory, 'app-update.yml')
    let configContents = 'updaterCacheDirName: milksu-updater\n'
    if (process.resourcesPath) {
      try {
        configContents = await readFile(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    await writeFile(configPath, configContents, { mode: 0o600 })
    this.updater.updateConfigPath = configPath
    this.updater.disableDifferentialDownload = true
    this.updater.setFeedURL({
      provider: 'generic',
      url: this.feed.url,
      useMultipleRangeRequest: false,
    })
    const checked = await this.updater.checkForUpdates()
    if (checked && checked.isUpdateAvailable === false) {
      throw new Error('update_not_available')
    }
    await this.updater.downloadUpdate()
    this.downloadedPath = destination
    this.verified = { file: destination, size, sha256: String(selected.sha256).toLowerCase() }
    this.setStatus({
      state: 'downloaded',
      version: boundedText(this.release.version, 64),
      percent: 100,
    })
  }

  async downloadLinux(token) {
    const selected = this.selectedDownload()
    if (!selected?.url || !selected.sha256) throw new Error('linux_artifact_missing')
    const directory = path.join(this.userDataPath, 'updates')
    await mkdir(directory, { recursive: true })
    const destination = path.join(directory, this.artifactFileName())
    const response = await this.fetchImpl(selected.url, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!response.ok || !response.body) throw new Error('linux_download_failed')
    const hash = createHash('sha256')
    let transferred = 0
    const total = Number(selected.size) || 0
    const file = createWriteStream(destination, { mode: 0o600 })
    const body = response.body[Symbol.asyncIterator]
      ? response.body
      : Readable.fromWeb(response.body)
    try {
      for await (const chunk of body) {
        const buffer = Buffer.from(chunk)
        hash.update(buffer)
        transferred += buffer.length
        const percent = total > 0 ? Math.max(0, Math.min(100, (transferred / total) * 100)) : 0
        this.setStatus({ state: 'downloading', percent, transferred, total })
        if (!file.write(buffer)) {
          await new Promise(resolve => file.once('drain', resolve))
        }
      }
      await new Promise((resolve, reject) => {
        file.end(error => error ? reject(error) : resolve())
      })
    } catch (error) {
      file.destroy()
      await unlink(destination).catch(() => {})
      throw error
    }
    if (hash.digest('hex') !== selected.sha256) {
      await unlink(destination).catch(() => {})
      throw new Error('linux_checksum_mismatch')
    }
    this.downloadedPath = destination
    this.verified = { file: destination, size: total, sha256: selected.sha256 }
    this.setStatus({
      state: 'downloaded',
      version: boundedText(this.release.version, 64),
      percent: 100,
    })
  }

  async install() {
    if (!this.enabled || this.status.state !== 'downloaded') return false
    if (this.platform === 'linux') return this.installLinux()
    const blocker = desktopInstallBlocker({
      platform: this.platform,
      execPath: this.execPath,
    })
    if (blocker) {
      this.setStatus({
        state: 'error',
        code: blocker.code,
        message: blocker.message,
      })
      return false
    }
    if (typeof this.updater?.quitAndInstall !== 'function') {
      this.setStatus({
        state: 'error',
        code: 'install_failed',
        message: '更新安装失败，请稍后重试',
      })
      return false
    }
    try {
      if (this.verified) {
        await this.verifyDownloaded(this.verified.file, this.verified.size, this.verified.sha256)
      }
      this.updater.autoInstallOnAppQuit = false
      this.updater.quitAndInstall(true, true)
    } catch {
      this.setStatus({
        state: 'error',
        code: 'install_failed',
        message: '更新安装失败，请稍后重试',
      })
      return false
    }
    return true
  }

  installLinux() {
    const plan = this.buildLinuxPlan({
      installKind: this.linuxInstall?.kind,
      artifactPath: this.downloadedPath,
      execPath: this.linuxInstall?.execPath || this.execPath,
      prefix: this.linuxInstall?.prefix,
    })
    if (!plan.ok) {
      this.setStatus({
        state: 'error',
        code: plan.code,
        message: plan.missing
          ? `需要 ${plan.missing} 才能安装这次更新`
          : '这个安装方式还不能自动更新',
      })
      return false
    }
    const scriptPath = path.join(this.userDataPath, 'updates', 'milksu-apply.sh')
    this.applyLinux({ plan, pid: process.pid, scriptPath })
    return true
  }
}

module.exports = {
  UpdateManager,
  boundedText,
  normalizeReleaseNotes,
  versionNewer,
  desktopInstallBlocker,
}
