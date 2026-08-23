'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  installRendererReloadGuard,
  isRendererReloadShortcut,
  productApplicationMenuTemplate,
} = require('./renderer-reload.cjs')

test('treats browser reload chords as product-window reloads', () => {
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'r', control: true }), true)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'R', meta: true }), true)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'r', control: true, shift: true }), true)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'F5' }), true)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'f5' }), true)
})

test('does not swallow quit, copy, or plain R', () => {
  assert.equal(isRendererReloadShortcut({ type: 'keyUp', key: 'r', control: true }), false)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'r' }), false)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'q', meta: true }), false)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'c', control: true }), false)
  assert.equal(isRendererReloadShortcut({ type: 'keyDown', key: 'r', alt: true, control: true }), false)
})

test('product menu omits the Chromium View reload entries', () => {
  const roles = template => template.flatMap(item => [item.role, ...(item.submenu || []).map(entry => entry.role)])
  assert.equal(roles(productApplicationMenuTemplate('win32')).includes('viewMenu'), false)
  assert.equal(roles(productApplicationMenuTemplate('darwin')).includes('viewMenu'), false)
  assert.ok(roles(productApplicationMenuTemplate('darwin')).includes('appMenu'))
})

test('reload guard prevents the Electron input event', () => {
  const listeners = []
  const webContents = {
    on(event, listener) {
      listeners.push([event, listener])
    },
  }
  installRendererReloadGuard(webContents)
  assert.equal(listeners[0][0], 'before-input-event')
  let prevented = false
  listeners[0][1]({ preventDefault() { prevented = true } }, { type: 'keyDown', key: 'r', control: true })
  assert.equal(prevented, true)
})

test('desktop shell installs the reload guard and a menu without View', () => {
  const source = readFileSync(join(__dirname, 'main.cjs'), 'utf8')
  assert.match(source, /installRendererReloadGuard\(mainWindow\.webContents\)/)
  assert.match(source, /productApplicationMenuTemplate\(\)/)
  assert.match(source, /did-finish-load/)
  assert.doesNotMatch(source, /once\('did-finish-load'/)
})
