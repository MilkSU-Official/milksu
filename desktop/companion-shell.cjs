'use strict'

const path = require('node:path')
const { productApplicationMenuTemplate } = require('./renderer-reload.cjs')

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
  'ShowCompanionChatWindow',
  'HideCompanionChatWindow',
  'ShowCompanionSettings',
  'PopupCompanionMenu',
  'MoveCompanionPet',
  'ParkCompanionMainWindow',
  'QuitCompanionShell',
  'GetSettings',
  'EnsureCompanion',
  'ListCompanionSkins',
  'GetCompanionSkin',
])

const COMPANION_FLOAT_WIDTH = 232
const COMPANION_FLOAT_HEIGHT = 400
const COMPANION_CHAT_WIDTH = 336
const COMPANION_CHAT_HEIGHT = 480

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

function companionActionMenuTemplate(options = {}) {
  const t = typeof options.t === 'function' ? options.t : (zh, en) => zh
  const petVisible = options.petVisible === true
  const enabled = options.enabled !== false
  const wayland = options.wayland === true
  const includeQuit = options.includeQuit !== false
  const actions = options.actions || {}
  const items = [
    {
      id: 'chat',
      label: t('对话', 'Chat'),
      click: () => actions.openChat?.(),
    },
    {
      id: 'toggle-pet',
      label: petVisible ? t('隐藏桌宠', 'Hide companion') : t('显示桌宠', 'Show companion'),
      enabled: enabled && !wayland,
      click: () => {
        if (petVisible) actions.hidePet?.()
        else actions.showPet?.()
      },
    },
    {
      id: 'main',
      label: t('打开主窗口', 'Open MilkSU'),
      click: () => actions.showMain?.(),
    },
    {
      id: 'settings',
      label: t('桌宠设置', 'Companion settings'),
      click: () => actions.openSettings?.(),
    },
  ]
  if (includeQuit) {
    items.push({ type: 'separator' })
    items.push({
      id: 'quit',
      label: t('退出', 'Quit'),
      click: () => actions.quit?.(),
    })
  }
  return items
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
  let chat = null
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

  function mainParked() {
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return true
    if (typeof main.isMinimized === 'function' && main.isMinimized()) return true
    if (typeof main.isVisible === 'function' && !main.isVisible()) return true
    return false
  }

  function petVisible() {
    return Boolean(float) && !petHidden && enabled && !wayland
  }

  function chatOpen() {
    return Boolean(chat) && !chat.isDestroyed() && (typeof chat.isVisible !== 'function' || chat.isVisible())
  }

  function actionMenu(extra = {}) {
    return companionActionMenuTemplate({
      t,
      petVisible: petVisible(),
      enabled,
      wayland,
      includeQuit: extra.includeQuit,
      actions: {
        openChat: () => showChatWindow(),
        hidePet,
        showPet,
        showMain: () => showMainWindow(),
        openSettings: () => showCompanionSettings(),
        quit: () => onQuitRequested(),
      },
    })
  }

  function menuSnapshot() {
    return actionMenu({ includeQuit: true })
      .filter(item => item && item.label)
      .map(item => ({ id: item.id, label: item.label }))
  }

  function windowBounds(window) {
    if (!window || window.isDestroyed() || typeof window.getBounds !== 'function') return null
    const bounds = window.getBounds()
    return {
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width: Number(bounds.width) || 0,
      height: Number(bounds.height) || 0,
    }
  }

  function status() {
    return {
      floating: Boolean(float) && !wayland,
      hidden: petHidden || !float,
      chatOpen: chatOpen(),
      wayland,
      tray: Boolean(tray),
      parked: mainParked(),
      platform,
      menu: menuSnapshot(),
      petBounds: windowBounds(float),
      chatBounds: windowBounds(chat),
    }
  }

  function refreshTrayMenu() {
    if (!tray) return
    const menu = Menu.buildFromTemplate(actionMenu({ includeQuit: true }))
    tray.setContextMenu(menu)
  }

  function refreshDockMenu() {
    if (platform !== 'darwin' || !app.dock || typeof app.dock.setMenu !== 'function') return
    app.dock.setMenu(Menu.buildFromTemplate(actionMenu({ includeQuit: false })))
  }

  function refreshAppMenu() {
    if (!Menu || typeof Menu.setApplicationMenu !== 'function') return
    const companion = {
      label: t('桌宠', 'Companion'),
      submenu: actionMenu({ includeQuit: platform !== 'darwin' }),
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(productApplicationMenuTemplate(platform, { companion })))
  }

  function refreshMenus() {
    refreshTrayMenu()
    refreshDockMenu()
    refreshAppMenu()
  }

  function createTray() {
    keepAppPresence()
    if (tray) {
      refreshMenus()
      return
    }
    const image = nativeImage.createFromPath(iconPath())
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
    tray.setToolTip('MilkSU')
    tray.on('click', () => {
      if (enabled && !wayland && petHidden) showPet()
      else showMainWindow()
    })
    if (typeof tray.on === 'function') {
      tray.on('right-click', () => {
        if (typeof tray.popUpContextMenu === 'function') tray.popUpContextMenu()
      })
    }
    refreshMenus()
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
    refreshMenus()
    return status()
  }

  function showCompanionSettings() {
    const shown = showMainWindow()
    emit('companion.navigate', { section: 'settings', category: 'companion' })
    return shown
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
    refreshMenus()
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
    refreshMenus()
    return status()
  }

  function chatBounds() {
    const width = COMPANION_CHAT_WIDTH
    const height = COMPANION_CHAT_HEIGHT
    let x = 48
    let y = 72
    if (float && !float.isDestroyed() && typeof float.getBounds === 'function') {
      const pet = float.getBounds()
      x = Number(pet.x) - width - 12
      if (x < 8) x = Number(pet.x) + Number(pet.width || COMPANION_FLOAT_WIDTH) + 12
      y = Number(pet.y)
    }
    return { x, y, width, height }
  }

  function shiftWindow(window, dx, dy) {
    if (!window || window.isDestroyed() || (!dx && !dy)) return
    const bounds = typeof window.getBounds === 'function'
      ? window.getBounds()
      : { x: 0, y: 0 }
    const x = Math.round(Number(bounds.x) + dx)
    const y = Math.round(Number(bounds.y) + dy)
    if (typeof window.setPosition === 'function') {
      window.setPosition(x, y)
      return
    }
    if (typeof window.setBounds === 'function') {
      window.setBounds({
        x,
        y,
        width: bounds.width,
        height: bounds.height,
      })
    }
  }

  function movePet(payload = {}) {
    if (!enabled || wayland || !float || float.isDestroyed()) return status()
    const dx = Number(payload.dx)
    const dy = Number(payload.dy)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      return status()
    }
    shiftWindow(float, dx, dy)
    if (chatOpen()) shiftWindow(chat, dx, dy)
    return status()
  }

  function hideChatWindow() {
    if (chat && !chat.isDestroyed()) chat.hide()
    refreshMenus()
    return status()
  }

  function showChatWindow() {
    if (enabled && !wayland) showPet()
    createChat()
    if (chat && !chat.isDestroyed()) {
      const bounds = chatBounds()
      if (typeof chat.setBounds === 'function') chat.setBounds(bounds)
      chat.show()
      chat.focus()
    }
    refreshMenus()
    return status()
  }

  function popupCompanionMenu(payload = {}) {
    if (!Menu || typeof Menu.buildFromTemplate !== 'function') return status()
    const menu = Menu.buildFromTemplate(actionMenu({ includeQuit: true }))
    const target = (float && !float.isDestroyed() && petVisible()) ? float : getMainWindow()
    if (menu && typeof menu.popup === 'function' && target && !target.isDestroyed()) {
      menu.popup({
        window: target,
        x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : undefined,
        y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : undefined,
      })
    }
    return status()
  }

  function revealFromTaskbar() {
    keepAppPresence()
    createTray()
    if (enabled && !wayland) showPet()
    refreshMenus()
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
      useContentSize: true,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      hiddenInMissionControl: true,
      movable: true,
      show: !petHidden,
      ...(platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'companion-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    if (typeof float.setWindowButtonVisibility === 'function') {
      float.setWindowButtonVisibility(false)
    }
    float.setAlwaysOnTop(true, 'screen-saver')
    float.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    float.loadURL(`${APP_ORIGIN}/index.html?surface=companion`)
    float.on('closed', () => {
      float = null
      windows.delete('companion')
    })
    register('companion', float, path.join(__dirname, 'companion-preload.cjs'))
  }

  function createChat() {
    if (chat && !chat.isDestroyed()) return
    const bounds = chatBounds()
    chat = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      useContentSize: true,
      frame: false,
      transparent: false,
      resizable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      show: true,
      minWidth: 280,
      minHeight: 360,
      webPreferences: {
        preload: path.join(__dirname, 'companion-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    if (typeof chat.setWindowButtonVisibility === 'function') {
      chat.setWindowButtonVisibility(false)
    }
    chat.setAlwaysOnTop(true, 'screen-saver')
    chat.loadURL(`${APP_ORIGIN}/index.html?surface=companion-chat`)
    chat.on('closed', () => {
      chat = null
      windows.delete('companion-chat')
      refreshMenus()
    })
    register('companion-chat', chat, path.join(__dirname, 'companion-preload.cjs'))
  }

  function setEnabled(next) {
    enabled = Boolean(next) && !wayland
    if (!enabled) {
      petHidden = false
      if (float && !float.isDestroyed()) float.close()
      float = null
      if (chat && !chat.isDestroyed()) chat.close()
      chat = null
      refreshMenus()
      return status()
    }
    createFloat()
    refreshMenus()
    return status()
  }

  function register(id, window, preloadPath) {
    windows.set(id, { window, preloadPath })
  }

  function isCompanionSurface(id) {
    return id === 'companion' || id === 'companion-chat'
  }

  function senderAllowed(event, method = '') {
    const frame = event.senderFrame
    if (!frame || !event.sender || !String(frame.url || '').startsWith(`${APP_ORIGIN}/`)) {
      return false
    }
    for (const [id, entry] of windows) {
      if (entry.window.isDestroyed() || event.sender !== entry.window.webContents) continue
      if (event.senderFrame !== entry.window.webContents.mainFrame) return false
      if (isCompanionSurface(id)) return COMPANION_METHODS.has(method)
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
    const payload = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
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
    if (method === 'ShowCompanionChatWindow') return showChatWindow()
    if (method === 'HideCompanionChatWindow') return hideChatWindow()
    if (method === 'ShowCompanionSettings') return showCompanionSettings()
    if (method === 'PopupCompanionMenu') return popupCompanionMenu(payload)
    if (method === 'MoveCompanionPet') return movePet(payload)
    if (method === 'ParkCompanionMainWindow') {
      parkMainWindow()
      createTray()
      if (enabled && !wayland) createFloat()
      return status()
    }
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
    createChat,
    handleWindowAllClosed,
    parkMainWindow,
    hidePet,
    showPet,
    showChatWindow,
    hideChatWindow,
    revealFromTaskbar,
    keepAppPresence,
    refreshMenus,
    status,
    setFloatEnabled: setEnabled,
  }
}

module.exports = {
  COMPANION_METHODS,
  COMPANION_FLOAT_WIDTH,
  COMPANION_FLOAT_HEIGHT,
  COMPANION_CHAT_WIDTH,
  COMPANION_CHAT_HEIGHT,
  companionActionMenuTemplate,
  createCompanionShell,
  isWaylandSession,
  normalizeUiLocale,
}
