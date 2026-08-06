// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VulnPage from './VulnPage.vue'
import VulnerabilityIntelSettingsPanel from './VulnerabilityIntelSettingsPanel.vue'
import { useVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'

const mountedApps: App[] = []
const storage = new Map<string, string>()

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  storage.clear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
})

async function mountVulnPage() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(VulnPage)
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

async function mountVulnPageWithWorkspace(path = '') {
  const host = document.createElement('div')
  document.body.append(host)
  let chooseCount = 0
  const app = createApp(VulnPage, {
    codingWorkspacePath: path,
    onChooseCodingWorkspace: () => {
      chooseCount += 1
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, chooseCount: () => chooseCount }
}

async function mountVulnPageWithCodingTaskSink() {
  const host = document.createElement('div')
  document.body.append(host)
  const tasks: Array<{ title: string; prompt: string; visibleText: string }> = []
  const handoffRecorders: Array<(workspacePath: string) => void> = []
  const app = createApp(VulnPage, {
    onStartCodingTask: (
      task: { title: string; prompt: string; visibleText: string },
      recordHandoff: (workspacePath: string) => void,
    ) => {
      tasks.push(task)
      handoffRecorders.push(recordHandoff)
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, tasks, handoffRecorders }
}

async function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function unmountAll() {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  await nextTick()
}

async function flushAsyncUpdates() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

function installSessionHistoryRuntime() {
  const status = {
    available: true,
    mode: 'milksu-obelisk-core',
    indexPath: '/tmp/milksu/session-index/obelisk.sqlite',
    checkedAt: '2026-08-05T02:45:00Z',
    readOnly: true,
    sessionCount: 1,
    messageCount: 1,
    toolCallCount: 1,
    memoryCount: 0,
    sources: [{ source: 'milksu-cve', count: 1 }],
  }
  ;(window as unknown as {
    go?: {
      main?: {
        App?: {
          GetSessionIndexStatus: () => Promise<typeof status>
          SearchSessionHistory: (request: unknown) => Promise<unknown>
          RefreshSessionIndex: () => Promise<unknown>
        }
      }
    }
  }).go = {
    main: {
      App: {
        GetSessionIndexStatus: vi.fn(async () => status),
        SearchSessionHistory: vi.fn(async request => ({
          query: (request as { query?: string }).query ?? '',
          searchedAt: '2026-08-05T02:46:00Z',
          status,
          results: [{
            messageUuid: 'milksu:cve-history:assistant-1',
            sessionId: 'milksu:cve-history',
            sessionName: 'CVE-2024-3400 研究回顾',
            source: 'milksu-cve',
            timestamp: '2026-08-05T02:40:00Z',
            snippet: 'NVD 同步后确认 CVSS 10.0；OPENAI_API_KEY=sk-history-secret12345',
            skill: 'fetch_nvd_cve',
          }],
        })),
        RefreshSessionIndex: vi.fn(async () => ({
          indexedAt: '2026-08-05T02:46:00Z',
          indexPath: status.indexPath,
          source: 'milksu',
          sessionCount: 1,
          messageCount: 1,
          toolCallCount: 1,
        })),
      },
    },
  }
}

function useIntelSettingsPanelHarness() {
  const host = document.createElement('div')
  document.body.append(host)
  const dashboard = useVulnerabilityDashboard()
  const app = createApp(VulnerabilityIntelSettingsPanel, { dashboard })
  app.mount(host)
  mountedApps.push(app)
  return { host, dashboard }
}

async function openCveResearch(host: HTMLElement, cveId = 'CVE-2024-3400') {
  const row = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
    item.textContent?.includes(cveId),
  )
  if (!row) throw new Error(`missing ${cveId} CVE row`)
  row.click()
  await nextTick()
}

describe('VulnPage', () => {
  it('renders a CVE learning and tracking scaffold without red-team promises', async () => {
    const host = await mountVulnPage()
    const text = host.textContent ?? ''

    expect(text).toContain('CVE')
    expect(text).toContain('追踪 CVE、资产命中与研究进度')
    expect(host.querySelector('[aria-label="配置 CVE 情报源"]')).toBeNull()
    expect(host.querySelector('[data-module-topbar]')).not.toBeNull()
    expect(host.querySelector('[data-module-topbar]')?.getAttribute('data-workspace-module')).toBe('cve')
    expect(host.querySelector('[data-workspace-topbar-title]')?.className).toContain('workspace-topbar__title')
    expect(text).toContain('追踪条目')
    expect(text).toContain('7')
    expect(text).toContain('0 关注中')
    expect(text).not.toContain('情报源接入状态')
    expect(text).not.toContain('Feed 缓存状态')
    expect(text).not.toContain('尚未导入真实 Feed 快照')
    expect(text).toContain('CVE-2024-6387')
    expect(text).toContain('OpenSSH regreSSHion')
    expect(text).toContain('CVE-2024-4577')
    expect(text).toContain('PHP-CGI Windows Argument Injection')
    expect(text).toContain('CVE-2023-27997')
    expect(text).toContain('Fortinet FortiOS SSL-VPN')
    expect(text).toContain('闭环')
    expect(text).toContain('待建立')
    expect(text).toContain('有练习')
    expect(text).toContain('练习环境')
    expect(text).toContain('1 匹配')
    expect(text).toContain('0 已确认计划')
    expect(text).toContain('当前下一步')
    expect(text).toContain('建立研究任务')
    expect(text).toContain('CVE-2024-3400 还没有固定目标、Scope 和安全边界。')
    expect(text).not.toContain('学习路径')
    expect(text).not.toContain('CVE 最小闭环')
    expect(text).not.toContain('隔离练习环境')
    expect(text).not.toContain('研究任务工作区')

    await openCveResearch(host)
    const researchText = host.textContent ?? ''
    expect(researchText).toContain('单个 CVE 研究台')
    expect(host.querySelector('[aria-label="返回 CVE 列表"]')).not.toBeNull()
    expect(researchText).toContain('CISA KEV')
    expect(researchText).toContain('学习路径')
    expect(researchText).toContain('CVE 最小闭环')
    expect(researchText).toContain('练习结果不等于真实资产已验证')
    expect(researchText).toContain('隔离练习环境')
    expect(researchText).toContain('Coding 接力范围')
    expect(researchText).toContain('Agent 可接手任务')
    expect(researchText).toContain('研究任务工作区')
    expect(researchText).toContain('安全边界')
    expect(researchText).toContain('不批量扫描或攻击外部目标')
    expect(researchText).toContain('不自动运行 PoC、exploit 或漏洞触发输入')
    expect(text).not.toContain('红队 Agent')

    const back = host.querySelector<HTMLButtonElement>('[aria-label="返回 CVE 列表"]')
    if (!back) throw new Error('missing CVE list return button')
    back.click()
    await nextTick()
    expect(host.textContent).toContain('追踪 CVE、资产命中与研究进度')
  })

  it('keeps CVE feed controls out of the default homepage', async () => {
    const host = await mountVulnPage()

    expect(host.textContent).not.toContain('同步 NVD')
    expect(host.textContent).not.toContain('同步 EPSS')
    expect(host.textContent).not.toContain('导入 Feed')
    expect(host.textContent).toContain('当前下一步')
    expect(host.querySelector('[aria-label="配置 CVE 情报源"]')).toBeNull()
  })

  it('keeps CVE feed controls in the global settings panel', async () => {
    const { host } = useIntelSettingsPanelHarness()

    expect(host.textContent).toContain('情报源设置')
    expect(host.textContent).not.toContain('当前下一步')
    expect(host.textContent).not.toContain('OpenSSH regreSSHion')
    expect(host.textContent).not.toContain('CVE 最小闭环')
    expect(host.textContent).not.toContain('同步当前 CVE')
    expect(host.textContent).not.toContain('当前 CVE 来源证据')
    expect(host.textContent).toContain('同步公开源')
    expect(host.textContent).toContain('同步 KEV')
    expect(host.textContent).toContain('同步 Vulhub')
    expect(host.textContent).toContain('导入 Feed')
    expect(host.textContent).toContain('Feed 缓存状态')
    expect(host.textContent).toContain('Vulhub 练习目录匹配')
  })

  it('syncs the selected CVE from NVD through the desktop adapter into visible evidence', async () => {
    const fetchNVDCVE = vi.fn(async () => ({
      sourceName: 'NVD',
      sourceUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-3400',
      retrievedAt: '2026-08-04T07:00:00Z',
      lastModified: '2026-08-04T07:00:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/nvd/20260804T070000Z-abcd.json',
      snapshotSha256: 'abcd'.repeat(16),
      snapshotSizeBytes: 1024,
      body: JSON.stringify({
        resultsPerPage: 1,
        startIndex: 0,
        totalResults: 1,
        format: 'NVD_CVE',
        version: '2.0',
        timestamp: '2026-08-04T07:00:00.000',
        vulnerabilities: [{
          cve: {
            id: 'CVE-2024-3400',
            sourceIdentifier: 'security@example.com',
            published: '2024-04-12T00:15:07.403',
            lastModified: '2026-08-04T07:00:00.000',
            descriptions: [{ lang: 'en', value: 'Command injection vulnerability in PAN-OS GlobalProtect.' }],
            metrics: { cvssMetricV31: [{ cvssData: { baseScore: 10.0 } }] },
            references: {
              referenceData: [{
                url: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400',
                source: 'NVD',
              }],
            },
          },
        }],
      }),
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: { main: { App: { FetchNVDCVE: fetchNVDCVE } } },
    })
    const host = await mountVulnPage()
    await openCveResearch(host)
    const sync = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '同步此 CVE 的 NVD 2.0',
    )
    if (!sync) throw new Error('missing NVD sync button')

    expect(host.textContent).toContain('CVE-2024-3400')
    sync.click()
    await flushAsyncUpdates()

    expect(fetchNVDCVE).toHaveBeenCalledTimes(1)
    expect(fetchNVDCVE).toHaveBeenCalledWith('CVE-2024-3400')
    expect(host.textContent).toContain('已同步 NVD：新增 0、更新 1')
    expect(host.textContent).toContain('NVD JSON 2.0')
    expect(host.textContent).toContain('情报证据')
    expect(host.textContent).toContain('NVD · NVD JSON 2.0')
    expect(host.textContent).toContain('已缓存原始快照')
    expect(host.textContent).toContain('feed-snapshots/nvd')
    expect(host.textContent).toContain('sha256')
    expect(host.textContent).toContain('Command injection vulnerability in PAN-OS GlobalProtect.')
    expect(host.textContent).toContain('10.0 CVSS')
  })

  it('syncs FIRST EPSS through the desktop adapter into visible priority evidence', async () => {
    const fetchFIRSTEPSS = vi.fn(async () => ({
      sourceName: 'FIRST EPSS',
      sourceUrl: 'https://api.first.org/data/v1/epss?cve=CVE-2024-3400',
      retrievedAt: '2026-08-04T08:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/first-epss/20260804T080000Z-efgh.json',
      snapshotSha256: 'efgh'.repeat(16),
      snapshotSizeBytes: 240,
      body: JSON.stringify({
        status: 'OK',
        data: [{
          cve: 'CVE-2024-3400',
          epss: '0.932410000',
          percentile: '0.997200000',
          date: '2026-08-04',
        }],
      }),
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: { main: { App: { FetchFIRSTEPSS: fetchFIRSTEPSS } } },
    })
    const host = await mountVulnPage()
    await openCveResearch(host)
    const sync = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '同步此 CVE 的 FIRST EPSS',
    )
    if (!sync) throw new Error('missing EPSS sync button')

    sync.click()
    await flushAsyncUpdates()

    expect(fetchFIRSTEPSS).toHaveBeenCalledTimes(1)
    expect(fetchFIRSTEPSS).toHaveBeenCalledWith('CVE-2024-3400')
    expect(host.textContent).toContain('已同步 FIRST EPSS：新增 0、更新 1')
    expect(host.textContent).toContain('FIRST EPSS API')
    expect(host.textContent).toContain('93.2%')
    expect(host.textContent).toContain('优先级信号')
    expect(host.textContent).toContain('情报证据')
    expect(host.textContent).toContain('FIRST EPSS · FIRST EPSS API')
    expect(host.textContent).toContain('feed-snapshots/first-epss')
    expect(host.textContent).not.toContain('Judge verified')
  })

  it('keeps successful current-CVE intel when one public source times out', async () => {
    const fetchNVDCVE = vi.fn(async () => {
      throw new Error('NVD upstream timeout after 20s')
    })
    const fetchFIRSTEPSS = vi.fn(async () => ({
      sourceName: 'FIRST EPSS',
      sourceUrl: 'https://api.first.org/data/v1/epss?cve=CVE-2024-3400',
      retrievedAt: '2026-08-04T08:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/first-epss/20260804T080000Z-efgh.json',
      snapshotSha256: 'efgh'.repeat(16),
      snapshotSizeBytes: 240,
      body: JSON.stringify({
        status: 'OK',
        data: [{
          cve: 'CVE-2024-3400',
          epss: '0.932410000',
          percentile: '0.997200000',
          date: '2026-08-04',
        }],
      }),
    }))
    const fetchOSVCVE = vi.fn(async () => ({
      sourceName: 'OSV',
      sourceUrl: 'https://api.osv.dev/v1/vulns/CVE-2024-3400',
      retrievedAt: '2026-08-04T08:00:30Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/osv/20260804T080030Z-osv.json',
      snapshotSha256: '1111'.repeat(16),
      snapshotSizeBytes: 520,
      body: JSON.stringify({
        schema_version: '1.7.3',
        id: 'CVE-2024-3400',
        aliases: ['GHSA-example'],
        summary: 'PAN-OS GlobalProtect command injection advisory.',
        modified: '2026-08-04T08:00:30Z',
        database_specific: { severity: 'CRITICAL' },
        affected: [{
          package: { ecosystem: 'PAN-OS', name: 'globalprotect' },
        }],
      }),
    }))
    const fetchGitHubAdvisories = vi.fn(async () => ({
      sourceName: 'GitHub Advisory Database',
      sourceUrl: 'https://api.github.com/advisories?cve_id=CVE-2024-3400&per_page=10',
      retrievedAt: '2026-08-04T08:00:45Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/github-advisory-database/20260804T080045Z-ghsa.json',
      snapshotSha256: '2222'.repeat(16),
      snapshotSizeBytes: 580,
      body: JSON.stringify([{
        ghsa_id: 'GHSA-example',
        cve_id: 'CVE-2024-3400',
        summary: 'PAN-OS GlobalProtect command injection advisory.',
        severity: 'critical',
        updated_at: '2026-08-04T08:00:45Z',
        html_url: 'https://github.com/advisories/GHSA-example',
        cvss: { score: 10 },
        vulnerabilities: [{
          package: { ecosystem: 'PAN-OS', name: 'globalprotect' },
          vulnerable_version_range: '< fixed',
        }],
      }]),
    }))
    const fetchCISAKEVFeed = vi.fn(async () => ({
      sourceName: 'CISA KEV',
      sourceUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      retrievedAt: '2026-08-04T08:01:00Z',
      lastModified: '2026-08-04T08:01:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/cisa-kev/20260804T080100Z-kev.json',
      snapshotSha256: 'abcd'.repeat(16),
      snapshotSizeBytes: 512,
      body: JSON.stringify({
        title: 'CISA Known Exploited Vulnerabilities Catalog',
        vulnerabilities: [{
          cveID: 'CVE-2024-3400',
          vendorProject: 'Palo Alto Networks',
          product: 'PAN-OS',
          vulnerabilityName: 'PAN-OS GlobalProtect Command Injection',
          dateAdded: '2024-04-12',
          shortDescription: 'Command injection vulnerability in PAN-OS GlobalProtect.',
          dueDate: '2024-04-19',
          knownRansomwareCampaignUse: 'Known',
        }],
      }),
    }))
    const fetchVulhubPracticeCatalog = vi.fn(async () => ({
      sourceName: 'Vulhub Practice Catalog',
      sourceUrl: 'https://github.com/vulhub/vulhub',
      retrievedAt: '2026-08-04T08:02:00Z',
      lastModified: '2026-08-04T08:02:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/vulhub-practice-catalog/20260804T080200Z-vulhub.json',
      snapshotSha256: 'dcba'.repeat(16),
      snapshotSizeBytes: 640,
      body: JSON.stringify({
        sourceName: 'Vulhub Practice Catalog',
        items: [{
          cveId: 'CVE-2024-3400',
          title: 'Vulhub · pan-os · CVE-2024-3400 Docker Compose',
          directory: 'pan-os/CVE-2024-3400',
          sourceLabel: 'vulhub/pan-os/CVE-2024-3400',
          sourceHref: 'https://github.com/vulhub/vulhub/tree/abc123/pan-os/CVE-2024-3400',
          revision: 'vulhub/vulhub master abc123 · GitHub tree tree-sha',
          ports: ['待确认端口（需读取 docker-compose.yml）'],
          network: '默认仅允许本机 loopback。',
          safety: ['只读 catalog 同步只绑定目录，不启动容器。'],
        }],
      }),
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchNVDCVE: fetchNVDCVE,
            FetchFIRSTEPSS: fetchFIRSTEPSS,
            FetchOSVCVE: fetchOSVCVE,
            FetchGitHubAdvisories: fetchGitHubAdvisories,
            FetchCISAKEVFeed: fetchCISAKEVFeed,
            FetchVulhubPracticeCatalog: fetchVulhubPracticeCatalog,
          },
        },
      },
    })
    const host = await mountVulnPage()
    await openCveResearch(host)
    const sync = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '同步此 CVE 的 NVD、FIRST EPSS、OSV、GitHub Advisory 和 CISA KEV',
    )
    if (!sync) throw new Error('missing current CVE intel sync button')

    sync.click()
    await flushAsyncUpdates()

    expect(fetchNVDCVE).toHaveBeenCalledTimes(1)
    expect(fetchFIRSTEPSS).toHaveBeenCalledTimes(1)
    expect(fetchOSVCVE).toHaveBeenCalledTimes(1)
    expect(fetchGitHubAdvisories).toHaveBeenCalledTimes(1)
    expect(fetchCISAKEVFeed).toHaveBeenCalledTimes(1)
    expect(fetchVulhubPracticeCatalog).not.toHaveBeenCalled()
    expect(host.textContent).toContain('此 CVE 情报同步完成：4/5 个来源成功')
    expect(host.textContent).toContain('NVD 同步失败：NVD upstream timeout after 20s')
    expect(host.textContent).toContain('情报证据')
    expect(host.textContent).toContain('NVD')
    expect(host.textContent).toContain('FIRST EPSS')
    expect(host.textContent).toContain('OSV')
    expect(host.textContent).toContain('GitHub Advisory')
    expect(host.textContent).toContain('CISA KEV')
    expect(host.textContent).toContain('失败')
    expect(host.textContent).toContain('FIRST EPSS · FIRST EPSS API')
    expect(host.textContent).toContain('93.2%')
    expect(host.textContent).not.toContain('Judge verified')
  })

  it('syncs the CISA KEV feed through the desktop adapter into visible evidence', async () => {
    const fetchCISAKEVFeed = vi.fn(async () => ({
      sourceName: 'CISA KEV',
      sourceUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      retrievedAt: '2026-08-04T01:02:03Z',
      lastModified: '2026-08-04T01:02:03Z',
      httpStatus: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'CISA Known Exploited Vulnerabilities Catalog',
        dateReleased: '2026-08-04T00:00:00Z',
        vulnerabilities: [{
          cveID: 'CVE-2026-42424',
          vendorProject: 'Example Project',
          product: 'example-gateway',
          vulnerabilityName: 'Example Gateway unsafe parser',
          dateAdded: '2026-08-03',
          shortDescription: 'Example KEV-shaped item used to verify feed sync.',
          dueDate: '2026-08-24',
        }],
      }),
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: { main: { App: { FetchCISAKEVFeed: fetchCISAKEVFeed } } },
    })
    const { host, dashboard } = useIntelSettingsPanelHarness()
    const sync = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '同步 CISA KEV Feed',
    )
    if (!sync) throw new Error('missing KEV sync button')

    expect(host.textContent).toContain('Feed 缓存状态')
    expect(host.textContent).toContain('0 个快照')
    sync.click()
    await Promise.resolve()
    await Promise.resolve()
    await nextTick()
    await nextTick()

    expect(fetchCISAKEVFeed).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('CISA KEV · CISA KEV Catalog')
    expect(host.textContent).toContain('CISA KEV Catalog，1 条，新增 1、更新 0')
    expect(host.textContent).toContain('Feed 缓存状态')
    expect(host.textContent).not.toContain('当前 CVE 来源证据')
    expect(dashboard.trackedCount.value).toBe(8)
    expect(dashboard.sourceSnapshots.value[0]?.importedIds).toContain('CVE-2026-42424')
  })

  it('syncs the Vulhub practice catalog through the desktop adapter into a visible practice match', async () => {
    const fetchVulhubPracticeCatalog = vi.fn(async () => ({
      sourceName: 'Vulhub Practice Catalog',
      sourceUrl: 'https://github.com/vulhub/vulhub',
      retrievedAt: '2026-08-04T06:00:00Z',
      lastModified: '2026-08-04T06:00:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sourceName: 'Vulhub Practice Catalog',
        sourceUrl: 'https://github.com/vulhub/vulhub',
        retrievedAt: '2026-08-04T06:00:00Z',
        revision: 'vulhub/vulhub master abc123 · GitHub tree tree-sha',
        items: [{
          cveId: 'CVE-2024-3400',
          title: 'Vulhub · pan-os · CVE-2024-3400 Docker Compose',
          directory: 'pan-os/CVE-2024-3400',
          sourceLabel: 'vulhub/pan-os/CVE-2024-3400',
          sourceHref: 'https://github.com/vulhub/vulhub/tree/abc123/pan-os/CVE-2024-3400',
          revision: 'vulhub/vulhub master abc123 · GitHub tree tree-sha',
          ports: ['待确认端口（需读取 docker-compose.yml）'],
          network: '默认仅允许本机 loopback。',
          safety: ['只读 catalog 同步只绑定目录，不启动容器。'],
        }],
      }),
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: { main: { App: { FetchVulhubPracticeCatalog: fetchVulhubPracticeCatalog } } },
    })
    const { host } = useIntelSettingsPanelHarness()
    const sync = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '同步 Vulhub 练习目录',
    )
    if (!sync) throw new Error('missing Vulhub sync button')

    expect(host.textContent).toContain('1 个练习匹配')
    sync.click()
    await flushAsyncUpdates()

    expect(fetchVulhubPracticeCatalog).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('已同步 Vulhub catalog：新增 1、跳过 0')
    expect(host.textContent).toContain('1 个候选，已缓存元数据 fnv1a-')
    expect(host.textContent).toContain('2 个练习匹配')
    expect(host.textContent).toContain('已有目录')
    expect(host.textContent).toContain('只读匹配和启动前计划')
    expect(host.textContent).not.toContain('已启动容器')
  })

  it('imports a CISA KEV feed snapshot and updates global source metadata', async () => {
    const { host, dashboard } = useIntelSettingsPanelHarness()
    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 Feed'),
    )
    if (!openImport) throw new Error('missing feed import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('导入 CVE Feed 快照')
    expect(host.textContent).toContain('保存来源、获取时间和缓存摘要')
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="CVE Feed JSON"]')
    if (!input) throw new Error('missing feed textarea')
    await setInput(input, JSON.stringify({
      title: 'CISA Known Exploited Vulnerabilities Catalog',
      dateReleased: '2026-08-04T00:00:00Z',
      vulnerabilities: [
        {
          cveID: 'CVE-2024-3400',
          vendorProject: 'Palo Alto Networks',
          product: 'PAN-OS',
          vulnerabilityName: 'PAN-OS GlobalProtect Command Injection',
          dateAdded: '2024-04-12',
          shortDescription: 'Command injection in PAN-OS GlobalProtect.',
          dueDate: '2024-04-19',
          knownRansomwareCampaignUse: 'Known',
          notes: 'https://security.paloaltonetworks.com/CVE-2024-3400',
        },
        {
          cveID: 'CVE-2026-42424',
          vendorProject: 'Example Project',
          product: 'example-gateway',
          vulnerabilityName: 'Example Gateway unsafe parser',
          dateAdded: '2026-08-03',
          shortDescription: 'Example KEV-shaped item used to verify feed import.',
          dueDate: '2026-08-24',
        },
      ],
    }))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 Feed 快照'),
    )
    if (!submit) throw new Error('missing feed import submit')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('已导入 CISA KEV Feed 快照：新增 1、更新 1')
    expect(host.textContent).toContain('CISA KEV Catalog')
    expect(host.textContent).toContain('已缓存元数据 fnv1a-')
    expect(host.textContent).toContain('已导入 CISA KEV')
    expect(host.textContent).toContain('1 个快照')
    expect(host.textContent).toContain('新增 1、更新 1、跳过 0')
    expect(host.textContent).not.toContain('当前 CVE 来源证据')
    expect(host.textContent).toContain('CISA KEV · CISA KEV Catalog')
    expect(host.textContent).toContain('已缓存元数据')
    expect(dashboard.trackedCount.value).toBe(8)
    expect(dashboard.sourceSnapshots.value[0]?.importedIds).toContain('CVE-2026-42424')
    expect(dashboard.sourceSnapshots.value[0]?.updatedIds).toContain('CVE-2024-3400')
  })

  it('shows the Coding workspace scope before handing CVE tasks to Coding', async () => {
    const empty = await mountVulnPageWithWorkspace()
    await openCveResearch(empty.host)
    expect(empty.host.textContent).toContain('临时工作区')
    expect(empty.host.textContent).toContain('项目影响检查')
    const choose = [...empty.host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('选择项目目录'),
    )
    if (!choose) throw new Error('missing choose workspace button')
    choose.click()
    await nextTick()
    expect(empty.chooseCount()).toBe(1)

    for (const app of mountedApps.splice(0)) app.unmount()
    document.body.innerHTML = ''

    const scoped = await mountVulnPageWithWorkspace('/Users/milksu/code/milksu')
    await openCveResearch(scoped.host)
    expect(scoped.host.textContent).toContain('已选择项目')
    expect(scoped.host.textContent).toContain('/Users/milksu/code/milksu')
    expect(scoped.host.textContent).toContain('更换项目目录')
  })

  it('lets the user create a visible research tracking task', async () => {
    const host = await mountVulnPage()
    const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.getAttribute('aria-label') === '执行当前 CVE 下一步',
    )
    if (!button) throw new Error('missing research task button')

    expect(host.textContent).toContain('研究任务')
    expect(host.textContent).toContain('0')
    button.click()
    await flushAsyncUpdates()

    expect(host.textContent).toContain('查看研究任务')
    expect(host.textContent).toContain('已建立')
    expect(host.textContent).toContain('当前研究焦点')
    expect(host.textContent).toContain('研究任务已建立')
    expect(host.textContent).toContain('交给 Coding')
    expect(host.textContent).toContain('把公告、补丁、资产/项目影响和练习启动前清单交给当前授权任务。')
    expect(host.textContent).toContain('研究任务')
    expect(host.textContent).toContain('理解 PAN-OS 的影响范围、修复证据和学习要点')
    expect(host.textContent).toContain('Palo Alto Networks / PAN-OS')
    expect(host.textContent).toContain('下一步给 Agent 的明确任务')
    expect(host.textContent).toContain('固化情报快照')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
    expect(host.textContent).toContain('不要运行 PoC、exploit 或外部扫描')
    expect(host.textContent).toContain('研究中')

    const advance = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('记录下一步'),
    )
    advance?.click()
    await nextTick()
    expect(host.textContent).toContain('阅读材料与补丁')
    advance?.click()
    await nextTick()
    advance?.click()
    await nextTick()
    advance?.click()
    await nextTick()
    expect(host.textContent).toContain('修复与缓解证据')
    expect(host.textContent).toContain('学习复盘')
    expect(host.textContent).toContain('研究中')
  })

  it('makes the top current-next-step card actionable for the selected CVE', async () => {
    storage.set('milksu.vulnerability-dashboard.selected-id.v1', 'CVE-2023-46604')
    const host = await mountVulnPage()

    const nextStep = () => {
      const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
        item.getAttribute('aria-label') === '执行当前 CVE 下一步',
      )
      if (!button) throw new Error('missing current next-step button')
      return button
    }

    expect(host.textContent).toContain('当前下一步')
    expect(host.textContent).toContain('建立研究任务')
    expect(nextStep().textContent).toContain('建立')
    nextStep().click()
    await flushAsyncUpdates()

    expect(host.textContent).toContain('研究任务已建立')
    expect(host.textContent).toContain('确认练习计划')
    expect(nextStep().textContent).toContain('确认')
    nextStep().click()
    await flushAsyncUpdates()

    expect(host.textContent).toContain('已确认计划')
    expect(host.textContent).toContain('交给 Coding')
    expect(host.textContent).toContain('选择本地目录')
    expect(nextStep().textContent).toContain('选择目录')
  })

  it('lets the user add a local CVE tracking item beyond the built-in demo list', async () => {
    const host = await mountVulnPage()
    const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('新增追踪'),
    )
    if (!add) throw new Error('missing add tracking button')
    add.click()
    await nextTick()

    const byPlaceholder = (text: string) => {
      const input = [...host.querySelectorAll<HTMLInputElement>('input')].find(item =>
        item.placeholder.includes(text),
      )
      if (!input) throw new Error(`missing input ${text}`)
      return input
    }
    await setInput(byPlaceholder('CVE-2024-12345'), 'CVE-2026-42424')
    await setInput(byPlaceholder('组件 / 产品'), 'MilkSU Sidecar')
    await setInput(byPlaceholder('厂商 / 项目'), 'MilkSU')
    await setInput(byPlaceholder('受影响版本范围'), 'pre-release local branch')
    await setInput(byPlaceholder('漏洞标题'), '本地测试 CVE 学习追踪')
    await setInput(byPlaceholder('公告、补丁'), 'https://example.test/advisory')
    await setInput(byPlaceholder('这次想学会什么'), '确认补丁阅读和影响判断流程')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('加入追踪'),
    )
    if (!submit) throw new Error('missing submit button')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('CVE-2026-42424')
    expect(host.textContent).toContain('本地测试 CVE 学习追踪')
    expect(host.textContent).toContain('MilkSU')
  })

  it('imports pasted generic CVE Feed JSON into tracking data with cache metadata', async () => {
    const { host, dashboard } = useIntelSettingsPanelHarness()
    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 Feed'),
    )
    if (!openImport) throw new Error('missing import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('导入 CVE Feed 快照')
    expect(host.textContent).toContain('不联网同步、不启动 Docker、不运行 PoC')

    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="CVE Feed JSON"]')
    if (!input) throw new Error('missing CVE Feed textarea')
    await setInput(input, JSON.stringify({
      items: [
        {
          cveId: 'CVE-2026-42424',
          title: '用户导入的依赖风险',
          vendor: 'MilkSU',
          product: 'sidecar fixture',
          affected: 'pre-release',
          details: '本地样本，只用于学习追踪。',
          references: [{ href: 'https://example.test/local-cve' }],
        },
      ],
    }))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 Feed 快照'),
    )
    if (!submit) throw new Error('missing import submit')
    submit.click()
    await nextTick()

    expect(dashboard.trackedCount.value).toBe(8)
    expect(dashboard.sourceSnapshots.value[0]?.importedIds).toContain('CVE-2026-42424')
    expect(host.textContent).toContain('已导入 用户 Feed 快照：新增 1、更新 0')
    expect(host.textContent).toContain('Generic CVE JSON')
    expect(host.textContent).toContain('已缓存元数据 fnv1a-')
    expect(host.textContent).toContain('撤销新增 CVE')
    expect(host.textContent).not.toContain('当前 CVE 来源证据')

    const undo = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('撤销新增 CVE'),
    )
    if (!undo) throw new Error('missing undo import button')
    undo.click()
    await nextTick()

    expect(host.textContent).toContain('已撤销本次新增的 1 条 CVE')
    expect(dashboard.trackedCount.value).toBe(7)
    expect(host.textContent).not.toContain('用户导入的依赖风险')
  })

  it('imports pasted local practice catalog JSON into global practice matching data without launching Docker', async () => {
    const { host, dashboard } = useIntelSettingsPanelHarness()

    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入练习'),
    )
    if (!openImport) throw new Error('missing practice import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('导入本地练习 Catalog')
    expect(host.textContent).toContain('只绑定启动前计划')
    expect(host.textContent).toContain('不拉镜像、不启动容器、不运行触发输入')

    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="本地 CVE 练习 Catalog JSON"]')
    if (!input) throw new Error('missing local practice catalog textarea')
    await setInput(input, JSON.stringify({
      items: [
        {
          cveId: 'CVE-2024-3400',
          title: 'Local PAN-OS lab plan',
          directory: 'pan-os/CVE-2024-3400',
          sourceHref: 'https://example.test/catalog/pan-os/CVE-2024-3400',
          revision: 'local catalog abc123',
          ports: ['8080/tcp · local lab'],
          network: '仅允许 127.0.0.1 访问。',
        },
      ],
    }))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入练习匹配'),
    )
    if (!submit) throw new Error('missing practice import submit')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('已导入 1 个本地练习环境匹配')
    expect(host.textContent).toContain('2 个练习匹配')
    expect(host.textContent).toContain('已有目录')
    expect(host.textContent).not.toContain('确认练习计划')
    expect(dashboard.practiceEnvironmentCount.value).toBe(2)
    expect(dashboard.practiceEnvironmentFor.value?.title).toContain('Local PAN-OS lab plan')
    expect(dashboard.practiceEnvironmentFor.value?.directory).toBe('pan-os/CVE-2024-3400')

    const undo = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('撤销本次导入'),
    )
    if (!undo) throw new Error('missing practice undo button')
    undo.click()
    await nextTick()

    expect(host.textContent).toContain('已撤销本次导入的 1 个本地练习环境匹配')
    expect(dashboard.practiceEnvironmentCount.value).toBe(1)
  })

  it('persists user-confirmed research notes for the selected CVE', async () => {
    const host = await mountVulnPage()
    await openCveResearch(host)
    const byLabel = (label: string) => {
      const textarea = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')].find(item =>
        item.getAttribute('aria-label') === label,
      )
      if (!textarea) throw new Error(`missing textarea ${label}`)
      return textarea
    }

    await setInput(byLabel('CVE 关键结论'), '确认影响范围后再交给 Coding Agent 做只读版本检查。')
    await setInput(byLabel('CVE 学习笔记'), '已阅读公告，暂不运行 PoC，下一步核对依赖和补丁。')

    expect(host.textContent).toContain('已记录')
    await unmountAll()

    const remounted = await mountVulnPage()
    await openCveResearch(remounted)
    const textareas = [...remounted.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(textareas.some(item => item.value.includes('只读版本检查'))).toBe(true)
    expect(textareas.some(item => item.value.includes('暂不运行 PoC'))).toBe(true)
  })

  it('records a user-confirmed related-history result into the current CVE note', async () => {
    installSessionHistoryRuntime()
    const host = await mountVulnPage()
    await openCveResearch(host)
    await flushAsyncUpdates()

    expect(host.textContent).toContain('CVE-2024-3400 研究回顾')
    expect(host.textContent).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(host.textContent).not.toContain('sk-history-secret12345')

    const beforeTextareas = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(beforeTextareas.some(item => item.value.includes('相关历史（用户确认）'))).toBe(false)

    const record = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('记入笔记'),
    )
    if (!record) throw new Error('missing related-history note action')
    record.click()
    await nextTick()

    expect(host.textContent).toContain('已记入当前 CVE 笔记')
    const afterTextareas = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')]
    const noteValues = afterTextareas.map(item => item.value).join('\n')
    expect(noteValues).toContain('相关历史（用户确认）')
    expect(noteValues).toContain('会话：CVE-2024-3400 研究回顾')
    expect(noteValues).toContain('来源：CVE')
    expect(noteValues).toContain('摘要：NVD 同步后确认 CVSS 10.0')
    expect(noteValues).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(noteValues).not.toContain('sk-history-secret12345')
  })

  it('imports user-confirmed Coding conclusions back into CVE research notes', async () => {
    const { host, tasks, handoffRecorders } = await mountVulnPageWithCodingTaskSink()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    const handoff = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('交给 Coding'),
    )
    if (!handoff) throw new Error('missing Coding handoff button')
    handoff.click()
    await nextTick()
    expect(tasks).toHaveLength(1)
    handoffRecorders[0]('/Users/milksu/code/milksu')
    await nextTick()

    const openImport = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入 Coding 结论'),
    )
    if (!openImport) throw new Error('missing Coding conclusion import button')
    openImport.click()
    await nextTick()

    expect(host.textContent).toContain('粘贴 Coding Agent 完成后的摘要')
    expect(host.textContent).toContain('不自动提升用户能力画像')
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Coding 结论回写"]')
    if (!input) throw new Error('missing Coding conclusion textarea')
    await setInput(input, [
      '已核对 Apache advisory 和补丁版本范围。',
      '授权仓库只读检查：未发现 ActiveMQ 依赖。',
      '仍需用户确认生产 mq-orders-prod 版本。',
    ].join('\n'))

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('导入到笔记'),
    )
    if (!submit) throw new Error('missing Coding conclusion submit')
    submit.click()
    await flushAsyncUpdates()

    expect(host.textContent).toContain('已导入到研究笔记')
    expect(host.textContent).toContain('正式研究档案')
    expect(host.textContent).toContain('1 条学习记录')
    expect(host.textContent).toContain('复制证据摘要')
    const textareas = [...host.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(textareas.some(item => item.value.includes('已核对 Apache advisory 和补丁版本范围。'))).toBe(true)
    expect(textareas.some(item => item.value.includes('Coding 结论回写（用户粘贴/确认）'))).toBe(true)
    expect(textareas.some(item => item.value.includes('未发现 ActiveMQ 依赖'))).toBe(true)
  })

  it('lets the user attach a local asset hit to a tracked CVE', async () => {
    const host = await mountVulnPage()
    await openCveResearch(host)
    const openAssetForm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('新增资产'),
    )
    if (!openAssetForm) throw new Error('missing add asset button')
    openAssetForm.click()
    await nextTick()

    const byPlaceholder = (text: string) => {
      const input = [...host.querySelectorAll<HTMLInputElement>('input')].find(item =>
        item.placeholder.includes(text),
      )
      if (!input) throw new Error(`missing input ${text}`)
      return input
    }
    await setInput(byPlaceholder('资产名称'), 'vpn-prod-user-confirmed')
    await setInput(byPlaceholder('地址 / 仓库 / 服务'), '10.88.0.12')
    await setInput(byPlaceholder('环境'), '用户本地资产清单')

    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('加入资产'),
    )
    if (!submit) throw new Error('missing submit asset button')
    submit.click()
    await nextTick()

    expect(host.textContent).toContain('受影响资产（4）')
    expect(host.textContent).toContain('vpn-prod-user-confirmed')
    expect(host.textContent).toContain('10.88.0.12')
    expect(host.textContent).toContain('用户本地资产清单')
    expect(host.textContent).toContain('研究中')
  })

  it('lets the user confirm a matched isolated practice environment before selecting a local directory', async () => {
    const host = await mountVulnPage()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    expect(host.textContent).toContain('Vulhub · Apache ActiveMQ OpenWire RCE')
    expect(host.textContent).toContain('隔离练习环境已匹配')
    expect(host.textContent).toContain('vulhub/activemq/CVE-2023-46604')
    expect(host.textContent).toContain('目录activemq/CVE-2023-46604')
    expect(host.textContent).toContain('vulhub/vulhub HEAD aeaf65793f147f29bd50841ef77f4e9cad07ecc7')
    expect(host.textContent).toContain('确认练习计划')
    expect(host.textContent).toContain('activemq/CVE-2023-46604')
    expect(host.textContent).toContain('61616/tcp · OpenWire')
    expect(host.textContent).toContain('默认只创建启动计划')
    expect(host.textContent).toContain('练习成功只代表本地学习完成')

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认练习计划'),
    )
    if (!confirm) throw new Error('missing confirm practice button')
    confirm.click()
    await nextTick()

    expect(host.textContent).toContain('已确认计划')
    expect(host.textContent).toContain('已确认本地练习计划，尚未启动容器')
    expect(host.textContent).toContain('选择本地目录')
    expect(host.textContent).toContain('下一步交给 Coding Agent')
    expect(host.textContent).toContain('本地练习启动前清单')
    expect(host.textContent).toContain('复制启动前计划')
    expect(host.textContent).toContain('必须逐项人工确认 Docker、端口、目录、网络边界和清理方式')
    expect(host.textContent).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')

    const chooseDirectory = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('选择本地目录'),
    )
    if (!chooseDirectory) throw new Error('missing choose practice directory button')
    expect(host.textContent).not.toContain('停止并清理')

    const clear = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('清除记录'),
    )
    if (!clear) throw new Error('missing clear practice button')
    clear.click()
    await nextTick()
    expect(host.textContent).toContain('待确认')
  })

  it('hands confirmed CVE practice context to Coding Agent as a safe task', async () => {
    const { host, tasks, handoffRecorders } = await mountVulnPageWithCodingTaskSink()
    const activeMqRow = [...host.querySelectorAll<HTMLTableRowElement>('tr')].find(item =>
      item.textContent?.includes('CVE-2023-46604'),
    )
    if (!activeMqRow) throw new Error('missing ActiveMQ CVE row')
    activeMqRow.click()
    await nextTick()

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('确认练习计划'),
    )
    confirm?.click()
    await nextTick()

    const handoff = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('交给 Coding'),
    )
    if (!handoff) throw new Error('missing Coding handoff button')
    handoff.click()
    await nextTick()

    expect(tasks).toHaveLength(1)
    expect(handoffRecorders).toHaveLength(1)
    expect(tasks[0].title).toBe('CVE-2023-46604 研究接力')
    expect(tasks[0].visibleText).toContain('接手 CVE-2023-46604')
    expect(tasks[0].prompt).toContain('Apache ActiveMQ OpenWire RCE')
    expect(tasks[0].prompt).toContain('情报源接入状态')
    expect(tasks[0].prompt).toContain('NVD：内置快照')
    expect(tasks[0].prompt).toContain('OSV / GitHub Advisory：已接入')
    expect(tasks[0].prompt).toContain('Vulhub 练习目录：内置快照')
    expect(tasks[0].prompt).toContain('vulhub/activemq/CVE-2023-46604')
    expect(tasks[0].prompt).toContain('当前练习状态：已确认计划，未启动容器')
    expect(tasks[0].prompt).toContain('不要自动拉取镜像、启动容器、运行 exploit 或访问外部目标')
    expect(tasks[0].prompt).toContain('不要把情报命中或练习结果写成真实资产已验证')
    expect(host.textContent).not.toContain('最近 Coding 接力')
    expect(host.textContent).not.toContain('已交接')

    handoffRecorders[0](' /Users/milksu/code/milksu ')
    await nextTick()

    expect(host.textContent).toContain('最近 Coding 接力')
    expect(host.textContent).toContain('已交接')
    expect(host.textContent).toContain('/Users/milksu/code/milksu')
  })
})
