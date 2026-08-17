// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppSidebar from './AppSidebar.vue'
import appSidebarSource from './AppSidebar.vue?raw'
import contextSidebarSource from './ContextSidebar.vue?raw'
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
  codingContextOpen = false,
  onCloseCodingContext = vi.fn(),
  onSelectConversation = vi.fn(),
  onNew = vi.fn(),
  onOpenCodingContext = vi.fn(),
) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AppSidebar, {
    activeSection,
    accountStatus: { configured: false, authenticated: false, state: 'unconfigured' },
    activeConversationId: conversations[0]?.id ?? null,
    conversations,
    ctfSection: 'catalog',
    codingContextOpen,
    themeMode,
    onToggleTheme,
    onCloseCodingContext,
    onOpenCodingContext,
    onSelectConversation,
    onNew,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('AppSidebar', () => {
  it('keeps the global rail icon-only and hides CTF/CVE secondary sidebars', async () => {
    const ctf = await mountSidebar('ctf')
    expect(ctf.querySelector('aside')?.className).toContain('workspace-navigation-shell')
    expect(ctf.querySelector('[aria-label="全局工作区"]')?.textContent).toContain('CTF')
    expect(ctf.querySelector('[aria-label="CTF 工作区"]')).toBeNull()
    expect(ctf.querySelector('[aria-label="打开用户菜单"]')).not.toBeNull()
    expect(ctf.querySelector('[data-testid="coding-context-drawer"]')).toBeNull()

    const vuln = await mountSidebar('vuln')
    expect(vuln.querySelector('[aria-label="CVE 工作区"]')).toBeNull()
    expect(vuln.querySelector('[data-testid="coding-context-drawer"]')).toBeNull()
  })

  it('mounts Coding history as a fixed panel, not a floating overlay drawer', async () => {
    const conversations: Conversation[] = [{
      id: 'conversation-1',
      title: '实现产品闭环',
      createdAt: Date.now(),
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    }]
    const closed = await mountSidebar('chat', conversations, 'dark', vi.fn(), false)
    expect(closed.querySelector('[data-testid="coding-context-drawer"]')).toBeNull()
    // Collapsed history has no extra strip; expand lives on the Coding topbar only.
    expect(closed.querySelector('[aria-label="展开会话历史"]')).toBeNull()
    expect(closed.querySelector('[data-testid="coding-history-expand"]')).toBeNull()
    expect(closed.textContent).not.toContain('新会话')

    const onCloseCodingContext = vi.fn()
    const coding = await mountSidebar(
      'chat',
      conversations,
      'dark',
      vi.fn(),
      true,
      onCloseCodingContext,
    )
    expect(coding.textContent).toContain('新会话')
    expect(coding.textContent).toContain('实现产品闭环')
    const panel = coding.querySelector('[data-testid="coding-context-drawer"]')
    expect(panel).not.toBeNull()
    expect(panel?.className).toContain('coding-history-panel')
    expect(panel?.className).toContain('app-no-drag')
    expect(coding.querySelector('[aria-label="关闭 Coding 会话"]')).toBeNull()
    expect(coding.querySelector('[aria-label="收起会话历史"]')).not.toBeNull()
    expect(coding.querySelector('[data-testid="coding-new-task-button"]')).not.toBeNull()
    expect(appSidebarSource).not.toContain('coding-context-backdrop')
    expect(appSidebarSource).not.toContain('coding-history-toolbar')
    expect(appSidebarSource).not.toContain('left: 100%')
    expect(contextSidebarSource).toContain('coding-context-archive app-no-drag')
    expect(contextSidebarSource).not.toContain('Task archive')

    coding.querySelector<HTMLButtonElement>('[aria-label="收起会话历史"]')?.click()
    await nextTick()
    expect(onCloseCodingContext).toHaveBeenCalledOnce()
  })

  it('keeps collapsed Coding history without a leftover expand strip', async () => {
    const host = await mountSidebar('chat', [], 'dark', vi.fn(), false)
    expect(host.querySelector('[data-testid="coding-context-drawer"]')).toBeNull()
    expect(host.querySelector('[data-testid="coding-history-expand"]')).toBeNull()
  })

  it('makes the new-task icon a native no-drag click target', async () => {
    const onNew = vi.fn()
    const host = await mountSidebar(
      'chat', [], 'dark', vi.fn(), true, vi.fn(), vi.fn(), onNew,
    )
    const newTask = host.querySelector<HTMLButtonElement>('[data-testid="coding-new-task-button"]')
    expect(newTask).not.toBeNull()
    expect(newTask?.className).toContain('app-no-drag')
    newTask?.click()
    await nextTick()
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('keeps no-project tasks alone under the project tree without a folder icon', async () => {
    const conversations: Conversation[] = [
      {
        id: 'scratch-hot',
        title: '草稿任务',
        createdAt: 10,
        messages: [{ id: 'm1', role: 'user', content: '最新', timestamp: 2000 }],
      },
      {
        id: 'project-quiet',
        title: '项目任务',
        createdAt: 100,
        workspacePath: '/Users/milksu/code/quiet',
        messages: [{ id: 'm2', role: 'assistant', content: '旧', timestamp: 50 }],
      },
    ]
    const host = await mountSidebar('chat', conversations, 'dark', vi.fn(), true)
    const temporary = host.querySelector('[data-testid="coding-temporary-group"]')
    expect(temporary).not.toBeNull()
    expect(temporary?.textContent).toContain('无项目任务')
    expect(temporary?.textContent).toContain('草稿任务')
    // No Folder icon inside the temporary block (projects still use lucide Folder).
    expect(temporary?.querySelector('svg.lucide-folder')).toBeNull()
    expect(host.querySelector('.coding-project-group svg.lucide-folder')).not.toBeNull()

    const projectNames = [...host.querySelectorAll('.coding-project-group summary')]
      .map(node => node.textContent ?? '')
    expect(projectNames.some(text => text.includes('quiet'))).toBe(true)
    expect(projectNames.some(text => text.includes('无项目任务'))).toBe(false)

    const archive = host.querySelector('.coding-context-archive')
    const html = archive?.innerHTML ?? ''
    const projectIdx = html.indexOf('coding-project-group')
    const temporaryIdx = html.indexOf('coding-temporary-group')
    expect(projectIdx).toBeGreaterThanOrEqual(0)
    expect(temporaryIdx).toBeGreaterThan(projectIdx)
  })
})
