'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createCompanionShell } = require('./companion-shell.cjs')

test('companion window methods are a subset of the main renderer surface', () => {
  const { COMPANION_METHODS } = require('./companion-shell.cjs')
  assert.ok(COMPANION_METHODS.has('SendCompanionMessage'))
  assert.ok(!COMPANION_METHODS.has('SendMessage'))
  assert.ok(!COMPANION_METHODS.has('SaveSettingsCmd'))
})

test('Wayland sessions report a degraded float status', () => {
  const previous = process.env.XDG_SESSION_TYPE
  process.env.XDG_SESSION_TYPE = 'wayland'
  process.env.WAYLAND_DISPLAY = 'wayland-1'
  try {
    if (process.platform !== 'linux') {
      assert.ok(true)
      return
    }
    const shell = createCompanionShell({
      app: { quit() {}, dock: { hide() {}, show() {} } },
      BrowserWindow: class {},
      Tray: class { setToolTip() {} setContextMenu() {} },
      Menu: { buildFromTemplate() { return {} } },
      nativeImage: { createFromPath() { return { isEmpty: () => true } }, createEmpty() { return {} } },
      APP_ORIGIN: 'milksu://app',
      resourcesPath: '',
      repositoryRoot: '',
      isPackaged: false,
      getMainWindow: () => null,
      onQuitRequested: () => {},
    })
    const status = shell.setFloatEnabled(true)
    assert.equal(status.wayland, true)
    assert.equal(status.floating, false)
  } finally {
    if (previous === undefined) delete process.env.XDG_SESSION_TYPE
    else process.env.XDG_SESSION_TYPE = previous
  }
})
