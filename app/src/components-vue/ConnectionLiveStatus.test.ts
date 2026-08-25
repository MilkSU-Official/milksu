// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConnectionLiveStatus from './ConnectionLiveStatus.vue'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountChip(props: { live: boolean, decorative?: boolean }) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ConnectionLiveStatus, props)
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('ConnectionLiveStatus', () => {
  it('renders LIVE as a status chip, not a button', async () => {
    const host = await mountChip({ live: true })
    const chip = host.querySelector('[data-connection-live]')
    expect(chip).not.toBeNull()
    expect(chip?.tagName).toBe('SPAN')
    expect(chip?.getAttribute('data-connection-live')).toBe('live')
    expect(chip?.getAttribute('role')).toBe('status')
    expect(chip?.getAttribute('aria-label')).toBe('已连接')
    expect(chip?.className).toContain('ak-status')
    expect(chip?.className).toContain('ak-status--compact')
    expect(chip?.className).not.toContain('ak-status--offline')
    expect(chip?.textContent).toContain('LIVE')
    expect(host.querySelector('button')).toBeNull()
  })

  it('renders OFF when disconnected', async () => {
    const host = await mountChip({ live: false })
    const chip = host.querySelector('[data-connection-live]')
    expect(chip?.getAttribute('data-connection-live')).toBe('off')
    expect(chip?.getAttribute('aria-label')).toBe('未连接')
    expect(chip?.className).toContain('ak-status--offline')
    expect(chip?.textContent).toContain('OFF')
  })

  it('hides the chip from assistive text when it sits inside a labeled chrome button', async () => {
    const host = await mountChip({ live: true, decorative: true })
    const chip = host.querySelector('[data-connection-live]')
    expect(chip?.getAttribute('aria-hidden')).toBe('true')
    expect(chip?.getAttribute('role')).toBeNull()
    expect(chip?.getAttribute('aria-label')).toBeNull()
  })
})
