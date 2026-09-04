// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ContextUsageMeter from './ContextUsageMeter.vue'
import meterSource from './ContextUsageMeter.vue?raw'
import {
  applySessionContextComposition,
  applySessionContextWindow,
  applySessionUsageRecorded,
  emptySessionTurnSnapshot,
  presentContextUsage,
  type ContextUsagePresentation,
} from '@/lib/sessionTurnStatus'
import { applyUiLocale } from '@/lib/uiLocale'

const mountedApps: App[] = []

afterEach(() => {
  applyUiLocale('zh')
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function billedUsage(): ContextUsagePresentation {
  let state = applySessionContextWindow(emptySessionTurnSnapshot(), 128_000)
  state = applySessionUsageRecorded(state, {
    inputTokens: 10_200,
    outputTokens: 1800,
    cacheReadTokens: 0,
    totalTokens: 12_000,
  })
  const presented = presentContextUsage(state)
  if (!presented) throw new Error('missing billed presentation')
  return presented
}

function categoryUsage(): ContextUsagePresentation {
  let state = applySessionContextWindow(emptySessionTurnSnapshot(), 1_000_000)
  state = applySessionUsageRecorded(state, {
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 80,
    totalTokens: 240,
  })
  state = applySessionContextComposition(state, {
    estimatedTokens: 35_700,
    contextWindow: 1_000_000,
    categories: [
      { id: 'system', tokens: 12_400 },
      { id: 'tools', tokens: 8_100 },
      { id: 'conversation', tokens: 15_200 },
    ],
  })
  const presented = presentContextUsage(state)
  if (!presented) throw new Error('missing category presentation')
  return presented
}

async function mountMeter(usage: ContextUsagePresentation) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ContextUsageMeter, { usage })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

async function openPanel(host: HTMLElement) {
  host.querySelector<HTMLButtonElement>('[data-testid="context-usage-meter"]')?.click()
  await nextTick()
  return document.body.querySelector<HTMLElement>('[data-testid="context-usage-panel"]')
}

describe('ContextUsageMeter', () => {
  it('renders category rows from composition mock data', async () => {
    const host = await mountMeter(categoryUsage())
    expect(host.querySelector('[data-testid="context-usage-meter"]')?.textContent).toContain('4%')
    const panel = await openPanel(host)
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('上下文用量')
    expect(panel?.textContent).toContain('4% 已用')
    expect(panel?.textContent).toContain('~35.7K / 1M')
    const rows = [...(panel?.querySelectorAll('[data-testid="context-usage-category"]') ?? [])]
    expect(rows.map(row => row.getAttribute('data-category'))).toEqual([
      'system',
      'tools',
      'conversation',
    ])
    expect(panel?.textContent).toContain('系统提示')
    expect(panel?.textContent).toContain('12.4K')
    expect(panel?.textContent).toContain('本轮计费')
    expect(panel?.textContent).not.toContain('文件')
    expect(panel?.textContent).not.toContain('搜索')
    panel?.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click()
    await nextTick()
    expect(document.body.querySelector('[data-testid="context-usage-panel"]')?.getAttribute('data-state')).toBe('closed')
  })

  it('keeps a billed-only session usable without categories', async () => {
    const host = await mountMeter(billedUsage())
    const panel = await openPanel(host)
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('8% 已用')
    expect(panel?.querySelector('[data-testid="context-usage-category"]')).toBeNull()
    expect(panel?.textContent).toContain('本轮计费')
    expect(panel?.textContent).toContain('未命中输入')
  })

  it('pairs Chinese chrome with English keys', async () => {
    const pairs = [...meterSource.matchAll(/t\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)]
    expect(pairs.map(([, zh, en]) => [zh, en])).toEqual([
      ['整理中', 'Compacting'],
      ['上下文用量', 'Context Usage'],
      ['关闭', 'Close'],
      ['整理中', 'Compacting'],
      ['整理中', 'Compacting'],
      ['本轮计费', 'Billed this turn'],
      ['未命中输入', 'Uncached input'],
      ['缓存命中', 'Cache hits'],
    ])
    applyUiLocale('en')
    const host = await mountMeter(categoryUsage())
    const panel = await openPanel(host)
    expect(panel?.textContent).toContain('Context Usage')
    expect(panel?.textContent).toContain('4% Full')
    expect(panel?.textContent).toContain('System prompt')
    expect(panel?.textContent).toContain('Billed this turn')
  })
})
