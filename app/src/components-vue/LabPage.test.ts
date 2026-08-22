// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import LabPage from './LabPage.vue'

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

describe('LabPage', () => {
  it('uses the laboratory name and a new-job entry without authorization copy', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage)
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.textContent).toContain('实验室')
    expect(host.textContent).toContain('新作业')
    expect(host.textContent).not.toContain('授权测试')
    expect(host.textContent).not.toContain('授权靶')
  })

  it('starts a local job from a request instead of protocol and address fields', async () => {
    const runs: unknown[][] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(LabPage, {
      onRun: (...args: unknown[]) => runs.push(args),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const newJob = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('新作业'))
    newJob?.click()
    await nextTick()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.querySelector('[aria-label="地址"]')).toBeNull()
    expect(dialog!.querySelector('[aria-label="范围"]')).not.toBeNull()
    const request = dialog!.querySelector<HTMLTextAreaElement>('[aria-label="要求"]')!
    request.value = '扫一下本机进程'
    request.dispatchEvent(new Event('input', { bubbles: true }))
    dialog!.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(runs).toHaveLength(1)
    expect((runs[0][0] as { scope: string; request: string }).scope).toBe('local')
    expect((runs[0][0] as { request: string }).request).toBe('扫一下本机进程')
    expect(host.textContent).toContain('扫一下本机进程')
    expect(host.textContent).toContain('本地')
    expect(host.querySelector('[data-testid="research-report"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="conversation-dock"]')).not.toBeNull()
    expect(host.textContent).not.toContain('复现成功')
    expect(host.textContent).not.toContain('HTTP')
  })
})
