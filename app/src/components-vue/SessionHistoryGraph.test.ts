// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionHistoryGraphResponse } from '@/sessionIndexTypes'
import SessionHistoryGraph from './SessionHistoryGraph.vue'

const g6 = vi.hoisted(() => {
  const instances: MockGraph[] = []

  class MockGraph {
    options: Record<string, unknown>
    destroyed = false
    handlers = new Map<string, (event: { target: { id: string } }) => void>()
    render = vi.fn(async () => {})
    fitView = vi.fn(async () => {})
    zoomBy = vi.fn(async () => {})
    resize = vi.fn()
    setElementState = vi.fn(async () => {})
    destroy = vi.fn(() => {
      this.destroyed = true
    })

    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }

    on(event: string, handler: (event: { target: { id: string } }) => void) {
      this.handlers.set(event, handler)
    }

    trigger(event: string, id: string) {
      this.handlers.get(event)?.({ target: { id } })
    }
  }

  return { instances, MockGraph }
})

vi.mock('@antv/g6', () => ({
  Graph: g6.MockGraph,
  NodeEvent: { CLICK: 'node:click' },
}))

const mountedApps: App[] = []

const response: SessionHistoryGraphResponse = {
  generatedAt: '2026-08-09T12:00:00Z',
  status: {
    available: true,
    mode: 'milksu-obelisk-core',
    indexPath: '/tmp/obelisk.sqlite',
    checkedAt: '2026-08-09T12:00:00Z',
    readOnly: true,
    sessionCount: 1,
    messageCount: 4,
    toolCallCount: 1,
    memoryCount: 0,
    sources: [],
  },
  nodes: [
    {
      id: 'session:one',
      type: 'session',
      label: 'CVE-2024-3400 调研 OPENAI_API_KEY=sk-history-secret12345',
      detail: 'Coding · MilkSU',
      module: 'coding',
      project: 'MilkSU',
      timestamp: '2026-08-09T11:30:00Z',
      quote: '继续 CVE-2024-3400 调研 Bearer session-history-token-12345',
      sources: [{
        sessionId: 'milksu:conversation-1',
        conversationId: 'conversation-1',
        messageUuid: 'milksu:conversation-1:message-1',
        sessionName: 'CVE 调研 Bearer session-history-token-12345',
        timestamp: '2026-08-09T11:30:00Z',
      }],
    },
    {
      id: 'tool:read',
      type: 'tool',
      label: 'read',
      module: 'coding',
      project: 'MilkSU',
      quote: 'read',
      sources: [{
        sessionId: 'milksu:conversation-1',
        conversationId: 'conversation-1',
        sessionName: 'CVE 调研',
      }],
    },
  ],
  edges: [{
    id: 'edge:one',
    source: 'session:one',
    target: 'tool:read',
    type: 'calls',
  }],
  projects: ['MilkSU'],
  truncated: false,
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

async function mountGraph(
  nextResponse: SessionHistoryGraphResponse | null = response,
  props: Record<string, unknown> = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SessionHistoryGraph, {
    response: nextResponse,
    ...props,
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return { app, host }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  g6.instances.splice(0)
})

describe('SessionHistoryGraph', () => {
  it('uses bounded built-in G6 layout and behaviors without continuous animation', async () => {
    const { host } = await mountGraph()
    const instance = g6.instances[0]
    expect(instance).toBeDefined()
    expect(instance.options).toMatchObject({
      animation: false,
      zoomRange: [0.25, 3],
      layout: {
        type: 'antv-dagre',
        rankdir: 'LR',
        animation: false,
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      node: { animation: false },
      edge: { animation: false },
    })
    expect(instance.render).toHaveBeenCalledOnce()
    expect(instance.fitView).toHaveBeenCalledWith(
      { when: 'always', direction: 'both' },
      false,
    )

    const data = instance.options.data as { nodes: Array<{ style: { labelText: string } }> }
    expect(data.nodes[0].style.labelText).not.toContain('sk-history-secret12345')
    expect(JSON.stringify(instance.options)).not.toContain('sk-history-secret12345')
    expect(JSON.stringify(instance.options)).not.toContain('session-history-token-12345')
    expect(host.textContent).toContain('2 节点')
    expect(host.textContent).toContain('1 关系')
    expect(host.textContent).toContain('关系：调用')
  })

  it('selects a node, opens its source, and only quotes after explicit confirmation', async () => {
    const opened: string[] = []
    const confirmed: unknown[] = []
    const { host } = await mountGraph(response, {
      confirmActionLabel: '引用到输入',
      onOpenSession: (id: string) => opened.push(id),
      onConfirmNode: (node: unknown) => confirmed.push(node),
    })
    const instance = g6.instances[0]

    expect(confirmed).toHaveLength(0)
    instance.trigger('node:click', 'session:one')
    await settle()

    const text = host.textContent ?? ''
    expect(text).toContain('CVE-2024-3400 调研 OPENAI_API_KEY=[credential redacted]')
    expect(text).toContain('CVE 调研 Bearer [credential redacted]')
    expect(text).not.toContain('sk-history-secret12345')
    expect(text).not.toContain('session-history-token-12345')
    expect(instance.setElementState).toHaveBeenCalledWith('session:one', 'selected', false)

    const source = host.querySelector<HTMLButtonElement>('button[aria-label^="回到来源会话"]')
    source?.click()
    await settle()
    expect(opened).toEqual(['conversation-1'])

    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('引用到输入'))
    expect(confirm).toBeDefined()
    expect(confirmed).toHaveLength(0)
    confirm?.click()
    await settle()

    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]).toMatchObject({
      id: 'session:one',
      quote: '继续 CVE-2024-3400 调研 Bearer [credential redacted]',
    })
  })

  it('exposes zoom and fit controls and reports truncated or empty projections', async () => {
    const { host } = await mountGraph({ ...response, truncated: true })
    const instance = g6.instances[0]

    host.querySelector<HTMLButtonElement>('button[aria-label="缩小关系图"]')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="放大关系图"]')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="适应关系图视图"]')?.click()
    await settle()

    expect(instance.zoomBy).toHaveBeenNthCalledWith(1, 0.8, false)
    expect(instance.zoomBy).toHaveBeenNthCalledWith(2, 1.25, false)
    expect(instance.fitView).toHaveBeenLastCalledWith(
      { when: 'always', direction: 'both' },
      false,
    )
    expect(host.textContent).toContain('已按上限截断')
    expect(host.textContent).toContain('只显示最相关的一部分')

    mountedApps.pop()?.unmount()
    document.body.innerHTML = ''
    g6.instances.splice(0)
    const empty = await mountGraph({ ...response, nodes: [], edges: [], truncated: false })
    expect(empty.host.textContent).toContain('没有可关联的历史')
    expect(g6.instances).toHaveLength(0)
  })

  it('recreates the graph with the active light or dark application theme', async () => {
    document.documentElement.dataset.theme = 'light'
    await mountGraph()
    expect(g6.instances[0].options.theme).toBe('light')

    document.documentElement.dataset.theme = 'dark'
    await settle()
    expect(g6.instances).toHaveLength(2)
    expect(g6.instances[0].destroy).toHaveBeenCalledOnce()
    expect(g6.instances[1].options.theme).toBe('dark')
  })
})
