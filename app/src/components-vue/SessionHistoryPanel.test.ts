// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionHistoryPanel from './SessionHistoryPanel.vue'

const hasDesktopRuntime = vi.fn(() => true)
const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'get_session_index_status') {
    return {
      available: true,
      mode: 'milksu-obelisk-core',
      indexPath: '/Users/example/Library/Application Support/com.milksu.app/session-index/obelisk.sqlite',
      checkedAt: '2026-08-04T09:30:00Z',
      readOnly: true,
      sessionCount: 3,
      messageCount: 8,
      toolCallCount: 2,
      memoryCount: 0,
      sources: [
        { source: 'milksu-coding', count: 1 },
        { source: 'milksu-cve', count: 1 },
        { source: 'milksu-ctf', count: 1 },
      ],
      factBoundary: 'internal-only fact boundary',
    }
  }
  if (command === 'search_session_history') {
    const request = (args as { request?: { query?: string } } | undefined)?.request
    return {
      query: request?.query ?? '',
      searchedAt: '2026-08-04T09:32:00Z',
      status: {
        available: true,
        mode: 'milksu-obelisk-core',
        indexPath: '/Users/example/Library/Application Support/com.milksu.app/session-index/obelisk.sqlite',
        checkedAt: '2026-08-04T09:32:00Z',
        readOnly: true,
        sessionCount: 3,
        messageCount: 8,
        toolCallCount: 2,
        memoryCount: 0,
        sources: [],
        factBoundary: 'internal-only fact boundary',
      },
      results: [{
        messageUuid: 'milksu:cve-1:assistant-1',
        sessionId: 'milksu:cve-1',
        sessionName: 'CVE-2024-3400 接力',
        source: 'milksu-cve',
        timestamp: '2026-08-04T09:20:00Z',
        snippet: 'NVD CVE-2024-3400 同步完成；OPENAI_API_KEY=sk-history-secret12345',
        skill: 'fetch_nvd_cve Bearer session-history-token-12345',
      }],
      factBoundary: 'internal-only fact boundary',
    }
  }
  if (command === 'get_session_history_graph') {
    const request = (args as { request?: { query?: string } } | undefined)?.request
    return {
      generatedAt: '2026-08-04T09:32:00Z',
      status: {
        available: true,
        mode: 'milksu-obelisk-core',
        indexPath: '/Users/example/Library/Application Support/com.milksu.app/session-index/obelisk.sqlite',
        checkedAt: '2026-08-04T09:32:00Z',
        readOnly: true,
        sessionCount: 3,
        messageCount: 8,
        toolCallCount: 2,
        memoryCount: 0,
        sources: [],
      },
      nodes: [{
        id: 'session:cve-1',
        type: 'session',
        label: 'CVE-2024-3400 接力',
        detail: 'OPENAI_API_KEY=sk-history-graph-secret12345',
        module: 'cve',
        project: 'milksu',
        quote: 'NVD CVE-2024-3400 同步完成',
        sources: [{
          sessionId: 'milksu:cve-1',
          conversationId: 'cve-1',
          messageUuid: 'milksu:cve-1:assistant-1',
          sessionName: 'CVE-2024-3400 接力',
          timestamp: '2026-08-04T09:20:00Z',
        }],
      }],
      edges: [],
      projects: ['milksu'],
      truncated: false,
      query: request?.query ?? '',
    }
  }
  if (command === 'refresh_session_index') {
    return {
      indexedAt: '2026-08-04T09:31:00Z',
      indexPath: '/Users/example/Library/Application Support/com.milksu.app/session-index/obelisk.sqlite',
      source: 'milksu',
      sessionCount: 3,
      messageCount: 8,
      toolCallCount: 2,
    }
  }
  throw new Error(`unexpected command ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => hasDesktopRuntime(),
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
}))

const mountedApps: App[] = []

async function settle() {
  for (let index = 0; index < 6; index++) {
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
    module: 'cve',
    defaultQuery: 'CVE-2024-3400',
    ...props,
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
  it('loads MilkSU-owned related history without exposing internal fact-boundary copy', async () => {
    const host = await mountPanel()
    const text = host.textContent ?? ''
    expect(text).toContain('相关历史')
    expect(text).toContain('CVE')
    expect(text).toContain('3 会话 · 8 消息 · 2 工具调用')
    expect(text).toContain('CVE-2024-3400 接力')
    expect(text).toContain('NVD CVE-2024-3400 同步完成')
    expect(text).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(text).toContain('fetch_nvd_cve Bearer [credential redacted]')
    expect(text).not.toContain('sk-history-secret12345')
    expect(text).not.toContain('session-history-token-12345')
    expect(text).not.toContain('事实源')
    expect(text).not.toContain('正式档案')
    expect(text).not.toContain('历史线索')
    expect(text).not.toContain('internal-only fact boundary')
    expect(invokeCommand).toHaveBeenCalledWith('get_session_index_status')
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', {
      request: {
        query: 'CVE-2024-3400',
        module: 'cve',
        limit: 20,
      },
    })
    expect(invokeCommand).toHaveBeenCalledWith('get_session_history_graph', {
      request: {
        query: 'CVE-2024-3400',
        module: 'cve',
        maxNodes: 120,
        maxEdges: 200,
      },
    })
  })

  it('emits an explicit confirmation before a result can be reused by a module', async () => {
    const confirmed: unknown[] = []
    const host = await mountPanel({
      confirmActionLabel: '记入笔记',
      onConfirmResult: (result: unknown) => confirmed.push(result),
    })

    expect(host.textContent).toContain('记入笔记')
    const action = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
      item.textContent?.includes('记入笔记'),
    )
    if (!action) throw new Error('missing confirm history action')

    expect(confirmed).toHaveLength(0)
    action.click()
    await settle()

    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]).toMatchObject({
      messageUuid: 'milksu:cve-1:assistant-1',
      sessionName: 'CVE-2024-3400 接力',
    })
  })

  it('refreshes the built-in index from the panel control', async () => {
    const host = await mountPanel({ module: 'coding', defaultQuery: 'Computer Use' })
    invokeCommand.mockClear()

    const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="刷新相关历史索引"]')
    refresh?.click()
    await settle()

    expect(invokeCommand).toHaveBeenCalledWith('refresh_session_index')
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', expect.anything())
    expect(invokeCommand).toHaveBeenCalledWith('get_session_history_graph', expect.anything())
  })

  it('shows a packaged-App empty state in browser preview', async () => {
    hasDesktopRuntime.mockReturnValue(false)
    const host = await mountPanel({ module: 'ctf', defaultQuery: 'Judge correct=true' })

    expect(host.textContent).toContain('打包 App 中可查看本机历史')
    expect(host.textContent).toContain('请在打包 App 中查看真实历史')
    expect(invokeCommand).not.toHaveBeenCalled()
  })

  it('keeps compact panels list-only and avoids loading the graph dependency', async () => {
    const host = await mountPanel({ compact: true })

    expect(host.textContent).not.toContain('图谱')
    expect(invokeCommand).not.toHaveBeenCalledWith('get_session_history_graph', expect.anything())
    expect(invokeCommand).toHaveBeenCalledWith('search_session_history', {
      request: {
        query: 'CVE-2024-3400',
        module: 'cve',
        limit: 4,
      },
    })
  })
})
