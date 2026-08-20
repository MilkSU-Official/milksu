// @vitest-environment jsdom

import { createApp, h, nextTick, ref, type App } from 'vue'
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
  onSelectConversation = vi.fn(),
  onNew = vi.fn(),
  onOpenCodingContext = vi.fn(),
  onDeleteConversation = vi.fn(),
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
    onOpenCodingContext,
    onSelectConversation,
    onNew,
    onDeleteConversation,
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
    // Collapsed: no panel strip; expand + new-task live on the Coding topbar.
    expect(closed.querySelector('[aria-label="展开会话历史"]')).toBeNull()
    expect(closed.querySelector('[data-testid="coding-history-expand"]')).toBeNull()
    expect(closed.textContent).not.toContain('新会话')

    const coding = await mountSidebar(
      'chat',
      conversations,
      'dark',
      vi.fn(),
      true,
    )
    expect(coding.textContent).toContain('新会话')
    expect(coding.textContent).toContain('实现产品闭环')
    const panel = coding.querySelector('[data-testid="coding-context-drawer"]')
    expect(panel).not.toBeNull()
    expect(panel?.className).toContain('coding-history-panel')
    expect(panel?.className).toContain('app-no-drag')
    expect(coding.querySelector('[aria-label="关闭 Coding 会话"]')).toBeNull()
    // Open panel: collapse sits in the first header row; new-task one row below.
    expect(coding.querySelector('[aria-label="收起会话历史"]')).not.toBeNull()
    expect(coding.querySelector('[data-testid="coding-history-toggle"]')).not.toBeNull()
    expect(coding.querySelector('[data-testid="coding-new-task-button"]')).not.toBeNull()
    expect(appSidebarSource).not.toContain('coding-context-backdrop')
    expect(appSidebarSource).not.toContain('coding-history-toolbar')
    expect(appSidebarSource).not.toContain('left: 100%')
    expect(contextSidebarSource).toContain('coding-context-archive app-no-drag')
    expect(contextSidebarSource).not.toContain('Task archive')
    expect(contextSidebarSource).toContain('收起会话历史')
    expect(contextSidebarSource).toContain('coding-history-header')
  })

  it('keeps collapsed Coding history without a leftover expand strip', async () => {
    const host = await mountSidebar('chat', [], 'dark', vi.fn(), false)
    expect(host.querySelector('[data-testid="coding-context-drawer"]')).toBeNull()
    expect(host.querySelector('[data-testid="coding-history-expand"]')).toBeNull()
    // Expand + new-task park on the Coding topbar, not a rail strip.
    expect(host.querySelector('[aria-label="展开会话历史"]')).toBeNull()
  })

  it('makes the new-task icon a native no-drag click target', async () => {
    const onNew = vi.fn()
    const host = await mountSidebar(
      'chat', [], 'dark', vi.fn(), true, vi.fn(), onNew,
    )
    const newTask = host.querySelector<HTMLButtonElement>('[data-testid="coding-new-task-button"]')
    expect(newTask).not.toBeNull()
    expect(newTask?.className).toContain('app-no-drag')
    newTask?.click()
    await nextTick()
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('emits collapse from the open-panel history toggle', async () => {
    const onCollapse = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(AppSidebar, {
      activeSection: 'chat',
      accountStatus: { configured: false, authenticated: false, state: 'unconfigured' },
      activeConversationId: null,
      conversations: [],
      ctfSection: 'catalog',
      codingContextOpen: true,
      themeMode: 'dark',
      onCollapseCodingContext: onCollapse,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="收起会话历史"]')
    expect(collapse).not.toBeNull()
    collapse?.click()
    await nextTick()
    expect(onCollapse).toHaveBeenCalledOnce()
  })

  it('requires confirmation before archiving a conversation', async () => {
    const onDeleteConversation = vi.fn()
    const host = await mountSidebar(
      'chat',
      [{ id: 'archive-me', title: '待归档会话', createdAt: 1, messages: [] }],
      'dark',
      vi.fn(),
      true,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      onDeleteConversation,
    )
    host.querySelector<HTMLButtonElement>('[aria-label="归档编码任务"]')?.click()
    await nextTick()
    expect(onDeleteConversation).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('归档聊天？')
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认归档')
    confirm?.click()
    await nextTick()
    expect(onDeleteConversation).toHaveBeenCalledWith('archive-me')
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
    // Flat hierarchy chrome: no chevron, no left tree rail under folders.
    expect(host.querySelector('.coding-project-chevron')).toBeNull()
    expect(host.querySelector('.coding-project-children.border-l')).toBeNull()
    expect(host.querySelector('.coding-project-child')).not.toBeNull()

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

  it('shows a completion reminder only after a background run finishes and clears it when opened', async () => {
    const conversations: Conversation[] = [
      {
        id: 'conversation-active',
        title: '当前会话',
        createdAt: 20,
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      },
      {
        id: 'conversation-background',
        title: '后台会话',
        createdAt: 10,
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      },
    ]
    const runningIds = ref(['conversation-background'])
    const selectedId = ref('conversation-active')
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      setup: () => () => h(AppSidebar, {
        activeSection: 'chat',
        accountStatus: { configured: false, authenticated: false, state: 'unconfigured' },
        activeConversationId: selectedId.value,
        conversations,
        runningConversationIds: runningIds.value,
        ctfSection: 'catalog',
        codingContextOpen: true,
        themeMode: 'dark',
        onSelectConversation: (id: string) => { selectedId.value = id },
      }),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.querySelector('[aria-label="运行中"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="有新消息"]')).toBeNull()

    runningIds.value = []
    await nextTick()
    expect(host.querySelector('[aria-label="有新消息"]')).not.toBeNull()

    const background = [...host.querySelectorAll<HTMLButtonElement>('.coding-project-child')]
      .find(button => button.textContent?.includes('后台会话'))
    background?.click()
    await nextTick()
    expect(host.querySelector('[aria-label="有新消息"]')).toBeNull()
  })

  it('uses a hover-only plus action without project conversation counts', async () => {
    const conversations: Conversation[] = [{
      id: 'conversation-1',
      title: '实现产品闭环',
      createdAt: Date.now(),
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    }]
    const host = await mountSidebar('chat', conversations, 'dark', vi.fn(), true)
    const projectSummary = host.querySelector('.coding-project-group summary')
    const add = projectSummary?.querySelector<HTMLButtonElement>('.coding-project-new-session')

    expect(projectSummary?.textContent?.trim()).toBe('milksu')
    expect(add?.querySelector('svg.lucide-plus')).not.toBeNull()
    expect(add?.querySelector('svg.lucide-message-square-plus')).toBeNull()
    expect(add?.className).toContain('opacity-0')
    expect(add?.className).toContain('group-hover:opacity-100')
    expect(contextSidebarSource).not.toContain('coding-project-count')
  })

  it('marks the current Coding conversation so day mode can reuse the night selected wash', async () => {
    const conversations: Conversation[] = [
      {
        id: 'conversation-active',
        title: '当前会话',
        createdAt: 20,
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      },
      {
        id: 'conversation-other',
        title: '另一个会话',
        createdAt: 10,
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      },
    ]
    const host = await mountSidebar('chat', conversations, 'light', vi.fn(), true)
    const selected = host.querySelectorAll('[data-active-conversation-row]')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.getAttribute('data-ui-selected')).toBe('')
    expect(selected[0]?.textContent).toContain('当前会话')
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('当前会话')
    expect(host.querySelectorAll('.coding-conversation-list [data-ui-selected]')).toHaveLength(1)
    expect(contextSidebarSource).toContain('--selected-bg: var(--overlay-hover-strong)')
    expect(contextSidebarSource).toContain('--overlay-hover-strong: rgb(255 255 255 / 0.13)')
  })
})
