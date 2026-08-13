'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { requestScreenRecordingPermission } = require('./screen-recording-primer.cjs')

test('screen recording primer performs one isolated display capture and tears it down', async () => {
  const calls = []
  const handlers = {}
  const fakeSession = {
    setPermissionRequestHandler(handler) {
      handlers.permission = handler
      calls.push(['permission-handler', Boolean(handler)])
    },
    setPermissionCheckHandler(handler) {
      handlers.check = handler
      calls.push(['check-handler', Boolean(handler)])
    },
    setDisplayMediaRequestHandler(handler) {
      handlers.display = handler
      calls.push(['display-handler', Boolean(handler)])
    },
  }
  const webContents = {
    async executeJavaScript(code, userGesture) {
      calls.push(['execute', code.includes('getDisplayMedia'), userGesture])
      assert.equal(handlers.check(webContents, 'display-capture'), true)
      assert.equal(handlers.check(webContents, 'media'), false)
      await new Promise(resolve => handlers.display({
        videoRequested: true,
        audioRequested: false,
      }, streams => {
        calls.push(['streams', streams.video?.id])
        resolve()
      }))
    },
  }
  class FakeWindow {
    constructor(options) {
      this.webContents = webContents
      this.destroyed = false
      calls.push(['window', options.show, options.webPreferences.session === fakeSession])
    }
    async loadFile(file) { calls.push(['load', file]) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; calls.push(['destroy']) }
  }

  await requestScreenRecordingPermission({
    BrowserWindow: FakeWindow,
    session: { fromPartition: partition => {
      calls.push(['partition', partition])
      return fakeSession
    } },
    desktopCapturer: { async getSources(options) {
      calls.push(['sources', options.types, options.thumbnailSize])
      return [{ id: 'screen:1', name: 'Screen 1' }]
    } },
    htmlPath: '/sealed/screen-recording-primer.html',
    partition: 'screen-permission-test',
  })

  assert.deepEqual(calls, [
    ['partition', 'screen-permission-test'],
    ['window', false, true],
    ['permission-handler', true],
    ['check-handler', true],
    ['display-handler', true],
    ['load', '/sealed/screen-recording-primer.html'],
    ['execute', true, true],
    ['sources', ['screen'], { width: 0, height: 0 }],
    ['streams', 'screen:1'],
    ['display-handler', false],
    ['permission-handler', false],
    ['check-handler', false],
    ['destroy'],
  ])
})

test('screen recording primer tears down when capture is denied', async () => {
  const handlers = {}
  let destroyed = false
  const fakeSession = {
    setPermissionRequestHandler(handler) { handlers.permission = handler },
    setPermissionCheckHandler(handler) { handlers.check = handler },
    setDisplayMediaRequestHandler(handler) { handlers.display = handler },
  }
  class FakeWindow {
    constructor() {
      this.webContents = {
        async executeJavaScript() { throw new Error('permission denied') },
      }
    }
    async loadFile() {}
    isDestroyed() { return destroyed }
    destroy() { destroyed = true }
  }

  await assert.rejects(requestScreenRecordingPermission({
    BrowserWindow: FakeWindow,
    session: { fromPartition: () => fakeSession },
    desktopCapturer: { async getSources() { return [] } },
    htmlPath: '/sealed/screen-recording-primer.html',
    partition: 'screen-permission-denied-test',
  }), /permission denied/)
  assert.equal(destroyed, true)
  assert.equal(handlers.permission, null)
  assert.equal(handlers.check, null)
  assert.equal(handlers.display, null)
})

test('screen recording primer cannot block the settings action indefinitely', async () => {
  const handlers = {}
  let destroyed = false
  const fakeSession = {
    setPermissionRequestHandler(handler) { handlers.permission = handler },
    setPermissionCheckHandler(handler) { handlers.check = handler },
    setDisplayMediaRequestHandler(handler) { handlers.display = handler },
  }
  class FakeWindow {
    constructor() {
      this.webContents = { executeJavaScript: () => new Promise(() => {}) }
    }
    async loadFile() {}
    isDestroyed() { return destroyed }
    destroy() { destroyed = true }
  }

  await assert.rejects(requestScreenRecordingPermission({
    BrowserWindow: FakeWindow,
    session: { fromPartition: () => fakeSession },
    desktopCapturer: { async getSources() { return [] } },
    htmlPath: '/sealed/screen-recording-primer.html',
    partition: 'screen-permission-timeout-test',
    timeoutMs: 5,
  }), /timed out/)
  assert.equal(destroyed, true)
  assert.equal(handlers.permission, null)
  assert.equal(handlers.check, null)
  assert.equal(handlers.display, null)
})
