import assert from 'node:assert/strict'
import test from 'node:test'

import { EventEmitter } from 'node:events'
import { CdpSession, GuiDriver, isMilkSUPage, isProductLoopFixtureConversation, killProcessGroup } from './lib/desktop-gui-driver.mjs'
import {
  observedIsolatedBrowserMarker,
  pickComputerUseTarget,
  usedComputerUseTools,
  usedIsolatedBrowserTools,
} from './lib/product-loop-desktop-surface.mjs'
import {
  DEFAULT_SUITES,
  SUITE_RUN_ORDER,
  orderSuites,
  PRODUCT_LOOP_SCHEMA,
  SUITES,
  TOKENFLUX_BASE_URL,
  parseProductLoopArgs,
  parseSuiteList,
  finalizeProductLoopResult,
  suiteRunnable,
} from './lib/product-loop-catalog.mjs'

test('catalog keeps product regression away from evalsuite', () => {
  assert.equal(PRODUCT_LOOP_SCHEMA, 'milksu-product-loop/v1')
  assert.equal(TOKENFLUX_BASE_URL, 'https://tokenflux.dev/v1')
  assert.deepEqual(DEFAULT_SUITES, ['stop-scope', 'composer-runtime', 'dsh', 'chat-pin', 'pi-files', 'desktop-surface'])
  assert.deepEqual(orderSuites(['pi-files', 'stop-scope', 'dsh']), ['stop-scope', 'dsh', 'pi-files'])
  assert.deepEqual(SUITE_RUN_ORDER[2], 'dsh')
  assert.equal(SUITES['composer-runtime'].needsDesktop, false)
  for (const id of DEFAULT_SUITES) {
    assert.equal(SUITES[id].id, id)
    assert.ok(SUITES[id].from)
    assert.ok(SUITES[id].detail)
  }
})

test('parseSuiteList accepts all and rejects unknown ids', () => {
  assert.deepEqual(parseSuiteList('all'), DEFAULT_SUITES)
  assert.deepEqual(parseSuiteList('dsh,stop-scope,dsh'), ['dsh', 'stop-scope'])
  assert.throws(() => parseSuiteList('frontier'), /unknown product-loop suite/)
})

test('parseProductLoopArgs selects mode and suite list', () => {
  assert.equal(parseProductLoopArgs(['--help']).help, true)
  assert.equal(parseProductLoopArgs(['--list']).list, true)
  assert.equal(parseProductLoopArgs(['--bridge']).mode, 'bridge')
  assert.equal(parseProductLoopArgs(['--bridge', '--gui']).mode, 'gui')
  assert.deepEqual(
    parseProductLoopArgs(['--suite', 'chat-pin,dsh']).suites,
    ['dsh', 'chat-pin'],
  )
})

test('finalizeProductLoopResult fails a dropped suite instead of passing 5 of 6', () => {
  const five = DEFAULT_SUITES.slice(0, 5).map(id => ({ id, result: 'PASS' }))
  assert.equal(finalizeProductLoopResult(five, DEFAULT_SUITES), 'FAIL')
  assert.equal(finalizeProductLoopResult([], DEFAULT_SUITES, ['CDP WebSocket closed']), 'FAIL')
  assert.equal(
    finalizeProductLoopResult(DEFAULT_SUITES.map(id => ({ id, result: 'PASS' })), DEFAULT_SUITES),
    'PASS',
  )
})

test('pi-files and desktop-surface are GUI-only; stop-scope runs in both modes', () => {
  assert.equal(suiteRunnable(SUITES['pi-files'], 'bridge').ok, false)
  assert.equal(suiteRunnable(SUITES['desktop-surface'], 'bridge').ok, false)
  assert.equal(suiteRunnable(SUITES['stop-scope'], 'bridge').ok, true)
  assert.equal(suiteRunnable(SUITES.dsh, 'bridge').ok, true)
})

test('pickComputerUseTarget only accepts a calculator, then degrades', () => {
  assert.equal(pickComputerUseTarget({ error: 'Computer Use service is unavailable' }).available, false)
  assert.equal(pickComputerUseTarget([]).available, false)
  assert.equal(pickComputerUseTarget([{ name: 'MilkSU', bundleId: 'com.milksu.app' }]).available, false)
  assert.equal(pickComputerUseTarget([{ name: 'Google Chrome', bundleId: 'com.google.Chrome' }]).available, false)
  const picked = pickComputerUseTarget([{ name: '计算器', bundleId: 'com.apple.calculator' }])
  assert.equal(picked.available, true)
  assert.equal(picked.reason, 'calculator')
  assert.equal(usedComputerUseTools(['screenshot', 'bash']), true)
  assert.equal(usedIsolatedBrowserTools(['mcp__playwright-mcp__browser_navigate']), true)
  assert.equal(usedComputerUseTools(['bash']), false)
  assert.equal(observedIsolatedBrowserMarker({ fileHasMarker: true, assistantHasMarker: false }), true)
  assert.equal(observedIsolatedBrowserMarker({ fileHasMarker: false, assistantHasMarker: true }), true)
  assert.equal(observedIsolatedBrowserMarker({ fileHasMarker: false, assistantHasMarker: false }), false)
})

test('isMilkSUPage rejects Cursor and accepts the product window', () => {
  assert.equal(isMilkSUPage({ title: 'Cursor', url: 'https://cursor.com' }), false)
  assert.equal(isMilkSUPage({ title: 'MilkSU', url: 'milksu://app' }), true)
  assert.equal(isMilkSUPage({ title: 'MilkSU DSH fixture', url: 'http://127.0.0.1:49501/' }), false)
  assert.equal(isMilkSUPage({ title: 'MilkSU', url: 'about:blank' }), false)
})

test('waitForTurn keeps polling after a transient CDP close', async () => {
  const driver = new GuiDriver()
  let calls = 0
  driver.drainEvents = async () => {
    calls += 1
    if (calls === 1) throw new Error('CDP WebSocket closed')
    return [{ type: 'assistant.settled' }]
  }
  driver.ensureAttached = async () => true
  const turn = await driver.waitForTurn('conversation-1', 2_000)
  assert.equal(turn.timeout, false)
  assert.ok(calls >= 2)
})

test('isProductLoopFixtureConversation only matches regression leftovers', () => {
  assert.equal(isProductLoopFixtureConversation({ id: 'loop-pin-abc-a', title: 'loop-pin-abc-a' }), true)
  assert.equal(isProductLoopFixtureConversation({ id: 'product-loop-mu8jrg59', title: 'DSH 仓库只读+小改' }), true)
  assert.equal(isProductLoopFixtureConversation({
    id: 'uuid',
    title: 'DSH隔离浏览器',
    workspacePath: 'build/test-results/milksu-dsh-loop-Xvp8An',
  }), true)
  assert.equal(isProductLoopFixtureConversation({
    id: 'dsh_edcb44a5-3711-4518-8ef6-7eafaf810c71',
    title: '接力 · PR111 读仓库 DSH',
    workspacePath: '/workspace/milksu',
  }), false)
  assert.equal(isProductLoopFixtureConversation({ id: '01a0ae35-df7f-787b', title: '打招呼' }), false)
})

test('GuiDriver.deleteConversation is a no-op without a conversation id', async () => {
  const driver = new GuiDriver()
  driver.invoke = async () => {
    throw new Error('should not invoke DeleteConversation without an id')
  }
  await driver.deleteConversation('')
})

test('GuiDriver.abortMessage is a no-op without a conversation id', async () => {
  const driver = new GuiDriver()
  driver.invoke = async () => {
    throw new Error('should not invoke AbortMessage without an id')
  }
  await driver.abortMessage('')
  let called = ''
  driver.invoke = async (method, args) => {
    called = `${method}:${args.join(',')}`
  }
  await driver.abortMessage('conversation-1')
  assert.equal(called, 'AbortMessage:conversation-1')
})

test('CdpSession send fails fast when the desktop socket is already gone', async () => {
  const session = new CdpSession('ws://127.0.0.1:9')
  session.closed = true
  await assert.rejects(session.send('Runtime.evaluate'), /CDP WebSocket closed/)
})

test('CdpSession stays usable after a transient socket error event', () => {
  const session = new CdpSession('ws://127.0.0.1:9')
  session.closed = false
  assert.equal(session.closed, false)
})

test('CdpSession close rejects in-flight evaluates instead of hanging', async () => {
  const session = new CdpSession('ws://127.0.0.1:9')
  const pending = new Promise((resolve, reject) => {
    session.pending.set(1, { resolve, reject })
  })
  session.close()
  await assert.rejects(pending, /CDP WebSocket closed/)
  assert.equal(session.pending.size, 0)
})

test('killProcessGroup is a no-op for an already-exited child', () => {
  const child = new EventEmitter()
  child.pid = 1
  child.exitCode = 0
  child.kill = () => {
    throw new Error('should not kill an exited child')
  }
  assert.equal(killProcessGroup(child), false)
})
