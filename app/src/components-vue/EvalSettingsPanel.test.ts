// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EvalSettingsPanel from './EvalSettingsPanel.vue'
import { installAppModelSettings, installModelCatalog } from '@/modelCatalog'
import { withAppSettingsDefaults, type AppSettings } from '@/types'
import type { EvalBoardSnapshot } from '@/evalTypes'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
HTMLElement.prototype.hasPointerCapture = () => false
HTMLElement.prototype.setPointerCapture = () => undefined
HTMLElement.prototype.releasePointerCapture = () => undefined
HTMLElement.prototype.scrollIntoView = () => undefined

const mounted: App[] = []

const suites = [
  { id: 'cybench', name: 'Cybench', purpose: 'CTF 题', runnable: true, taskN: 1 },
  { id: 'sec-bench', name: 'SEC-bench', purpose: '已知洞复现', runnable: true, taskN: 1 },
  { id: 'autopen', name: 'AutoPenBench', purpose: '授权渗透', runnable: true, taskN: 1 },
] as const

const emptyModels = [
  { model: { provider: 'tokenflux', model: 'grok-4.5' }, score: null, rank: null, solved: null, total: 1 },
]

const emptyBoard: EvalBoardSnapshot = {
  suites: [...suites],
  selected: 'cybench',
  models: emptyModels,
  all: suites.map(suite => ({ suite, models: emptyModels })),
}

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'milksu')
  try {
    localStorage?.removeItem('milksu.eval.selected-suite')
    localStorage?.removeItem('milksu.eval.suite-models')
  } catch {
    // jsdom may not expose localStorage
  }
})

async function mountPanel(board: EvalBoardSnapshot, start = vi.fn(async (..._args: unknown[]) => board)) {
  installModelCatalog({
    provider: 'tokenflux',
    source: 'remote',
    credential_source: 'account',
    refreshed_at: '2026-08-23T00:00:00Z',
    models: [{ id: 'grok-4.5', name: 'Grok 4.5', context_window: 500000, max_tokens: 32768, input: ['text'] }],
    account_model_ids: ['grok-4.5'],
  })
  const settings = withAppSettingsDefaults({
    active_model: 'grok-4.5',
    relay: { enabled: true, has_key: true, url: 'https://tokenflux.dev/v1' },
  } as AppSettings)
  installAppModelSettings(settings)
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    value: {
      invoke(method: string, args?: unknown) {
        const payload = Array.isArray(args) ? args[0] : args
        if (method === 'GetEvalBoard') return Promise.resolve(board)
        if (method === 'StartEvalRun') return start(payload)
        if (method === 'StopEvalRun') return Promise.resolve(board)
        return Promise.reject(new Error(method))
      },
      onEvent() {
        return () => undefined
      },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(EvalSettingsPanel, { settings })
  app.mount(host)
  mounted.push(app)
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await Promise.resolve()
  await nextTick()
  return { start }
}

describe('EvalSettingsPanel', () => {
  it('shows a suite switcher with one start control', async () => {
    await mountPanel(emptyBoard)
    expect(document.body.textContent).toContain('Cybench')
    expect(document.body.textContent).toContain('SEC-bench')
    expect(document.body.textContent).toContain('AutoPenBench')
    expect(document.body.textContent?.match(/开始评测/g)?.length).toBe(1)
    expect(document.body.textContent?.match(/全部测一遍/g)?.length).toBe(1)
    expect(document.body.textContent).not.toContain('打开作业')
    expect(document.body.textContent).not.toContain('本地目录')
  })

  it('draws a difficulty point when a suite only has one solved task', async () => {
    const scored = {
      model: { provider: 'tokenflux', model: 'grok-4.5' },
      score: 100,
      rank: 1,
      solved: 1,
      total: 1,
      curve: [100],
    }
    await mountPanel({
      suites: [...suites],
      selected: 'cybench',
      models: [scored],
      all: [
        { suite: suites[0], models: [scored] },
        { suite: suites[1], models: emptyModels },
        { suite: suites[2], models: emptyModels },
      ],
    })
    expect(document.querySelectorAll('figure[aria-label="Cybench 难度曲线"] circle').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('figure[aria-label="SEC-bench 难度曲线"]').length).toBe(0)
  })

  it('shows live activity without a fake score while running', async () => {
    await mountPanel({
      ...emptyBoard,
      progress: {
        state: 'running',
        suite: 'cybench',
        model: { provider: 'tokenflux', model: 'grok-4.5' },
        all: false,
        percent: 20,
        elapsedMs: 84000,
        remainMs: 30000,
        taskName: 'Dynastic',
        taskIndex: 1,
        taskTotal: 1,
        summary: '读取 source.py',
        steps: [{ id: '1', tool: 'read', summary: '读取 source.py', running: true }],
      },
    })
    expect(document.body.textContent).toContain('读取 source.py')
    expect(document.body.textContent).toContain('1:24')
    expect(document.body.textContent).not.toContain('打开作业')
    expect(document.body.textContent).not.toContain('本地目录')
  })

  it('starts the suite selected in the switcher', async () => {
    const start = vi.fn(async (args: unknown) => ({
      ...emptyBoard,
      progress: {
        state: 'running' as const,
        suite: (args as { suite: string }).suite,
        model: { provider: 'tokenflux', model: 'grok-4.5' },
        all: false,
        percent: 4,
        elapsedMs: 0,
        summary: '正在开始',
      },
    }))
    await mountPanel(emptyBoard, start)
    const suiteButton = [...document.body.querySelectorAll('button')].find(button => (
      button.textContent?.includes('SEC-bench')
    ))
    suiteButton?.click()
    await nextTick()
    const startButton = [...document.body.querySelectorAll('button')].find(button => (
      button.textContent?.includes('开始评测') && !(button as HTMLButtonElement).disabled
    ))
    startButton?.click()
    await Promise.resolve()
    await nextTick()
    expect(start).toHaveBeenCalled()
    expect(start.mock.calls[0]?.[0]).toMatchObject({ suite: 'sec-bench' })
  })
})
