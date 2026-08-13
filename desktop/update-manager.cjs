'use strict'

const UPDATE_STATES = new Set(['idle', 'checking', 'available', 'downloading', 'downloaded', 'error'])

function boundedText(value, limit) {
  return String(value ?? '').replace(/\0/gu, '').trim().slice(0, limit)
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return boundedText(value.map(item => item?.note ?? item).filter(Boolean).join('\n'), 5000)
  }
  return boundedText(value, 5000)
}

class UpdateManager {
  constructor({ updater, currentVersion, enabled, getAuthorization, onChanged = () => {} }) {
    this.updater = updater
    this.currentVersion = boundedText(currentVersion, 64)
    this.enabled = enabled === true
    this.getAuthorization = getAuthorization
    this.onChanged = onChanged
    this.status = {
      state: 'idle',
      currentVersion: this.currentVersion,
      enabled: this.enabled,
    }
    this.checkPromise = null
    this.downloadRequested = false
    if (!this.enabled) return

    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = true
    this.updater.logger = null
    this.updater.on('checking-for-update', () => this.setStatus({ state: 'checking' }, false))
    this.updater.on('update-not-available', () => this.setStatus({ state: 'idle' }, false))
    this.updater.on('update-available', info => {
      this.setStatus({
        state: 'available',
        version: boundedText(info?.version, 64),
        title: boundedText(info?.releaseName, 160) || `MilkSU ${boundedText(info?.version, 64)}`,
        notes: normalizeReleaseNotes(info?.releaseNotes),
        releaseDate: boundedText(info?.releaseDate, 64),
      })
    })
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
        message: '更新下载失败，请稍后重试',
      })
    })
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
    if (!token) {
      this.updater.requestHeaders = undefined
      return false
    }
    this.updater.requestHeaders = { authorization: `Bearer ${token}` }
    return true
  }

  clearAuthorization() {
    if (!this.enabled) return
    this.updater.requestHeaders = undefined
    this.downloadRequested = false
    this.setStatus({ state: 'idle', message: '' })
  }

  async check() {
    if (!this.enabled) return this.view()
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = (async () => {
      if (!(await this.authorize())) {
        this.setStatus({ state: 'idle' }, false)
        return this.view()
      }
      try {
        await this.updater.checkForUpdates()
      } catch {
        this.setStatus({ state: 'idle' }, false)
      }
      return this.view()
    })().finally(() => { this.checkPromise = null })
    return this.checkPromise
  }

  async download() {
    if (!this.enabled || !['available', 'error'].includes(this.status.state)) return this.view()
    if (!(await this.authorize())) {
      this.setStatus({ state: 'error', message: '请先登录可用的 MilkSU 账户再下载更新' })
      return this.view()
    }
    this.downloadRequested = true
    this.setStatus({ state: 'downloading', percent: 0, message: '' })
    try {
      await this.updater.downloadUpdate()
    } catch {
      this.setStatus({
        state: 'error',
        message: '更新下载失败，请稍后重试',
      })
    }
    return this.view()
  }

  install() {
    if (!this.enabled || this.status.state !== 'downloaded') return false
    this.updater.quitAndInstall(false, true)
    return true
  }
}

module.exports = { UpdateManager, boundedText, normalizeReleaseNotes }
