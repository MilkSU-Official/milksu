/**
 * CTF / CVE / Lab workspace cases. Official Desktop RPC + product buttons.
 */

import { delay } from './desktop-gui-driver.mjs'
import {
  clickAria,
  clickLabeled,
  dismissOverlays,
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

async function openDomain(driver, labels) {
  if (typeof driver.ensureAttached === 'function') {
    await driver.ensureAttached().catch(() => false)
  }
  await leaveSettings(driver)
  await dismissOverlays(driver)
  try {
    return await openWorkspace(driver, labels)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (!/CDP WebSocket closed/i.test(text)) throw error
    if (driver.cdp) driver.cdp.closed = true
    if (typeof driver.ensureAttached === 'function') await driver.ensureAttached()
    await dismissOverlays(driver)
    return openWorkspace(driver, labels)
  }
}

async function showLabCatalog(driver) {
  await clickAria(driver, ['返回实验室', 'Back to Lab']).catch(() => false)
  await clickAria(driver, ['返回题目包', 'Back to packages']).catch(() => false)
  await delay(200)
}

async function showCveCatalog(driver) {
  await clickAria(driver, ['返回漏洞列表', 'Back to CVE list']).catch(() => false)
  await delay(200)
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
  return expectLabels(driver, ['CTF 挑战列表', 'CTF challenge list'], 'CTF 页打开了', '侧栏点 CTF 没有进到题库')
}

export async function runWorkspaceCtfSync(driver) {
  const nav = await openDomain(driver, ['CTF'])
  if (!nav.ok) return fail(nav.detail)
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['同步', 'Sync'])) return pass('空题库上看得到手动同步')
  if (!await clickAria(driver, ['导入题目', 'Import challenge'])) return fail('题库不空，也点不开导入题目')
  await delay(300)
  return expectLabels(
    driver,
    ['同步 NSSCTF 题库', 'Sync NSSCTF catalog', '同步', 'Sync'],
    '导入对话框里有手动同步',
    '导入对话框里没有同步',
  )
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
  let opened = await clickTestId(driver, 'open-item')
  if (!opened) {
    if (snapshotHas(await pageSnapshot(driver), ['同步', 'Sync'])) {
      await clickLabeled(driver, ['同步', 'Sync'])
    } else if (await clickAria(driver, ['导入题目', 'Import challenge'])) {
      await delay(250)
      await clickAria(driver, ['同步 NSSCTF 题库', 'Sync NSSCTF catalog']).catch(() => false)
    }
    opened = await waitFor(() => clickTestId(driver, 'open-item'), 60_000, 1_000)
  }
  if (!opened) {
    const started = await driver.invoke('StartCTFChallenge', [{
      title: 'product-loop CTF start',
      statement: 'Read README.txt and find the local flag. This is an authorized product-loop fixture.',
      category: 'misc',
      collaborationMode: 'copilot',
      deferAgent: true,
      sourceKind: 'text',
      humanGoal: 'Confirm the local material is admitted.',
      materials: [{
        name: 'README.txt',
        mediaType: 'text/plain',
        dataBase64: Buffer.from('flag{product-loop-ctf-start}\n', 'utf8').toString('base64'),
      }],
    }]).catch(() => null)
    const id = jobIdOf(started) || jobIdOf(started?.job) || jobIdOf(started?.Job)
    if (!id) return fail('空题库同步后仍然没有题目，开始解题不能算通过')
    await openDomain(driver, ['CTF']).catch(() => null)
    await delay(400)
    return expectLabels(
      driver,
      ['开始解题', 'Start solving', '题目', 'Challenge', '任务', 'Job'],
      `空题库用本地题开始解题，留下 ${id}`,
      '本地题开始之后看不见解题面',
    )
  }
  await delay(400)
  return expectLabels(driver, ['开始解题', 'Start solving'], '题目详情里有开始解题', '打开题目后看不见开始解题')
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
  let jobs = await driver.invoke('ListCTFJobs', [])
  if (!Array.isArray(jobs)) return fail('ListCTFJobs 没有返回列表')
  if (!jobs.length) {
    const created = await driver.invoke('StartCTFChallenge', [{
      title: 'product-loop CTF jobs',
      statement: 'Authorized product-loop fixture.',
      category: 'misc',
      collaborationMode: 'copilot',
      deferAgent: true,
      sourceKind: 'text',
      humanGoal: 'Leave a job for the list.',
      materials: [{
        name: 'README.txt',
        mediaType: 'text/plain',
        dataBase64: Buffer.from('flag{product-loop-ctf-jobs}\n', 'utf8').toString('base64'),
      }],
    }])
    if (!jobIdOf(created) && !jobIdOf(created?.job) && !jobIdOf(created?.Job)) {
      return fail('任务列表为空，补一条本地题也没留下 id')
    }
    jobs = await driver.invoke('ListCTFJobs', [])
  }
  return Array.isArray(jobs) && jobs.length
    ? pass(`CTF 任务 ${jobs.length} 条`)
    : fail('CTF 任务列表还是空的')
}

export async function runWorkspaceCveOpen(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  return expectLabels(driver, ['CVE 列表', 'CVE list', '搜索 CVE', 'Search CVE'], 'CVE 页打开了', '侧栏点 CVE 没有进到列表')
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
  if (!await clickAria(driver, ['导入 CVE', 'Import CVE'])) return fail('点不开导入 CVE')
  await delay(300)
  return expectLabels(driver, ['同步公开源', 'Sync public sources'], '导入对话框里有同步公开源', '导入对话框里没有同步公开源')
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
  await showCveCatalog(driver)
  if (!await clickAria(driver, ['导入 CVE', 'Import CVE'])) return fail('点不开导入 CVE')
  await delay(300)
  return expectLabels(
    driver,
    ['查找公开 CVE', 'Find public CVE', '搜索公开 CVE', 'Search public CVE'],
    '导入对话框里有查找公开 CVE',
    '导入对话框里没有查找公开 CVE',
  )
}

export async function runWorkspaceCveOpenItem(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  const snap = await pageSnapshot(driver)
  if (snapshotHas(snap, ['CVE-2024', '开始复现', 'Start reproduction'])) {
    return pass('已经打开了一条 CVE 对话')
  }
  await showCveCatalog(driver)
  const opened = await clickTestId(driver, 'open-item')
  await delay(400)
  if (opened) return pass('打开了一条 CVE')
  return expectLabels(driver, ['搜索 CVE', 'Search CVE'], '现在没有可打开的 CVE 行，搜索还在', 'CVE 既打不开一行，也不像列表')
}

async function ensureCveListItem(driver, cveId, title) {
  await showCveCatalog(driver)
  let opened = await clickTestId(driver, 'open-item')
  if (opened) return true
  await driver.invoke('EnsureVulnTrackingWorkspace', [{
    cveId,
    title,
    summary: title,
  }]).catch(() => null)
  await delay(700)
  opened = await clickTestId(driver, 'open-item')
  if (opened) return true
  await openDomain(driver, ['CVE']).catch(() => null)
  await showCveCatalog(driver)
  await delay(800)
  opened = await clickTestId(driver, 'open-item')
  if (opened) return true
  if (!await clickAria(driver, ['导入 CVE', 'Import CVE'])) return false
  await delay(250)
  const typed = await driver.cdp.callFunction(`function(value) {
    const input = document.querySelector('[aria-label="搜索公开 CVE"], [aria-label="Search public CVE"]')
    if (!input) return false
    input.focus()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }`, [cveId])
  if (!typed) return false
  await clickLabeled(driver, ['搜索', 'Search']).catch(() => false)
  await delay(800)
  const added = await clickLabeled(driver, ['仅按编号加入', 'Add by ID only', '加入研究', 'Add to research'])
  if (!added) return false
  await delay(400)
  return clickTestId(driver, 'open-item')
}

export async function runWorkspaceCveDossier(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  if (!await ensureCveListItem(driver, 'CVE-2024-3094', 'product-loop CVE dossier')) {
    return snapshotHas(await pageSnapshot(driver), ['搜索 CVE', 'Search CVE'])
      ? fail('补了跟踪任务仍然打不开档案')
      : fail('CVE 档案没看见')
  }
  await delay(400)
  return expectLabels(driver, ['报告', 'Report', 'dossier-split', '摘要', '开始复现', 'Start reproduction'], 'CVE 档案打开了', '打开后不像档案')
}

export async function runWorkspaceCveRepro(driver) {
  const nav = await openDomain(driver, ['CVE'])
  if (!nav.ok) return fail(nav.detail)
  if (!await ensureCveListItem(driver, 'CVE-2024-3094', 'product-loop CVE repro')) {
    return fail('打开不了一条 CVE')
  }
  await delay(400)
  if (!await clickLabeled(driver, ['开始复现', 'Start reproduction'])) {
    return fail('档案上没有开始复现')
  }
  await delay(300)
  return expectLabels(
    driver,
    ['启动并复现', 'Start and reproduce', '只写报告', 'Report only'],
    '开始复现后看得见启动并复现或只写报告',
    '开始复现后对话框没出来',
  )
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
  let jobs = await driver.invoke('ListVulnJobs', [])
  if (!Array.isArray(jobs)) return fail('ListVulnJobs 没有返回列表')
  if (!jobs.length) {
    const created = await driver.invoke('EnsureVulnTrackingWorkspace', [{
      cveId: 'CVE-2024-3094',
      title: 'product-loop CVE jobs',
      summary: 'product-loop 留下一条跟踪任务',
    }])
    if (!jobIdOf(created) && !jobIdOf(created?.job)) return fail('跟踪列表为空，补一条也没留下')
    jobs = await driver.invoke('ListVulnJobs', [])
  }
  return Array.isArray(jobs) && jobs.length
    ? pass(`CVE 跟踪 ${jobs.length} 条`)
    : fail('CVE 跟踪列表还是空的')
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
  await clickLabeled(driver, ['题目包', 'Packages']).catch(() => false)
  await delay(250)
  const opened = await driver.cdp.callFunction(`function() {
    const card = document.querySelector('[data-testid="lab-pack-card"]')
    if (!card) return false
    card.click()
    return true
  }`)
  if (!opened) return fail('点不开题目包卡片，看不到启动')
  await delay(400)
  return expectLabels(driver, ['启动', 'Start'], '点开题目包后看得到启动', '点开题目包后看不到启动')
}

export async function runWorkspaceLabJobs(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await showLabCatalog(driver)
  await clickLabeled(driver, ['自定义任务', 'Custom jobs'])
  await delay(250)
  const snap = await pageSnapshot(driver)
  if (!snapshotHas(snap, ['自定义任务', 'Custom jobs'])) {
    return fail('没有自定义任务分段')
  }
  return snapshotHas(snap, ['还没有自定义任务', 'No custom jobs', '任务', 'Job', '打开', 'Open'])
    ? pass('自定义任务分段在')
    : fail('自定义任务分段在，但既不是空态也不是任务列表')
}

export async function runWorkspaceLabEmpty(driver) {
  const nav = await openDomain(driver, ['Lab'])
  if (!nav.ok) return fail(nav.detail)
  await showLabCatalog(driver)
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
  await showLabCatalog(driver)
  await clickLabeled(driver, ['自定义任务', 'Custom jobs']).catch(() => false)
  await delay(200)
  const opened = await clickAria(driver, ['创建自定义任务', 'Create a custom job'])
    || await clickLabeled(driver, ['创建自定义任务', 'Create a custom job', '创建', 'Create'])
    || await clickTestId(driver, 'workspace-create')
  if (!opened) return fail('打不开创建自定义任务')
  await delay(300)
  const result = await expectLabels(driver, ['自定义任务', 'Custom job', '启动并打开', 'Start and open'], '创建自定义任务表单打开了', '创建按钮点了但表单没出来')
  await dismissOverlays(driver)
  return result
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
