/**
 * First-use product-loop: login gate, GitHub or skip-local, account then custom relay.
 * Isolated Stable instance via MILKSU_INSTANCE_ID. Does not print Provider keys.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { redactProcessText } from '../../sidecar/dsh/redact.js'
import {
  classifyTurnEvents,
  delay,
  GuiDriver,
  repositoryRoot,
} from './desktop-gui-driver.mjs'
import { TOKENFLUX_BASE_URL } from './product-loop-catalog.mjs'
import {
  TOKENFLUX_CATALOG_DEFAULT_MODEL,
  productLoopLocalSecret,
  productLoopRelayAttempts,
  resolveCustomRelayModels,
} from './product-loop-local-env.mjs'
import { adoptEvidence, applySurfaceScan, inspectProductLoopSurfaces } from './product-loop-surface-scan.mjs'

export const FIRST_USE_RELAY_ID = 'custom-relay-product-loop'
export const FIRST_USE_RELAY_NAME = 'product-loop'
export const FIRST_USE_LOGIN_WAIT_MS = 90_000

/** null = unknown; false after上手 rejected every product-loop Key. */
let productLoopPersonalRelayUsable = null
/** True after the account file loop passed and sign-in came back. Later routes must not switch to a personal key. */
let productLoopAccountRequired = false

export function resetProductLoopPersonalRelayGate() {
  productLoopPersonalRelayUsable = null
  productLoopAccountRequired = false
}

export function markProductLoopAccountRequired(required) {
  productLoopAccountRequired = required === true
}

export function isProductLoopAccountRequired() {
  return productLoopAccountRequired === true
}

export function markProductLoopPersonalRelayUsable(ok) {
  productLoopPersonalRelayUsable = ok === true
}
const FILE_TOOL_PATTERN = /(read|write|edit|apply_patch|glob|grep|ls|list_dir|read_file|write_file|str_replace|bash|shell)/i

export const FIRST_USE_FILE_PROMPT = [
  '你在当前工作区里做一次真实的文件循环，不要只聊天回复。',
  '1. 先列出工作区根目录和已有文件，确认这是一个临时仓库。',
  '2. 新建 NOTES.md，写入：你看到了哪些文件、各自一两句说明、今天的日期，以及单独一行 PRODUCT-LOOP-NOTES。',
  '3. 再把 NOTES.md 读回来，核对自己刚写的内容，并在回复里引用其中一行。',
  '完成标准：工作区必须出现 NOTES.md，且你实际调用了文件类工具（列出/写入/读取），不要只用纯文本假装写过。',
].join('\n')

async function fillAccountPasswordForm(driver, username, password) {
  return driver.cdp.evaluate(`(() => {
    const setValue = (id, value) => {
      const field = document.getElementById(id)
      if (!field) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    if (!setValue('account-username', ${JSON.stringify(username)})) return 'missing-username'
    if (!setValue('account-password', ${JSON.stringify(password)})) return 'missing-password'
    const form = document.getElementById('account-password').form
    if (!form) return 'missing-form'
    form.requestSubmit()
    return 'submitted'
  })()`)
}

async function reopenAccountLoginGate(driver) {
  await driver.cdp.evaluate(`(() => {
    try { window.sessionStorage?.removeItem('milksu.account.continue-local') } catch {}
    try { window.localStorage?.removeItem('milksu.account.continue-local') } catch {}
    location.reload()
  })()`).catch(() => {})
  await delay(1_500)
  if (!await driver.ensureAttached()) return false
  await driver.ensureProductLoopEventHook().catch(() => false)
  const gate = await waitFor(async () => {
    if (!driver?.cdpAlive()) return null
    const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
    return snapshot.gate ? true : null
  }, 30_000, 1_000).catch(() => null)
  return Boolean(gate)
}

export async function signInProductLoopAccount(driver) {
  const username = String(process.env.MILKSU_LOOP_USER || '')
  const password = String(process.env.MILKSU_LOOP_PASSWORD || '')
  if (!username || !password) throw new Error('这一次登录没有用户名或密码')
  if (!await driver.ensureAttached()) throw new Error('CDP WebSocket closed')
  let filled = await fillAccountPasswordForm(driver, username, password)
  if (filled === 'missing-username' || filled === 'missing-password' || filled === 'missing-form') {
    const opened = await reopenAccountLoginGate(driver)
    if (!opened) throw new Error(String(filled))
    filled = await fillAccountPasswordForm(driver, username, password)
  }
  if (filled !== 'submitted') throw new Error(String(filled))
}

export async function signInProductLoopIfGated(driver) {
  const username = String(process.env.MILKSU_LOOP_USER || '')
  const password = String(process.env.MILKSU_LOOP_PASSWORD || '')
  if (!username || !password || !driver) return { ok: true, signedIn: false }
  const snapshot = await snapshotLoginPage(driver).catch(() => ({}))
  if (!inspectLoginPage(snapshot).gate) return { ok: true, signedIn: false }
  await signInProductLoopAccount(driver)
  const restored = await waitFor(async () => {
    if (!driver.cdpAlive()) return { dead: true }
    const status = await accountStatus(driver).catch(() => null)
    return accountSessionReady(status) ? status : null
  }, 90_000, 2_000).catch(() => null)
  if (!restored || restored.dead) {
    return { ok: false, signedIn: false, detail: '登录页提交了，账户没有变成已登录' }
  }
  await enableAccountRoute(driver)
  markProductLoopAccountRequired(true)
  return { ok: true, signedIn: true }
}

export function accountSessionReady(status) {
  return status?.state === 'active' && status?.authenticated === true && status?.mustChangePassword !== true
}

export function inspectLoginPage(snapshot = {}) {
  const text = String(snapshot.text ?? '')
  const label = String(snapshot.ariaLabel ?? '')
  return {
    gate: /登录 MilkSU|Sign in to MilkSU/.test(`${label}\n${text}`),
    github: /使用 GitHub 登录|Sign in with GitHub/.test(text),
    skip: /暂不登录，使用自己的 API Key|Skip sign-in and use your own API key/.test(text),
  }
}

export function settingsProviders(settings) {
  const value = settings?.providers || settings?.Providers || {}
  return value && typeof value === 'object' ? value : {}
}

export function firstUseRelayName(env = process.env) {
  return String(env.CUSTOM_RELAY_NAME ?? '').trim() || FIRST_USE_RELAY_NAME
}

export function firstUseRelayBaseUrl(env = process.env) {
  return String(env.CUSTOM_RELAY_BASE_URL ?? '').trim() || TOKENFLUX_BASE_URL
}

export function firstUseRelayModel(env = process.env) {
  return resolveCustomRelayModels(env) || TOKENFLUX_CATALOG_DEFAULT_MODEL
}

function describeRelayRow(id, row = {}) {
  return {
    id,
    enabled: Boolean(row.enabled),
    hasKey: Boolean(row.has_api_key || row.hasApiKey),
    name: String(row.name ?? ''),
    baseURL: String(row.base_url ?? row.baseUrl ?? ''),
    models: [...(row.models ?? [])].map(item => String(item ?? '').trim()).filter(Boolean),
  }
}

export function findCustomRelays(settings) {
  return Object.entries(settingsProviders(settings))
    .filter(([id, row]) => Boolean(row?.custom) || String(id).startsWith('custom-relay-'))
    .map(([id, row]) => describeRelayRow(id, row))
}

export function describeCustomRelay(settings, idOrName) {
  const wanted = String(idOrName ?? firstUseRelayName()).trim()
  const relays = findCustomRelays(settings)
  return relays.find(row => row.id === wanted)
    || relays.find(row => row.name === wanted)
    || describeRelayRow(wanted, settingsProviders(settings)[wanted])
}

/**
 * Point homepage + companion at the product-loop personal relay.
 * Only for the logged-out slice. Once the account is back, later cases stay
 * on the account model so the issued intent key is what gets exercised.
 */
export function isProductLoopPersonalRelayUsable() {
  return productLoopPersonalRelayUsable === true
}

export async function enablePersonalRelayRoute(driver) {
  if (productLoopPersonalRelayUsable === false) {
    return { ok: false, detail: '个人中转站还没有通过验证的 Key' }
  }
  const settings = await driver.invoke('GetSettings', [])
  const relay = describeCustomRelay(settings, firstUseRelayName())
  const alreadyVerified = productLoopPersonalRelayUsable === true
    && Boolean(relay.id && relay.hasKey && relay.enabled && relay.models.length && relay.baseURL)
    && !relay.baseURL.includes('tokenflux.ai')
  const probed = alreadyVerified
    ? {
      ok: true,
      id: relay.id,
      model: relay.models.find(Boolean),
      detail: '个人中转站已在上手流程验证',
    }
    : await probeCustomRelay(driver, relay)
  if (!probed.ok) {
    return { ok: false, detail: probed.detail || '个人中转站还没有 Key' }
  }
  await driver.invoke('SaveSettingsCmd', [{
    ...settings,
    active_provider: probed.id,
    active_model: probed.model,
    companion_source: 'personal',
    companion_provider: probed.id,
    companion_model: probed.model,
  }])
  markProductLoopPersonalRelayUsable(true)
  return {
    ok: true,
    id: probed.id,
    model: probed.model,
    detail: `看板娘与主页改用个人中转站 ${relay.name || probed.id}`,
  }
}

export function mergeCustomRelay(settings, options = {}) {
  const next = { ...(settings || {}) }
  const providers = { ...settingsProviders(next) }
  const id = String(options.id || FIRST_USE_RELAY_ID)
  const current = providers[id] || {}
  const hasKey = Boolean(current.has_api_key || current.hasApiKey)
  const models = String(options.models ?? '').split(',').map(item => item.trim()).filter(Boolean)
  providers[id] = {
    ...current,
    enabled: true,
    custom: true,
    name: String(options.name || current.name || 'product-loop'),
    base_url: String(options.baseURL || current.base_url || current.baseUrl || TOKENFLUX_BASE_URL),
    models: models.length ? models : [...(current.models ?? [])],
    api_key: hasKey ? '' : String(options.apiKey ?? ''),
    has_api_key: hasKey,
  }
  next.providers = providers
  if (next.Providers) next.Providers = providers
  next.active_provider = id
  next.active_model = (providers[id].models || [])[0] || next.active_model || ''
  return {
    settings: next,
    id,
    typedKey: !hasKey && Boolean(String(options.apiKey ?? '').trim()),
  }
}

export function classifyAccountFileLoop(input = {}) {
  const notes = input.notes === true
  const usedFiles = input.usedFiles === true
  const timeout = input.timeout === true
  const failed = input.failed === true
  const linked = input.tokenFluxLinked === true
  const detail = String(input.detail ?? '')
  if (notes && usedFiles && !timeout && !failed) return { result: 'PASS', expectedMiss: false }
  if (timeout || failed) return { result: 'FAIL', expectedMiss: false }
  if (/无效|无权|401|拒绝|rejected|invalid|unauthorized/i.test(detail)) {
    return { result: 'FAIL', expectedMiss: false }
  }
  if (/spawn guard|model verification failed|PI model verification/i.test(detail)) {
    return { result: 'FAIL', expectedMiss: false }
  }
  if (!linked || /额度|quota|未连接|没有可用的模型|insufficient/i.test(detail)) {
    return { result: 'SKIP', expectedMiss: true }
  }
  return { result: 'FAIL', expectedMiss: false }
}

export function classifyCustomRelaySave(detail = '') {
  const text = String(detail ?? '')
  if (/没有已存中转站，也没有 TOKENFLUX_API_KEY \/ DEEPSEEK_API_KEY/.test(text)) {
    return { result: 'FAIL', expectedMiss: true }
  }
  return { result: 'FAIL', expectedMiss: false }
}

export function firstUseHasCredentialPath(steps = []) {
  return steps.some(step => (
    (step.id === 'account-model-fileloop' && step.result === 'PASS')
    || (step.id === 'relay-model-fileloop' && step.result === 'PASS')
  ))
}

export function firstUseSourcesReady(steps = []) {
  return firstUseHasCredentialPath(steps)
    || steps.some(step => step.id === 'settings-custom-relay' && step.result === 'PASS')
}

export function firstUseAccountReady(steps = []) {
  return steps.some(step => step.id === 'login-intent-issued' && step.result === 'PASS')
}

export function firstUseModuleResult(steps = []) {
  const failed = steps.filter(step => step.result === 'FAIL' || step.result === 'BLOCKED')
  const required = ['login-gate', 'login-skip-local']
  const missing = required.filter(id => !steps.some(step => step.id === id && step.result === 'PASS'))
  if (failed.length || missing.length || !firstUseHasCredentialPath(steps)) return 'FAIL'
  return 'PASS'
}

/** Keep instanceId + sourcesReady even when CDP died; companion must reopen the same isolated instance. */
export function firstUseSessionHandoff(launch, instanceId, steps, keepOpen) {
  return {
    driver: shouldKeepLaunch(launch, steps, keepOpen) ? launch?.driver ?? null : null,
    instanceId: instanceId || '',
    sourcesReady: firstUseAccountReady(steps) || (
      !steps.some(step => step.id === 'account-model-fileloop' && step.result === 'PASS')
      && firstUseSourcesReady(steps)
    ),
    accountReady: firstUseAccountReady(steps),
  }
}

function collectToolNames(events) {
  return [...new Set((events ?? []).map(event => String(event?.toolName ?? event?.name ?? '')).filter(Boolean))]
}

async function snapshotLoginPage(driver) {
  return driver.cdp.evaluate(`(() => ({
    ariaLabel: document.querySelector('main')?.getAttribute('aria-label') || '',
    text: document.body ? document.body.innerText : '',
  }))()`)
}

async function accountStatus(driver) {
  return driver.invoke('GetAccountStatus', [])
}

async function safeAccountStatus(driver) {
  if (!driver?.cdpAlive()) return null
  try {
    return await accountStatus(driver)
  } catch {
    return null
  }
}

async function waitFor(predicate, timeoutMs, intervalMs = 500) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await predicate()
    if (last) return last
    await delay(intervalMs)
  }
  return last
}

function runGitInit(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`git init exited ${code}`))))
  })
}

async function prepareWorkspace() {
  const root = await mkdtemp(join(repositoryRoot, 'build', 'test-results', 'product-loop-first-use-'))
  await runGitInit(root)
  await writeFile(join(root, 'README.md'), 'product-loop first-use workspace\n')
  return root
}

async function runFileLoop(driver, options) {
  const workspace = await prepareWorkspace()
  let conversation = null
  try {
    conversation = await driver.createConversation({
      title: options.title,
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
      modelMode: options.modelMode,
      modelProvider: options.modelProvider,
      modelId: options.modelId,
    })
    try {
      await driver.sendMessage(conversation.id, FIRST_USE_FILE_PROMPT, workspace, {
        modelMode: options.modelMode,
        modelProvider: options.modelProvider,
        modelId: options.modelId,
        modelSourcePreference: options.modelSourcePreference,
      })
    } catch (error) {
      await delay(1_000)
      try {
        await driver.sendMessage(conversation.id, FIRST_USE_FILE_PROMPT, workspace, {
          modelMode: options.modelMode,
          modelProvider: options.modelProvider,
          modelId: options.modelId,
          modelSourcePreference: options.modelSourcePreference,
        })
      } catch (retryError) {
        return {
          notes: false,
          usedFiles: false,
          timeout: false,
          toolNames: [],
          detail: redactProcessText(retryError instanceof Error ? retryError.message : retryError, 240),
        }
      }
    }
    let turn = await driver.waitForTurn(conversation.id, options.timeoutMs)
    if (turn.timeout && !(turn.events ?? []).length) {
      await driver.sendMessage(conversation.id, FIRST_USE_FILE_PROMPT, workspace, {
        modelMode: options.modelMode,
        modelProvider: options.modelProvider,
        modelId: options.modelId,
        modelSourcePreference: options.modelSourcePreference,
      }).catch(() => {})
      turn = await driver.waitForTurn(conversation.id, options.timeoutMs)
    }
    const outcome = classifyTurnEvents(turn.events)
    let notes = false
    try {
      notes = (await readFile(join(workspace, 'NOTES.md'), 'utf8')).includes('PRODUCT-LOOP-NOTES')
    } catch {
      notes = false
    }
    const toolNames = collectToolNames(turn.events)
    const usedFiles = toolNames.some(name => FILE_TOOL_PATTERN.test(name))
    const types = (turn.events ?? []).map(event => String(event?.type ?? event?.Type ?? '')).filter(Boolean)
    const errorText = [
      turn.error,
      outcome.error,
      types.slice(0, 16).join(','),
      ...(turn.events ?? []).map(event => [
        event?.error,
        event?.message,
        event?.detail,
      ].filter(Boolean).join(' ')),
    ].filter(Boolean).join(' | ')
    return {
      notes,
      usedFiles,
      timeout: Boolean(turn.timeout),
      failed: Boolean(turn.failed || outcome.failed),
      toolNames,
      detail: redactProcessText(errorText, 240),
    }
  } finally {
    if (conversation?.id) {
      await driver.abortMessage(conversation.id).catch(() => {})
      await delay(250)
      await driver.deleteConversation(conversation.id).catch(() => {})
      await delay(250)
    }
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function startFirstUseDesktop(options = {}) {
  const driver = new GuiDriver()
  try {
    const attached = await driver.startFresh({
      instanceId: options.instanceId,
      timeoutMs: options.timeoutMs,
      buildRuntime: options.buildRuntime === true || process.env.MILKSU_PRODUCT_LOOP_BUILD === '1',
    })
    return {
      driver,
      attached,
      windowClaim: driver.windowClaim,
    }
  } catch (error) {
    driver.gaps = driver.gaps || []
    driver.gaps.push(redactProcessText(error instanceof Error ? error.message : error, 180))
    return {
      driver,
      attached: false,
      windowClaim: driver.windowClaim,
    }
  }
}

async function expectLoginGate(driver, timeoutMs = 30_000) {
  try {
    const ready = await waitFor(async () => {
      if (!driver?.cdpAlive()) return { dead: true }
      try {
        const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
        const account = await safeAccountStatus(driver)
        return snapshot.gate && snapshot.github && snapshot.skip ? { ok: true, account } : null
      } catch {
        return driver?.cdpAlive() ? null : { dead: true }
      }
    }, timeoutMs, 500)
    if (ready?.dead) return { ok: false, detail: '登录页等待时 CDP 断开' }
    if (ready?.ok) return ready
    const snapshot = driver?.cdpAlive()
      ? inspectLoginPage(await snapshotLoginPage(driver).catch(() => ({})))
      : { github: false, skip: false }
    const account = await safeAccountStatus(driver)
    return {
      ok: false,
      account,
      detail: account?.configured === false
        ? '账户服务未配置，看不见登录页'
        : `没看见登录页 github=${snapshot.github} skip=${snapshot.skip} state=${account?.state ?? ''}`,
    }
  } catch (error) {
    return {
      ok: false,
      detail: redactProcessText(error instanceof Error ? error.message : error, 180),
    }
  }
}

async function waitForHomepage(driver, timeoutMs = 15_000) {
  try {
    return await waitFor(async () => {
      if (!driver?.cdpAlive()) return null
      const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
      return snapshot.gate ? null : true
    }, timeoutMs)
  } catch {
    return null
  }
}

export async function runFirstUse(options = {}) {
  const instanceId = `plfu-${process.pid}-${Date.now().toString(36)}`
  const steps = []
  const notes = []
  const loginWaitMs = Number(options.loginWaitMs || FIRST_USE_LOGIN_WAIT_MS)
  const taskTimeoutMs = Number(options.taskTimeoutMs || 180_000)
  const desktopReadyMs = Number(options.desktopReadyMs || 240_000)
  let launch = null
  resetProductLoopPersonalRelayGate()

  async function record(id, result, detail) {
    const step = { id, result, detail: redactProcessText(detail || '', 300) }
    if (typeof options.onStep === 'function' && launch?.driver) {
      try {
        adoptEvidence(step, await options.onStep(id, launch.driver, { result: step.result }))
      } catch {
        step.screenshots = []
      }
    }
    if (launch?.driver) {
      try {
        applySurfaceScan(step, await inspectProductLoopSurfaces(launch.driver, {
          caseId: id,
          result: step.result,
        }), { caseId: id, result: step.result })
      } catch {
        // Login window may have torn down between steps.
      }
    }
    steps.push(step)
    process.stdout.write(`FIRST-USE ${id} ${step.result} ${step.detail || ''}\n`)
  }

  async function closeLaunch() {
    if (!launch?.driver) return
    await launch.driver.close().catch(() => {})
    launch = null
  }

  function forgetFailedStep(id) {
    const idx = steps.findIndex(step => step.id === id && step.result !== 'PASS')
    if (idx >= 0) steps.splice(idx, 1)
  }

  async function recordOrReplace(id, result, detail) {
    const existing = steps.find(step => step.id === id)
    if (existing?.result === 'PASS') return
    if (existing && result === 'PASS') {
      existing.result = result
      existing.detail = redactProcessText(detail || '', 300)
      process.stdout.write(`FIRST-USE ${id} ${result} ${existing.detail || ''}\n`)
      return
    }
    if (existing) return
    await record(id, result, detail)
  }

  async function recordCustomRelay(driver) {
    if (steps.some(step => step.id === 'settings-custom-relay' && step.result === 'PASS')) return
    forgetFailedStep('settings-custom-relay')
    forgetFailedStep('relay-model-fileloop')
    const relay = await saveCustomRelay(driver)
    if (relay.ok) {
      markProductLoopPersonalRelayUsable(true)
      await record('settings-custom-relay', 'PASS', relay.detail)
      await enablePersonalRelayRoute(driver)
      await delay(1_500)
      if (!driver?.cdpAlive()) {
        await record('relay-model-fileloop', 'FAIL', '填完 Key 后 CDP 断了，文件循环没跑')
        return
      }
      try {
        const loop = await runFileLoop(driver, {
          title: 'product-loop first-use relay',
          modelMode: 'manual',
          modelProvider: relay.id,
          modelId: relay.model,
          modelSourcePreference: 'personal',
          timeoutMs: taskTimeoutMs,
        })
        const ok = loop.notes && loop.usedFiles && !loop.timeout && !loop.failed
        await record(
          'relay-model-fileloop',
          ok ? 'PASS' : 'FAIL',
          ok ? '中转站写出 NOTES.md' : `NOTES.md=${loop.notes} fileTools=${loop.usedFiles} timeout=${loop.timeout} failed=${Boolean(loop.failed)} ${loop.detail || ''}`,
        )
      } catch (error) {
        await record(
          'relay-model-fileloop',
          'FAIL',
          redactProcessText(error instanceof Error ? error.message : error, 180),
        )
      }
      return
    }
    const classified = classifyCustomRelaySave(relay.detail)
    markProductLoopPersonalRelayUsable(false)
    await record(
      'settings-custom-relay',
      classified.result,
      classified.expectedMiss
        ? `没有可用的本机 Key（${relay.detail}）`
        : relay.detail,
    )
    await record(
      'relay-model-fileloop',
      'FAIL',
      classified.expectedMiss ? '本机没有可填的中转站 Key' : '上手流程没跑到这一步',
    )
  }

  async function clickSkipLocal() {
    return launch.driver.cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const button = buttons.find(item => /暂不登录，使用自己的 API Key|Skip sign-in and use your own API key/.test(item.textContent || ''))
      if (!button) return false
      button.click()
      return true
    })()`)
  }

  async function startSkipLocalHome() {
    if (launch?.driver?.cdpAlive()) {
      try {
        const snapshot = inspectLoginPage(await snapshotLoginPage(launch.driver))
        if (snapshot.gate && snapshot.skip) {
          const clicked = await clickSkipLocal()
          const home = clicked ? await waitForHomepage(launch.driver) : null
          const after = await safeAccountStatus(launch.driver)
          if (home && after?.state !== 'active') {
            return { ok: true, detail: '暂不登录进了首页' }
          }
        } else if (!snapshot.gate) {
          const after = await safeAccountStatus(launch.driver)
          if (after?.state !== 'active') {
            return { ok: true, detail: '已在首页' }
          }
        }
      } catch {
        // Window died after GitHub; relaunch the same isolated instance.
      }
    }
    await closeLaunch()
    launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
    options.onDriver?.(launch?.driver)
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      await closeLaunch()
      await delay(800)
      launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
      options.onDriver?.(launch?.driver)
    }
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      return { ok: false, detail: launch.driver?.gaps?.join(' ') || '启动 B 没附着独立窗口' }
    }
    const gateB = await expectLoginGate(launch.driver)
    if (gateB.ok) await recordOrReplace('login-gate', 'PASS', '看见登录页和两条入口')
    if (!gateB.ok) return { ok: false, detail: gateB.detail }
    const clicked = await clickSkipLocal()
    const home = clicked ? await waitForHomepage(launch.driver) : null
    const after = await safeAccountStatus(launch.driver)
    if (home && after?.state !== 'active') {
      return { ok: true, detail: '暂不登录进了首页' }
    }
    return {
      ok: false,
      detail: `clicked=${Boolean(clicked)} home=${Boolean(home)} state=${after?.state ?? ''}`,
    }
  }

  async function fillRelayOnCurrentOrRelaunch() {
    if (launch?.driver?.cdpAlive()) {
      try {
        await recordCustomRelay(launch.driver)
        return
      } catch (error) {
        notes.push(redactProcessText(error instanceof Error ? error.message : error, 180))
      }
    }
    if (steps.some(step => step.id === 'settings-custom-relay' && step.result === 'PASS')) return
    const skip = await startSkipLocalHome()
    await recordOrReplace('login-skip-local', skip.ok ? 'PASS' : 'FAIL', skip.detail)
    if (skip.ok && launch?.driver?.cdpAlive()) {
      await recordCustomRelay(launch.driver)
    }
  }

  try {
    launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
    options.onDriver?.(launch?.driver)
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      await closeLaunch()
      await delay(800)
      launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
      options.onDriver?.(launch?.driver)
    }
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      await record('login-gate', 'FAIL', launch.driver?.gaps?.join(' ') || '没附着独立产品窗口')
    } else {
      if (launch.windowClaim?.closed) notes.push(launch.windowClaim.detail)

      const gateA = await expectLoginGate(launch.driver)
      await record('login-gate', gateA.ok ? 'PASS' : 'FAIL', gateA.ok ? '看见登录页和两条入口' : gateA.detail)
      if (gateA.ok) {
        process.stdout.write('FIRST-USE login-github-active 用本地环境里的用户名密码登录\n')
        try {
          await signInProductLoopAccount(launch.driver)
        } catch (error) {
          await record('login-github-active', 'FAIL', redactProcessText(error instanceof Error ? error.message : error, 200))
          await record('account-model-fileloop', 'SKIP', 'GitHub 登录没发出去，账户模型没跑')
        }
        if (!steps.some(step => step.id === 'login-github-active')) {
          let active = null
          try {
            active = await waitFor(async () => {
              if (!launch.driver?.cdpAlive()) return { dead: true }
              const status = await safeAccountStatus(launch.driver)
              if (!launch.driver?.cdpAlive() && !status) return { dead: true }
              return accountSessionReady(status) ? status : null
            }, loginWaitMs, 2_000)
          } catch (error) {
            await record(
              'login-github-active',
              'FAIL',
              redactProcessText(error instanceof Error ? error.message : error, 200),
            )
            await record('account-model-fileloop', 'SKIP', 'GitHub 登录期间窗口断了，账户模型没跑')
          }
          if (active?.dead) {
            await record('login-github-active', 'FAIL', '用户名密码登录之后窗口 CDP 断开')
            await record('account-model-fileloop', 'SKIP', 'GitHub 登录期间窗口断了，账户模型没跑')
          } else if (active && !active.dead) {
            await record('login-github-active', 'PASS', '账户变成已登录')
            await enableAccountRoute(launch.driver).catch(() => {})
            await delay(1_500)
            if (launch.driver?.cdpAlive()) {
              try {
                let loop = await runFileLoop(launch.driver, {
                  title: 'product-loop first-use account',
                  modelMode: 'manual',
                  modelProvider: 'tokenflux',
                  modelId: resolveCustomRelayModels(process.env) || 'deepseek/deepseek-flash',
                  modelSourcePreference: 'account',
                  timeoutMs: taskTimeoutMs,
                })
                if (launch.driver?.cdpAlive() && (!loop.notes || loop.timeout)) {
                  await delay(1_000)
                  loop = await runFileLoop(launch.driver, {
                    title: 'product-loop first-use account retry',
                    modelMode: 'manual',
                    modelProvider: 'tokenflux',
                    modelId: resolveCustomRelayModels(process.env) || 'deepseek/deepseek-flash',
                    modelSourcePreference: 'account',
                    timeoutMs: taskTimeoutMs,
                  })
                }
                const classified = classifyAccountFileLoop({
                  ...loop,
                  tokenFluxLinked: active.tokenFluxLinked === true,
                })
                await record(
                  'account-model-fileloop',
                  classified.result,
                  classified.expectedMiss
                    ? `账户发不出，linked=${Boolean(active.tokenFluxLinked)}，不记通过、不标来源就绪`
                    : loop.notes
                      ? '账户来源写出 NOTES.md'
                      : `NOTES.md=${loop.notes} fileTools=${loop.usedFiles} timeout=${loop.timeout} failed=${Boolean(loop.failed)} ${loop.detail || ''}`,
                )
              } catch (error) {
                await record(
                  'account-model-fileloop',
                  'FAIL',
                  redactProcessText(error instanceof Error ? error.message : error, 180),
                )
              }
            } else if (!steps.some(step => step.id === 'account-model-fileloop')) {
              await record('account-model-fileloop', 'SKIP', 'CDP 在账户文件循环前断开，账户模型没跑')
            }
          } else if (!steps.some(step => step.id === 'login-github-active')) {
            const status = await safeAccountStatus(launch.driver)
            await record(
              'login-github-active',
              'FAIL',
              `用户名密码已提交但超时仍是 ${status?.state || 'unknown'}。不能因为本机已有 Key 改成跳过。`,
            )
            await record('account-model-fileloop', 'SKIP', 'GitHub 未登录，账户模型没跑')
          }
        } else if (!steps.some(step => step.id === 'account-model-fileloop')) {
          await record('account-model-fileloop', 'SKIP', 'GitHub 登录失败，账户模型没跑')
        }
      } else {
        await record('login-github-active', 'FAIL', '没看见登录页，GitHub 没跑')
        await record('account-model-fileloop', 'SKIP', '没看见登录页，账户模型没跑')
      }
    }

    const githubOk = steps.find(step => step.id === 'login-github-active')?.result === 'PASS'
    if (githubOk && launch?.driver?.cdpAlive()) {
      await launch.driver.invoke('LogoutAccount', []).catch(() => {})
    }
    await resetContinueLocal(launch?.driver)

    const skip = await startSkipLocalHome()
    await recordOrReplace('login-skip-local', skip.ok ? 'PASS' : 'FAIL', skip.detail)
    if (skip.ok && launch?.driver?.cdpAlive()) {
      try {
        await recordCustomRelay(launch.driver)
      } catch (error) {
        if (!steps.some(step => step.id === 'settings-custom-relay')) {
          await record(
            'settings-custom-relay',
            'FAIL',
            redactProcessText(error instanceof Error ? error.message : error, 180),
          )
          await record('relay-model-fileloop', 'FAIL', '上手流程没跑到这一步')
        }
      }
    } else if (!steps.some(step => step.id === 'settings-custom-relay')) {
      await record('settings-custom-relay', 'FAIL', skip.ok ? 'CDP 在填 Key 前断开' : '启动 B 没进首页，没填上 Key')
      await record('relay-model-fileloop', 'FAIL', '上手流程没跑到这一步')
    }

    if (launch?.driver?.cdpAlive() && steps.some(step => step.id === 'relay-model-fileloop' && step.result === 'PASS')) {
      const { runLoggedOutIntentFallback } = await import('./product-loop-intent.mjs')
      const fallback = await runLoggedOutIntentFallback(launch.driver)
      await record('login-intent-fallback', fallback.result, fallback.detail)
    } else if (!steps.some(step => step.id === 'login-intent-fallback')) {
      await record('login-intent-fallback', 'FAIL', '个人模型没配上，未登录的主模型兜底没跑')
    }

    const accountFileloopOk = steps.some(step => step.id === 'account-model-fileloop' && step.result === 'PASS')
    let accountBack = false
    if (githubOk && launch?.driver?.cdpAlive()) {
      process.stdout.write('FIRST-USE 暂不登录之后再登录，后面继续用账户模型\n')
      await signInProductLoopAccount(launch.driver).catch(() => {})
      const restored = await waitFor(async () => {
        if (!launch.driver?.cdpAlive()) return { dead: true }
        const status = await safeAccountStatus(launch.driver)
        return accountSessionReady(status) ? status : null
      }, loginWaitMs, 2_000).catch(() => null)
      accountBack = Boolean(restored && !restored.dead)
      if (accountBack) {
        await enableAccountRoute(launch.driver).catch(() => {})
      }
      const { readAccountIntentGrant } = await import('./product-loop-intent.mjs')
      const issued = await readAccountIntentGrant(launch.driver)
      await record(
        'login-intent-issued',
        issued.ok ? 'PASS' : 'FAIL',
        issued.ok ? issued.detail : `再登录后${issued.detail}`,
      )
    } else if (!steps.some(step => step.id === 'login-intent-issued')) {
      await record('login-intent-issued', 'FAIL', githubOk ? '再登录没跑到，意图识别钥匙没核' : 'GitHub 没登录，意图识别钥匙没核')
    }
    if (launch?.driver?.cdpAlive() && accountBack) {
      markProductLoopAccountRequired(true)
      process.stdout.write('FIRST-USE 后面的用例继续用已登录的账户模型和意图识别钥匙\n')
    } else if (launch?.driver?.cdpAlive() && accountFileloopOk) {
      process.stdout.write('FIRST-USE 账户模型已验证，再登录没回来，后面不改用个人 Key\n')
    } else if (launch?.driver?.cdpAlive()) {
      const personal = await enablePersonalRelayRoute(launch.driver)
      if (personal.ok) {
        process.stdout.write(`FIRST-USE ${personal.detail}\n`)
      } else if (isProductLoopPersonalRelayUsable()) {
        process.stdout.write('FIRST-USE 个人中转站已验证，保持个人来源\n')
      }
    }
    return finish(steps, notes, firstUseSessionHandoff(launch, instanceId, steps, options.keepOpen))
  } catch (error) {
    const detail = redactProcessText(error instanceof Error ? error.message : error, 240)
    notes.push(detail)
    try {
      await fillRelayOnCurrentOrRelaunch()
    } catch (recoverError) {
      notes.push(redactProcessText(recoverError instanceof Error ? recoverError.message : recoverError, 180))
    }
    if (!firstUseSourcesReady(steps)) {
      await record('first-use', 'FAIL', detail)
    }
    return finish(steps, notes, firstUseSessionHandoff(launch, instanceId, steps, options.keepOpen))
  } finally {
    if (!shouldKeepLaunch(launch, steps, options.keepOpen)) {
      await closeLaunch()
    }
  }
}

function shouldKeepLaunch(launch, steps, keepOpen) {
  return Boolean(
    keepOpen
    && launch?.driver?.cdpAlive()
    && (
      steps.some(step => step.id === 'login-skip-local' && step.result === 'PASS')
      || steps.some(step => step.id === 'account-model-fileloop' && step.result === 'PASS')
      || steps.some(step => step.id === 'relay-model-fileloop' && step.result === 'PASS')
    ),
  )
}

function sessionFrom(launch, instanceId, steps, keepOpen) {
  return firstUseSessionHandoff(launch, instanceId, steps, keepOpen)
}

export async function enableAccountRoute(driver) {
  const settings = await driver.invoke('GetSettings', [])
  const next = { ...settings }
  next.relay = {
    ...(settings.relay || {}),
    enabled: true,
    url: TOKENFLUX_BASE_URL,
  }
  next.active_provider = 'tokenflux'
  next.active_model = resolveCustomRelayModels(process.env) || 'deepseek/deepseek-flash'
  next.companion_provider = 'tokenflux'
  next.companion_model = next.active_model
  next.companion_source = 'account'
  await driver.invoke('SaveSettingsCmd', [next])
}

export async function probeAccountRoute(driver) {
  const status = await accountStatus(driver).catch(() => null)
  if (!status || status.state !== 'active' || !status.authenticated) {
    return { ok: false, source: 'none', detail: '账户未登录或未验证' }
  }
  try {
    const settings = await driver.invoke('GetSettings', [])
    const model = resolveCustomRelayModels(process.env) || 'deepseek/deepseek-flash'
    const probe = await driver.invoke('TestAgentModel', [{
      ...settings,
      active_provider: 'tokenflux',
      active_model: model,
    }])
    if (probe?.ready === false) {
      return { ok: false, source: 'none', detail: '账户模型测试连接没通过' }
    }
    return { ok: true, source: 'account', model, detail: '账户模型测试连接通过' }
  } catch (error) {
    return {
      ok: false,
      source: 'none',
      detail: redactProcessText(error instanceof Error ? error.message : error, 180),
    }
  }
}

export async function resolveCompanionModelRoute(driver) {
  const account = await probeAccountRoute(driver)
  if (account.ok) {
    await enableAccountRoute(driver)
    return {
      ok: true,
      source: 'account',
      model: account.model,
      detail: account.detail,
    }
  }
  if (isProductLoopAccountRequired()) {
    return {
      ok: false,
      source: 'account',
      detail: account.detail || '账户模型已验证，不再改用个人 Key',
    }
  }
  const personal = await enablePersonalRelayRoute(driver).catch(() => ({ ok: false, detail: '' }))
  if (personal.ok) {
    return {
      ok: true,
      source: 'personal',
      id: personal.id,
      model: personal.model,
      detail: personal.detail,
    }
  }
  const detail = [account.detail, personal.detail].filter(Boolean).join('；')
    || '没有可用的个人中转站，也没有已验证的账户模型'
  return { ok: false, source: 'none', detail }
}

async function clickMatching(driver, patterns) {
  return driver.cdp.callFunction(`function(patterns) {
    const nodes = Array.from(document.querySelectorAll('button, [role="button"]'))
    for (const node of nodes) {
      const label = [node.getAttribute('aria-label') || '', node.getAttribute('title') || '', node.textContent || ''].join(' ')
      if (patterns.some(pattern => label.includes(pattern))) {
        node.click()
        return true
      }
    }
    return false
  }`, [patterns])
}

async function resetContinueLocal(driver) {
  if (!driver?.cdpAlive()) return
  await driver.cdp.evaluate(`(() => {
    try { window.sessionStorage?.removeItem('milksu.account.continue-local') } catch {}
    try { window.localStorage?.removeItem('milksu.account.continue-local') } catch {}
    return true
  })()`).catch(() => false)
}

async function openRelayEditor(driver) {
  const openedSettings = await waitFor(async () => {
    const state = await driver.cdp.callFunction(`function() {
      if (document.querySelector('[aria-label="设置分类"], [aria-label="Settings categories"]')) return 'settings'
      const button = Array.from(document.querySelectorAll('button')).find(item => {
        const label = item.getAttribute('aria-label') || ''
        return label === '设置' || label === 'Settings'
      })
      if (!button) return ''
      button.click()
      return 'clicked'
    }`)
    return state === 'settings' || state === 'clicked' ? state : null
  }, 8_000)
  if (!openedSettings) return { ok: false, detail: '打不开设置' }
  await delay(400)

  const openedModels = await waitFor(() => driver.cdp.callFunction(`function() {
    const nav = document.querySelector('[aria-label="设置分类"], [aria-label="Settings categories"]')
    if (!nav) return false
    const button = Array.from(nav.querySelectorAll('button')).find(item => {
      const text = (item.textContent || '').trim()
      return text === '模型' || text === 'Models'
    })
    if (!button) return false
    button.click()
    return true
  }`), 8_000)
  if (!openedModels) return { ok: false, detail: '设置里找不到模型分类' }
  await delay(400)

  const editorOpen = await waitFor(() => driver.cdp.callFunction(`function() {
    return Boolean(document.querySelector('[role="dialog"]'))
  }`), 1_200).catch(() => false)
  if (editorOpen) return { ok: true }

  const openedEditor = await waitFor(() => clickMatching(driver, ['添加模型提供商', 'Add a model provider', '新增模型服务', 'Add a model service']), 8_000)
  if (!openedEditor) return { ok: false, detail: '找不到添加模型提供商' }
  await delay(400)
  return { ok: true }
}

function relayEditorScript() {
  return `function(fields) {
    function setInput(input, value) {
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (!setter) return false
      input.focus()
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      const reactKey = Object.keys(input).find(key => key.startsWith('__reactProps$'))
      const onChange = reactKey ? input[reactKey]?.onChange : null
      if (typeof onChange === 'function') {
        onChange({ target: input, currentTarget: input })
      }
      return true
    }
    function byAria(patterns) {
      return Array.from(document.querySelectorAll('input')).find(item => {
        const label = item.getAttribute('aria-label') || ''
        return patterns.some(pattern => label.includes(pattern))
      })
    }
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return { ok: false, detail: '模型提供商对话框没打开' }
    if (fields.openCustom) {
      const customTab = Array.from(dialog.querySelectorAll('button')).find(item => /自定义模型 API|Custom model API/.test(item.textContent || ''))
      if (customTab) customTab.click()
      return { ok: true, switched: true }
    }
    if (fields.baseUrl && !setInput(byAria(['API 地址', 'API address', 'API 端点', 'API endpoint']), fields.baseUrl)) {
      return { ok: false, detail: '找不到 API 地址' }
    }
    if (fields.name && !setInput(byAria(['显示名称', 'Display name', '中转站名称', 'Relay name']), fields.name)) {
      return { ok: false, detail: '找不到显示名称' }
    }
    if (fields.removeModels) {
      for (const button of Array.from(dialog.querySelectorAll('button[aria-label]'))) {
        const label = button.getAttribute('aria-label') || ''
        if (/^移除模型 |^Remove model /.test(label)) button.click()
      }
    }
    if (fields.model && !setInput(byAria(['模型 ID', 'Model ID', '模型 ID 或关键词前缀', 'Model ID or keyword prefix']), fields.model)) {
      return { ok: false, detail: '找不到模型输入' }
    }
    if (fields.apiKey && !setInput(byAria(['API 密钥', 'API key', 'API Key']), fields.apiKey)) {
      return { ok: false, detail: '找不到 API 密钥' }
    }
    if (fields.addModel) {
      const add = Array.from(dialog.querySelectorAll('button')).find(item => /^(添加|Add)$/.test((item.textContent || '').trim()))
      if (!add) return { ok: false, detail: '找不到添加模型' }
      add.click()
    }
    if (fields.test) {
      const test = Array.from(dialog.querySelectorAll('button')).find(item => /^(保存|Save|正在保存|Saving|测试连接|Test connection|正在测试|Testing)$/.test((item.textContent || '').trim()))
      if (!test) return { ok: false, detail: '找不到保存' }
      test.click()
    }
    return { ok: true }
  }`
}

async function applyRelayEditorFields(driver, fields, apiKey) {
  await driver.cdp.callFunction(relayEditorScript(), [{ openCustom: true }])
  await delay(300)
  const prepared = await driver.cdp.callFunction(relayEditorScript(), [{
    name: fields.name,
    baseUrl: fields.baseUrl,
    model: fields.model,
    apiKey,
    removeModels: true,
  }])
  if (!prepared?.ok) return { ok: false, detail: prepared?.detail || '设置页没填上中转站' }
  await delay(250)
  const added = await driver.cdp.callFunction(relayEditorScript(), [{ addModel: true }])
  if (!added?.ok) return added
  const chip = await waitFor(() => driver.cdp.callFunction(`function(model) {
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return false
    return Array.from(dialog.querySelectorAll('span, button')).some(node => (node.textContent || '').trim() === model)
  }`, [fields.model]), 5_000)
  if (!chip) return { ok: false, detail: `模型 ${fields.model} 没有加进中转站` }
  await delay(150)
  const tested = await driver.cdp.callFunction(relayEditorScript(), [{ test: true }])
  if (!tested?.ok) return tested
  return { ok: true }
}

export async function probeCustomRelay(driver, described) {
  if (!described?.id || !described.hasKey || !described.enabled || !described.models.length || !described.baseURL) {
    return { ok: false, detail: '' }
  }
  if (described.baseURL.includes('tokenflux.ai')) {
    return { ok: false, detail: '官方 TokenFlux 不能用 tokenflux.ai' }
  }
  try {
    const settings = await driver.invoke('GetSettings', [])
    const model = described.models.find(Boolean)
    const probe = await driver.invoke('TestAgentModel', [{
      ...settings,
      active_provider: described.id,
      active_model: model,
    }])
    if (probe?.ready === false) {
      return { ok: false, detail: '已存中转站测试连接没通过' }
    }
    return {
      ok: true,
      id: described.id,
      model,
      detail: '已存中转站，测试连接通过',
    }
  } catch (error) {
    return {
      ok: false,
      detail: redactProcessText(error instanceof Error ? error.message : error, 180),
    }
  }
}

async function verifyStoredRelay(driver, described) {
  return probeCustomRelay(driver, described)
}

async function persistRelayAttempt(driver, attempt) {
  const settings = await driver.invoke('GetSettings', [])
  const providers = { ...settingsProviders(settings) }
  const existing = describeCustomRelay(settings, firstUseRelayName())
  const id = existing.id && providers[existing.id] ? existing.id : FIRST_USE_RELAY_ID
  const current = providers[id] || {}
  providers[id] = {
    ...current,
    enabled: true,
    custom: true,
    name: firstUseRelayName(),
    base_url: attempt.baseUrl,
    models: [attempt.model],
    api_key: attempt.value,
    has_api_key: true,
    remove_api_key: false,
  }
  const next = {
    ...settings,
    providers,
    active_provider: id,
    active_model: attempt.model,
    companion_source: 'personal',
    companion_provider: id,
    companion_model: attempt.model,
  }
  await driver.invoke('SaveSettingsCmd', [next])
  return { id, model: attempt.model }
}

async function discardRelayKey(driver) {
  const settings = await driver.invoke('GetSettings', [])
  const providers = { ...settingsProviders(settings) }
  const existing = describeCustomRelay(settings, firstUseRelayName())
  if (!existing.id || !providers[existing.id]) return
  providers[existing.id] = {
    ...providers[existing.id],
    api_key: '',
    has_api_key: false,
    remove_api_key: true,
  }
  await driver.invoke('SaveSettingsCmd', [{
    ...settings,
    providers,
  }]).catch(() => {})
}

async function waitForRelayVerify(driver) {
  await delay(400)
  return waitFor(async () => {
    const state = await driver.cdp.callFunction(`function() {
      const testing = Array.from(document.querySelectorAll('button')).some(item => /正在测试|Testing/.test(item.textContent || ''))
      if (testing) return { pending: true }
      const notice = document.querySelector('[role="dialog"] .text-destructive, [role="dialog"] .text-primary')
      const text = notice ? String(notice.textContent || '').trim() : ''
      if (/连接正常|Connected /.test(text)) return { ok: true, text }
      if (notice && notice.classList.contains('text-destructive') && text) return { ok: false, text }
      return { pending: true }
    }`)
    if (!state || state.pending) return null
    return state
  }, 90_000, 800)
}

async function closeRelayEditor(driver) {
  await driver.cdp.callFunction(`function() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return true
  }`).catch(() => false)
  await delay(200)
  await clickMatching(driver, ['返回', 'Back']).catch(() => false)
}

export async function installProductLoopJev(driver) {
  const { readAccountIntentGrant } = await import('./product-loop-intent.mjs')
  return readAccountIntentGrant(driver)
}

export async function saveCustomRelay(driver) {
  const settings = await driver.invoke('GetSettings', [])
  const described = describeCustomRelay(settings, firstUseRelayName())
  const stored = await verifyStoredRelay(driver, described)
  if (stored.ok) return stored
  const attempts = productLoopRelayAttempts()
  if (!attempts.length) {
    return { ok: false, detail: '没有已存中转站，也没有 TOKENFLUX_API_KEY / DEEPSEEK_API_KEY' }
  }
  const opened = await openRelayEditor(driver)
  if (!opened.ok) return opened
  let lastDetail = ''
  for (const attempt of attempts) {
    const filled = await applyRelayEditorFields(driver, {
      name: firstUseRelayName(),
      baseUrl: attempt.baseUrl,
      model: attempt.model,
    }, attempt.value)
    if (!filled.ok) {
      lastDetail = filled.detail
      await discardRelayKey(driver)
      continue
    }
    const verified = await waitForRelayVerify(driver)
    await persistRelayAttempt(driver, attempt)
    const saved = describeCustomRelay(await driver.invoke('GetSettings', []), firstUseRelayName())
    const probed = await probeCustomRelay(driver, {
      ...saved,
      models: [attempt.model],
      baseURL: attempt.baseUrl,
    })
    if (probed.ok) {
      await closeRelayEditor(driver)
      await enablePersonalRelayRoute(driver)
      return {
        ok: true,
        id: probed.id,
        model: attempt.model,
        detail: `在设置密码框填入 ${attempt.name}（回执不写 Key）${verified?.ok ? '' : '；对话框回执失败后按该 Key 与端点对重试通过'}`,
      }
    }
    lastDetail = `${attempt.name} ${redactProcessText(
      probed.detail || verified?.text || (verified ? '测试连接失败' : '测试连接没有回执'),
      180,
    )}`
    await discardRelayKey(driver)
  }
  await closeRelayEditor(driver)
  return { ok: false, detail: lastDetail || '设置页保存后中转站仍没有 Key' }
}

function finish(steps, notes, extras = {}) {
  return {
    result: firstUseModuleResult(steps),
    detail: steps.map(step => `${step.id}:${step.result}`).join(' '),
    steps,
    notes,
    toolNames: [],
    driver: extras.driver ?? null,
    instanceId: extras.instanceId ?? '',
    sourcesReady: extras.sourcesReady === true,
  }
}
