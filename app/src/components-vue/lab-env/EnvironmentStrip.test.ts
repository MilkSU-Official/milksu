// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import EnvironmentStrip from './EnvironmentStrip.vue'
import type { EnvironmentLease } from './environmentTypes'

const mounted: App[] = []

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function mountLease(lease: EnvironmentLease) {
  const host = document.createElement('div')
  document.body.append(host)
  const events: string[] = []
  const app = createApp(EnvironmentStrip, {
    lease,
    onStart: () => events.push('start'),
    onOpenTarget: () => events.push('open'),
    onStop: () => events.push('stop'),
    onRetry: () => events.push('retry'),
    onOpenDocker: () => events.push('docker'),
    onOccupyGo: () => events.push('occupyGo'),
    onOccupyStop: () => events.push('occupyStop'),
    onOpenLabSettings: () => events.push('openLabSettings'),
  })
  app.mount(host)
  mounted.push(app)
  return { host, events }
}

describe('EnvironmentStrip', () => {
  it('shows a start action when the package is stopped', async () => {
    const { host, events } = mountLease({
      provider: 'docker',
      state: 'stopped',
      packageName: 'OWASP Juice Shop',
    })
    await nextTick()
    expect(host.textContent).toContain('已停止')
    host.querySelector<HTMLButtonElement>('[data-testid="environment-start"]')?.click()
    expect(events).toEqual(['start'])
  })

  it('shows the live address when ready', async () => {
    const { host, events } = mountLease({
      provider: 'docker',
      state: 'ready',
      packageName: 'OWASP Juice Shop',
      address: '127.0.0.1:3000',
    })
    await nextTick()
    expect(host.querySelector('[data-testid="environment-address"]')?.textContent).toContain('127.0.0.1:3000')
    host.querySelector<HTMLButtonElement>('[data-testid="environment-open"]')?.click()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-stop"]')?.click()
    expect(events).toEqual(['open', 'stop'])
  })

  it('treats a missing package as a quiet empty state', async () => {
    const { host } = mountLease({ provider: 'none', state: 'none', detail: '没有匹配的练习包。' })
    await nextTick()
    expect(host.textContent).toContain('没有练习包')
    expect(host.querySelector('[data-testid="environment-start"]')).toBeNull()
  })

  it('sends failed Android leases to Lab settings instead of a raw tool path', async () => {
    const { host, events } = mountLease({
      provider: 'avd',
      state: 'failed',
      packageName: 'InjuredAndroid',
      detail: '创建 MilkSU-Lab 失败: 本机没有可用的 Java。请安装 Android Studio，然后在设置 → Lab 点重新检测',
    })
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-lab-settings"]')?.click()
    expect(events).toEqual(['openLabSettings'])
  })

  it('offers Docker Desktop when the engine is down', async () => {
    const { host, events } = mountLease({
      provider: 'docker',
      state: 'docker-down',
      packageName: 'OWASP Juice Shop',
      detail: 'Docker 未运行',
    })
    await nextTick()
    expect(host.textContent).toContain('Docker 未运行')
    host.querySelector<HTMLButtonElement>('[data-testid="environment-open-docker"]')?.click()
    expect(events).toEqual(['docker'])
  })

  it('lets a busy lease jump to the occupying job or stop it', async () => {
    const { host, events } = mountLease({
      provider: 'docker',
      state: 'busy',
      packageName: 'OWASP Juice Shop',
      occupyJobTitle: 'CVE-2017-5638',
      occupyOwner: 'cve:CVE-2017-5638',
    })
    await nextTick()
    expect(host.textContent).toContain('CVE-2017-5638')
    host.querySelector<HTMLButtonElement>('[data-testid="environment-occupy-go"]')?.click()
    host.querySelector<HTMLButtonElement>('[data-testid="environment-occupy-stop"]')?.click()
    expect(events).toEqual(['occupyGo', 'occupyStop'])
  })

  it('lets a bound but never started package start', async () => {
    const { host, events } = mountLease({
      provider: 'docker',
      state: 'none',
      packageName: 'OWASP Juice Shop',
    })
    await nextTick()
    expect(host.textContent).toContain('未启动')
    host.querySelector<HTMLButtonElement>('[data-testid="environment-start"]')?.click()
    expect(events).toEqual(['start'])
  })
})
