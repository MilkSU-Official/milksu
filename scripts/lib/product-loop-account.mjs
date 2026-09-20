/**
 * Profile and update chrome.
 */

import { delay } from './desktop-gui-driver.mjs'
import {
  clickLabeled,
  clickRole,
  expectLabels,
  fail,
  fillAria,
  leaveSettings,
  pageSnapshot,
  pass,
  snapshotHas,
} from './product-loop-session.mjs'

async function openUserMenu(driver) {
  const opened = await driver.cdp.callFunction(`function() {
    const button = Array.from(document.querySelectorAll('button')).find(item => {
      const label = item.getAttribute('aria-label') || ''
      return label === '账户与工作区' || label === 'Account and workspace'
    })
    if (!button) return false
    button.click()
    return true
  }`)
  if (opened) await delay(250)
  return opened
}

async function openProfile(driver) {
  await leaveSettings(driver)
  if (!await openUserMenu(driver)) return { ok: false, detail: '打不开账户与工作区菜单' }
  if (!await clickLabeled(driver, ['个人资料', 'Profile'])) return { ok: false, detail: '菜单里找不到个人资料' }
  await delay(400)
  return snapshotHas(await pageSnapshot(driver), ['个人资料', 'Profile', '编辑资料', 'Edit profile'])
    ? { ok: true }
    : { ok: false, detail: '没看见个人资料页' }
}

export async function runProfileOpen(driver) {
  const opened = await openProfile(driver)
  return opened.ok ? pass('个人资料页打开了') : fail(opened.detail)
}

export async function runProfileEdit(driver) {
  const opened = await openProfile(driver)
  if (!opened.ok) return fail(opened.detail)
  if (!await clickLabeled(driver, ['编辑资料', 'Edit profile'])) return fail('找不到编辑资料')
  await delay(250)
  const name = `loop-${Date.now().toString(36)}`
  const bio = 'product-loop 正在测编辑资料'
  if (!await fillAria(driver, ['显示名称', 'Display name'], name)) return fail('找不到显示名称')
  if (!await fillAria(driver, ['个人介绍', 'Bio'], bio)) return fail('找不到个人介绍')
  if (!await clickLabeled(driver, ['保存', 'Save'])) return fail('找不到保存')
  await delay(300)
  const stored = await driver.cdp.evaluate(`({
    name: window.localStorage.getItem('milksu.profile.name') || '',
    bio: window.localStorage.getItem('milksu.profile.bio') || '',
  })`)
  return stored?.name === name && stored?.bio === bio
    ? pass('显示名称和个人介绍已经留下')
    : fail(`保存后 name=${stored?.name || ''} bio=${stored?.bio ? '有' : '空'}`)
}

export async function runProfileTabs(driver) {
  const opened = await openProfile(driver)
  if (!opened.ok) return fail(opened.detail)
  const tablist = '[role="tablist"][aria-label="成长模块"], [role="tablist"][aria-label="Progress modules"]'
  for (const label of ['CTF', 'CVE', 'Coding']) {
    if (!await clickRole(driver, 'tab', [label], tablist)) return fail(`资料页切不到 ${label}`)
    await delay(200)
  }
  const panel = await pageSnapshot(driver)
  return snapshotHas(panel, ['Coding 活动与用量', 'Coding activity and usage', 'CTF 练习与验证', 'CVE 研究与来源'])
    ? pass('资料页三个页签都能点')
    : fail('资料页页签点了，面板没切过来')
}

export async function runUpdateChrome(driver) {
  await leaveSettings(driver)
  const snap = await pageSnapshot(driver)
  const update = snapshotHas(snap, ['更新', 'Update'])
  const versionText = /\b\d+\.\d+\.\d+\b/.test(snap.text || '')
  if (update || versionText) {
    return pass(update ? '侧栏看见更新控件（未点安装）' : '侧栏页脚有版本号')
  }
  const foot = await driver.cdp.evaluate(`(() => {
    const version = document.querySelector('.agent-sidebar__version')
    return version ? String(version.textContent || '').trim() : ''
  })()`)
  return foot ? pass(`侧栏版本 ${foot}，当前没有更新控件`) : fail('侧栏页脚没有版本号')
}
