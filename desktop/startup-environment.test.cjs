'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  desktopBackendEnvironment,
  electronNodeEnvironment,
} = require('./startup-environment.cjs')

test('Windows Electron-as-Node probe receives only its required environment', () => {
  const environment = electronNodeEnvironment('win32', {
    SystemRoot: 'C:\\Windows',
    NODE_OPTIONS: '--require unsafe-hook.cjs',
    OPENAI_API_KEY: 'must-not-leak',
    PATH: 'must-not-be-inherited',
  })

  assert.deepEqual(environment, {
    ELECTRON_RUN_AS_NODE: '1',
    SystemRoot: 'C:\\Windows',
  })
})

test('Windows Electron-as-Node probe fails clearly without SystemRoot', () => {
  assert.throws(
    () => electronNodeEnvironment('win32', {}),
    /Windows SystemRoot is required/u,
  )
})

test('non-Windows Electron-as-Node probe preserves its minimal environment', () => {
  assert.deepEqual(
    electronNodeEnvironment('darwin', {
      SystemRoot: '/not-used',
      OPENAI_API_KEY: 'must-not-leak',
    }),
    { ELECTRON_RUN_AS_NODE: '1' },
  )
})

test('desktop backend receives the actual Electron host PID', () => {
  const environment = desktopBackendEnvironment({
    MILKSU_DESKTOP_HOST_PID: '7',
    PATH: 'preserved-for-the-runtime',
  }, {
    channel: 'stable',
    appId: 'com.milksu.app',
    appVersion: '26.822.1',
    hostPid: 4321,
  })

  assert.equal(environment.MILKSU_CHANNEL, 'stable')
  assert.equal(environment.MILKSU_DESKTOP_APP_ID, 'com.milksu.app')
  assert.equal(environment.MILKSU_APP_VERSION, '26.822.1')
  assert.equal(environment.MILKSU_DESKTOP_HOST_PID, '4321')
  assert.equal(environment.PATH, 'preserved-for-the-runtime')
})

test('desktop backend rejects an invalid Electron host PID', () => {
  assert.throws(
    () => desktopBackendEnvironment({}, { hostPid: 0 }),
    /desktop host PID/u,
  )
})
