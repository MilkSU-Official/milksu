/**
 * User-memory and CVE learning checks for the product loop.
 * Not imported by App startup. GUI runners call these judges; the catalog
 * test calls them without Electron.
 */

import { delay } from './desktop-gui-driver.mjs'
import { clickAria, fail, pageSnapshot } from './product-loop-session.mjs'
import { redactProcessText } from '../../sidecar/dsh/redact.js'
import {
  createMemoryExtractController,
  memoryExtractInstructions,
  normalizeMemoryExtract,
  normalizeMemoryExtractIdleMinutes,
  parseMemoryExtractResult,
} from '../../sidecar/companion/memory-extract.js'
import { companionSystemPrompt } from '../../sidecar/companion/system-prompt.js'
import { isCompanionRelay, tracksUserMemory, withUserMemoryMessages } from '../../sidecar/pi/user-memory.js'
import { buildDshPromptBlocks } from '../../sidecar/dsh/prompt-blocks.js'

export {
  buildDshPromptBlocks,
  companionSystemPrompt,
  createMemoryExtractController,
  isCompanionRelay,
  memoryExtractInstructions,
  normalizeMemoryExtract,
  normalizeMemoryExtractIdleMinutes,
  parseMemoryExtractResult,
  tracksUserMemory,
  withUserMemoryMessages,
}

export const PRODUCT_LOOP_CVE_ID = 'CVE-2099-4242'
const GREETING = /^(你好|您好|嗨|hi|hello|hey|在吗)[!！.。,\s]*$/i
const FLAG = /\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}/i
const SECRET_KEY = /\bsk-[A-Za-z0-9_-]{12,}\b/
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i
const REPO_RULE = /仓库|分支|repository|branch rule|project rule/i
const APPROVAL = /待批准|批准这条|已记下/
const EXTRACT_REQUIRED = [
  ['关闭', 'Off'],
  ['每轮结束', 'Each turn'],
  ['闲置后', 'After idle'],
]
const EXTRACT_BANNED = ['每天', '每周', '每次开启', 'Daily', 'Weekly', 'On open', '每次打开']
const IDLE_MINUTES = [5, 10, 15, 30, 60]

export function memoryErrorText(error) {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return redactProcessText(text, 400)
}

export function productLoopMemoryMarker(prefix) {
  return `${prefix}${Date.now().toString(36)}`
}

export function companionMemoryPreferencePrompt(marker) {
  return `我的称呼固定是 ${marker}。只回一个字：好`
}

export function codingUserMemoryPrompt(marker) {
  return `我的称呼固定是 ${marker}。只回一个字：好。不要调用工具，不要改文件。`
}

export function cveLearningNote(marker) {
  return `${marker} 这次只记产品回归用的一句复盘。`
}

export function cveResearchConversationId(cveId) {
  return `cve-research-${String(cveId ?? '').trim().toLowerCase()}`
}

function memoryRows(snapshot, name) {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  const rows = snapshot?.[name] ?? snapshot?.[pascal]
  return Array.isArray(rows) ? rows : []
}

function memoryId(row) {
  return String(row?.id ?? row?.ID ?? '').trim()
}

function memoryField(row, name) {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  return String(row?.[name] ?? row?.[pascal] ?? '').trim()
}

function memoryEvidence(row) {
  return memoryField(row, 'evidence')
}

function memoryMarkdown(row) {
  return memoryField(row, 'markdown')
}

function memoryTitle(row) {
  return memoryField(row, 'title')
}

function indexById(rows) {
  const map = new Map()
  for (const row of rows) {
    const id = memoryId(row)
    if (id) map.set(id, row)
  }
  return map
}

function rowBlob(row) {
  return [memoryTitle(row), memoryMarkdown(row), memoryEvidence(row)].filter(Boolean).join('\n')
}

export function isGreetingOnly(text) {
  return GREETING.test(String(text ?? '').trim())
}

export function memoryTurnIgnored({ sessionId = '', userText = '' } = {}) {
  if (sessionId && !tracksUserMemory(sessionId)) return true
  if (isCompanionRelay(userText)) return true
  return isGreetingOnly(userText)
}

function memoryLooksLikeRepoRule(row) {
  return REPO_RULE.test(`${memoryTitle(row)}\n${memoryMarkdown(row)}`)
}

function memoryLooksLikeSecret(row) {
  return FLAG.test(rowBlob(row)) || SECRET_KEY.test(rowBlob(row)) || BEARER.test(rowBlob(row))
}

function freshApproved(beforeRows, afterRows) {
  const previous = indexById(beforeRows)
  const fresh = []
  for (const row of afterRows) {
    const id = memoryId(row)
    const prior = id ? previous.get(id) : null
    if (!prior) {
      fresh.push(row)
      continue
    }
    if (memoryEvidence(prior) !== memoryEvidence(row) || memoryMarkdown(prior) !== memoryMarkdown(row)) {
      fresh.push(row)
    }
  }
  return fresh
}

export function judgeCompanionMemoryWrite(before, after, {
  userText = '',
  marker = '',
  sessionId = '',
} = {}) {
  const source = String(userText ?? '')
  const token = String(marker ?? '').trim()
  const pendingBefore = indexById(memoryRows(before, 'pending'))
  const pendingAfter = memoryRows(after, 'pending')
  const approvedAfter = memoryRows(after, 'approved')
  const newPending = pendingAfter.filter(row => {
    const id = memoryId(row)
    return !id || !pendingBefore.has(id)
  })
  if (newPending.length || pendingAfter.some(row => token && rowBlob(row).includes(token))) {
    return { ok: false, fatal: true, reason: '出现了待批准记忆', ids: [] }
  }
  const fresh = freshApproved(memoryRows(before, 'approved'), approvedAfter)
  if (memoryTurnIgnored({ sessionId, userText: source })) {
    if (fresh.length) {
      return { ok: false, fatal: true, reason: '打招呼、转达或探针不该写下记忆', ids: [] }
    }
    return { ok: true, fatal: false, reason: '探针、转达或打招呼没有写下记忆', ids: [] }
  }
  if (!fresh.length) {
    return { ok: false, fatal: false, reason: '还没有写下带标记的记忆', ids: [] }
  }
  for (const row of fresh) {
    const evidence = memoryEvidence(row)
    if (!evidence || !source.includes(evidence)) {
      return { ok: false, fatal: true, reason: '新记忆的依据不是用户原话里的连续一段', ids: [] }
    }
    if (memoryLooksLikeRepoRule(row) || memoryLooksLikeSecret(row)) {
      return { ok: false, fatal: true, reason: '新记忆写成了仓库规矩、密钥或 Flag', ids: [] }
    }
    if (!memoryId(row)) {
      return { ok: false, fatal: true, reason: '新记忆没有 id', ids: [] }
    }
  }
  const hits = fresh.filter(row => token && memoryEvidence(row).includes(token))
  if (!hits.length) {
    return { ok: false, fatal: true, reason: `新记忆的依据没有包含标记 ${token}`, ids: [] }
  }
  return { ok: true, fatal: false, reason: '', ids: hits.map(row => memoryId(row)) }
}

export function judgeCompanionMemoryForgotten(snapshot, id) {
  const token = String(id ?? '').trim()
  const rows = [...memoryRows(snapshot, 'pending'), ...memoryRows(snapshot, 'approved')]
  if (token && rows.some(row => memoryId(row) === token)) {
    return { ok: false, reason: `忘掉之后 ${token} 又出现了` }
  }
  return { ok: true, reason: '' }
}

export async function pollCompanionMemoryWrite(read, before, spec, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 1_000
  const sleep = options.sleep ?? delay
  const started = Date.now()
  let last = { ok: false, fatal: false, reason: '还没有写下带标记的记忆', ids: [] }
  while (Date.now() - started <= timeoutMs) {
    let snapshot
    try {
      snapshot = await read()
    } catch (error) {
      return { ok: false, fatal: true, reason: `读记忆失败：${memoryErrorText(error)}`, ids: [] }
    }
    last = judgeCompanionMemoryWrite(before, snapshot, spec)
    if (last.ok || last.fatal) return last
    if (Date.now() - started >= timeoutMs) break
    await sleep(intervalMs)
  }
  return { ...last, fatal: true, reason: `${last.reason}（等到 ${timeoutMs}ms）` }
}

export async function forgetCompanionMemoryIds(driver, ids, options = {}) {
  const sleep = options.sleep ?? delay
  const unique = [...new Set((ids ?? []).map(id => String(id ?? '').trim()).filter(Boolean))]
  if (!unique.length) return { ok: false, reason: '没有可忘掉的记忆 id' }
  for (const id of unique) {
    try {
      await driver.invoke('ForgetCompanionMemory', [id])
    } catch (error) {
      return { ok: false, reason: `忘掉 ${id} 失败：${memoryErrorText(error)}` }
    }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(400)
    let snapshot
    try {
      snapshot = await driver.getCompanionMemory()
    } catch (error) {
      return { ok: false, reason: `忘掉之后读记忆失败：${memoryErrorText(error)}` }
    }
    for (const id of unique) {
      const judged = judgeCompanionMemoryForgotten(snapshot, id)
      if (!judged.ok) return judged
    }
  }
  return { ok: true, reason: '' }
}

export function rawCompanionMemoryExtract(settings) {
  return String(settings?.companion_memory_extract ?? settings?.CompanionMemoryExtract ?? '').trim()
}

export function memorySectionPrecedesPrivacy(headings) {
  const rows = (headings ?? []).map(text => String(text ?? '').trim()).filter(Boolean)
  const memory = rows.findIndex(text => text === '记忆' || text === 'Memory')
  const privacy = rows.findIndex(text => text === '隐私' || text === 'Privacy')
  if (memory < 0 || privacy < 0) {
    return { ok: false, reason: `设置里没有记忆或隐私：${rows.join(' / ') || '空'}` }
  }
  if (memory > privacy) {
    return { ok: false, reason: `记忆排在隐私后面：${rows.join(' / ')}` }
  }
  return { ok: true, reason: '' }
}

export function judgeExtractOptions(options) {
  const labels = (options ?? []).map(text => String(text ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const pair of EXTRACT_REQUIRED) {
    if (!pair.some(label => labels.includes(label))) {
      return { ok: false, reason: `提取菜单缺了 ${pair[0]}，实际是 ${labels.join(' / ') || '空'}` }
    }
  }
  const banned = EXTRACT_BANNED.find(label => labels.includes(label))
  if (banned) return { ok: false, reason: `提取菜单不该有 ${banned}` }
  return { ok: true, reason: '' }
}

export function judgeIdleMinutesLabel(label) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim()
  const match = text.match(/^(5|10|15|30|60) (分钟|min)$/)
  if (!match) return { ok: false, minutes: 0, reason: `闲置不是 5/10/15/30/60 分钟：${text || '空'}` }
  const minutes = Number(match[1])
  if (!IDLE_MINUTES.includes(minutes)) return { ok: false, minutes, reason: `闲置分钟不在档位里：${minutes}` }
  return { ok: true, minutes, reason: '' }
}

export function judgeMemorySearchRow(ariaLabels, memoryCount) {
  const labels = ariaLabels ?? []
  const visible = labels.includes('检索') || labels.includes('Search')
  if (memoryCount > 0 && !visible) return { ok: false, visible, reason: '有记忆时没有检索' }
  if (memoryCount === 0 && visible) return { ok: false, visible, reason: '没有记忆时却出现了检索' }
  return { ok: true, visible, reason: '' }
}

export function memoryApprovalChrome(text) {
  const match = String(text ?? '').match(APPROVAL)
  return match ? match[0] : ''
}

function blockText(block) {
  if (typeof block === 'string') return block
  if (typeof block?.text === 'string') return block.text
  if (typeof block?.Text === 'string') return block.Text
  if (Array.isArray(block?.content)) return block.content.map(blockText).join('')
  if (Array.isArray(block?.Content)) return block.Content.map(blockText).join('')
  return ''
}

export function userPromptCarriesMemoryBlock(blocks) {
  const list = Array.isArray(blocks) ? blocks : [blocks]
  return list.some(block => {
    if (!block || block.role === 'custom' || block.customType === 'milksu.user-memory') return false
    return /^(用户记忆|User memory)\n/.test(blockText(block).trim())
  })
}

export function memoryTranscriptAnomaly(text) {
  const hay = String(text ?? '')
  if (/\[object Object\]/i.test(hay)) return '[object Object]'
  if (/companion-host-\d+/i.test(hay)) return 'companion-host 请求号'
  if (/request aborted|aborterror/i.test(hay) && !/这一轮已取消|This turn was cancelled/i.test(hay)) {
    return 'Request aborted'
  }
  if (/companion_float_enabled|tokenflux\.dev\/v1/i.test(hay) && /[{[]/.test(hay)) return '设置 JSON'
  return memoryApprovalChrome(hay)
}

export function visibleTranscriptText(value) {
  const entries = Array.isArray(value) ? value : (value?.entries ?? value?.Entries ?? [])
  return (Array.isArray(entries) ? entries : []).map(entry => [
    entry?.text,
    entry?.Text,
    entry?.error,
    entry?.Error,
    entry?.content,
    entry?.Content,
    blockText(entry),
  ].map(item => (typeof item === 'string' ? item : '')).join('\n')).join('\n')
}

export function domainMemoryFileKind(name) {
  const base = String(name ?? '').split(/[\\/]/).pop()
  if (base === 'LEARNING.md' || base === 'MEMORY.md') return 'domain'
  if (base === 'TASK.md') return 'not-memory'
  return 'other'
}

export function learningContents(projection) {
  const rows = projection?.learning ?? projection?.Learning ?? []
  return (Array.isArray(rows) ? rows : []).map(row => String(row?.content ?? row?.Content ?? ''))
}

export function learningIdForNote(projection, note) {
  const rows = projection?.learning ?? projection?.Learning ?? []
  const found = (Array.isArray(rows) ? rows : []).find(row => String(row?.content ?? row?.Content ?? '').includes(note))
  return String(found?.id ?? found?.ID ?? '').trim()
}

function learningHasSecret(text) {
  const body = String(text ?? '')
  return SECRET_KEY.test(body) || BEARER.test(body) || FLAG.test(body)
}

export function judgeLearningRound({ phase, exists, text, note, remaining = 0, readError = '' } = {}) {
  if (readError) return { ok: false, reason: `读 LEARNING.md 失败：${redactProcessText(readError, 200)}` }
  if (learningHasSecret(text)) return { ok: false, reason: 'LEARNING.md 留下了密钥或 Flag' }
  if (phase === 'saved') {
    if (!exists) return { ok: false, reason: '记下了但 LEARNING.md 没有写出来' }
    if (!String(text ?? '').includes(note)) return { ok: false, reason: 'LEARNING.md 没有这条复盘' }
    return { ok: true, reason: '' }
  }
  if (remaining > 0) {
    if (!exists) return { ok: false, reason: '还有别的复盘，LEARNING.md 却没了' }
    if (String(text ?? '').includes(note)) return { ok: false, reason: '忘掉的复盘还在 LEARNING.md' }
    return { ok: true, reason: '' }
  }
  if (exists) return { ok: false, reason: '复盘都忘掉了，LEARNING.md 还在' }
  return { ok: true, reason: '' }
}

async function pressEscape(driver) {
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

export async function readSettingsHeadings(driver) {
  const headings = await driver.cdp.evaluate(`Array.from(document.querySelectorAll('h2')).map(node => (node.textContent || '').trim()).filter(Boolean)`)
  return Array.isArray(headings) ? headings : []
}

export async function readSettingsPickerOptions(driver, ariaLabels) {
  const opened = await clickAria(driver, ariaLabels)
  if (!opened) return { ok: false, options: [], reason: `点不开 ${ariaLabels[0]}` }
  await delay(200)
  const options = await driver.cdp.callFunction(`function() {
    const menus = Array.from(document.querySelectorAll('[data-slot="popover-content"]'))
    const root = menus.find(node => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })
    if (!root) return []
    return Array.from(root.querySelectorAll('button')).map(node => (node.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)
  }`)
  await pressEscape(driver)
  await delay(150)
  return { ok: true, options: Array.isArray(options) ? options : [], reason: '' }
}

export async function chooseSettingsPicker(driver, ariaLabels, optionLabels) {
  const opened = await clickAria(driver, ariaLabels)
  if (!opened) return { ok: false, reason: `点不开 ${ariaLabels[0]}` }
  await delay(200)
  const picked = await driver.cdp.callFunction(`function(labels) {
    const menus = Array.from(document.querySelectorAll('[data-slot="popover-content"]'))
    const root = menus.find(node => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })
    if (!root) return false
    const button = Array.from(root.querySelectorAll('button')).find(node => labels.includes((node.textContent || '').replace(/\\s+/g, ' ').trim()))
    if (!button) return false
    button.click()
    return true
  }`, [optionLabels])
  if (!picked) return { ok: false, reason: `菜单里没有 ${optionLabels[0]}` }
  await delay(250)
  return { ok: true, reason: '' }
}

export async function pollCompanionMemoryExtract(driver, expected, timeoutMs = 5_000) {
  const started = Date.now()
  let last = ''
  while (Date.now() - started <= timeoutMs) {
    try {
      last = rawCompanionMemoryExtract(await driver.invoke('GetSettings', []))
    } catch (error) {
      return { ok: false, value: last, reason: `读不到设置：${memoryErrorText(error)}` }
    }
    if (last === expected) return { ok: true, value: last, reason: '' }
    await delay(200)
  }
  return { ok: false, value: last, reason: `提取仍是 ${last || '空'}，要的是 ${expected}` }
}

export async function withCompanionMemoryExtract(driver, mode, run) {
  let settings
  try {
    settings = await driver.invoke('GetSettings', [])
  } catch (error) {
    return fail(`读不到设置：${memoryErrorText(error)}`)
  }
  const previousMode = rawCompanionMemoryExtract(settings) || 'turn'
  const previousIdle = settings?.companion_memory_extract_idle_minutes ?? settings?.CompanionMemoryExtractIdleMinutes ?? 10
  const changed = previousMode !== mode
  if (changed) {
    try {
      await driver.invoke('SaveSettingsCmd', [{ ...settings, companion_memory_extract: mode }])
    } catch (error) {
      return fail(`设不成提取时机：${memoryErrorText(error)}`)
    }
  }
  try {
    return await run()
  } finally {
    if (changed) {
      const latest = await driver.invoke('GetSettings', []).catch(() => settings)
      const base = latest && typeof latest === 'object' ? latest : settings
      await driver.invoke('SaveSettingsCmd', [{
        ...base,
        companion_memory_extract: previousMode,
        companion_memory_extract_idle_minutes: previousIdle,
      }]).catch(() => {})
    }
  }
}

export async function ariaLabelsOf(driver) {
  const snap = await pageSnapshot(driver)
  return Array.isArray(snap?.aria) ? snap.aria : []
}

export function approvedMemoryCount(snapshot) {
  return memoryRows(snapshot, 'approved').length
}
