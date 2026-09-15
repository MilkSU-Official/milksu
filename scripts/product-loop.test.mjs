import assert from 'node:assert/strict'
import test from 'node:test'

import { EventEmitter } from 'node:events'
import { GuiDriver, isMilkSUPage, killProcessGroup } from './lib/desktop-gui-driver.mjs'
import {
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
  suiteRunnable,
} from './lib/product-loop-catalog.mjs'

test('catalog keeps product regression away from evalsuite', () => {
  assert.equal(PRODUCT_LOOP_SCHEMA, 'milksu-product-loop/v1')
  assert.equal(TOKENFLUX_BASE_URL, 'https://tokenflux.dev/v1')
  assert.deepEqual(DEFAULT_SUITES, ['stop-scope', 'dsh', 'chat-pin', 'pi-files', 'desktop-surface'])
  assert.deepEqual(orderSuites(['pi-files', 'stop-scope', 'dsh']), ['stop-scope', 'dsh', 'pi-files'])
  assert.deepEqual(SUITE_RUN_ORDER[1], 'dsh')
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
})

test('isMilkSUPage rejects Cursor and accepts the product window', () => {
  assert.equal(isMilkSUPage({ title: 'Cursor', url: 'https://cursor.com' }), false)
  assert.equal(isMilkSUPage({ title: 'MilkSU', url: 'milksu://app' }), true)
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

test('killProcessGroup is a no-op for an already-exited child', () => {
  const child = new EventEmitter()
  child.pid = 1
  child.exitCode = 0
  child.kill = () => {
    throw new Error('should not kill an exited child')
  }
  assert.equal(killProcessGroup(child), false)
})
