// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import TargetLivePane from './TargetLivePane.vue'
import type { EnvLease } from '@/envbroker'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
})

const mounted: App[] = []

afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function mountLease(lease: EnvLease) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TargetLivePane, { lease })
  app.mount(host)
  mounted.push(app)
  return host
}

describe('TargetLivePane', () => {
  it('treats the emulator surface as an adb target', async () => {
    const host = mountLease({
      ownerKind: 'lab',
      ownerId: 'job-1',
      provider: 'android-avd',
      surface: 'emulator',
      state: 'ready',
      address: 'emulator-5554',
      packageName: 'InjuredAndroid',
    })
    await nextTick()
    expect(host.textContent).toContain('emulator-5554')
    expect(host.textContent).toContain('adb')
    expect(host.textContent).not.toContain('Computer Use')
    expect(host.querySelector('[data-testid="attach-computer-use"]')).toBeNull()
  })
})
