// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import StartupRecoveryBanner from './StartupRecoveryBanner.vue'
import type { StartupRecoveryStatus } from '@/types'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

const mountedApps: App[] = []

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountBanner(status: StartupRecoveryStatus | null) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(StartupRecoveryBanner, { status })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

const abnormalStatus: StartupRecoveryStatus = {
  previousExit: 'abnormal',
  previousStartedAt: '2026-08-03T04:00:00Z',
  consecutiveAbnormalExits: 2,
  previousPid: 4242,
  startedAt: '2026-08-03T05:00:00Z',
}

describe('StartupRecoveryBanner', () => {
  it('renders recovery entry after an abnormal exit', async () => {
    const host = await mountBanner(abnormalStatus)
    const text = host.textContent ?? ''
    expect(text).toContain('上次 MilkSU 未正常退出')
    expect(text).toContain('连续 2 次')
    expect(text).toContain('上次启动于')
    expect(text).toContain('查看恢复与诊断')
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.some(button => button.getAttribute('aria-label') === '知道了')).toBe(true)
    const banner = host.querySelector('[data-testid="startup-recovery-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.className).toContain('shell-traffic-light-safe-x')
    expect(banner?.getAttribute('data-shell-traffic-safe')).toBe('x')
    // Full-width top chrome must inset left for traffic lights; no vertical hole class.
    expect(banner?.className).not.toContain('workspace-rail-traffic-safe')
  })

  it('renders nothing for a clean exit or first run', async () => {
    const clean: StartupRecoveryStatus = {
      previousExit: 'clean',
      lastCleanExitAt: '2026-08-03T03:00:00Z',
      consecutiveAbnormalExits: 0,
      startedAt: '2026-08-03T05:00:00Z',
    }
    const firstRun: StartupRecoveryStatus = {
      previousExit: 'none',
      consecutiveAbnormalExits: 0,
      startedAt: '2026-08-03T05:00:00Z',
    }
    for (const status of [clean, firstRun, null]) {
      const host = await mountBanner(status)
      expect(host.textContent?.trim() ?? '').toBe('')
      host.remove()
    }
  })

  it('emits dismiss and openRecovery actions', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const dismissed: unknown[] = []
    const opened: unknown[] = []
    const app = createApp(StartupRecoveryBanner, {
      status: abnormalStatus,
      onDismiss: () => dismissed.push(true),
      onOpenRecovery: () => opened.push(true),
    })
    app.mount(host)
    mountedApps.push(app)
    await settle()

    const buttons = [...host.querySelectorAll('button')]
    const dismissButton = buttons.find(button => button.getAttribute('aria-label') === '知道了')
    const recoveryButton = buttons.find(button => button.textContent?.includes('查看恢复与诊断'))
    expect(dismissButton).toBeDefined()
    expect(recoveryButton).toBeDefined()

    dismissButton!.click()
    recoveryButton!.click()
    await settle()
    expect(dismissed).toEqual([true])
    expect(opened).toEqual([true])
  })
})
