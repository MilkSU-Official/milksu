'use strict'

const { execFileSync, spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { promises: fs } = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
  systemPreferences,
  WebContentsView,
} = require('electron')
const { autoUpdater } = require('electron-updater')
const { ScopedCDPProxy } = require('./cdp-proxy.cjs')
const {
  resolveDesktopChannel,
  channelIdentity,
  applyChannelIsolation,
  browserProfileRoots,
  allowedProfilePath: resolveAllowedProfilePath,
  resolveRuntimeAppDataDir,
} = require('./channel-identity.cjs')
const { loadBuildTrackingView } = require('./build-tracking-view.cjs')
const {
  AccountSession,
  accountCallbackFromArgv,
  accountModelAuthorizationAction,
  accountModelAuthorizationRefreshRequired,
  desktopProtocolClientRegistration,
  loadAccountConfig,
} = require('./account-session.cjs')
const { rendererHeaders } = require('./renderer-protocol.cjs')
const { UpdateManager } = require('./update-manager.cjs')
const {
  attachBrowserView,
  detachBrowserView,
} = require('./browser-view-attachment.cjs')
const {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  primeComputerUsePermission,
  shouldRelaunchAfterScreenRecordingGrant,
} = require('./computer-use-permissions.cjs')
const { requestMacOSScreenPermission } = require('./macos-screen-permission.cjs')
const { openLocalPath } = require('./local-path.cjs')
const {
  desktopBackendEnvironment,
  electronNodeEnvironment,
} = require('./startup-environment.cjs')
const {
  installRendererReloadGuard,
  productApplicationMenuTemplate,
} = require('./renderer-reload.cjs')

const APP_ORIGIN = 'milksu://app'
const METHOD_PATTERN = /^[A-Z][A-Za-z0-9]{0,80}$/u
const EVENT_PATTERN = /^[a-z][a-z0-9._-]{0,100}$/u
const BROWSER_SESSION_PATTERN = /^browser_[0-9a-f-]{36}$/u
const BROWSER_TAB_PATTERN = /^tab_[0-9a-f-]{36}$/u
const MAX_BROWSER_TABS = 8
const MAX_BACKEND_MESSAGE_BYTES = 128 << 20
const BROWSER_USER_AGENT = [
  process.platform === 'win32'
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  `Chrome/${process.versions.chrome}`,
  'Safari/537.36',
].join(' ')

const macOSScreenPermissionPath = app.isPackaged
  ? path.join(process.resourcesPath, 'macos-screen-permission.node')
  : path.join(__dirname, '..', 'build', 'desktop', 'macos-screen-permission.node')
const macOSScreenPermission = process.platform === 'darwin'
  ? require(macOSScreenPermissionPath)
  : null

protocol.registerSchemesAsPrivileged([{
  scheme: 'milksu',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
  },
}])

function isClosedPipeError(error) {
  return error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED'
}

// Startup stage timings: filter logs with `[startup]`.
// Measures serial gates (DevTools → backend.ready → account status → loadURL → renderer RPCs).
const processBootMs = Date.now()

function startupLog(label, detail = '') {
  const total = Date.now() - processBootMs
  const suffix = detail ? ` ${detail}` : ''
  console.info(`[startup] +${total}ms ${label}${suffix}`)
}

async function startupTime(label, work) {
  const started = Date.now()
  try {
    return await work()
  } finally {
    const ms = Date.now() - started
    startupLog(label, `${ms}ms`)
  }
}

function findFreePort() {
  const source = [
    "const net=require('node:net')",
    "const server=net.createServer()",
    "server.listen(0,'127.0.0.1',()=>{console.log(server.address().port);server.close()})",
  ].join(';')
  const value = execFileSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    env: electronNodeEnvironment(),
  }).trim()
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('could not reserve a private DevTools port')
  }
  return port
}

const devToolsPort = findFreePort()
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', String(devToolsPort))

// Stable keeps Electron natural userData (existing installs / TCC continuity).
// Beta always pins a distinct Application Support directory by appId so it can
// coexist with Stable without MILKSU_INSTANCE_ID and without sharing runtime data.
let appNameHint = ''
try {
  // Packaged beta is named "MilkSU Beta"; package.json name is not channel-aware.
  appNameHint = String(app.getName?.() ?? '')
} catch {}
const desktopChannel = resolveDesktopChannel({
  env: process.env,
  appName: appNameHint,
  desktopAppId: process.env.MILKSU_DESKTOP_APP_ID,
})
const desktopIdentity = channelIdentity(desktopChannel)
// Isolation plan owns a single app.setName side effect (Stable/Beta productName).
const channelIsolation = applyChannelIsolation(desktopIdentity, {
  app,
  instanceId: process.env.MILKSU_INSTANCE_ID,
})
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow
let backend
let browserShell
let accountSession
let updateManager
let pendingAccountCallback = accountCallbackFromArgv(process.argv, desktopChannel)
let quitting = false
let relaunchScheduled = false
let screenRecordingRelaunchArm = null
// Avoid re-pushing the same account credential into Go on the renderer status RPC
// immediately after the main-process pre-load sync (same startup window).
let lastAccountModelSync = null
let accountModelSyncInflight = null
const ACCOUNT_MODEL_SYNC_DEDUP_MS = 15_000

async function syncAccountModelAuthorization(status) {
  if (!backend || !accountSession) return false
  const started = Date.now()
  const action = accountModelAuthorizationAction(status)
  if (
    action === 'refresh'
    && lastAccountModelSync?.action === 'refresh'
    && Date.now() - lastAccountModelSync.at < ACCOUNT_MODEL_SYNC_DEDUP_MS
  ) {
    startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=refresh skip-recent`)
    return true
  }
  if (action === 'refresh' && accountModelSyncInflight) {
    startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=refresh join-inflight`)
    return accountModelSyncInflight
  }
  if (action === 'refresh') {
    accountModelSyncInflight = (async () => {
      try {
        const credential = await accountSession.modelCredential()
        if (credential?.apiKey) {
          await backend.invoke('SetAccountModelCredential', [credential.baseUrl, credential.apiKey])
          lastAccountModelSync = { action: 'refresh', at: Date.now() }
          startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=refresh ok`)
          return true
        }
        startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=refresh empty`)
        return false
      } catch {
        // Preserve the last locally persisted account credential during a
        // transient account-service failure. A later status refresh retries.
        startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=refresh preserve-on-error`)
        return false
      } finally {
        accountModelSyncInflight = null
      }
    })()
    return accountModelSyncInflight
  }
  if (action === 'preserve') {
    startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=preserve`)
    return false
  }
  await backend.invoke('ClearAccountModelCredential', [])
  lastAccountModelSync = { action: 'clear', at: Date.now() }
  startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=clear`)
  return false
}

function resourcesPath(relative) {
  if (app.isPackaged) return path.join(process.resourcesPath, relative)
  return path.resolve(__dirname, '..', relative)
}

function backendExecutable() {
  const override = String(process.env.MILKSU_BACKEND_PATH ?? '').trim()
  if (override && path.isAbsolute(override)) return override
  const binary = process.platform === 'win32' ? 'milksu-backend.exe' : 'milksu-backend'
  return app.isPackaged
    ? path.join(process.resourcesPath, binary)
    : path.resolve(__dirname, '..', 'build', 'desktop', binary)
}

function rendererDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'renderer')
    : path.resolve(__dirname, '..', 'app', 'dist')
}

async function installRendererProtocol() {
  const root = await fs.realpath(rendererDirectory())
  protocol.handle('milksu', async request => {
    const url = new URL(request.url)
	if (url.host !== 'app') return new Response('not found', { status: 404 })
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!relative) relative = 'index.html'
    let candidate = path.resolve(root, relative)
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      return new Response('not found', { status: 404 })
    }
    try {
      const metadata = await fs.stat(candidate)
      if (metadata.isDirectory()) candidate = path.join(candidate, 'index.html')
      const body = await fs.readFile(candidate)
      return new Response(body, {
        headers: rendererHeaders(candidate),
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

class BackendRuntime {
  constructor(executable, hostHandler, eventHandler) {
    this.hostHandler = hostHandler
    this.eventHandler = eventHandler
    this.pending = new Map()
    this.nextID = 0
    this.stopping = false
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Beta (and optional MILKSU_INSTANCE_ID) always get a userData-scoped Go
    // runtime root. Stable keeps historical appdata resolution unless the
    // caller already set MILKSU_APPDATA_DIR or requested an isolated instance.
    const env = desktopBackendEnvironment(process.env, {
      channel: desktopIdentity.channel,
      appId: desktopIdentity.appId,
      hostPid: process.pid,
    })
    const runtimeAppDataDir = resolveRuntimeAppDataDir({
      channel: desktopIdentity.channel,
      isolatedInstance: channelIsolation.isolatedInstance,
      existingAppDataDir: process.env.MILKSU_APPDATA_DIR,
      userDataPath: app.getPath('userData'),
    })
    if (runtimeAppDataDir) env.MILKSU_APPDATA_DIR = runtimeAppDataDir
    this.process = spawn(executable, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    this.process.once('error', error => this.fail(error))
    this.process.stdin.on('error', error => {
      if (this.stopping && isClosedPipeError(error)) return
      this.fail(error)
    })
    this.process.once('exit', (code, signal) => {
      this.fail(new Error(`MilkSU Go runtime exited (${code ?? signal ?? 'unknown'})`))
    })
    this.process.stderr.pipe(process.stderr)
    const lines = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      if (Buffer.byteLength(line) > MAX_BACKEND_MESSAGE_BYTES) {
        this.fail(new Error('MilkSU Go runtime exceeded the desktop message limit'))
        return
      }
      this.handleLine(line)
    })
  }

  handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this.fail(new Error('MilkSU Go runtime returned an invalid message'))
      return
    }
    if (message.type === 'ready') {
      this.resolveReady()
      return
    }
    if (message.type === 'result') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (message.type === 'event') {
      this.eventHandler(message.event, message.payload)
      return
    }
    if (message.type === 'host_request') {
      void this.handleHostRequest(message)
    }
  }

  async handleHostRequest(message) {
    try {
      const result = await this.hostHandler(message.method, message.payload)
      this.send({ type: 'host_response', id: message.id, result: result ?? null })
    } catch (error) {
      this.send({ type: 'host_response', id: message.id, error: error.message })
    }
  }

  send(message, { allowClosed = false } = {}) {
    if (this.stopping && !allowClosed) return false
    const stdin = this.process?.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) {
      if (allowClosed) return false
      throw new Error('MilkSU Go runtime is unavailable')
    }
    try {
      return stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      if (allowClosed && isClosedPipeError(error)) return false
      throw error
    }
  }

  async ready() {
    return this.readyPromise
  }

  invoke(method, args) {
    if (!METHOD_PATTERN.test(method) || !Array.isArray(args)) {
      return Promise.reject(new Error('invalid desktop invocation'))
    }
    const id = `invoke-${++this.nextID}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ type: 'invoke', id, method, args })
    })
  }

  fail(error) {
    this.rejectReady(error)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  async stop({
    // Quit must feel instant; 15s made Cmd+Q look broken while the window stayed up.
    gracefulMs = 2000,
    termMs = 500,
  } = {}) {
    if (!this.process || this.process.exitCode !== null) return
    this.stopping = true
    this.send({ type: 'shutdown' }, { allowClosed: true })
    await Promise.race([
      new Promise(resolve => this.process.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, gracefulMs)),
    ])
    if (this.process.exitCode === null) {
      try { this.process.kill('SIGTERM') } catch {}
      await Promise.race([
        new Promise(resolve => this.process.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, termMs)),
      ])
    }
    if (this.process.exitCode === null) {
      try { this.process.kill('SIGKILL') } catch {}
    }
  }
}

async function waitForDevTools() {
  const endpoint = `http://127.0.0.1:${devToolsPort}`
  const started = Date.now()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) {
        startupLog('waitForDevTools', `${Date.now() - started}ms attempts=${attempt + 1}`)
        return endpoint
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  startupLog('waitForDevTools.timeout', `${Date.now() - started}ms`)
  throw new Error('Electron DevTools endpoint did not start')
}

class BrowserShell {
  constructor(window, upstreamEndpoint) {
    this.window = window
    this.upstreamEndpoint = upstreamEndpoint
    this.sessions = new Map()
  }

  allowedProfilePath(profilePath) {
    // Stable: historical appData/com.milksu.app (+ explicit MILKSU_APPDATA_DIR).
    // Beta / isolated instance: also allow current Electron userData.
    const roots = browserProfileRoots({
      channel: desktopIdentity.channel,
      appDataPath: app.getPath('appData'),
      userDataPath: app.getPath('userData'),
      isolatedInstance: channelIsolation.isolatedInstance,
      appDataOverride: process.env.MILKSU_APPDATA_DIR,
    })
    return resolveAllowedProfilePath(profilePath, roots)
  }

  createView(sessionId, partition) {
    const view = new WebContentsView({
      webPreferences: {
        session: partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    view.setVisible(false)
    view.webContents.setWindowOpenHandler(details => {
      if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
        void this.createTab({ sessionId, url: details.url })
      }
      return { action: 'deny' }
    })
    return view
  }

  async identifyTarget(view) {
    let attached = false
    try {
      view.webContents.debugger.attach('1.3')
      attached = true
      const info = await view.webContents.debugger.sendCommand('Target.getTargetInfo')
      const targetId = info?.targetInfo?.targetId
      if (!targetId) throw new Error('could not identify browser target')
      return targetId
    } finally {
      if (attached) view.webContents.debugger.detach()
    }
  }

  tabSnapshot(session, tabId) {
    const tab = session.tabs.get(tabId)
    if (!tab) throw new Error('browser tab is unavailable')
    return {
      id: tabId,
      title: tab.view.webContents.getTitle() || '',
      url: tab.view.webContents.getURL() || '',
      active: session.activeTabId === tabId,
    }
  }

  listTabs(request) {
    const current = this.get(request)
    return {
      activeTabId: current.activeTabId,
      tabs: [...current.tabs.keys()].map(tabId => this.tabSnapshot(current, tabId)),
    }
  }

  async start(request) {
    const sessionId = String(request?.sessionId ?? '')
    const rawURL = String(request?.initialUrl ?? '').trim()
    const profilePath = this.allowedProfilePath(String(request?.profilePath ?? ''))
    if (!BROWSER_SESSION_PATTERN.test(sessionId) || !profilePath) {
      throw new Error('invalid browser request')
    }
    let initialURL = null
    if (rawURL) {
      initialURL = new URL(rawURL)
      if (!['http:', 'https:'].includes(initialURL.protocol)) {
        throw new Error('invalid browser request')
      }
    }
    await this.stop({ sessionId })
    const partition = session.fromPath(profilePath)
    partition.setUserAgent(BROWSER_USER_AGENT, 'zh-CN,zh;q=0.9,en;q=0.8')
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
    const view = this.createView(sessionId, partition)
    this.window.contentView.addChildView(view)
    await view.webContents.loadURL(initialURL ? initialURL.toString() : 'about:blank')
    try {
      const targetId = await this.identifyTarget(view)
      const proxy = new ScopedCDPProxy({
        upstreamEndpoint: this.upstreamEndpoint,
        targetId,
      })
      const cdpEndpoint = await proxy.start()
      const tabId = `tab_${randomUUID()}`
      const tab = { view, targetId, attached: true }
      detachBrowserView(this.window.contentView, tab)
      this.sessions.set(sessionId, {
        partition,
        profilePath,
        proxy,
        activeTabId: tabId,
        tabs: new Map([[tabId, tab]]),
        viewport: { x: 0, y: 0, width: 1, height: 1, visible: false },
      })
      return { name: `Electron Chromium ${process.versions.chrome}`, cdpEndpoint }
    } catch (error) {
      this.window.contentView.removeChildView(view)
      view.webContents.close()
      throw error
    }
  }

  get(request) {
    const sessionId = String(request?.sessionId ?? '')
    const current = this.sessions.get(sessionId)
    if (!current) throw new Error('browser session is unavailable')
    return current
  }

  activeTab(current) {
    const tab = current.tabs.get(current.activeTabId)
    if (!tab) throw new Error('browser tab is unavailable')
    return tab
  }

  setViewport(request) {
    const current = this.get(request)
    const viewport = request.viewport ?? {}
    current.viewport = {
      x: Math.max(0, Math.round(Number(viewport.x) || 0)),
      y: Math.max(0, Math.round(Number(viewport.y) || 0)),
      width: Math.max(1, Math.round(Number(viewport.width) || 1)),
      height: Math.max(1, Math.round(Number(viewport.height) || 1)),
      visible: viewport.visible === true,
    }
    this.applyViewport(current)
  }

  applyViewport(current) {
    const viewport = current.viewport ?? {
      x: 0, y: 0, width: 1, height: 1, visible: false,
    }
    const bounds = {
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
    }
    for (const [tabId, tab] of current.tabs) {
      const show = viewport.visible && tabId === current.activeTabId
      if (!show) {
        detachBrowserView(this.window.contentView, tab)
        continue
      }
      attachBrowserView(this.window.contentView, tab)
      tab.view.setBounds(bounds)
      tab.view.setVisible(true)
    }
  }

  navigate(request) {
    const url = new URL(String(request?.url ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid browser URL')
    return this.activeTab(this.get(request)).view.webContents.loadURL(url.toString())
  }

  back(request) {
    const contents = this.activeTab(this.get(request)).view.webContents
    if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  }

  forward(request) {
    const contents = this.activeTab(this.get(request)).view.webContents
    if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
  }

  reload(request) {
    this.activeTab(this.get(request)).view.webContents.reload()
  }

  async createTab(request) {
    const current = this.get(request)
    if (current.tabs.size >= MAX_BROWSER_TABS) {
      throw new Error(`最多打开 ${MAX_BROWSER_TABS} 个标签页`)
    }
    const tabId = `tab_${randomUUID()}`
    const view = this.createView(String(request.sessionId ?? ''), current.partition)
    this.window.contentView.addChildView(view)
    const rawURL = String(request?.url ?? '').trim()
    if (rawURL) {
      const url = new URL(rawURL)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid browser URL')
      await view.webContents.loadURL(url.toString())
    }
    const targetId = await this.identifyTarget(view)
    const tab = { view, targetId, attached: true }
    detachBrowserView(this.window.contentView, tab)
    current.tabs.set(tabId, tab)
    return this.activateTab({ sessionId: request.sessionId, tabId })
  }

  async activateTab(request) {
    const current = this.get(request)
    const tabId = String(request?.tabId ?? '')
    if (!BROWSER_TAB_PATTERN.test(tabId) || !current.tabs.has(tabId)) {
      throw new Error('browser tab is unavailable')
    }
    current.activeTabId = tabId
    const tab = current.tabs.get(tabId)
    current.proxy?.setAllowedTarget(tab.targetId)
    this.applyViewport(current)
    return this.listTabs(request)
  }

  async closeAllTabs(request) {
    const current = this.get(request)
    const keepId = current.activeTabId && current.tabs.has(current.activeTabId)
      ? current.activeTabId
      : [...current.tabs.keys()][0]
    for (const [tabId, tab] of [...current.tabs.entries()]) {
      if (tabId === keepId) continue
      current.tabs.delete(tabId)
      detachBrowserView(this.window.contentView, tab)
      tab.view.webContents.close()
    }
    if (keepId) {
      await this.activateTab({ sessionId: request.sessionId, tabId: keepId })
      const kept = this.activeTab(current)
      await kept.view.webContents.loadURL('about:blank')
    }
    return this.listTabs(request)
  }

  async closeTab(request) {
    const current = this.get(request)
    const tabId = String(request?.tabId ?? '')
    const tab = current.tabs.get(tabId)
    if (!tab) return this.listTabs(request)
    if (current.tabs.size === 1) {
      throw new Error('最后一个标签页请使用关闭浏览器')
    }
    current.tabs.delete(tabId)
    detachBrowserView(this.window.contentView, tab)
    tab.view.webContents.close()
    if (current.activeTabId === tabId) {
      const nextId = [...current.tabs.keys()][0]
      await this.activateTab({ sessionId: request.sessionId, tabId: nextId })
    }
    return this.listTabs(request)
  }

  async stop(request) {
    const sessionId = String(request?.sessionId ?? '')
    const current = this.sessions.get(sessionId)
    if (!current) return
    this.sessions.delete(sessionId)
    for (const tab of current.tabs.values()) {
      detachBrowserView(this.window.contentView, tab)
      tab.view.webContents.close()
    }
    await current.proxy.close()
  }

  async closeAll() {
    for (const sessionId of [...this.sessions.keys()]) await this.stop({ sessionId })
  }
}

function senderIsApp(event) {
  return event.sender === mainWindow?.webContents
    && event.senderFrame?.url?.startsWith(`${APP_ORIGIN}/`)
}

function normalizeFilters(filters) {
  if (!Array.isArray(filters)) return []
  return filters.map(filter => ({
    name: String(filter.name ?? 'Files'),
    extensions: Array.isArray(filter.extensions)
      ? filter.extensions.map(value => String(value).replace(/^\*\.?/u, '') || '*')
      : ['*'],
  }))
}

async function handleHostRequest(method, payload = {}) {
  const options = {
    title: String(payload.title ?? ''),
    defaultPath: payload.defaultPath ? String(payload.defaultPath) : undefined,
    filters: normalizeFilters(payload.filters),
  }
  switch (method) {
    case 'dialog.save': {
      const result = await dialog.showSaveDialog(mainWindow, options)
      return result.canceled ? '' : result.filePath
    }
    case 'dialog.openFile':
    case 'dialog.openFiles':
    case 'dialog.openDirectory': {
      const properties = method === 'dialog.openDirectory'
        ? ['openDirectory', 'createDirectory']
        : method === 'dialog.openFiles' ? ['openFile', 'multiSelections'] : ['openFile']
      const result = await dialog.showOpenDialog(mainWindow, { ...options, properties })
      if (method === 'dialog.openFiles') return result.canceled ? [] : result.filePaths
      return result.canceled ? '' : result.filePaths[0]
    }
    case 'dialog.message': {
      const buttons = Array.isArray(payload.buttons) ? payload.buttons.map(String) : ['好']
      const result = await dialog.showMessageBox(mainWindow, {
        type: ['none', 'info', 'error', 'question', 'warning'].includes(payload.type) ? payload.type : 'none',
        title: String(payload.title ?? ''),
        message: String(payload.message ?? ''),
        buttons,
        defaultId: Number(payload.defaultButton) || 0,
        cancelId: Number(payload.cancelButton) || 0,
      })
      return buttons[result.response] ?? ''
    }
    case 'shell.openExternal': {
      const url = new URL(String(payload.url ?? ''))
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('external URL is not allowed')
      await shell.openExternal(url.toString())
      return null
    }
    case 'shell.openPath':
      await openLocalPath(payload.path, {
        stat: target => fs.stat(target),
        openPath: target => shell.openPath(target),
      })
      return null
    case 'window.show':
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      return null
    case 'browser.start': return browserShell.start(payload)
    case 'browser.setViewport': return browserShell.setViewport(payload)
    case 'browser.navigate': return browserShell.navigate(payload)
    case 'browser.back': return browserShell.back(payload)
    case 'browser.forward': return browserShell.forward(payload)
    case 'browser.reload': return browserShell.reload(payload)
    case 'browser.listTabs': return browserShell.listTabs(payload)
    case 'browser.createTab': return browserShell.createTab(payload)
    case 'browser.activateTab': return browserShell.activateTab(payload)
    case 'browser.closeTab': return browserShell.closeTab(payload)
    case 'browser.closeAllTabs': return browserShell.closeAllTabs(payload)
    case 'browser.stop': return browserShell.stop(payload)
    case 'browser.closeAll': return browserShell.closeAll()
    case 'computerUse.permissions': {
      if (process.platform === 'win32') {
        return { accessibility: true, screenRecording: true, screenStatus: 'granted' }
      }
      // Host-attributed TCC: Electron app identity, never invent grants.
      // Status/Start always probe with prompt=false; explicit UI opens Settings.
      const probe = probeComputerUsePermissions(systemPreferences, { prompt: false })
      return {
        accessibility: probe.accessibility,
        screenRecording: probe.screenRecording,
        screenStatus: probe.screenStatus,
      }
    }
    case 'computerUse.openPermissions': {
      if (process.platform === 'win32') return null
      const permission = String(payload?.permission ?? '')
      const url = computerUsePermissionsSettingsURL(permission)
      if (permission === 'screen-recording') {
        const probe = probeComputerUsePermissions(systemPreferences, { prompt: false })
        screenRecordingRelaunchArm = {
          openedAt: Date.now(),
          previousStatus: probe.screenStatus,
        }
      }
      await primeComputerUsePermission(
        systemPreferences,
        permission === 'screen-recording'
          ? () => requestMacOSScreenPermission(macOSScreenPermission)
          : undefined,
        permission,
      )
      await shell.openExternal(url)
      return null
    }
    case 'app.relaunch': {
      if (!relaunchScheduled) {
        relaunchScheduled = true
        app.relaunch()
      }
      setImmediate(() => app.quit())
      return true
    }
    default: throw new Error(`unsupported desktop host method: ${method}`)
  }
}

function emitRendererEvent(event, value) {
  if (!EVENT_PATTERN.test(String(event)) || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(`milksu:event:${event}`, value)
}

async function loadBuildTracking() {
  // Packaged: sealed Resources/build-tracking.json only.
  // Unpackaged: explicit development/unpackaged view — never forge git/hash/tracking.
  return loadBuildTrackingView({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    identity: desktopIdentity,
  })
}

function lockedWindowTitle() {
  // Always the channel product name — renderer <title> must not override this.
  return desktopIdentity.productName
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: lockedWindowTitle(),
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f7f5',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      // Layout-safe traffic lights: fixed shell inset, not a machine-specific screenshot fudge.
      // x keeps buttons inside the rail width; y leaves room above the logo slot.
      trafficLightPosition: { x: 14, y: 16 },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  // Prevent document.title / Vue route titles from changing the OS window title
  // (Computer Use and accessibility read the real window title).
  mainWindow.on('page-title-updated', event => {
    event.preventDefault()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.getTitle() !== lockedWindowTitle()) {
      mainWindow.setTitle(lockedWindowTitle())
    }
  })
  mainWindow.setTitle(lockedWindowTitle())
  mainWindow.webContents.setWindowOpenHandler(details => {
    if (details.url.startsWith('https://') || details.url.startsWith('http://')) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault()
  })
  installRendererReloadGuard(mainWindow.webContents)
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setTitle(lockedWindowTitle())
    startupLog('window.ready-to-show → show()')
    mainWindow.show()
  })
}

ipcMain.handle('milksu:invoke', async (event, request) => {
  if (!senderIsApp(event)) throw new Error('desktop invocation came from an untrusted renderer')
  const method = String(request?.method ?? '')
  // Packaging provenance is owned by the desktop shell, not Go domain logic.
  if (method === 'GetBuildTracking') return loadBuildTracking()
  if (method === 'GetAccountStatus') {
    if (!accountSession) return { configured: false, state: 'unconfigured', authenticated: false }
    const started = Date.now()
    // Prefer non-blocking status(): provisional shell returns immediately while
    // /v1/account refreshes in the background after bootstrap.
    const status = await accountSession.status()
    const statusMs = Date.now() - started
    const syncStarted = Date.now()
    // Provisional active must not trigger credential refresh/clear (preserve local relay).
    await syncAccountModelAuthorization(status)
    startupLog(
      'ipc.GetAccountStatus',
      `status=${statusMs}ms sync=${Date.now() - syncStarted}ms state=${status?.state ?? 'unknown'} provisional=${status?.provisional === true} total=${Date.now() - started}ms`,
    )
    return status
  }
  if (method === 'StartAccountLogin') {
    if (!accountSession) throw new Error('内测账户尚未就绪')
    return accountSession.startLogin()
  }
  if (method === 'LogoutAccount') {
    if (!accountSession) return { configured: false, state: 'unconfigured', authenticated: false }
    return accountSession.logout()
  }
  if (method === 'GetUpdateStatus') {
    return updateManager?.view() ?? {
      state: 'idle',
      currentVersion: app.getVersion(),
      enabled: false,
    }
  }
  if (method === 'CheckForUpdates') {
    return updateManager?.check() ?? null
  }
  if (method === 'DownloadUpdate') {
    return updateManager?.download() ?? null
  }
  if (method === 'InstallUpdate') {
    if (!updateManager || updateManager.view().state !== 'downloaded') return false
    if (browserShell) await browserShell.closeAll()
    if (backend) await backend.stop()
    quitting = true
    const started = updateManager.install()
    if (!started) quitting = false
    return started
  }
  try {
    return await backend.invoke(method, request?.args)
  } catch (error) {
    if (
      accountSession
      && accountModelAuthorizationRefreshRequired(method, error)
      && await syncAccountModelAuthorization(await accountSession.status())
    ) {
      return backend.invoke(method, request?.args)
    }
    throw error
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (!accountSession) {
    pendingAccountCallback = url
    return
  }
  void accountSession.handleCallback(url).catch(error => {
    dialog.showErrorBox('MilkSU 登录失败', error.message)
  })
})

app.on('second-instance', (_event, argv = []) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  const callback = accountCallbackFromArgv(argv, desktopChannel)
  if (callback) {
    if (!accountSession) {
      pendingAccountCallback = callback
    } else {
      void accountSession.handleCallback(callback).catch(error => {
        dialog.showErrorBox('MilkSU 登录失败', error.message)
      })
    }
  }
})

app.whenReady().then(async () => {
  startupLog('app.whenReady')
  await startupTime('installRendererProtocol', () => installRendererProtocol())
  const protocolClient = desktopProtocolClientRegistration({
    channel: desktopChannel,
    isPackaged: app.isPackaged,
    defaultApp: Boolean(process.defaultApp),
    execPath: process.execPath,
    argv: process.argv,
  })
  if (protocolClient.register) {
    const registered = protocolClient.execPath
      ? app.setAsDefaultProtocolClient(protocolClient.scheme, protocolClient.execPath, protocolClient.args)
      : app.setAsDefaultProtocolClient(protocolClient.scheme)
    startupLog(
      'protocolClient',
      `${protocolClient.scheme} registered=${registered} packaged=${app.isPackaged}`,
    )
  } else {
    startupLog('protocolClient', `${protocolClient.scheme} skipped unpackaged`)
  }
  const accountConfig = await startupTime('loadAccountConfig', () => loadAccountConfig({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    channel: desktopChannel,
  }))
  accountSession = new AccountSession({
    config: accountConfig,
    userDataPath: app.getPath('userData'),
    openExternal: url => shell.openExternal(url),
    onChanged: value => {
      emitRendererEvent('account.changed', value)
      void syncAccountModelAuthorization(value)
      if (value?.state === 'active') void updateManager?.check()
      else updateManager?.clearAuthorization()
    },
  })
  updateManager = new UpdateManager({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    enabled: process.platform === 'darwin'
      && app.isPackaged
      && desktopChannel === 'stable'
      && accountConfig.configured,
    getAuthorization: () => accountSession.activeAccessToken(),
    onChanged: value => emitRendererEvent('update.changed', value),
  })
  if (pendingAccountCallback) {
    const callback = pendingAccountCallback
    pendingAccountCallback = ''
    await startupTime('account.handleCallback', () => accountSession.handleCallback(callback))
  }
  const upstreamEndpoint = await waitForDevTools()
  createWindow()
  Menu.setApplicationMenu(Menu.buildFromTemplate(productApplicationMenuTemplate()))
  startupLog('createWindow')
  browserShell = new BrowserShell(mainWindow, upstreamEndpoint)
  const backendSpawnStarted = Date.now()
  backend = new BackendRuntime(backendExecutable(), handleHostRequest, emitRendererEvent)
  startupLog('backend.spawn', `${Date.now() - backendSpawnStarted}ms`)
  await startupTime('backend.ready', () => backend.ready())
  // Local session probe only — never block first paint on account API / credentials.
  // Provisional active keeps the shell open; network status + model sync finish via
  // AccountSession.onChanged after loadURL (see ensureStatusRefresh notify path).
  const accountStatus = await startupTime(
    'account.bootstrap (local)',
    () => accountSession.bootstrapStatus(),
  )
  if (!accountStatus?.provisional) {
    await syncAccountModelAuthorization(accountStatus)
  } else {
    startupLog(
      'account.bootstrap deferred network+credential sync',
      `state=${accountStatus.state}`,
    )
  }
  await startupTime('loadURL', () => mainWindow.loadURL(`${APP_ORIGIN}/index.html`))
  startupLog(
    'main pre-renderer complete',
    `account.state=${accountStatus?.state ?? 'unknown'} provisional=${accountStatus?.provisional === true}`,
  )
  // After first paint: wait for network status, push account.changed (renderer
  // subscribed in onMounted), then refresh credentials. Re-emit on did-finish-load
  // so a settle that finished before Vue mounted is not lost.
  if (accountStatus?.provisional) {
    const publishSettledAccount = async reason => {
      try {
        const settled = await accountSession.statusSettled()
        startupLog(
          'account.background settled',
          `${reason} state=${settled?.state ?? 'unknown'} provisional=${settled?.provisional === true}`,
        )
        emitRendererEvent('account.changed', settled)
        await syncAccountModelAuthorization(settled)
      } catch (error) {
        startupLog('account.background failed', `${reason} ${error?.message || String(error)}`)
      }
    }
    void publishSettledAccount('post-loadURL')
    mainWindow.webContents.on('did-finish-load', () => {
      // Re-publish after every document load, including a renderer refresh.
      void publishSettledAccount('did-finish-load')
    })
  }
  void updateManager.check()
}).catch(error => {
  dialog.showErrorBox('MilkSU 启动失败', error.message)
  app.quit()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => {
  if (quitting) return
  if (!relaunchScheduled) {
    const probe = probeComputerUsePermissions(systemPreferences, { prompt: false })
    if (shouldRelaunchAfterScreenRecordingGrant(
      screenRecordingRelaunchArm,
      probe.screenStatus,
    )) {
      relaunchScheduled = true
      app.relaunch()
    }
  }
  quitting = true
  // Do not preventDefault or wait for Go/browser teardown. Cmd+Q used to
  // intercept quit, hide the window, then sit ~3s on shutdown+SIGTERM.
  // stdin EOF / this shutdown line is enough for Go to mark a clean exit.
  try {
    backend?.send({ type: 'shutdown' }, { allowClosed: true })
  } catch {}
})

process.on('SIGTERM', () => app.quit())
process.on('SIGINT', () => app.quit())
