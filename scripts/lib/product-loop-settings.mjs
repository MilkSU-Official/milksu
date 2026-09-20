/**
 * Remaining Settings pages. One case per sidebar category.
 */

import { delay } from './desktop-gui-driver.mjs'
import { describeCustomRelay, firstUseRelayName } from './product-loop-first-use.mjs'
import {
  clickLabeled,
  clickSettingsCategory,
  expectLabels,
  fail,
  openSettings,
  openSettingsCategory,
  pass,
} from './product-loop-session.mjs'

const CATEGORIES = [
  ['通用', 'General'],
  ['模型', 'Models'],
  ['CTF'],
  ['CVE'],
  ['Lab'],
  ['Skills'],
  ['MCP'],
  ['归档聊天', 'Archived chats'],
  ['浏览器控制', 'Browser'],
  ['评测', 'Eval'],
  ['桌宠', 'Companion'],
  ['插件', 'Plugins'],
]

async function openOrFail(driver, labels) {
  const opened = await openSettingsCategory(driver, labels)
  return opened.ok ? null : fail(opened.detail)
}

export async function runSettingsNav(driver) {
  const opened = await openSettings(driver)
  if (!opened.ok) return fail(opened.detail)
  const missing = []
  for (const labels of CATEGORIES) {
    if (!await clickSettingsCategory(driver, labels)) missing.push(labels[0])
    await delay(120)
  }
  return missing.length
    ? fail(`设置侧栏缺了 ${missing.join('、')}`)
    : pass('十二个设置分类都能点开')
}

export async function runSettingsGeneral(driver) {
  const error = await openOrFail(driver, ['通用', 'General'])
  if (error) return error
  const chrome = await expectLabels(
    driver,
    ['界面语言', 'Interface language', '强调色', 'Accent color', '界面字体', 'Interface font', '数据目录', 'Data folder', '调试模式', 'Debug mode'],
    '通用页有语言、强调色、字体、数据和调试',
    '通用页缺了常用控件',
  )
  if (chrome.result === 'FAIL') return chrome
  const before = await driver.invoke('GetSettings', [])
  const current = String(before?.ui_emphasis ?? before?.UiEmphasis ?? 'default')
  const next = current === 'blue' ? 'violet' : 'blue'
  const label = next === 'blue' ? ['蓝色', 'Blue'] : ['紫色', 'Violet']
  if (!await clickLabeled(driver, label)) return fail('点不到强调色')
  await delay(400)
  const saved = await driver.invoke('GetSettings', [])
  const stored = String(saved?.ui_emphasis ?? saved?.UiEmphasis ?? '')
  const restore = current === 'default' ? ['默认', 'Default'] : current === 'violet' ? ['紫色', 'Violet'] : ['蓝色', 'Blue']
  await clickLabeled(driver, restore).catch(() => false)
  await delay(200)
  return stored === next
    ? pass(`通用强调色改完即存，已从 ${current || 'default'} 换成 ${next}`)
    : fail(`强调色没有存下来 want=${next} got=${stored}`)
}

export async function runSettingsModels(driver) {
  const error = await openOrFail(driver, ['模型', 'Models'])
  if (error) return error
  const settings = await driver.invoke('GetSettings', [])
  const relay = describeCustomRelay(settings, firstUseRelayName())
  if (relay.baseURL.includes('tokenflux.ai')) return fail('官方 TokenFlux 不能用 tokenflux.ai')
  const chrome = await expectLabels(
    driver,
    ['默认运行时', 'Default runtime', '默认模型', 'Default model', '忙碌时发送', 'Send while busy', '模型服务', 'Model services'],
    '模型页有默认运行时、默认模型和忙碌时发送',
    '模型页缺了调用控件',
  )
  if (chrome.result === 'FAIL') return chrome
  return relay.enabled && relay.hasKey && relay.models.length
    ? pass(`${chrome.detail}；上手中转站还在`)
    : fail(`模型页控件在，中转站却不完整 enabled=${relay.enabled} hasKey=${relay.hasKey}`)
}

export async function runSettingsCtf(driver) {
  const error = await openOrFail(driver, ['CTF'])
  if (error) return error
  return expectLabels(driver, ['NSSCTF', 'Arena', '题目浏览器扩展', 'Challenge browser extension'], 'CTF 设置看得到 Arena 和扩展', 'CTF 设置缺了 Arena 或扩展')
}

export async function runSettingsCve(driver) {
  const error = await openOrFail(driver, ['CVE'])
  if (error) return error
  return expectLabels(driver, ['公开源', 'Public sources', 'CISA', 'Vulhub', '同步公开源', 'Sync public sources'], 'CVE 设置看得到公开源', 'CVE 设置缺了公开源')
}

export async function runSettingsLab(driver) {
  const error = await openOrFail(driver, ['Lab'])
  if (error) return error
  return expectLabels(driver, ['这台电脑', 'This computer', 'Android SDK', '重新检测', 'Recheck'], 'Lab 设置看得到本机检测', 'Lab 设置缺了本机检测')
}

export async function runSettingsSkills(driver) {
  const error = await openOrFail(driver, ['Skills'])
  if (error) return error
  return expectLabels(driver, ['内置 Skills', 'Built-in Skills', '用户 Skills', 'User Skills'], 'Skills 页有内置和用户两栏', 'Skills 页缺了栏')
}

export async function runSettingsMcp(driver) {
  const error = await openOrFail(driver, ['MCP'])
  if (error) return error
  return expectLabels(driver, ['内置 MCP', 'Built-in MCP', '用户 MCP', 'User MCP'], 'MCP 页有内置和用户两栏', 'MCP 页缺了栏')
}

export async function runSettingsChats(driver) {
  const error = await openOrFail(driver, ['归档聊天', 'Archived chats'])
  if (error) return error
  return expectLabels(driver, ['归档聊天', 'Archived chats'], '归档聊天页在', '归档聊天页没打开')
}

export async function runSettingsBrowser(driver) {
  const error = await openOrFail(driver, ['浏览器控制', 'Browser'])
  if (error) return error
  return expectLabels(
    driver,
    ['Browser Use', 'Computer Use', '辅助功能', 'Accessibility', '屏幕录制', 'Screen Recording', 'CTF 站点', 'CTF sites'],
    '浏览器控制页有 Browser Use、Computer Use 和 CTF 站点',
    '浏览器控制页缺了控件',
  )
}

export async function runSettingsEval(driver) {
  const error = await openOrFail(driver, ['评测', 'Eval'])
  if (error) return error
  return expectLabels(driver, ['套件', 'Suites', '全部测一遍', 'Run all', '开始', 'Start'], '评测页有套件和开始', '评测页没打开')
}

export async function runSettingsCompanion(driver) {
  const error = await openOrFail(driver, ['桌宠', 'Companion'])
  if (error) return error
  return expectLabels(driver, ['桌宠模型', 'Companion model', '跨会话调度', 'Dispatch', '悬浮窗', 'Floating window'], '桌宠设置页在', '桌宠设置页缺了控件')
}

export async function runSettingsPlugins(driver) {
  const error = await openOrFail(driver, ['插件', 'Plugins'])
  if (error) return error
  return expectLabels(driver, ['插件框架', 'Plugin framework', '安装插件', 'Install plugin'], '插件页在', '插件页没打开')
}
