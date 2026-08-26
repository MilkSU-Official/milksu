// @vitest-environment jsdom

import { createApp, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage.vue'
import { EMPTY_CODING_USAGE, type CodingUsageSnapshot } from '@/modelUsageTypes'
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

const account: AccountStatus = {
  configured: true,
  authenticated: true,
  state: 'active',
  user: { githubLogin: 'hunter', displayName: 'Hunter', avatarUrl: '' },
}

async function settle() {
  await nextTick()
  await new Promise(resolve => window.setTimeout(resolve, 0))
  await nextTick()
}

function installDesktop(invoke: (method: string, args: unknown[]) => Promise<unknown>) {
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    value: { invoke, onEvent: vi.fn(() => () => undefined) },
  })
}

function mountProfile(props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ProfilePage, {
    accountStatus: account,
    conversations: [],
    vulnerabilities: [],
    ...props,
  })
  app.mount(host)
  return { app, host }
}

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'milksu')
})

describe('ProfilePage', () => {
  it('refreshes the account status together with local growth records', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'ListCTFJobs') return []
      if (method === 'GetCodingUsageSnapshot') return { ...EMPTY_CODING_USAGE }
      if (method === 'GetAccountStatus') return account
      throw new Error(`unexpected method: ${method}`)
    })
    installDesktop(invoke)
    const onAccountStatusChange = vi.fn()
    const { app, host } = mountProfile({ onAccountStatusChange })
    await settle()

    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('刷新'))
    refresh?.click()
    await settle()

    expect(onAccountStatusChange).toHaveBeenCalledWith(account)
    expect(invoke).toHaveBeenCalledWith('GetAccountStatus', [])
    app.unmount()
  })

  it('does not save the profile while an IME confirms a candidate with Enter', async () => {
    const invoke = vi.fn(async (method: string) => {
      if (method === 'ListCTFJobs') return []
      if (method === 'GetCodingUsageSnapshot') return { ...EMPTY_CODING_USAGE }
      if (method === 'GetAccountStatus') return account
      throw new Error(`unexpected method: ${method}`)
    })
    installDesktop(invoke)
    const { app, host } = mountProfile()
    await settle()

    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('编辑资料'))
    edit?.click()
    await settle()

    const bio = host.querySelector<HTMLInputElement>('[aria-label="个人介绍"]')
    expect(bio).not.toBeNull()
    bio!.value = '正在组字'
    bio!.dispatchEvent(new Event('input', { bubbles: true }))
    bio!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    await settle()

    // Still editing: the candidate confirmation must not close the form or persist.
    expect(host.querySelector('[aria-label="个人介绍"]')).not.toBeNull()
    expect(window.localStorage.getItem('milksu.profile.bio')).toBeNull()

    bio!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(host.querySelector('[aria-label="个人介绍"]')).toBeNull()
    expect(window.localStorage.getItem('milksu.profile.bio')).toBe('正在组字')
    app.unmount()
  })

  it('shows only recorded Coding usage and switches the shared panel between three modules', async () => {
    const usage: CodingUsageSnapshot = {
      ...EMPTY_CODING_USAGE,
      from: '2025-08-15',
      to: '2026-08-14',
      activeDays: 1,
      modelCalls: 1,
      toolCalls: 1,
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      days: [{
        date: '2026-08-14', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0,
        cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 1500, costUsd: 0,
        modelCalls: 1, toolCalls: 1,
        models: [{
          provider: 'tokenflux', model: 'gpt-5.6-codex', source: 'account', inputTokens: 1200,
          outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
          totalTokens: 1500, costUsd: 0, calls: 1,
        }],
        tools: [{ name: 'exec_command', calls: 1, failures: 0, durationMs: 820 }],
      }],
    }
    const invoke = vi.fn(async (method: string) => {
      if (method === 'ListCTFJobs') return []
      if (method === 'GetCodingUsageSnapshot') return usage
      throw new Error(`unexpected method: ${method}`)
    })
    installDesktop(invoke)
    const { app, host } = mountProfile()
    await settle()

    expect(host.textContent).toContain('Coding 活动与用量')
    expect(host.textContent).toContain('1,500 Token')
    expect(host.textContent).toContain('exec_command')
    expect(host.querySelector('.profile-command-panel')).not.toBeNull()

    const ctfTab = host.querySelector<HTMLButtonElement>('#profile-tab-ctf')
    ctfTab?.click()
    await settle()
    expect(host.textContent).toContain('CTF 练习与验证')
    expect(host.textContent).not.toContain('还没有 CTF 练习记录')

    const vulnTab = host.querySelector<HTMLButtonElement>('#profile-tab-vuln')
    vulnTab?.click()
    await settle()
    expect(host.textContent).toContain('CVE 研究与来源')
    expect(host.textContent).not.toContain('还没有跟踪的 CVE')
    expect(host.textContent).not.toContain('228.7万')
    app.unmount()
  })
})
