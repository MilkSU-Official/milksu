// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionHistoryPanel from './SessionHistoryPanel.vue'

const hasDesktopRuntime = vi.fn(() => true)
const status = {
  available: true, mode: 'milksu-obelisk-core', indexPath: '/tmp/obelisk.sqlite',
  checkedAt: '2026-08-10T09:30:00Z', readOnly: true, sessionCount: 3,
  messageCount: 8, toolCallCount: 2, memoryCount: 1, sources: [],
}
const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'get_session_index_status') return status
  if (command === 'search_session_history') {
    const request = (args as { request?: { query?: string } } | undefined)?.request
    return {
      query: request?.query ?? '', searchedAt: '2026-08-10T09:32:00Z', status,
      results: [{
        messageUuid: 'milksu:cve-1:assistant-1', sessionId: 'milksu:cve-1',
        sessionName: 'CVE-2024-3400 接力', source: 'milksu-cve', timestamp: '2026-08-10T09:20:00Z',
        snippet: 'NVD CVE-2024-3400 同步完成；OPENAI_API_KEY=sk-history-secret12345',
        skill: 'fetch_nvd_cve Bearer session-history-token-12345',
      }],
    }
  }
  if (command === 'get_session_history_graph') {
    return {
      generatedAt: '2026-08-10T09:33:00Z', title: 'CVE 研究脉络', summary: '语义归纳',
      provider: 'tokenflux', model: 'grok-4.5', status,
      clusters: [{ id: 'research', label: '研究' }],
      nodes: [{
        id: 'semantic-1', type: 'topic', label: 'CVE 研究', summary: '当前研究主题',
        cluster: 'research', importance: 4, status: 'current', inferred: true,
        sources: [{ kind: 'conversation', sessionName: 'CVE 接力', excerpt: 'NVD 同步完成' }],
      }],
      edges: [], projects: ['milksu'], truncated: false,
    }
  }
  if (command === 'refresh_session_index') {
    return { indexedAt: '2026-08-10T09:31:00Z', indexPath: '/tmp/obelisk.sqlite', source: 'milksu', sessionCount: 3, messageCount: 8, toolCallCount: 2 }
  }
  throw new Error(`unexpected command ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => hasDesktopRuntime(),
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
}))

vi.mock('@/components-vue/SessionHistoryGraph.vue', () => ({
  __esModule: true,
  default: {
    props: ['response', 'loading'],
    emits: ['regenerate', 'openSession'],
    template: `<div data-mock-semantic-graph>
      <span>{{ loading ? '正在生成图谱' : response?.title }}</span>
      <button type="button" aria-label="重新生成语义图谱" @click="$emit('regenerate')">重新生成</button>
    </div>`,
  },
}))

const mountedApps: App[] = []

async function settle() {
  for (let index = 0; index < 7; index++) {
    await Promise.resolve()
    await nextTick()
  }
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

async function mountPanel(props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SessionHistoryPanel, {
    module: 'cve', defaultQuery: 'CVE-2024-3400', ...props,
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  invokeCommand.mockClear()
  hasDesktopRuntime.mockReturnValue(true)
})

describe('SessionHistoryPanel', () => {
  it('loads the human-readable history list without spending a model turn', async () => {
    const host = await mountPanel()
    expect(host.textContent).toContain('相关历史')
    expect(host.textContent).toContain('CVE-2024-3400 接力')
    expect(host.textContent).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(host.textContent).not.toContain('sk-history-secret12345')
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', {
      request: { query: 'CVE-2024-3400', module: 'cve', limit: 20 },
    })
    expect(invokeCommand).not.toHaveBeenCalledWith('get_session_history_graph', expect.anything())
  })

  it('generates the semantic graph only after the user opens graph view', async () => {
    const host = await mountPanel()
    invokeCommand.mockClear()
    host.querySelector<HTMLButtonElement>('button[aria-label="图谱视图"]')?.click()
    await vi.dynamicImportSettled()
    await settle()
    expect(invokeCommand).toHaveBeenCalledTimes(1)
    expect(invokeCommand).toHaveBeenCalledWith('get_session_history_graph', {
      request: { query: 'CVE-2024-3400', module: 'cve' },
    })
    expect(host.textContent).toContain('CVE 研究脉络')
  })

  it('regenerates explicitly and does not keep a stale graph after search changes', async () => {
    const host = await mountPanel()
    host.querySelector<HTMLButtonElement>('button[aria-label="图谱视图"]')?.click()
    await vi.dynamicImportSettled()
    await settle()
    invokeCommand.mockClear()

    host.querySelector<HTMLButtonElement>('button[aria-label="重新生成语义图谱"]')?.click()
    await settle()
    expect(invokeCommand).toHaveBeenCalledWith('get_session_history_graph', expect.anything())

    invokeCommand.mockClear()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索相关历史"]')
    if (!input) throw new Error('missing history input')
    input.value = 'Computer Use'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector<HTMLFormElement>('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', expect.objectContaining({ request: expect.objectContaining({ query: 'Computer Use' }) }))
    expect(invokeCommand).toHaveBeenCalledWith('get_session_history_graph', expect.objectContaining({ request: expect.objectContaining({ query: 'Computer Use' }) }))
  })

  it('keeps result reuse behind an explicit human confirmation', async () => {
    const confirmed: unknown[] = []
    const host = await mountPanel({ confirmActionLabel: '记入笔记', onConfirmResult: (result: unknown) => confirmed.push(result) })
    const action = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('记入笔记'))
    expect(action).toBeDefined()
    expect(confirmed).toHaveLength(0)
    action?.click()
    await settle()
    expect(confirmed).toHaveLength(1)
  })

  it('refreshes the index but does not generate a graph while in list view', async () => {
    const host = await mountPanel({ module: 'coding', defaultQuery: 'Computer Use' })
    invokeCommand.mockClear()
    host.querySelector<HTMLButtonElement>('button[aria-label="刷新相关历史索引"]')?.click()
    await settle()
    expect(invokeCommand).toHaveBeenCalledWith('refresh_session_index')
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', expect.anything())
    expect(invokeCommand).not.toHaveBeenCalledWith('get_session_history_graph', expect.anything())
  })

  it('keeps compact and browser-preview panels free of semantic generation', async () => {
    let host = await mountPanel({ compact: true })
    expect(host.textContent).not.toContain('图谱')
    expect(invokeCommand).not.toHaveBeenCalledWith('get_session_history_graph', expect.anything())

    mountedApps.pop()?.unmount()
    document.body.innerHTML = ''
    invokeCommand.mockClear()
    hasDesktopRuntime.mockReturnValue(false)
    host = await mountPanel({ module: 'ctf', defaultQuery: 'Judge' })
    expect(host.textContent).toContain('打包 App 中可查看本机历史')
    expect(invokeCommand).not.toHaveBeenCalled()
  })
})
