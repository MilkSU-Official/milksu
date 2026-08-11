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
})
