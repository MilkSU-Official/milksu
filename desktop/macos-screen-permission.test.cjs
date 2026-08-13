'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { requestMacOSScreenPermission } = require('./macos-screen-permission.cjs')

test('screen permission bridge reuses an existing grant without requesting again', async () => {
  let requests = 0
  assert.equal(await requestMacOSScreenPermission({
    preflight: () => true,
    request: () => { requests += 1; return false },
  }), true)
  assert.equal(requests, 0)
})

test('screen permission bridge requests once when the host is not granted', async () => {
  let requests = 0
  assert.equal(await requestMacOSScreenPermission({
    preflight: () => false,
    request: () => { requests += 1; return false },
  }), false)
  assert.equal(requests, 1)
})

test('screen permission bridge rejects a missing native module', async () => {
  await assert.rejects(() => requestMacOSScreenPermission(null), /unavailable/)
})
