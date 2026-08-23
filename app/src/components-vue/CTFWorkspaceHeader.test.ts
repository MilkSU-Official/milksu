// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFWorkspaceHeader from './CTFWorkspaceHeader.vue'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountHeader(props: {
  challengeTitle?: string
  sourceUri?: string
} = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const events: string[] = []
  const app = createApp(CTFWorkspaceHeader, {
    ...props,
    onReturnCatalog: () => events.push('returnCatalog'),
    onOpenSource: () => events.push('openSource'),
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, events }
}

describe('CTFWorkspaceHeader', () => {
  it('keeps the catalog escape hatch visible in solve sessions', async () => {
    const { host, events } = await mountHeader({
      challengeTitle: 'NSSCTF P3879',
      sourceUri: 'https://example.test/problem/3879',
    })

    expect(host.textContent).toContain('解题会话')
    expect(host.textContent).toContain('NSSCTF P3879')
    expect(host.textContent).toContain('打开题目')
    expect(host.querySelector('[aria-label="打开设置"]')).toBeNull()
    expect(host.textContent).not.toContain('查看复盘')
    expect(host.textContent).not.toContain('返回解题')
    expect(host.textContent).not.toContain('不会结束当前会话')
    expect(host.querySelector('[data-module-topbar]')).not.toBeNull()
    expect(host.querySelector('[data-module-topbar]')?.getAttribute('data-workspace-module')).toBe('ctf')
    expect(host.querySelector('[data-workspace-topbar-title]')?.className).toContain('workspace-topbar__title')

    host.querySelector<HTMLButtonElement>('[aria-label="返回 CTF 题库"]')?.click()
    host.querySelector<HTMLButtonElement>('[aria-label="打开当前 CTF 题目"]')?.click()

    expect(events).toEqual(['returnCatalog', 'openSource'])
  })

  it('does not split the workspace into solve and review modes', async () => {
    const { host } = await mountHeader({
      challengeTitle: 'NSSCTF P3879',
    })
    expect(host.textContent).not.toContain('查看复盘')
    expect(host.textContent).not.toContain('返回解题')
    expect(host.querySelector('[aria-label="查看 CTF 复盘模式"]')).toBeNull()
  })

  it('does not show a dead source button when a challenge has no URL', async () => {
    const { host } = await mountHeader({ challengeTitle: '离线附件题' })

    expect(host.textContent).toContain('离线附件题')
    expect(host.querySelector('[aria-label="返回 CTF 题库"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="打开当前 CTF 题目"]')).toBeNull()
  })
})
