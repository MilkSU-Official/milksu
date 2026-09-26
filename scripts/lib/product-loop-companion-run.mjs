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
  companionDefaultSkinVisible,
  companionFuzzAppPrompts,
  companionImportedSkinVisible,
  companionPetSurfaceUsesCustomSkin,
  companionSkinEntryVisible,
  companionSkinFramesAreCustom,
  companionSkinListed,
  companionFloatReady,
  companionIsReady,
  companionSurfaceMissingKey,
  companionParked,
  companionPetSurfaceReady,
  companionPresenceKept,
  companionShellHidden,
  companionStopPrompt,
  companionContinueBlocked,
  companionTranscriptClean,
  companionTurnErrored,
  companionTurnParked,
  companionTurnSettled,
  transcriptHasAssistantReply,
  transcriptHasVisibleAssistantOutcome,
  transcriptHasPrompt,
} from './product-loop-companion.mjs'
import {
  assistantTextAfterPrompt,
  companionCoreGitSnapshot,
  companionCoreGitUnchanged,
  companionCoreLiveSteps,
  companionCoreProjects,
  companionCoreSeedConversations,
  companionGenerationStarted,
  companionPromptHasReply,
  companionToolsStillOpen,
  judgeCompanionCoreReply,
  nextCompanionReplyDeadline,
  transcriptCancelledAfter,
} from './product-loop-companion-core.mjs'
import { describeCustomRelay, firstUseRelayName, resolveCompanionModelRoute } from './product-loop-first-use.mjs'
import {
  approvedMemoryCount,
  ariaLabelsOf,
  chooseSettingsPicker,
  companionMemoryPreferencePrompt,
  forgetCompanionMemoryIds,
  judgeExtractOptions,
  judgeIdleMinutesLabel,
  judgeMemorySearchRow,
  memoryErrorText,
  memoryTranscriptAnomaly,
  pollCompanionMemoryExtract,
  pollCompanionMemoryWrite,
  productLoopMemoryMarker,
  readSettingsHeadings,
  readSettingsPickerOptions,
  visibleTranscriptText,
  withCompanionMemoryExtract,
} from './product-loop-memory.mjs'
import {
  clickAria,
  clickLabeled,
  expectLabels,
  fail,
  skip,
  leaveSettings,
  openSettingsCategory,
  pageSnapshot,
  pass,
  snapshotHas,
  waitFor,
} from './product-loop-session.mjs'

async function openCompanionPage(driver) {
  await leaveSettings(driver)
  const clicked = await driver.cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="sidebar-open-companion"]')
    if (!node) return false
    node.click()
    return true
  })()`)
  if (!clicked) return { ok: false, detail: '侧栏页脚找不到看板娘' }
  await delay(400)
  return { ok: true }
}

/** Keep the phone chat open for CDP / screenshots without raising OS focus. */
async function ensureCompanionChatVisible(driver) {
  await openCompanionPage(driver).catch(() => {})
  await driver.invoke('ShowCompanionChatWindow', [{ focus: false }]).catch(() => {})
  await delay(200)
}

/**
 * Abort a stuck mid-turn loop and bring the sidecar back. Host tool failures must
 * leave Pi free to continue; product-loop timeouts are the opposite — we stop the
 * wait so the next case is not blocked by a still-running agent.
 *
 * AbortCompanionTurn cancels the in-flight Pi HTTP request. undici then writes
 * "Request aborted" onto the last assistant row. The phone must map that to
 * 「这一轮已取消」; do not call this while a user-visible reply is still wanted.
 */
async function sendCompanionOrRecover(driver, prompt) {
  try {
    await driver.sendCompanionMessage(prompt)
    return { ok: true }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (!/sidecar stopped|not running|not ready/i.test(text)) {
      return { ok: false, error: text }
    }
    const again = await recoverCompanionSidecar(driver)
    if (!again.ok) return { ok: false, error: again.reason }
    await driver.sendCompanionMessage(prompt)
    return { ok: true }
  }
}

async function recoverCompanionSidecar(driver, options = {}) {
  // An idle AbortCompanionTurn still emits assistant.settled aborted. That
  // event can arrive after the next Send and cancel the first reply. Manual
  // chat never aborts before the first line, so the core prelude skips it.
  // Callers that are tearing down a turn already in flight still abort.
  if (options.abort !== false) {
    await driver.abortCompanionTurn().catch(() => {})
  }
  await driver.stopCompanion().catch(() => {})
  await delay(300)
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const started = await driver.ensureCompanion()
      const ready = companionIsReady(started)
      if (ready.ok) {
        await ensureCompanionChatVisible(driver)
        await driver.drainCompanionEventsFromSurfaces().catch(() => [])
        return { ok: true, started }
      }
      lastError = ready.reason
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(400)
  }
  return { ok: false, reason: lastError || '看板娘未能重新就绪' }
}

async function openCompanionSettings(driver) {
  return openSettingsCategory(driver, ['看板娘', 'Companion'])
}

async function ensureCompanionModelRoute(driver) {
  return resolveCompanionModelRoute(driver)
}

async function requireCompanionModelRoute(driver) {
  const route = await ensureCompanionModelRoute(driver)
  if (route.ok) return { route, blocked: null }
  return {
    route,
    blocked: fail(`${route.detail}；source=${route.source || 'none'}`, { source: route.source || 'none' }),
  }
}

export async function runCompanionReady(driver) {
  const route = await ensureCompanionModelRoute(driver)
  if (!route.ok) {
    return fail(`${route.detail}；source=${route.source || 'none'}`, { source: route.source || 'none' })
  }
  let started = null
  let lastReason = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) await driver.stopCompanion().catch(() => {})
      started = await driver.ensureCompanion()
      const ready = companionIsReady(started)
      if (ready.ok) break
      lastReason = ready.reason
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
      if (!/sidecar stopped|not ready|not running/i.test(lastReason)) {
        return fail(`${lastReason}；${route.detail || ''}`)
      }
    }
    await delay(400)
  }
  const ready = companionIsReady(started)
  if (!ready.ok) {
    return fail(`${lastReason || ready.reason}；${route.detail || ''}`)
  }
  const model = String(started?.model ?? started?.Model ?? '')
  const provider = String(started?.provider ?? started?.Provider ?? '')
  const source = route.source || (route.account ? 'account' : (route.id ? 'personal' : 'none'))
  const label = source === 'account' ? ' account' : (route.id ? ` personal=${route.id}` : ` ${source}`)
  const surface = await readCompanionChatSurface().catch(() => null)
  if (companionSurfaceMissingKey(surface || {})) {
    return fail(`看板娘窗没有可用 Key；${route.detail || ''} source=${source}`, { source })
  }
  return pass(`看板娘已就绪${model ? ` ${provider} ${model}` : ''}${label}`, { source })
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
  if (!nav.ok) return fail(nav.detail || '侧栏页脚没有看板娘入口')
  const opened = await waitForCompanionChatSurface()
  if (!opened) return fail('侧栏看板娘没有打开手机对话')
  const page = await readCompanionChatSurface()
  const hay = `${(page?.aria || []).join('\n')}\n${page?.text || ''}`
  const session = new CdpSession(opened.webSocketDebuggerUrl)
  await session.open()
  let both = false
  try {
    both = await session.evaluate(`Boolean(document.querySelector('[data-form="pet"] .companion-pet-body') && document.querySelector('[data-testid="companion-chat"]'))`)
  } finally {
    session.close()
  }
  if (both) return fail('手机对话和看板娘本体同时出现了')
  return page?.chat && /看板娘输入|Companion message/.test(hay)
    ? pass('侧栏页脚打开了手机对话，看得见输入框，角色已经收起')
    : fail('手机对话缺了对话或输入框')
}

export async function runCompanionPetMenu(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) {
    const status = await driver.getCompanionShellStatus()
    const labels = (status?.menu || []).map(item => item.label).join(' ')
    return /对话|Chat/.test(labels) && /隐藏看板娘|Hide Companion/.test(labels)
      ? pass('Wayland 没有悬浮窗，Dock / 托盘仍有看板娘动作')
      : fail('壳菜单没有看板娘右键动作')
  }
  const clicked = await waitFor(async () => {
    const next = await rightClickCompanionPet()
    return next?.opened ? next : null
  }, 6_000)
  if (!clicked) return fail('看板娘右键没有落到角色身体上')
  const status = await waitFor(async () => {
    const next = await driver.getCompanionShellStatus()
    return next?.menuPopup ? next : null
  }, 4_000) || await driver.getCompanionShellStatus()
  const shellMenu = (status?.menu || []).map(item => item.label).join(' ')
  return status?.menuPopup
    && /对话|Chat/.test(shellMenu)
    && /隐藏看板娘|Hide Companion/.test(shellMenu)
    && /打开主窗口|Open MilkSU/.test(shellMenu)
    && /看板娘设置|Companion settings/.test(shellMenu)
    && /退出|Quit/.test(shellMenu)
    ? pass('看板娘右键弹出壳菜单，Dock / 托盘是同一组动作')
    : fail('看板娘右键没有弹出壳菜单，或菜单缺了对话、隐藏、主窗口、设置或退出')
}

export async function runCompanionPetDrag(driver) {
  const shell = await showCompanionPetForm(driver)
  if (shell?.wayland) return skip('Wayland 不能自己贴坐标，身体拖拽按平台跳过', { skipKind: 'platform' })
  const target = await waitForCompanionSurface()
  if (!target) return fail('没有看板娘悬浮窗')
  const before = await driver.getCompanionShellStatus()
  const origin = before?.petBounds
  if (!origin) return fail('壳没有回报看板娘窗口位置')
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    const probe = await waitFor(async () => {
      const next = await session.evaluate(`(() => {
        const body = document.querySelector('[data-testid="companion-pet-body"], .companion-pet-body')
        return {
          body: Boolean(body),
          invoke: Boolean(window.milksu?.invoke),
        }
      })()`)
      return next?.body ? next : null
    }, 4_000)
    if (!probe?.body) {
      return fail(`悬浮窗里没有看板娘身体 body=${Boolean(probe?.body)} invoke=${Boolean(probe?.invoke)}`)
    }
  } finally {
    session.close()
  }
  // The pet starts in the work-area corner. begin/end follows the OS cursor
  // and then clamps, so a positive delta is snapped back to that corner.
  // A negative delta is the shell move the body drag uses once the pointer
  // has actually left the origin.
  await driver.invoke('MoveCompanionPet', [{ dx: -80, dy: -48 }])
  const after = await waitFor(async () => {
    const next = await driver.getCompanionShellStatus()
    if (next?.petBounds && (next.petBounds.x !== origin.x || next.petBounds.y !== origin.y)) return next
    return null
  }, 4_000)
  return after?.petBounds
    ? pass('按住看板娘身体拖了之后窗口跟着走了')
    : fail('真拖看板娘身体后窗口没有挪位置')
}

export async function runCompanionArchive(driver) {
  const started = await recoverCompanionSidecar(driver)
  if (!started.ok) return fail(started.reason)
  let archived
  try {
    archived = await driver.invoke('ArchiveCompanionTranscript', [])
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (!/no companion transcript|没有可归档/i.test(text)) throw error
    return fail('没有可归档的抄本')
  }
  const list = await driver.invoke('ListCompanionArchives', [])
  const rows = Array.isArray(list) ? list : []
  const name = String(archived?.name ?? archived?.Name ?? '')
  const stored = rows.some(row => String(row?.name ?? row?.Name ?? '') === name)
  return name && (rows.length > 0 || stored)
    ? pass(`当前段已归档 ${name}`)
    : fail('看板娘归档没有留下条目')
}

export async function runCompanionMemory(driver, options = {}) {
  const started = await recoverCompanionSidecar(driver)
  if (!started.ok) return fail(started.reason)
  const marker = productLoopMemoryMarker('plmem')
  const prompt = companionMemoryPreferencePrompt(marker)
  return withCompanionMemoryExtract(driver, 'turn', async () => {
    let before
    try {
      before = await driver.getCompanionMemory()
    } catch (error) {
      return fail(`读不到记忆：${memoryErrorText(error)}`)
    }
    const sent = await sendCompanionOrRecover(driver, prompt)
    if (!sent.ok) return fail(sent.error || '看板娘记忆发不出')
    const turn = await driver.waitForCompanionTurn(Math.min(options.taskTimeoutMs || 120_000, 120_000))
    if (turn?.sidecarStopped) return fail('看板娘 sidecar 停了，记忆没有写完')
    if (turn?.timeout) return fail(turn.error || '看板娘回合超时，记忆没有写完')
    if (turn?.failed) return fail(turn.error || '看板娘回合报错，记忆没有写完')
    const judged = await pollCompanionMemoryWrite(
      () => driver.getCompanionMemory(),
      before,
      { userText: prompt, marker },
      { timeoutMs: 60_000 },
    )
    if (!judged.ok) return fail(judged.reason || '看板娘没有直接写下这条记忆')
    const transcript = await driver.listCompanionTranscript(40).catch(() => null)
    const clean = companionTranscriptClean(transcript)
    if (!clean.ok) return fail(clean.reason)
    const anomaly = memoryTranscriptAnomaly(visibleTranscriptText(transcript))
    if (anomaly) return fail(`抄本出现了 ${anomaly}`)
    const forgotten = await forgetCompanionMemoryIds(driver, judged.ids)
    if (!forgotten.ok) return fail(forgotten.reason)
    return pass(`直接写下记忆 ${judged.ids.join(',')}，依据里有原话标记，忘掉后没有再出现`)
  })
}

export async function runCompanionMemorySettings(driver) {
  const opened = await openSettingsCategory(driver, ['记忆', 'Memory'])
  if (!opened.ok) return fail(opened.detail)
  let before
  try {
    before = await driver.invoke('GetSettings', [])
  } catch (error) {
    return fail(`读不到设置：${memoryErrorText(error)}`)
  }
  const previousMode = String(before?.companion_memory_extract ?? before?.CompanionMemoryExtract ?? '').trim() || 'turn'
  const previousIdle = before?.companion_memory_extract_idle_minutes ?? before?.CompanionMemoryExtractIdleMinutes ?? 10
  let mutated = false
  try {
    const headings = await readSettingsHeadings(driver)
    const rows = headings.map(text => String(text ?? '').trim()).filter(Boolean)
    const longTerm = rows.findIndex(text => text === '长期记忆' || text === 'Long-term memory')
    const index = rows.findIndex(text => text === '会话索引' || text === 'Session index')
    if (longTerm < 0 || index < 0) {
      return fail(`记忆页缺了长期记忆或会话索引：${rows.join(' / ') || '空'}`)
    }
    if (longTerm > index) {
      return fail(`长期记忆排在会话索引后面：${rows.join(' / ')}`)
    }
    const menu = await readSettingsPickerOptions(driver, ['提取', 'Extract'])
    if (!menu.ok) return fail(menu.reason)
    const options = judgeExtractOptions(menu.options)
    if (!options.ok) return fail(options.reason)
    if (!snapshotHas(await pageSnapshot(driver), ['记忆检索', 'Memory retrieval'])) {
      return fail('长期记忆里没有记忆检索')
    }
    const idle = await chooseSettingsPicker(driver, ['提取', 'Extract'], ['闲置后', 'After idle'])
    if (!idle.ok) return fail(idle.reason)
    mutated = true
    const idleSaved = await pollCompanionMemoryExtract(driver, 'idle')
    if (!idleSaved.ok) return fail(idleSaved.reason)
    const idleLabel = await driver.cdp.callFunction(`function() {
      const button = document.querySelector('button[aria-label="闲置"], button[aria-label="Idle"]')
      return button ? (button.textContent || '').replace(/\\s+/g, ' ').trim() : ''
    }`)
    const minutes = judgeIdleMinutesLabel(idleLabel)
    if (!minutes.ok) return fail(minutes.reason)
    const off = await chooseSettingsPicker(driver, ['提取', 'Extract'], ['关闭', 'Off'])
    if (!off.ok) return fail(off.reason)
    const offSaved = await pollCompanionMemoryExtract(driver, 'off')
    if (!offSaved.ok) return fail(offSaved.reason)
    const idleGone = await driver.cdp.evaluate(`Boolean(document.querySelector('button[aria-label="闲置"], button[aria-label="Idle"]'))`)
    if (idleGone) return fail('关闭提取之后闲置还在')
    let memory = { approved: [] }
    try {
      memory = await driver.getCompanionMemory()
    } catch (error) {
      return fail(`读不到记忆：${memoryErrorText(error)}`)
    }
    const search = judgeMemorySearchRow(await ariaLabelsOf(driver), approvedMemoryCount(memory))
    if (!search.ok) return fail(search.reason)
    return pass(`长期记忆在会话索引前面。闲置后是 ${minutes.minutes} 分钟，关闭后闲置消失。${search.visible ? '有记忆时检索在。' : '没有记忆时不显示检索。'}`)
  } finally {
    if (mutated) {
      const latest = await driver.invoke('GetSettings', []).catch(() => before)
      const base = latest && typeof latest === 'object' ? latest : before
      await driver.invoke('SaveSettingsCmd', [{
        ...base,
        companion_memory_extract: previousMode,
        companion_memory_extract_idle_minutes: previousIdle,
      }]).catch(() => {})
    }
  }
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
    await ensureCompanionChatVisible(driver)
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
      return fail('看板娘 sidecar 停了，跨会话确认没有接上')
    }
    if (!turn.confirmed) {
      return fail(`跨会话调度没有停下来确认 timeout=${Boolean(turn.timeout)} confirmed=${turn.confirmed}`)
    }
    return pass(`看板娘 stop 调度停下来确认了 ${turn.confirmed} 次`)
  } finally {
    await driver.stopCompanion().catch(() => {})
  }
}


export async function runCompanionModelSwitch(driver, options = {}) {
  const { route, blocked } = await requireCompanionModelRoute(driver)
  if (blocked) return blocked
  const settings = await driver.invoke('GetSettings', [])
  const current = String(settings?.companion_model ?? settings?.CompanionModel ?? '')
  const relay = describeCustomRelay(settings, firstUseRelayName())
  let candidates = [...new Set(relay.models.filter(Boolean))]
  let provider = relay.id
  let source = 'personal'
  if (route.source === 'account' || route.account) {
    const catalog = await driver.invoke('GetModelCatalog', []).catch(() => ({}))
    const accountIds = Array.isArray(catalog?.account_model_ids) ? catalog.account_model_ids : []
    candidates = [...new Set(accountIds.map(id => String(id).trim()).filter(Boolean))]
    provider = 'tokenflux'
    source = 'account'
  }
  const next = candidates.find(id => id && id !== current)
  if (!next) {
    return candidates.length
      ? skip(`当前来源只有一台模型 ${current || candidates[0]}，换模型没得测`, { source })
      : fail('找不到另一台看板娘模型可换')
  }
  try {
    await driver.invoke('SaveSettingsCmd', [{
      ...settings,
      companion_model: next,
      companion_provider: provider,
      companion_source: source,
    }])
    await driver.stopCompanion().catch(() => {})
    const started = await driver.ensureCompanion()
    const ready = companionIsReady(started)
    if (!ready.ok) return fail(ready.reason)
    const model = String(started?.model ?? started?.Model ?? '')
    if (!model || (model !== next && !model.includes(next.split('/').pop() || next))) {
      return fail(`换模型后看板娘仍是 ${model || '空'}，要的是 ${next}`)
    }
    await ensureCompanionChatVisible(driver)
    await driver.sendCompanionMessage('短回一句 MODEL-SWITCH-OK，不要调用工具。')
    const turn = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
    if (turn.timeout || companionTurnErrored(turn.events) || !companionTurnSettled(turn.events)) {
      return fail(`换模型后看板娘没发出去 timeout=${Boolean(turn.timeout)}`)
    }
    return pass(`看板娘已换成 ${next} 并完成一句对话`)
  } finally {
    await driver.invoke('SaveSettingsCmd', [settings]).catch(() => {})
  }
}

export async function runCompanionSettingsModel(driver) {
  const opened = await openCompanionSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  return expectLabels(driver, ['看板娘模型', 'Companion model'], '设置里有看板娘模型', '设置里没有看板娘模型')
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
    ? pass('设置 → 看板娘的皮肤是出厂默认，也能添加文件夹')
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
  if (shell?.wayland) return skip('Wayland 没有悬浮窗，出厂帧按平台跳过', { skipKind: 'platform' })
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
  if (shell?.wayland) return skip('Wayland 没有悬浮窗可藏', { skipKind: 'platform' })
  try {
    await rightClickCompanionPet().catch(() => null)
    await driver.invoke('SetCompanionPetHidden', [{ hidden: true }])
    const hidden = await driver.getCompanionShellStatus()
    if (!companionShellHidden(hidden)) return fail('隐藏之后壳还说看板娘看得见')
    const main = await driver.invoke('ShowCompanionMainWindow', [{ focus: false }])
    if (!companionShellHidden(main)) return fail('打开主窗口把已隐藏的看板娘带出来了')
    return pass('右键菜单隐藏后看板娘收起来了，打开主窗口也不会把它带出来')
  } finally {
    await driver.invoke('SetCompanionPetHidden', [{ hidden: false }]).catch(() => {})
  }
}

export async function runCompanionShow(driver) {
  const shell = await enableCompanionFloat(driver)
  if (shell?.wayland) return skip('Wayland 没有悬浮窗可唤醒', { skipKind: 'platform' })
  await driver.invoke('SetCompanionPetHidden', [{ hidden: true }])
  const shown = await driver.invoke('SetCompanionPetHidden', [{ hidden: false }])
  const ready = companionFloatReady(shown)
  if (!ready.ok) return fail(ready.reason)
  return pass('显示看板娘后悬浮窗又回来了')
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
      if (companionShellHidden(shown)) return fail('从桌面栏唤醒后看板娘还是藏着')
    }
    return pass(`关掉主窗口后${presence.reason}，还能唤醒看板娘`)
  } finally {
    await driver.invoke('ShowCompanionMainWindow', [{ focus: false }]).catch(() => {})
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

export async function runCompanionFuzzApp(driver, options = {}) {
  const { blocked } = await requireCompanionModelRoute(driver)
  if (blocked) return blocked
  await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
  await driver.drainCompanionEvents()
  const recovered = await recoverCompanionSidecar(driver)
  if (!recovered.ok) return fail(recovered.reason)
  const tools = new Set()
  let settled = 0
  let replied = false
  const turnBudget = Math.min(options.taskTimeoutMs || 180_000, 180_000)
  try {
    for (const prompt of companionFuzzAppPrompts()) {
      await driver.drainCompanionEvents()
      try {
        await driver.sendCompanionMessage(prompt)
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (!/sidecar stopped|not running|not ready/i.test(text)) throw error
        const again = await recoverCompanionSidecar(driver)
        if (!again.ok) return fail(`功能询问发不出：${again.reason}`)
        await driver.sendCompanionMessage(prompt)
      }
      const turn = await driver.waitForCompanionTurn(turnBudget)
      for (const name of companionTurnToolNames(turn.events)) tools.add(name)
      if (turn.sidecarStopped || companionTurnParked(turn.events)) {
        const again = await recoverCompanionSidecar(driver)
        if (!again.ok) return fail('看板娘 sidecar 停了，功能询问没有接上')
        continue
      }
      const broken = /tool history is broken|这段对话没法继续了/i.test(String(turn.error || ''))
      if (broken || turn.timeout) {
        await recoverCompanionSidecar(driver)
        if (turn.timeout && settled < 1) return fail('功能询问回合超时')
        continue
      }
      if (companionTurnErrored(turn.events)) {
        const err = String(turn.error || '')
        if (/sidecar stopped|not running|not ready/i.test(err)) {
          await recoverCompanionSidecar(driver)
          continue
        }
        await recoverCompanionSidecar(driver)
        return fail(`功能询问回合失败 ${err || 'host timeout/cancel'}`.trim())
      }
      if (companionTurnSettled(turn.events)) settled += 1
      const page = await driver.listCompanionTranscript(40)
      if (transcriptHasAssistantReply(page).ok) replied = true
    }
  } finally {
    // Wait out an in-flight last turn. Do not AbortCompanionTurn here — that
    // was painting "Request aborted" onto 看板列一下当前会话标题.
    await driver.waitForCompanionTurn(8_000).catch(() => ({}))
  }
  const usedApp = [...tools].some(name => /companion_app/i.test(name))
  const usedBoard = [...tools].some(name => /companion_board/i.test(name))
  if (!replied) return fail('功能询问没有助手回复')
  if (settled < 2) return fail(`功能询问只结算了 ${settled} 轮`)
  if (!usedApp && !usedBoard) {
    return fail(`功能询问没有动 companion_app/board，工具=${[...tools].join(',') || '(无)'}`)
  }
  const clean = companionTranscriptClean(await driver.listCompanionTranscript(40))
  if (!clean.ok) return fail(clean.reason)
  return pass(`功能询问走完 ${settled} 轮，工具 ${[...tools].join(',')}`)
}

export async function runCompanionFuzzRecovery(driver, options = {}) {
  const { blocked } = await requireCompanionModelRoute(driver)
  if (blocked) return blocked
  await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
  await driver.drainCompanionEvents()
  const started = await recoverCompanionSidecar(driver)
  if (!started.ok) return fail(started.reason)

  const before = `product-loop-recovery-before-${Date.now().toString(36)}`
  await driver.sendCompanionMessage(`${before} 先短回一句。`)
  const first = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
  if (first.timeout) {
    await recoverCompanionSidecar(driver)
    return fail('恢复用例第一句超时')
  }
  if (first.sidecarStopped) return fail('恢复用例第一句 sidecar 停了')
  if (companionTurnErrored(first.events)) {
    return fail(`恢复用例第一句失败 ${first.error || ''}`.trim())
  }
  const beforePage = await driver.listCompanionTranscript(40)
  const beforeLanded = transcriptHasPrompt(beforePage, before)
  if (!beforeLanded.ok) return fail(`重启前抄本就没有用户句：${beforeLanded.reason}`)

  // Kill sidecar mid-path (host timeout / crash analogue), then continue same chat.
  await driver.stopCompanion().catch(() => {})
  await delay(300)
  const afterRestart = await recoverCompanionSidecar(driver)
  if (!afterRestart.ok) return fail(`恢复用例重启失败：${afterRestart.reason}`)

  const after = `product-loop-recovery-after-${Date.now().toString(36)}`
  await driver.sendCompanionMessage(`${after} sidecar 刚重启，请在同一段对话里短回一句，不要开新对话。`)
  const second = await driver.waitForCompanionTurn(options.taskTimeoutMs || 180_000)
  if (second.timeout) {
    await recoverCompanionSidecar(driver)
    return fail('恢复后续跑超时')
  }
  if (second.sidecarStopped) return fail('恢复后续跑 sidecar 停了')
  if (/没法继续了|tool history is broken/i.test(String(second.error || ''))) {
    return fail(`超时/重启后同一段对话没法续跑：${second.error}`)
  }
  const page = await driver.listCompanionTranscript(60)
  const beforeOk = transcriptHasPrompt(page, before)
  const afterOk = transcriptHasPrompt(page, after)
  if (!beforeOk.ok) return fail(`恢复后丢了中止前的用户句：${beforeOk.reason}`)
  if (!afterOk.ok) return fail(afterOk.reason)
  const spoken = transcriptHasAssistantReply(page)
  if (!spoken.ok) return fail(spoken.reason)
  const clean = companionTranscriptClean(page)
  if (!clean.ok) return fail(clean.reason)
  return pass('回合结束后 StopCompanion 再续跑，前后用户句都在同一段抄本')
}

async function pressCompanionStop(timeoutMs = 25_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const target = await waitForCompanionChatSurface(1_500)
    if (!target) {
      await delay(200)
      continue
    }
    const session = new CdpSession(target.webSocketDebuggerUrl)
    await session.open()
    try {
      const clicked = await session.evaluate(`(() => {
        const node = Array.from(document.querySelectorAll('button')).find((button) => {
          const label = button.getAttribute('aria-label') || ''
          return label === '停止' || label === 'Stop'
        })
        if (!node) return false
        node.click()
        return true
      })()`)
      if (clicked) return { ok: true }
    } catch {
      // The phone surface can swap while the turn is starting.
    } finally {
      session.close()
    }
    await delay(200)
  }
  return { ok: false }
}

async function waitForCompanionGeneration(driver, timeoutMs) {
  const started = Date.now()
  const events = []
  while (Date.now() - started < timeoutMs) {
    const batch = await driver.drainCompanionEventsFromSurfaces().catch(() => [])
    if (Array.isArray(batch) && batch.length) events.push(...batch)
    if (companionGenerationStarted(events)) return { ok: true, events }
    await delay(200)
  }
  return { ok: false, events, reason: '模型还没开始回复' }
}

async function waitForCompanionReply(driver, timeoutMs, needle) {
  const started = Date.now()
  let toolSeenAt = 0
  let turn = { timeout: true, events: [] }
  const events = []
  while (true) {
    const now = Date.now()
    const plan = nextCompanionReplyDeadline({
      startedAt: started,
      now,
      events,
      toolSeenAt,
    })
    toolSeenAt = plan.toolSeenAt
    if (now >= plan.deadline) {
      return {
        ...turn,
        events,
        timeout: true,
        toolsOpen: companionToolsStillOpen(events),
      }
    }
    const slice = Math.min(plan.deadline - now, 20_000)
    const next = await driver.waitForCompanionTurn(slice)
    if (Array.isArray(next?.events) && next.events.length) events.push(...next.events)
    turn = { ...next, events }
    if (next?.sidecarStopped) return turn
    if (next?.failed && !companionTurnSettled(events)) return turn
    if (!next?.timeout) {
      // The same assistant.settled is copied onto every window. A leftover
      // from the previous turn must not finish this wait: the runner would
      // then abort the reply that is just starting.
      const page = await driver.listCompanionTranscript(160).catch(() => null)
      if (!companionPromptHasReply(page, needle)) {
        await delay(200)
        continue
      }
      return turn
    }
  }
}

async function waitForCompanionCancel(driver, needle, timeoutMs) {
  const started = Date.now()
  let last = { ok: false, reason: '停止后没有「这一轮已取消。」' }
  while (Date.now() - started < timeoutMs) {
    const page = await driver.listCompanionTranscript(120).catch(() => null)
    if (page) {
      last = transcriptCancelledAfter(page, needle)
      if (last.ok || /未翻译/.test(last.reason)) return last
    }
    await delay(300)
  }
  return last
}

function storedConversationId(row) {
  return String(row?.id ?? row?.ID ?? '')
}

export async function runCompanionCore(driver, options = {}) {
  const { blocked } = await requireCompanionModelRoute(driver)
  if (blocked) return blocked
  const projects = companionCoreProjects()
  const seeded = companionCoreSeedConversations(Date.now(), projects)
  try {
    for (const row of seeded) {
      await driver.invoke('SaveConversation', [row])
      driver.createdConversationIds.add(row.id)
    }
    const listed = await driver.listConversations()
    const missing = seeded.filter(row => !listed.some(item => storedConversationId(item) === row.id))
    if (missing.length) {
      return fail(`主窗口抄本没写上：${missing.map(row => row.title).join('、')}`)
    }
    await driver.invoke('ArchiveCompanionTranscript', []).catch(() => {})
    await driver.drainCompanionEventsFromSurfaces().catch(() => [])
    const started = await recoverCompanionSidecar(driver, { abort: false })
    if (!started.ok) return fail(started.reason)
    const before = {
      click: companionCoreGitSnapshot(projects.click),
      express: companionCoreGitSnapshot(projects.express),
    }
    const marker = `CORE-RELAY-${Date.now().toString(36)}`
    const steps = companionCoreLiveSteps(marker, projects)
    const timeoutMs = options.taskTimeoutMs || 180_000
    let stops = 0
    for (const step of steps) {
      process.stdout.write(`COMPANION-CORE ${step.id}\n`)
      if (step.kind === 'archive') {
        await driver.archiveConversation(step.conversationId)
        const still = (await driver.listConversations()).some(item => storedConversationId(item) === step.conversationId)
        if (still) return fail(`${step.id}：归档后还在活动列表`)
        continue
      }
      await driver.drainCompanionEventsFromSurfaces().catch(() => [])
      if (step.kind === 'stop') {
        const sent = await sendCompanionOrRecover(driver, step.prompt)
        if (!sent.ok) return fail(`${step.id} 发不出：${sent.error}`)
        const generating = await waitForCompanionGeneration(driver, 120_000)
        if (!generating.ok) return fail(`${step.id}：${generating.reason}`)
        const pressed = await pressCompanionStop(15_000)
        if (!pressed.ok) return fail(`${step.id}：停止按钮没有出现`)
        const cancelled = await waitForCompanionCancel(driver, step.prompt.slice(0, 16), 20_000)
        if (!cancelled.ok) return fail(`${step.id}：${cancelled.reason}`)
        const clean = companionTranscriptClean(await driver.listCompanionTranscript(120))
        if (!clean.ok) return fail(`${step.id}：${clean.reason}`)
        stops += 1
        await driver.drainCompanionEventsFromSurfaces().catch(() => [])
        continue
      }
      const sent = await sendCompanionOrRecover(driver, step.prompt)
      if (!sent.ok) return fail(`${step.id} 发不出：${sent.error}`)
      const turn = await waitForCompanionReply(driver, timeoutMs, step.needle || step.prompt)
      if (turn.sidecarStopped || companionTurnParked(turn.events)) {
        return fail(`${step.id}：sidecar 停了`)
      }
      if (turn.timeout) {
        return fail(`${step.id}：超时${turn.toolsOpen ? '（工具还在跑）' : ''}`)
      }
      if (companionContinueBlocked(turn.error)) return fail(`${step.id}：${turn.error}`)
      if (companionTurnErrored(turn.events) && !companionTurnSettled(turn.events)) {
        return fail(`${step.id}：${turn.error || '回合失败'}`)
      }
      const page = await driver.listCompanionTranscript(120)
      const clean = companionTranscriptClean(page)
      if (!clean.ok) return fail(`${step.id}：${clean.reason}`)
      if (step.kind === 'relay') {
        let landed = false
        const waitStarted = Date.now()
        while (Date.now() - waitStarted < 15_000) {
          const saved = (await driver.listConversations()).find(item => storedConversationId(item) === step.conversationId)
          const messages = saved?.messages || saved?.Messages || []
          landed = messages.some(message => String(message?.content ?? message?.Content ?? '').includes(step.needle))
          if (landed) break
          await delay(400)
        }
        if (!landed) return fail(`${step.id}：标记没有进目标会话`)
        continue
      }
      const text = assistantTextAfterPrompt(page, step.needle)
      const judged = judgeCompanionCoreReply(text, step)
      if (!judged.ok) return fail(`${step.id}：${judged.reason}：${text.slice(0, 160)}`)
    }
    const click = companionCoreGitUnchanged(before.click, companionCoreGitSnapshot(projects.click))
    const expressGit = companionCoreGitUnchanged(before.express, companionCoreGitSnapshot(projects.express))
    if (!click.ok) return fail(click.reason)
    if (!expressGit.ok) return fail(expressGit.reason)
    const repos = [before.click, before.express].filter(Boolean).length
    return pass(`核心循环走完，停止 ${stops} 次${repos ? `，${repos} 个检出没动` : ''}`)
  } finally {
    await driver.abortCompanionTurn().catch(() => {})
  }
}

