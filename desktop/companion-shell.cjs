'use strict'

const path = require('node:path')

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
  'SetCompanionPetHidden',
  'ShowCompanionMainWindow',
  'QuitCompanionShell',
  'GetSettings',
])

const COMPANION_FLOAT_WIDTH = 232
const COMPANION_FLOAT_HEIGHT = 360

function isWaylandSession(env = process.env, platform = process.platform) {
  return platform === 'linux' && (
    String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
    || Boolean(env.WAYLAND_DISPLAY)
  )
}

function normalizeUiLocale(value, fallback = 'zh') {
  const locale = String(value ?? '').trim().toLowerCase()
  if (locale === 'en' || locale.startsWith('en-')) return 'en'
  if (locale === 'zh' || locale.startsWith('zh')) return 'zh'
  return fallback === 'en' ? 'en' : 'zh'
}

function createCompanionShell(options) {
  const {
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
    getUiLocale,
  } = options
  const platform = options.platform || process.platform
  const wayland = isWaylandSession(options.env, platform)
  const windows = new Map()
  let float = null
  let tray = null
  let enabled = !wayland
  let petHidden = false
  let uiLocale = normalizeUiLocale(
    typeof getUiLocale === 'function' ? getUiLocale() : '',
    'zh',
  )

  function t(zh, en) {
    return uiLocale === 'en' ? en : zh
  }

  function rememberLocale(value) {
    if (value == null || value === '') return
    uiLocale = normalizeUiLocale(value, uiLocale)
  }

  function keepAppPresence() {
    if (platform === 'darwin' && app.dock) app.dock.show()
  }

  function iconPath() {
    if (isPackaged) return path.join(resourcesPath, 'appicon.png')
    return path.join(repositoryRoot, 'build', 'appicon.png')
  }

  function status() {
    return {
      floating: Boolean(float) && !wayland,
      hidden: petHidden || !float,
      wayland,
      tray: Boolean(tray),
    }
  }

  function refreshTrayMenu() {
    if (!tray) return
    const petVisible = Boolean(float) && !petHidden
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: petVisible ? t('隐藏桌宠', 'Hide companion') : t('显示桌宠', 'Show companion'),
        enabled: enabled && !wayland,
        click: () => {
          if (petVisible) hidePet()
          else showPet()
        },
      },
      {
        label: t('打开主窗口', 'Open MilkSU'),
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: t('退出', 'Quit'),
        click: () => onQuitRequested(),
      },
    ]))
  }

  function createTray() {
    keepAppPresence()
    if (tray) {
      refreshTrayMenu()
      return
    }
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip('MilkSU')
    tray.on('click', () => {
      if (enabled && !wayland && petHidden) showPet()
      else showMainWindow()
    })
    refreshTrayMenu()
  }

  function showMainWindow() {
    let main = getMainWindow()
    if (!main || main.isDestroyed()) {
      main = new BrowserWindow({
        width: 1440,
        height: 900,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          sandbox: true,
        },
      })
      setMainWindow(main)
      main.loadURL(`${APP_ORIGIN}/index.html`)
    }
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    return status()
  }

  function parkMainWindow() {
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return
    keepAppPresence()
    if (platform === 'win32') {
      main.minimize()
    } else {
      main.hide()
    }
  }

  function hidePet() {
    petHidden = true
    if (float && !float.isDestroyed()) float.hide()
    refreshTrayMenu()
    return status()
  }

  function showPet() {
    if (!enabled || wayland) return status()
    petHidden = false
    createFloat()
    if (float && !float.isDestroyed()) {
      float.show()
      float.setAlwaysOnTop(true, 'screen-saver')
    }
    refreshTrayMenu()
    return status()
  }

  function revealFromTaskbar() {
    keepAppPresence()
    createTray()
    if (enabled && !wayland) showPet()
    return status()
  }

  function createFloat() {
    if (!enabled || wayland) return
    if (float && !float.isDestroyed()) {
      if (!petHidden) {
        float.show()
        float.setAlwaysOnTop(true, 'screen-saver')
      }
      return
    }
    float = new BrowserWindow({
      width: COMPANION_FLOAT_WIDTH,
      height: COMPANION_FLOAT_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: !petHidden,
      webPreferences: {
        preload: path.join(__dirname, 'companion-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    float.setAlwaysOnTop(true, 'screen-saver')
    float.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    float.loadURL(`${APP_ORIGIN}/index.html?surface=companion`)
    float.on('closed', () => {
      float = null
      windows.delete('companion')
    })
    register('companion', float, path.join(__dirname, 'companion-preload.cjs'))
  }

  function setEnabled(next) {
    enabled = Boolean(next) && !wayland
    if (!enabled) {
      petHidden = false
      if (float && !float.isDestroyed()) float.close()
      float = null
      refreshTrayMenu()
      return status()
    }
    createFloat()
    refreshTrayMenu()
    return status()
  }

  function register(id, window, preloadPath) {
    windows.set(id, { window, preloadPath })
  }

  function senderAllowed(event, method = '') {
    const frame = event.senderFrame
    if (!frame || !event.sender || !String(frame.url || '').startsWith(`${APP_ORIGIN}/`)) {
      return false
    }
    for (const [id, entry] of windows) {
      if (entry.window.isDestroyed() || event.sender !== entry.window.webContents) continue
      if (event.senderFrame !== entry.window.webContents.mainFrame) return false
      if (id === 'companion') return COMPANION_METHODS.has(method)
      return true
    }
    return false
  }

  function emit(event, value) {
    for (const entry of windows.values()) {
      if (!entry.window.isDestroyed()) {
        entry.window.webContents.send(`milksu:event:${event}`, value)
      }
    }
  }

  function handleHostMethod(method, args = {}) {
    const payload = args && typeof args === 'object' ? args : {}
    rememberLocale(payload.locale)
    if (method === 'GetCompanionShellStatus') return status()
    if (method === 'SetCompanionFloatEnabled') {
      const next = typeof args === 'boolean' ? args : payload.enabled !== false
      return setEnabled(next)
    }
    if (method === 'SetCompanionPetHidden') {
      if (!enabled || wayland) return status()
      const hidden = typeof args === 'boolean' ? args : payload.hidden === true
      return hidden ? hidePet() : showPet()
    }
    if (method === 'ShowCompanionMainWindow') return showMainWindow()
    if (method === 'QuitCompanionShell') {
      onQuitRequested()
      return null
    }
    return undefined
  }

  function handleWindowAllClosed() {
    keepAppPresence()
    if (enabled && !wayland) {
      createTray()
      createFloat()
      return
    }
    onQuitRequested()
  }

  return {
    register,
    senderAllowed,
    emit,
    handleHostMethod,
    createTray,
    createFloat,
    handleWindowAllClosed,
    parkMainWindow,
    hidePet,
    showPet,
    revealFromTaskbar,
    keepAppPresence,
    status,
    setFloatEnabled: setEnabled,
  }
}

module.exports = {
  COMPANION_METHODS,
  COMPANION_FLOAT_WIDTH,
  COMPANION_FLOAT_HEIGHT,
  createCompanionShell,
  isWaylandSession,
  normalizeUiLocale,
}
