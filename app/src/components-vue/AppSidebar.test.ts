// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppSidebar from './AppSidebar.vue'
import type { ThemeMode } from '@/lib/themeMode'
import type { Conversation } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountSidebar(
  activeSection: 'ctf' | 'vuln' | 'chat' | 'profile',
  conversations: Conversation[] = [],
  themeMode: ThemeMode = 'dark',
  onToggleTheme = vi.fn(),
) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AppSidebar, {
    activeSection,
    accountStatus: { configured: false, authenticated: false, state: 'unconfigured' },
    activeConversationId: conversations[0]?.id ?? null,
    conversations,
    ctfSection: 'catalog',
    themeMode,
    onToggleTheme,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('AppSidebar', () => {
  it('hides single-item CTF and CVE context sidebars until real history exists', async () => {
    const ctf = await mountSidebar('ctf')
    expect(ctf.querySelector('aside')?.className).toContain('w-56')
    expect(ctf.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('CTF')
    expect(ctf.querySelector('[aria-label="CTF 工作区"]')).toBeNull()
    expect(ctf.querySelector('[aria-label="打开用户菜单"]')).not.toBeNull()
    expect(ctf.querySelector('[aria-label="设置"]')).not.toBeNull()
    expect(ctf.textContent).not.toContain('题库')

    const vuln = await mountSidebar('vuln')
    expect(vuln.querySelector('aside')?.className).toContain('w-56')
    expect(vuln.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('CVE')
    expect(vuln.querySelector('[aria-label="CVE 工作区"]')).toBeNull()
    expect(vuln.querySelector('[aria-label="打开用户菜单"]')).not.toBeNull()
    expect(vuln.querySelector('[aria-label="设置"]')).not.toBeNull()
    expect(vuln.textContent).not.toContain('追踪')
  })

  it('keeps the Coding context sidebar because it has real conversation history', async () => {
    const coding = await mountSidebar('chat', [{
      id: 'conversation-1',
      title: '实现产品闭环',
      createdAt: Date.now(),
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    }])

    expect(coding.textContent).toContain('新建编码任务')
    expect(coding.textContent).toContain('milksu')
    expect(coding.textContent).toContain('实现产品闭环')
    expect(coding.querySelector('aside > div:last-child > header')).toBeNull()
    expect(coding.querySelector('[data-active-conversation-row]')?.textContent)
      .toContain('实现产品闭环')
    expect(coding.querySelector('[aria-label="设置"]')).not.toBeNull()
    const codingHeading = [...coding.querySelectorAll('h2')]
      .find(node => node.textContent === 'Coding')
    const newTask = [...coding.querySelectorAll('button')]
      .find(node => node.textContent?.includes('新建编码任务'))
    expect(codingHeading).not.toBeUndefined()
    expect(newTask).not.toBeUndefined()
    expect(Boolean(codingHeading && newTask && (
      codingHeading.compareDocumentPosition(newTask) & Node.DOCUMENT_POSITION_FOLLOWING
    ))).toBe(true)
  })

  it('uses rail-local selection styling instead of inherited button hover borders', async () => {
    const host = await mountSidebar('ctf')
    const activeButton = host.querySelector<HTMLButtonElement>('[aria-label="CTF"]')
    expect(activeButton?.className).toContain('workspace-rail-item')
    expect(activeButton?.className).toContain('workspace-rail-active')
    expect(activeButton?.getAttribute('data-ui-selected')).toBe('')
  })

  it('keeps the theme switch in the global rail and emits a single toggle action', async () => {
    const onToggleTheme = vi.fn()
    const dark = await mountSidebar('ctf', [], 'dark', onToggleTheme)
    const dayButton = dark.querySelector<HTMLButtonElement>('[aria-label="切换到日间模式"]')
    expect(dayButton?.textContent?.trim()).toBe('日间模式')
    dayButton?.click()
    await nextTick()
    expect(onToggleTheme).toHaveBeenCalledOnce()

    const light = await mountSidebar('ctf', [], 'light')
    const nightButton = light.querySelector<HTMLButtonElement>('[aria-label="切换到夜间模式"]')
    expect(nightButton?.textContent?.trim()).toBe('深色模式')
    expect(light.querySelector('[aria-label="设置"]')?.textContent?.trim()).toBe('设置')
  })

  it('opens a concise user menu and closes it after choosing the profile', async () => {
    const host = await mountSidebar('ctf')
    host.querySelector<HTMLButtonElement>('[aria-label="打开用户菜单"]')?.click()
    await nextTick()
    expect(host.querySelector('[aria-label="用户菜单"]')).not.toBeNull()
    const profile = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('个人资料'))
    profile?.click()
    await nextTick()
    expect(host.querySelector('[aria-label="用户菜单"]')).toBeNull()
  })

  it('expands the rail on the profile without adding another context sidebar', async () => {
    const profile = await mountSidebar('profile')
    expect(profile.querySelector('aside')?.className).toContain('w-56')
    expect(profile.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('Coding')
    expect(profile.textContent).toContain('MilkSU')
  })
})
