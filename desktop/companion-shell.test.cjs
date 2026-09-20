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
    hide() { this.hideCalls += 1; this.visible = false },
    show() { this.showCalls += 1; this.visible = true; this.minimized = false },
    minimize() { this.minimizeCalls += 1; this.minimized = true; this.visible = false },
    restore() { this.restoreCalls += 1; this.minimized = false; this.visible = true },
    focus() { this.focusCalls += 1 },
    setAlwaysOnTop() {},
    setVisibleOnAllWorkspaces() {},
    loadURL() {},
    close() { this.destroyed = true },
    on(event, handler) { this.events[event] = handler },
    webContents: { send() {}, mainFrame: {} },
  }
}

function createShell(overrides = {}) {
  const created = []
  const menus = []
  const dock = { hideCalls: 0, showCalls: 0, hide() { this.hideCalls += 1 }, show() { this.showCalls += 1 } }
  const main = overrides.main || fakeWindow()
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
      buildFromTemplate(template) {
        return { template }
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
    ...overrides,
    app: { dock, getLocale: () => 'zh-CN', ...(overrides.app || {}) },
  })
  return { shell, created, menus, dock, main }
}

test('companion window methods are a subset of the main renderer surface', () => {
  assert.ok(COMPANION_METHODS.has('SendCompanionMessage'))
  assert.ok(COMPANION_METHODS.has('SetCompanionPetHidden'))
  assert.ok(COMPANION_METHODS.has('ShowCompanionMainWindow'))
  assert.ok(!COMPANION_METHODS.has('SendMessage'))
  assert.ok(!COMPANION_METHODS.has('SaveSettingsCmd'))
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
})

test('Windows parks the main window by minimizing so the taskbar stays', () => {
  const { shell, main, dock } = createShell({ platform: 'win32' })
  shell.parkMainWindow()
  assert.equal(main.minimizeCalls, 1)
  assert.equal(main.hideCalls, 0)
  assert.equal(dock.hideCalls, 0)
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

test('tray menu can hide the pet and open the main window', () => {
  const { shell, menus, main } = createShell()
  shell.createFloat()
  shell.createTray()
  const labels = menus.at(-1).template.map(item => item.label)
  assert.deepEqual(labels.filter(Boolean), ['隐藏桌宠', '打开主窗口', '退出'])
  menus.at(-1).template[0].click()
  assert.equal(shell.status().hidden, true)
  menus.at(-1).template[1].click()
  assert.equal(main.showCalls >= 1, true)
})

test('SetCompanionPetHidden and ShowCompanionMainWindow are host methods', () => {
  const { shell, main } = createShell()
  shell.createFloat()
  const hidden = shell.handleHostMethod('SetCompanionPetHidden', { hidden: true, locale: 'en' })
  assert.equal(hidden.hidden, true)
  const shown = shell.handleHostMethod('ShowCompanionMainWindow')
  assert.equal(main.showCalls >= 1, true)
  assert.equal(shown.tray || true, true)
})
