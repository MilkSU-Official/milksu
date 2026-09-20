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
  productLoopRelayAttempts,
  resolveCustomRelayModels,
} from './product-loop-local-env.mjs'

export const FIRST_USE_RELAY_ID = 'custom-relay-product-loop'
export const FIRST_USE_RELAY_NAME = 'product-loop'
export const FIRST_USE_LOGIN_WAIT_MS = 90_000
const FILE_TOOL_PATTERN = /(read|write|edit|apply_patch|glob|grep|ls|list_dir|read_file|write_file|str_replace|bash|shell)/i

export const FIRST_USE_FILE_PROMPT = [
  '你在当前工作区里做一次真实的文件循环，不要只聊天回复。',
  '1. 先列出工作区根目录和已有文件，确认这是一个临时仓库。',
  '2. 新建 NOTES.md，写入：你看到了哪些文件、各自一两句说明，以及今天的日期。',
  '3. 再把 NOTES.md 读回来，核对自己刚写的内容，并在回复里引用其中一行。',
  '完成标准：工作区必须出现 NOTES.md，且你实际调用了文件类工具（列出/写入/读取），不要只用纯文本假装写过。',
].join('\n')

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
  if (!linked || /额度|quota|未连接|没有可用|unavailable|insufficient/i.test(detail)) {
    return { result: 'PASS', expectedMiss: true }
  }
  return { result: 'FAIL', expectedMiss: false }
}

export function classifyCustomRelaySave(detail = '') {
  const text = String(detail ?? '')
  if (/凭据无效|无权访问|invalid|unauthorized|401|403/i.test(text)) {
    return { result: 'PASS', expectedMiss: true }
  }
  return { result: 'FAIL', expectedMiss: false }
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
      await readFile(join(workspace, 'NOTES.md'))
      notes = true
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
  const attached = await driver.startFresh({
    instanceId: options.instanceId,
    timeoutMs: options.timeoutMs,
    buildRuntime: options.buildRuntime === true,
  })
  return {
    driver,
    attached,
    windowClaim: driver.windowClaim,
  }
}

async function expectLoginGate(driver, timeoutMs = 30_000) {
  const ready = await waitFor(async () => {
    const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
    const account = await accountStatus(driver)
    return snapshot.gate && snapshot.github && snapshot.skip ? { ok: true, account } : null
  }, timeoutMs, 500)
  if (ready?.ok) return ready
  const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
  const account = await accountStatus(driver)
  return {
    ok: false,
    account,
    detail: account?.configured === false
      ? '账户服务未配置，看不见登录页'
      : `没看见登录页 github=${snapshot.github} skip=${snapshot.skip} state=${account?.state ?? ''}`,
  }
}

async function waitForHomepage(driver, timeoutMs = 15_000) {
  return waitFor(async () => {
    const snapshot = inspectLoginPage(await snapshotLoginPage(driver))
    return snapshot.gate ? null : true
  }, timeoutMs)
}

export async function runFirstUse(options = {}) {
  const instanceId = `plfu-${process.pid}-${Date.now().toString(36)}`
  const steps = []
  const notes = []
  const loginWaitMs = Number(options.loginWaitMs || FIRST_USE_LOGIN_WAIT_MS)
  const taskTimeoutMs = Number(options.taskTimeoutMs || 180_000)
  const desktopReadyMs = Number(options.desktopReadyMs || 240_000)
  let launch = null

  async function record(id, result, detail) {
    const step = { id, result, detail: redactProcessText(detail || '', 300) }
    if (typeof options.onStep === 'function' && launch?.driver) {
      try {
        step.screenshots = await options.onStep(id, launch.driver)
      } catch {
        step.screenshots = []
      }
    }
    steps.push(step)
    process.stdout.write(`FIRST-USE ${id} ${result} ${detail || ''}\n`)
  }

  async function closeLaunch() {
    if (!launch?.driver) return
    await launch.driver.close().catch(() => {})
    launch = null
  }

  try {
    launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      await record('login-gate', 'FAIL', launch.driver?.gaps?.join(' ') || '没附着独立产品窗口')
      return finish(steps, notes)
    }
    if (launch.windowClaim?.closed) notes.push(launch.windowClaim.detail)

    const gateA = await expectLoginGate(launch.driver)
    await record('login-gate', gateA.ok ? 'PASS' : 'FAIL', gateA.ok ? '看见登录页和两条入口' : gateA.detail)
    if (!gateA.ok) return finish(steps, notes)

    process.stdout.write('FIRST-USE login-github-active 请在系统浏览器完成 GitHub 授权\n')
    try {
      await launch.driver.invoke('StartAccountLogin', [])
    } catch (error) {
      await record('login-github-active', 'FAIL', redactProcessText(error instanceof Error ? error.message : error, 200))
    }
    if (steps.at(-1)?.id !== 'login-github-active') {
      const active = await waitFor(async () => {
        const status = await accountStatus(launch.driver)
        return status?.state === 'active' && status?.authenticated ? status : null
      }, loginWaitMs, 2_000)
      if (active) {
        await record('login-github-active', 'PASS', '账户变成已登录')
        await enableAccountRoute(launch.driver)
        await delay(1_500)
        let loop = await runFileLoop(launch.driver, {
          title: 'product-loop first-use account',
          modelMode: 'manual',
          modelProvider: 'tokenflux',
          modelId: resolveCustomRelayModels(process.env) || 'deepseek/deepseek-flash',
          modelSourcePreference: 'account',
          timeoutMs: taskTimeoutMs,
        })
        if (!loop.notes || loop.timeout) {
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
            ? `账户发不出，记预期（linked=${Boolean(active.tokenFluxLinked)}）`
            : loop.notes
              ? '账户来源写出 NOTES.md'
              : `NOTES.md=${loop.notes} fileTools=${loop.usedFiles} timeout=${loop.timeout} failed=${Boolean(loop.failed)} ${loop.detail || ''}`,
        )
      } else {
        const status = await accountStatus(launch.driver)
        await record(
          'login-github-active',
          'FAIL',
          `超时仍是 ${status?.state || 'unknown'}。在系统浏览器里完成授权；回调应回到这一扇测试窗。`,
        )
      }
    }

    const githubOk = steps.find(step => step.id === 'login-github-active')?.result === 'PASS'
    if (!githubOk) {
      const snapshot = inspectLoginPage(await snapshotLoginPage(launch.driver))
      if (snapshot.gate && snapshot.skip) {
        await launch.driver.cdp.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
          const button = buttons.find(item => /暂不登录，使用自己的 API Key|Skip sign-in and use your own API key/.test(item.textContent || ''))
          if (!button) return false
          button.click()
          return true
        })()`)
        await waitForHomepage(launch.driver)
      }
    }

    const relay = await saveCustomRelay(launch.driver)
    if (relay.ok) {
      await record('settings-custom-relay', 'PASS', relay.detail)
      await delay(1_500)
      const loop = await runFileLoop(launch.driver, {
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
    } else {
      const classified = classifyCustomRelaySave(relay.detail)
      await record(
        'settings-custom-relay',
        classified.result,
        classified.expectedMiss
          ? `个人中转站 Key 被产品正确拒绝，记预期（${relay.detail}）`
          : relay.detail,
      )
      await record(
        'relay-model-fileloop',
        classified.expectedMiss ? 'SKIP' : 'FAIL',
        classified.expectedMiss ? '个人中转站 Key 无效，后面用账户额度' : '上手流程没跑到这一步',
      )
    }

    if (githubOk) {
      await launch.driver.invoke('LogoutAccount', []).catch(() => {})
    }
    await resetContinueLocal(launch.driver)
    await closeLaunch()

    launch = await startFirstUseDesktop({ instanceId, timeoutMs: desktopReadyMs })
    if (!launch.attached || !launch.driver?.cdpAlive()) {
      await record('login-skip-local', 'FAIL', '启动 B 没附着独立窗口')
      return finish(steps, notes)
    }
    const gateB = await expectLoginGate(launch.driver)
    if (!gateB.ok) {
      await record('login-skip-local', 'FAIL', gateB.detail)
      return finish(steps, notes)
    }
    const clicked = await launch.driver.cdp.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const button = buttons.find(item => /暂不登录，使用自己的 API Key|Skip sign-in and use your own API key/.test(item.textContent || ''))
      if (!button) return false
      button.click()
      return true
    })()`)
    const home = clicked ? await waitForHomepage(launch.driver) : null
    const after = await accountStatus(launch.driver)
    if (home && after?.state !== 'active') {
      await record('login-skip-local', 'PASS', '暂不登录进了首页')
    } else {
      await record(
        'login-skip-local',
        'FAIL',
        `clicked=${Boolean(clicked)} home=${Boolean(home)} state=${after?.state ?? ''}`,
      )
    }
    let accountReady = steps.some(step => step.id === 'account-model-fileloop' && step.result === 'PASS')
    if (githubOk && launch.driver?.cdpAlive()) {
      process.stdout.write('FIRST-USE 暂不登录之后再登录，后面继续用账户模型\n')
      await launch.driver.invoke('StartAccountLogin', []).catch(() => {})
      const restored = await waitFor(async () => {
        const status = await accountStatus(launch.driver)
        return status?.state === 'active' && status?.authenticated ? status : null
      }, loginWaitMs, 2_000)
      if (restored) {
        await enableAccountRoute(launch.driver)
        accountReady = true
      }
    }
    return finish(steps, notes, sessionFrom(launch, instanceId, steps, options.keepOpen, accountReady))
  } catch (error) {
    await record('first-use', 'FAIL', redactProcessText(error instanceof Error ? error.message : error, 240))
    return finish(steps, notes, sessionFrom(launch, instanceId, steps, options.keepOpen))
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

function sessionFrom(launch, instanceId, steps, keepOpen, accountReady = false) {
  if (!shouldKeepLaunch(launch, steps, keepOpen)) {
    return { driver: null, instanceId, sourcesReady: false }
  }
  return {
    driver: launch.driver,
    instanceId,
    sourcesReady: accountReady === true || steps.some(step => (
      (step.id === 'account-model-fileloop' && step.result === 'PASS')
      || (step.id === 'relay-model-fileloop' && step.result === 'PASS')
    )),
  }
}

async function enableAccountRoute(driver) {
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

  const openedEditor = await waitFor(() => clickMatching(driver, ['新增模型服务', 'Add a model service']), 8_000)
  if (!openedEditor) return { ok: false, detail: '找不到新增模型服务' }
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
      return true
    }
    function byAria(patterns) {
      return Array.from(document.querySelectorAll('input')).find(item => {
        const label = item.getAttribute('aria-label') || ''
        return patterns.some(pattern => label.includes(pattern))
      })
    }
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return { ok: false, detail: '中转站对话框没打开' }
    if (fields.baseUrl && !setInput(byAria(['API 端点', 'API endpoint']), fields.baseUrl)) {
      return { ok: false, detail: '找不到 API 端点' }
    }
    if (fields.name && !setInput(byAria(['中转站名称', 'Relay name']), fields.name)) {
      return { ok: false, detail: '找不到中转站名称' }
    }
    if (fields.removeModels) {
      for (const button of Array.from(dialog.querySelectorAll('button[aria-label]'))) {
        const label = button.getAttribute('aria-label') || ''
        if (/^移除模型 |^Remove model /.test(label)) button.click()
      }
    }
    if (fields.model && !setInput(byAria(['模型 ID 或关键词前缀', 'Model ID or keyword prefix']), fields.model)) {
      return { ok: false, detail: '找不到模型输入' }
    }
    if (fields.apiKey && !setInput(byAria(['API Key']), fields.apiKey)) {
      return { ok: false, detail: '找不到 API Key 密码框' }
    }
    if (fields.addModel) {
      const add = Array.from(dialog.querySelectorAll('button')).find(item => /^(添加|Add)$/.test((item.textContent || '').trim()))
      if (!add) return { ok: false, detail: '找不到添加模型' }
      add.click()
    }
    if (fields.test) {
      const test = Array.from(dialog.querySelectorAll('button')).find(item => /测试连接|Test connection|正在测试|Testing/.test(item.textContent || ''))
      if (!test) return { ok: false, detail: '找不到测试连接' }
      test.click()
    }
    return { ok: true }
  }`
}

async function applyRelayEditorFields(driver, fields, apiKey) {
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

async function verifyStoredRelay(driver, described) {
  if (!described?.hasKey || !described.enabled || !described.models.length || !described.baseURL) {
    return { ok: false, detail: '' }
  }
  if (described.baseURL.includes('tokenflux.ai')) {
    return { ok: false, detail: '官方 TokenFlux 不能用 tokenflux.ai' }
  }
  try {
    const settings = await driver.invoke('GetSettings', [])
    const probe = await driver.invoke('TestAgentModel', [settings])
    if (probe?.ready === false) {
      return { ok: false, detail: '已存中转站测试连接没通过' }
    }
    return {
      ok: true,
      id: described.id,
      model: described.models[0],
      detail: '已存中转站，测试连接通过',
    }
  } catch (error) {
    return {
      ok: false,
      detail: redactProcessText(error instanceof Error ? error.message : error, 180),
    }
  }
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
      continue
    }
    const verified = await waitForRelayVerify(driver)
    if (!verified) {
      lastDetail = `${attempt.name} 测试连接没有回执`
      continue
    }
    if (!verified.ok) {
      lastDetail = `${attempt.name} ${redactProcessText(verified.text || '测试连接失败', 180)}`
      continue
    }
    const saved = await waitFor(async () => {
      const row = describeCustomRelay(await driver.invoke('GetSettings', []), firstUseRelayName())
      return row.hasKey && row.enabled && row.models.length ? row : null
    }, 15_000, 500)
    if (!saved) {
      lastDetail = `${attempt.name} 测试通过后中转站仍没有 Key`
      continue
    }
    if (saved.baseURL.includes('tokenflux.ai')) {
      return { ok: false, detail: '官方 TokenFlux 不能用 tokenflux.ai' }
    }
    await closeRelayEditor(driver)
    return {
      ok: true,
      id: saved.id,
      model: saved.models.includes(attempt.model) ? attempt.model : saved.models[0],
      detail: `在设置密码框填入 ${attempt.name}（回执不写 Key）`,
    }
  }
  await closeRelayEditor(driver)
  return { ok: false, detail: lastDetail || '设置页保存后中转站仍没有 Key' }
}

function finish(steps, notes, extras = {}) {
  const failed = steps.filter(step => step.result === 'FAIL')
  const required = ['login-gate', 'login-skip-local']
  const missing = required.filter(id => !steps.some(step => step.id === id && step.result === 'PASS'))
  const result = failed.length || missing.length ? 'FAIL' : 'PASS'
  return {
    result,
    detail: steps.map(step => `${step.id}:${step.result}`).join(' '),
    steps,
    notes,
    toolNames: [],
    driver: extras.driver ?? null,
    instanceId: extras.instanceId ?? '',
    sourcesReady: extras.sourcesReady === true,
  }
}
