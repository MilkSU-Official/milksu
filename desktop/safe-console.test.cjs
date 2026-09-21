'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  installBrokenPipeGuards,
  isBrokenPipeError,
  safeConsoleInfo,
} = require('./safe-console.cjs')

test('recognizes broken pipe codes', () => {
  assert.equal(isBrokenPipeError({ code: 'EPIPE' }), true)
  assert.equal(isBrokenPipeError({ code: 'ERR_STREAM_DESTROYED' }), true)
  assert.equal(isBrokenPipeError({ code: 'ECONNRESET' }), false)
  assert.equal(isBrokenPipeError(null), false)
})

test('installBrokenPipeGuards makes console.info swallow EPIPE', () => {
  const original = Object.getOwnPropertyDescriptor(console, 'info')
  let threw = false
  const thrower = () => {
    threw = true
    const error = new Error('write EPIPE')
    error.code = 'EPIPE'
    throw error
  }
  Object.defineProperty(console, 'info', { configurable: true, writable: true, value: thrower })
  delete console.info.__milksuPipeSafe
  installBrokenPipeGuards()
  try {
    assert.doesNotThrow(() => safeConsoleInfo('[startup] +1ms test'))
    assert.equal(threw, true)
  } finally {
    if (original) Object.defineProperty(console, 'info', original)
    else delete console.info
  }
})

test('patched console still rethrows unrelated failures', () => {
  const original = Object.getOwnPropertyDescriptor(console, 'info')
  const thrower = () => {
    throw new Error('disk full')
  }
  Object.defineProperty(console, 'info', { configurable: true, writable: true, value: thrower })
  delete console.info.__milksuPipeSafe
  installBrokenPipeGuards()
  try {
    assert.throws(() => console.info('boom'), /disk full/)
  } finally {
    if (original) Object.defineProperty(console, 'info', original)
    else delete console.info
  }
})
