'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { BackendRuntime } = require('./backend-runtime.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.kill = (signal) => {
    child.exitCode = signal === 'SIGKILL' ? null : 1
    child.emit('exit', child.exitCode, signal || null)
  }
  return child
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('invoke waits for ready instead of throwing unavailable', async () => {
  const child = fakeChild()
  const runtime = new BackendRuntime({
    spawnProcess: () => child,
    hostHandler: async () => null,
    eventHandler: () => {},
  })
  const pending = runtime.invoke('GetSettings', [])
  child.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  child.stdout.write(`${JSON.stringify({ type: 'result', id: 'invoke-1', result: { ok: true } })}\n`)
  assert.deepEqual(await pending, { ok: true })
  assert.equal(runtime.generation, 1)
  assert.equal(runtime.state, 'ready')
  runtime.beginStop()
})

test('unexpected exit recovers with a new generation', async () => {
  const children = [fakeChild(), fakeChild()]
  let spawned = 0
  const statuses = []
  const runtime = new BackendRuntime({
    spawnProcess: () => children[spawned++],
    hostHandler: async () => null,
    eventHandler: (event, payload) => {
      if (event === 'runtime.status') statuses.push(payload)
    },
    recoverDelayMs: 20,
  })
  children[0].stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  assert.equal(runtime.generation, 1)
  children[0].kill()
  await delay(80)
  children[1].stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  assert.equal(runtime.generation, 2)
  assert.equal(runtime.state, 'ready')
  assert.ok(statuses.some(item => item.state === 'recovering'))
  assert.equal(statuses.at(-1)?.state, 'ready')
  runtime.beginStop()
})

test('results from a previous generation are ignored', async () => {
  const children = [fakeChild(), fakeChild()]
  let spawned = 0
  const runtime = new BackendRuntime({
    spawnProcess: () => children[spawned++],
    hostHandler: async () => null,
    eventHandler: () => {},
    recoverDelayMs: 20,
  })
  children[0].stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  const pending = runtime.invoke('GetSettings', [])
  await delay(20)
  const rejected = assert.rejects(pending, /正在恢复运行时/)
  children[0].kill()
  await delay(80)
  children[0].stdout.write(`${JSON.stringify({ type: 'result', id: 'invoke-1', result: { stale: true } })}\n`)
  await rejected
  runtime.beginStop()
})

test('beginStop prevents recovery after exit', async () => {
  let spawned = 0
  const child = fakeChild()
  const runtime = new BackendRuntime({
    spawnProcess: () => {
      spawned += 1
      return child
    },
    hostHandler: async () => null,
    eventHandler: () => {},
    recoverDelayMs: 10,
  })
  runtime.beginStop()
  child.emit('exit', 0, null)
  await delay(40)
  assert.equal(spawned, 1)
  assert.equal(runtime.state, 'exited')
})
