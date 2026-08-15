'use strict'

const { execFileSync, spawn } = require('node:child_process')
const { promises: fs } = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
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
const { AccountSession, accountRedirectURL, loadAccountConfig } = require('./account-session.cjs')
const { rendererHeaders } = require('./renderer-protocol.cjs')
const { UpdateManager } = require('./update-manager.cjs')
const {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  primeComputerUsePermission,
  shouldRelaunchAfterScreenRecordingGrant,
} = require('./computer-use-permissions.cjs')
const { requestMacOSScreenPermission } = require('./macos-screen-permission.cjs')

const APP_ORIGIN = 'milksu://app'
const METHOD_PATTERN = /^[A-Z][A-Za-z0-9]{0,80}$/u
const EVENT_PATTERN = /^[a-z][a-z0-9._-]{0,100}$/u
const BROWSER_SESSION_PATTERN = /^browser_[0-9a-f-]{36}$/u
const MAX_BACKEND_MESSAGE_BYTES = 128 << 20
const BROWSER_USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
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

function findFreePort() {
  const source = [
    "const net=require('node:net')",
    "const server=net.createServer()",
    "server.listen(0,'127.0.0.1',()=>{console.log(server.address().port);server.close()})",
  ].join(';')
  const value = execFileSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    env: { ELECTRON_RUN_AS_NODE: '1' },
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
let pendingAccountCallback = ''
let quitting = false
let relaunchScheduled = false
let screenRecordingRelaunchArm = null

async function syncAccountModelAuthorization(status) {
  if (!backend || !accountSession) return
  if (status?.state === 'active' && status?.tokenFluxLinked === true) {
    try {
      const credential = await accountSession.modelCredential()
      if (credential?.apiKey) {
        await backend.invoke('SetAccountModelCredential', [credential.baseUrl, credential.apiKey])
        return
      }
    } catch {
      // Preserve the last locally persisted account credential during a
      // transient account-service failure. A later status refresh retries.
      return
    }
  }
  await backend.invoke('ClearAccountModelCredential', [])
}

function resourcesPath(relative) {
  if (app.isPackaged) return path.join(process.resourcesPath, relative)
  return path.resolve(__dirname, '..', relative)
}

function backendExecutable() {
  const override = String(process.env.MILKSU_BACKEND_PATH ?? '').trim()
  if (override && path.isAbsolute(override)) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'milksu-backend')
    : path.resolve(__dirname, '..', 'build', 'desktop', 'milksu-backend')
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
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Beta (and optional MILKSU_INSTANCE_ID) always get a userData-scoped Go
    // runtime root. Stable keeps historical appdata resolution unless the
    // caller already set MILKSU_APPDATA_DIR or requested an isolated instance.
    const env = {
      ...process.env,
      MILKSU_CHANNEL: desktopIdentity.channel,
      MILKSU_DESKTOP_APP_ID: desktopIdentity.appId,
    }
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

  send(message) {
    if (!this.process.stdin.writable) throw new Error('MilkSU Go runtime is unavailable')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
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

  async stop() {
    if (!this.process || this.process.exitCode !== null) return
    this.send({ type: 'shutdown' })
    await Promise.race([
      new Promise(resolve => this.process.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 15000)),
    ])
    if (this.process.exitCode === null) this.process.kill('SIGTERM')
  }
}

async function waitForDevTools() {
  const endpoint = `http://127.0.0.1:${devToolsPort}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return endpoint
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
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

  async start(request) {
    const sessionId = String(request?.sessionId ?? '')
    const initialURL = new URL(String(request?.initialUrl ?? ''))
    const profilePath = this.allowedProfilePath(String(request?.profilePath ?? ''))
    if (!BROWSER_SESSION_PATTERN.test(sessionId) || !['http:', 'https:'].includes(initialURL.protocol) || !profilePath) {
      throw new Error('invalid browser request')
    }
    await this.stop({ sessionId })
    const partition = session.fromPath(profilePath)
	partition.setUserAgent(BROWSER_USER_AGENT, 'zh-CN,zh;q=0.9,en;q=0.8')
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
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
        void view.webContents.loadURL(details.url)
      }
      return { action: 'deny' }
    })
    this.window.contentView.addChildView(view)
    await view.webContents.loadURL(initialURL.toString())
    let attached = false
    try {
      view.webContents.debugger.attach('1.3')
      attached = true
      const info = await view.webContents.debugger.sendCommand('Target.getTargetInfo')
      const targetId = info?.targetInfo?.targetId
      if (!targetId) throw new Error('could not identify browser target')
      const proxy = new ScopedCDPProxy({
        upstreamEndpoint: this.upstreamEndpoint,
        targetId,
      })
      const cdpEndpoint = await proxy.start()
      this.sessions.set(sessionId, { view, proxy, profilePath })
      return { name: `Electron Chromium ${process.versions.chrome}`, cdpEndpoint }
    } catch (error) {
      this.window.contentView.removeChildView(view)
      view.webContents.close()
      throw error
    } finally {
      if (attached) view.webContents.debugger.detach()
    }
  }

  get(request) {
    const sessionId = String(request?.sessionId ?? '')
    const current = this.sessions.get(sessionId)
    if (!current) throw new Error('browser session is unavailable')
    return current
  }

  setViewport(request) {
    const current = this.get(request)
    const viewport = request.viewport ?? {}
    const visible = viewport.visible === true
    if (!visible) {
      current.view.setVisible(false)
      return
    }
    const bounds = {
      x: Math.max(0, Math.round(Number(viewport.x) || 0)),
      y: Math.max(0, Math.round(Number(viewport.y) || 0)),
      width: Math.max(1, Math.round(Number(viewport.width) || 1)),
      height: Math.max(1, Math.round(Number(viewport.height) || 1)),
    }
    current.view.setBounds(bounds)
    current.view.setVisible(true)
  }

  navigate(request) {
    const url = new URL(String(request?.url ?? ''))
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid browser URL')
    return this.get(request).view.webContents.loadURL(url.toString())
  }

  back(request) {
    const contents = this.get(request).view.webContents
    if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
  }

  forward(request) {
    const contents = this.get(request).view.webContents
    if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
  }

  reload(request) {
    this.get(request).view.webContents.reload()
  }

  async stop(request) {
    const sessionId = String(request?.sessionId ?? '')
    const current = this.sessions.get(sessionId)
    if (!current) return
    this.sessions.delete(sessionId)
    current.view.setVisible(false)
    this.window.contentView.removeChildView(current.view)
    await current.proxy.close()
    current.view.webContents.close()
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
    case 'browser.stop': return browserShell.stop(payload)
    case 'browser.closeAll': return browserShell.closeAll()
    case 'computerUse.permissions': {
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
    titleBarStyle: 'hiddenInset',
    // Layout-safe traffic lights: fixed shell inset, not a machine-specific screenshot fudge.
    // x keeps buttons inside the rail width; y leaves room above the logo slot.
    trafficLightPosition: { x: 14, y: 16 },
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
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setTitle(lockedWindowTitle())
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
    const status = await accountSession.status()
    await syncAccountModelAuthorization(status)
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
  return backend.invoke(method, request?.args)
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
  const callback = argv.find(value => String(value).startsWith(accountRedirectURL(desktopChannel)))
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
  await installRendererProtocol()
  const accountRedirect = new URL(accountRedirectURL(desktopChannel))
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(accountRedirect.protocol.replace(':', ''))
  }
  const accountConfig = await loadAccountConfig({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    channel: desktopChannel,
  })
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
    enabled: app.isPackaged && desktopChannel === 'stable' && accountConfig.configured,
    getAuthorization: () => accountSession.activeAccessToken(),
    onChanged: value => emitRendererEvent('update.changed', value),
  })
  if (pendingAccountCallback) {
    const callback = pendingAccountCallback
    pendingAccountCallback = ''
    await accountSession.handleCallback(callback)
  }
  const upstreamEndpoint = await waitForDevTools()
	createWindow()
  browserShell = new BrowserShell(mainWindow, upstreamEndpoint)
  backend = new BackendRuntime(backendExecutable(), handleHostRequest, emitRendererEvent)
  await backend.ready()
  await syncAccountModelAuthorization(await accountSession.status())
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  void updateManager.check()
}).catch(error => {
  dialog.showErrorBox('MilkSU 启动失败', error.message)
  app.quit()
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', event => {
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
  event.preventDefault()
  void (async () => {
    if (browserShell) await browserShell.closeAll()
    if (backend) await backend.stop()
    app.exit(0)
  })()
})

process.on('SIGTERM', () => app.quit())
process.on('SIGINT', () => app.quit())
