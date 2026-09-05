// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import UpdateInstallDialog from './UpdateInstallDialog.vue'
import ContextSidebar from './ContextSidebar.vue'
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

const sidebarProps = {
  activeSection: 'chat' as const,
  activeConversationId: null,
  conversations: [],
  accountStatus: { configured: true, authenticated: true, state: 'active' as const },
  ctfSection: 'catalog' as const,
  themeMode: 'dark' as const,
  collapsed: false,
}

describe('sidebar update control', () => {
  it('shows a download button when a matching release is available', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const actions: string[] = []
    const app = createApp(ContextSidebar, {
      ...sidebarProps,
      updateStatus: {
        state: 'available',
        currentVersion: '0.1.0',
        enabled: true,
        version: '0.2.0',
      } satisfies UpdateStatus,
      onDownloadUpdate: () => actions.push('download'),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    const button = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-download-update"]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toContain('下载更新')
    button?.click()
    expect(actions).toEqual(['download'])
  })

  it('keeps a retry control visible when download fails', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const actions: string[] = []
    const app = createApp(ContextSidebar, {
      ...sidebarProps,
      updateStatus: {
        state: 'error',
        currentVersion: '0.1.0',
        enabled: true,
        version: '0.2.0',
        code: 'download_failed',
        message: '更新下载失败，请稍后重试',
      } satisfies UpdateStatus,
      onDownloadUpdate: () => actions.push('retry'),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    const button = host.querySelector<HTMLButtonElement>('[data-testid="sidebar-download-update"]')
    expect(button?.getAttribute('aria-label')).toContain('重试下载')
    expect(button?.getAttribute('title')).toContain('更新下载失败')
    button?.click()
    expect(actions).toEqual(['retry'])
  })

  it('asks before installing when the downloaded update dialog is shown', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const actions: string[] = []
    const app = createApp(UpdateInstallDialog, {
      open: true,
      version: '0.2.0',
      onConfirm: () => actions.push('confirm'),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(document.body.textContent).toContain('安装更新并重启')
    expect(document.body.textContent).toContain('MilkSU 0.2.0')
    ;[...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('安装并重启'))?.click()
    expect(actions).toEqual(['confirm'])
  })
})
