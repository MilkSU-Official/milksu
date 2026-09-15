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
  assert.equal(chrome.backgroundColor, '#00000000')
  assert.equal(chrome.vibrancy, 'under-window')
  assert.equal(chrome.visualEffectState, 'active')
  assert.equal(chrome.titleBarOverlay, undefined)
  assert.equal(chrome.autoHideMenuBar, undefined)
})

test('Windows and Linux hide the native caption and in-window menu', () => {
  const windows = browserWindowChrome({ platform: 'win32', theme: 'light' })
  assert.equal(windows.titleBarStyle, 'hidden')
  assert.equal(windows.autoHideMenuBar, true)
  assert.equal(windows.trafficLightPosition, undefined)
  assert.equal(windows.backgroundMaterial, 'acrylic')
  assert.deepEqual(windows.titleBarOverlay, {
    color: '#fcfcfc',
    symbolColor: '#141414',
  })

  const linux = browserWindowChrome({ platform: 'linux', theme: 'light' })
  assert.equal(linux.titleBarStyle, 'hidden')
  assert.equal(linux.autoHideMenuBar, true)
  assert.equal(linux.backgroundMaterial, undefined)
  assert.deepEqual(linux.titleBarOverlay, {
    color: '#fcfcfc',
    symbolColor: '#141414',
  })
})

test('dark chrome uses the night canvas instead of a white overlay', () => {
  assert.deepEqual(windowChromeColors('dark'), {
    backgroundColor: '#181818',
    symbolColor: '#f0f0f0',
  })
  assert.deepEqual(titleBarOverlayOptions('dark'), {
    color: '#181818',
    symbolColor: '#f0f0f0',
  })
  const linux = browserWindowChrome({ platform: 'linux', theme: 'dark' })
  assert.equal(linux.backgroundColor, '#181818')
  assert.equal(linux.titleBarOverlay.color, '#181818')
})

test('unknown theme falls back to light canvas colors', () => {
  assert.equal(windowChromeColors('system').backgroundColor, '#fcfcfc')
  assert.equal(browserWindowChrome({ platform: 'win32' }).backgroundColor, '#fcfcfc')
})

test('applyWindowChrome updates overlay off macOS and skips it on darwin', () => {
  const overlays = []
  const backgrounds = []
  const vibrancy = []
  const materials = []
  const window = {
    setBackgroundColor(value) { backgrounds.push(value) },
    setTitleBarOverlay(value) { overlays.push(value) },
    setVibrancy(value) { vibrancy.push(value) },
    setBackgroundMaterial(value) { materials.push(value) },
    isDestroyed() { return false },
  }

  assert.equal(applyWindowChrome(window, { platform: 'darwin', theme: 'dark' }), true)
  assert.deepEqual(backgrounds, ['#00000000'])
  assert.deepEqual(vibrancy, ['under-window'])
  assert.deepEqual(overlays, [])

  assert.equal(applyWindowChrome(window, { platform: 'win32', theme: 'light' }), true)
  assert.deepEqual(overlays, [{ color: '#fcfcfc', symbolColor: '#141414' }])
  assert.deepEqual(materials, ['acrylic'])

  assert.equal(applyWindowChrome(null, { platform: 'linux', theme: 'dark' }), false)
})

test('desktop window creation uses the shared chrome helper', () => {
  const source = readFileSync(join(__dirname, 'main.cjs'), 'utf8')
  assert.match(source, /browserWindowChrome/)
  assert.match(source, /SetTitleBarOverlay/)
  assert.doesNotMatch(source, /titleBarStyle: 'hiddenInset'/)
})
