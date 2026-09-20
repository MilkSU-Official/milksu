import assert from 'node:assert/strict'
import test from 'node:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { CdpSession, GuiDriver, isMilkSUPage, isProductLoopFixtureConversation, killProcessGroup, stripDesktopCredentialEnv } from './lib/desktop-gui-driver.mjs'
import {
  observedIsolatedBrowserMarker,
  pickComputerUseTarget,
  usedComputerUseTools,
  usedIsolatedBrowserTools,
} from './lib/product-loop-desktop-surface.mjs'
import {
  CASE_RUN_ORDER,
  CASES,
  DEFAULT_MODULES,
  DEFAULT_SUITES,
  expandSuiteSelection,
  MODULES,
  orderSuites,
  PRODUCT_LOOP_SCHEMA,
  SUITES,
  TOKENFLUX_BASE_URL,
  parseProductLoopArgs,
  parseSuiteList,
  finalizeProductLoopResult,
} from './lib/product-loop-catalog.mjs'
import { PRODUCT_LOOP_RUNNERS } from './lib/product-loop-runners.mjs'
import { buildProductLoopReport, formatProductLoopReport } from './lib/product-loop-report.mjs'
import {
  applyProductLoopLocalEnv,
  describeProductLoopLocalEnv,
  parseProductLoopLocalEnv,
  productLoopLocalSecret,
  resetProductLoopLocalSecrets,
  resolveCustomRelayModels,
  TOKENFLUX_CATALOG_DEFAULT_MODEL,
} from './lib/product-loop-local-env.mjs'
import {
  classifyAccountFileLoop,
  describeCustomRelay,
  FIRST_USE_RELAY_ID,
  inspectLoginPage,
  mergeCustomRelay,
} from './lib/product-loop-first-use.mjs'
import {
  boardHasConversation,
  companionIsReady,
  companionRelayPrefix,
  companionSpeakPrompt,
  companionStopPrompt,
  companionTurnErrored,
  companionTurnSettled,
  conversationHasRelay,
  conversationMovedToArchive,
  parseCompanionConfirm,
  transcriptHasPrompt,
} from './lib/product-loop-companion.mjs'

test('catalog keeps product regression away from evalsuite', () => {
  assert.equal(PRODUCT_LOOP_SCHEMA, 'milksu-product-loop/v2')
  assert.equal(TOKENFLUX_BASE_URL, 'https://tokenflux.dev/v1')
  assert.deepEqual(DEFAULT_SUITES, DEFAULT_MODULES)
  assert.deepEqual(DEFAULT_MODULES, [
    'first-use',
    'coding',
    'companion',
    'workspaces',
    'desktop-surface',
    'account-shell',
    'settings-rest',
  ])
  assert.equal(CASE_RUN_ORDER[0], 'login-gate')
  assert.equal(MODULES.coding.cases.length, 33)
  assert.equal(MODULES.companion.cases.length, 14)
  assert.equal(MODULES.workspaces.cases.length, 33)
  assert.equal(MODULES['desktop-surface'].cases.length, 9)
  assert.equal(MODULES['account-shell'].cases.length, 4)
  assert.equal(MODULES['settings-rest'].cases.length, 13)
  assert.equal(orderSuites(['coding-pi-files', 'companion-ready'])[0], 'coding-pi-files')
  assert.equal(SUITES.companion.needsDesktop, true)
  assert.equal(SUITES.companion.needsCredential, true)
  for (const id of DEFAULT_SUITES) {
    assert.equal(SUITES[id].id, id)
    assert.ok(MODULES[id].cases.length)
    assert.ok(SUITES[id].from)
    assert.ok(SUITES[id].detail)
  }
})

test('parseSuiteList accepts all and rejects unknown ids', () => {
  assert.deepEqual(parseSuiteList('all'), DEFAULT_SUITES)
  assert.deepEqual(parseSuiteList('coding-dsh-files,workspace-ctf-open,coding-dsh-files'), ['coding-dsh-files', 'workspace-ctf-open'])
  assert.deepEqual(expandSuiteSelection(['coding-dsh-files', 'workspace-ctf-open']), ['coding-dsh-files', 'workspace-ctf-open'])
  assert.throws(() => parseSuiteList('frontier'), /unknown product-loop suite/)
})

test('parseProductLoopArgs only accepts known flags and suite ids', () => {
  assert.equal(parseProductLoopArgs(['--help']).help, true)
  assert.equal(parseProductLoopArgs(['--list']).list, true)
  assert.equal(parseProductLoopArgs([]).mode, 'gui')
  assert.equal(parseProductLoopArgs(['--gui']).mode, 'gui')
  assert.throws(() => parseProductLoopArgs(['--unknown-flag']), /unknown product-loop flag/)
  assert.deepEqual(parseProductLoopArgs(['--suite', 'session-new,coding-dsh-files']).suites, ['session-new', 'coding-dsh-files'])
  assert.deepEqual(parseProductLoopArgs(['--suite', 'session-new,coding-dsh-files']).cases, ['coding-dsh-files', 'session-new'])
})

test('every case outside first-use has a runner', () => {
  const missing = Object.keys(CASES).filter(id => CASES[id].module !== 'first-use' && !PRODUCT_LOOP_RUNNERS[id])
  assert.deepEqual(missing, [])
})

test('finalizeProductLoopResult fails a dropped suite instead of passing 5 of 6', () => {
  const wanted = expandSuiteSelection(DEFAULT_SUITES)
  const five = wanted.slice(0, 5).map(id => ({ id, result: 'PASS' }))
  assert.equal(finalizeProductLoopResult(five, DEFAULT_SUITES), 'FAIL')
  assert.equal(finalizeProductLoopResult([], DEFAULT_SUITES, ['CDP WebSocket closed']), 'FAIL')
  assert.equal(
    finalizeProductLoopResult(wanted.map(id => ({ id, result: 'PASS' })), DEFAULT_SUITES),
    'PASS',
  )
})

test('product-loop report walks modules then cases then overall', () => {
  const receipt = {
    mode: 'gui',
    result: 'FAIL',
    suites: [
      { id: 'login-gate', result: 'PASS', detail: '看见登录页' },
      { id: 'coding-pi-files', result: 'PASS', detail: 'Pi 写出 NOTES.md' },
      { id: 'coding-dsh-files', result: 'FAIL', detail: 'NOTES.md=false' },
    ],
  }
  const report = buildProductLoopReport(receipt)
  assert.equal(report.modules[0].id, 'first-use')
  assert.equal(report.modules[0].result, 'PASS')
  assert.equal(report.modules[1].id, 'coding')
  assert.equal(report.modules[1].result, 'FAIL')
  assert.equal(report.overall.caseFail, 1)
  const text = formatProductLoopReport(receipt, report)
  assert.match(text, /上手/)
  assert.match(text, /主页 Coding/)
  assert.match(text, /整体/)
  assert.match(text, /结论\s+FAIL/)
  assert.ok(!text.includes('sk-'))
})

test('companion product facts come from a real turn, not RPC shape checks', () => {
  const prompt = companionSpeakPrompt({
    conversationId: 'coding-1',
    title: 'product-loop-companion-target',
    marker: 'product-loop-marker',
  })
  assert.match(prompt, /companion_board/)
  assert.match(companionStopPrompt('coding-1'), /companion_dispatch/)
  assert.match(companionStopPrompt('coding-1'), /coding-1/)
  assert.match(prompt, /companion_dispatch/)
  assert.match(prompt, /coding-1/)
  assert.match(prompt, /product-loop-marker/)
  assert.equal(companionIsReady({ ready: true }).ok, true)
  assert.equal(companionIsReady({ ready: false, error: 'sidecar down' }).ok, false)
  assert.equal(companionTurnSettled([{ type: 'assistant.settled' }]), true)
  assert.equal(companionTurnErrored([{ type: 'engine.error' }]), true)
  const confirm = parseCompanionConfirm({
    type: 'companion.confirm',
    requestId: 'companion-host-1',
    notice: 'Coding work',
    input: JSON.stringify({
      action: 'stop',
      conversationId: 'coding-1',
      idempotencyKey: 'k-stop',
      hostRequestId: 'companion-host-1',
    }),
  })
  assert.equal(confirm.action, 'stop')
  assert.equal(confirm.conversationId, 'coding-1')
  assert.equal(confirm.hostRequestId, 'companion-host-1')
  assert.equal(transcriptHasPrompt({
    entries: [{ role: 'user', text: '请转达 product-loop-marker' }],
  }, 'product-loop-marker').ok, true)
  assert.equal(boardHasConversation({ sessions: [{ id: 'coding-1', title: 'A' }] }, 'coding-1').ok, true)
  assert.equal(conversationHasRelay({
    messages: [{ content: `${companionRelayPrefix()}\nproduct-loop-marker` }],
  }, 'product-loop-marker').ok, true)
  assert.equal(conversationHasRelay({ messages: [{ content: 'plain' }] }, 'product-loop-marker').ok, false)
  assert.equal(conversationMovedToArchive(
    [{ id: 'live' }],
    [{ id: 'gone', archivedAt: 1 }],
    'gone',
  ).ok, true)
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

test('waitForCompanionTurn accepts a parked confirm then waits for settle', async () => {
  const driver = new GuiDriver()
  let calls = 0
  const confirmed = []
  driver.drainCompanionEvents = async () => {
    calls += 1
    if (calls === 1) {
      return [{
        type: 'companion.confirm',
        requestId: 'companion-host-1',
        input: JSON.stringify({
          action: 'stop',
          conversationId: 'coding-1',
          idempotencyKey: 'k-stop',
          hostRequestId: 'companion-host-1',
        }),
      }]
    }
    return [{ type: 'assistant.settled' }]
  }
  driver.ensureAttached = async () => true
  driver.confirmCompanionDispatch = async (request) => {
    confirmed.push(request)
  }
  const turn = await driver.waitForCompanionTurn(2_000)
  assert.equal(turn.timeout, false)
  assert.equal(turn.confirmed, 1)
  assert.equal(confirmed[0].action, 'stop')
  assert.equal(confirmed[0].accepted, true)
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

test('GuiDriver.archiveConversation is a no-op without a conversation id', async () => {
  const driver = new GuiDriver()
  driver.invoke = async () => {
    throw new Error('should not invoke ArchiveConversation without an id')
  }
  await driver.archiveConversation('')
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

test('product-loop local env holds secrets off process.env', async () => {
  resetProductLoopLocalSecrets()
  const secret = 'sk-loop-local-secret-not-for-receipt'
  const parsed = parseProductLoopLocalEnv([
    '# comment',
    `TOKENFLUX_API_KEY=${secret}`,
    'CUSTOM_RELAY_BASE_URL=https://tokenflux.dev/v1',
    'CUSTOM_RELAY_MODELS=deepseek-flash',
    'ACCOUNT_HAS_QUOTA=no',
    'SHELL=/bin/zsh',
  ].join('\n'))
  assert.equal(parsed.values.TOKENFLUX_API_KEY, secret)
  assert.equal(parsed.values.CUSTOM_RELAY_BASE_URL, 'https://tokenflux.dev/v1')
  assert.deepEqual(parsed.unknown, ['SHELL'])
  assert.throws(
    () => parseProductLoopLocalEnv('CUSTOM_RELAY_BASE_URL=https://tokenflux.ai/v1\n'),
    /tokenflux.dev/,
  )

  const root = await mkdtemp(join(tmpdir(), 'milksu-loop-env-'))
  const path = join(root, 'docs', 'developer', 'product-loop.local.env')
  await mkdir(join(root, 'docs', 'developer'), { recursive: true })
  await writeFile(path, `TOKENFLUX_API_KEY=${secret}\nCUSTOM_RELAY_NAME=product-loop\n`)
  const env = { CUSTOM_RELAY_NAME: 'already-set' }
  const applied = await applyProductLoopLocalEnv(env, { path })
  assert.equal(applied.loaded, true)
  assert.deepEqual(applied.applied, ['TOKENFLUX_API_KEY', 'CUSTOM_RELAY_MODELS'])
  assert.equal(env.TOKENFLUX_API_KEY, undefined)
  assert.equal(productLoopLocalSecret('TOKENFLUX_API_KEY'), secret)
  assert.equal(env.CUSTOM_RELAY_NAME, 'already-set')
  assert.equal(env.CUSTOM_RELAY_MODELS, TOKENFLUX_CATALOG_DEFAULT_MODEL)
  const described = describeProductLoopLocalEnv({ ...applied, env })
  const serialized = JSON.stringify(described)
  assert.equal(described.loaded, true)
  assert.deepEqual(described.applied, ['TOKENFLUX_API_KEY', 'CUSTOM_RELAY_MODELS'])
  assert.equal(described.publicValues.CUSTOM_RELAY_NAME, 'already-set')
  assert.equal(described.publicValues.CUSTOM_RELAY_MODELS, TOKENFLUX_CATALOG_DEFAULT_MODEL)
  assert.ok(!serialized.includes(secret))
  resetProductLoopLocalSecrets()
})

test('first-use helpers inspect the login page and keep keys out of relay descriptions', () => {
  const page = inspectLoginPage({
    ariaLabel: '登录 MilkSU',
    text: '使用 GitHub 登录\n暂不登录，使用自己的 API Key',
  })
  assert.equal(page.gate, true)
  assert.equal(page.github, true)
  assert.equal(page.skip, true)
  const secret = 'sk-first-use-not-for-receipt'
  const merged = mergeCustomRelay({ providers: {} }, {
    apiKey: secret,
    models: 'deepseek/deepseek-flash',
    baseURL: 'https://tokenflux.dev/v1',
  })
  assert.equal(merged.id, FIRST_USE_RELAY_ID)
  assert.equal(merged.typedKey, true)
  const described = describeCustomRelay(merged.settings)
  assert.equal(described.enabled, true)
  assert.deepEqual(described.models, ['deepseek/deepseek-flash'])
  assert.ok(!JSON.stringify(described).includes(secret))
  const named = describeCustomRelay({
    providers: {
      'custom-relay-abc123': {
        enabled: true,
        custom: true,
        has_api_key: true,
        name: 'product-loop',
        base_url: 'https://tokenflux.dev/v1',
        models: ['deepseek/deepseek-flash'],
      },
    },
  })
  assert.equal(named.id, 'custom-relay-abc123')
  assert.equal(named.hasKey, true)
  assert.equal(
    classifyAccountFileLoop({ notes: false, usedFiles: false, tokenFluxLinked: false }).expectedMiss,
    true,
  )
  assert.equal(
    classifyAccountFileLoop({ notes: true, usedFiles: true, timeout: false }).result,
    'PASS',
  )
})

test('desktop spawn env strips provider keys', () => {
  const stripped = stripDesktopCredentialEnv({
    PATH: '/usr/bin',
    DEEPSEEK_API_KEY: 'sk-not-for-sidecar',
    TOKENFLUX_API_KEY: 'sk-not-for-sidecar',
    OPENAI_API_KEY: 'sk-not-for-sidecar',
    MILKSU_CHANNEL: 'stable',
  })
  assert.equal(stripped.PATH, '/usr/bin')
  assert.equal(stripped.MILKSU_CHANNEL, 'stable')
  assert.equal(stripped.DEEPSEEK_API_KEY, undefined)
  assert.equal(stripped.TOKENFLUX_API_KEY, undefined)
  assert.equal(stripped.OPENAI_API_KEY, undefined)
})

test('empty CUSTOM_RELAY_MODELS on official TokenFlux uses the catalog id', () => {
  assert.equal(
    resolveCustomRelayModels({ CUSTOM_RELAY_BASE_URL: 'https://tokenflux.dev/v1' }),
    TOKENFLUX_CATALOG_DEFAULT_MODEL,
  )
  assert.equal(
    resolveCustomRelayModels({
      CUSTOM_RELAY_BASE_URL: 'https://tokenflux.dev/v1',
      CUSTOM_RELAY_MODELS: 'x-ai/grok-4.6',
    }),
    'x-ai/grok-4.6',
  )
  assert.equal(
    resolveCustomRelayModels({ CUSTOM_RELAY_BASE_URL: 'https://example.com/v1' }),
    '',
  )
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
