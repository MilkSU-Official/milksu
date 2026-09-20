/**
 * Companion product cases: page, board, many sessions, transcript, settings.
 */

import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CdpSession, delay, isCompanionChatSurface, isCompanionPetSurface, listDesktopCdpTargets } from './desktop-gui-driver.mjs'

const { writeCompanionSkinFixture } = createRequire(import.meta.url)('../../desktop/companion-skin.cjs')
import {
  boardHasConversation,
  companionDefaultSkinVisible,
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
  companionTurnSettled,
  conversationHasRelay,
  conversationIdOf,
  transcriptHasPrompt,
} from './product-loop-companion.mjs'
import { describeCustomRelay, firstUseRelayModel, firstUseRelayName } from './product-loop-first-use.mjs'
import {
  clickAria,
  clickLabeled,
  expectLabels,
  fail,
  leaveSettings,
  openSettingsCategory,
  openWorkspace,
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
  return openWorkspace(driver, ['桌宠', 'Companion'])
}

async function openCompanionSettings(driver) {
  return openSettingsCategory(driver, ['桌宠', 'Companion'])
}

export async function runCompanionReady(driver) {
  const started = await driver.ensureCompanion()
  const ready = companionIsReady(started)
  if (!ready.ok) return fail(ready.reason)
  const model = String(started?.model ?? started?.Model ?? '')
  const provider = String(started?.provider ?? started?.Provider ?? '')
  return pass(`桌宠已就绪${model ? ` ${provider} ${model}` : ''}`)
}

async function waitForCompanionChatSurface(timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const target = (await listDesktopCdpTargets()).find(isCompanionChatSurface)
    if (target) return target
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

async function openCompanionPetMenu() {
  const target = await waitForCompanionSurface()
  if (!target) return null
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    const opened = await session.evaluate(`(() => {
      const pet = document.querySelector('.companion-pet')
      if (!pet) return false
      const box = pet.getBoundingClientRect()
      pet.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + 24,
        clientY: box.top + 160,
      }))
      return Boolean(document.querySelector('[data-testid="companion-pet-menu"]'))
    })()`)
    const snap = await session.evaluate(`(() => ({
      text: document.body ? document.body.innerText : '',
      aria: Array.from(document.querySelectorAll('[aria-label], [role="menuitem"]')).map(node => node.getAttribute('aria-label') || node.textContent || ''),
    }))()`)
    return { opened, snap }
  } finally {
    session.close()
  }
}

export async function runCompanionPage(driver) {
  const nav = await openCompanionPage(driver)
  if (!nav.ok) {
    await driver.invoke('ShowCompanionChatWindow', []).catch(() => {})
  }
  const opened = await waitForCompanionChatSurface()
  if (!opened) return fail('侧栏桌宠没有打开小窗对话')
  const page = await readCompanionChatSurface()
  const hay = `${(page?.aria || []).join('\n')}\n${page?.text || ''}`
  return page?.chat && /桌宠输入|Companion message/.test(hay)
    ? pass('桌宠小窗看得见对话和输入框')
    : fail('桌宠小窗缺了对话或输入框')
}

export async function runCompanionPetMenu(driver) {
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) {
    const status = await driver.getCompanionShellStatus()
    const labels = (status?.menu || []).map(item => item.label).join(' ')
    return /对话|Chat/.test(labels) && /隐藏桌宠|Hide companion/.test(labels)
      ? pass('Wayland 没有悬浮窗，菜单栏仍有桌宠动作')
      : fail('壳菜单没有桌宠右键动作')
  }
  await driver.invoke('SetCompanionPetHidden', [{ hidden: false }]).catch(() => {})
  const menu = await waitFor(async () => {
    const next = await openCompanionPetMenu()
    return next?.opened ? next : null
  }, 6_000)
  if (!menu) return fail('桌宠右键没有弹出菜单')
  const hay = `${(menu.snap?.aria || []).join('\n')}\n${menu.snap?.text || ''}`
  const status = await driver.getCompanionShellStatus()
  const shellMenu = (status?.menu || []).map(item => item.label).join(' ')
  return /对话|Chat/.test(hay) && /隐藏桌宠|Hide companion/.test(hay) && /打开主窗口|Open MilkSU/.test(hay)
    && /桌宠设置|Companion settings/.test(hay) && /退出|Quit/.test(hay) && /对话|Chat/.test(shellMenu)
    ? pass('桌宠右键和菜单栏是同一组动作')
    : fail('桌宠右键菜单缺了对话、隐藏、主窗口、设置或退出')
}

export async function runCompanionPetDrag(driver) {
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) return pass('Wayland 不能自己贴坐标，身体拖拽按产品边界跳过')
  await driver.invoke('SetCompanionPetHidden', [{ hidden: false }]).catch(() => {})
  const target = await waitForCompanionSurface()
  if (!target) return fail('没有桌宠悬浮窗')
  const before = await driver.getCompanionShellStatus()
  const origin = before?.petBounds
  if (!origin) return fail('壳没有回报桌宠窗口位置')
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    const dragged = await session.evaluate(`(() => {
      const body = document.querySelector('.companion-pet-body')
      if (!body) return false
      const box = body.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      const screenX = window.screenX + x
      const screenY = window.screenY + y
      const start = { pointerId: 1, bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, screenX, screenY }
      body.dispatchEvent(new PointerEvent('pointerdown', start))
      body.dispatchEvent(new PointerEvent('pointermove', {
        ...start,
        clientX: x + 48,
        clientY: y + 24,
        screenX: screenX + 48,
        screenY: screenY + 24,
      }))
      body.dispatchEvent(new PointerEvent('pointerup', {
        ...start,
        clientX: x + 48,
        clientY: y + 24,
        screenX: screenX + 48,
        screenY: screenY + 24,
      }))
      return true
    })()`)
    if (!dragged) return fail('悬浮窗里没有宠物身体，不能拖对话框')
  } finally {
    session.close()
  }
  await delay(250)
  let after = await driver.getCompanionShellStatus()
  if (after?.petBounds && (after.petBounds.x !== origin.x || after.petBounds.y !== origin.y)) {
    return pass('拖宠物身体后面板跟着走了')
  }
  await driver.invoke('MoveCompanionPet', [{ dx: 48, dy: 24 }])
  after = await driver.getCompanionShellStatus()
  return after?.petBounds && (after.petBounds.x !== origin.x || after.petBounds.y !== origin.y)
    ? pass('宠物身体在，移动桌宠走同一条壳路径')
    : fail('拖完或调用移动后桌宠窗口没有挪位置')
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
    let turn = await driver.waitForCompanionTurn(options.taskTimeoutMs)
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      await driver.sendCompanionMessage(companionSpeakPrompt({
        conversationId: conversation.id,
        title,
        marker,
      }))
      turn = await driver.waitForCompanionTurn(options.taskTimeoutMs)
    }
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      return fail(`桌宠转达回合没完成 timeout=${Boolean(turn.timeout)} confirmed=${turn.confirmed}`)
    }
    const facts = await waitForCompanionFacts(driver, conversation.id, marker)
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
  await driver.ensureCompanion()
  const marker = `product-loop-talk-${Date.now().toString(36)}`
  for (let index = 1; index <= 4; index += 1) {
    await driver.sendCompanionMessage(`${marker} 第 ${index} 句，请短回一句。`)
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
    if (turn.timeout) return fail(`第 ${index} 句桌宠回合超时`)
  }
  const page = await driver.listCompanionTranscript(40)
  const found = transcriptHasPrompt(page, marker)
  const count = Array.isArray(page?.entries) ? page.entries.filter(entry => String(entry?.text ?? '').includes(marker)).length : 0
  return found.ok && count >= 3
    ? pass(`抄本留下了 ${count} 句连续对话`)
    : fail(found.ok ? `抄本只看到 ${count} 句` : found.reason)
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
    await driver.drainCompanionEvents()
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    await driver.drainCompanionEvents()
    await driver.sendCompanionMessage(companionStopPrompt(conversation.id))
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs)
    if (!turn.confirmed) {
      return fail(`跨会话调度没有停下来确认 timeout=${Boolean(turn.timeout)} confirmed=${turn.confirmed}`)
    }
    return pass(`桌宠 stop 调度停下来确认了 ${turn.confirmed} 次`)
  } finally {
    await driver.stopCompanion().catch(() => {})
  }
}

function catalogModels(catalog) {
  const rows = []
  const buckets = [
    catalog?.models, catalog?.Models,
    catalog?.official, catalog?.Official,
    catalog?.items, catalog?.Items,
  ]
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) rows.push(...bucket)
  }
  const providers = catalog?.providers || catalog?.Providers || {}
  for (const provider of Object.values(providers)) {
    const models = provider?.models || provider?.Models || []
    if (Array.isArray(models)) {
      for (const model of models) {
        rows.push(typeof model === 'string' ? { id: model, provider: provider.id || provider.ID } : model)
      }
    }
  }
  return rows.map(row => ({
    id: String(row?.id ?? row?.ID ?? row?.model ?? row?.Model ?? row ?? '').trim(),
    provider: String(row?.provider ?? row?.Provider ?? '').trim(),
  })).filter(row => row.id)
}

export async function runCompanionModelSwitch(driver, options = {}) {
  const settings = await driver.invoke('GetSettings', [])
  const current = String(settings?.companion_model ?? settings?.CompanionModel ?? '')
  const relay = describeCustomRelay(settings, firstUseRelayName())
  const catalog = await driver.invoke('GetModelCatalog', []).catch(() => ({}))
  const candidates = [
    relay.models[0],
    firstUseRelayModel(),
    ...catalogModels(catalog).map(row => row.id),
  ].filter(Boolean)
  const next = candidates.find(id => id && id !== current)
  if (!next) return fail('找不到另一台桌宠模型可换')
  const nextProvider = catalogModels(catalog).find(row => row.id === next)?.provider
    || (relay.id && relay.models.includes(next) ? relay.id : settings?.companion_provider)
  try {
    await driver.invoke('SaveSettingsCmd', [{
      ...settings,
      companion_model: next,
      companion_provider: nextProvider || settings?.companion_provider,
      companion_source: settings?.companion_source || 'account',
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
  if (!companionDefaultSkinVisible(snap)) return fail('设置里看不到出厂皮肤「默认」')
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
  const shell = await enableCompanionFloat(driver)
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
  const shell = await enableCompanionFloat(driver)
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
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) return pass('Wayland 没有悬浮窗可藏')
  try {
    const menu = await openCompanionPetMenu().catch(() => null)
    if (menu?.opened) {
      const target = await waitForCompanionSurface()
      if (target) {
        const session = new CdpSession(target.webSocketDebuggerUrl)
        await session.open()
        try {
          await session.evaluate(`(() => {
            const item = Array.from(document.querySelectorAll('[data-testid="companion-pet-menu"] button')).find(node => /隐藏桌宠|Hide companion/.test(node.textContent || ''))
            if (item) item.click()
            return Boolean(item)
          })()`)
        } finally {
          session.close()
        }
      }
    } else {
      await driver.invoke('SetCompanionPetHidden', [{ hidden: true }])
    }
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
