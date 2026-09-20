/**
 * Companion product cases: page, board, many sessions, transcript, settings.
 */

import { delay } from './desktop-gui-driver.mjs'
import {
  boardHasConversation,
  companionIsReady,
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
  clickLabeled,
  expectLabels,
  fail,
  leaveSettings,
  openSettingsCategory,
  openWorkspace,
  pageSnapshot,
  pass,
  snapshotHas,
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

export async function runCompanionPage(driver) {
  const nav = await openCompanionPage(driver)
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(
    driver,
    ['桌宠', 'Companion', '看板', 'Board', '记忆', 'Memory', '归档', 'Archives', '桌宠输入', 'Companion message'],
    '桌宠页看得到抄本、看板、记忆和输入框',
    '桌宠页缺了抄本、看板或输入框',
  )
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
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs)
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
  await driver.sendCompanionMessage('调用 companion_memory propose_memory，记一条「product-loop 正在测桌宠记忆」，然后结束。')
  await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
  const memory = await driver.getCompanionMemory()
  const pending = Array.isArray(memory?.pending) ? memory.pending : []
  const approved = Array.isArray(memory?.approved) ? memory.approved : []
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
