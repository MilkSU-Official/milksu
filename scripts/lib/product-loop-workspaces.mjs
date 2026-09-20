/**
 * CTF / CVE / Lab workspace cases. Official Desktop RPC + product buttons.
 */

import { delay } from './desktop-gui-driver.mjs'
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

async function openDomain(driver, labels) {
  await leaveSettings(driver)
  return openWorkspace(driver, labels)
}

async function clickTestId(driver, id) {
  return driver.cdp.callFunction(`function(id) {
    const node = document.querySelector('[data-testid="' + id + '"]')
    if (!node) return false
    node.click()
    return true
  }`, [id])
}

export async function runWorkspaceCtfOpen(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['CTF 挑战列表', 'CTF challenge list', '同步', 'Sync'], 'CTF 页打开了', '侧栏点 CTF 没有进到题库')
}

export async function runWorkspaceCtfSync(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  const snap = await pageSnapshot(driver)
  if (!snapshotHas(snap, ['同步', 'Sync'])) return fail('CTF 页没有同步')
  return pass('CTF 看得到手动同步')
}

export async function runWorkspaceCtfSearch(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['搜索题库', 'Search catalog', '搜索题号或题名', 'Search by id or title'], 'CTF 搜索框在', 'CTF 没有搜索框')
}

export async function runWorkspaceCtfFilter(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['全部分类', 'All categories'], 'CTF 分类筛选在', 'CTF 没有分类筛选')
}

export async function runWorkspaceCtfList(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  let catalog = { total: 0 }
  try {
    catalog = await driver.invoke('ListNSSCTFCatalog', [{ page: 1, pageSize: 8 }])
  } catch {
    catalog = { total: -1 }
  }
  const total = Number(catalog?.total ?? catalog?.Total ?? 0)
  const snap = await pageSnapshot(driver)
  if (total > 0 || snapshotHas(snap, ['catalog-row']) || /#/.test(snap.text || '')) {
    return pass(total > 0 ? `CTF 题库 ${total} 题` : 'CTF 列表已经画出来')
  }
  if (snapshotHas(snap, ['没有匹配题目', 'No matching challenges', '同步', 'Sync'])) {
    return pass('CTF 空列表，看见同步')
  }
  return fail('CTF 既没有题目也没有空列表')
}

export async function runWorkspaceCtfOpenItem(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  const opened = await clickTestId(driver, 'open-item')
  await delay(400)
  if (opened) {
    return expectLabels(driver, ['开始解题', 'Start solving', '题目', 'Challenge'], '打开了一道 CTF', '点了打开，详情没出来')
  }
  return expectLabels(driver, ['没有匹配题目', 'No matching challenges', '同步', 'Sync'], '现在没有题目可打开，空态还在', '没有打开按钮，也不是空列表')
}

export async function runWorkspaceCtfPlatforms(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  const platforms = await driver.invoke('GetCTFTrainingPlatforms', []).catch(() => [])
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['选择训练平台', 'Choose a training platform'])) {
    return pass(Array.isArray(platforms) && platforms.length ? `训练平台 ${platforms.length} 个` : '训练平台选择在')
  }
  return fail('CTF 没有训练平台选择')
}

export async function runWorkspaceCtfStart(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  await clickTestId(driver, 'open-item')
  await delay(400)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['开始解题', 'Start solving'])
    ? pass('题目详情里有开始解题')
    : fail('看不见开始解题。空题库不能算开始解题通过')
}

function jobIdOf(row) {
  return String(row?.id ?? row?.ID ?? row?.job?.id ?? row?.Job?.ID ?? '').trim()
}

export async function runWorkspaceCtfStartJob(driver) {
  const projection = await driver.invoke('StartCTFChallenge', [{
    title: 'product-loop CTF',
    statement: 'Read README.txt and find the local flag. This is an authorized product-loop fixture.',
    category: 'misc',
    collaborationMode: 'copilot',
    deferAgent: true,
    sourceKind: 'text',
    humanGoal: 'Confirm the local material is admitted.',
    materials: [{
      name: 'README.txt',
      mediaType: 'text/plain',
      dataBase64: Buffer.from('flag{product-loop-ctf}\n', 'utf8').toString('base64'),
    }],
  }])
  const id = jobIdOf(projection) || jobIdOf(projection?.job) || jobIdOf(projection?.Job)
  if (!id) return fail('StartCTFChallenge 没有留下任务 id')
  const jobs = await driver.invoke('ListCTFJobs', [])
  const rows = Array.isArray(jobs) ? jobs : []
  return rows.some(row => jobIdOf(row) === id)
    ? pass(`CTF 任务已留下 ${id}`)
    : fail(`开始解题后任务列表里没有 ${id}`)
}

export async function runWorkspaceCtfDaily(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['每日挑战', 'Daily challenge'])) return pass('看见每日挑战')
  return snapshotHas(snap, ['CTF 挑战列表', 'CTF challenge list'])
    ? pass('题库在，这次没有每日挑战条')
    : fail('CTF 页不像题库')
}

export async function runWorkspaceCtfJobs(driver) {
  const jobs = await driver.invoke('ListCTFJobs', [])
  if (!Array.isArray(jobs)) return fail('ListCTFJobs 没有返回列表')
  return jobs.length
    ? pass(`CTF 任务 ${jobs.length} 条`)
    : fail('CTF 任务列表是空的')
}

export async function runWorkspaceCveOpen(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['CVE 列表', 'CVE list', '搜索 CVE', 'Search CVE', '同步公开源', 'Sync public sources'], 'CVE 页打开了', '侧栏点 CVE 没有进到列表')
}

export async function runWorkspaceCveSearch(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['搜索 CVE', 'Search CVE'], 'CVE 搜索框在', 'CVE 没有搜索框')
}

export async function runWorkspaceCveSeverity(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['严重性', 'Severity'], 'CVE 严重性筛选在', 'CVE 没有严重性筛选')
}

export async function runWorkspaceCveSync(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['同步公开源', 'Sync public sources'], 'CVE 同步公开源在', 'CVE 没有同步公开源')
}

export async function runWorkspaceCveList(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  const jobs = await driver.invoke('ListVulnJobs', []).catch(() => [])
  const count = Array.isArray(jobs) ? jobs.length : 0
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['CVE 列表', 'CVE list', '搜索 CVE', 'Search CVE'])
    ? pass(`CVE 列表在，跟踪 ${count} 条`)
    : fail('CVE 列表没看见')
}

export async function runWorkspaceCvePublicSearch(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['搜索公开 CVE', 'Search public CVE', '查找公开', 'Find public'], '查找公开 CVE 在', '没有查找公开 CVE')
}

export async function runWorkspaceCveOpenItem(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  const opened = await clickTestId(driver, 'open-item')
  await delay(400)
  if (opened) return pass('打开了一条 CVE')
  return expectLabels(driver, ['搜索 CVE', 'Search CVE'], '现在没有可打开的 CVE 行，搜索还在', 'CVE 既打不开一行，也不像列表')
}

export async function runWorkspaceCveDossier(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  await clickTestId(driver, 'open-item')
  await delay(400)
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['报告', 'Report', 'dossier-split', '摘要'])) return pass('CVE 档案打开了')
  return snapshotHas(snap, ['搜索 CVE', 'Search CVE'])
    ? pass('没有档案可打开，还停在列表')
    : fail('CVE 档案没看见')
}

export async function runWorkspaceCveRepro(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  await clickTestId(driver, 'open-item')
  await delay(400)
  await clickLabeled(driver, ['启动并复现', 'Start and reproduce', '只写报告', 'Write the report only']).catch(() => false)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['启动并复现', 'Start and reproduce', '只写报告', 'report only'])
    ? pass('CVE 复现入口在')
    : fail('打开条目后看不见启动并复现或只写报告')
}

export async function runWorkspaceCveStartJob(driver) {
  const projection = await driver.invoke('EnsureVulnTrackingWorkspace', [{
    cveId: 'CVE-2024-3094',
    title: 'product-loop CVE tracking',
    summary: 'product-loop 留下一条跟踪任务',
  }])
  const id = jobIdOf(projection) || jobIdOf(projection?.job) || jobIdOf(projection?.Job)
  if (!id) return fail('EnsureVulnTrackingWorkspace 没有留下任务 id')
  const jobs = await driver.invoke('ListVulnJobs', [])
  const rows = Array.isArray(jobs) ? jobs : []
  return rows.some(row => jobIdOf(row) === id || String(row?.title ?? row?.Title ?? '').includes('CVE-2024-3094'))
    ? pass(`CVE 跟踪任务已留下 ${id}`)
    : fail(`开始跟踪后列表里没有 ${id}`)
}

export async function runWorkspaceCveJobs(driver) {
  const jobs = await driver.invoke('ListVulnJobs', [])
  if (!Array.isArray(jobs)) return fail('ListVulnJobs 没有返回列表')
  return jobs.length
    ? pass(`CVE 跟踪 ${jobs.length} 条`)
    : fail('CVE 跟踪列表是空的')
}

export async function runWorkspaceLabOpen(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['题目包', 'Packages', '自定义任务', 'Custom jobs', '实验室', 'Lab'], 'Lab 页打开了', '侧栏点 Lab 没有进到题目包')
}

export async function runWorkspaceLabPackages(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await clickLabeled(driver, ['题目包', 'Packages'])
  await delay(250)
  return expectLabels(driver, ['题目包', 'Packages'], '题目包分段在', '没有题目包分段')
}

export async function runWorkspaceLabCards(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  const hasCard = await driver.cdp.evaluate(`Boolean(document.querySelector('[data-testid="lab-pack-card"], [data-testid="lab-machine-card"]'))`)
  if (hasCard) return pass('看见题目包卡片')
  return expectLabels(driver, ['题目包', 'Packages'], '题目包分段在，这次没有卡片', '题目包卡片和分段都没有')
}

export async function runWorkspaceLabStart(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  const snap = await pageSnapshot(driver)
  return snapshotHas(snap, ['启动', 'Start'])
    ? pass('题目包上看得到启动')
    : fail('题目包上看不到启动')
}

export async function runWorkspaceLabJobs(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await clickLabeled(driver, ['自定义任务', 'Custom jobs'])
  await delay(250)
  return expectLabels(driver, ['自定义任务', 'Custom jobs', '还没有自定义任务', 'No custom jobs'], '自定义任务分段在', '没有自定义任务分段')
}

export async function runWorkspaceLabEmpty(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await clickLabeled(driver, ['自定义任务', 'Custom jobs'])
  await delay(250)
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['还没有自定义任务', 'No custom jobs', '看题目包', 'Browse packages'])) {
    return pass('空任务时能回到题目包')
  }
  return snapshotHas(snap, ['自定义任务', 'Custom jobs'])
    ? pass('已经有自定义任务')
    : fail('自定义任务空态不成立')
}

export async function runWorkspaceLabStartJob(driver) {
  const id = `loop-lab-${Date.now().toString(36)}`
  await driver.invoke('SaveLabJob', [{
    id,
    title: 'product-loop lab job',
    scope: 'local',
    request: 'product-loop 留下一条自定义任务',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }])
  const jobs = await driver.invoke('ListLabJobs', [])
  const rows = Array.isArray(jobs) ? jobs : []
  return rows.some(row => jobIdOf(row) === id)
    ? pass(`Lab 自定义任务已留下 ${id}`)
    : fail(`保存后任务列表里没有 ${id}`)
}

export async function runWorkspaceLabCreate(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await clickLabeled(driver, ['创建自定义任务', 'Create a custom job'])
  await delay(300)
  return expectLabels(driver, ['自定义任务', 'Custom job', '启动并打开', 'Start and open'], '创建自定义任务表单打开了', '打不开创建自定义任务')
}

export async function runWorkspaceLabSettings(driver) {
  const opened = await openSettingsCategory(driver, ['Lab'])
  if (!opened.ok) return fail(opened.detail)
  return expectLabels(driver, ['这台电脑', 'This computer', 'Android SDK', '重新检测', 'Recheck'], 'Lab 设置看得到本机环境', 'Lab 设置缺了本机环境')
}

export async function runWorkspaceLabStatus(driver) {
  const status = await driver.invoke('GetLabEnvironmentStatus', [{}]).catch(() => null)
  if (!status) return fail('读不到 Lab 本机环境')
  return pass(status.sdkRoot || status.studioFound
    ? '这台电脑已经能看到 Android 环境'
    : 'Lab 环境状态读到了，本机还没装齐')
}

export async function runWorkspaceLabDocker(driver) {
  const status = await driver.invoke('GetLabEnvironmentStatus', [{}])
  if (!status || typeof status !== 'object') return fail('读不到 Lab Docker / 环境状态')
  const encoded = JSON.stringify(status)
  return /docker|android|sdk|studio/i.test(encoded)
    ? pass(status.dockerAvailable || status.DockerAvailable || status.sdkRoot
      ? 'Lab 环境里已经能看到 Docker 或 Android'
      : 'Lab 环境状态读到了 Docker / Android 字段')
    : fail('Lab 环境状态里没有 Docker / Android 字段')
}
