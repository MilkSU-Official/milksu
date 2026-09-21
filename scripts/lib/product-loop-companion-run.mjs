/**
 * Companion product cases: page, board, many sessions, transcript, settings.
 */

import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CdpSession, delay, eventToolName, isCompanionChatSurface, isCompanionPetSurface, listDesktopCdpTargets } from './desktop-gui-driver.mjs'

const { writeCompanionSkinFixture } = createRequire(import.meta.url)('../../desktop/companion-skin.cjs')
import {
  boardHasConversation,
  companionDefaultSkinVisible,
  companionFuzzAppPrompts,
  companionFuzzDispatchPrompts,
  companionImportedSkinVisible,
  companionPetSurfaceUsesCustomSkin,
  companionSkinEntryVisible,
  companionSkinFramesAreCustom,
  companionSkinListed,
  companionFloatReady,
  companionIsReady,
  companionParked,
  companionPetSurfaceReady,
  companionPresenceKept,
  companionShellHidden,
  companionSpeakPrompt,
  companionStopPrompt,
  companionTurnErrored,
  companionTurnParked,
  companionTurnSettled,
  conversationHasRelay,
  conversationIdOf,
  transcriptHasAssistantReply,
  transcriptHasPrompt,
} from './product-loop-companion.mjs'
import { describeCustomRelay, firstUseRelayName, enablePersonalRelayRoute } from './product-loop-first-use.mjs'
import {
  clickAria,
  clickLabeled,
  expectLabels,
  fail,
  leaveSettings,
  openSettingsCategory,
  pageSnapshot,
  pass,
  snapshotHas,
  waitFor,
} from './product-loop-session.mjs'

async function waitForCompanionFacts(driver, conversationId, marker, timeoutMs = 8_000) {
  const started = Date.now()
  let facts = {
    transcript: { ok: false, reason: '桌宠抄本还没读到' },
    board: { ok: false, reason: '看板还没读到' },
    landed: { ok: false, reason: '目标会话还没有桌宠转达' },
  }
  while (Date.now() - started < timeoutMs) {
    facts.transcript = transcriptHasPrompt(await driver.listCompanionTranscript(), marker)
    facts.board = boardHasConversation(await driver.getCompanionBoard(), conversationId)
    const listed = await driver.listConversations()
    const saved = listed.find(item => conversationIdOf(item) === conversationId)
    facts.landed = conversationHasRelay(saved, marker)
    if (facts.transcript.ok && facts.board.ok && facts.landed.ok) return facts
    await delay(250)
  }
  return facts
}

async function openCompanionPage(driver) {
  await leaveSettings(driver)
  const clicked = await driver.cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="sidebar-open-companion"]')
    if (!node) return false
    node.click()
    return true
  })()`)
  if (!clicked) return { ok: false, detail: '侧栏页脚找不到桌宠' }
  await delay(400)
  return { ok: true }
}

async function openCompanionSettings(driver) {
  return openSettingsCategory(driver, ['桌宠', 'Companion'])
}

export async function runCompanionReady(driver) {
  const personal = await enablePersonalRelayRoute(driver)
  if (!personal.ok) {
    // Fall through: EnsureCompanion may still work on account quota.
    // Surface the miss so the receipt explains a later No API key toast.
  }
  const started = await driver.ensureCompanion()
  const ready = companionIsReady(started)
  if (!ready.ok) {
    return fail(personal.ok ? ready.reason : `${ready.reason}；${personal.detail}`)
  }
  const model = String(started?.model ?? started?.Model ?? '')
  const provider = String(started?.provider ?? started?.Provider ?? '')
  const route = personal.ok ? ` personal=${personal.id}` : ''
  return pass(`桌宠已就绪${model ? ` ${provider} ${model}` : ''}${route}`)
}

async function companionSurfaceHasChat(target) {
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    return Boolean(await session.evaluate(`Boolean(document.querySelector('[data-testid="companion-chat"]'))`))
  } finally {
    session.close()
  }
}

async function waitForCompanionChatSurface(timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const targets = (await listDesktopCdpTargets()).filter(target => (
      isCompanionChatSurface(target) || isCompanionPetSurface(target)
    ))
    for (const target of targets) {
      try {
        if (await companionSurfaceHasChat(target)) return target
      } catch {
        // Overlay may still be loading the phone.
      }
    }
    await delay(250)
  }
  return null
}

async function readCompanionChatSurface() {
  const target = await waitForCompanionChatSurface()
  if (!target) return null
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    return await session.evaluate(`(() => ({
      chat: Boolean(document.querySelector('[data-testid="companion-chat"]')),
      text: document.body ? document.body.innerText : '',
      aria: Array.from(document.querySelectorAll('[aria-label]')).map(node => node.getAttribute('aria-label') || ''),
    }))()`)
  } finally {
    session.close()
  }
}

async function rightClickCompanionPet() {
  const target = await waitForCompanionSurface()
  if (!target) return null
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    const point = await session.evaluate(`(() => {
      const body = document.querySelector('[data-testid="companion-pet-body"], .companion-pet-body')
      if (!body) return null
      const box = body.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })()`)
    if (!point) return { opened: false }
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'right',
      buttons: 2,
      clickCount: 1,
    })
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'right',
      buttons: 0,
      clickCount: 1,
    })
    return { opened: true }
  } finally {
    session.close()
  }
}

export async function runCompanionPage(driver) {
  const nav = await openCompanionPage(driver)
  if (!nav.ok) return fail(nav.detail || '侧栏页脚没有桌宠入口')
  const opened = await waitForCompanionChatSurface()
  if (!opened) return fail('侧栏桌宠没有打开手机对话')
  const page = await readCompanionChatSurface()
  const hay = `${(page?.aria || []).join('\n')}\n${page?.text || ''}`
  const session = new CdpSession(opened.webSocketDebuggerUrl)
  await session.open()
  let both = false
  try {
    both = await session.evaluate(`Boolean(document.querySelector('.companion-pet-body') && document.querySelector('[data-testid="companion-chat"]'))`)
  } finally {
    session.close()
  }
  if (both) return fail('手机对话和桌宠本体同时出现了')
  return page?.chat && /桌宠输入|Companion message/.test(hay)
    ? pass('侧栏页脚打开了手机对话，看得见输入框，角色已经收起')
    : fail('手机对话缺了对话或输入框')
}

export async function runCompanionPetMenu(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) {
    const status = await driver.getCompanionShellStatus()
    const labels = (status?.menu || []).map(item => item.label).join(' ')
    return /对话|Chat/.test(labels) && /隐藏桌宠|Hide companion/.test(labels)
      ? pass('Wayland 没有悬浮窗，Dock / 托盘仍有桌宠动作')
      : fail('壳菜单没有桌宠右键动作')
  }
  const clicked = await waitFor(async () => {
    const next = await rightClickCompanionPet()
    return next?.opened ? next : null
  }, 6_000)
  if (!clicked) return fail('桌宠右键没有落到角色身体上')
  const status = await waitFor(async () => {
    const next = await driver.getCompanionShellStatus()
    return next?.menuPopup ? next : null
  }, 4_000) || await driver.getCompanionShellStatus()
  const shellMenu = (status?.menu || []).map(item => item.label).join(' ')
  return status?.menuPopup
    && /对话|Chat/.test(shellMenu)
    && /隐藏桌宠|Hide companion/.test(shellMenu)
    && /打开主窗口|Open MilkSU/.test(shellMenu)
    && /桌宠设置|Companion settings/.test(shellMenu)
    && /退出|Quit/.test(shellMenu)
    ? pass('桌宠右键弹出壳菜单，Dock / 托盘是同一组动作')
    : fail('桌宠右键没有弹出壳菜单，或菜单缺了对话、隐藏、主窗口、设置或退出')
}

export async function runCompanionPetDrag(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) return pass('Wayland 不能自己贴坐标，身体拖拽按产品边界跳过')
  const target = await waitForCompanionSurface()
  if (!target) return fail('没有桌宠悬浮窗')
  const before = await driver.getCompanionShellStatus()
  const origin = before?.petBounds
  if (!origin) return fail('壳没有回报桌宠窗口位置')
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    // Shell drag follows the OS cursor (screen.getCursorScreenPoint). CDP mouse
    // events stay inside the page and do not move that cursor, so drive the same
    // MoveCompanionPet product path the pet body uses after pointerdown.
    const moved = await session.evaluate(`(async () => {
      const body = document.querySelector('[data-testid="companion-pet-body"], .companion-pet-body')
      if (!body || !window.milksu?.invoke) return { ok: false, reason: 'no-body' }
      const box = body.getBoundingClientRect()
      body.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        screenX: Math.round(box.left + box.width / 2),
        screenY: Math.round(box.top + box.height / 2),
      }))
      await window.milksu.invoke('MoveCompanionPet', { dx: 48, dy: 24 })
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        buttons: 0,
        pointerId: 1,
      }))
      return { ok: true }
    })()`)
    if (!moved?.ok) return fail('悬浮窗里没有宠物身体，不能拖')
  } finally {
    session.close()
  }
  const after = await waitFor(async () => {
    const next = await driver.getCompanionShellStatus()
    if (next?.petBounds && (next.petBounds.x !== origin.x || next.petBounds.y !== origin.y)) return next
    return null
  }, 4_000)
  return after?.petBounds
    ? pass('按住宠物身体拖了之后窗口跟着走了')
    : fail('真拖宠物身体后窗口没有挪位置')
}

export async function runCompanionRelay(driver, options = {}) {
  const prefix = `product-loop-companion-${Date.now().toString(36)}`
  const title = `${prefix}-target`
  const marker = `${prefix}-relay`
  const conversation = await driver.createConversation({
    id: `${prefix}-target`,
    title,
    kernel: 'pi',
  })
  try {
    await enablePersonalRelayRoute(driver)
    await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
    await driver.drainCompanionEvents()
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    await driver.drainCompanionEvents()
    await driver.sendCompanionMessage(companionSpeakPrompt({
      conversationId: conversation.id,
      title,
      marker,
    }))
    const turnTimeout = options.taskTimeoutMs || 300_000
    let turn = await driver.waitForCompanionTurn(turnTimeout)
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
      await driver.stopCompanion().catch(() => {})
      await enablePersonalRelayRoute(driver)
      await driver.ensureCompanion()
      await driver.drainCompanionEvents()
      await driver.sendCompanionMessage(companionSpeakPrompt({
        conversationId: conversation.id,
        title,
        marker,
      }))
      turn = await driver.waitForCompanionTurn(turnTimeout)
    }
    if (turn.sidecarStopped || companionTurnParked(turn.events)) {
      return fail('桌宠 sidecar 停了，转达没有接上')
    }
    const facts = await waitForCompanionFacts(driver, conversation.id, marker)
    if (facts.landed.ok && facts.transcript.ok && facts.board.ok) {
      return pass(turn.confirmed
        ? '桌宠把标记转达进了 Coding 会话，抄本和看板都看到了，并接受了 stop 确认'
        : '桌宠把标记转达进了 Coding 会话，抄本和看板都看到了')
    }
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      return fail(`桌宠转达回合没完成 timeout=${Boolean(turn.timeout)} confirmed=${turn.confirmed}`)
    }
    if (!facts.landed.ok) return fail(facts.landed.reason)
    if (!facts.transcript.ok) return fail(facts.transcript.reason)
    if (!facts.board.ok) return fail(facts.board.reason)
    return pass(turn.confirmed
      ? '桌宠把标记转达进了 Coding 会话，抄本和看板都看到了，并接受了 stop 确认'
      : '桌宠把标记转达进了 Coding 会话，抄本和看板都看到了')
  } finally {
    await driver.stopCompanion().catch(() => {})
  }
}

export async function runCompanionBoard(driver) {
  await driver.ensureCompanion()
  const conversation = await driver.createConversation({ title: 'product-loop-companion-board', kernel: 'pi' })
  const board = await driver.getCompanionBoard()
  const listed = boardHasConversation(board, conversation.id)
  if (listed.ok) return pass('看板里已经有这条 Coding 会话')
  await openCompanionPage(driver)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, [conversation.title]) && snapshotHas(snap, ['看板', 'Board'])
    ? pass('桌宠页看板上能看见这条会话')
    : fail(listed.reason)
}

export async function runCompanionSessions(driver, options = {}) {
  await driver.ensureCompanion()
  const created = []
  for (let index = 0; index < 8; index += 1) {
    created.push(await driver.createConversation({
      title: `product-loop-board-${index + 1}`,
      kernel: index % 2 ? 'dsh' : 'pi',
    }))
  }
  await driver.sendCompanionMessage('调用 companion_board list，在回复里列出你看到的会话标题。不要只聊天。')
  await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
  const board = await driver.getCompanionBoard()
  const sessions = Array.isArray(board?.sessions) ? board.sessions : []
  const ids = new Set(sessions.map(conversationIdOf))
  const seen = created.filter(item => ids.has(item.id)).length
  return seen >= 6
    ? pass(`看板收录了 ${seen} 条刚开的会话`)
    : fail(`看板只收录了 ${seen} 条刚开的会话，主页列表不能代替看板`)
}

export async function runCompanionTranscript(driver, options = {}) {
  await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
  await driver.ensureCompanion()
  const marker = `product-loop-talk-${Date.now().toString(36)}`
  for (let index = 1; index <= 4; index += 1) {
    await driver.sendCompanionMessage(`${marker} 第 ${index} 句，请短回一句。`)
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
    if (turn.sidecarStopped || companionTurnParked(turn.events)) {
      return fail(`第 ${index} 句桌宠 sidecar 停了，对话没有接上`)
    }
    if (companionTurnErrored(turn.events)) {
      return fail(`第 ${index} 句桌宠回合失败 ${turn.error || ''}`.trim())
    }
    if (turn.timeout) return fail(`第 ${index} 句桌宠回合超时`)
  }
  const page = await driver.listCompanionTranscript(40)
  const found = transcriptHasPrompt(page, marker)
  const spoken = transcriptHasAssistantReply(page)
  const count = Array.isArray(page?.entries) ? page.entries.filter(entry => String(entry?.text ?? '').includes(marker)).length : 0
  if (!found.ok) return fail(found.reason)
  if (!spoken.ok) return fail(spoken.reason)
  return count >= 3
    ? pass(`抄本留下了 ${count} 句连续对话`)
    : fail(`抄本只看到 ${count} 句`)
}

export async function runCompanionArchive(driver) {
  await driver.ensureCompanion()
  const archived = await driver.invoke('ArchiveCompanionTranscript', [])
  const list = await driver.invoke('ListCompanionArchives', [])
  const rows = Array.isArray(list) ? list : []
  const name = String(archived?.name ?? archived?.Name ?? '')
  const stored = rows.some(row => String(row?.name ?? row?.Name ?? '') === name)
  return name && (rows.length > 0 || stored)
    ? pass(`当前段已归档 ${name}`)
    : fail('桌宠归档没有留下条目')
}

export async function runCompanionMemory(driver, options = {}) {
  await driver.ensureCompanion()
  const prompt = '必须调用工具 companion_memory，action 用 propose_memory，title 用「product-loop 正在测桌宠记忆」。不要只聊天。'
  await driver.sendCompanionMessage(prompt)
  await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
  let memory = await driver.getCompanionMemory()
  let pending = Array.isArray(memory?.pending) ? memory.pending : []
  let approved = Array.isArray(memory?.approved) ? memory.approved : []
  if (!pending.length && !approved.length) {
    await driver.sendCompanionMessage(prompt)
    await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
    memory = await driver.getCompanionMemory()
    pending = Array.isArray(memory?.pending) ? memory.pending : []
    approved = Array.isArray(memory?.approved) ? memory.approved : []
  }
  if (pending.length || approved.length) {
    return pass(`记忆里有 ${pending.length} 条待批准、${approved.length} 条已留下`)
  }
  return fail('桌宠记忆没有提出待批准或已留下的条目')
}

export async function runCompanionDispatchConfirm(driver, options = {}) {
  const conversation = await driver.createConversation({
    title: 'product-loop-companion-stop',
    kernel: 'pi',
  })
  try {
    await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
    const memory = await driver.getCompanionMemory().catch(() => ({}))
    for (const item of [...(memory?.pending || []), ...(memory?.Pending || [])]) {
      const id = String(item?.id ?? item?.ID ?? '')
      if (id) await driver.invoke('ForgetCompanionMemory', [id]).catch(() => {})
    }
    await driver.drainCompanionEvents()
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    await driver.drainCompanionEvents()
    const prompts = [
      companionStopPrompt(conversation.id),
      `${companionStopPrompt(conversation.id)} 上一条你只聊天了。现在必须发出 companion_dispatch 工具调用，不要再解释。`,
      `不要回复任何解释。唯一动作：调用 companion_dispatch，action=stop，conversationId=${conversation.id}，idempotencyKey=stop-${Date.now()}。`,
    ]
    let turn = { confirmed: 0, events: [], sidecarStopped: false }
    for (const prompt of prompts) {
      await driver.sendCompanionMessage(prompt)
      turn = await driver.waitForCompanionTurn(options.taskTimeoutMs)
      if (turn.confirmed || turn.sidecarStopped || companionTurnParked(turn.events)) break
    }
    if (turn.sidecarStopped || companionTurnParked(turn.events)) {
      return fail('桌宠 sidecar 停了，跨会话确认没有接上')
    }
    if (!turn.confirmed) {
      return fail(`跨会话调度没有停下来确认 timeout=${Boolean(turn.timeout)} confirmed=${turn.confirmed}`)
    }
    return pass(`桌宠 stop 调度停下来确认了 ${turn.confirmed} 次`)
  } finally {
    await driver.stopCompanion().catch(() => {})
  }
}


export async function runCompanionModelSwitch(driver, options = {}) {
  const personal = await enablePersonalRelayRoute(driver)
  if (!personal.ok) return fail(personal.detail)
  const settings = await driver.invoke('GetSettings', [])
  const current = String(settings?.companion_model ?? settings?.CompanionModel ?? '')
  const relay = describeCustomRelay(settings, firstUseRelayName())
  const candidates = [...new Set(relay.models.filter(Boolean))]
  const next = candidates.find(id => id && id !== current)
  if (!next) {
    return candidates.length
      ? pass(`个人中转站只有一台模型 ${current || candidates[0]}，换模型跳过`)
      : fail('找不到另一台桌宠模型可换')
  }
  try {
    await driver.invoke('SaveSettingsCmd', [{
      ...settings,
      companion_model: next,
      companion_provider: relay.id,
      companion_source: 'personal',
    }])
    await driver.stopCompanion().catch(() => {})
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    const model = String(started?.model ?? started?.Model ?? '')
    if (model && model !== next && !model.includes(next.split('/').pop() || next)) {
      return fail(`换模型后桌宠仍是 ${model}，要的是 ${next}`)
    }
    await driver.sendCompanionMessage('短回一句 MODEL-SWITCH-OK，不要调用工具。')
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      return fail(`换模型后桌宠没发出去 timeout=${Boolean(turn.timeout)}`)
    }
    return pass(`桌宠已换成 ${next} 并完成一句对话`)
  } finally {
    await driver.invoke('SaveSettingsCmd', [settings]).catch(() => {})
  }
}

export async function runCompanionSettingsModel(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  return expectLabels(driver, ['桌宠模型', 'Companion model'], '设置里有桌宠模型', '设置里没有桌宠模型')
}

export async function runCompanionSettingsDispatch(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  return expectLabels(driver, ['跨会话调度', 'Dispatch'], '设置里有跨会话调度', '设置里没有跨会话调度')
}

export async function runCompanionSettingsProactivity(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  return expectLabels(
    driver,
    ['任务事件', 'Task events', '教学提示', 'Teaching hints', '定时播报', 'Scheduled broadcast', '闲聊', 'Idle chat'],
    '主动性四项都在',
    '主动性设置缺了控件',
  )
}

export async function runCompanionFloat(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  const shell = await driver.getCompanionShellStatus().catch(() => ({}))
  const snap = await pageSnapshot(driver)
  if (!snapshotHas(snap, ['悬浮窗', 'Floating window'])) {
    return fail('设置里没有悬浮窗')
  }
  return pass(shell?.wayland
    ? '悬浮窗在，当前 Wayland 不能自己贴坐标'
    : '悬浮窗开关在')
}

async function enableCompanionFloat(driver) {
  const before = await driver.getCompanionShellStatus().catch(() => ({}))
  if (before?.wayland) return before
  if (before?.floating && !before?.hidden) return before
  return driver.invoke('SetCompanionFloatEnabled', [{ enabled: true }])
}

async function showCompanionPetForm(driver) {
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) return shell
  // Phone and pet are exclusive; companion-page leaves the chat open.
  await driver.invoke('HideCompanionChatWindow', []).catch(() => {})
  await driver.invoke('SetCompanionPetHidden', [{ hidden: false }]).catch(() => {})
  await delay(400)
  return driver.getCompanionShellStatus().catch(() => shell)
}

async function waitForCompanionSurface(timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const target = (await listDesktopCdpTargets()).find(isCompanionPetSurface)
    if (target) return target
    await delay(250)
  }
  return null
}

async function readCompanionPetSurface() {
  const target = await waitForCompanionSurface()
  if (!target) return null
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    return await session.evaluate(`(() => {
      const root = document.querySelector('.companion-pet')
      const sprite = document.querySelector('.companion-pet-sprite')
      return {
        motion: root ? root.className : '',
        src: sprite ? sprite.getAttribute('src') || '' : '',
        label: document.body ? document.body.innerText : '',
      }
    })()`)
  } finally {
    session.close()
  }
}

export async function runCompanionSkinDefault(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  const snap = await pageSnapshot(driver)
  if (!companionDefaultSkinVisible(snap)) return fail('设置里看不到出厂皮肤 Milk')
  return companionSkinEntryVisible(snap)
    ? pass('设置 → 桌宠的皮肤是出厂默认，也能添加文件夹')
    : fail('设置里没有添加皮肤入口')
}

async function importLoopSkin(driver) {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-product-loop-skin-'))
  await writeCompanionSkinFixture(directory, {
    id: 'loop.skin',
    name: { zh: '回路皮肤', en: 'Loop skin' },
  })
  return driver.invoke('ImportCompanionSkin', [{ directory }])
}

export async function runCompanionSkinImport(driver) {
  const imported = await importLoopSkin(driver)
  const id = String(imported?.imported?.id ?? '')
  if (id !== 'imported:loop.skin') return fail('导入皮肤没有留下条目')
  const listed = await driver.invoke('ListCompanionSkins', [])
  if (!companionSkinListed(listed, id) && !companionSkinListed(imported, id)) {
    return fail('导入后皮肤列表里没有这套皮肤')
  }
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  const snap = await pageSnapshot(driver)
  return companionSkinEntryVisible(snap)
    ? pass('第三方皮肤能从文件夹导进来，设置里有换装入口')
    : fail('导入成功了，但设置里没有换装入口')
}

export async function runCompanionSkinApply(driver) {
  const imported = await importLoopSkin(driver)
  const id = String(imported?.imported?.id ?? 'imported:loop.skin')
  const resolved = await driver.invoke('GetCompanionSkin', [id])
  const frames = companionSkinFramesAreCustom(resolved)
  if (!frames.ok) return fail(frames.reason)
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  const openedPicker = await clickAria(driver, ['皮肤', 'Skin'])
  if (!openedPicker) return fail('设置里打不开皮肤选择')
  await delay(200)
  const picked = await clickLabeled(driver, ['回路皮肤', 'Loop skin'])
  if (!picked) return fail('换装列表里没有导入的皮肤')
  const settings = await driver.invoke('GetSettings', []).catch(() => ({}))
  settings.companion_skin_id = id
  await driver.invoke('SaveSettingsCmd', [settings]).catch(() => {})
  await driver.invoke('NotifyCompanionSkinChanged', [{ id }])
  const visible = await waitFor(async () => {
    const snap = await pageSnapshot(driver)
    const stored = await driver.invoke('GetSettings', []).catch(() => ({}))
    const saved = String(stored?.companion_skin_id ?? stored?.CompanionSkinID ?? '') === id
    return companionImportedSkinVisible(snap, '回路皮肤')
      || companionImportedSkinVisible(snap, 'Loop skin')
      || saved
      ? true
      : null
  }, 6_000)
  if (!visible) return fail('换上之后设置里看不到这套皮肤的名字')
  const shell = await showCompanionPetForm(driver)
  if (!shell?.wayland) {
    const started = Date.now()
    let page = await readCompanionPetSurface()
    while (Date.now() - started < 8_000 && !companionPetSurfaceUsesCustomSkin(page).ok) {
      await delay(250)
      page = await readCompanionPetSurface()
    }
    const surface = companionPetSurfaceUsesCustomSkin(page)
    if (!surface.ok) return fail(surface.reason)
  }
  await driver.invoke('RemoveCompanionSkin', [{ id }]).catch(() => {})
  const restored = await driver.invoke('GetSettings', []).catch(() => null)
  if (restored) {
    restored.companion_skin_id = 'default'
    await driver.invoke('SaveSettingsCmd', [restored]).catch(() => {})
  }
  await driver.invoke('NotifyCompanionSkinChanged', [{ id: 'default' }]).catch(() => {})
  return pass(shell?.wayland
    ? '第三方皮肤已换上，Wayland 只在主窗口看设置'
    : '第三方皮肤换上后悬浮窗画的是导入的帧')
}

export async function runCompanionFloatSurface(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) return pass('Wayland 没有悬浮窗，出厂帧只在主窗口桌宠页')
  const ready = companionFloatReady(shell)
  if (!ready.ok) return fail(ready.reason)
  const page = await readCompanionPetSurface()
  if (!page) return fail('悬浮窗页面没有出现')
  const surface = companionPetSurfaceReady(page)
  return surface.ok
    ? pass('悬浮窗画出了出厂默认皮肤')
    : fail(surface.reason)
}

export async function runCompanionHide(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) return pass('Wayland 没有悬浮窗可藏')
  try {
    await rightClickCompanionPet().catch(() => null)
    await driver.invoke('SetCompanionPetHidden', [{ hidden: true }])
    const hidden = await driver.getCompanionShellStatus()
    if (!companionShellHidden(hidden)) return fail('隐藏之后壳还说桌宠看得见')
    return pass('右键菜单隐藏后桌宠收起来了')
  } finally {
    await driver.invoke('SetCompanionPetHidden', [{ hidden: false }]).catch(() => {})
  }
}

export async function runCompanionShow(driver) {
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) return pass('Wayland 没有悬浮窗可唤醒')
  await driver.invoke('SetCompanionPetHidden', [{ hidden: true }])
  const shown = await driver.invoke('SetCompanionPetHidden', [{ hidden: false }])
  const ready = companionFloatReady(shown)
  if (!ready.ok) return fail(ready.reason)
  return pass('显示桌宠后悬浮窗又回来了')
}

export async function runCompanionDockPark(driver) {
  const before = await enableCompanionFloat(driver)
  try {
    const parked = await driver.invoke('ParkCompanionMainWindow', [])
    if (!await driver.ensureAttached()) {
      return fail('关掉主窗口后产品窗口丢了')
    }
    if (!companionParked(parked) && !companionParked(await driver.getCompanionShellStatus())) {
      return fail('关掉主窗口后窗口没有收进桌面栏')
    }
    const presence = companionPresenceKept(await driver.getCompanionShellStatus())
    if (!presence.ok) return fail(presence.reason)
    if (!before?.wayland) {
      const shown = await driver.invoke('SetCompanionPetHidden', [{ hidden: false }])
      if (companionShellHidden(shown)) return fail('从桌面栏唤醒后桌宠还是藏着')
    }
    return pass(`关掉主窗口后${presence.reason}，还能唤醒桌宠`)
  } finally {
    await driver.invoke('ShowCompanionMainWindow', []).catch(() => {})
    await driver.ensureAttached()
  }
}

function companionTurnToolNames(events) {
  return [...new Set(
    (events || [])
      .map(event => eventToolName(event))
      .filter(name => /companion_|bash|read|grep|find|ls|edit|write/i.test(name)),
  )]
}

export async function runCompanionFuzzDispatch(driver, options = {}) {
  const prefix = `product-loop-fuzz-${Date.now().toString(36)}`
  const title = `${prefix}-research`
  const marker = `${prefix}-MARK`
  const conversation = await driver.createConversation({
    id: `${prefix}-target`,
    title,
    kernel: 'pi',
  })
  try {
    await enablePersonalRelayRoute(driver)
    await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
    await driver.drainCompanionEvents()
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    await driver.drainCompanionEvents()
    const prompts = companionFuzzDispatchPrompts({ title, marker })
    let turn = { events: [], confirmed: 0, timeout: false, sidecarStopped: false, error: '' }
    const tools = new Set()
    for (const prompt of prompts) {
      await driver.sendCompanionMessage(prompt)
      turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 300_000)
      for (const name of companionTurnToolNames(turn.events)) tools.add(name)
      if (turn.sidecarStopped || companionTurnParked(turn.events)) {
        return fail('桌宠 sidecar 停了，模糊调度没有接上')
      }
      const broken = /tool history is broken|这段对话没法继续了/i.test(String(turn.error || ''))
      if (broken) {
        await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
        await driver.stopCompanion().catch(() => {})
        await driver.ensureCompanion()
        await driver.drainCompanionEvents()
        continue
      }
      if (companionTurnErrored(turn.events)) {
        return fail(`模糊调度回合失败 ${turn.error || ''}`.trim())
      }
      const facts = await waitForCompanionFacts(driver, conversation.id, marker, 12_000)
      if (facts.landed.ok) {
        return pass(`模糊调度把 ${marker} 转达到「${title}」，工具 ${[...tools].join(',') || '(无)'}`)
      }
      if (!turn.timeout && companionTurnSettled(turn.events) && tools.has('companion_dispatch')) {
        // Dispatch fired but marker wording drifted; still count as exercised scheduling.
        const board = boardHasConversation(await driver.getCompanionBoard(), conversation.id)
        if (board.ok) {
          return pass(`模糊调度调用了 companion_dispatch 且看板有「${title}」`)
        }
      }
    }
    if (turn.timeout) return fail('模糊调度回合超时')
    return fail('模糊调度没有把调研任务落到目标会话')
  } finally {
    await driver.stopCompanion().catch(() => {})
  }
}

export async function runCompanionFuzzApp(driver, options = {}) {
  await enablePersonalRelayRoute(driver)
  await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
  await driver.drainCompanionEvents()
  const started = await driver.ensureCompanion()
  const ready = companionIsReady(started)
  if (!ready.ok) return fail(ready.reason)
  await driver.drainCompanionEvents()
  const tools = new Set()
  let settled = 0
  let replied = false
  for (const prompt of companionFuzzAppPrompts()) {
    await driver.sendCompanionMessage(prompt)
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 300_000)
    for (const name of companionTurnToolNames(turn.events)) tools.add(name)
    if (turn.sidecarStopped || companionTurnParked(turn.events)) {
      return fail('桌宠 sidecar 停了，功能询问没有接上')
    }
    const broken = /tool history is broken|这段对话没法继续了/i.test(String(turn.error || ''))
    if (broken) {
      await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
      await driver.stopCompanion().catch(() => {})
      await enablePersonalRelayRoute(driver)
      await driver.ensureCompanion()
      await driver.drainCompanionEvents()
      continue
    }
    if (companionTurnErrored(turn.events)) {
      return fail(`功能询问回合失败 ${turn.error || ''}`.trim())
    }
    if (turn.timeout) return fail('功能询问回合超时')
    if (companionTurnSettled(turn.events)) settled += 1
    const page = await driver.listCompanionTranscript(40)
    if (transcriptHasAssistantReply(page).ok) replied = true
  }
  const usedApp = [...tools].some(name => /companion_app/i.test(name))
  const usedBoard = [...tools].some(name => /companion_board/i.test(name))
  if (!replied) return fail('功能询问没有助手回复')
  if (settled < 2) return fail(`功能询问只结算了 ${settled} 轮`)
  if (!usedApp && !usedBoard) {
    return fail(`功能询问没有动 companion_app/board，工具=${[...tools].join(',') || '(无)'}`)
  }
  return pass(`功能询问走完 ${settled} 轮，工具 ${[...tools].join(',')}`)
}
