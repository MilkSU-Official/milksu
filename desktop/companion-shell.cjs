'use strict'

const path = require('node:path')
const { productApplicationMenuTemplate } = require('./renderer-reload.cjs')
const {
  COMPANION_OVERLAY_ACTIONS,
  COMPANION_CHAT_HEIGHT,
  COMPANION_CHAT_WIDTH,
  COMPANION_PET_HEIGHT,
  COMPANION_PET_WIDTH,
  COMPANION_OVERLAY_Z_LEVEL,
  clampCompanionMenuOrigin,
  defaultCompanionPetOrigin,
  layoutCompanionUnit,
  moveCompanionUnit,
  reduceCompanionOverlay,
} = require('./companion-overlay-state.cjs')

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
  'ClickCompanionPet',
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

const COMPANION_FLOAT_WIDTH = COMPANION_PET_WIDTH
const COMPANION_FLOAT_HEIGHT = COMPANION_PET_HEIGHT

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
    screen,
  } = options
  const platform = options.platform || process.platform
  const wayland = isWaylandSession(options.env, platform)
  const windows = new Map()
  let float = null
  let chatOpenFlag = false
  let unitLayout = null
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
    return chatOpenFlag
  }

  function snapshot() {
    return {
      enabled,
      wayland,
      petHidden,
      chatOpen: chatOpenFlag,
      mainVisible: !mainParked(),
    }
  }

  function workAreaNear(point) {
    if (!screen || typeof screen.getDisplayNearestPoint !== 'function') return null
    try {
      const display = screen.getDisplayNearestPoint({
        x: Math.round(Number(point?.x) || 0),
        y: Math.round(Number(point?.y) || 0),
      })
      const area = display && display.workArea
      if (!area) return null
      return {
        x: Number(area.x) || 0,
        y: Number(area.y) || 0,
        width: Number(area.width) || 0,
        height: Number(area.height) || 0,
      }
    } catch {
      return null
    }
  }

  function primaryWorkArea() {
    if (screen && typeof screen.getPrimaryDisplay === 'function') {
      const area = screen.getPrimaryDisplay()?.workArea
      if (area) {
        return {
          x: Number(area.x) || 0,
          y: Number(area.y) || 0,
          width: Number(area.width) || 0,
          height: Number(area.height) || 0,
        }
      }
    }
    return workAreaNear({ x: 0, y: 0 })
  }

  function currentPetScreen() {
    if (unitLayout && unitLayout.petScreen) return unitLayout.petScreen
    const bounds = windowBounds(float)
    if (bounds && unitLayout && unitLayout.pet) {
      return { x: bounds.x + unitLayout.pet.x, y: bounds.y + unitLayout.pet.y }
    }
    if (bounds) return { x: bounds.x, y: bounds.y }
    return defaultCompanionPetOrigin(primaryWorkArea())
  }

  function emitOverlay() {
    emit('companion.overlay', {
      chatOpen: chatOpenFlag,
      chatSide: unitLayout?.chatSide === 'right' ? 'right' : 'left',
    })
  }

  function applyUnitLayout(layout) {
    unitLayout = layout
    if (!float || float.isDestroyed() || !layout?.window) return
    if (typeof float.setBounds === 'function') float.setBounds(layout.window)
    emitOverlay()
  }

  function relayoutUnit() {
    applyUnitLayout(layoutCompanionUnit({
      chatOpen: chatOpenFlag,
      petOrigin: currentPetScreen(),
      workArea: wayland ? null : (workAreaNear(currentPetScreen()) || primaryWorkArea()),
    }))
  }

  function keepOverlayAboveApps(window) {
    if (!window || window.isDestroyed()) return
    if (typeof window.setAlwaysOnTop === 'function') {
      window.setAlwaysOnTop(true, COMPANION_OVERLAY_Z_LEVEL)
    }
    if (typeof window.setVisibleOnAllWorkspaces === 'function') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    }
  }

  function hidePetWindow() {
    if (float && !float.isDestroyed()) float.hide()
  }

  function showPetWindow() {
    if (!enabled || wayland) return
    createFloat()
    if (float && !float.isDestroyed()) {
      float.show()
      keepOverlayAboveApps(float)
    }
  }

  function destroyOverlayWindows() {
    if (float && !float.isDestroyed()) float.close()
    float = null
    chatOpenFlag = false
    unitLayout = null
  }

  function applyDecision(decision) {
    enabled = decision.state.enabled
    petHidden = decision.state.petHidden
    chatOpenFlag = decision.state.chatOpen
    if (decision.effects.destroyOverlay) {
      destroyOverlayWindows()
      refreshMenus()
      return
    }
    if (decision.effects.pet === 'hide') hidePetWindow()
    else if (decision.effects.pet === 'show' || (decision.petVisible && (!float || float.isDestroyed()))) {
      showPetWindow()
    } else if (wayland && chatOpenFlag && (!float || float.isDestroyed())) {
      createFloat()
    }
    if (float && !float.isDestroyed() && decision.effects.pet !== 'hide') {
      relayoutUnit()
      if (decision.effects.chat === 'show' || decision.effects.chat === 'focus') {
        float.show()
        float.focus()
      }
    }
    if (decision.effects.main === 'show') showMainWindowImpl()
    else if (decision.effects.main === 'park') parkMainWindowImpl()
    if (decision.effects.navigateSettings) {
      emit('companion.navigate', { section: 'settings', category: 'companion' })
    }
    refreshMenus()
  }

  function dispatch(action) {
    applyDecision(reduceCompanionOverlay(snapshot(), action))
    return status()
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
    const petScreen = unitLayout?.petScreen
    const chatScreen = unitLayout?.chatScreen
    return {
      floating: Boolean(float) && !wayland,
      hidden: wayland || petHidden || !float,
      chatOpen: chatOpen(),
      wayland,
      tray: Boolean(tray),
      parked: mainParked(),
      platform,
      menu: menuSnapshot(),
      petBounds: petScreen
        ? {
            x: petScreen.x,
            y: petScreen.y,
            width: COMPANION_PET_WIDTH,
            height: COMPANION_PET_HEIGHT,
          }
        : windowBounds(float),
      chatBounds: chatOpenFlag && chatScreen ? chatScreen : null,
      overlay: {
        petVisible: petVisible(),
        chatOpen: chatOpen(),
        mainVisible: !mainParked(),
        chatSide: unitLayout?.chatSide === 'right' ? 'right' : 'left',
      },
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

  function showMainWindowImpl() {
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
  }

  function showMainWindow() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.SHOW_MAIN)
  }

  function showCompanionSettings() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.SHOW_SETTINGS)
  }

  function parkMainWindowImpl() {
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return
    keepAppPresence()
    if (platform === 'win32') {
      main.minimize()
    } else {
      main.hide()
    }
  }

  function parkMainWindow() {
    dispatch(COMPANION_OVERLAY_ACTIONS.PARK_MAIN)
  }

  function hidePet() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.HIDE_PET)
  }

  function showPet() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.SHOW_PET)
  }

  function movePet(payload = {}) {
    const decision = reduceCompanionOverlay(snapshot(), COMPANION_OVERLAY_ACTIONS.MOVE_PET)
    if (!decision.effects.drag.moveUnit || !float || float.isDestroyed()) return status()
    const dx = Number(payload.dx)
    const dy = Number(payload.dy)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      return status()
    }
    applyUnitLayout(moveCompanionUnit({
      petScreen: currentPetScreen(),
      dx,
      dy,
      chatOpen: chatOpenFlag,
      workArea: wayland ? null : (workAreaNear(currentPetScreen()) || primaryWorkArea()),
    }))
    return status()
  }

  function hideChatWindow() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.CLOSE_CHAT)
  }

  function showChatWindow() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.OPEN_CHAT)
  }

  function clickPet() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  }

  function popupCompanionMenu(payload = {}) {
    if (!Menu || typeof Menu.buildFromTemplate !== 'function') return status()
    const menu = Menu.buildFromTemplate(actionMenu({ includeQuit: true }))
    const target = (float && !float.isDestroyed() && petVisible()) ? float : getMainWindow()
    if (menu && typeof menu.popup === 'function' && target && !target.isDestroyed()) {
      const bounds = windowBounds(target) || { x: 0, y: 0, width: 0, height: 0 }
      const hasClient = Number.isFinite(Number(payload.x)) && Number.isFinite(Number(payload.y))
      let screenPoint
      if (hasClient) {
        screenPoint = {
          x: Number(bounds.x) + Number(payload.x),
          y: Number(bounds.y) + Number(payload.y),
        }
      } else if (screen && typeof screen.getCursorScreenPoint === 'function') {
        try {
          screenPoint = screen.getCursorScreenPoint()
        } catch {
          screenPoint = null
        }
      }
      if (!screenPoint || !Number.isFinite(Number(screenPoint.x))) {
        screenPoint = {
          x: Number(bounds.x) + Number(bounds.width || 0),
          y: Number(bounds.y) + Number(bounds.height || 0),
        }
      }
      const workArea = workAreaNear(screenPoint) || primaryWorkArea()
      const clamped = clampCompanionMenuOrigin({
        x: Number(screenPoint.x),
        y: Number(screenPoint.y),
        workArea,
      })
      menu.popup({
        window: target,
        x: Math.round(clamped.x - Number(bounds.x || 0)),
        y: Math.round(clamped.y - Number(bounds.y || 0)),
      })
    }
    return status()
  }

  function revealFromTaskbar() {
    keepAppPresence()
    createTray()
    return dispatch(COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR)
  }

  function createFloat() {
    const allow = (enabled && !wayland) || (wayland && chatOpenFlag)
    if (!allow) return
    if (float && !float.isDestroyed()) {
      if (!petHidden || chatOpenFlag) {
        float.show()
        keepOverlayAboveApps(float)
      }
      return
    }
    const workArea = wayland ? null : primaryWorkArea()
    unitLayout = layoutCompanionUnit({
      chatOpen: chatOpenFlag,
      petOrigin: wayland ? undefined : defaultCompanionPetOrigin(workArea),
      workArea,
    })
    float = new BrowserWindow({
      width: unitLayout.window.width,
      height: unitLayout.window.height,
      ...(wayland ? {} : { x: unitLayout.window.x, y: unitLayout.window.y }),
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
      movable: false,
      show: !petHidden || chatOpenFlag,
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
    keepOverlayAboveApps(float)
    float.loadURL(`${APP_ORIGIN}/index.html?surface=companion`)
    float.on('closed', () => {
      float = null
      unitLayout = null
      windows.delete('companion')
    })
    register('companion', float, path.join(__dirname, 'companion-preload.cjs'))
    emitOverlay()
  }

  function createChat() {
    chatOpenFlag = true
    createFloat()
    relayoutUnit()
  }

  function setEnabled(next) {
    return dispatch(next ? COMPANION_OVERLAY_ACTIONS.ENABLE : COMPANION_OVERLAY_ACTIONS.DISABLE)
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
    const seen = new Set()
    for (const entry of windows.values()) {
      if (!entry.window || entry.window.isDestroyed()) continue
      entry.window.webContents.send(`milksu:event:${event}`, value)
      seen.add(entry.window)
    }
    const main = typeof getMainWindow === 'function' ? getMainWindow() : null
    if (main && !main.isDestroyed() && !seen.has(main)) {
      main.webContents.send(`milksu:event:${event}`, value)
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
    if (method === 'ClickCompanionPet') return clickPet()
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
    clickPet,
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
