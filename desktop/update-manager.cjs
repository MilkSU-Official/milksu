'use strict'

const { createHash } = require('node:crypto')
const { createWriteStream } = require('node:fs')
const { mkdir, unlink } = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const {
  buildLinuxInstallPlan,
  classifyLinuxInstall,
  linuxArtifactKind,
  spawnLinuxApply,
} = require('./linux-update-apply.cjs')

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
    if (!this.enabled) return

    if (this.updater && this.platform !== 'linux') {
      this.updater.autoDownload = false
      this.updater.autoInstallOnAppQuit = true
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

  feedURL() {
    return `${this.apiUrl}/v1/releases/feed/stable/${this.platform}/${this.arch}`
  }

  async authorize() {
    const token = boundedText(await this.getAuthorization(), 4096)
    if (!token) {
      if (this.updater) this.updater.requestHeaders = undefined
      return ''
    }
    if (this.updater) this.updater.requestHeaders = { authorization: `Bearer ${token}` }
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

  clearAuthorization() {
    this.stopPolling()
    if (this.updater) this.updater.requestHeaders = undefined
    this.downloadRequested = false
    this.release = null
    this.downloadedPath = ''
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
        if (typeof this.updater?.setFeedURL === 'function') {
          this.updater.setFeedURL({ provider: 'generic', url: this.feedURL() })
        }
        await this.updater.downloadUpdate()
      }
    } catch {
      this.setStatus({
        state: 'error',
        code: 'download_failed',
        message: '更新下载失败，请稍后重试',
      })
    }
    return this.view()
  }

  async downloadLinux(token) {
    const selected = this.selectedDownload()
    if (!selected?.url || !selected.sha256) throw new Error('linux_artifact_missing')
    const directory = path.join(this.userDataPath, 'updates')
    await mkdir(directory, { recursive: true })
    const filename = `MilkSU-${this.release.version}.${selected.kind === 'tar.gz' ? 'tar.gz' : 'deb'}`
    const destination = path.join(directory, filename)
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
    this.setStatus({
      state: 'downloaded',
      version: boundedText(this.release.version, 64),
      percent: 100,
    })
  }

  install() {
    if (!this.enabled || this.status.state !== 'downloaded') return false
    if (this.platform === 'linux') return this.installLinux()
    this.updater.quitAndInstall(false, true)
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
}
