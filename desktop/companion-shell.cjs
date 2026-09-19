'use strict'

const path = require('node:path')
const { linuxDesktopSession } = require('./linux-desktop.cjs')

const COMPANION_METHODS = new Set([
  'GetCompanionStatus',
  'SendCompanionMessage',
  'GetCompanionBoard',
  'ListCompanionTranscript',
  'ArchiveCompanionTranscript',
  'ListCompanionArchives',
  'DeleteCompanionArchive',
  'GetCompanionMemory',
  'ApproveCompanionMemory',
  'ForgetCompanionMemory',
  'ConfirmCompanionDispatch',
  'GetCompanionShellStatus',
  'SetCompanionFloatEnabled',
  'QuitCompanionShell',
  'GetSettings',
])

function createCompanionShell({
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  APP_ORIGIN,
  resourcesPath,
  repositoryRoot,
  isPackaged,
  getMainWindow,
  setMainWindow,
  onQuitRequested,
}) {
  const session = linuxDesktopSession()
  const wayland = process.platform === 'linux' && session.wayland
  /** @type {Map<string, { window: import('electron').BrowserWindow, methods: Set<string> | null }>} */
  const registry = new Map()
  let companionWindow = null
  let tray = null
  let floatEnabled = !wayland
  let quitting = false

  function iconPath() {
    if (isPackaged) return path.join(String(resourcesPath || ''), 'icon.png')
    return path.join(repositoryRoot, 'build', 'appicon.png')
  }

  function register(id, window, methods) {
    if (!window || window.isDestroyed()) return
    registry.set(id, { window, methods: methods === null ? null : new Set(methods) })
    window.on('closed', () => registry.delete(id))
  }

  function senderAllowed(event, method) {
    for (const entry of registry.values()) {
      if (entry.window.isDestroyed()) continue
      if (event.sender !== entry.window.webContents) continue
      if (event.senderFrame !== entry.window.webContents.mainFrame) continue
      if (!event.senderFrame?.url?.startsWith(`${APP_ORIGIN}/`)) return false
      if (entry.methods && !entry.methods.has(method)) return false
      return true
    }
    return false
  }

  function emit(event, value) {
    for (const entry of registry.values()) {
      if (entry.window.isDestroyed()) continue
      entry.window.webContents.send(`milksu:event:${event}`, value)
    }
  }

  function status() {
    return {
      floating: Boolean(companionWindow && !companionWindow.isDestroyed()),
      wayland,
      tray: Boolean(tray),
    }
  }

  function createTray() {
    if (tray) return
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip('MilkSU')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'MilkSU',
        click: () => showMain(),
      },
      {
        label: 'Companion',
        click: () => {
          showMain()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          onQuitRequested?.()
        },
      },
    ]))
  }

  function showMain() {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (process.platform === 'darwin' && app.dock) app.dock.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  function createFloat() {
    if (wayland || !floatEnabled) return null
    if (companionWindow && !companionWindow.isDestroyed()) return companionWindow
    companionWindow = new BrowserWindow({
      width: 220,
      height: 280,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'companion-preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
    companionWindow.setIgnoreMouseEvents(true, { forward: true })
    companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    companionWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault()
    })
    companionWindow.on('closed', () => {
      companionWindow = null
      registry.delete('companion')
    })
    register('companion', companionWindow, COMPANION_METHODS)
    void companionWindow.loadURL(`${APP_ORIGIN}/index.html?surface=companion`)
    companionWindow.once('ready-to-show', () => {
      if (companionWindow && !companionWindow.isDestroyed()) companionWindow.show()
    })
    return companionWindow
  }

  function closeFloat() {
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close()
    companionWindow = null
  }

  function setFloatEnabled(enabled) {
    floatEnabled = Boolean(enabled) && !wayland
    if (floatEnabled) createFloat()
    else closeFloat()
    return status()
  }

  function handleWindowAllClosed() {
    if (quitting) {
      app.quit()
      return
    }
    createTray()
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    if (floatEnabled && !wayland) createFloat()
  }

  function handleHostMethod(method, payload) {
    if (method === 'GetCompanionShellStatus') return status()
    if (method === 'SetCompanionFloatEnabled') {
      return setFloatEnabled(payload === true || payload?.enabled === true)
    }
    if (method === 'QuitCompanionShell') {
      quitting = true
      onQuitRequested?.()
      return null
    }
    return undefined
  }

  return {
    COMPANION_METHODS,
    register,
    senderAllowed,
    emit,
    status,
    createTray,
    createFloat,
    setFloatEnabled,
    handleWindowAllClosed,
    handleHostMethod,
    wayland,
  }
}

module.exports = {
  COMPANION_METHODS,
  createCompanionShell,
}
