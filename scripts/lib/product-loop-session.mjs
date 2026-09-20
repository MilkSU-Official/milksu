/**
 * Isolated Stable session for the product walk.
 * Does not attach an already-inside daily window. Does not inject Provider keys.
 */

import { delay, desktopTargetKey, listDesktopCdpTargets } from './desktop-gui-driver.mjs'
import {
  describeCustomRelay,
  firstUseRelayName,
  startFirstUseDesktop,
} from './product-loop-first-use.mjs'

export async function clickLabeled(driver, patterns) {
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

export function pass(detail) {
  return { result: 'PASS', detail }
}

export function fail(detail) {
  return { result: 'FAIL', detail }
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
  if (snapshotHas(await pageSnapshot(driver), ['设置分类', 'Settings categories'])) return { ok: true }
  const clicked = await clickLabeled(driver, ['设置', 'Settings'])
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
  return driver.cdp.callFunction(`function(text) {
    const editor = document.querySelector('[aria-label="消息"], [aria-label="Message"]')
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
  return clickLabeled(driver, ['发送引导', 'Send steering', '发送', 'Send'])
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

async function waitFor(predicate, timeoutMs, intervalMs = 400) {
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

export async function sourcesReady(driver) {
  const creds = await driver.credentialPresent()
  if (creds !== 'none') return true
  const relay = describeCustomRelay(await driver.invoke('GetSettings', []).catch(() => ({})), firstUseRelayName())
  return Boolean(relay.hasKey && relay.enabled && relay.models.length)
}

export async function ensureIsolatedProductSession(session = {}, options = {}) {
  if (session.driver?.cdpAlive()) {
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
  const existing = await listDesktopCdpTargets()
  const instanceId = session.instanceId || `plmod-${process.pid}-${Date.now().toString(36)}`
  const launch = await startFirstUseDesktop({
    instanceId,
    timeoutMs: options.desktopReadyMs || 240_000,
    excludeKeys: new Set(existing.map(desktopTargetKey)),
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
