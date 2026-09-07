'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const runtimeSource = fs.readFileSync(path.join(__dirname, 'backend-runtime.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

function sourceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker)
  const end = mainSource.indexOf(endMarker, start)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return mainSource.slice(start, end)
}

test('backend messages have fixed renderer and Electron host sources', () => {
  assert.match(
    runtimeSource,
    /const BACKEND_INVOKE_SOURCE_RENDERER = 'renderer'/u,
  )
  assert.match(
    runtimeSource,
    /const BACKEND_INVOKE_SOURCE_ELECTRON_HOST = 'electron_host'/u,
  )
  assert.match(
    runtimeSource,
    /invokeFromRenderer\(method, args\) \{\s*return this\.invokeWithSource\(BACKEND_INVOKE_SOURCE_RENDERER, method, args\)\s*\}/u,
  )
  assert.match(
    runtimeSource,
    /invokeFromElectronHost\(method, args\) \{\s*return this\.invokeWithSource\(BACKEND_INVOKE_SOURCE_ELECTRON_HOST, method, args\)\s*\}/u,
  )
  assert.match(
    runtimeSource,
    /this\.send\(\{ type: 'invoke', id, source, method, args, generation \}/u,
  )
})

test('renderer IPC cannot choose or forward a backend source', () => {
  const ipcSource = sourceBetween(
    "ipcMain.handle('milksu:invoke'",
    "app.on('open-url'",
  )

  assert.match(ipcSource, /backend\.invokeFromRenderer\(method, request\?\.args\)/u)
  assert.doesNotMatch(ipcSource, /request\?\.(?:source|origin)/u)
  assert.doesNotMatch(ipcSource, /invokeFromElectronHost/u)
  assert.doesNotMatch(ipcSource, /backend\.invoke\(/u)
})

test('Electron-owned renderer methods remain handled before Go dispatch', () => {
  const ipcSource = sourceBetween(
    "ipcMain.handle('milksu:invoke'",
    "app.on('open-url'",
  )
  const electronMethods = [
    'GetBuildTracking',
    'GetAccountStatus',
    'StartAccountLogin',
    'LogoutAccount',
    'GetUpdateStatus',
    'CheckForUpdates',
    'DownloadUpdate',
    'InstallUpdate',
  ]

  for (const method of electronMethods) {
    assert.match(ipcSource, new RegExp(`method === '${method}'`, 'u'))
  }
})

test('account credential synchronization uses only the Electron host source', () => {
  const syncSource = sourceBetween(
    'async function syncAccountModelAuthorization',
    'function resourcesPath',
  )

  assert.match(
    syncSource,
    /backend\.invokeFromElectronHost\(\s*'SetAccountModelCredential'/u,
  )
  assert.match(
    syncSource,
    /backend\.invokeFromElectronHost\('ClearAccountModelCredential', \[\]\)/u,
  )
  assert.doesNotMatch(syncSource, /invokeFromRenderer/u)
  assert.doesNotMatch(syncSource, /backend\.invoke\(/u)
})

test('renderer sender must be the primary window main frame at the app origin', () => {
  const senderSource = sourceBetween('function senderIsApp', 'function normalizeFilters')

  assert.match(senderSource, /event\.sender === mainWindow\?\.webContents/u)
  assert.match(
    senderSource,
    /event\.senderFrame === mainWindow\?\.webContents\.mainFrame/u,
  )
  assert.match(
    senderSource,
    /event\.senderFrame\?\.url\?\.startsWith\(`\$\{APP_ORIGIN\}\/`\)/u,
  )
})

test('preload exposes the desktop bridge only in the primary frame', () => {
  assert.match(preloadSource, /if \(process\.isMainFrame\) \{/u)
  const gate = preloadSource.indexOf('if (process.isMainFrame) {')
  const expose = preloadSource.indexOf("contextBridge.exposeInMainWorld('milksu'")
  assert.ok(gate >= 0 && expose > gate)
})
