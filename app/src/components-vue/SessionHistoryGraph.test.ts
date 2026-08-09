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
    destroy = vi.fn(() => { this.destroyed = true })
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
  generatedAt: '2026-08-10T12:00:00Z',
  title: 'MilkSU 自举能力脉络',
  summary: '以隔离执行、Computer Use 验收和人类监督形成闭环。',
  provider: 'tokenflux',
  model: 'grok-4.5',
  status: {
    available: true, mode: 'milksu-obelisk-core', indexPath: '/tmp/obelisk.sqlite',
    checkedAt: '2026-08-10T12:00:00Z', readOnly: true, sessionCount: 3,
    messageCount: 12, toolCallCount: 4, memoryCount: 1, sources: [],
  },
  clusters: [
    { id: 'boundary', label: '安全边界' },
    { id: 'validation', label: '验收闭环' },
  ],
  nodes: [{
    id: 'semantic-1', type: 'capability', label: '双 App 自举',
    summary: '正式 App 驱动隔离的 MilkSU Beta。', cluster: 'boundary', importance: 5,
    status: 'planned', inferred: true,
    sources: [{
      kind: 'conversation', sessionId: 'milksu:s1', conversationId: 's1', messageUuid: 'm1',
      sessionName: '自举设计 Bearer source-secret-12345', timestamp: '2026-08-10T11:00:00Z',
      excerpt: '正式 App 与 Beta 使用不同 Bundle ID；OPENAI_API_KEY=sk-source-secret12345',
    }],
  }, {
    id: 'semantic-2', type: 'evidence', label: 'Computer Use 可见验收',
    summary: '通过真实界面交互证明能力。', cluster: 'validation', importance: 4,
    status: 'current', inferred: true,
    sources: [{
      kind: 'formal-evidence', sessionName: '验收回执', timestamp: '2026-08-10T11:30:00Z',
      excerpt: '已观察并点击 Beta 窗口。',
    }],
  }],
  edges: [{
    id: 'relation-1', source: 'semantic-2', target: 'semantic-1', type: 'validates',
    rationale: '可见交互验证自举闭环', confidence: 0.86, inferred: true,
  }],
  projects: ['milksu'], truncated: false,
  factBoundary: '仅供人阅读',
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

async function mountGraph(nextResponse: SessionHistoryGraphResponse | null = response, props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SessionHistoryGraph, { response: nextResponse, ...props })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  g6.instances.splice(0)
})

describe('SessionHistoryGraph', () => {
  it('renders a bounded human semantic graph with cards and semantic relations', async () => {
    const host = await mountGraph()
    const instance = g6.instances[0]
    expect(instance.options).toMatchObject({
      animation: false,
      zoomRange: [0.35, 2.5],
      layout: { type: 'antv-dagre', rankdir: 'LR', animation: false },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      node: { type: 'rect', animation: false },
      edge: { type: 'cubic-horizontal', animation: false },
    })
    const data = instance.options.data as {
      nodes: Array<{ style: { size: number[]; labelText: string } }>
      edges: Array<{ style: { labelText: string } }>
    }
    expect(data.nodes[0].style.size[0]).toBeGreaterThan(150)
    expect(data.edges[0].style.labelText).toBe('验证')
    expect(host.textContent).toContain('模型语义归纳')
    expect(host.textContent).toContain('MilkSU 自举能力脉络')
    expect(host.textContent).toContain('tokenflux · grok-4.5')
    expect(host.textContent).toContain('仅供人阅读')
    expect(JSON.stringify(instance.options)).not.toContain('bash')
  })

  it('opens traceable human sources and redacts credentials without feeding the model', async () => {
    const opened: string[] = []
    const host = await mountGraph(response, { onOpenSession: (id: string) => opened.push(id) })
    const instance = g6.instances[0]
    instance.trigger('node:click', 'semantic-1')
    await settle()

    expect(host.textContent).toContain('双 App 自举')
    expect(host.textContent).toContain('正式 App 驱动隔离的 MilkSU Beta')
    expect(host.textContent).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(host.textContent).toContain('Bearer [credential redacted]')
    expect(host.textContent).not.toContain('sk-source-secret12345')
    expect(host.textContent).not.toContain('source-secret-12345')
    expect(host.textContent).not.toContain('确认引用')

    host.querySelector<HTMLButtonElement>('button[aria-label^="回到来源会话"]')?.click()
    await settle()
    expect(opened).toEqual(['s1'])
  })

  it('shows semantic rationale when a connected node is selected', async () => {
    const host = await mountGraph()
    g6.instances[0].trigger('node:click', 'semantic-2')
    await settle()
    expect(host.textContent).toContain('验证 双 App 自举')
    expect(host.textContent).toContain('可见交互验证自举闭环')
    expect(host.textContent).toContain('正式证据')
  })

  it('supports regenerate, zoom and fit controls', async () => {
    const regenerated: number[] = []
    const host = await mountGraph(response, { onRegenerate: () => regenerated.push(1) })
    const instance = g6.instances[0]
    host.querySelector<HTMLButtonElement>('button[aria-label="重新生成语义图谱"]')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="缩小语义图谱"]')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="放大语义图谱"]')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="适应语义图谱视图"]')?.click()
    await settle()
    expect(regenerated).toHaveLength(1)
    expect(instance.zoomBy).toHaveBeenNthCalledWith(1, 0.8, false)
    expect(instance.zoomBy).toHaveBeenNthCalledWith(2, 1.25, false)
    expect(instance.fitView).toHaveBeenLastCalledWith({ when: 'always', direction: 'both' }, false)
  })

  it('shows generation and empty states without constructing G6', async () => {
    let host = await mountGraph(null, { loading: true })
    expect(host.textContent).toContain('正在归纳历史脉络')
    expect(g6.instances).toHaveLength(0)

    mountedApps.pop()?.unmount()
    document.body.innerHTML = ''
    host = await mountGraph({ ...response, nodes: [], edges: [] })
    expect(host.textContent).toContain('没有足够的历史记忆')
    expect(g6.instances).toHaveLength(0)
  })

  it('recreates the graph for the active application theme', async () => {
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
