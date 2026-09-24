/**
 * Decisions topic. Each case drives the companion and reads the fold, the
 * transcript, and whether a conversation was dispatched.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eventTypeOf } from './desktop-gui-driver.mjs'
import { resolveCompanionModelRoute } from './product-loop-first-use.mjs'
import {
  companionTurnErrored,
  parseCompanionConfirm,
  transcriptHasAssistantReply,
} from './product-loop-companion.mjs'
import {
  companionMemoryPreferencePrompt,
  forgetCompanionMemoryIds,
  pollCompanionMemoryWrite,
  productLoopMemoryMarker,
  visibleTranscriptText,
} from './product-loop-memory.mjs'
import {
  fail,
  leaveSettings,
  openSettingsCategory,
  pageSnapshot,
  pass,
  skip,
  snapshotHas,
} from './product-loop-session.mjs'

const KEY_LEAK = ['Jev API', 'jev api', 'OpenRouter API Key', '决策钥匙', 'Decision key']
const TURN_MS = 180_000

export async function runIntentSettingsBlank(driver) {
  const opened = await openSettingsCategory(driver, ['看板娘', 'Companion'])
  if (!opened.ok) return fail(opened.detail || '打不开看板娘设置')
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, KEY_LEAK)) return fail('设置里还能看见决策钥匙')
  await leaveSettings(driver).catch(() => {})
  return pass('设置里没有决策钥匙')
}

function intentOf(events) {
  const rows = (events || []).filter(event => eventTypeOf(event) === 'decision.recorded')
  const last = rows[rows.length - 1] || null
  return {
    bucket: String(last?.bucket ?? last?.Bucket ?? ''),
    source: String(last?.source ?? last?.Source ?? ''),
    text: String(last?.text ?? last?.Text ?? ''),
    count: rows.length,
  }
}

export function describeAccountIntentGrant(status, settings) {
  const problems = []
  if (!status || status.state !== 'active' || status.authenticated !== true) {
    problems.push('账户未登录')
  }
  const jev = settings?.jev
  if (String(jev?.api_key ?? '').trim()) problems.push('设置回执里出现了决策钥匙')
  if (jev?.session_only === true) problems.push('钥匙是这次会话手填的，不是账户下发')
  if (!jev?.has_api_key) problems.push('登录后账户没有发下决策钥匙')
  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('；') : '登录后账户发下了决策钥匙',
  }
}

export async function readAccountIntentGrant(driver) {
  const status = await driver.invoke('GetAccountStatus', []).catch(() => null)
  const settings = await driver.invoke('GetSettings', []).catch(() => null)
  return describeAccountIntentGrant(status, settings)
}

function conversationIdOf(row) {
  return String(row?.id ?? row?.ID ?? '')
}

function newConversations(before, after) {
  const old = new Set((before || []).map(conversationIdOf))
  return (after || []).filter(row => !old.has(conversationIdOf(row)))
}

function confirmIds(events) {
  const ids = []
  for (const event of events || []) {
    const request = parseCompanionConfirm(event)
    if (request?.conversationId) ids.push(request.conversationId)
  }
  return ids
}

async function companionAsk(driver, prompt, options = {}) {
  if (options.grant !== false) {
    const grant = await readAccountIntentGrant(driver)
    if (!grant.ok) return { blocked: fail(grant.detail) }
  }
  const route = await resolveCompanionModelRoute(driver)
  if (!route.ok) {
    return { blocked: fail(`${route.detail}；source=${route.source || 'none'}`) }
  }
  await leaveSettings(driver).catch(() => {})
  await driver.invoke('ShowCompanionChatWindow', [{ focus: false }]).catch(() => {})
  await driver.drainCompanionEvents().catch(() => [])
  const before = await driver.listConversations().catch(() => [])
  await driver.sendCompanionMessage(prompt)
  const turn = await driver.waitForCompanionTurn(options.timeoutMs || TURN_MS, {
    autoConfirm: options.autoConfirm !== false,
    returnOnConfirm: options.returnOnConfirm === true,
    rejectConfirm: options.rejectConfirm === true,
  })
  const after = await driver.listConversations().catch(() => before)
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  return {
    before,
    after,
    turn,
    page,
    intent: intentOf(turn.events),
  }
}

function userSawIntentLine(page) {
  return /决策：|Decision:/.test(visibleTranscriptText(page))
}

function cloudFoldProblem(intent) {
  const text = String(intent?.text ?? '')
  if (!text) return '没有折叠记录'
  if (intent?.source !== 'jev') return `来源不是 Jev：${intent?.source || '空'} ${text}`
  if (/主模型|conversation model/.test(text)) return `走了主模型兜底，不是云端：${text}`
  if (!/\bJev\b/.test(text)) return `折叠没有写明云端判定：${text}`
  return ''
}

function modelFoldProblem(intent) {
  const text = String(intent?.text ?? '')
  if (!text) return '没有决策记录'
  if (intent?.source !== 'model') return `来源不是主模型：${intent?.source || '空'} ${text}`
  if (!/主模型|conversation model/.test(text)) return `记录没有标明主模型：${text}`
  if (/\bJev\b/.test(text)) return `没接上仍写成了 Jev：${text}`
  return ''
}

function judgeIntentSurface(result, { bucket, cloud = true } = {}) {
  if (userSawIntentLine(result.page)) return fail('分类结果写进了用户发出的那句话')
  if (bucket && result.intent.bucket !== bucket) {
    return fail(`折叠记录不是${bucket}：${result.intent.text || '没有记录'}`)
  }
  const why = cloud ? cloudFoldProblem(result.intent) : modelFoldProblem(result.intent)
  if (why) return fail(why)
  return null
}

function turnFailed(turn) {
  if (!turn) return '没有回合'
  if (turn.timeout) return '回合超时'
  if (turn.sidecarStopped) return 'sidecar 停了'
  if (companionTurnErrored(turn.events)) return turn.error || '回合失败'
  return ''
}

export async function runIntentChat(driver) {
  const marker = `intent-chat-${Date.now().toString(36)}`
  const result = await companionAsk(driver, `${marker} 今天过得怎么样？用一句话回我就行。`)
  if (result.blocked) return result.blocked
  const broken = turnFailed(result.turn)
  if (broken) return fail(`闲聊${broken}`)
  const reply = transcriptHasAssistantReply(result.page)
  if (!reply.ok) return fail(reply.reason)
  if (result.turn.confirmed > 0 || newConversations(result.before, result.after).length) {
    return fail('闲聊派了会话')
  }
  const surface = judgeIntentSurface(result, { bucket: 'chat' })
  if (surface) return surface
  return pass(`闲聊直接回。${result.intent.text}`)
}

export async function runIntentDeep(driver) {
  const marker = `intent-deep-${Date.now().toString(36)}`
  const result = await companionAsk(
    driver,
    `${marker} 数组和链表，插入一个元素哪个更贵？用几句说完。`,
  )
  if (result.blocked) return result.blocked
  const broken = turnFailed(result.turn)
  if (broken) return fail(`深入思考${broken}`)
  const reply = transcriptHasAssistantReply(result.page)
  if (!reply.ok) return fail(reply.reason)
  if (result.turn.confirmed > 0 || newConversations(result.before, result.after).length) {
    return fail('深入思考派了会话')
  }
  const surface = judgeIntentSurface(result, { bucket: 'deep' })
  if (surface) return surface
  return pass(`这一轮自己答完。${result.intent.text}`)
}

async function askLong(driver, marker, options = {}) {
  return companionAsk(
    driver,
    `${marker} 帮我在仓库里新建一个文本文件，里面写一行 ok，做完告诉我。`,
    options,
  )
}

export async function runIntentLong(driver) {
  const marker = `intent-long-${Date.now().toString(36)}`
  const result = await askLong(driver, marker)
  if (result.blocked) return result.blocked
  const surface = judgeIntentSurface(result, { bucket: 'long' })
  if (surface) return surface
  const opened = newConversations(result.before, result.after)
  if (result.turn.confirmed < 1 && !opened.length && !confirmIds(result.turn.events).length) {
    return fail('长任务没有派出会话')
  }
  const text = visibleTranscriptText(result.page)
  if (/companion-host-notice/.test(text)) return fail('过程里把通知标记显示成了用户的话')
  return pass(`长任务已派。${result.intent.text}`)
}

export async function runIntentStatus(driver) {
  const marker = `intent-status-${Date.now().toString(36)}`
  const started = await askLong(driver, marker, { returnOnConfirm: true, timeoutMs: 90_000 })
  if (started.blocked) return started.blocked
  if (started.turn.confirmed < 1 && !newConversations(started.before, started.after).length) {
    return fail('还没派出会话，追问没法对着同一条')
  }
  const follow = await companionAsk(driver, `${marker} 刚才那条做到哪了？`)
  if (follow.blocked) return follow.blocked
  const broken = turnFailed(follow.turn)
  if (broken) return fail(`追问${broken}`)
  if (follow.turn.confirmed > 0 || newConversations(follow.before, follow.after).length) {
    return fail('追问又派了一条会话')
  }
  const reply = transcriptHasAssistantReply(follow.page)
  if (!reply.ok) return fail(reply.reason)
  return pass('追问对着已派的会话，没有另派')
}

async function dispatchedTurn(driver, marker) {
  const result = await askLong(driver, marker, { returnOnConfirm: true, timeoutMs: 90_000 })
  if (result.blocked) return result
  const ids = [
    ...confirmIds(result.turn.events),
    ...newConversations(result.before, result.after).map(conversationIdOf),
  ].filter(Boolean)
  return { ...result, conversationId: ids[0] || '' }
}

export async function runIntentDone(driver) {
  const marker = `intent-done-${Date.now().toString(36)}`
  const started = await dispatchedTurn(driver, marker)
  if (started.blocked) return started.blocked
  if (!started.conversationId) return fail('做完通知没有派成功的会话')
  const coding = await driver.waitForTurn(started.conversationId, TURN_MS).catch(error => ({
    failed: true,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (coding?.failed) return fail(`派出去的回合没走完：${coding.error || '失败'}`)
  const notice = await driver.waitForCompanionTurn(90_000).catch(() => null)
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  const text = visibleTranscriptText(page)
  if (/companion-host-notice/.test(text)) return fail('做完通知把标记显示成了用户的话')
  const reply = transcriptHasAssistantReply(page)
  if (!reply.ok) return fail(notice?.timeout ? '做完之后她没有再开口' : reply.reason)
  return pass('派成功的会话做完后她通知了')
}

export async function runIntentNoticesMerge(driver) {
  const left = `intent-merge-a-${Date.now().toString(36)}`
  const right = `intent-merge-b-${Date.now().toString(36)}`
  const first = await dispatchedTurn(driver, left)
  if (first.blocked) return first.blocked
  const second = await dispatchedTurn(driver, right)
  if (second.blocked) return second.blocked
  if (!first.conversationId || !second.conversationId) return fail('两次派发没有都留下会话')
  await driver.waitForTurn(first.conversationId, TURN_MS).catch(() => null)
  await driver.waitForTurn(second.conversationId, TURN_MS).catch(() => null)
  const page = await driver.listCompanionTranscript(120).catch(() => null)
  const text = visibleTranscriptText(page)
  if (!text.includes(left) || !text.includes(right)) {
    return fail('同一次通知里没有同时看见两条会话标题')
  }
  return pass('两条做完通知都在')
}

export async function runIntentApproval(driver) {
  const marker = `intent-approval-${Date.now().toString(36)}`
  const result = await companionAsk(
    driver,
    `${marker} 帮我画一张小猫。`,
    { autoConfirm: false, returnOnConfirm: true, timeoutMs: 90_000 },
  )
  if (result.blocked) return result.blocked
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  const text = visibleTranscriptText(page)
  if (!/等你|批准|同意|approval/i.test(text)) {
    return fail('弹出批准时她没有说在等你点')
  }
  if (result.turn.confirmed > 0) return fail('她替用户点了同意')
  return pass('待批时她通知了，没有替用户点')
}

export async function runIntentError(driver) {
  const marker = `intent-error-${Date.now().toString(36)}`
  const started = await dispatchedTurn(driver, marker)
  if (started.blocked) return started.blocked
  if (!started.conversationId) return fail('真报错这条没有派成功的会话')
  const coding = await driver.waitForTurn(started.conversationId, 60_000).catch(() => null)
  const events = coding?.events || []
  const engineError = events.some(event => eventTypeOf(event) === 'engine.error')
  const retryable = events.some(event => /rate limit|context length|overflow/i.test(String(event?.error ?? event?.Error ?? '')))
  if (!engineError) {
    return skip('这一轮没有凭据撤回、模型拒绝、余额或权限错误')
  }
  if (retryable) return fail('限流或上下文溢出先开口了')
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  const reply = transcriptHasAssistantReply(page)
  if (!reply.ok) return fail('真报错之后她没有说')
  return pass('真报错时她说了一句')
}

export async function runIntentToolContinues(driver) {
  const marker = `intent-tool-${Date.now().toString(36)}`
  const result = await companionAsk(
    driver,
    `${marker} 先跑一条会失败的命令，失败了就换个办法，最后告诉我结果。`,
  )
  if (result.blocked) return result.blocked
  const id = confirmIds(result.turn.events)[0]
    || newConversations(result.before, result.after).map(conversationIdOf)[0]
  if (!id) return fail('工具失败这条没有派出会话')
  const coding = await driver.waitForTurn(id, TURN_MS).catch(error => ({
    failed: true,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (coding?.failed && !coding?.settled) return fail(`工具失败后会话没有继续：${coding.error || '失败'}`)
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  const reply = transcriptHasAssistantReply(page)
  if (!reply.ok) return fail('真正做完时她没有通知')
  return pass('工具失败后会话还在，做完才通知')
}

export async function runIntentStall(driver) {
  const marker = `intent-stall-${Date.now().toString(36)}`
  const started = await dispatchedTurn(driver, `${marker} 帮我把仓库里每个目录都看一遍，先别中途汇报。`)
  if (started.blocked) return started.blocked
  if (!started.conversationId) return fail('卡住这条没有派出会话')
  const midway = await driver.listCompanionTranscript(40).catch(() => null)
  const early = visibleTranscriptText(midway)
  if (new RegExp(marker).test(early) && /卡住|还在跑|stall/i.test(early)) {
    return fail('进度还在走她就开口了')
  }
  await driver.waitForTurn(started.conversationId, TURN_MS).catch(() => null)
  const page = await driver.listCompanionTranscript(80).catch(() => null)
  const text = visibleTranscriptText(page)
  if (!/说不说|要不要说|stall/i.test(text)) {
    return fail('进度停了，没有说不说的记录')
  }
  return pass('进度停了之后才问说不说')
}

export async function runIntentMemory(driver) {
  const marker = productLoopMemoryMarker('intentmem')
  const fragment = `intent-fragment-${Date.now().toString(36)}`
  let before
  try {
    before = await driver.getCompanionMemory()
  } catch (error) {
    return fail(`读不到记忆：${error instanceof Error ? error.message : error}`)
  }
  const kept = await companionAsk(driver, companionMemoryPreferencePrompt(marker))
  if (kept.blocked) return kept.blocked
  const broken = turnFailed(kept.turn)
  if (broken) return fail(`记忆回合${broken}`)
  const judged = await pollCompanionMemoryWrite(
    () => driver.getCompanionMemory(),
    before,
    { userText: companionMemoryPreferencePrompt(marker), marker },
    { timeoutMs: 60_000 },
  )
  if (!judged.ok) return fail(judged.reason || '稳定称呼没有留下')
  const dropped = await companionAsk(driver, `${fragment} 这句不用记，只回一个字好。`)
  if (dropped.blocked) return dropped.blocked
  const after = await driver.getCompanionMemory().catch(() => null)
  const hay = JSON.stringify(after ?? {})
  if (hay.includes(fragment)) return fail('一次性碎片被留下了')
  const surface = judgeIntentSurface(kept, {})
  if (surface) return surface
  const text = `${kept.intent.text}\n${dropped.intent.text}\n${visibleTranscriptText(dropped.page)}`
  if (!/决策|记忆/.test(text)) return fail('记录里没有这次记忆判断')
  const forgotten = await forgetCompanionMemoryIds(driver, judged.ids)
  if (!forgotten.ok) return fail(forgotten.reason)
  return pass(`称呼 ${marker} 留下了，碎片没有留下`)
}

export async function runIntentOtherSilent(driver) {
  const title = `intent-other-${Date.now().toString(36)}`
  const workspace = await mkdtemp(join(tmpdir(), 'milksu-intent-'))
  const before = await driver.listCompanionTranscript(40).catch(() => null)
  const conversation = await driver.createConversation({
    title,
    workspacePath: workspace,
    kernel: 'pi',
    approvalPolicy: 'workspace-auto',
  })
  await driver.sendMessage(conversation.id, '只回复一个字好。', workspace)
  const coding = await driver.waitForTurn(conversation.id, TURN_MS).catch(error => ({
    failed: true,
    error: error instanceof Error ? error.message : String(error),
  }))
  if (coding?.failed) return fail(`没派的会话自己没走完：${coding.error || '失败'}`)
  const after = await driver.listCompanionTranscript(80).catch(() => null)
  const added = visibleTranscriptText(after).replace(visibleTranscriptText(before), '')
  if (added.includes(title)) return fail('不是她派的会话结束时她补了一句')
  return pass('没派的会话结束时她没有补一句')
}

export async function runIntentNoticeWaits(driver) {
  const marker = `intent-wait-${Date.now().toString(36)}`
  const started = await dispatchedTurn(driver, marker)
  if (started.blocked) return started.blocked
  if (!started.conversationId) return fail('开口时不串话没有派成功的会话')
  const question = `${marker} 今天星期几？`
  await driver.sendCompanionMessage(question)
  await driver.waitForTurn(started.conversationId, TURN_MS).catch(() => null)
  const turn = await driver.waitForCompanionTurn(TURN_MS).catch(() => null)
  const page = await driver.listCompanionTranscript(120).catch(() => null)
  const text = visibleTranscriptText(page)
  if (text.includes(question) && /companion-host-notice/.test(text)) {
    return fail('通知正文拼进了用户那句话')
  }
  if (!text.includes(question)) return fail('用户那句没有单独出现')
  if (turn?.timeout && !transcriptHasAssistantReply(page).ok) return fail('用户那句没有自己走完一轮')
  return pass('通知和用户的问题按顺序各走了一轮')
}

export async function runIntentAccountIssued(driver) {
  const grant = await readAccountIntentGrant(driver)
  if (!grant.ok) return fail(grant.detail)
  const blank = await runIntentSettingsBlank(driver)
  if (blank.result !== 'PASS') return blank
  return pass(grant.detail)
}

export async function runIntentSettingsReject(driver) {
  const before = await driver.invoke('GetSettings', [])
  const marker = 'product-loop-rejected-intent-key'
  try {
    await driver.invoke('SaveSettingsCmd', [{
      ...before,
      jev: { api_key: marker, session_only: true },
    }])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (detail.includes(marker)) return fail('拒绝手填钥匙时把钥匙写进了错误')
    return fail(`手填钥匙时设置保存失败：${detail}`)
  }
  const after = await driver.invoke('GetSettings', [])
  const snap = JSON.stringify(after ?? {})
  if (snap.includes(marker)) return fail('设置回执里出现了手填的决策钥匙')
  if (after?.jev?.session_only === true) return fail('手填钥匙留成了本次会话')
  if (before?.jev?.has_api_key && !after?.jev?.has_api_key) return fail('手填把账户发下的钥匙清掉了')
  return pass('设置里写不进决策钥匙')
}

async function poll(driver, ready, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const grant = await readAccountIntentGrant(driver)
    if (ready(grant)) return grant
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return readAccountIntentGrant(driver)
}

export async function runLoggedOutIntentFallback(driver) {
  let grant = await readAccountIntentGrant(driver)
  if (grant.ok) grant = await poll(driver, row => !row.ok, 15_000)
  if (grant.ok) return fail('还登录着，并且账户钥匙还在。主模型兜底要在退出登录之后测。')
  const marker = `intent-fallback-${Date.now().toString(36)}`
  const result = await companionAsk(
    driver,
    `${marker} 今天过得怎么样？用一句话回我就行。`,
    { grant: false },
  )
  if (result.blocked) return result.blocked
  const broken = turnFailed(result.turn)
  if (broken) return fail(`主模型兜底${broken}`)
  const surface = judgeIntentSurface(result, { cloud: false })
  if (surface) return surface
  return pass(result.intent.text)
}

async function runDisconnectedFallback(driver) {
  await driver.invoke('LogoutAccount', []).catch(() => {})
  const cleared = await poll(driver, grant => !grant.ok, 20_000)
  if (cleared.ok) return fail('退出登录后决策钥匙还在')
  const result = await runLoggedOutIntentFallback(driver)
  const { signInProductLoopAccount } = await import('./product-loop-first-use.mjs')
  await signInProductLoopAccount(driver).catch(() => {})
  const restored = await poll(driver, grant => grant.ok, 90_000)
  if (!restored.ok) {
    return fail(`${result.detail || '主模型兜底'}。再登录后账户钥匙没有回来：${restored.detail}`)
  }
  if (result.result !== 'PASS') return result
  return pass(`${result.detail}。再登录后账户钥匙还在。`)
}

export async function runIntentFallbackRecord(driver, options = {}) {
  if (options.intentFallbackSeen) {
    const grant = await readAccountIntentGrant(driver)
    if (!grant.ok) return fail(`未登录窗口已看过主模型，登录后钥匙没回来：${grant.detail}`)
    return pass('未登录窗口已标明主模型。登录后账户钥匙还在。')
  }
  const grant = await readAccountIntentGrant(driver)
  if (grant.ok) return runDisconnectedFallback(driver)
  return runLoggedOutIntentFallback(driver)
}
