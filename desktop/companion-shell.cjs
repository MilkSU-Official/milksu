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
  'ChooseCodingAttachments',
  'ImportCodingAttachments',
  'PreviewCodingAttachment',
  'GetCompanionBoard',
  'ListCompanionTranscript',
  'ArchiveCompanionTranscript',
  'ListCompanionArchives',
  'DeleteCompanionArchive',
  'GetCompanionMemory',
  'ApproveCompanionMemory',
  'ForgetCompanionMemory',
  'ConfirmCompanionDispatch',
  'GetCompanionPhoneStatus',
  'GetCompanionShellStatus',
  'SetCompanionFloatEnabled',
  'SetCompanionPetHidden',
  'ShowCompanionMainWindow',
  'ShowCompanionChatWindow',
  'HideCompanionChatWindow',
  'ClickCompanionPet',
  'ShowCompanionSettings',
  'PopupCompanionMenu',
  'SetCompanionPointerPassthrough',
  'MoveCompanionPet',
  'ParkCompanionMainWindow',
  'QuitCompanionShell',
  'GetSettings',
  'SaveSettingsCmd',
  'GetModelCatalog',
  'EnsureCompanion',
  'ListCompanionSkins',
  'GetCompanionSkin',
  'ImportCompanionSkin',
  'RemoveCompanionSkin',
  'NotifyCompanionSkinChanged',
])

const PET_DRAG_FRAME_MS = 16
const PET_DRAG_MAX_MS = 30_000
const COMPANION_FLOAT_WIDTH = COMPANION_PET_WIDTH
const COMPANION_FLOAT_HEIGHT = COMPANION_PET_HEIGHT

function isWaylandSession(env = process.env, platform = process.platform) {
  return platform === 'linux' && (
    String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
    || Boolean(env.WAYLAND_DISPLAY)
  )
}

function readCompanionPhoneStatus(input = {}) {
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now()
  let charging = null
  if (input.powerMonitor && typeof input.powerMonitor.isOnBatteryPower === 'function') {
    try {
      charging = !input.powerMonitor.isOnBatteryPower()
    } catch {
      charging = null
    }
  }
  let online = true
  if (input.net && typeof input.net.isOnline === 'function') {
    try {
      online = input.net.isOnline() !== false
    } catch {
      online = true
    }
  }
  const percent = Number(input.batteryPercent)
  return {
    time: new Date(now).toISOString(),
    batteryPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.round(percent))) : null,
    charging,
    online,
    wifi: online,
  }
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
    powerMonitor,
    net,
  } = options
  const platform = options.platform || process.platform
  const wayland = isWaylandSession(options.env, platform)
  const windows = new Map()
  let float = null
  let chatOpenFlag = false
  let unitLayout = null
  let tray = null
  let shuttingDown = false
  let enabled = !wayland
  let petHidden = false
  let lastMenuPopup = null
  let petDrag = null
  let petDragTimer = null
  let lastPetDragged = false
  let pointerPassthrough = false
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
    lockCompanionTitle(float)
  }

  function companionWindowTitle() {
    return t('桌宠', 'Companion')
  }

  function lockCompanionTitle(window) {
    if (!window || window.isDestroyed()) return
    const title = companionWindowTitle()
    if (typeof window.setTitle === 'function') window.setTitle(title)
  }

  function applyOverlayBounds(window, bounds) {
    if (!window || window.isDestroyed() || !bounds) return
    if (typeof window.setMinimumSize === 'function') window.setMinimumSize(1, 1)
    const wasResizable = typeof window.isResizable === 'function' ? window.isResizable() : false
    if (typeof window.setResizable === 'function') window.setResizable(true)
    if (typeof window.setBounds === 'function') {
      window.setBounds({
        x: Math.round(Number(bounds.x) || 0),
        y: Math.round(Number(bounds.y) || 0),
        width: Math.max(1, Math.round(Number(bounds.width) || 0)),
        height: Math.max(1, Math.round(Number(bounds.height) || 0)),
      })
    }
    if (typeof window.setResizable === 'function') window.setResizable(wasResizable)
  }

  function bindOverlayWindowEvents(window) {
    if (!window || typeof window.on !== 'function') return
    window.on('page-title-updated', event => {
      event.preventDefault()
      lockCompanionTitle(window)
    })
    window.on('closed', () => {
      stopPetDragTimer()
      petDrag = null
      float = null
      unitLayout = null
      windows.delete('companion')
    })
  }

  function applyPointerPassthrough() {
    if (!float || float.isDestroyed() || typeof float.setIgnoreMouseEvents !== 'function') return
    float.setIgnoreMouseEvents(false)
  }

  function setPointerPassthrough() {
    pointerPassthrough = false
    applyPointerPassthrough()
    return status()
  }

  function stopPetDragTimer() {
    if (petDragTimer) {
      clearInterval(petDragTimer)
      petDragTimer = null
    }
  }

  function followPetDragCursor() {
    if (!petDrag || !float || float.isDestroyed()) {
      stopPetDragTimer()
      return
    }
    // A pointerup can be lost (window closed, session switch). Never let the
    // overlay keep chasing the cursor once a drag has outlived a real gesture.
    if (Date.now() - petDrag.startedAt > PET_DRAG_MAX_MS) {
      stopPetDragTimer()
      petDrag = null
      return
    }
    const cursor = cursorScreenPoint()
    if (!cursor || !petDrag.cursor) return
    const dx = cursor.x - petDrag.cursor.x
    const dy = cursor.y - petDrag.cursor.y
    if (!dx && !dy) return
    if ((dx * dx) + (dy * dy) >= 16) petDrag.moved = true
    applyUnitLayout(moveCompanionUnit({
      petScreen: petDrag.pet,
      dx,
      dy,
      chatOpen: chatOpenFlag,
      workArea: wayland ? null : (workAreaNear(petDrag.pet) || primaryWorkArea()),
    }))
  }

  function keepAppPresence() {
    if (platform === 'darwin' && app.dock) app.dock.show()
  }

  function iconPath() {
    const packaged = resourcesPath ? path.join(resourcesPath, 'appicon.png') : ''
    const repo = repositoryRoot ? path.join(repositoryRoot, 'build', 'appicon.png') : ''
    if (isPackaged && packaged) return packaged
    return repo || packaged
  }

  function trayIconImage() {
    if (!nativeImage) return null
    let image = null
    try {
      image = nativeImage.createFromPath(iconPath())
    } catch {
      image = null
    }
    if ((!image || (typeof image.isEmpty === 'function' && image.isEmpty()))
      && platform === 'darwin'
      && app.dock
      && typeof app.dock.getIcon === 'function') {
      try {
        image = app.dock.getIcon()
      } catch {
        image = null
      }
    }
    if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
      return typeof nativeImage.createEmpty === 'function' ? nativeImage.createEmpty() : image
    }
    const sized = typeof image.resize === 'function' ? image.resize({ width: 18, height: 18 }) : image
    return sized || image
  }

  function mainParked() {
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return true
    if (typeof main.isMinimized === 'function' && main.isMinimized()) return true
    if (typeof main.isVisible === 'function' && !main.isVisible()) return true
    return false
  }

  function overlayVisible() {
    if (wayland) return Boolean(float) && chatOpenFlag
    return Boolean(float) && !petHidden && enabled
  }

  function petVisible() {
    return overlayVisible() && !chatOpenFlag && !wayland
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

  function cursorScreenPoint() {
    if (!screen || typeof screen.getCursorScreenPoint !== 'function') return null
    try {
      const point = screen.getCursorScreenPoint()
      const x = Number(point && point.x)
      const y = Number(point && point.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return { x, y }
    } catch {
      return null
    }
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
    applyOverlayBounds(float, layout.window)
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
    stopPetDragTimer()
    petDrag = null
    if (float && !float.isDestroyed()) float.close()
    float = null
    chatOpenFlag = false
    unitLayout = null
  }

  function applyDecision(decision, options = {}) {
    // Product-loop / automation may pass focus:false so windows become visible
    // for CDP / screenshots without stealing the user's OS mouse and keyboard.
    const allowFocus = options.focus !== false
    enabled = decision.state.enabled
    petHidden = decision.state.petHidden
    chatOpenFlag = decision.state.chatOpen
    if (decision.effects.destroyOverlay) {
      destroyOverlayWindows()
      refreshMenus()
      return
    }
    if (decision.effects.pet === 'hide') hidePetWindow()
    else if (decision.effects.pet === 'show' || (decision.overlayVisible && (!float || float.isDestroyed()))) {
      if (wayland) createFloat()
      else showPetWindow()
    }
    if (float && !float.isDestroyed() && decision.effects.pet !== 'hide') {
      relayoutUnit()
      applyPointerPassthrough()
      if (decision.effects.chat === 'show' || decision.effects.chat === 'focus' || decision.phoneVisible) {
        float.show()
        if (allowFocus && (decision.effects.chat === 'show' || decision.effects.chat === 'focus')) {
          float.focus()
        }
      }
    }
    if (decision.effects.main === 'show') showMainWindowImpl({ focus: allowFocus })
    else if (decision.effects.main === 'park') parkMainWindowImpl()
    if (decision.effects.navigateSettings) {
      emit('companion.navigate', { section: 'settings', category: 'companion' })
    }
    refreshMenus()
  }

  function dispatch(action, options = {}) {
    applyDecision(reduceCompanionOverlay(snapshot(), action), options)
    return status()
  }

  function actionMenu(extra = {}) {
    return companionActionMenuTemplate({
      t,
      petVisible: overlayVisible(),
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
      title: companionWindowTitle(),
      menu: menuSnapshot(),
      menuPopup: lastMenuPopup,
      dragged: lastPetDragged,
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
    Menu.setApplicationMenu(Menu.buildFromTemplate(productApplicationMenuTemplate(platform)))
  }

  function refreshMenus() {
    refreshTrayMenu()
    refreshDockMenu()
    refreshAppMenu()
  }

  function createTray() {
    if (shuttingDown) return
    keepAppPresence()
    if (tray) {
      refreshMenus()
      return
    }
    if (!Tray) return
    const image = trayIconImage()
    tray = new Tray(image)
    if (typeof tray.setToolTip === 'function') tray.setToolTip('MilkSU')
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

  function showMainWindowImpl(options = {}) {
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
    if (options.focus === false) {
      // showInactive keeps the user's foreground app; falls back to show()
      // without focus() when the platform lacks it (some Linux builds).
      if (typeof main.showInactive === 'function') main.showInactive()
      else main.show()
      return
    }
    main.show()
    main.focus()
  }

  function showMainWindow(payload = {}) {
    return dispatch(COMPANION_OVERLAY_ACTIONS.SHOW_MAIN, { focus: payload.focus !== false })
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
    const drag = String(payload.drag || '').trim()
    if (drag === 'begin') {
      lastPetDragged = false
      petDrag = {
        cursor: cursorScreenPoint(),
        pet: { ...currentPetScreen() },
        moved: false,
        startedAt: Date.now(),
      }
      stopPetDragTimer()
      petDragTimer = setInterval(followPetDragCursor, PET_DRAG_FRAME_MS)
      return status()
    }
    if (drag === 'end') {
      followPetDragCursor()
      lastPetDragged = Boolean(petDrag && petDrag.moved)
      stopPetDragTimer()
      petDrag = null
      return { ...status(), dragged: lastPetDragged }
    }
    if (drag === 'update') return status()
    const dx = Number(payload.dx)
    const dy = Number(payload.dy)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
      return status()
    }
    stopPetDragTimer()
    petDrag = null
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

  function showChatWindow(payload = {}) {
    return dispatch(COMPANION_OVERLAY_ACTIONS.OPEN_CHAT, { focus: payload.focus !== false })
  }

  function clickPet() {
    return dispatch(COMPANION_OVERLAY_ACTIONS.CLICK_PET)
  }

  function popupCompanionMenu(payload = {}) {
    if (!Menu || typeof Menu.buildFromTemplate !== 'function') return status()
    const menu = Menu.buildFromTemplate(actionMenu({ includeQuit: true }))
    const target = (float && !float.isDestroyed() && overlayVisible()) ? float : getMainWindow()
    if (!menu || typeof menu.popup !== 'function' || !target || target.isDestroyed()) return status()
    if (typeof target.focus === 'function') target.focus()
    const bounds = windowBounds(target) || { x: 0, y: 0, width: 0, height: 0 }
    let screenPoint = cursorScreenPoint()
    if (!screenPoint && Number.isFinite(Number(payload.screenX)) && Number.isFinite(Number(payload.screenY))) {
      screenPoint = { x: Number(payload.screenX), y: Number(payload.screenY) }
    }
    if (!screenPoint && Number.isFinite(Number(payload.x)) && Number.isFinite(Number(payload.y))) {
      screenPoint = {
        x: Number(bounds.x) + Number(payload.x),
        y: Number(bounds.y) + Number(payload.y),
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
    lastMenuPopup = { x: clamped.x, y: clamped.y }
    menu.popup({
      window: target,
      x: Math.round(clamped.x - Number(bounds.x || 0)),
      y: Math.round(clamped.y - Number(bounds.y || 0)),
    })
    return status()
  }

  function revealFromTaskbar() {
    keepAppPresence()
    createTray()
    return dispatch(COMPANION_OVERLAY_ACTIONS.REVEAL_FROM_TASKBAR)
  }

  function beginQuit() {
    shuttingDown = true
    stopPetDragTimer()
    petDrag = null
    if (float && !float.isDestroyed()) {
      try {
        float.destroy()
      } catch {}
    }
    float = null
    unitLayout = null
    windows.delete('companion')
    if (tray && typeof tray.destroy === 'function') {
      try {
        tray.destroy()
      } catch {}
    }
    tray = null
  }

  function createFloat() {
    if (shuttingDown) return
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
      title: companionWindowTitle(),
      width: unitLayout.window.width,
      height: unitLayout.window.height,
      ...(wayland ? {} : { x: unitLayout.window.x, y: unitLayout.window.y }),
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      acceptFirstMouse: true,
      focusable: true,
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
    if (typeof float.setBackgroundColor === 'function') {
      float.setBackgroundColor('#00000000')
    }
    if (platform === 'darwin' && typeof float.setVibrancy === 'function') {
      try {
        float.setVibrancy(null)
      } catch {
        // Panel pets must stay clear; some hosts reject a null vibrancy clear.
      }
    }
    lockCompanionTitle(float)
    bindOverlayWindowEvents(float)
    keepOverlayAboveApps(float)
    applyPointerPassthrough()
    float.loadURL(`${APP_ORIGIN}/index.html?surface=companion`)
    register('companion', float, path.join(__dirname, 'companion-preload.cjs'))
    createTray()
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
    if (method === 'GetCompanionPhoneStatus') {
      return readCompanionPhoneStatus({ powerMonitor, net })
    }
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
    if (method === 'ShowCompanionMainWindow') return showMainWindow(payload)
    if (method === 'ShowCompanionChatWindow') return showChatWindow(payload)
    if (method === 'HideCompanionChatWindow') return hideChatWindow()
    if (method === 'ClickCompanionPet') return clickPet()
    if (method === 'ShowCompanionSettings') return showCompanionSettings()
    if (method === 'PopupCompanionMenu') return popupCompanionMenu(payload)
    if (method === 'SetCompanionPointerPassthrough') {
      return setPointerPassthrough(payload.ignore !== false)
    }
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
    if (shuttingDown) return
    keepAppPresence()
    if (enabled && !wayland) {
      createTray()
      createFloat()
      return
    }
    onQuitRequested()
  }

  createTray()

  return {
    register,
    senderAllowed,
    emit,
    handleHostMethod,
    createTray,
    createFloat,
    createChat,
    handleWindowAllClosed,
    beginQuit,
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
  readCompanionPhoneStatus,
  COMPANION_FLOAT_WIDTH,
  COMPANION_FLOAT_HEIGHT,
  COMPANION_CHAT_WIDTH,
  COMPANION_CHAT_HEIGHT,
  companionActionMenuTemplate,
  createCompanionShell,
  isWaylandSession,
  normalizeUiLocale,
}
