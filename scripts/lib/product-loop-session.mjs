/**
 * Isolated Stable session for the product walk.
 * Does not attach an already-inside daily window. Does not inject Provider keys.
 */

import { rm } from 'node:fs/promises'
import {
  CdpSession,
  classifyTurnEvents,
  delay,
  isCompanionChatSurface,
  listDesktopCdpTargets,
} from './desktop-gui-driver.mjs'
import {
  resolveCompanionModelRoute,
  startFirstUseDesktop,
} from './product-loop-first-use.mjs'
import { keepExclusiveMilkSUWindow } from './product-loop-windows.mjs'

export { classifyTurnEvents }

export function turnHasSidecarStopped(turn) {
  if (!turn) return false
  if (turn.sidecarStopped) return true
  return (turn.events || []).some(event => String(event?.type ?? event?.Type ?? '') === 'engine.sidecar_stopped')
}

export function turnBroken(turn) {
  if (!turn) return '回合没有回执'
  if (turnHasSidecarStopped(turn)) return ''
  if (turn.failed) return turn.error || 'sidecar 在回合里停了'
  if (turn.timeout) return turn.error || '回合超时'
  return ''
}

const pendingWorkspaceReleases = []

export function deferProductLoopCleanup(job) {
  if (typeof job === 'function') pendingWorkspaceReleases.push(job)
}

export async function flushProductLoopCleanup() {
  const jobs = pendingWorkspaceReleases.splice(0)
  for (const job of jobs) {
    await job().catch(() => {})
  }
}

export async function releaseProductLoopWorkspace(driver, conversation, workspace) {
  deferProductLoopCleanup(async () => {
    const id = typeof conversation === 'string'
      ? conversation.trim()
      : String(conversation?.id ?? conversation?.ID ?? '').trim()
    if (driver && id) {
      await driver.abortMessage(id).catch(() => {})
      await delay(250)
      await driver.deleteConversation(id).catch(() => {})
      await delay(250)
    }
    if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => {})
  })
}

function visibleRootScript() {
  return `function pickVisibleRoot(rootSelector) {
    if (!rootSelector) return document
    const candidates = Array.from(document.querySelectorAll(rootSelector))
    return candidates.find(node => {
      const box = node.getBoundingClientRect()
      return box.width > 8 && box.height > 8
    }) || candidates[0] || null
  }`
}

function clickScript(mode) {
  return `function(patterns, rootSelector) {
    ${visibleRootScript()}
    const root = pickVisibleRoot(rootSelector)
    if (!root) return false
    const selector = ${JSON.stringify(mode === 'aria'
      ? 'button, [role="button"], [role="tab"]'
      : 'button, [role="button"]')}
    const nodes = Array.from(root.querySelectorAll(selector))
    const visible = nodes.filter(node => {
      const box = node.getBoundingClientRect()
      return box.width > 1 && box.height > 1
    })
    const ranked = visible.length ? visible : nodes
    let best = null
    let bestScore = 0
    for (const node of ranked) {
      const aria = node.getAttribute('aria-label') || ''
      const title = node.getAttribute('title') || ''
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim()
      const hay = ${mode === 'aria' ? 'aria' : '[aria, title, text].join(" ")'}
      let score = 0
      for (const pattern of patterns) {
        if (aria === pattern || title === pattern || text === pattern) score = Math.max(score, 3)
        else if (hay.includes(pattern)) score = Math.max(score, 1)
      }
      if (score > bestScore) {
        best = node
        bestScore = score
      }
    }
    if (!best) return false
    best.click()
    return true
  }`
}

export async function clickLabeled(driver, patterns, rootSelector = '') {
  return pageCall(driver, clickScript('label'), [patterns, rootSelector])
}

export async function clickAria(driver, patterns, rootSelector = '') {
  return pageCall(driver, clickScript('aria'), [patterns, rootSelector])
}

export async function clickRole(driver, role, patterns, rootSelector = '') {
  return driver.cdp.callFunction(`function(role, patterns, rootSelector) {
    const root = rootSelector ? document.querySelector(rootSelector) : document
    if (!root) return false
    const nodes = Array.from(root.querySelectorAll('[role="' + role + '"]'))
    for (const node of nodes) {
      const label = [node.getAttribute('aria-label') || '', node.textContent || ''].join(' ')
      if (patterns.some(pattern => label.includes(pattern))) {
        node.click()
        return true
      }
    }
    return false
  }`, [role, patterns, rootSelector])
}

export async function hoverLabeled(driver, patterns) {
  return pageCall(driver, `function(patterns) {
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'))
    for (const node of nodes) {
      const label = [node.getAttribute('aria-label') || '', node.textContent || ''].join(' ')
      if (!patterns.some(pattern => label.includes(pattern))) continue
      const box = node.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) continue
      node.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
      node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      node.click()
      return true
    }
    return false
  }`, [patterns])
}

export async function expandSidebar(driver) {
  const expanded = await driver.cdp.callFunction(`function() {
    const sidebar = document.querySelector('[data-testid="coding-context-drawer"]')
    if (sidebar?.getAttribute('data-sidebar-collapsed') !== 'true') return true
    const button = document.querySelector('[data-testid="coding-history-expand"], [aria-label="展开侧栏"], [aria-label="Expand sidebar"]')
    if (!button) return false
    button.click()
    return true
  }`).catch(() => false)
  if (expanded) await delay(200)
  return expanded
}

export async function revealConversationRows(driver) {
  await expandSidebar(driver)
  return pageCall(driver, `function() {
    for (const details of document.querySelectorAll('details.coding-project-group, details.coding-temporary-group')) {
      details.open = true
    }
    return true
  }`).catch(() => false)
}

export async function findConversationRow(driver, title) {
  return pageCall(driver, `function(title) {
    const row = Array.from(document.querySelectorAll('.agent-sidebar-item')).find(item => (item.textContent || '').includes(title))
    if (!row) return false
    row.scrollIntoView({ block: 'nearest' })
    return true
  }`, [title]).catch(() => false)
}

export async function openConversation(driver, title) {
  await driver.invoke('ShowCompanionMainWindow', [{ focus: false }]).catch(() => {})
  if (typeof driver.ensureAttached === 'function') {
    await driver.ensureAttached().catch(() => false)
  }
  await leaveSettings(driver)
  await revealConversationRows(driver)
  await dismissOverlays(driver)
  const clicked = await waitFor(() => pageCall(driver, `function(title) {
    const row = Array.from(document.querySelectorAll('.agent-sidebar-item')).find(item => (item.textContent || '').includes(title))
    if (row) {
      row.scrollIntoView({ block: 'nearest' })
      const button = row.querySelector('button.agent-sidebar-row')
        || Array.from(row.querySelectorAll('button')).find(node => (node.textContent || '').includes(title))
        || row.querySelector('button')
      ;(button || row).click()
      return true
    }
    return false
  }`, [title]), 8_000)
  if (!clicked) return false
  const selected = await waitFor(() => pageCall(driver, `function(title) {
    const current = document.querySelector('.agent-sidebar-item.is-current')
    return Boolean(current && (current.textContent || '').includes(title))
  }`, [title]), 4_000)
  await delay(400)
  return Boolean(selected)
}

export async function pageSnapshot(driver) {
  return driver.cdp.evaluate(`(() => ({
    aria: Array.from(document.querySelectorAll('[aria-label]')).map(node => node.getAttribute('aria-label') || ''),
    text: document.body ? document.body.innerText : '',
  }))()`)
}

export function snapshotHas(snapshot, patterns) {
  const hay = `${(snapshot?.aria || []).join('\n')}\n${snapshot?.text || ''}`
  return patterns.some(pattern => hay.includes(pattern))
}

export function snapshotText(snapshot) {
  return `${(snapshot?.aria || []).join('\n')}\n${snapshot?.text || ''}`
}

export function isNewConversationCanvas(snapshot) {
  return /我们要构建什么|我们在 .+ 中构建什么|What should we build/.test(snapshotText(snapshot))
}

async function pageCall(driver, functionDeclaration, args = []) {
  if (typeof driver.ensureAttached === 'function' && !await driver.ensureAttached()) {
    throw new Error('CDP WebSocket closed')
  }
  try {
    return await driver.cdp.callFunction(functionDeclaration, args)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (!/CDP WebSocket closed/i.test(text)) throw error
    if (driver.cdp) driver.cdp.closed = true
    if (typeof driver.ensureAttached !== 'function' || !await driver.ensureAttached()) throw error
    return driver.cdp.callFunction(functionDeclaration, args)
  }
}

function overlayLayerSelector() {
  return '[data-command-panel], [data-testid="command-panel"], [role="dialog"], [data-slot="dialog-content"], [cmdk-root], [role="menu"], [data-slot="dropdown-menu-content"]'
}

export async function overlayBlocking(driver) {
  if (!driver?.cdp) return false
  return Boolean(await pageCall(driver, `function(selector) {
    return Array.from(document.querySelectorAll(selector)).some(node => {
      const box = node.getBoundingClientRect()
      return box.width > 1 && box.height > 1
    })
  }`, [overlayLayerSelector()]).catch(() => false))
}

export async function dismissOverlays(driver) {
  if (!driver?.cdp) return false
  let closedAny = false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const state = await pageCall(driver, `function(selector) {
      const layers = Array.from(document.querySelectorAll(selector)).filter(node => {
        const box = node.getBoundingClientRect()
        return box.width > 1 && box.height > 1
      })
      if (!layers.length) return 'none'
      const cancel = Array.from(document.querySelectorAll('button')).find(node => {
        const box = node.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) return false
        const text = (node.textContent || '').trim()
        const label = node.getAttribute('aria-label') || ''
        return /^(取消|Cancel|关闭|Close)$/.test(text) || /关闭|Close/.test(label)
      })
      if (cancel) {
        cancel.click()
        return 'clicked'
      }
      const overlay = Array.from(document.querySelectorAll('[data-slot="dialog-overlay"]')).find(node => {
        const box = node.getBoundingClientRect()
        return box.width > 1 && box.height > 1
      })
      if (overlay) {
        const box = overlay.getBoundingClientRect()
        const x = box.left + 8
        const y = box.top + 8
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          const EventCtor = type.startsWith('pointer') ? PointerEvent : MouseEvent
          overlay.dispatchEvent(new EventCtor(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
          }))
        }
        return 'clicked'
      }
      const input = document.querySelector('[data-command-panel] input, [data-testid="command-panel"] input')
      if (input) input.focus()
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }))
      return 'escape'
    }`, [overlayLayerSelector()]).catch(() => 'open')
    if (state === 'none') return closedAny
    closedAny = true
    if (state !== 'clicked') {
      await driver.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      }).catch(() => {})
      await driver.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      }).catch(() => {})
    }
    await delay(180)
  }
  return false
}

export function pass(detail, extras = {}) {
  return { result: 'PASS', detail, ...extras }
}

export function fail(detail, extras = {}) {
  return { result: 'FAIL', detail, ...extras }
}

export function skip(detail, extras = {}) {
  return { result: 'SKIP', detail, ...extras }
}

export async function expectLabels(driver, patterns, okDetail, failDetail) {
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, patterns) ? pass(okDetail) : fail(failDetail)
}

export async function clickSettingsCategory(driver, labels) {
  return driver.cdp.callFunction(`function(labels) {
    const nav = document.querySelector('[aria-label="设置分类"], [aria-label="Settings categories"]')
    const buttons = Array.from((nav || document).querySelectorAll('button, [role="button"]'))
    const button = buttons.find(item => {
      const text = (item.textContent || '').trim()
      return labels.includes(text)
    })
    if (!button) return false
    button.click()
    return true
  }`, [labels])
}

export async function openSettings(driver) {
  await driver.invoke('ShowCompanionMainWindow', [{ focus: false }]).catch(() => {})
  await driver.ensureAttached()
  await expandSidebar(driver)
  if (snapshotHas(await pageSnapshot(driver), ['设置分类', 'Settings categories'])) return { ok: true }
  const clicked = await driver.cdp.callFunction(`function() {
    const button = document.querySelector('[data-testid="sidebar-open-settings"]')
    if (!button) return false
    button.click()
    return true
  }`)
  if (!clicked) return { ok: false, detail: '打不开设置' }
  await delay(400)
  return snapshotHas(await pageSnapshot(driver), ['设置分类', 'Settings categories'])
    ? { ok: true }
    : { ok: false, detail: '设置侧栏没出来' }
}

export async function openSettingsCategory(driver, labels) {
  const opened = await openSettings(driver)
  if (!opened.ok) return opened
  const clicked = await clickSettingsCategory(driver, labels)
  if (!clicked) return { ok: false, detail: `设置里找不到 ${labels[0]}` }
  await delay(350)
  return { ok: true }
}

export async function fillComposer(driver, text) {
  return pageCall(driver, `function(text) {
    const composers = Array.from(document.querySelectorAll('.chat-composer'))
    const composer = composers.find(node => {
      const box = node.getBoundingClientRect()
      return box.width > 8 && box.height > 8
    })
    if (!composer) return false
    const editor = composer.querySelector('[aria-label="消息"], [aria-label="Message"]')
    if (!editor) return false
    editor.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    selection.removeAllRanges()
    selection.addRange(range)
    document.execCommand('insertText', false, text)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
    return (editor.innerText || editor.textContent || '').includes(String(text).slice(0, 12))
  }`, [text])
}

export async function sendComposer(driver) {
  return pageCall(driver, `function() {
    const composers = Array.from(document.querySelectorAll('.chat-composer'))
    const composer = composers.find(node => {
      const box = node.getBoundingClientRect()
      return box.width > 8 && box.height > 8
    })
    if (!composer) return false
    const send = Array.from(composer.querySelectorAll('button, [role="button"]')).find(node => {
      const box = node.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return false
      const label = [node.getAttribute('aria-label') || '', node.getAttribute('title') || '', node.textContent || ''].join(' ')
      return /发送引导|Send steering|发送|Send/.test(label)
    })
    if (!send) return false
    send.click()
    return true
  }`)
}

export async function quoteConversationText(driver, marker) {
  const selected = await driver.cdp.callFunction(`function(marker) {
    const thread = document.querySelector('.agent-thread')
    if (!thread) return false
    const walker = document.createTreeWalker(thread, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent || ''
      const index = text.indexOf(marker)
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + marker.length)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      const box = (node.parentElement || thread).getBoundingClientRect()
      thread.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 12,
        clientY: box.top + 12,
        button: 2,
      }))
      return true
    }
    return false
  }`, [marker])
  if (!selected) return false
  await delay(200)
  return clickLabeled(driver, ['加入对话', 'Add to conversation'])
}

export async function fillAria(driver, labels, value) {
  return driver.cdp.callFunction(`function(labels, value) {
    const nodes = Array.from(document.querySelectorAll('input, textarea'))
    const node = nodes.find(item => labels.includes(item.getAttribute('aria-label') || ''))
    if (!node) return false
    const proto = node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(node, value)
    else node.value = value
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }`, [labels, value])
}

export async function pressMetaKey(driver, key) {
  await driver.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 4, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) })
  await driver.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 4, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) })
}

export async function waitFor(predicate, timeoutMs, intervalMs = 400) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeoutMs) {
    last = await predicate()
    if (last) return last
    await delay(intervalMs)
  }
  return last
}

export async function openWorkspace(driver, labels) {
  await dismissOverlays(driver)
  const clicked = await waitFor(() => clickLabeled(driver, labels), 8_000)
  if (!clicked) return { ok: false, detail: `侧栏找不到 ${labels[0]}` }
  await delay(400)
  return { ok: true }
}

export async function leaveSettings(driver) {
  if (!snapshotHas(await pageSnapshot(driver), ['设置分类', 'Settings categories'])) return true
  await clickLabeled(driver, ['返回', 'Back']).catch(() => false)
  await delay(300)
  return true
}

export async function enterHomepageSkipLocal(driver) {
  const snapshot = await pageSnapshot(driver)
  if (!/登录 MilkSU|Sign in to MilkSU/.test(`${(snapshot.aria || []).join('\n')}\n${snapshot.text || ''}`)) {
    return { ok: true, skipped: true }
  }
  const clicked = await clickLabeled(driver, ['暂不登录，使用自己的 API Key', 'Skip sign-in and use your own API key'])
  if (!clicked) return { ok: false, detail: '登录页找不到暂不登录' }
  const home = await waitFor(async () => {
    const next = await pageSnapshot(driver)
    return /登录 MilkSU|Sign in to MilkSU/.test(`${(next.aria || []).join('\n')}\n${next.text || ''}`) ? null : true
  }, 15_000)
  return home ? { ok: true } : { ok: false, detail: '点了暂不登录仍停在登录页' }
}

/**
 * The phone paints 「这个来源还没有密钥」 when it opens before the relay exists.
 * Saving settings does not clear that composer line, so reload the phone once
 * the personal relay is in place and wait until the line is gone.
 */
export async function reloadCompanionAfterRelay(driver) {
  const port = driver?.preferredPort
  if (!port) return
  const targets = await listDesktopCdpTargets({ port }).catch(() => [])
  const chats = targets.filter(isCompanionChatSurface)
  if (!chats.length) return
  await driver.stopCompanion().catch(() => {})
  for (const target of chats) {
    const session = new CdpSession(target.webSocketDebuggerUrl)
    try {
      await session.open()
      await session.evaluate('location.reload()')
    } catch {
      // Navigation closes the socket.
    } finally {
      session.close()
    }
  }
  const started = Date.now()
  while (Date.now() - started < 20_000) {
    await delay(500)
    const next = await listDesktopCdpTargets({ port }).catch(() => [])
    const chat = next.find(isCompanionChatSurface)
    if (!chat) continue
    const session = new CdpSession(chat.webSocketDebuggerUrl)
    try {
      await session.open()
      const state = await session.evaluate(`(() => {
        const root = document.querySelector('[data-testid="companion-chat"]')
        const text = document.body ? document.body.innerText : ''
        return {
          ready: Boolean(root),
          missingKey: /这个来源还没有密钥|This Companion source has no key/.test(text),
        }
      })()`)
      if (state?.ready && !state.missingKey) return
    } catch {
      // The phone is still reloading.
    } finally {
      session.close()
    }
  }
}

export async function sourcesReady(driver) {
  const route = await resolveCompanionModelRoute(driver).catch(() => ({ ok: false, source: 'none' }))
  return route.ok === true
}

export async function ensureIsolatedProductSession(session = {}, options = {}) {
  if (session.driver?.cdpAlive()) {
    // Reuse the attached CDP session; do not ShowCompanionMainWindow (steals OS focus).
    await session.driver.ensureAttached()
    await keepExclusiveMilkSUWindow({ driver: session.driver, log: true })
    await expandSidebar(session.driver).catch(() => {})
    await dismissOverlays(session.driver).catch(() => {})
    await leaveSettings(session.driver).catch(() => {})
    const gate = await enterHomepageSkipLocal(session.driver)
    if (!gate.ok) return { ...session, ok: false, detail: gate.detail }
    return {
      ...session,
      ok: true,
      reused: true,
      sourcesReady: session.sourcesReady || await sourcesReady(session.driver),
    }
  }
  const instanceId = session.instanceId || `plmod-${process.pid}-${Date.now().toString(36)}`
  const launch = await startFirstUseDesktop({
    instanceId,
    timeoutMs: options.desktopReadyMs || 240_000,
    buildRuntime: options.buildRuntime === true || process.env.MILKSU_PRODUCT_LOOP_BUILD === '1',
  })
  if (!launch.attached || !launch.driver?.cdpAlive()) {
    return {
      driver: launch.driver,
      instanceId,
      ok: false,
      sourcesReady: false,
      detail: launch.driver?.gaps?.join(' ') || '没附着独立产品窗口',
    }
  }
  const gate = await enterHomepageSkipLocal(launch.driver)
  if (!gate.ok) {
    return { driver: launch.driver, instanceId, ok: false, sourcesReady: false, detail: gate.detail }
  }
  return {
    driver: launch.driver,
    instanceId,
    ok: true,
    reused: false,
    sourcesReady: await sourcesReady(launch.driver),
  }
}
