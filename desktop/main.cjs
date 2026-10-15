'use strict'

const { installBrokenPipeGuards, safeConsoleInfo } = require('./safe-console.cjs')
const { parseURL } = require('./parse-url.cjs')
installBrokenPipeGuards()

const { execFileSync, spawn } = require('node:child_process')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const execFileAsync = promisify(require('node:child_process').execFile)
const { promises: fs } = require('node:fs')
const path = require('node:path')
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
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
const {
  resolveHomeRoot,
  migrateStableUserDataIntoHome,
} = require('./home-root.cjs')
const { loadBuildTrackingView } = require('./build-tracking-view.cjs')
const {
  AccountSession,
  readAccountCallbackHandoff,
  writeAccountCallbackHandoff,
  accountCallbackFromArgv,
  accountIntentAuthorizationAction,
  accountModelAuthorizationAction,
  accountModelAuthorizationRefreshRequired,
  clearAccountLoginClaim,
  desktopProtocolClientRegistration,
  firstProtocolClientScript,
  loadAccountConfig,
  publicOAuthError,
  readAccountLoginClaim,
  readAccountLoginClaimSync,
  routeAccountCallback,
  writeAccountLoginClaim,
} = require('./account-session.cjs')
const { pluginFrameScriptHeaders, rendererHeaders } = require('./renderer-protocol.cjs')
const { UpdateManager } = require('./update-manager.cjs')
const {
  attachBrowserView,
  detachBrowserView,
} = require('./browser-view-attachment.cjs')
const {
  applyResearchWebRTCPolicy,
  canActivateTabInResearchMode,
  createResearchBrowserNetworkGate,
  redactResearchDisplayText,
  redactResearchURL,
  ResearchEgressProxy,
  RESEARCH_PROXY_BYPASS_RULES,
} = require('./research-browser-network-policy.cjs')
const { createResearchWebContentsDisposer } = require('./research-browser-lifecycle.cjs')
const {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  primeComputerUsePermission,
  shouldRelaunchAfterScreenRecordingGrant,
} = require('./computer-use-permissions.cjs')
const { requestMacOSScreenPermission } = require('./macos-screen-permission.cjs')
const { copyImageFile, openLocalPath, revealLocalPath } = require('./local-path.cjs')
const {
  applyLinuxChromiumFlags,
  linuxUserAgent,
  linuxWindowIconPath,
} = require('./linux-desktop.cjs')
const { applyWindowChrome, browserWindowChrome, nativeThemeSource } = require('./window-chrome.cjs')
const {
  desktopBackendEnvironment,
  electronNodeEnvironment,
} = require('./startup-environment.cjs')
const { installRendererReloadGuard } = require('./renderer-reload.cjs')
const { BackendRuntime } = require('./backend-runtime.cjs')
const { createCompanionShell } = require('./companion-shell.cjs')
const { createCompanionSkinHost } = require('./companion-skin-host.cjs')

const APP_ORIGIN = 'milksu://app'
const EVENT_PATTERN = /^[a-z][a-z0-9._-]{0,100}$/u
const BROWSER_SESSION_PATTERN = /^browser_[0-9a-f-]{36}$/u
const BROWSER_TAB_PATTERN = /^tab_[0-9a-f-]{36}$/u
const MAX_BROWSER_TABS = 8
const BROWSER_USER_AGENT = linuxUserAgent(process.versions.chrome)

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
    corsEnabled: true,
  },
}])


// Startup stage timings: filter logs with `[startup]`.
// Measures serial gates (DevTools → backend.ready → account status → loadURL → renderer RPCs).
const processBootMs = Date.now()

function startupLog(label, detail = '') {
  const total = Date.now() - processBootMs
  const suffix = detail ? ` ${detail}` : ''
  safeConsoleInfo(`[startup] +${total}ms ${label}${suffix}`)
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

// Stable pins Electron userData into the unified MilkSU home root
// (<homeRoot>/desktop) after migrating the historical natural directory;
// beta always pins a distinct Application Support directory by appId so it
// can coexist with Stable without MILKSU_INSTANCE_ID and without sharing
// runtime data.
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
const milksuHomeRoot = resolveHomeRoot(process.env)
let stableHomeUserData = ''
if (desktopIdentity.channel === 'stable' && !process.env.MILKSU_INSTANCE_ID) {
  // Rename the historical natural userData into <homeRoot>/desktop. On
  // failure (cross-device, permissions) keep the natural path unpinned so
  // the install keeps working with its existing profile.
  stableHomeUserData = migrateStableUserDataIntoHome({
    homeRoot: milksuHomeRoot,
    naturalUserDataPath: app.getPath('userData'),
  }) ? milksuHomeRoot : ''
}
// Isolation plan owns a single app.setName side effect (Stable/Beta productName).
const channelIsolation = applyChannelIsolation(desktopIdentity, {
  app,
  instanceId: process.env.MILKSU_INSTANCE_ID,
  homeRoot: stableHomeUserData,
})
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

let mainWindow
let backend
let browserShell
let accountSession
let linuxDevelopmentProtocol = null
let updateManager
let pendingAccountCallback = accountCallbackFromArgv(process.argv, desktopChannel)

function exitIfForeignAccountCallback() {
  if (!pendingAccountCallback) return
  const claim = readAccountLoginClaimSync(os.tmpdir())
  const decision = routeAccountCallback({
    hasPendingLogin: false,
    claim,
    selfPid: process.pid,
  })
  if (decision.action !== 'forward' || !processAlive(decision.pid)) return
  if (!forwardAccountCallback(decision, pendingAccountCallback)) return
  if (process.platform === 'darwin') app.dock?.hide()
  app.exit(0)
}
exitIfForeignAccountCallback()

const devToolsPort = findFreePort()
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', String(devToolsPort))
applyLinuxChromiumFlags(app.commandLine)

function focusMainWindow() {
  if (companionShell) companionShell.revealFromTaskbar()
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function accountDialogLocale() {
  try {
    const settings = await backend?.invokeFromElectronHost?.('GetSettings', [])
    if (String(settings?.locale ?? '').trim().toLowerCase() === 'en') return 'en'
  } catch {
    // Locale is optional. The dialog stays in the product default.
  }
  return 'zh'
}

function accountDialogText(locale, zh, en) {
  return locale === 'en' ? en : zh
}

function forwardAccountCallback(decision, callback) {
  try {
    return writeAccountCallbackHandoff(os.tmpdir(), decision.pid, callback)
  } catch {
    return false
  }
}

function watchForwardedAccountCallback() {
  const timer = setInterval(() => {
    const callback = readAccountCallbackHandoff(os.tmpdir(), process.pid)
    if (!callback) return
    clearInterval(timer)
    void deliverAccountCallback(callback)
  }, 200)
  if (typeof timer.unref === 'function') timer.unref()
}

async function showAccountLoginNotice(kind, detail = '') {
  const locale = await accountDialogLocale()
  const text = (zh, en) => accountDialogText(locale, zh, en)
  if (kind === 'other-window') {
    await dialog.showMessageBox({
      type: 'info',
      title: text('登录', 'Sign-in'),
      message: text(
        '登录会在另一扇 MilkSU 窗口里完成。',
        'Sign-in will finish in the other MilkSU window.',
      ),
    })
    return
  }
  const fallback = text(
    '请在发起登录的那扇窗口里重试。',
    'Try again in the window where you started sign-in.',
  )
  dialog.showErrorBox(
    text('登录没有完成', 'Sign-in did not finish'),
    detail || fallback,
  )
}

async function deliverAccountCallback(rawURL) {
  const callback = String(rawURL ?? '').trim()
  if (!callback || !accountSession) return
  const claim = await readAccountLoginClaim(os.tmpdir())
  const decision = routeAccountCallback({
    hasPendingLogin: accountSession.hasPendingLogin(),
    claim,
    selfPid: process.pid,
  })
  if (decision.action === 'accept') {
    focusMainWindow()
    try {
      const ok = await accountSession.handleCallback(callback)
      if (ok) await clearAccountLoginClaim(os.tmpdir(), process.pid)
      if (!ok) await showAccountLoginNotice('retry')
    } catch (error) {
      const detail = publicOAuthError(error?.message)
      const locale = await accountDialogLocale()
      dialog.showErrorBox(
        accountDialogText(locale, 'MilkSU 登录失败', 'MilkSU sign-in failed'),
        detail || accountDialogText(locale, 'GitHub 登录失败', 'GitHub sign-in failed'),
      )
    }
    return
  }
  if (decision.action === 'forward' && processAlive(decision.pid) && forwardAccountCallback(decision, callback)) {
    return 'forwarded'
  }
  await showAccountLoginNotice('retry')
  return 'retry'
}
let quitting = false
let relaunchScheduled = false
let screenRecordingRelaunchArm = null
// Avoid re-pushing the same account credential into Go on the renderer status RPC
// immediately after the main-process pre-load sync (same startup window).
let lastAccountModelSync = null
let accountModelSyncInflight = null
let lastAccountDecisionSync = null
let accountIntentSyncInflight = null
const ACCOUNT_MODEL_SYNC_DEDUP_MS = 15_000

async function syncAccountDecisionAuthorization(status) {
  if (!backend || !accountSession) return false
  const action = accountIntentAuthorizationAction(status)
  if (
    action === 'refresh'
    && lastAccountDecisionSync?.action === 'refresh'
    && Date.now() - lastAccountDecisionSync.at < ACCOUNT_MODEL_SYNC_DEDUP_MS
  ) {
    return true
  }
  if (action === 'refresh' && accountIntentSyncInflight) return accountIntentSyncInflight
  if (action === 'refresh') {
    accountIntentSyncInflight = (async () => {
      try {
        const credential = await accountSession.decisionCredential()
        if (credential?.apiKey) {
          await backend.invokeFromElectronHost('SetAccountDecisionCredential', [credential.apiKey])
          lastAccountDecisionSync = { action: 'refresh', at: Date.now() }
          return true
        }
        await backend.invokeFromElectronHost('ClearAccountDecisionCredential', [])
        lastAccountDecisionSync = { action: 'clear', at: Date.now() }
        return false
      } catch {
        return false
      } finally {
        accountIntentSyncInflight = null
      }
    })()
    return accountIntentSyncInflight
  }
  if (action === 'preserve') return false
  await backend.invokeFromElectronHost('ClearAccountDecisionCredential', [])
  lastAccountDecisionSync = { action: 'clear', at: Date.now() }
  return false
}

async function syncAccountModelAuthorization(status) {
  await syncAccountDecisionAuthorization(status)
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
          await backend.invokeFromElectronHost(
            'SetAccountModelCredential',
            [credential.baseUrl, credential.apiKey],
          )
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
  await backend.invokeFromElectronHost('ClearAccountModelCredential', [])
  lastAccountModelSync = { action: 'clear', at: Date.now() }
  startupLog('syncAccountModelAuthorization', `${Date.now() - started}ms action=clear`)
  return false
}

function runtimeScript() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime', 'main.cjs')
    : path.resolve(__dirname, '..', 'runtime', 'dist', 'main.cjs')
}

function rendererDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'renderer')
    : path.resolve(__dirname, '..', 'app', 'dist')
}

async function installRendererProtocol() {
  const root = await fs.realpath(rendererDirectory())
  protocol.handle('milksu', async request => {
    const url = parseURL(request.url)
    if (!url || url.host !== 'app') return new Response('not found', { status: 404 })
    const pluginSettingsMatch = url.pathname.match(/^\/__plugin-settings\/([a-z][a-z0-9.-]{0,63})\.mjs$/)
    if (pluginSettingsMatch) {
      try {
        if (!backend) return new Response('not ready', { status: 503 })
        const script = await backend.invokeFromRenderer('GetPluginSettingsScript', [pluginSettingsMatch[1]])
        return new Response(script, {
          headers: pluginFrameScriptHeaders(`${pluginSettingsMatch[1]}.mjs`),
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    const pluginAssetMatch = url.pathname.match(/^\/__plugin-assets\/([a-z][a-z0-9.-]{0,63})\/(content-wallpaper|workspace-list|control-button|workspace-topbar|overlay-menu|chat-composer)\/([a-z0-9-]+\.(?:png|jpg|webp))$/)
    if (pluginAssetMatch) {
      try {
        if (!backend) return new Response('not ready', { status: 503 })
        const asset = await backend.invokeFromRenderer('GetPluginSurfaceAsset', [
          pluginAssetMatch[1],
          pluginAssetMatch[2],
          pluginAssetMatch[3],
        ])
        return new Response(Buffer.from(asset.data, 'base64'), {
          headers: {
            'Content-Type': asset.mime,
            'Cache-Control': 'private, no-store',
            'Content-Security-Policy': "default-src 'none'",
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    let relative
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch {
      return new Response('not found', { status: 404 })
    }
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
        headers: relative === 'plugin-frame-bootstrap.js'
          ? pluginFrameScriptHeaders(candidate)
          : rendererHeaders(candidate),
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function createDesktopBackend(hostHandler, eventHandler) {
  return new BackendRuntime({
    hostHandler,
    eventHandler,
    spawnProcess: () => {
      const env = desktopBackendEnvironment(process.env, {
        channel: desktopIdentity.channel,
        appId: desktopIdentity.appId,
        hostPid: process.pid,
      })
      env.ELECTRON_RUN_AS_NODE = '1'
      const runtimeAppDataDir = resolveRuntimeAppDataDir({
        channel: desktopIdentity.channel,
        isolatedInstance: channelIsolation.isolatedInstance,
        existingAppDataDir: process.env.MILKSU_APPDATA_DIR,
        userDataPath: app.getPath('userData'),
      })
      if (runtimeAppDataDir) env.MILKSU_APPDATA_DIR = runtimeAppDataDir
      if (!app.isPackaged && !env.MILKSU_FACTORY_SKILLS_DIR) {
        env.MILKSU_FACTORY_SKILLS_DIR = path.resolve(__dirname, '..', 'skills')
      }
      if (!app.isPackaged && !env.MILKSU_ROOT) {
        env.MILKSU_ROOT = path.resolve(__dirname, '..')
      }
      if (app.isPackaged && process.resourcesPath && !env.MILKSU_RESOURCES) {
        env.MILKSU_RESOURCES = process.resourcesPath
      }
      if (!env.NODE_PATH) {
        env.NODE_PATH = app.isPackaged
          ? process.resourcesPath
          : [
            path.resolve(__dirname, '..', 'build', 'desktop', 'node_modules'),
            path.resolve(__dirname, '..', 'node_modules'),
          ].join(path.delimiter)
      }
      const child = spawn(process.execPath, [runtimeScript()], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      })
      child.stderr.pipe(process.stderr)
      return child
    },
  })
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
    this.researchNetworkGates = new WeakMap()
    this.researchPartitions = new Map()
    this.researchEgressProxy = null
    this.researchEgressProxyClosing = null
    this.destroyWebContents = createResearchWebContentsDisposer({
      gateForPartition: partition => this.researchNetworkGate(partition),
      hasResearchPartition: partition => this.researchPartitions.has(partition),
      releaseResearchPartition: partition => this.releaseResearchPartition(partition),
    })
  }

  researchNetworkGate(partition) {
    let gate = this.researchNetworkGates.get(partition)
    if (!gate) {
      gate = createResearchBrowserNetworkGate(partition)
      this.researchNetworkGates.set(partition, gate)
    }
    return gate
  }

  async ensureResearchEgressProxy() {
    while (this.researchEgressProxyClosing) {
      try {
        await this.researchEgressProxyClosing
      } catch {
        // Closing a listener must not prevent a later Research tab from starting.
      }
    }
    let proxy = this.researchEgressProxy
    if (!proxy) {
      proxy = new ResearchEgressProxy()
      this.researchEgressProxy = proxy
    }
    try {
      await proxy.start()
      return proxy
    } catch (error) {
      if (this.researchEgressProxy === proxy) this.researchEgressProxy = null
      try {
        await proxy.close()
      } catch {}
      throw error
    }
  }

  async acquireResearchPartition(partition) {
    let entry = this.researchPartitions.get(partition)
    if (!entry) {
      entry = { references: 0, ready: null }
      this.researchPartitions.set(partition, entry)
      entry.ready = (async () => {
        const proxy = await this.ensureResearchEgressProxy()
        await partition.setProxy({
          mode: 'fixed_servers',
          proxyRules: proxy.url,
          proxyBypassRules: RESEARCH_PROXY_BYPASS_RULES,
        })
      })()
    }
    entry.references += 1
    try {
      await entry.ready
    } catch (error) {
      entry.references -= 1
      if (entry.references === 0 && this.researchPartitions.get(partition) === entry) {
        this.researchPartitions.delete(partition)
        await this.closeUnusedResearchEgressProxy()
      }
      throw error
    }
  }

  async releaseResearchPartition(partition) {
    const entry = this.researchPartitions.get(partition)
    if (!entry) return
    if (entry.references > 0) entry.references -= 1
    if (entry.references > 0) return
    this.researchPartitions.delete(partition)
    try {
      await partition.setProxy({ mode: 'direct' })
    } catch {
      // The partition has no remaining WebContents; still close its local listener.
    } finally {
      await this.closeUnusedResearchEgressProxy()
    }
  }

  async closeUnusedResearchEgressProxy() {
    if (this.researchPartitions.size || !this.researchEgressProxy) return
    const proxy = this.researchEgressProxy
    this.researchEgressProxy = null
    const closing = proxy.close()
    this.researchEgressProxyClosing = closing
    try {
      await closing
    } finally {
      if (this.researchEgressProxyClosing === closing) {
        this.researchEgressProxyClosing = null
      }
    }
  }

  async disposeBrowserTab(tab) {
    detachBrowserView(this.window.contentView, tab)
    await this.destroyWebContents(tab.view.webContents, tab.partition)
  }

  configureBrowserPartition(partition) {
    partition.setUserAgent(BROWSER_USER_AGENT, 'zh-CN,zh;q=0.9,en;q=0.8')
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
    this.researchNetworkGate(partition)
  }

  allowedProfilePath(profilePath) {
    // Stable: unified home workspaces/browser root (+ explicit MILKSU_APPDATA_DIR).
    // Beta / isolated instance: also allow current Electron userData.
    const roots = browserProfileRoots({
      channel: desktopIdentity.channel,
      appDataPath: app.getPath('appData'),
      userDataPath: app.getPath('userData'),
      isolatedInstance: channelIsolation.isolatedInstance,
      historicalStableRoot: desktopIdentity.channel === 'stable'
        ? path.join(milksuHomeRoot, 'workspaces', 'browser')
        : undefined,
      appDataOverride: process.env.MILKSU_APPDATA_DIR,
    })
    return resolveAllowedProfilePath(profilePath, roots)
  }

  createView(sessionId, partition) {
    this.researchNetworkGate(partition)
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
    view.webContents.on('will-navigate', (event, targetURL) => {
      const gate = this.researchNetworkGate(partition)
      if (
        (gate.isResearchMode() || gate.isRestricted(view.webContents.id))
        && !/^https?:\/\//iu.test(String(targetURL ?? ''))
      ) {
        event.preventDefault()
      }
    })
    view.webContents.setWindowOpenHandler(details => {
      if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
        void this.createTab({ sessionId, url: details.url }, view.webContents.id).catch(() => {})
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
    const contents = tab.view.webContents
    const isResearchTab = this.researchNetworkGate(tab.partition).isRestricted(contents.id)
    const url = contents.getURL() || ''
    const title = contents.getTitle() || ''
    return {
      id: tabId,
      title: isResearchTab ? redactResearchDisplayText(title) : title,
      url: isResearchTab ? redactResearchURL(url) : url,
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
      initialURL = parseURL(rawURL)
      if (!initialURL || !['http:', 'https:'].includes(initialURL.protocol)) {
        throw new Error('invalid browser request')
      }
    }
    await this.stop({ sessionId })
    const partition = session.fromPath(profilePath)
    this.configureBrowserPartition(partition)
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
      const tab = { view, targetId, attached: true, partition }
      detachBrowserView(this.window.contentView, tab)
      this.sessions.set(sessionId, {
        partition,
        profilePath,
        proxy,
        researchMode: false,
        stopping: false,
        pendingTabCreations: new Set(),
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
    const url = parseURL(String(request?.url ?? ''))
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('invalid browser URL')
    const current = this.get(request)
    const tab = this.activeTab(current)
    if (
      current.researchMode
      && !this.researchNetworkGate(tab.partition).isRestricted(tab.view.webContents.id)
    ) {
      throw new Error('open a source with the typed Research Browser action before navigating')
    }
    return tab.view.webContents.loadURL(url.toString())
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

  setResearchMode(request) {
    const current = this.get(request)
    current.researchMode = request?.enabled === true
    this.researchNetworkGate(current.partition).setResearchMode(current.researchMode)
    return { active: current.researchMode }
  }

  async createTab(request, openerWebContentsId = null) {
    const current = this.get(request)
    if (current.stopping) throw new Error('browser session is stopping')
    const pending = { view: null, done: null }
    current.pendingTabCreations.add(pending)
    pending.done = this.createTabInSession(request, openerWebContentsId, current, pending)
    try {
      return await pending.done
    } finally {
      current.pendingTabCreations.delete(pending)
    }
  }

  async createTabInSession(request, openerWebContentsId, current, pending) {
    if (current.tabs.size + current.pendingTabCreations.size > MAX_BROWSER_TABS) {
      throw new Error(`最多打开 ${MAX_BROWSER_TABS} 个标签页`)
    }
    const rawURL = String(request?.url ?? '').trim()
    const url = rawURL ? parseURL(rawURL) : null
    if (rawURL && (!url || !['http:', 'https:'].includes(url.protocol))) {
      throw new Error('invalid browser URL')
    }
    const tabId = `tab_${randomUUID()}`
    const openerTab = openerWebContentsId === null
      ? null
      : [...current.tabs.values()].find(tab => tab.view.webContents.id === openerWebContentsId)
    const openerPartition = openerTab?.partition
    const openerIsResearch = openerTab && this.researchNetworkGate(openerPartition)
      .isRestricted(openerWebContentsId)
    const researchTab = current.researchMode || openerIsResearch
    const partition = openerIsResearch
      ? openerPartition
      : researchTab
        ? session.fromPartition(`milksu-research-${randomUUID()}`)
        : current.partition
    pending.partition = partition
    if (researchTab && !this.researchPartitions.has(partition)) {
      this.configureBrowserPartition(partition)
    }
    let researchPartitionAcquired = false
    let view
    let viewAdded = false
    const researchNetworkGate = this.researchNetworkGate(partition)
    try {
      if (researchTab) {
        await this.acquireResearchPartition(partition)
        researchPartitionAcquired = true
      }
      if (current.stopping) throw new Error('browser session is stopping')
      view = this.createView(String(request.sessionId ?? ''), partition)
      pending.view = view
      if (researchTab) {
        researchNetworkGate.setResearchMode(true)
        researchNetworkGate.mark(view.webContents.id)
        applyResearchWebRTCPolicy(view.webContents)
      }
      this.window.contentView.addChildView(view)
      viewAdded = true
      if (url) await view.webContents.loadURL(url.toString())
      if (current.stopping) throw new Error('browser session is stopping')
      const targetId = await this.identifyTarget(view)
      if (current.stopping) throw new Error('browser session is stopping')
      const tab = { view, targetId, attached: true, partition }
      detachBrowserView(this.window.contentView, tab)
      viewAdded = false
      current.tabs.set(tabId, tab)
      pending.view = null
    } catch (error) {
      if (viewAdded && view) {
        try {
          this.window.contentView.removeChildView(view)
        } catch {}
      }
      pending.view = null
      if (view) {
        try {
          await this.destroyWebContents(view.webContents, partition)
        } catch {}
      } else if (researchPartitionAcquired) {
        try { await this.releaseResearchPartition(partition) } catch {}
      }
      throw error
    }
    return this.activateTab({ sessionId: request.sessionId, tabId })
  }

  async createResearchTab(request) {
    const current = this.get(request)
    current.researchMode = true
    this.researchNetworkGate(current.partition).setResearchMode(true)
    return this.createTab(request)
  }

  async activateTab(request) {
    const current = this.get(request)
    const tabId = String(request?.tabId ?? '')
    if (!BROWSER_TAB_PATTERN.test(tabId) || !current.tabs.has(tabId)) {
      throw new Error('browser tab is unavailable')
    }
    const tab = current.tabs.get(tabId)
    if (!canActivateTabInResearchMode(
      current.researchMode,
      this.researchNetworkGate(tab.partition).isRestricted(tab.view.webContents.id),
    )) {
      throw new Error('unverified Browser tabs cannot be focused during Deep Research')
    }
    current.activeTabId = tabId
    current.proxy?.setAllowedTarget(tab.targetId)
    this.applyViewport(current)
    return this.listTabs(request)
  }

  async closeAllTabs(request) {
    const current = this.get(request)
    const activeTabIsResearch = current.activeTabId
      && current.tabs.has(current.activeTabId)
      && this.researchNetworkGate(current.tabs.get(current.activeTabId).partition)
        .isRestricted(current.tabs.get(current.activeTabId).view.webContents.id)
    const keepId = current.researchMode
      ? (activeTabIsResearch
        ? current.activeTabId
        : [...current.tabs.entries()].find(([, tab]) => (
          this.researchNetworkGate(tab.partition).isRestricted(tab.view.webContents.id)
        ))?.[0])
      : (current.activeTabId && current.tabs.has(current.activeTabId)
        ? current.activeTabId
        : [...current.tabs.keys()][0])
    if (current.researchMode && !keepId) {
      throw new Error('open a source with the typed Research Browser action before closing tabs')
    }
    const closing = [...current.tabs.entries()]
    for (const [tabId, tab] of closing) {
      if (tabId === keepId) continue
      current.tabs.delete(tabId)
      await this.disposeBrowserTab(tab)
    }
    if (keepId) {
      await this.activateTab({ sessionId: request.sessionId, tabId: keepId })
      const kept = this.activeTab(current)
      if (!current.researchMode) await kept.view.webContents.loadURL('about:blank')
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
    const researchNetworkGate = this.researchNetworkGate(tab.partition)
    const isActiveTab = current.activeTabId === tabId
    const isResearchTab = researchNetworkGate.isRestricted(tab.view.webContents.id)
    const nextResearchTab = current.researchMode && isResearchTab
      ? [...current.tabs.entries()].find(([id, candidate]) => (
        id !== tabId && this.researchNetworkGate(candidate.partition)
          .isRestricted(candidate.view.webContents.id)
      ))?.[0]
      : ''
    if (current.researchMode && isResearchTab && !nextResearchTab) {
      throw new Error('cancel or finish Deep Research before closing its last Browser tab')
    }
    current.tabs.delete(tabId)
    await this.disposeBrowserTab(tab)
    if (isActiveTab) {
      const nextId = current.researchMode ? nextResearchTab : [...current.tabs.keys()][0]
      await this.activateTab({ sessionId: request.sessionId, tabId: nextId })
    }
    return this.listTabs(request)
  }

  async stop(request) {
    const sessionId = String(request?.sessionId ?? '')
    const current = this.sessions.get(sessionId)
    if (!current) return
    current.stopping = true
    this.sessions.delete(sessionId)
    const tabs = [...current.tabs.values()]
    current.tabs.clear()
    const pendingCreations = [...current.pendingTabCreations]
    await Promise.allSettled([
      ...tabs.map(tab => this.disposeBrowserTab(tab)),
      ...pendingCreations.map(async pending => {
        if (pending.view && pending.partition) {
          await this.destroyWebContents(pending.view.webContents, pending.partition)
        }
        await pending.done
      }),
    ])
    await current.proxy.close()
  }

  async closeAll() {
    for (const sessionId of [...this.sessions.keys()]) await this.stop({ sessionId })
  }
}

let companionShell = null
let companionSkinHost = null

function senderIsApp(event, method = '') {
  if (companionShell) return companionShell.senderAllowed(event, method)
  return event.sender === mainWindow?.webContents
    && event.senderFrame === mainWindow?.webContents.mainFrame
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
      const url = parseURL(String(payload.url ?? ''))
      if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('external URL is not allowed')
      await shell.openExternal(url.toString())
      return null
    }
    case 'shell.openPath':
      await openLocalPath(payload.path, {
        stat: target => fs.stat(target),
        openPath: target => shell.openPath(target),
      })
      return null
    case 'shell.showItemInFolder':
      await revealLocalPath(payload.path, {
        stat: target => fs.stat(target),
        showItemInFolder: target => shell.showItemInFolder(target),
      })
      return null
    case 'clipboard.writeImage':
      await copyImageFile(payload.path, {
        stat: target => fs.stat(target),
        readImage: target => nativeImage.createFromPath(target),
        writeImage: image => clipboard.writeImage(image),
      })
      return null
    case 'window.show':
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      return null
    case 'window.toggleMaximize':
      if (!mainWindow || mainWindow.isDestroyed()) return null
      if (mainWindow.isMaximized()) mainWindow.unmaximize()
      else mainWindow.maximize()
      return mainWindow.isMaximized()
    case 'browser.start': return browserShell.start(payload)
    case 'browser.setViewport': return browserShell.setViewport(payload)
    case 'browser.navigate': return browserShell.navigate(payload)
    case 'browser.setResearchMode': return browserShell.setResearchMode(payload)
    case 'browser.back': return browserShell.back(payload)
    case 'browser.forward': return browserShell.forward(payload)
    case 'browser.reload': return browserShell.reload(payload)
    case 'browser.listTabs': return browserShell.listTabs(payload)
    case 'browser.createTab': return browserShell.createTab(payload)
    case 'browser.createResearchTab': return browserShell.createResearchTab(payload)
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
    case 'app.quit': {
      setImmediate(() => app.quit())
      return true
    }
    default: throw new Error(`unsupported desktop host method: ${method}`)
  }
}

// 跨调用累积（键 ⇒ 上次通知时间戳）：**同一事件**只通知一次；60 秒窗口是第二层防抖。
// 键由 task-notify.cjs 的 taskNotifyKey 统一构造（会话 + 类型 + 可选 turnKey）。
const taskNotifySeen = new Map()

// 任务通知的 Dock 角标计数（0 = 不显示）。规则：真弹出一条 +1；App 回到前台（含点了通知）清零。
let taskNotifyBadge = 0
function applyTaskNotifyBadge(next) {
  taskNotifyBadge = Number(next) > 0 ? Math.floor(Number(next)) : 0
  try {
    // macOS 走 dock 角标；Windows/Linux 由 Electron 自行映射；失败不影响通知本身。
    if (typeof app.setBadgeCount === 'function') app.setBadgeCount(taskNotifyBadge)
  } catch { /* 角标是锦上添花，绝不能因为它让通知失败 */ }
}

const { shouldNotify, buildPayload, show, taskNotifyKey, TASK_NOTIFY_WINDOW_MS, badgeAfterNotify, badgeAfterRead } = require('./task-notify.cjs')

function emitRendererEvent(event, value) {
  if (!EVENT_PATTERN.test(String(event))) return
  if (companionShell) {
    companionShell.emit(event, value)
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
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
  const linuxIcon = linuxWindowIconPath({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repositoryRoot: path.join(__dirname, '..'),
  })
  const initialChromeTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  mainWindow = new BrowserWindow({
    title: lockedWindowTitle(),
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    ...(linuxIcon ? { icon: linuxIcon } : {}),
    ...browserWindowChrome({
      platform: process.platform,
      theme: initialChromeTheme,
    }),
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
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const selected = String(params?.selectionText ?? '').trim()
    if (!params?.isEditable && !selected) return
    const flags = params?.editFlags ?? {}
    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: Boolean(flags.canCut) },
      { role: 'copy', enabled: Boolean(flags.canCopy) },
      { role: 'paste', enabled: Boolean(flags.canPaste) },
      { type: 'separator' },
      { role: 'selectAll', enabled: Boolean(flags.canSelectAll) },
    ])
    menu.popup({ window: mainWindow })
  })
  installRendererReloadGuard(mainWindow.webContents)
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setTitle(lockedWindowTitle())
    startupLog('window.ready-to-show → show()')
    mainWindow.show()
  })
  // Hyprland (and some virtio-gpu Wayland sessions) never emit ready-to-show.
  if (process.platform === 'linux') {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
      mainWindow.setTitle(lockedWindowTitle())
      startupLog('window.show fallback after ready-to-show timeout')
      mainWindow.show()
    }, 5_000)
  }
}

async function linuxDevelopmentProtocolAction(enabled) {
  if (process.platform !== 'linux' || app.isPackaged || process.env.MILKSU_PLUGIN_DEV !== '1') {
    return { available: false, enabled: false }
  }
  if (!enabled) {
    const registration = linuxDevelopmentProtocol
    if (registration) await registration.restore()
    linuxDevelopmentProtocol = null
    return { available: true, enabled: false }
  }
  if (linuxDevelopmentProtocol) return { available: true, enabled: true }

  const { registerLinuxDevelopmentProtocol } = await import(pathToFileURL(
    path.join(app.getAppPath(), '..', 'scripts', 'lib', 'linux-development-protocol.mjs'),
  ).href)
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  // Bound every xdg call: restoreSync() runs inside before-quit, and a hung
  // xdg-mime / update-desktop-database must not stall the quit path.
  const xdgTimeout = { timeout: 10_000 }
  const currentHandler = async () => {
    try {
      const { stdout } = await execFileAsync('xdg-mime', ['query', 'default', 'x-scheme-handler/milksu'], xdgTimeout)
      return stdout
    } catch {
      return ''
    }
  }
  const registration = await registerLinuxDevelopmentProtocol({
    applicationsDirectory: path.join(dataHome, 'applications'),
    configDirectory: configHome,
    appDirectory: app.getAppPath(),
    electronPath: process.execPath,
    accountApiUrl: process.env.MILKSU_ACCOUNT_API_URL || '',
    currentHandler,
    setDefaultHandler: async (desktopFile, mimeType) => {
      await execFileAsync('xdg-mime', ['default', desktopFile, mimeType], xdgTimeout)
    },
    refreshApplications: async applicationsDirectory => {
      await execFileAsync('update-desktop-database', [applicationsDirectory], xdgTimeout)
    },
    currentHandlerSync: () => {
      try {
        return execFileSync('xdg-mime', ['query', 'default', 'x-scheme-handler/milksu'], { ...xdgTimeout, encoding: 'utf8' })
      } catch {
        return ''
      }
    },
    setDefaultHandlerSync: (desktopFile, mimeType) => {
      execFileSync('xdg-mime', ['default', desktopFile, mimeType], xdgTimeout)
    },
    refreshApplicationsSync: applicationsDirectory => {
      execFileSync('update-desktop-database', [applicationsDirectory], xdgTimeout)
    },
    log: message => startupLog('linux-development-protocol', message),
  })
  if (!registration.registered) throw new Error('已有其他应用关联了 MilkSU 登录回调')
  linuxDevelopmentProtocol = registration
  return { available: true, enabled: true }
}

ipcMain.handle('milksu:invoke', async (event, request) => {
  const method = String(request?.method ?? '')
  if (!senderIsApp(event, method)) throw new Error('desktop invocation came from an untrusted renderer')
  const hostArgs = Array.isArray(request?.args) ? request.args[0] : request?.args
  const companionResult = companionShell?.handleHostMethod(method, hostArgs)
  if (companionResult !== undefined) return companionResult
  const skinResult = companionSkinHost?.handleHostMethod(method, hostArgs)
  if (skinResult !== undefined) return skinResult
  if (method === 'GetLinuxDevelopmentProtocolStatus') {
    return {
      available: process.platform === 'linux' && !app.isPackaged && process.env.MILKSU_PLUGIN_DEV === '1',
      enabled: Boolean(linuxDevelopmentProtocol),
    }
  }
  if (method === 'SetLinuxDevelopmentProtocol') {
    const payload = Array.isArray(request?.args) ? request.args[0] : request?.args
    return linuxDevelopmentProtocolAction(payload?.enabled === true)
  }
  // Packaging provenance is owned by the desktop shell, not Go domain logic.
  if (method === 'GetBuildTracking') return loadBuildTracking()
  // Task notifications are shell-owned too: the renderer only asks.
  // Dependency injection mirrors desktop/task-notify.cjs so the decision stays pure/testable.
  if (method === 'NotifyTask') {
    const notifyInput = hostArgs ?? {}
    // 一次调用只取一次时间 ⇒ 判断与写入用同一个 now（避免边界抖动）。
    const notifyNow = Date.now()
    const reason = shouldNotify(notifyInput, {
      // 开关在渲染层已查过（没开根本不会调进来）；外壳这里恒开，只管前台压制与去重。
      enabled: true,
      // "聚焦"要的是"这个窗口是当前活跃窗口"，**不是**"窗口可见" ✗：
      // 窗口在后台但仍可见（用户在看别的 App）时也要弹通知，否则等于永远收不到。
      focused: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
      // 会话级压制："正在看的会话"由渲染层随 args 传上来（渲染层知道 activeId）。
      // focused 只代表"整个窗口聚焦"；二者合起来才是"你正在看的那个会话" ⇒ 只压它，后台会话照弹。
      // 缺省/空 ⇒ task-notify.cjs 不压（不吞掉通知 ✗）。
      activeConversationId: notifyInput.activeConversationId,
      platform: process.platform,
      lastNotified: taskNotifySeen,
      now: notifyNow,
    })
    if (reason !== 'notify') return { shown: false, reason }
    // 写入前剪枝（超过窗口的项删掉，避免 Map 无限增长）：按时间清理是安全的，
    // 因为"只发一次"由键保证，清理时机不参与正确性判断。
    for (const [seenKey, seenAt] of taskNotifySeen) {
      // 与 task-notify.cjs 的 seenAllowsAgain 保持同一口径（严格超过才放行）
      if (notifyNow - Number(seenAt) > TASK_NOTIFY_WINDOW_MS) taskNotifySeen.delete(seenKey)
    }
    taskNotifySeen.set(taskNotifyKey(notifyInput), notifyNow)
    const notifyResult = show(buildPayload(notifyInput), {
      platform: process.platform,
      Notification,
      onClick: value => {
        // 点了通知 = 已读 ⇒ 立刻清角标（窗口获得焦点时还会再清一次，幂等 ✓）。
        applyTaskNotifyBadge(badgeAfterRead())
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show()
          mainWindow.focus()
        }
        emitRendererEvent('task.notify.clicked', { conversationId: value?.conversationId ?? '' })
      },
    })
    if (notifyResult === 'shown') {
      // 角标：真的弹出来才 +1；用户回前台（或点通知）时清零 ⇒ “看过就不再提醒”。
      applyTaskNotifyBadge(badgeAfterNotify(taskNotifyBadge, notifyResult))
      return { shown: true }
    }
    return { shown: false, reason: notifyResult }
  }
  if (method === 'SetTitleBarOverlay') {
    const payload = Array.isArray(request?.args) ? request.args[0] : request?.args
    const theme = payload?.theme === 'dark' ? 'dark' : 'light'
    const source = nativeThemeSource(payload?.mode, theme)
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source
    return applyWindowChrome(mainWindow, {
      platform: process.platform,
      theme,
    })
  }
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
    await writeAccountLoginClaim(os.tmpdir(), {
      instanceId: process.env.MILKSU_INSTANCE_ID || '',
      pid: process.pid,
      execPath: process.execPath,
      script: firstProtocolClientScript(process.argv, process.execPath),
      appPath: app.isPackaged ? '' : app.getAppPath(),
    })
    watchForwardedAccountCallback()
    try {
      return await accountSession.startLogin()
    } catch (error) {
      await clearAccountLoginClaim(os.tmpdir(), process.pid)
      throw error
    }
  }
  if (method === 'StartAccountPasswordLogin') {
    if (!accountSession) throw new Error('内测账户尚未就绪')
    const payload = Array.isArray(request?.args) ? request.args[0] : request?.args
    return accountSession.startPasswordLogin(payload?.username, payload?.password)
  }
  if (method === 'ChangeAccountPassword') {
    if (!accountSession) throw new Error('内测账户尚未就绪')
    const payload = Array.isArray(request?.args) ? request.args[0] : request?.args
    return accountSession.changeAccountPassword(payload?.currentPassword, payload?.newPassword)
  }
  if (method === 'SetAccountPassword') {
    if (!accountSession) throw new Error('内测账户尚未就绪')
    const payload = Array.isArray(request?.args) ? request.args[0] : request?.args
    return accountSession.setAccountPassword(payload?.username, payload?.password)
  }
  if (method === 'LogoutAccount') {
    if (!accountSession) return { configured: false, state: 'unconfigured', authenticated: false }
    await clearAccountLoginClaim(os.tmpdir(), process.pid)
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
  if (method === 'CancelUpdate') {
    return updateManager?.cancel() ?? {
      state: 'idle',
      currentVersion: app.getVersion(),
      enabled: false,
    }
  }
  if (method === 'InstallUpdate') {
    if (!updateManager || updateManager.view().state !== 'downloaded') return false
    if (browserShell) await browserShell.closeAll()
    quitting = true
    const started = await updateManager.install()
    if (!started) {
      quitting = false
      return false
    }
    return true
  }
  try {
    return await backend.invokeFromRenderer(method, request?.args)
  } catch (error) {
    if (
      accountSession
      && accountModelAuthorizationRefreshRequired(method, error)
      && await syncAccountModelAuthorization(await accountSession.status())
    ) {
      return backend.invokeFromRenderer(method, request?.args)
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
  void deliverAccountCallback(url)
})

app.on('second-instance', (_event, argv = []) => {
  const callback = accountCallbackFromArgv(argv, desktopChannel)
  if (callback) {
    if (!accountSession) {
      pendingAccountCallback = callback
      return
    }
    void deliverAccountCallback(callback)
    return
  }
  focusMainWindow()
})

app.whenReady().then(async () => {
  if (process.platform === 'linux' && !app.isPackaged && process.env.MILKSU_PLUGIN_DEV === '1') {
    try {
      const { clearStaleLinuxDevelopmentProtocol } = await import(pathToFileURL(
        path.join(app.getAppPath(), '..', 'scripts', 'lib', 'linux-development-protocol.mjs'),
      ).href)
      const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
      const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
      const xdgTimeout = { timeout: 10_000 }
      const currentHandler = async () => {
        try {
          const { stdout } = await execFileAsync('xdg-mime', ['query', 'default', 'x-scheme-handler/milksu'], xdgTimeout)
          return stdout
        } catch {
          return ''
        }
      }
      if (await clearStaleLinuxDevelopmentProtocol({
        applicationsDirectory: path.join(dataHome, 'applications'),
        configDirectory: configHome,
        currentHandler,
        setDefaultHandler: async (desktopFile, mimeType) => {
          await execFileAsync('xdg-mime', ['default', desktopFile, mimeType], xdgTimeout)
        },
        refreshApplications: async applicationsDirectory => {
          await execFileAsync('update-desktop-database', [applicationsDirectory], xdgTimeout)
        },
        log: message => startupLog('linux-development-protocol.stale-association-cleanup', message),
      })) startupLog('linux-development-protocol.stale-association-cleared')
    } catch (error) {
      startupLog('linux-development-protocol.stale-association-cleanup', String(error?.message ?? error))
    }
  }
  startupLog('app.whenReady')
  if (process.env.MILKSU_REGISTER_PROTOCOL === '1' && app.isPackaged) {
    app.setAsDefaultProtocolClient('milksu')
    if (process.platform === 'darwin') app.dock?.hide()
    app.exit(0)
    return
  }
  if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
    app.setAppUserModelId(desktopIdentity.appId)
  }
  await startupTime('installRendererProtocol', () => installRendererProtocol())
  const protocolClient = desktopProtocolClientRegistration({
    channel: desktopChannel,
    isPackaged: app.isPackaged,
    defaultApp: Boolean(process.defaultApp),
    execPath: process.execPath,
    argv: process.argv,
    instanceId: process.env.MILKSU_INSTANCE_ID,
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
      if (value?.state === 'active') {
        void updateManager?.check()
        updateManager?.startPolling()
      } else {
        updateManager?.clearAuthorization()
      }
    },
  })
  updateManager = new UpdateManager({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    enabled: app.isPackaged
      && desktopChannel === 'stable'
      && accountConfig.configured
      && ['darwin', 'win32', 'linux'].includes(process.platform)
      && (process.arch === 'arm64' || process.arch === 'x64'),
    platform: process.platform,
    arch: process.arch,
    apiUrl: accountConfig.apiUrl,
    userDataPath: app.getPath('userData'),
    execPath: process.execPath,
    getAuthorization: () => accountSession.activeAccessToken(),
    onChanged: value => emitRendererEvent('update.changed', value),
  })
  if (pendingAccountCallback) {
    const callback = pendingAccountCallback
    pendingAccountCallback = ''
    const handed = await startupTime('account.handleCallback', () => deliverAccountCallback(callback))
    if (handed === 'forwarded') {
      if (process.platform === 'darwin') app.dock?.hide()
      app.exit(0)
      return
    }
  }
  const upstreamEndpoint = await waitForDevTools()
  createWindow()
  companionShell = createCompanionShell({
    app,
    BrowserWindow,
    Tray,
    Menu,
    nativeImage,
    APP_ORIGIN,
    resourcesPath: process.resourcesPath,
    repositoryRoot: path.join(__dirname, '..'),
    isPackaged: app.isPackaged,
    getMainWindow: () => mainWindow,
    setMainWindow: window => { mainWindow = window },
    onQuitRequested: () => app.quit(),
    screen,
    net,
    powerMonitor,
  })
  companionSkinHost = createCompanionSkinHost({
    userDataPath: app.getPath('userData'),
    openDirectory: payload => handleHostRequest('dialog.openDirectory', payload),
    listCompanionPlugins: async () => {
      if (!backend) return []
      try {
        const rows = await backend.invokeFromElectronHost('ListCompanionPluginPackages', [])
        return Array.isArray(rows) ? rows : []
      } catch {
        return []
      }
    },
    emit: (event, value) => companionShell?.emit(event, value),
  })
  companionShell.register('main', mainWindow, null)
  companionShell.createTray()
  companionShell.createFloat()
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    companionShell.parkMainWindow()
    companionShell.createTray()
    companionShell.createFloat()
  })
  mainWindow.on('restore', () => {
    companionShell.revealFromTaskbar()
  })
  // 回到前台 = 用户已经看到了 ⇒ 清角标（“已读即清”）。与点通知里的清零同一口径、幂等 ✓。
  mainWindow.on('focus', () => {
    applyTaskNotifyBadge(badgeAfterRead())
  })
  companionShell.refreshMenus()
  startupLog('createWindow')
  browserShell = new BrowserShell(mainWindow, upstreamEndpoint)
  const backendSpawnStarted = Date.now()
  backend = createDesktopBackend(handleHostRequest, emitRendererEvent)
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
  const startupQuery = process.env.MILKSU_OPEN_SETTINGS === 'plugins' ? '?open-settings=plugins' : ''
  await startupTime('loadURL', () => mainWindow.loadURL(`${APP_ORIGIN}/index.html${startupQuery}`))
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

app.on('activate', () => {
  if (companionShell) {
    companionShell.revealFromTaskbar()
    return
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (quitting) return
  if (companionShell) {
    companionShell.handleWindowAllClosed()
    return
  }
  app.quit()
})

app.on('before-quit', () => {
  const registration = linuxDevelopmentProtocol
  linuxDevelopmentProtocol = null
  if (registration) {
    // Cmd+Q must not be intercepted for async work; restore the protocol
    // association synchronously. Every xdg call inside is bounded by the
    // xdg timeouts, and a failed restore is logged while the quit proceeds.
    try {
      registration.restoreSync()
    } catch (error) {
      startupLog('linux-development-protocol.restore', String(error?.message ?? error))
    }
  }
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
  // Cmd+Q / menu Quit must end the process. Do not recreate the pet or wait
  // for Go/browser teardown. stdin EOF / this shutdown line is enough for Go
  // to mark a clean exit.
  try {
    companionShell?.beginQuit()
  } catch {}
  try {
    backend?.beginStop()
    backend?.send({ type: 'shutdown' }, { allowClosed: true })
  } catch {}
})

process.on('SIGTERM', () => app.quit())
process.on('SIGINT', () => app.quit())
