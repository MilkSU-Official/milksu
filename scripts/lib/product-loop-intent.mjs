/**
 * Black-box cases for the intent topic. User-visible only.
 * Not imported by App startup.
 */

import {
  fail,
  openSettingsCategory,
  pageSnapshot,
  pass,
  snapshotHas,
} from './product-loop-session.mjs'

const KEY_LEAK = ['Jev API', 'jev api', 'OpenRouter API Key', '意图识别钥匙', 'Intent API key']

export async function runIntentSettingsBlank(driver) {
  const opened = await openSettingsCategory(driver, ['看板娘', 'Companion'])
  if (!opened.ok) return fail(opened.detail || '打不开看板娘设置')
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, KEY_LEAK)) return fail('设置里还能看见意图识别钥匙')
  return pass('设置里没有意图识别钥匙')
}

function pending(title) {
  return async function intentCaseNotReady() {
    return fail(`${title}：黑盒已列入意图识别专题，产品表面还没有这次回执`)
  }
}

export const runIntentChat = pending('闲聊直接回')
export const runIntentDeep = pending('深入思考仍在这一轮')
export const runIntentLong = pending('长任务派出去')
export const runIntentDone = pending('做完她通知')
export const runIntentApproval = pending('待批她通知')
export const runIntentError = pending('真报错她通知')
export const runIntentStall = pending('卡住才问说不说')
export const runIntentMemory = pending('记忆留或丢')
export const runIntentOtherSilent = pending('没派的会话不说')
export const runIntentFallbackRecord = pending('没接上标明主模型')
