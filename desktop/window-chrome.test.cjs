'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  applyWindowChrome,
  browserWindowChrome,
  titleBarOverlayOptions,
  windowChromeColors,
} = require('./window-chrome.cjs')

test('macOS keeps hiddenInset traffic lights and no overlay caption', () => {
  const chrome = browserWindowChrome({ platform: 'darwin', theme: 'light' })
  assert.equal(chrome.titleBarStyle, 'hiddenInset')
  assert.deepEqual(chrome.trafficLightPosition, { x: 14, y: 16 })
  assert.equal(chrome.backgroundColor, '#f7f7f5')
  assert.equal(chrome.titleBarOverlay, undefined)
  assert.equal(chrome.autoHideMenuBar, undefined)
})

test('Windows and Linux hide the native caption and in-window menu', () => {
  for (const platform of ['win32', 'linux']) {
    const chrome = browserWindowChrome({ platform, theme: 'light' })
    assert.equal(chrome.titleBarStyle, 'hidden')
    assert.equal(chrome.autoHideMenuBar, true)
    assert.equal(chrome.trafficLightPosition, undefined)
    assert.deepEqual(chrome.titleBarOverlay, {
      color: '#f7f7f5',
      symbolColor: '#111315',
    })
  }
})

test('dark chrome uses the night canvas instead of a white overlay', () => {
  assert.deepEqual(windowChromeColors('dark'), {
    backgroundColor: '#1c1d21',
    symbolColor: '#f4f5f6',
  })
  assert.deepEqual(titleBarOverlayOptions('dark'), {
    color: '#1c1d21',
    symbolColor: '#f4f5f6',
  })
  const linux = browserWindowChrome({ platform: 'linux', theme: 'dark' })
  assert.equal(linux.backgroundColor, '#1c1d21')
  assert.equal(linux.titleBarOverlay.color, '#1c1d21')
})

test('unknown theme falls back to light canvas colors', () => {
  assert.equal(windowChromeColors('system').backgroundColor, '#f7f7f5')
  assert.equal(browserWindowChrome({ platform: 'win32' }).backgroundColor, '#f7f7f5')
})

test('applyWindowChrome updates overlay off macOS and skips it on darwin', () => {
  const overlays = []
  const backgrounds = []
  const window = {
    setBackgroundColor(value) { backgrounds.push(value) },
    setTitleBarOverlay(value) { overlays.push(value) },
    isDestroyed() { return false },
  }

  assert.equal(applyWindowChrome(window, { platform: 'darwin', theme: 'dark' }), true)
  assert.deepEqual(backgrounds, ['#1c1d21'])
  assert.deepEqual(overlays, [])

  assert.equal(applyWindowChrome(window, { platform: 'win32', theme: 'light' }), true)
  assert.deepEqual(overlays, [{ color: '#f7f7f5', symbolColor: '#111315' }])

  assert.equal(applyWindowChrome(null, { platform: 'linux', theme: 'dark' }), false)
})

test('desktop window creation uses the shared chrome helper', () => {
  const source = readFileSync(join(__dirname, 'main.cjs'), 'utf8')
  assert.match(source, /browserWindowChrome/)
  assert.match(source, /SetTitleBarOverlay/)
  assert.doesNotMatch(source, /titleBarStyle: 'hiddenInset'/)
})
