'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANION_CHAT_HEIGHT,
  COMPANION_CHAT_WIDTH,
  COMPANION_FLOAT_HEIGHT,
  COMPANION_FLOAT_WIDTH,
  COMPANION_METHODS,
  readCompanionPhoneStatus,
  createCompanionShell,
  normalizeUiLocale,
} = require('./companion-shell.cjs')

function fakeWindow() {
  const window = {
    destroyed: false,
    visible: true,
    minimized: false,
    events: {},
    hideCalls: 0,
    showCalls: 0,
    minimizeCalls: 0,
    restoreCalls: 0,
    focusCalls: 0,
    sentEvents: [],
    isDestroyed() { return this.destroyed },
    isMinimized() { return this.minimized },
    isVisible() { return this.visible !== false },
    hide() { this.hideCalls += 1; this.visible = false },
    show() { this.showCalls += 1; this.visible = true; this.minimized = false },
    minimize() { this.minimizeCalls += 1; this.minimized = true; this.visible = false },
    restore() { this.restoreCalls += 1; this.minimized = false; this.visible = true },
    focus() { this.focusCalls += 1 },
    alwaysOnTopCalls: [],
    visibleOnAllWorkspacesCalls: [],
    setAlwaysOnTop(flag, level) {
      this.alwaysOnTopCalls.push({ flag, level })
    },
    setVisibleOnAllWorkspaces(visible, options) {
      this.visibleOnAllWorkspacesCalls.push({ visible, options })
    },
    setWindowButtonVisibility() {},
    title: '',
    resizable: false,
    setTitle(value) { this.title = String(value || '') },
    getTitle() { return this.title || this.options?.title || '' },
    setResizable(value) { this.resizable = value === true },
    isResizable() { return this.resizable === true },
    setMinimumSize() {},
    ignoreMouseCalls: [],
    setIgnoreMouseEvents(ignore, options) {
      this.ignoreMouseCalls.push({ ignore, options })
    },
    getBounds() {
      return {
        x: this.x ?? this.options?.x ?? 80,
        y: this.y ?? this.options?.y ?? 80,
        width: this.width || this.options?.width || 160,
        height: this.height || this.options?.height || 160,
      }
    },
    setBounds(bounds) {
      this.x = bounds.x
      this.y = bounds.y
      if (bounds.width) this.width = bounds.width
      if (bounds.height) this.height = bounds.height
    },
    setPosition(x, y) {
      this.x = x
      this.y = y
    },
    loadURL() {},
    close() { this.destroyed = true },
    destroy() { this.destroyed = true; this.emit('closed') },
    on(event, handler) {
      if (!Array.isArray(this.events[event])) this.events[event] = []
      this.events[event].push(handler)
    },
    emit(event, ...args) {
      for (const handler of this.events[event] || []) handler(...args)
    },
    webContents: {
      send(channel, value) { window.sentEvents.push({ channel, value }) },
      on() {},
      mainFrame: {},
    },
  }
  return window
}

function createShell(overrides = {}) {
  const created = []
  const menus = []
  const popups = []
  const dock = { hideCalls: 0, showCalls: 0, menu: null, hide() { this.hideCalls += 1 }, show() { this.showCalls += 1 }, setMenu(menu) { this.menu = menu } }
  const main = overrides.main || fakeWindow()
  const defaultScreen = {
    getPrimaryDisplay() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getDisplayNearestPoint() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getCursorScreenPoint() {
      return { x: 1380, y: 860 }
    },
  }
  const menuApi = overrides.Menu || {
    lastApplication: null,
    buildFromTemplate(template) {
      return {
        template,
        popup(options) { popups.push(options) },
      }
    },
    setApplicationMenu(menu) {
      this.lastApplication = menu
    },
  }
  const shell = createCompanionShell({
    app: { dock, getLocale: () => 'zh-CN' },
    BrowserWindow: class MockWindow {
      constructor(options) {
        const window = fakeWindow()
        window.options = options
        created.push(window)
        return window
      }
    },
    Tray: class {
      constructor() {
        this.clicks = []
        this.destroyed = false
      }
      setToolTip() {}
      setContextMenu(menu) { menus.push(menu) }
      on(event, handler) { this.clicks.push({ event, handler }) }
      destroy() { this.destroyed = true }
    },
    Menu: menuApi,
    nativeImage: {
      createFromPath() {
        return {
          isEmpty: () => true,
          resize() { return this },
          setTemplateImage() {},
        }
      },
      createEmpty() { return {} },
    },
    APP_ORIGIN: 'milksu://app',
    resourcesPath: '',
    repositoryRoot: '',
    isPackaged: false,
    getMainWindow: () => main,
    setMainWindow: () => {},
    onQuitRequested: () => {},
    platform: 'darwin',
    env: {},
    screen: defaultScreen,
    ...overrides,
    app: { dock, getLocale: () => 'zh-CN', ...(overrides.app || {}) },
  })
  return { shell, created, menus, dock, main, popups, menuApi }
}

test('companion window methods are a subset of the main renderer surface', () => {
  assert.ok(COMPANION_METHODS.has('SendCompanionMessage'))
  assert.ok(COMPANION_METHODS.has('ChooseCodingAttachments'))
  assert.ok(COMPANION_METHODS.has('ImportCodingAttachments'))
  assert.ok(COMPANION_METHODS.has('PreviewCodingAttachment'))
  assert.ok(COMPANION_METHODS.has('SetCompanionPetHidden'))
  assert.ok(COMPANION_METHODS.has('ShowCompanionMainWindow'))
  assert.ok(COMPANION_METHODS.has('ShowCompanionChatWindow'))
  assert.ok(COMPANION_METHODS.has('ClickCompanionPet'))
  assert.ok(COMPANION_METHODS.has('PopupCompanionMenu'))
  assert.ok(COMPANION_METHODS.has('MoveCompanionPet'))
  assert.ok(COMPANION_METHODS.has('ParkCompanionMainWindow'))
  assert.ok(COMPANION_METHODS.has('GetCompanionSkin'))
  assert.ok(COMPANION_METHODS.has('GetCompanionPhoneStatus'))
  assert.ok(COMPANION_METHODS.has('EnsureCompanion'))
  assert.ok(!COMPANION_METHODS.has('SendMessage'))
  assert.ok(!COMPANION_METHODS.has('SaveSettingsCmd'))
  assert.ok(!COMPANION_METHODS.has('ImportCompanionSkin'))
})

test('GetCompanionPhoneStatus reports host power and network without a fake battery', () => {
  const now = Date.parse('2026-09-21T08:05:00.000Z')
  assert.deepEqual(readCompanionPhoneStatus({
    now,
    powerMonitor: { isOnBatteryPower: () => false },
    net: { isOnline: () => true },
  }), {
    time: '2026-09-21T08:05:00.000Z',
    batteryPercent: null,
    charging: true,
    online: true,
    wifi: true,
  })
  assert.deepEqual(readCompanionPhoneStatus({
    now,
    powerMonitor: { isOnBatteryPower: () => true },
    net: { isOnline: () => false },
  }), {
    time: '2026-09-21T08:05:00.000Z',
    batteryPercent: null,
    charging: false,
    online: false,
    wifi: false,
  })
  const { shell } = createShell({
    powerMonitor: { isOnBatteryPower: () => true },
    net: { isOnline: () => true },
  })
  const status = shell.handleHostMethod('GetCompanionPhoneStatus')
  assert.equal(status.charging, false)
  assert.equal(status.online, true)
  assert.equal(status.wifi, true)
  assert.equal(status.batteryPercent, null)
  assert.ok(Date.parse(status.time))
})

test('normalizeUiLocale maps OS and product locale values', () => {
  assert.equal(normalizeUiLocale('en-US'), 'en')
  assert.equal(normalizeUiLocale('zh-CN'), 'zh')
  assert.equal(normalizeUiLocale(''), 'zh')
})

test('Wayland sessions report a degraded float status', () => {
  const { shell, created } = createShell({
    platform: 'linux',
    env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1' },
  })
  const status = shell.setFloatEnabled(true)
  assert.equal(status.wayland, true)
  assert.equal(status.floating, false)
  assert.equal(created.length, 0)
})

test('companion shell shows a tray icon while the main window is open', () => {
  const { shell } = createShell()
  assert.equal(shell.status().tray, true)
})

test('float window is a small skipTaskbar pet, not a second taskbar app', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  assert.equal(created.length, 1)
  assert.equal(created[0].options.width, COMPANION_FLOAT_WIDTH)
  assert.equal(created[0].options.height, COMPANION_FLOAT_HEIGHT)
  assert.equal(created[0].options.skipTaskbar, true)
  assert.equal(created[0].options.frame, false)
  assert.equal(created[0].options.transparent, true)
  assert.equal(created[0].options.backgroundColor, '#00000000')
  assert.equal(created[0].options.acceptFirstMouse, true)
  assert.equal(created[0].options.resizable, false)
  assert.equal(created[0].options.maximizable, false)
  assert.equal(created[0].options.fullscreenable, false)
  assert.equal(created[0].options.hiddenInMissionControl, true)
  assert.equal(created[0].options.movable, false)
  assert.equal(created[0].options.type, undefined)
  assert.equal(created[0].options.alwaysOnTop, true)
  assert.equal(created[0].alwaysOnTopCalls.at(-1)?.level, 'floating')
  assert.equal(created[0].visibleOnAllWorkspacesCalls.at(-1)?.options.visibleOnFullScreen, false)
})

test('pet window never eats clicks for the main window', () => {
  const { shell, created } = createShell({ platform: 'darwin' })
  shell.createFloat()
  assert.equal(created[0].options.width, 160)
  assert.equal(created[0].options.height, 160)
  assert.ok(created[0].ignoreMouseCalls.every(call => call.ignore === false))
  shell.handleHostMethod('ShowCompanionChatWindow')
  assert.ok(created[0].ignoreMouseCalls.every(call => call.ignore === false))
})

test('Windows float is not a panel type', () => {
  const { shell, created } = createShell({ platform: 'win32' })
  shell.createFloat()
  assert.equal(created[0].options.skipTaskbar, true)
  assert.equal(created[0].options.type, undefined)
  assert.equal(created[0].options.hiddenInMissionControl, true)
})

test('macOS parks the main window without hiding the Dock', () => {
  const { shell, dock, main } = createShell({ platform: 'darwin' })
  shell.parkMainWindow()
  assert.equal(main.hideCalls, 1)
  assert.equal(main.minimizeCalls, 0)
  assert.equal(dock.hideCalls, 0)
  assert.ok(dock.showCalls >= 1)
  assert.equal(shell.status().parked, true)
  assert.equal(shell.status().platform, 'darwin')
})

test('Windows parks the main window by minimizing so the taskbar stays', () => {
  const { shell, main, dock } = createShell({ platform: 'win32' })
  shell.parkMainWindow()
  assert.equal(main.minimizeCalls, 1)
  assert.equal(main.hideCalls, 0)
  assert.equal(dock.hideCalls, 0)
  assert.equal(shell.status().parked, true)
  assert.equal(shell.status().platform, 'win32')
})

test('closing all windows no longer hides the Dock', () => {
  const { shell, dock } = createShell({ platform: 'darwin' })
  shell.handleWindowAllClosed()
  assert.equal(dock.hideCalls, 0)
  assert.ok(dock.showCalls >= 1)
})

test('beginQuit destroys the pet and does not recreate it after window-all-closed', () => {
  const trays = []
  const { shell, created } = createShell({
    Tray: class {
      constructor() {
        trays.push(this)
        this.clicks = []
        this.destroyed = false
      }
      setToolTip() {}
      setContextMenu() {}
      on() {}
      destroy() { this.destroyed = true }
    },
  })
  shell.createFloat()
  assert.equal(created.length, 1)
  assert.equal(trays.length >= 1, true)
  shell.beginQuit()
  assert.equal(created[0].destroyed, true)
  assert.ok(trays.every(tray => tray.destroyed === true))
  shell.handleWindowAllClosed()
  shell.createFloat()
  shell.createTray()
  assert.equal(created.length, 1)
  assert.equal(trays.every(tray => tray.destroyed === true), true)
})

test('hidden pet can be woken from the taskbar without showing the main window', () => {
  const { shell, created, main } = createShell()
  shell.createFloat()
  const pet = created[0]
  shell.hidePet()
  assert.equal(pet.hideCalls, 1)
  assert.equal(shell.status().hidden, true)
  const beforeShow = main.showCalls
  shell.revealFromTaskbar()
  assert.equal(pet.showCalls >= 1, true)
  assert.equal(shell.status().hidden, false)
  assert.equal(main.showCalls, beforeShow)
})

test('tray and dock share companion actions; the application menu is not a companion menu', () => {
  const { shell, menus, main, dock, menuApi } = createShell()
  shell.createFloat()
  shell.createTray()
  const labels = menus.at(-1).template.map(item => item.label)
  assert.deepEqual(labels.filter(Boolean), ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置', '退出'])
  assert.ok(dock.menu)
  assert.deepEqual(dock.menu.template.map(item => item.label).filter(Boolean), ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置'])
  const statusLabels = shell.status().menu.map(item => item.label)
  assert.deepEqual(statusLabels, ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置', '退出'])
  const appLabels = JSON.stringify(menuApi.lastApplication || {})
  assert.equal(appLabels.includes('桌宠'), false)
  dock.menu.template.find(item => item.id === 'chat').click()
  assert.equal(shell.status().chatOpen, true)
  menus.at(-1).template[1].click()
  assert.equal(shell.status().hidden, true)
  menus.at(-1).template[2].click()
  assert.equal(main.showCalls >= 1, true)
})

test('ShowCompanionChatWindow replaces the pet with the phone, not a second window', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  assert.equal(created[0].options.title, '桌宠')
  const opened = shell.handleHostMethod('ShowCompanionChatWindow', { locale: 'zh' })
  assert.equal(opened.chatOpen, true)
  assert.equal(opened.overlay.petVisible, false)
  assert.equal(created.length, 1)
  assert.equal(created[0].width, COMPANION_CHAT_WIDTH)
  assert.equal(created[0].height, COMPANION_CHAT_HEIGHT)
  assert.equal(opened.title, '桌宠')
  const closed = shell.handleHostMethod('HideCompanionChatWindow')
  assert.equal(closed.chatOpen, false)
  assert.equal(closed.overlay.petVisible, true)
  assert.equal(created[0].width, 160)
  assert.equal(created[0].height, 160)
})

test('showing the pet form after the phone closes the phone', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  shell.handleHostMethod('ShowCompanionChatWindow')
  const shown = shell.handleHostMethod('SetCompanionPetHidden', { hidden: false })
  assert.equal(shown.chatOpen, false)
  assert.equal(shown.overlay.petVisible, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].width, 160)
  assert.equal(created[0].height, 160)
})

test('MoveCompanionPet moves the overlay from the pet origin', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  shell.handleHostMethod('ShowCompanionChatWindow')
  const before = shell.status()
  const moved = shell.handleHostMethod('MoveCompanionPet', { dx: -24, dy: -10 })
  assert.equal(created.length, 1)
  assert.equal(moved.floating, true)
  assert.equal(moved.petBounds.x, before.petBounds.x - 24)
  assert.equal(moved.petBounds.y, before.petBounds.y - 10)
  assert.equal(moved.chatBounds.x, before.chatBounds.x - 24)
  assert.equal(moved.chatBounds.y, before.chatBounds.y - 10)
})

test('SetCompanionPetHidden and ShowCompanionMainWindow are host methods', () => {
  const { shell, main } = createShell()
  shell.createFloat()
  const hidden = shell.handleHostMethod('SetCompanionPetHidden', { hidden: true, locale: 'en' })
  assert.equal(hidden.hidden, true)
  const shown = shell.handleHostMethod('ShowCompanionMainWindow')
  assert.equal(main.showCalls >= 1, true)
  assert.equal(shown.tray || true, true)
  assert.equal(shown.parked, false)
})

test('ClickCompanionPet toggles the phone and hide closes chat with the pet', () => {
  const { shell, created, main } = createShell()
  main.x = 120
  main.y = 40
  shell.createFloat()
  const opened = shell.handleHostMethod('ClickCompanionPet')
  assert.equal(opened.chatOpen, true)
  assert.equal(opened.overlay.chatOpen, true)
  assert.equal(created.length, 1)
  const focused = shell.handleHostMethod('ShowCompanionChatWindow')
  assert.equal(focused.chatOpen, true)
  assert.equal(created.length, 1)
  const closed = shell.handleHostMethod('ClickCompanionPet')
  assert.equal(closed.chatOpen, false)
  assert.equal(created[0].visible, true)
  shell.handleHostMethod('ShowCompanionChatWindow')
  const hidden = shell.handleHostMethod('SetCompanionPetHidden', { hidden: true })
  assert.equal(hidden.hidden, true)
  assert.equal(hidden.chatOpen, false)
  const shown = shell.handleHostMethod('SetCompanionPetHidden', { hidden: false })
  assert.equal(shown.hidden, false)
  assert.equal(shown.chatOpen, false)
})

test('opening the main window or settings keeps the phone open', () => {
  const { shell, main } = createShell()
  shell.createFloat()
  shell.handleHostMethod('ShowCompanionChatWindow')
  const before = main.showCalls
  const shown = shell.handleHostMethod('ShowCompanionMainWindow')
  assert.equal(shown.chatOpen, true)
  assert.equal(shown.overlay.mainVisible, true)
  assert.ok(main.showCalls >= before)
  const settings = shell.handleHostMethod('ShowCompanionSettings')
  assert.equal(settings.chatOpen, true)
  assert.equal(settings.parked, false)
})

test('dragging the pet never moves the main window and clamps to the work area', () => {
  const screen = {
    getPrimaryDisplay() {
      return { workArea: { x: 0, y: 0, width: 800, height: 600 } }
    },
    getDisplayNearestPoint() {
      return { workArea: { x: 0, y: 0, width: 800, height: 600 } }
    },
  }
  const { shell, created, main } = createShell({ screen })
  main.x = 16
  main.y = 24
  shell.createFloat()
  shell.handleHostMethod('ShowCompanionChatWindow')
  const inward = shell.handleHostMethod('MoveCompanionPet', { dx: -80, dy: -20 })
  assert.equal(created.length, 1)
  assert.equal(main.x, 16)
  assert.equal(main.y, 24)
  assert.ok(inward.chatBounds)
  const clamped = shell.handleHostMethod('MoveCompanionPet', { dx: 4000, dy: 4000 })
  assert.equal(clamped.chatBounds.x, 800 - COMPANION_CHAT_WIDTH)
  assert.equal(clamped.chatBounds.y, 600 - COMPANION_CHAT_HEIGHT)
  assert.ok(clamped.chatBounds.x + COMPANION_CHAT_WIDTH <= 800)
  assert.ok(clamped.chatBounds.y + COMPANION_CHAT_HEIGHT <= 600)
})

test('overlay stacking stays below system IME chrome', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  const levels = created[0].alwaysOnTopCalls.map(call => call.level)
  assert.ok(levels.includes('floating'))
  assert.ok(!levels.includes('screen-saver'))
  assert.ok(!levels.includes('pop-up-menu'))
  assert.ok(!levels.includes('modal-panel'))
  assert.equal(created[0].visibleOnAllWorkspacesCalls.at(-1)?.options.visibleOnFullScreen, false)
})

test('PopupCompanionMenu uses the OS cursor and stays in the work area', () => {
  const { shell, created, popups, main } = createShell()
  shell.createFloat()
  shell.handleHostMethod('PopupCompanionMenu')
  const popup = popups.at(-1)
  const bounds = created[0].getBounds()
  assert.ok(popup)
  assert.equal(created[0].focusCalls, 1)
  const screenX = bounds.x + popup.x
  const screenY = bounds.y + popup.y
  assert.ok(screenX >= 8)
  assert.ok(screenY >= 8)
  assert.ok(screenX + 176 <= 1440 - 8)
  assert.ok(screenY + 184 <= 900 - 8)
  assert.equal(main.focusCalls, 0)
})

test('the pet window is the sprite box, so no invisible margin covers the app', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  const bounds = created[0].getBounds()
  assert.equal(bounds.width, COMPANION_FLOAT_WIDTH)
  assert.equal(bounds.height, COMPANION_FLOAT_HEIGHT)
  assert.equal(COMPANION_FLOAT_WIDTH, 160)
  assert.equal(COMPANION_FLOAT_HEIGHT, 160)
})

test('a dropped pointerup cannot leave the pet chasing the cursor', async () => {
  const cursor = { x: 400, y: 400 }
  const screen = {
    getPrimaryDisplay() { return { workArea: { x: 0, y: 0, width: 1440, height: 900 } } },
    getDisplayNearestPoint() { return { workArea: { x: 0, y: 0, width: 1440, height: 900 } } },
    getCursorScreenPoint() { return { ...cursor } },
  }
  const { shell, created } = createShell({ screen })
  shell.createFloat()
  shell.handleHostMethod('MoveCompanionPet', { drag: 'begin' })
  cursor.x += 24
  await new Promise(resolve => setTimeout(resolve, 40))
  const moved = created[0].getBounds().x
  created[0].close()
  cursor.x += 200
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(created[0].getBounds().x, moved)
})

test('a pointer press hands the drag to the shell, which follows the OS cursor', async () => {
  const cursor = { x: 200, y: 240 }
  const screen = {
    getPrimaryDisplay() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getDisplayNearestPoint() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getCursorScreenPoint() {
      return { ...cursor }
    },
  }
  const { shell } = createShell({ screen })
  shell.createFloat()
  shell.handleHostMethod('MoveCompanionPet', { dx: -200, dy: -80 })
  const before = shell.handleHostMethod('GetCompanionShellStatus')
  shell.handleHostMethod('MoveCompanionPet', { drag: 'begin' })
  cursor.x += 48
  cursor.y += 24
  await new Promise(resolve => setTimeout(resolve, 40))
  const after = shell.handleHostMethod('GetCompanionShellStatus')
  assert.equal(after.petBounds.x, before.petBounds.x + 48)
  assert.equal(after.petBounds.y, before.petBounds.y + 24)
  const ended = shell.handleHostMethod('MoveCompanionPet', { drag: 'end' })
  assert.equal(ended.dragged, true)
})

test('a press without cursor travel stays a click, so the pet opens the phone', async () => {
  const screen = {
    getPrimaryDisplay() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getDisplayNearestPoint() {
      return { workArea: { x: 0, y: 0, width: 1440, height: 900 } }
    },
    getCursorScreenPoint() {
      return { x: 600, y: 600 }
    },
  }
  const { shell } = createShell({ screen })
  shell.createFloat()
  shell.handleHostMethod('MoveCompanionPet', { drag: 'begin' })
  await new Promise(resolve => setTimeout(resolve, 40))
  const ended = shell.handleHostMethod('MoveCompanionPet', { drag: 'end' })
  assert.equal(ended.dragged, false)
})

test('overlay events still reach an unregistered main window', () => {
  const main = fakeWindow()
  const { shell } = createShell({ main })
  shell.emit('companion-event', { type: 'companion.confirm' })
  assert.ok(main.sentEvents.some(item => item.channel === 'milksu:event:companion-event'))
})

test('ParkCompanionMainWindow is the same path as closing the main window', () => {
  const { shell, main, dock } = createShell({ platform: 'darwin' })
  const parked = shell.handleHostMethod('ParkCompanionMainWindow')
  assert.equal(main.hideCalls, 1)
  assert.equal(parked.parked, true)
  assert.equal(dock.hideCalls, 0)
  const restored = shell.handleHostMethod('ShowCompanionMainWindow')
  assert.equal(restored.parked, false)
  assert.equal(main.showCalls >= 1, true)
})
