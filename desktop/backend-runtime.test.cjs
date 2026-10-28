'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const test = require('node:test')
const { BackendRuntime, MALFORMED_BACKEND_LINE_LIMIT } = require('./backend-runtime.cjs')

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

test('BackendRuntime talks JSONL with a node child process', async () => {
  const { spawn } = require('node:child_process')
  const runtime = new BackendRuntime({
    spawnProcess: () => spawn(process.execPath, ['-e', `
      const readline = require('node:readline')
      process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n')
      const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
      lines.on('line', (line) => {
        let message
        try { message = JSON.parse(line) } catch { return }
        if (message.type === 'shutdown') process.exit(0)
        if (message.type === 'invoke') {
          process.stdout.write(JSON.stringify({ type: 'result', id: message.id, result: { method: message.method } }) + '\\n')
        }
      })
    `], { stdio: ['pipe', 'pipe', 'pipe'] }),
    hostHandler: async () => null,
    eventHandler: () => {},
  })
  const result = await runtime.invoke('GetSettings', [])
  assert.deepEqual(result, { method: 'GetSettings' })
  await runtime.stop()
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

test('a stray non-JSON runtime line is logged and skipped, not fatal', async () => {
  const child = fakeChild()
  const logged = []
  const originalError = console.error
  console.error = (...args) => { logged.push(String(args[0])) }
  let runtime
  try {
    runtime = new BackendRuntime({
      spawnProcess: () => child,
      hostHandler: async () => null,
      eventHandler: () => {},
    })
    child.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
    await delay(20)
    const pending = runtime.invoke('GetSettings', [])
    child.stdout.write('Client.listResources() called but server does not advertise resources capability - returning empty list\n')
    await delay(20)
    child.stdout.write(`${JSON.stringify({ type: 'result', id: 'invoke-1', result: { ok: true } })}\n`)
    assert.deepEqual(await pending, { ok: true })
    assert.equal(runtime.state, 'ready')
    assert.ok(logged.join('\n').includes('Client.listResources()'), 'the skip log must carry the raw line')
  } finally {
    console.error = originalError
    runtime?.beginStop()
  }
})

test('sustained non-JSON runtime output fails the generation once', async () => {
  const child = fakeChild()
  const runtime = new BackendRuntime({
    spawnProcess: () => child,
    hostHandler: async () => null,
    eventHandler: () => {},
  })
  child.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  const pending = runtime.invoke('GetSettings', [])
  // Attach the rejection handler before the burst, or node:test reports the
  // rejection as unhandled before assert.rejects ever sees it.
  const outcome = assert.rejects(pending, /连续输出了/)
  await delay(10)
  for (let i = 0; i < MALFORMED_BACKEND_LINE_LIMIT; i += 1) {
    child.stdout.write('definitely not json\n')
  }
  await delay(40)
  await outcome
  runtime.beginStop()
})

test('blank runtime lines are noise and the malformed counter resets on recovery', async () => {
  const child = fakeChild()
  const runtime = new BackendRuntime({
    spawnProcess: () => child,
    hostHandler: async () => null,
    eventHandler: () => {},
  })
  child.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)
  await delay(20)
  const burst = 'x'.repeat(20)
  for (let i = 0; i < 20; i += 1) child.stdout.write(burst + '\n')
  for (let i = 0; i < 10; i += 1) child.stdout.write('\n')
  child.stdout.write(`${JSON.stringify({ type: 'result', id: 'invoke-1', result: { ok: true } })}\n`)
  await delay(20)
  for (let i = 0; i < 20; i += 1) child.stdout.write(burst + '\n')
  await delay(20)
  const pending = runtime.invoke('GetSettings', [])
  await delay(10)
  child.stdout.write(`${JSON.stringify({ type: 'result', id: 'invoke-1', result: { ok: true } })}\n`)
  assert.deepEqual(await pending, { ok: true })
  assert.equal(runtime.state, 'ready')
  runtime.beginStop()
})
