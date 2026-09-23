import assert from 'node:assert/strict'
import test from 'node:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { CdpSession, classifyTurnEvents, eventSessionId, eventToolName, eventTypeOf, GuiDriver, isCompanionChatSurface, isCompanionPetSurface, isCompanionSurface, isMainProductSurface, isMilkSUPage, isProductLoopFixtureConversation, killProcessGroup, resolveProductLoopLaunchPlan, stripDesktopCredentialEnv } from './lib/desktop-gui-driver.mjs'
import {
  classifyMilkSUHostCommand,
  describeExclusiveWindows,
  mergeKeepPids,
  parsePsTable,
  selectForeignMilkSUHosts,
} from './lib/product-loop-windows.mjs'
import {
  observedIsolatedBrowserMarker,
  pickComputerUseTarget,
  usedComputerUseTools,
  usedIsolatedBrowserTools,
} from './lib/product-loop-desktop-surface.mjs'
import { classifyComputerUseUnavailable } from './lib/product-loop-desktop-run.mjs'
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
import { buildProductLoopReport, evidenceSurfacesForCase, formatFormalProductLoopReport, formatProductLoopReport, normalizeScreenshot } from './lib/product-loop-report.mjs'
import {
  SURFACE_ALLOW,
  SURFACE_SCAN_PREFIX,
  applySurfaceScan,
  isSurfaceLeakText,
  scanProductLoopSurface,
  scanProductLoopSurfaces,
  surfaceAllowKinds,
} from './lib/product-loop-surface-scan.mjs'
import { isNewConversationCanvas, turnBroken } from './lib/product-loop-session.mjs'
import {
  applyProductLoopLocalEnv,
  describeProductLoopLocalEnv,
  parseProductLoopLocalEnv,
  productLoopLocalSecret,
  productLoopRelayAttempts,
  resetProductLoopLocalSecrets,
  resolveCustomRelayModels,
  DEEPSEEK_OFFICIAL_BASE_URL,
  DEEPSEEK_OFFICIAL_MODEL,
  TOKENFLUX_CATALOG_DEFAULT_MODEL,
} from './lib/product-loop-local-env.mjs'
import {
  classifyAccountFileLoop,
  classifyCustomRelaySave,
  describeCustomRelay,
  FIRST_USE_RELAY_ID,
  firstUseHasCredentialPath,
  firstUseModuleResult,
  firstUseSessionHandoff,
  firstUseSourcesReady,
  inspectLoginPage,
  mergeCustomRelay,
} from './lib/product-loop-first-use.mjs'
import {
  boardHasConversation,
  companionFuzzAppPrompts,
  companionFuzzDispatchPrompts,
  companionIsReady,
  companionSurfaceMissingKey,
  companionRelayPrefix,
  companionTranscriptClean,
  companionDefaultSkinVisible,
  companionImportedSkinVisible,
  companionPetSurfaceUsesCustomSkin,
  companionSkinEntryVisible,
  companionSkinFramesAreCustom,
  companionSkinListed,
  companionFloatReady,
  companionParked,
  companionPetSurfaceReady,
  companionPresenceKept,
  companionShellHidden,
  companionDispatchSpeakCalled,
  companionSpeakPrompt,
  companionStopPrompt,
  companionContinueBlocked,
  companionHostToolError,
  companionTurnErrored,
  companionTurnParked,
  companionTurnSettled,
  conversationHasCompanionRelay,
  conversationHasRelay,
  conversationMovedToArchive,
  parseCompanionConfirm,
  transcriptHasAssistantReply,
  transcriptHasVisibleAssistantOutcome,
  transcriptHasPrompt,
} from './lib/product-loop-companion.mjs'
import {
  buildDshPromptBlocks,
  companionMemoryPreferencePrompt,
  companionSystemPrompt,
  createMemoryExtractController,
  cveLearningNote,
  domainMemoryFileKind,
  judgeCompanionMemoryForgotten,
  judgeCompanionMemoryWrite,
  judgeExtractOptions,
  judgeIdleMinutesLabel,
  judgeLearningRound,
  judgeMemorySearchRow,
  memoryExtractInstructions,
  memorySectionPrecedesPrivacy,
  memoryTranscriptAnomaly,
  memoryTurnIgnored,
  normalizeMemoryExtract,
  normalizeMemoryExtractIdleMinutes,
  parseMemoryExtractResult,
  PRODUCT_LOOP_CVE_ID,
  userPromptCarriesMemoryBlock,
  withUserMemoryMessages,
} from './lib/product-loop-memory.mjs'
import {
  assistantTextAfterPrompt,
  companionCoreFactInSnippet,
  companionCoreLiveSteps,
  companionCorePromptsExposeTools,
  companionCoreRequiredFacts,
  companionCoreSeedConversations,
  COMPANION_CORE_MINSIZE_ID,
  COMPANION_CORE_PRINT_ID,
  companionGenerationStarted,
  companionPromptHasReply,
  companionToolsStillOpen,
  judgeCompanionCoreReply,
  nextCompanionReplyDeadline,
  transcriptCancelledAfter,
} from './lib/product-loop-companion-core.mjs'

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
  assert.equal(MODULES.coding.cases.length, 34)
  assert.equal(MODULES.companion.cases.length, 23)
  assert.equal(MODULES.workspaces.cases.length, 34)
  assert.equal(CASES['companion-memory'].needsCredential, true)
  assert.equal(CASES['companion-memory-settings'].needsCredential, false)
  assert.equal(CASES['coding-user-memory'].needsCredential, true)
  assert.equal(CASES['workspace-cve-learning'].needsCredential, false)
  assert.equal(typeof PRODUCT_LOOP_RUNNERS['coding-user-memory'], 'function')
  assert.equal(typeof PRODUCT_LOOP_RUNNERS['companion-memory-settings'], 'function')
  assert.equal(typeof PRODUCT_LOOP_RUNNERS['workspace-cve-learning'], 'function')
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

test('companion core seeds issue transcripts when the case starts', () => {
  const now = 1_800_000_000_000
  const seeded = companionCoreSeedConversations(now, { click: '', express: '', githubRepo: '' })
  assert.equal(seeded.length, 7)
  assert.equal(seeded.some(row => /登录闪退/.test(row.title)), false)
  assert.equal(JSON.stringify(seeded).includes('/Users/'), false)
  const facts = companionCoreRequiredFacts()
  for (const [id, needles] of Object.entries(facts)) {
    const row = seeded.find(item => item.id === id)
    assert.ok(row, id)
    for (const needle of needles) {
      assert.equal(companionCoreFactInSnippet(row, needle), true, `${id} ${needle}`)
    }
  }
  const minsize = seeded.find(row => row.id === COMPANION_CORE_MINSIZE_ID)
  const print = seeded.find(row => row.id === COMPANION_CORE_PRINT_ID)
  assert.ok(minsize.createdAt < print.createdAt)
  const steps = companionCoreLiveSteps('CORE-RELAY-test', { githubRepo: '' })
  assert.equal(companionCorePromptsExposeTools(steps), false)
  assert.equal(steps.filter(step => step.kind === 'stop').length, 3)
  assert.equal(judgeCompanionCoreReply('你好。', steps.find(step => step.id === 'hello')).ok, true)
  assert.equal(judgeCompanionCoreReply('你好。WinError 87 还开着。', steps.find(step => step.id === 'hello')).ok, false)
  const page = {
    entries: [
      { role: 'user', text: '先读 click 仓库里 src/click/_termui_impl.py' },
      { role: 'assistant', text: '这一轮已取消。' },
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '在。' },
    ],
  }
  assert.equal(transcriptCancelledAfter(page, '先读 click').ok, true)
  assert.equal(assistantTextAfterPrompt(page, '你好'), '在。')
  assert.equal(transcriptCancelledAfter({
    entries: [
      { role: 'user', text: '先读 click 仓库' },
      { role: 'assistant', text: 'Request aborted' },
    ],
  }, '先读 click').ok, false)
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

test('finalizeProductLoopResult does not treat SKIP as a complete PASS', () => {
  const wanted = ['login-gate', 'login-github-active']
  assert.equal(finalizeProductLoopResult([
    { id: 'login-gate', result: 'PASS' },
    { id: 'login-github-active', result: 'SKIP' },
  ], wanted), 'SKIP')
  assert.equal(finalizeProductLoopResult([
    { id: 'login-gate', result: 'PASS' },
    { id: 'login-github-active', result: 'FAIL' },
  ], wanted), 'FAIL')
  assert.equal(finalizeProductLoopResult([
    { id: 'login-gate', result: 'PASS' },
    { id: 'login-github-active', result: 'BLOCKED' },
  ], wanted), 'FAIL')
})

test('product-loop report does not mark a module PASS when cases SKIP', () => {
  const receipt = {
    mode: 'gui',
    result: 'SKIP',
    companionModelSource: 'personal',
    suites: [
      { id: 'companion-ready', result: 'PASS', detail: '看板娘已就绪 personal', source: 'personal' },
      { id: 'companion-pet-drag', result: 'SKIP', detail: 'Wayland 不能自己贴坐标' },
    ],
  }
  const report = buildProductLoopReport(receipt)
  const companion = report.modules.find(item => item.id === 'companion')
  assert.equal(companion.result, 'SKIP')
  assert.equal(report.overall.result, 'SKIP')
  assert.equal(report.overall.companionModelSource, 'personal')
  const text = formatProductLoopReport(receipt, report)
  assert.match(text, /看板娘来源\s+personal/)
  assert.match(text, /结论\s+SKIP/)
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
  const html = formatFormalProductLoopReport({
    ...receipt,
    suites: receipt.suites.map(item => (
      item.id === 'login-gate'
        ? { ...item, screenshots: [{ src: 'shots/login-gate.png', label: '主窗口', caption: '使用 GitHub 登录' }] }
        : item
    )),
  }, report)
  assert.match(html, /正式报告/)
  assert.match(html, /login-gate/)
  assert.match(html, /shots\/login-gate.png/)
  assert.match(html, /主窗口/)
  assert.match(html, /这一项没有截到产品窗口/)
  assert.ok(!html.includes('sk-'))
})

test('formal evidence only attaches the window that case actually used', () => {
  assert.deepEqual(evidenceSurfacesForCase('coding-pi-files'), ['main'])
  assert.deepEqual(evidenceSurfacesForCase('login-gate'), ['main'])
  assert.deepEqual(evidenceSurfacesForCase('workspace-ctf-list'), ['main'])
  assert.deepEqual(evidenceSurfacesForCase('companion-page'), ['companion'])
  assert.deepEqual(evidenceSurfacesForCase('companion-settings-model'), ['main'])
  assert.deepEqual(evidenceSurfacesForCase('companion-hide'), ['main', 'companion'])
  assert.deepEqual(normalizeScreenshot('shots/login-gate.png'), {
    src: 'shots/login-gate.png',
    label: '',
    caption: '',
  })
})

test('new conversation canvas accepts the project-scoped title', () => {
  assert.equal(isNewConversationCanvas({ text: '我们要构建什么' }), true)
  assert.equal(isNewConversationCanvas({ text: '我们在 product-loop-cite 中构建什么' }), true)
  assert.equal(isNewConversationCanvas({ text: 'What should we build in cite' }), true)
  assert.equal(isNewConversationCanvas({ text: '主页' }), false)
})

test('companion product facts come from a real turn, not RPC shape checks', () => {
  const prompt = companionSpeakPrompt({
    conversationId: 'coding-1',
    title: 'product-loop-companion-target',
  })
  assert.match(prompt, /companion_board/)
  assert.match(companionStopPrompt('coding-1'), /companion_dispatch/)
  assert.match(companionStopPrompt('coding-1'), /coding-1/)
  assert.match(companionStopPrompt('coding-1'), /立刻/)
  assert.match(companionStopPrompt('coding-1'), /不要在对话里问用户确认/)
  assert.match(prompt, /companion_dispatch/)
  assert.match(prompt, /action 用 speak/)
  assert.match(prompt, /coding-1/)
  assert.doesNotMatch(prompt, /必须原样包含/)
  assert.equal(companionDispatchSpeakCalled([{
    type: 'tool.started',
    toolName: 'companion_dispatch',
    text: 'companion_dispatch speak',
  }]), true)
  assert.equal(companionDispatchSpeakCalled([{
    type: 'tool.started',
    toolName: 'companion_dispatch',
    text: 'companion_dispatch speak_many',
  }]), false)
  assert.equal(companionDispatchSpeakCalled([{
    type: 'tool.started',
    toolName: 'companion_dispatch',
    text: 'companion_dispatch stop',
  }]), false)
  assert.equal(companionDispatchSpeakCalled([{
    type: 'assistant.settled',
    text: 'I called companion_dispatch speak',
  }]), false)
  const fuzz = companionFuzzDispatchPrompts({ title: 't', marker: 'm1' })
  assert.equal(fuzz.length >= 2, true)
  assert.equal(fuzz.every(text => !/companion_dispatch|companion_board|companion_app/.test(text)), true)
  assert.equal(companionFuzzAppPrompts().every(text => !/companion_dispatch|companion_app/.test(text)), true)
  assert.equal(companionIsReady({ ready: true }).ok, true)
  assert.equal(companionIsReady({ ready: false, error: 'sidecar down' }).ok, false)
  assert.equal(companionSurfaceMissingKey({ text: 'No API key for tokenflux/deepseek/deepseek-flash' }), true)
  assert.equal(companionSurfaceMissingKey({ text: '看板娘已就绪' }), false)
  assert.equal(companionTurnSettled([{ type: 'assistant.settled' }]), true)
  assert.equal(companionTurnErrored([{ type: 'engine.error' }]), true)
  assert.equal(companionHostToolError('companion host request timed out (board)'), true)
  assert.equal(companionTurnErrored([{
    type: 'engine.error',
    error: 'companion host request timed out (board)',
  }]), true)
  assert.equal(companionTurnErrored([{
    type: 'engine.error',
    error: 'companion host request timed out (dispatch)',
  }], { hostTimeoutIsError: false }), false)
  assert.equal(companionTurnParked([{ type: 'engine.sidecar_stopped' }]), true)
  assert.equal(companionTurnParked([{ type: 'assistant.settled' }]), false)
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
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', text: '' }],
  }).ok, false)
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', text: 'message' }],
  }).ok, false)
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', error: '403: group does not support the requested model' }],
  }).ok, false)
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', text: '收到，看板里有 3 条会话。' }],
  }).ok, true)
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', text: 'Request aborted' }],
  }).ok, false)
  assert.equal(transcriptHasAssistantReply({
    entries: [{ role: 'assistant', type: 'message', text: '{"companion_float_enabled":true}' }],
  }).ok, false)
  assert.equal(transcriptHasVisibleAssistantOutcome({
    entries: [{ role: 'assistant', type: 'message', error: 'Request aborted' }],
  }).ok, true)
  assert.equal(transcriptHasVisibleAssistantOutcome({
    entries: [{ role: 'assistant', type: 'message', text: '' }],
  }).ok, false)
  assert.equal(boardHasConversation({ sessions: [{ id: 'coding-1', title: 'A' }] }, 'coding-1').ok, true)
  assert.equal(conversationHasCompanionRelay({
    messages: [{ content: `${companionRelayPrefix()}\nany task text` }],
  }).ok, true)
  assert.equal(conversationHasCompanionRelay({ messages: [{ content: 'plain' }] }).ok, false)
  assert.equal(conversationHasRelay({
    messages: [{ content: `${companionRelayPrefix()}\nproduct-loop-marker` }],
  }, 'product-loop-marker').ok, true)
  assert.equal(conversationHasRelay({
    messages: [{ content: `${companionRelayPrefix()}\nparaphrased task` }],
  }, 'product-loop-marker').ok, false)
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
  assert.equal(usedIsolatedBrowserTools(['milksu_workspace']), true)
  assert.equal(usedIsolatedBrowserTools(['write']), false)
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
  assert.equal(isCompanionSurface({ url: 'milksu://app/index.html?surface=companion' }), true)
  assert.equal(isCompanionPetSurface({ url: 'milksu://app/index.html?surface=companion' }), true)
  assert.equal(isCompanionChatSurface({ url: 'milksu://app/index.html?surface=companion' }), true)
  assert.equal(isCompanionChatSurface({ url: 'milksu://app/index.html?surface=companion-chat' }), true)
  assert.equal(isCompanionPetSurface({ url: 'milksu://app/index.html?surface=companion-chat' }), false)
  assert.equal(isMilkSUPage({ title: '', url: 'http://localhost:5173/index.html?surface=companion' }), true)
  assert.equal(isMainProductSurface({ title: 'MilkSU', url: 'milksu://app' }), true)
  assert.equal(isMainProductSurface({ title: '', url: 'http://localhost:5173/index.html?surface=companion' }), false)
  assert.equal(isMainProductSurface({ title: '', url: 'milksu://app/index.html?surface=companion-chat' }), false)
})

test('companion shell observations cover hide, default skin, and dock presence', () => {
  assert.equal(companionShellHidden({ hidden: true }), true)
  assert.equal(companionFloatReady({ wayland: true }).ok, true)
  assert.equal(companionFloatReady({ floating: true, hidden: false }).ok, true)
  assert.equal(companionFloatReady({ floating: false, hidden: true }).ok, false)
  assert.equal(companionParked({ parked: true }), true)
  assert.equal(companionPresenceKept({ parked: true, platform: 'darwin' }).ok, true)
  assert.equal(companionPresenceKept({ parked: true, platform: 'win32' }).reason, '任务栏还在')
  assert.equal(companionPresenceKept({ parked: true, platform: 'linux', tray: true }).ok, true)
  assert.equal(companionPresenceKept({ parked: true, platform: 'linux', tray: false }).ok, false)
  assert.equal(companionDefaultSkinVisible({ text: '皮肤\nMilk', aria: [] }), true)
  assert.equal(companionSkinEntryVisible({ text: '添加皮肤\n选择文件夹', aria: [] }), true)
  assert.equal(companionImportedSkinVisible({ text: '回路皮肤', aria: [] }, '回路皮肤'), true)
  assert.equal(companionSkinListed({ skins: [{ id: 'imported:loop.skin' }] }, 'imported:loop.skin'), true)
  assert.equal(companionSkinFramesAreCustom({ frames: { idle: 'data:image/png;base64,xx' } }).ok, true)
  assert.equal(companionPetSurfaceReady({ motion: 'companion-pet companion-pet-idle', src: '/assets/idle.png' }).ok, true)
  assert.equal(companionPetSurfaceUsesCustomSkin({ motion: 'companion-pet companion-pet-idle', src: 'data:image/png;base64,xx' }).ok, true)
  assert.equal(companionPetSurfaceReady({ motion: '', src: '' }).ok, false)
})

test('exclusive window classification keeps only MilkSU hosts', () => {
  const repo = '/repo/milksu'
  assert.equal(classifyMilkSUHostCommand('/Applications/Cursor.app/Contents/MacOS/Cursor', repo), 'cursor')
  assert.equal(classifyMilkSUHostCommand('/Applications/MilkSU Beta.app/Contents/MacOS/MilkSU Beta', repo), 'beta')
  assert.equal(classifyMilkSUHostCommand('/Applications/MilkSU.app/Contents/Frameworks/MilkSU Helper.app/Contents/MacOS/MilkSU Helper', repo), 'helper')
  assert.equal(classifyMilkSUHostCommand('/Applications/MilkSU.app/Contents/MacOS/MilkSU', repo), 'packaged-stable')
  assert.equal(
    classifyMilkSUHostCommand(`${repo}/build/bin/MilkSU.app/Contents/MacOS/MilkSU`, repo),
    'packaged-repo',
  )
  assert.equal(
    classifyMilkSUHostCommand(`${repo}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ${repo}/desktop`, repo),
    'unpackaged-repo',
  )
  const rows = parsePsTable([
    '11 1 /Applications/Cursor.app/Contents/MacOS/Cursor',
    '22 1 /Applications/MilkSU.app/Contents/MacOS/MilkSU',
    '33 1 /Applications/MilkSU Beta.app/Contents/MacOS/MilkSU Beta',
    `44 9 ${repo}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ${repo}/desktop`,
    `66 1 ${repo}/build/bin/MilkSU.app/Contents/MacOS/MilkSU`,
    '55 44 /Applications/Calculator.app/Contents/MacOS/Calculator',
  ].join('\n'))
  const foreign = selectForeignMilkSUHosts(rows, { repoRoot: repo, keepPids: new Set([44]) })
  assert.deepEqual(foreign.map(row => row.pid), [66])
  const helperRows = parsePsTable([
    '11 1 /Applications/Cursor.app/Contents/MacOS/Cursor',
    '22 1 /Applications/MilkSU.app/Contents/MacOS/MilkSU',
    `90 1 /usr/bin/npm run desktop:start`,
    `44 90 ${repo}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ${repo}/desktop`,
    `46 44 ${repo}/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper`,
  ].join('\n'))
  const keptByHelperPort = mergeKeepPids(new Set(), new Set([46]), helperRows, repo)
  assert.equal(keptByHelperPort.has(46), true)
  assert.equal(keptByHelperPort.has(44), true)
  assert.equal(keptByHelperPort.has(90), true)
  assert.equal(selectForeignMilkSUHosts(helperRows, { repoRoot: repo, keepPids: keptByHelperPort }).map(row => row.pid).join(','), '')
  const keptByPort = mergeKeepPids(new Set([9]), new Set([44]), rows)
  assert.equal(keptByPort.has(44), true)
  assert.equal(keptByPort.has(9), true)
  const stillForeign = selectForeignMilkSUHosts(rows, { repoRoot: repo, keepPids: keptByPort })
  assert.deepEqual(stillForeign.map(row => row.pid), [66])
  assert.equal(describeExclusiveWindows({ closed: 2, remaining: 1, closedKinds: ['日常安装包', '残留 Electron'] }), '窗口关掉 2 扇（日常安装包、残留 Electron），只留测试窗')
  assert.equal(describeExclusiveWindows({ closed: 0, remaining: 1 }), '窗口只留测试窗')
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

test('waitForCompanionTurn can reject a parked confirm', async () => {
  const driver = new GuiDriver()
  let calls = 0
  const decisions = []
  driver.drainCompanionEvents = async () => {
    calls += 1
    if (calls === 1) {
      return [{
        type: 'companion.confirm',
        requestId: 'companion-host-2',
        input: JSON.stringify({
          action: 'stop',
          conversationId: 'coding-2',
          idempotencyKey: 'k-stop-2',
          hostRequestId: 'companion-host-2',
        }),
      }]
    }
    return [{ type: 'assistant.settled' }]
  }
  driver.ensureAttached = async () => true
  driver.getCompanionStatus = async () => ({})
  driver.confirmCompanionDispatch = async (request) => {
    decisions.push(request)
  }
  const turn = await driver.waitForCompanionTurn(2_000, { rejectConfirm: true })
  assert.equal(turn.timeout, false)
  assert.equal(turn.rejected, 1)
  assert.equal(decisions[0].accepted, false)
})

test('companionTranscriptClean rejects leaked host ids and object Object', () => {
  assert.equal(companionTranscriptClean({
    entries: [{ text: 'hello', error: '' }],
  }).ok, true)
  assert.equal(companionTranscriptClean({
    entries: [{ text: 'see [object Object]' }],
  }).ok, false)
  assert.equal(companionTranscriptClean({
    entries: [{ error: 'unknown companion host request: companion-host-9' }],
  }).ok, false)
  assert.equal(companionTranscriptClean({
    entries: [{ text: '{"companion_float_enabled":true,"relay":{"url":"https://tokenflux.dev/v1"}}' }],
  }).ok, false)
  assert.equal(companionTranscriptClean({
    entries: [{ text: 'Request aborted' }],
  }).ok, false)
  assert.equal(companionTranscriptClean({
    entries: [{ text: '读一下不含密钥的设置摘要' }],
  }).ok, true)
})

test('waitForTurn keeps polling after a transient CDP close', async () => {
  const driver = new GuiDriver()
  let calls = 0
  driver.drainEvents = async () => {
    calls += 1
    if (calls === 1) throw new Error('CDP WebSocket closed')
    return [{ type: 'assistant.settled', sessionId: 'conversation-1' }]
  }
  driver.ensureAttached = async () => true
  const turn = await driver.waitForTurn('conversation-1', 2_000)
  assert.equal(turn.timeout, false)
  assert.equal(turn.failed, false)
  assert.ok(calls >= 2)
})

test('waitForTurn ignores leftover settle without this session id', async () => {
  const driver = new GuiDriver()
  driver.drainEvents = async () => [{ type: 'assistant.settled' }, { type: 'assistant.settled', sessionId: 'other' }]
  driver.ensureAttached = async () => true
  const turn = await driver.waitForTurn('conversation-1', 400)
  assert.equal(turn.timeout, true)
})

test('waitForTurn treats the active sidecar stopping as a failed turn, not a settle', async () => {
  const driver = new GuiDriver()
  driver.drainEvents = async () => [{ type: 'engine.stopped', error: 'sidecar exited' }]
  driver.ensureAttached = async () => true
  const turn = await driver.waitForTurn('conversation-1', 2_000)
  assert.equal(turn.timeout, false)
  assert.equal(turn.failed, true)
  assert.match(String(turn.error || ''), /sidecar exited/)
  assert.equal(classifyTurnEvents([{ type: 'assistant.settled' }]).settled, true)
  assert.equal(classifyTurnEvents([{ payload: { type: 'assistant.settled' } }]).settled, true)
  assert.equal(eventSessionId({ sessionId: 'a' }), 'a')
  assert.equal(eventSessionId({ payload: { sessionId: 'b' } }), 'b')
  assert.equal(eventTypeOf({ payload: { type: 'tool.started' } }), 'tool.started')
  assert.equal(eventToolName({ payload: { toolName: 'milksu_workspace' } }), 'milksu_workspace')
  assert.equal(classifyTurnEvents([{ type: 'engine.error' }]).failed, true)
  assert.equal(classifyTurnEvents([{
    type: 'engine.error',
    error: 'companion host request timed out (dispatch)',
  }]).failed, false)
  assert.equal(classifyTurnEvents([{
    type: 'engine.error',
    error: 'Request aborted',
  }]).failed, false)
  assert.equal(classifyTurnEvents([{
    type: 'engine.error',
    error: 'companion host request timed out (dispatch)',
  }]).hostTimedOut, true)
  assert.equal(classifyTurnEvents([
    { type: 'engine.error', error: 'companion host request timed out (board)' },
    { type: 'engine.error', error: 'Connection error.' },
  ]).failed, true)
  assert.equal(classifyTurnEvents([{ type: 'engine.sidecar_stopped', error: 'parked sidecar reaped' }]).failed, false)
  assert.equal(classifyTurnEvents([{ type: 'engine.sidecar_stopped', error: 'parked sidecar reaped' }]).sidecarStopped, true)
})

test('waitForTurn treats sidecar_stopped as a parked stop, not a timeout', async () => {
  const driver = new GuiDriver()
  driver.drainEvents = async () => [{ type: 'engine.sidecar_stopped', error: 'parked sidecar reaped' }]
  driver.ensureAttached = async () => true
  const turn = await driver.waitForTurn('conversation-1', 2_000)
  assert.equal(turn.timeout, false)
  assert.equal(turn.failed, false)
  assert.equal(turn.sidecarStopped, true)
  assert.equal(turnBroken(turn), '')
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
  const accountMiss = classifyAccountFileLoop({ notes: false, usedFiles: false, tokenFluxLinked: false })
  assert.equal(accountMiss.expectedMiss, true)
  assert.equal(accountMiss.result, 'SKIP')
  assert.notEqual(accountMiss.result, 'PASS')
  assert.equal(
    classifyAccountFileLoop({ notes: true, usedFiles: true, timeout: false }).result,
    'PASS',
  )
  assert.equal(
    classifyAccountFileLoop({ notes: false, usedFiles: false, failed: true, tokenFluxLinked: false }).result,
    'FAIL',
  )
  assert.equal(
    classifyAccountFileLoop({ notes: false, usedFiles: false, tokenFluxLinked: true, detail: '401 invalid key' }).result,
    'FAIL',
  )
  assert.equal(classifyCustomRelaySave('DEEPSEEK_API_KEY 模型凭据无效或无权访问。').result, 'FAIL')
  const noKey = classifyCustomRelaySave('没有已存中转站，也没有 TOKENFLUX_API_KEY / DEEPSEEK_API_KEY')
  assert.equal(noKey.expectedMiss, true)
  assert.equal(noKey.result, 'FAIL')
  assert.notEqual(noKey.result, 'PASS')
  assert.equal(classifyCustomRelaySave('打不开设置').result, 'FAIL')
  assert.equal(classifyComputerUseUnavailable({ available: false, problem: '打包的 Cua Driver 不可用。' }).expectedMiss, true)
  assert.equal(classifyComputerUseUnavailable({ available: false, authorized: false, problem: '缺辅助功能' }).result, 'FAIL')
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

test('relay attempts prefer official DeepSeek before a dead TokenFlux key', async () => {
  resetProductLoopLocalSecrets()
  const root = await mkdtemp(join(tmpdir(), 'milksu-loop-relay-'))
  const path = join(root, 'docs', 'developer', 'product-loop.local.env')
  await mkdir(join(root, 'docs', 'developer'), { recursive: true })
  await writeFile(path, [
    'TOKENFLUX_API_KEY=sk-not-for-tokenflux',
    'DEEPSEEK_API_KEY=sk-official-deepseek',
    'CUSTOM_RELAY_BASE_URL=https://tokenflux.dev/v1',
  ].join('\n'))
  await applyProductLoopLocalEnv({}, { path })
  const attempts = productLoopRelayAttempts({ CUSTOM_RELAY_BASE_URL: 'https://tokenflux.dev/v1' })
  assert.equal(DEEPSEEK_OFFICIAL_MODEL, 'deepseek-flash')
  assert.equal(TOKENFLUX_CATALOG_DEFAULT_MODEL, 'deepseek/deepseek-flash')
  assert.notEqual(DEEPSEEK_OFFICIAL_MODEL, 'deepseek-chat')
  assert.deepEqual(attempts.map(item => ({ name: item.name, baseUrl: item.baseUrl, model: item.model })), [
    { name: 'DEEPSEEK_API_KEY', baseUrl: DEEPSEEK_OFFICIAL_BASE_URL, model: 'deepseek-flash' },
    { name: 'TOKENFLUX_API_KEY', baseUrl: 'https://tokenflux.dev/v1', model: 'deepseek/deepseek-flash' },
  ])
  assert.ok(!JSON.stringify(attempts.map(item => ({ name: item.name, baseUrl: item.baseUrl, model: item.model }))).includes('sk-'))
  resetProductLoopLocalSecrets()
})

test('first-use cannot PASS on login-gate and login-skip-local alone', () => {
  const gateOnly = [
    { id: 'login-gate', result: 'PASS' },
    { id: 'login-skip-local', result: 'PASS' },
  ]
  assert.equal(firstUseHasCredentialPath(gateOnly), false)
  assert.equal(firstUseSourcesReady(gateOnly), false)
  assert.equal(firstUseModuleResult(gateOnly), 'FAIL')
  const expectedMiss = [
    ...gateOnly,
    { id: 'account-model-fileloop', result: 'SKIP' },
    { id: 'settings-custom-relay', result: 'FAIL' },
    { id: 'relay-model-fileloop', result: 'FAIL' },
  ]
  assert.equal(firstUseHasCredentialPath(expectedMiss), false)
  assert.equal(firstUseSourcesReady(expectedMiss), false)
  assert.equal(firstUseModuleResult(expectedMiss), 'FAIL')
  const relayOk = [
    ...gateOnly,
    { id: 'relay-model-fileloop', result: 'PASS' },
  ]
  assert.equal(firstUseHasCredentialPath(relayOk), true)
  assert.equal(firstUseSourcesReady(relayOk), true)
  assert.equal(firstUseModuleResult(relayOk), 'PASS')
  const verifiedRelayOnly = [
    ...gateOnly,
    { id: 'settings-custom-relay', result: 'PASS' },
    { id: 'relay-model-fileloop', result: 'FAIL' },
  ]
  assert.equal(firstUseHasCredentialPath(verifiedRelayOnly), false)
  assert.equal(firstUseSourcesReady(verifiedRelayOnly), true)
  assert.equal(firstUseModuleResult(verifiedRelayOnly), 'FAIL')
  const githubFailRelayOk = [
    ...gateOnly,
    { id: 'login-github-active', result: 'FAIL' },
    { id: 'relay-model-fileloop', result: 'PASS' },
  ]
  assert.equal(firstUseHasCredentialPath(githubFailRelayOk), true)
  assert.equal(firstUseModuleResult(githubFailRelayOk), 'FAIL')
  const handoff = firstUseSessionHandoff(null, 'plfu-dead-cdp', verifiedRelayOnly, true)
  assert.equal(handoff.instanceId, 'plfu-dead-cdp')
  assert.equal(handoff.sourcesReady, true)
  assert.equal(handoff.driver, null)
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

test('surface scanner fails leaks and unexpected error chrome, not expected form or confirm copy', () => {
  const packagedLaunch = resolveProductLoopLaunchPlan({
    MILKSU_APP_PATH: '/repo/milksu/build/bin/MilkSU.app',
  }, '/repo/milksu')
  assert.equal(packagedLaunch.mode, 'packaged')
  assert.equal(packagedLaunch.buildRuntime, false)
  assert.match(packagedLaunch.executable, /MilkSU\.app\/Contents\/MacOS\/MilkSU$/)
  assert.equal(resolveProductLoopLaunchPlan({}, '/repo/milksu').mode, 'desktop-start')

  assert.equal(isSurfaceLeakText('No API key for tokenflux/deepseek/deepseek-flash'), true)
  assert.equal(isSurfaceLeakText('Request aborted'), true)
  assert.equal(isSurfaceLeakText('AbortError: The operation was aborted'), true)
  assert.equal(isSurfaceLeakText('[object Object]'), true)
  assert.equal(isSurfaceLeakText('unknown companion host request: companion-host-9'), true)
  assert.equal(isSurfaceLeakText('companion session is not ready'), true)
  assert.equal(isSurfaceLeakText('当前模型没有可用的 API Key。'), false)
  assert.deepEqual(surfaceAllowKinds('login-gate'), SURFACE_ALLOW['login-gate'])

  const leak = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    text: 'No API key for tokenflux/deepseek/deepseek-flash',
    findings: [{ kind: 'companion-bubble', text: 'No API key for tokenflux/deepseek/deepseek-flash' }],
  }, { caseId: 'login-gate' })
  assert.equal(leak.fail, true)
  assert.match(leak.summary, /No API key for/)
  assert.equal(leak.hits.some(item => item.severity === 'leak' && item.kind === 'no-api-key-debug'), true)

  const mappedOnLogin = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    text: '当前模型没有可用的 API Key。',
    findings: [{ kind: 'companion-bubble', text: '当前模型没有可用的 API Key。' }],
  }, { caseId: 'login-gate' })
  assert.equal(mappedOnLogin.fail, false)

  const mappedOnCoding = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    text: '当前模型没有可用的 API Key。',
    findings: [{ kind: 'companion-bubble', text: '当前模型没有可用的 API Key。' }],
  }, { caseId: 'coding-pi-files' })
  assert.equal(mappedOnCoding.fail, true)

  const settingsDump = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    text: '{"ok":true,"settings":{"companion_float_enabled":true,"relay":{"url":"https://tokenflux.dev/v1"}}}',
    findings: [{
      kind: 'companion-error',
      text: '{"ok":true,"settings":{"companion_float_enabled":true,"relay":{"url":"https://tokenflux.dev/v1"}}}',
    }],
  }, { caseId: 'companion-page' })
  assert.equal(settingsDump.fail, true)
  assert.equal(settingsDump.hits.some(item => item.kind === 'settings-json'), true)

  const confirm = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    text: '有一条命令在等你确认',
    findings: [{ kind: 'confirm', role: 'alertdialog', text: '有一条命令在等你确认' }],
  }, { caseId: 'companion-dispatch-confirm' })
  assert.equal(confirm.fail, false)

  const leftoverConfirm = scanProductLoopSurface({
    surface: 'main',
    locale: 'zh-CN',
    findings: [{ kind: 'confirm', role: 'alertdialog', text: '有一条命令在等你确认' }],
  }, { caseId: 'coding-pi-files' })
  assert.equal(leftoverConfirm.fail, true)

  const loginForm = scanProductLoopSurface({
    surface: 'main',
    locale: 'zh-CN',
    findings: [{ kind: 'destructive', className: 'text-destructive', text: '登录没有完成' }],
  }, { caseId: 'login-github-active', result: 'FAIL' })
  assert.equal(loginForm.fail, false)

  const leftoverLoginForm = scanProductLoopSurface({
    surface: 'main',
    locale: 'zh-CN',
    findings: [{ kind: 'destructive', className: 'text-destructive', text: '登录没有完成' }],
  }, { caseId: 'login-github-active', result: 'PASS' })
  assert.equal(leftoverLoginForm.fail, true)

  const blank = scanProductLoopSurface({
    surface: 'main',
    locale: 'zh-CN',
    text: '选择项目',
    findings: [{ kind: 'destructive', text: '删除' }],
  }, { caseId: 'session-new' })
  assert.equal(blank.fail, false)

  const unlocalized = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-error', text: 'AbortError: The operation was aborted' }],
  }, { caseId: 'companion-core' })
  assert.equal(unlocalized.fail, true)

  const cancelled = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-error', text: '这一轮已取消。' }],
  }, { caseId: 'companion-core' })
  assert.equal(cancelled.fail, false)

  const cancelledRecovery = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-bubble', text: '这一轮已取消。' }],
  }, { caseId: 'companion-fuzz-recovery' })
  assert.equal(cancelledRecovery.fail, false)

  const cancelledRapid = scanProductLoopSurface({
    surface: 'companion',
    locale: 'en',
    findings: [{ kind: 'companion-error', text: 'This turn was cancelled.' }],
  }, { caseId: 'companion-core' })
  assert.equal(cancelledRapid.fail, false)

  assert.equal(companionContinueBlocked('这段对话没法继续了。'), true)
  assert.equal(companionContinueBlocked('This chat can\'t continue.'), true)
  assert.equal(
    companionContinueBlocked('product-loop-abort-continue-x 刚才中止了，请只短回一句，不要开新对话。'),
    false,
  )

  const emptyReply = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-bubble', text: '这一轮没有回复。' }],
  }, { caseId: 'companion-core' })
  assert.equal(emptyReply.fail, false)

  const sessionLeak = scanProductLoopSurface({
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-error', text: 'companion session is not ready' }],
  }, { caseId: 'login-gate' })
  assert.equal(sessionLeak.fail, true)
  assert.equal(sessionLeak.hits.some(item => item.kind === 'session-not-ready'), true)
})

test('surface scanner upgrades PASS and expectedMiss SKIP, never greenwashes a leak', () => {
  const leak = scanProductLoopSurfaces([{
    surface: 'companion',
    locale: 'zh-CN',
    findings: [{ kind: 'companion-bubble', text: 'No API key for tokenflux/deepseek/deepseek-flash' }],
  }], { caseId: 'login-gate' })
  const passed = applySurfaceScan({ id: 'login-gate', result: 'PASS', detail: '看见登录页' }, leak, { caseId: 'login-gate' })
  assert.equal(passed.result, 'FAIL')
  assert.match(passed.detail, new RegExp(SURFACE_SCAN_PREFIX))
  assert.equal(passed.anomalies.some(item => item.severity === 'leak'), true)

  const skipped = applySurfaceScan({
    id: 'account-model-fileloop',
    result: 'SKIP',
    detail: '账户没额度',
    expectedMiss: true,
  }, leak, { caseId: 'account-model-fileloop', expectedMiss: true })
  assert.equal(skipped.result, 'FAIL')
  assert.notEqual(skipped.result, 'SKIP')

  const miss = scanProductLoopSurface({
    surface: 'main',
    locale: 'zh-CN',
    text: '当前模型没有可用的 API Key。',
    findings: [{ kind: 'alert', text: '当前模型没有可用的 API Key。' }],
  }, { caseId: 'account-model-fileloop', result: 'SKIP', expectedMiss: true })
  const stillSkip = applySurfaceScan({
    id: 'account-model-fileloop',
    result: 'SKIP',
    detail: '账户没额度',
    expectedMiss: true,
  }, miss, { caseId: 'account-model-fileloop', expectedMiss: true })
  assert.equal(stillSkip.result, 'SKIP')

  const alreadyFail = applySurfaceScan({ id: 'coding-pi-files', result: 'FAIL', detail: 'NOTES.md=false' }, leak, {
    caseId: 'coding-pi-files',
  })
  assert.equal(alreadyFail.result, 'FAIL')
  assert.match(alreadyFail.detail, /NOTES.md=false/)

  const html = formatFormalProductLoopReport({
    result: 'FAIL',
    suites: [{
      id: 'login-gate',
      result: 'FAIL',
      detail: `${SURFACE_SCAN_PREFIX}No API key for tokenflux/deepseek/deepseek-flash`,
      screenshots: [{ src: 'shots/login-gate.png', label: '主窗口', caption: '表面异常' }],
      anomalies: [{ surface: 'companion', kind: 'no-api-key-debug', text: 'No API key for tokenflux/deepseek/deepseek-flash' }],
    }],
  })
  assert.match(html, /表面异常/)
  assert.match(html, /No API key for/)
  assert.ok(!html.includes('sk-'))
})

test('companion stop waits until the model has started, and a leftover settle is not this reply', () => {
  assert.equal(companionGenerationStarted([
    { type: 'user.message' },
    { type: 'assistant.thinking_started' },
    { type: 'assistant.settled', aborted: true },
  ]), false)
  assert.equal(companionGenerationStarted([{ type: 'assistant.thinking_delta', text: '先看文件' }]), true)
  assert.equal(companionGenerationStarted([{ type: 'assistant.delta', text: 'WinError' }]), true)
  assert.equal(companionGenerationStarted([{ payload: { type: 'tool.started', toolName: 'read' } }]), true)
  const pending = {
    entries: [
      { role: 'user', text: '先读 click 仓库' },
      { role: 'assistant', text: '这一轮已取消。' },
      { role: 'user', text: '刚才 notepad 那个继续。' },
    ],
  }
  assert.equal(companionPromptHasReply(pending, '刚才 notepad 那个继续'), false)
  assert.equal(companionPromptHasReply({
    entries: [
      ...pending.entries,
      { role: 'assistant', text: 'edit_files 里是 WinError 87。' },
    ],
  }, '刚才 notepad 那个继续'), true)
})

test('companion core reply wait outlasts a running tool', () => {
  const startedAt = 1_000
  const idle = nextCompanionReplyDeadline({ startedAt, now: 1_000, events: [] })
  assert.equal(idle.deadline, startedAt + 180_000)
  assert.equal(companionToolsStillOpen([{ type: 'tool.started', toolCallId: 'a' }]), true)
  assert.equal(companionToolsStillOpen([
    { type: 'tool.started', toolCallId: 'a' },
    { type: 'tool.completed', toolCallId: 'a' },
  ]), false)
  const running = nextCompanionReplyDeadline({
    startedAt,
    now: 5_000,
    events: [{ type: 'tool.started', toolCallId: 'bash-1', toolName: 'bash' }],
  })
  assert.equal(running.toolSeenAt, 5_000)
  assert.equal(running.deadline, 5_000 + 600_000 + 60_000)
  const after = nextCompanionReplyDeadline({
    startedAt,
    now: 200_000,
    toolSeenAt: 5_000,
    events: [
      { type: 'tool.started', toolCallId: 'bash-1' },
      { type: 'tool.completed', toolCallId: 'bash-1' },
    ],
  })
  assert.equal(after.deadline, 200_000 + 60_000)
})

test('user memory write judge rejects pending, paraphrase, secrets, and resurrection', () => {
  const prompt = companionMemoryPreferencePrompt('plmemtest')
  assert.equal(prompt.includes('批准'), false)
  assert.equal(prompt.includes('已记下'), false)
  const before = { pending: [{ id: 'old-pending', markdown: '旧的' }], approved: [] }
  const pending = judgeCompanionMemoryWrite(before, {
    pending: [...before.pending, { id: 'new-pending', markdown: prompt, evidence: prompt }],
    approved: [],
  }, { userText: prompt, marker: 'plmemtest' })
  assert.equal(pending.ok, false)
  assert.equal(pending.fatal, true)
  const paraphrase = judgeCompanionMemoryWrite(before, {
    pending: before.pending,
    approved: [{ id: 'm1', markdown: '用户希望被这样称呼', evidence: '用户希望被这样称呼' }],
  }, { userText: prompt, marker: 'plmemtest' })
  assert.equal(paraphrase.ok, false)
  assert.equal(paraphrase.fatal, true)
  assert.equal(judgeCompanionMemoryWrite(
    { pending: [], approved: [] },
    { pending: [], approved: [{ id: 'm2', title: '分支', markdown: '仓库 main 分支不许改', evidence: '仓库 main 分支不许改' }] },
    { userText: '仓库 main 分支不许改', marker: '仓库 main' },
  ).ok, false)
  assert.equal(judgeCompanionMemoryWrite(
    { pending: [], approved: [] },
    { pending: [], approved: [{ id: 'm3', markdown: '留着 flag{demo-flag}', evidence: '留着 flag{demo-flag}' }] },
    { userText: '留着 flag{demo-flag}', marker: 'flag{demo-flag}' },
  ).ok, false)
  const written = judgeCompanionMemoryWrite(before, {
    pending: before.pending,
    approved: [{ id: 'm4', title: '称呼', markdown: '称呼固定是 plmemtest', evidence: '我的称呼固定是 plmemtest' }],
  }, { userText: prompt, marker: 'plmemtest' })
  assert.equal(written.ok, true)
  assert.deepEqual(written.ids, ['m4'])
  assert.equal(judgeCompanionMemoryForgotten({ approved: [] }, 'm4').ok, true)
  assert.equal(judgeCompanionMemoryForgotten({ approved: [{ id: 'm4' }], pending: [] }, 'm4').ok, false)
  assert.equal(judgeCompanionMemoryWrite(
    { pending: [], approved: [] },
    { pending: [], approved: [] },
    { userText: '你好', marker: '你好' },
  ).ok, true)
  assert.match(judgeCompanionMemoryWrite(
    { pending: [], approved: [] },
    { pending: [], approved: [{ id: 'g', markdown: '打过招呼', evidence: '你好' }] },
    { userText: '你好', marker: '你好' },
  ).reason, /打招呼/)
  assert.equal(memoryTurnIgnored({ sessionId: 'milksu_text_projection_1', userText: prompt }), true)
  assert.equal(memoryTurnIgnored({ sessionId: 'milksu_model_probe_1', userText: prompt }), true)
  assert.equal(memoryTurnIgnored({
    sessionId: 'conv',
    userText: '看板娘转达 / Companion relay:\n我的称呼固定是 plmemtest',
  }), true)
  assert.equal(memoryTurnIgnored({ sessionId: 'conv', userText: prompt }), false)
  assert.equal(judgeCompanionMemoryWrite(
    { pending: [], approved: [] },
    { pending: [], approved: [{ id: 'm4', markdown: '称呼固定是 plmemtest', evidence: '我的称呼固定是 plmemtest' }] },
    { userText: prompt, marker: 'plmemtest', sessionId: 'milksu_model_probe_1' },
  ).ok, false)
})

test('memory extract keeps a contiguous quote and does not ask for approval', () => {
  const userText = '我的称呼固定是 plmemtest'
  const dropped = parseMemoryExtractResult(JSON.stringify({
    items: [
      { action: 'create', title: '称呼', markdown: '叫用户 plmemtest', evidence: '不是原话' },
      { action: 'update', existingId: 'missing', title: '称呼', markdown: '叫用户 plmemtest', evidence: userText },
    ],
  }), { userText, memories: [], maxItems: 1 })
  assert.equal(dropped.length, 0)
  const kept = parseMemoryExtractResult(JSON.stringify({
    items: [
      { action: 'create', title: '称呼', markdown: '称呼固定是 plmemtest', evidence: '称呼固定是 plmemtest' },
      { action: 'create', title: '另一条', markdown: '还有', evidence: userText },
    ],
  }), { userText, maxItems: 1 })
  assert.equal(kept.length, 1)
  assert.equal(kept[0].evidence, '称呼固定是 plmemtest')
  const updated = parseMemoryExtractResult(JSON.stringify({
    items: [{ action: 'update', existingId: 'm1', title: '称呼', markdown: '改口了', evidence: userText }],
  }), { userText, memories: [{ id: 'm1', markdown: '旧的' }], maxItems: 1 })
  assert.equal(updated[0].action, 'update')
  assert.equal(normalizeMemoryExtract('daily'), 'turn')
  assert.equal(normalizeMemoryExtract('off'), 'off')
  assert.equal(normalizeMemoryExtractIdleMinutes(7), 10)
  assert.equal(normalizeMemoryExtractIdleMinutes(15), 15)
  const instructions = memoryExtractInstructions('zh', 1)
  assert.equal(/批准|propose_memory/.test(instructions), false)
  assert.match(instructions, /连续抄下来/)
  assert.match(instructions, /仓库/)
  const prompt = companionSystemPrompt('zh')
  assert.match(prompt, /长期记忆一直在/)
  assert.equal(/批准过的长期记忆|propose_memory/.test(prompt), false)
})

test('memory extract controller waits out idle, retries once, and drops when off', async () => {
  const calls = []
  let timer = null
  let failures = 0
  const controller = createMemoryExtractController({
    extract: async (job) => {
      calls.push(job.stretch.map(row => row.user).join('|'))
      if (failures < 1) {
        failures += 1
        throw new Error('extract failed')
      }
      return { committed: true }
    },
    setTimer: (fn, ms) => {
      timer = { fn, ms }
      return 1
    },
    clearTimer: () => {
      timer = null
    },
    now: () => 0,
  })
  controller.configure({ mode: 'idle', idleMinutes: 10 })
  await controller.finishTurn({ userText: '我的称呼固定是 plmemtest', assistantText: '好' })
  assert.equal(calls.length, 0)
  assert.equal(timer.ms, 10 * 60 * 1000)
  controller.beginTurn()
  assert.equal(timer, null)
  controller.configure({ mode: 'off' })
  await controller.finishTurn({ userText: '关掉了', assistantText: '好' })
  assert.equal(calls.length, 0)
  controller.configure({ mode: 'turn' })
  await controller.finishTurn({ userText: '第一句', assistantText: '好' })
  assert.deepEqual(calls, ['第一句'])
  await controller.finishTurn({ userText: '第二句', assistantText: '好' })
  assert.deepEqual(calls, ['第一句', '第一句', '第二句'])
})

test('memory extract does not keep retrying the same failed stretch', async () => {
  const calls = []
  const controller = createMemoryExtractController({
    extract: async (job) => {
      calls.push(job.stretch.map(row => row.user).join('|'))
      throw new Error('extract failed')
    },
    setTimer: () => 1,
    clearTimer: () => {},
  })
  controller.configure({ mode: 'turn' })
  await controller.finishTurn({ userText: '第一句', assistantText: '好' })
  await controller.finishTurn({ userText: '第二句', assistantText: '好' })
  await controller.finishTurn({ userText: '第三句', assistantText: '好' })
  assert.deepEqual(calls, ['第一句', '第一句', '第二句', '第二句', '第三句'])
})

test('DSH prompt blocks and Pi user messages do not carry the memory prefix', async () => {
  const prompt = '我的称呼固定是 plmemtest'
  const blocks = await buildDshPromptBlocks({ prompt })
  assert.equal(blocks[0].text, prompt)
  assert.equal(userPromptCarriesMemoryBlock(blocks), false)
  const messages = withUserMemoryMessages(
    [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    [{ id: '1', title: '称呼', markdown: '称呼固定是 plmemtest' }],
    { locale: 'zh' },
  )
  assert.equal(messages[0].role, 'custom')
  assert.equal(messages[0].customType, 'milksu.user-memory')
  assert.equal(messages[0].display, false)
  assert.match(messages[0].content[0].text, /^用户记忆\n/)
  assert.equal(userPromptCarriesMemoryBlock(messages), false)
  assert.equal(userPromptCarriesMemoryBlock([{ type: 'text', text: '用户记忆\n称呼固定是 plmemtest' }]), true)
})

test('memory settings and CVE learning file judges', () => {
  assert.equal(memorySectionPrecedesPrivacy(['教学', '记忆', '隐私', '外观']).ok, true)
  assert.equal(memorySectionPrecedesPrivacy(['Privacy', 'Memory']).ok, false)
  assert.equal(memorySectionPrecedesPrivacy(['记忆']).ok, false)
  assert.equal(judgeExtractOptions(['关闭', '每轮结束', '闲置后']).ok, true)
  assert.equal(judgeExtractOptions(['关闭', '每轮结束', '闲置后', '每天']).ok, false)
  assert.equal(judgeExtractOptions(['Off', 'Each turn']).ok, false)
  assert.equal(judgeIdleMinutesLabel('10 分钟').ok, true)
  assert.equal(judgeIdleMinutesLabel('10 min').minutes, 10)
  assert.equal(judgeIdleMinutesLabel('7 分钟').ok, false)
  assert.equal(judgeMemorySearchRow(['提取'], 0).ok, true)
  assert.equal(judgeMemorySearchRow(['提取', '检索'], 0).ok, false)
  assert.equal(judgeMemorySearchRow(['Search'], 2).ok, true)
  assert.equal(domainMemoryFileKind('lab/TASK.md'), 'not-memory')
  assert.equal(domainMemoryFileKind('LEARNING.md'), 'domain')
  assert.equal(domainMemoryFileKind('MEMORY.md'), 'domain')
  const note = cveLearningNote('pllearntest')
  assert.equal(note.includes('sk-'), false)
  assert.equal(PRODUCT_LOOP_CVE_ID, 'CVE-2099-4242')
  const secret = `sk-${'abcdefghijklmnopqrstuv'}`
  assert.equal(judgeLearningRound({ phase: 'saved', exists: true, text: `${note}\n${secret}`, note }).ok, false)
  assert.equal(judgeLearningRound({
    phase: 'saved',
    exists: true,
    text: `Bearer ${'a'.repeat(16)}\n${note}`,
    note,
  }).ok, false)
  assert.equal(judgeLearningRound({ phase: 'saved', exists: true, text: `flag{demo}\n${note}`, note }).ok, false)
  assert.equal(judgeLearningRound({ phase: 'saved', exists: false, text: '', note }).reason, '记下了但 LEARNING.md 没有写出来')
  assert.equal(judgeLearningRound({
    phase: 'saved',
    exists: true,
    text: `# ${PRODUCT_LOOP_CVE_ID}\n\n${note}\n`,
    note,
  }).ok, true)
  assert.equal(judgeLearningRound({ phase: 'forgotten', exists: true, text: note, note, remaining: 0 }).ok, false)
  assert.equal(judgeLearningRound({ phase: 'forgotten', exists: false, text: '', note, remaining: 0 }).ok, true)
  assert.equal(judgeLearningRound({ phase: 'forgotten', exists: true, text: '另一条复盘', note, remaining: 1 }).ok, true)
  assert.match(memoryTranscriptAnomaly('已记下这条'), /已记下/)
  assert.equal(memoryTranscriptAnomaly('Request aborted'), 'Request aborted')
  assert.equal(memoryTranscriptAnomaly('这一轮已取消。'), '')
  assert.equal(memoryTranscriptAnomaly('companion-host-3'), 'companion-host 请求号')
  assert.equal(memoryTranscriptAnomaly('[object Object]'), '[object Object]')
  assert.equal(memoryTranscriptAnomaly('{"companion_float_enabled":true}'), '设置 JSON')
})
