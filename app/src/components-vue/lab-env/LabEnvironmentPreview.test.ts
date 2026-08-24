// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import LabEnvironmentPreview from './LabEnvironmentPreview.vue'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    value: {
      invoke: () => Promise.resolve({ development: true }),
      onEvent: () => () => undefined,
    },
  })
})

const mounted: App[] = []

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountPreview() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(LabEnvironmentPreview)
  app.mount(host)
  mounted.push(app)
  await nextTick()
  return host
}

describe('LabEnvironmentPreview', () => {
  it('starts a lab package and shows the shared environment strip', async () => {
    const host = await mountPreview()
    expect(host.textContent).toContain('练习包')
    const juice = [...host.querySelectorAll('[data-testid="package-row"]')]
      .find(row => row.textContent?.includes('Juice Shop'))
    juice?.querySelector<HTMLButtonElement>('[data-testid="start-package"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="environment-strip"]')?.textContent).toContain('就绪')
    expect(host.querySelector('[data-testid="environment-address"]')?.textContent).toContain('127.0.0.1:3000')
    expect(host.querySelector('[data-testid="preview-dock"]')).not.toBeNull()
  })

  it('cites the same strip from a CVE dossier and expands to Coding', async () => {
    const host = await mountPreview()
    host.querySelector<HTMLButtonElement>('[aria-label="CVE"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="open-cve-ready"]')?.click()
    await nextTick()
    expect(host.textContent).toContain('CVE-2023-46604')
    expect(host.querySelector('[data-testid="environment-strip"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-start"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="expand-coding"]')?.click()
    await nextTick()
    expect(host.textContent).toContain('来自 CVE')
    expect(host.querySelector('[data-testid="coding-target-chip"]')?.textContent).toContain('127.0.0.1:3000')
    host.querySelector<HTMLButtonElement>('[data-testid="return-domain"]')?.click()
    await nextTick()
    expect(host.textContent).toContain('开始复现')
  })

  it('opens the live target beside the dossier so the user can watch the agent', async () => {
    const host = await mountPreview()
    host.querySelector<HTMLButtonElement>('[aria-label="CVE"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="open-cve-ready"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-start"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-open"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="target-surface"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="preview-dock"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('[data-testid="start-repro"]')?.click()
    await nextTick()
    expect(host.querySelector('[data-testid="agent-driving"]')?.textContent).toContain('Agent 正在点')
  })

  it('keeps a CVE without a package on the dossier', async () => {
    const host = await mountPreview()
    host.querySelector<HTMLButtonElement>('[aria-label="CVE"]')?.click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="open-cve-none"]')?.click()
    await nextTick()
    expect(host.textContent).toContain('没有练习包')
    expect(host.querySelector('[data-testid="environment-start"]')).toBeNull()
  })
})
