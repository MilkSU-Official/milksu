// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VulnPage from './VulnPage.vue'
import { useVulnerabilityDashboard as createVulnerabilityDashboard } from '@/composables/useVulnerabilityDashboard'
import type { Conversation } from '@/types'

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
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, dashboard }
}

function buttonWithText(host: HTMLElement, text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent?.includes(text))
}

describe('VulnPage thin workspace', () => {
  it('shows a compact CVE list without the old automatic-loop dashboards', async () => {
    const { host } = await mountPage({ trackedIds: ['CVE-2024-3400'] })

    expect(host.textContent).toContain('CVE-2024-3400')
    expect(host.textContent).toContain('学习专题')
    expect(host.textContent).toContain('添加 CVE')
    expect(host.textContent).toContain('交给 Coding')
    expect(host.textContent).not.toContain('练习环境')
    expect(host.textContent).not.toContain('当前下一步')
    expect(host.textContent).not.toContain('闭环')
    expect(host.textContent).not.toContain('研究任务')
  })

  it('starts empty instead of presenting the public catalog as the user list', async () => {
    const { host } = await mountPage()

    expect(host.textContent).toContain('还没有添加 CVE')
    expect(host.textContent).not.toContain('CVE-2024-3400')
  })

  it('uses one public search field instead of asking the user to fill CVE metadata', async () => {
    const { host } = await mountPage()

    buttonWithText(host, '添加 CVE')?.click()
    await nextTick()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('查找公开 CVE')
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

    buttonWithText(host, '添加 CVE')?.click()
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

    const sourceLinks = [...host.querySelectorAll<HTMLAnchorElement>('.game-focus-panel a')]
    expect(sourceLinks).toHaveLength(5)
    expect(sourceLinks.map(link => link.textContent?.trim())).toEqual([
      'NVD', 'CISA', 'Red Hat', 'Openwall', '在 NVD 查看全部',
    ])
    expect(host.textContent).not.toContain('secalert@redhat.com')
    expect(host.textContent).not.toContain('af854a3a-2127-422b-91ae-364da2661108')
  })

  it('lets the user set CVE status manually', async () => {
    const { host, dashboard } = await mountPage({ trackedIds: ['CVE-2024-3400'] })
    const status = host.querySelector<HTMLSelectElement>('[aria-label="CVE-2024-3400 状态"]')

    expect(status).not.toBeNull()
    status!.value = '已验证'
    status!.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(dashboard.selected.value.status).toBe('已验证')
  })

  it('hands the selected CVE to Coding without changing the manual status', async () => {
    const tasks: unknown[][] = []
    const { host, dashboard } = await mountPage({
      trackedIds: ['CVE-2024-3400'],
      onStartCodingTask: (...args: unknown[]) => tasks.push(args),
    })
    expect(dashboard.selected.value.status).toBe('待复现')

    buttonWithText(host, '交给 Coding')?.click()
    await nextTick()

    expect(tasks).toHaveLength(1)
    expect(tasks[0][0]).toMatchObject({
      domainTaskContext: { kind: 'cve', cveId: 'CVE-2024-3400' },
    })
    const recordHandoff = tasks[0][1] as (workspacePath: string) => void
    recordHandoff('/Users/milksu/code/milksu')
    expect(dashboard.selected.value.status).toBe('待复现')
  })

  it('shows and opens Coding conversations linked to the same CVE', async () => {
    const openConversation = vi.fn()
    const conversation: Conversation = {
      id: 'cve-conversation-1',
      title: '分析 PAN-OS 补丁差异',
      createdAt: Date.now(),
      messages: [],
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS GlobalProtect Command Injection',
        sourceEvidenceState: 'NVD',
        sourceEvidenceCount: 1,
        assetMatchState: '尚无用户确认资产匹配',
        assetCount: 0,
        researchScope: '只读研究',
        safetyBoundary: '不运行 PoC',
        roleLabel: 'CVE 只读/研究接力',
      },
    }
    const { host } = await mountPage({
      trackedIds: ['CVE-2024-3400'],
      conversations: [conversation],
      onOpenCodingConversation: openConversation,
    })

    expect(host.textContent).toContain('关联对话 1')
    buttonWithText(host, conversation.title)?.click()
    await nextTick()
    expect(openConversation).toHaveBeenCalledWith(conversation.id)
  })

  it('uses learning topics as lightweight list filters', async () => {
    const { host, dashboard } = await mountPage({ trackedIds: ['CVE-2023-46604'] })

    buttonWithText(host, '学习专题')?.click()
    await nextTick()
    expect(host.textContent).toContain('反序列化与协议边界')

    buttonWithText(host, '反序列化与协议边界')?.click()
    await nextTick()
    expect(dashboard.query.value).toBe('ActiveMQ')
    expect(host.textContent).toContain('CVE-2023-46604')
  })

  it('lets one CVE belong to several collection views', async () => {
    const { host } = await mountPage({ trackedIds: ['CVE-2024-3400'] })
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
