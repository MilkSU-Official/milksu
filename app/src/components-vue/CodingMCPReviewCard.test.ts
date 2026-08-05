// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingMCPReviewCard from './CodingMCPReviewCard.vue'
import type { CodingMCPServerSummary } from '@/codingEnvironmentTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountCard(server: CodingMCPServerSummary, onToggle = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingMCPReviewCard, {
    server,
    selected: false,
    running: false,
    onToggle,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, onToggle }
}

const reviewedServer: CodingMCPServerSummary = {
  name: 'frontend-qa',
  transport: '本地进程',
  source: 'npm:@example/frontend-qa',
  version: '1.4.2',
  taskScope: '当前项目的前端回归',
  tools: ['inspect_page', 'take_screenshot'],
  fileAccess: '项目读写 + 私有运行目录',
  networkAccess: '任意出站网络',
  credentialAccess: '不注入；Provider Credential 保持隔离',
  reviewReady: true,
}

describe('CodingMCPReviewCard', () => {
  it('shows the complete review surface before task-scoped enablement', async () => {
    const { host, onToggle } = await mountCard(reviewedServer)
    const text = host.textContent ?? ''

    for (const value of [
      'npm:@example/frontend-qa',
      '1.4.2',
      '当前项目的前端回归',
      'inspect_page · take_screenshot',
      '项目读写 + 私有运行目录',
      '任意出站网络',
      'Provider Credential 保持隔离',
    ]) {
      expect(text).toContain(value)
    }
    const button = host.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    await nextTick()
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('blocks an MCP server whose fixed review metadata is incomplete', async () => {
    const { host, onToggle } = await mountCard({
      ...reviewedServer,
      source: undefined,
      tools: [],
      reviewReady: false,
      reviewProblem: '缺少可审阅的来源。',
    })

    expect(host.textContent).toContain('不可启用')
    expect(host.textContent).toContain('缺少可审阅的来源。')
    const button = host.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    await nextTick()
    expect(onToggle).not.toHaveBeenCalled()
  })
})
