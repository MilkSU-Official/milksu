// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import VulnPage from './VulnPage.vue'
import { useVulnerabilityDashboard as createVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

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
})

async function mountPage(options: {
  conversations?: Conversation[]
  onStartCodingTask?: (...args: unknown[]) => void
  onOpenCodingConversation?: (id: string) => void
  onRun?: (...args: unknown[]) => void
  trackedIds?: string[]
} = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const dashboard = createVulnerabilityDashboard()
  for (const id of options.trackedIds ?? []) {
    dashboard.addTrackingItem({
      id,
      title: '',
      vendor: '',
      product: '',
      affected: '',
      summary: '',
    })
  }
  const app = createApp(VulnPage, {
    dashboard,
    conversations: options.conversations ?? [],
    onStartCodingTask: options.onStartCodingTask,
    onOpenCodingConversation: options.onOpenCodingConversation,
    onRun: options.onRun,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, dashboard }
}

async function mountList(options: Parameters<typeof mountPage>[0] = {}) {
  const result = await mountPage(options)
  result.dashboard.selectedId.value = ''
  await nextTick()
  return result
}

function buttonWithText(host: HTMLElement, text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes(text))
}

function openTrackedRow(host: HTMLElement, text: string) {
  const row = [...host.querySelectorAll<HTMLElement>('[data-testid="catalog-row"]')]
    .find(item => item.textContent?.includes(text))
  row?.querySelector<HTMLButtonElement>('[data-testid="open-item"]')?.click()
}

describe('VulnPage thin workspace', () => {
  it('shows a compact CVE list without the old automatic-loop dashboards', async () => {
    const { host } = await mountList({ trackedIds: ['CVE-2024-3400'] })

    expect(host.textContent).toContain('CVE-2024-3400')
    expect(host.textContent).not.toContain('学习专题')
    expect(host.textContent).toContain('导入')
    expect(host.textContent).toContain('想研究')
    expect(host.textContent).not.toContain('待复现')
    expect(host.textContent).not.toContain('练习环境')
    expect(host.textContent).not.toContain('当前下一步')
    expect(host.textContent).not.toContain('闭环')
    expect(host.textContent).not.toContain('研究任务')
    expect(host.querySelector('[aria-label="严重性"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="KEV"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="厂商"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="年份"]')).not.toBeNull()
  })

  it('starts empty instead of presenting the public catalog as the user list', async () => {
    const { host } = await mountPage()

    expect(host.textContent).not.toContain('还没有添加 CVE')
    expect(host.textContent).not.toContain('CVE-2024-3400')
  })

  it('shows CVEs imported from a public feed in the list', async () => {
    const { host, dashboard } = await mountList()
    dashboard.importFeedSnapshotJSON(JSON.stringify({
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
    }), {
      sourceName: 'CISA KEV',
      sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      retrievedAt: '2026-08-04T01:02:03Z',
    })
    dashboard.selectedId.value = ''
    await nextTick()

    expect(host.textContent).toContain('CVE-2026-42424')
    expect(host.textContent).toContain('Example Gateway unsafe parser')
    expect(host.textContent).toContain('共 1 条')
  })

  it('uses one public search field instead of asking the user to fill CVE metadata', async () => {
    const { host } = await mountPage()

    buttonWithText(host, '导入')?.click()
    await nextTick()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('查找公开 CVE')
    expect(dialog?.textContent).toContain('同步公开源')
    expect(dialog?.querySelector('[aria-label="搜索公开 CVE"]')).not.toBeNull()
    expect(dialog?.querySelector('[aria-label="漏洞名称"]')).toBeNull()
    expect(dialog?.querySelector('[aria-label="厂商或项目"]')).toBeNull()
    expect(dialog?.querySelector('[aria-label="受影响版本"]')).toBeNull()
  })

  it('turns a temporary NVD failure into a user-facing message', async () => {
    const { host, dashboard } = await mountPage()
    vi.spyOn(dashboard, 'searchNvdCves').mockRejectedValueOnce(
      new Error("Error invoking remote method 'milksu:invoke': Error: fetch vulnerability feed: unexpected HTTP 503"),
    )

    buttonWithText(host, '导入')?.click()
    await nextTick()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const input = dialog.querySelector<HTMLInputElement>('[aria-label="搜索公开 CVE"]')!
    input.value = 'CVE-2024-3094'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    dialog.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(dialog.textContent).toContain('公开 CVE 服务暂时繁忙，请稍后重试。'))

    expect(dialog.textContent).not.toContain('milksu:invoke')
    expect(dialog.textContent).not.toContain('HTTP 503')
  })

  it('shows only a few readable source organizations for a CVE with many references', async () => {
    const { host, dashboard } = await mountPage()
    dashboard.addNvdSearchResult({
      id: 'CVE-2024-3094',
      title: 'XZ Utils supply chain compromise',
      vendor: 'Tukaani',
      product: 'XZ Utils',
      affected: '5.6.0–5.6.1',
      summary: 'Public NVD summary.',
      cvss: 10,
      severity: 'critical',
      updated: '2026-06-16',
      sourceName: 'NVD',
      sourceUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-3094',
      retrievedAt: '2026-08-13T03:00:00Z',
      references: [
        { label: 'NVD', href: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094' },
        { label: 'secalert@redhat.com', href: 'https://access.redhat.com/security/cve/CVE-2024-3094' },
        { label: 'secalert@redhat.com', href: 'https://bugzilla.redhat.com/show_bug.cgi?id=2272210' },
        { label: 'af854a3a-2127-422b-91ae-364da2661108', href: 'https://www.openwall.com/lists/oss-security/2024/03/29/4' },
        { label: 'af854a3a-2127-422b-91ae-364da2661108', href: 'https://www.openwall.com/lists/oss-security/2024/03/30/12' },
        { label: 'GitHub advisory', href: 'https://github.com/advisories/GHSA-rxwq-x6h5-x525' },
      ],
    })
    await nextTick()
    openTrackedRow(host, 'CVE-2024-3094')
    await nextTick()

    const sourceLinks = [...host.querySelectorAll<HTMLAnchorElement>('a')]
    expect(sourceLinks.map(link => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'NVD', 'CISA', 'Red Hat', 'Openwall',
    ])
    expect(host.textContent).not.toContain('secalert@redhat.com')
    expect(host.textContent).not.toContain('af854a3a-2127-422b-91ae-364da2661108')
  })

  it('lets the user set CVE status manually', async () => {
    const { host, dashboard } = await mountPage({ trackedIds: ['CVE-2024-3400'] })
    openTrackedRow(host, 'CVE-2024-3400')
    await nextTick()
    const status = host.querySelector<HTMLSelectElement>('[aria-label="CVE-2024-3400 状态"]')

    expect(status).not.toBeNull()
    status!.value = '已验证'
    status!.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(dashboard.selected.value.status).toBe('已验证')
  })

  it('opens a dossier and starts reproduction without changing the manual status', async () => {
    const runs: unknown[][] = []
    const { host, dashboard } = await mountPage({
      trackedIds: ['CVE-2024-3400'],
      onRun: (...args: unknown[]) => runs.push(args),
    })
    expect(dashboard.selected.value.status).toBe('待复现')
    openTrackedRow(host, 'CVE-2024-3400')
    await nextTick()
    expect(host.textContent).toContain('开始复现')
    buttonWithText(host, '开始复现')?.click()
    await nextTick()
    expect(runs).toHaveLength(1)
    expect((runs[0][0] as { id: string }).id).toBe('CVE-2024-3400')
    expect(dashboard.selected.value.status).toBe('待复现')
    expect(host.querySelector('[data-testid="related-cves"]')).not.toBeNull()
    expect(host.textContent).toContain('关联 CVE')
    expect(host.querySelector('[data-testid="environment-strip"]')).not.toBeNull()
    expect(host.textContent).toContain('没有练习包')
  })

  it('expands the conversation dock and focuses the composer when starting reproduction', async () => {
    const { host } = await mountPage({ trackedIds: ['CVE-2024-3400'] })
    openTrackedRow(host, 'CVE-2024-3400')
    await nextTick()
    const editor = host.querySelector<HTMLElement>('[aria-label="消息"]')
    expect(editor).not.toBeNull()
    const focus = vi.spyOn(editor!, 'focus')

    buttonWithText(host, '开始复现')?.click()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="conversation-dock"]')).not.toBeNull()
      expect(focus).toHaveBeenCalled()
    })
  })

  it('can open the conversation dock on the CVE catalog', async () => {
    const { host } = await mountList({ trackedIds: ['CVE-2024-3400'] })
    expect(host.querySelector('[data-testid="open-item"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="conversation-dock"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="关闭对话"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="消息"]')).not.toBeNull()
  })

  it('keeps list titles selectable instead of opening the dossier from the row', async () => {
    const { host, dashboard } = await mountList({ trackedIds: ['CVE-2024-3400'] })
    const title = [...host.querySelectorAll('span')].find(node => node.textContent?.includes('CVE-2024-3400'))
    title?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(dashboard.selectedId.value).toBe('')
    expect(host.querySelector('[data-testid="open-item"]')).not.toBeNull()
  })



  it('lets one CVE belong to several collection views', async () => {
    const { host } = await mountList({ trackedIds: ['CVE-2024-3400'] })
    const bookmark = host.querySelector<HTMLButtonElement>('[aria-label="收藏"]')
    expect(bookmark).not.toBeNull()

    bookmark?.click()
    await nextTick()
    const popover = document.body.querySelector('[data-slot="popover-content"]')
    const quickCollection = [...(popover?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find(button => button.textContent?.trim() === '收藏')
    quickCollection?.click()
    await nextTick()

    expect(host.querySelector('[aria-label="编辑收藏"]')).not.toBeNull()
    buttonWithText(host, '收藏')?.click()
    await nextTick()
    expect(host.textContent).toContain('CVE-2024-3400')
  })
})
