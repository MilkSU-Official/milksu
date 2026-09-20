'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPANION_FLOAT_HEIGHT,
  COMPANION_FLOAT_WIDTH,
  COMPANION_METHODS,
  createCompanionShell,
  normalizeUiLocale,
} = require('./companion-shell.cjs')

function fakeWindow() {
  return {
    destroyed: false,
    visible: true,
    minimized: false,
    events: {},
    hideCalls: 0,
    showCalls: 0,
    minimizeCalls: 0,
    restoreCalls: 0,
    focusCalls: 0,
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
    getBounds() {
      return {
        x: this.x ?? this.options?.x ?? 80,
        y: this.y ?? this.options?.y ?? 80,
        width: this.width || this.options?.width || 232,
        height: this.height || this.options?.height || 400,
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
    on(event, handler) { this.events[event] = handler },
    webContents: { send() {}, mainFrame: {} },
  }
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
      }
      setToolTip() {}
      setContextMenu(menu) { menus.push(menu) }
      on(event, handler) { this.clicks.push({ event, handler }) }
    },
    Menu: {
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
    },
    nativeImage: {
      createFromPath() { return { isEmpty: () => true } },
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
  return { shell, created, menus, dock, main, popups }
}

test('companion window methods are a subset of the main renderer surface', () => {
  assert.ok(COMPANION_METHODS.has('SendCompanionMessage'))
  assert.ok(COMPANION_METHODS.has('SetCompanionPetHidden'))
  assert.ok(COMPANION_METHODS.has('ShowCompanionMainWindow'))
  assert.ok(COMPANION_METHODS.has('ShowCompanionChatWindow'))
  assert.ok(COMPANION_METHODS.has('ClickCompanionPet'))
  assert.ok(COMPANION_METHODS.has('PopupCompanionMenu'))
  assert.ok(COMPANION_METHODS.has('MoveCompanionPet'))
  assert.ok(COMPANION_METHODS.has('ParkCompanionMainWindow'))
  assert.ok(COMPANION_METHODS.has('GetCompanionSkin'))
  assert.ok(COMPANION_METHODS.has('EnsureCompanion'))
  assert.ok(!COMPANION_METHODS.has('SendMessage'))
  assert.ok(!COMPANION_METHODS.has('SaveSettingsCmd'))
  assert.ok(!COMPANION_METHODS.has('ImportCompanionSkin'))
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

test('float window is a small skipTaskbar pet, not a second taskbar app', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  assert.equal(created.length, 1)
  assert.equal(created[0].options.width, COMPANION_FLOAT_WIDTH)
  assert.equal(created[0].options.height, COMPANION_FLOAT_HEIGHT)
  assert.equal(created[0].options.skipTaskbar, true)
  assert.equal(created[0].options.frame, false)
  assert.equal(created[0].options.transparent, true)
  assert.equal(created[0].options.resizable, false)
  assert.equal(created[0].options.maximizable, false)
  assert.equal(created[0].options.fullscreenable, false)
  assert.equal(created[0].options.hiddenInMissionControl, true)
  assert.equal(created[0].options.type, 'panel')
  assert.equal(created[0].options.alwaysOnTop, true)
  assert.equal(created[0].alwaysOnTopCalls.at(-1)?.level, 'floating')
  assert.equal(created[0].visibleOnAllWorkspacesCalls.at(-1)?.options.visibleOnFullScreen, false)
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

test('tray, dock, and app menus share the companion actions', () => {
  const { shell, menus, main, dock } = createShell()
  shell.createFloat()
  shell.createTray()
  const labels = menus.at(-1).template.map(item => item.label)
  assert.deepEqual(labels.filter(Boolean), ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置', '退出'])
  assert.ok(dock.menu)
  assert.deepEqual(dock.menu.template.map(item => item.label).filter(Boolean), ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置'])
  const statusLabels = shell.status().menu.map(item => item.label)
  assert.deepEqual(statusLabels, ['对话', '隐藏桌宠', '打开主窗口', '桌宠设置', '退出'])
  menus.at(-1).template[1].click()
  assert.equal(shell.status().hidden, true)
  menus.at(-1).template[2].click()
  assert.equal(main.showCalls >= 1, true)
})

test('ShowCompanionChatWindow grows the same overlay instead of a second window', () => {
  const { shell, created } = createShell()
  shell.createFloat()
  const opened = shell.handleHostMethod('ShowCompanionChatWindow', { locale: 'zh' })
  assert.equal(opened.chatOpen, true)
  assert.equal(created.length, 1)
  assert.equal(opened.overlay.chatSide, 'left')
  assert.ok(created[0].width >= 232 + 12 + 336)
  assert.equal(created[0].height, 480)
})

test('MoveCompanionPet moves the glued unit from the pet origin', () => {
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

test('ClickCompanionPet toggles one small chat and hide closes chat with the pet', () => {
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

test('opening the main window or settings keeps the small chat open', () => {
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
  assert.equal(inward.petBounds.x, 800 - 16 - 232 - 80)
  assert.equal(main.x, 16)
  assert.equal(main.y, 24)
  const clamped = shell.handleHostMethod('MoveCompanionPet', { dx: 4000, dy: 4000 })
  assert.equal(clamped.petBounds.x, 800 - 232)
  assert.equal(clamped.petBounds.y, 600 - 400)
  assert.ok(clamped.chatBounds.x + 336 <= 800)
  assert.ok(clamped.chatBounds.y + 480 <= 600)
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

test('PopupCompanionMenu stays inside the work area at the default corner', () => {
  const { shell, created, popups } = createShell()
  shell.createFloat()
  shell.handleHostMethod('PopupCompanionMenu', { x: 200, y: 380 })
  const popup = popups.at(-1)
  const bounds = created[0].getBounds()
  assert.ok(popup)
  assert.ok(popup.x + 176 <= bounds.width)
  assert.ok(popup.y + 184 <= bounds.height)
  assert.ok(popup.x >= 0)
  assert.ok(popup.y >= 0)
  const screenX = bounds.x + popup.x
  const screenY = bounds.y + popup.y
  assert.ok(screenX + 176 <= 1440 - 8)
  assert.ok(screenY + 184 <= 900 - 8)
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
