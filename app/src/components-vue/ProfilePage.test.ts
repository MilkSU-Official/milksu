// @vitest-environment jsdom

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage.vue'
import type { AccountStatus } from '@/types'

const stored = new Map<string, string>()
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  },
})

async function settle() {
  await nextTick()
  await new Promise(resolve => window.setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  delete (window as unknown as { go?: unknown }).go
})

describe('ProfilePage', () => {
  it('refreshes the account balance together with local growth records', async () => {
    const refreshed: AccountStatus = {
      configured: true,
      authenticated: true,
      state: 'active',
      user: { githubLogin: 'hunter', displayName: 'Hunter', avatarUrl: '' },
      balanceCents: 2500,
    }
    const invoke = vi.fn(async (method: string) => {
      if (method === 'ListCTFJobs' || method === 'ListVulnJobs') return []
      if (method === 'GetAccountStatus') return refreshed
      throw new Error(`unexpected method: ${method}`)
    })
    ;(window as unknown as { go: { main: { App: Record<string, () => Promise<unknown>> } } }).go = {
      main: {
        App: {
          ListCTFJobs: () => invoke('ListCTFJobs'),
          ListVulnJobs: () => invoke('ListVulnJobs'),
          GetAccountStatus: () => invoke('GetAccountStatus'),
        },
      },
    }
    const onAccountStatusChange = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ProfilePage, {
      accountStatus: { ...refreshed, balanceCents: 1000 },
      conversations: [],
      onAccountStatusChange,
    })
    app.mount(host)
    await settle()

    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('刷新'))
    refresh?.click()
    await settle()

    expect(onAccountStatusChange).toHaveBeenCalledWith(refreshed)
    expect(invoke).toHaveBeenCalledWith('GetAccountStatus')
    app.unmount()
  })
})
