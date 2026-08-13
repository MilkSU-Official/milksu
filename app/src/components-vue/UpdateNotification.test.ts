// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import UpdateNotification from './UpdateNotification.vue'
import type { UpdateStatus } from '@/types'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mount(status: UpdateStatus, handlers: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(UpdateNotification, { status, ...handlers })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('UpdateNotification', () => {
  it('offers an available authenticated release without overloading the shell', async () => {
    const host = await mount({
      state: 'available',
      currentVersion: '0.1.0',
      enabled: true,
      version: '0.2.0',
      notes: '启动后自动检查新版本。\n其余说明在管理后台。',
    })
    expect(host.textContent).toContain('MilkSU 0.2.0 可以更新')
    expect(host.textContent).toContain('启动后自动检查新版本。')
    expect(host.textContent).not.toContain('其余说明在管理后台。')
    expect(host.querySelector('[data-shell-traffic-safe="x"]')).not.toBeNull()
  })

  it('emits download, dismiss and install actions', async () => {
    const actions: string[] = []
    const host = await mount({
      state: 'available', currentVersion: '0.1.0', enabled: true, version: '0.2.0',
    }, {
      onDownload: () => actions.push('download'),
      onDismiss: (version: string) => actions.push(`dismiss:${version}`),
    })
    ;[...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === '更新')?.click()
    host.querySelector<HTMLButtonElement>('button[aria-label="稍后更新"]')?.click()
    await nextTick()
    expect(actions).toEqual(['download', 'dismiss:0.2.0'])

    const installHost = await mount({
      state: 'downloaded', currentVersion: '0.1.0', enabled: true, version: '0.2.0',
    }, { onInstall: () => actions.push('install') })
    ;[...installHost.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('重启更新'))?.click()
    await nextTick()
    expect(actions.at(-1)).toBe('install')
  })

  it('stays hidden when idle or dismissed for this startup', async () => {
    const idle = await mount({ state: 'idle', currentVersion: '0.1.0', enabled: true })
    expect(idle.textContent?.trim()).toBe('')
    const dismissed = await mount({
      state: 'available', currentVersion: '0.1.0', enabled: true, version: '0.2.0',
    }, { dismissedVersion: '0.2.0' })
    expect(dismissed.textContent?.trim()).toBe('')
  })
})
