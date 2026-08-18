'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { electronNodeEnvironment } = require('./startup-environment.cjs')

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
