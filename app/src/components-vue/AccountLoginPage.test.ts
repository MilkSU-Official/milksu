// @vitest-environment jsdom

import { createApp, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import AccountLoginPage from './AccountLoginPage.vue'

async function mountLogin(state: 'signed_out' | 'authorizing' | 'invitation_required' = 'signed_out') {
  const host = document.createElement('div')
  document.body.append(host)
  const onLogin = vi.fn()
  const onContinueLocal = vi.fn()
  const app = createApp(AccountLoginPage, {
    status: { configured: true, authenticated: false, state },
    busy: false,
    onLogin,
    onContinueLocal,
  })
  app.mount(host)
  await nextTick()
  return { app, host, onLogin, onContinueLocal }
}

describe('AccountLoginPage', () => {
  it('starts GitHub login and keeps local API keys as an explicit path', async () => {
    const mounted = await mountLogin()
    const buttons = [...mounted.host.querySelectorAll<HTMLButtonElement>('button')]
    buttons.find(button => button.textContent?.includes('使用 GitHub 登录'))?.click()
    buttons.find(button => button.textContent?.includes('暂不登录'))?.click()
    await nextTick()
    expect(mounted.onLogin).toHaveBeenCalledOnce()
    expect(mounted.onContinueLocal).toHaveBeenCalledOnce()
    expect(mounted.host.querySelector('a')?.getAttribute('href')).toBe('mailto:milksu@proton.me')
    mounted.app.unmount()
  })

  it('explains an account that has not been invited without blocking local mode', async () => {
    const mounted = await mountLogin('invitation_required')
    expect(mounted.host.textContent).toContain('尚未获得内测邀请')
    expect(mounted.host.textContent).toContain('使用自己的 API Key')
    mounted.app.unmount()
  })
})
