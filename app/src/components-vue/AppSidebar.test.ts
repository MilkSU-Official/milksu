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

interface SidebarOptions {
  conversations?: Conversation[]
  runningConversationIds?: string[]
  themeMode?: ThemeMode
  codingContextOpen?: boolean
  onToggleTheme?: () => void
  onSelectConversation?: () => void
  onNew?: () => void
  onOpenCodingContext?: () => void
  onDeleteConversation?: (id: string) => void
  onDeleteConversationPermanently?: (id: string) => void
  onRenameConversation?: (id: string, title: string) => void
  conversationActionError?: string
}

async function mountSidebar(
  activeSection: 'ctf' | 'vuln' | 'chat' | 'profile',
  options: SidebarOptions = {},
) {
  const conversations = options.conversations ?? []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AppSidebar, {
    activeSection,
    accountStatus: { configured: false, authenticated: false, state: 'unconfigured' },
    activeConversationId: conversations[0]?.id ?? null,
    conversations,
    runningConversationIds: options.runningConversationIds ?? [],
    conversationActionError: options.conversationActionError ?? '',
    ctfSection: 'catalog',
    codingContextOpen: options.codingContextOpen ?? false,
    themeMode: options.themeMode ?? 'dark',
    onToggleTheme: options.onToggleTheme ?? vi.fn(),
    onOpenCodingContext: options.onOpenCodingContext ?? vi.fn(),
    onSelectConversation: options.onSelectConversation ?? vi.fn(),
    onNew: options.onNew ?? vi.fn(),
    onDeleteConversation: options.onDeleteConversation ?? vi.fn(),
    onRenameConversation: options.onRenameConversation ?? vi.fn(),
    onDeleteConversationPermanently: options.onDeleteConversationPermanently ?? vi.fn(),
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return host
}

describe('AppSidebar', () => {
  it('renders one Beautiful UI sidebar without stacking the old icon rail', async () => {
    const ctf = await mountSidebar('ctf')
    expect(ctf.querySelector('aside')?.className).toContain('workspace-navigation-shell')
    expect(ctf.querySelector('[aria-label="全局工作区"]')).toBeNull()
    expect(ctf.querySelector('[aria-label="CTF 工作区"]')).toBeNull()
    expect(ctf.querySelector('.workspace-rail')).toBeNull()
    expect(ctf.querySelector('[data-testid="coding-context-drawer"]')).not.toBeNull()
    expect(ctf.querySelector('[data-sidebar-collapsed="true"]')).not.toBeNull()
    expect(ctf.querySelector('[aria-label="展开侧栏"]')).not.toBeNull()

    const vuln = await mountSidebar('vuln')
    expect(vuln.querySelector('[aria-label="CVE 工作区"]')).toBeNull()
    expect(vuln.querySelector('.workspace-rail')).toBeNull()
  })

  it('keeps an icon-only theme control when collapsed and lets the expanded sidebar resize', async () => {
    const onToggleTheme = vi.fn()
    const collapsed = await mountSidebar('chat', { onToggleTheme })
    const collapsedTheme = collapsed.querySelector<HTMLButtonElement>('.agent-sidebar__theme')
    expect(collapsedTheme).not.toBeNull()
    expect(collapsedTheme?.textContent?.trim()).toBe('')
    expect(collapsed.querySelector('.agent-sidebar__resize')).toBeNull()
    collapsedTheme?.click()
    expect(onToggleTheme).toHaveBeenCalledOnce()

    const expanded = await mountSidebar('chat', { codingContextOpen: true, themeMode: 'light' })
    expect(expanded.querySelector('[aria-label="调整侧栏宽度"]')).not.toBeNull()
    expect(expanded.querySelector('.agent-sidebar__theme')).not.toBeNull()
    expect(expanded.querySelector('[data-workspace-menu]')).toBeNull()
    expanded.querySelector<HTMLButtonElement>('[data-workspace-trigger]')?.click()
    await nextTick()
    const menu = document.querySelector('[data-workspace-menu]')
    expect(menu?.className).toContain('w-max')
    expect(menu?.className).not.toContain('w-64')
  })

  it('shows Home / CTF / CVE / Lab in the conversation sidebar and lists only the current workspace', async () => {
    const conversations: Conversation[] = [
      {
        id: 'home-1',
        title: '主页任务',
        createdAt: Date.now(),
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      },
      {
        id: 'ctf-1',
        title: '第五空间',
        createdAt: Date.now(),
        messages: [],
        ctfJobId: 'job-1',
      },
    ]
    const ctf = await mountSidebar('ctf', { conversations, codingContextOpen: true })
    expect(ctf.querySelector('[data-testid="coding-context-drawer"]')).not.toBeNull()
    expect(ctf.querySelector('.workspace-rail')).toBeNull()
    expect(ctf.querySelector('[aria-label="工作区"]')?.textContent).toContain('主页')
    expect(ctf.querySelector('[aria-label="工作区"]')?.textContent).toContain('CTF')
    expect(ctf.querySelector('[aria-label="工作区"]')?.textContent).toContain('CVE')
    expect(ctf.querySelector('[aria-label="工作区"]')?.textContent).toContain('Lab')
    expect(ctf.querySelector('[aria-label="账户与工作区"]')).not.toBeNull()
    expect(ctf.textContent).toContain('第五空间')
    expect(ctf.textContent).not.toContain('主页任务')
  })

  it('uses one Beautiful UI sidebar for workspace, chats, and the account control', async () => {
    const conversations: Conversation[] = [{
      id: 'conversation-1',
      title: '实现产品闭环',
      createdAt: Date.now(),
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    }]
    const closed = await mountSidebar('chat', { conversations })
    expect(closed.querySelector('[data-testid="coding-context-drawer"]')).not.toBeNull()
    expect(closed.querySelector('[data-sidebar-collapsed="true"]')).not.toBeNull()
    expect(closed.querySelector('[aria-label="展开侧栏"]')).not.toBeNull()
    expect(closed.querySelector('.workspace-rail')).toBeNull()

    const coding = await mountSidebar('chat', { conversations, codingContextOpen: true })
    expect(coding.textContent).toContain('新会话')
    expect(coding.textContent).toContain('实现产品闭环')
    const panel = coding.querySelector('[data-testid="coding-context-drawer"]')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('data-sidebar-collapsed')).toBe('false')
    expect(coding.querySelector('[aria-label="关闭 Coding 会话"]')).toBeNull()
    expect(coding.querySelector('[aria-label="收起侧栏"]')).not.toBeNull()
    expect(coding.querySelector('[data-testid="coding-history-toggle"]')).not.toBeNull()
    expect(coding.querySelector('[data-testid="coding-new-task-button"]')).not.toBeNull()
    expect(coding.querySelector('[aria-label="账户与工作区"]')).not.toBeNull()
    expect(appSidebarSource).not.toContain('WorkspaceRail')
    expect(appSidebarSource).not.toContain('coding-context-backdrop')
    expect(contextSidebarSource).not.toContain('Task archive')
    expect(contextSidebarSource).toContain('收起侧栏')
    expect(contextSidebarSource).toContain('data-workspace-trigger')
  })

  it('collapses the same sidebar in place instead of leaving a second rail', async () => {
    const host = await mountSidebar('chat')
    expect(host.querySelector('[data-testid="coding-context-drawer"]')).not.toBeNull()
    expect(host.querySelector('[data-sidebar-collapsed="true"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="coding-history-expand"]')).not.toBeNull()
    expect(host.querySelector('.workspace-rail')).toBeNull()
    expect(host.querySelector('[aria-label="全局工作区"]')).toBeNull()
  })

  it('makes the new-task icon a native no-drag click target', async () => {
    const onNew = vi.fn()
    const host = await mountSidebar('chat', { codingContextOpen: true, onNew })
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
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="收起侧栏"]')
    expect(collapse).not.toBeNull()
    collapse?.click()
    await nextTick()
    expect(onCollapse).toHaveBeenCalledOnce()
  })

  it('requires confirmation before archiving a conversation', async () => {
    const onDeleteConversation = vi.fn()
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'archive-me', title: '待归档会话', createdAt: 1, messages: [] }],
      codingContextOpen: true,
      onDeleteConversation,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="归档编码任务"]')?.click()
    await nextTick()
    expect(onDeleteConversation).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('归档聊天？')
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认归档')
    confirm?.click()
    await nextTick()
    expect(onDeleteConversation).toHaveBeenCalledWith('archive-me')
  })

  it('warns that archiving a running conversation stops the current turn', async () => {
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'busy', title: '运行中的会话', createdAt: 1, messages: [] }],
      runningConversationIds: ['busy'],
      codingContextOpen: true,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="归档编码任务"]')?.click()
    await nextTick()
    expect(document.body.textContent).toContain('该会话正在运行，本次操作会先中断当前回合。')
  })

  it('keeps the confirmation open and shows why archiving failed', async () => {
    const onDeleteConversation = vi.fn()
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'stuck', title: '归档失败的会话', createdAt: 1, messages: [] }],
      codingContextOpen: true,
      conversationActionError: '归档失败：磁盘只读',
      onDeleteConversation,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="归档编码任务"]')?.click()
    await nextTick()
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认归档')
    confirm?.click()
    await nextTick()
    expect(onDeleteConversation).toHaveBeenCalledWith('stuck')
    // The row is still listed, so the dialog stays put with the reason visible.
    expect(document.body.textContent).toContain('归档失败：磁盘只读')
    expect(document.body.textContent).toContain('归档聊天？')
  })

  it('renames a conversation inline and persists through the parent handler', async () => {
    const onRenameConversation = vi.fn()
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'rename-me', title: '旧标题', createdAt: 1, messages: [] }],
      codingContextOpen: true,
      onRenameConversation,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="重命名编码任务"]')?.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('[aria-label="编辑会话标题"]')
    expect(input).not.toBeNull()
    expect(input?.className).toContain('coding-project-title-input')
    expect(host.querySelector('[data-testid="conversation-action-placeholder"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="会话操作"]')).toBeNull()
    if (input) {
      input.value = '新的会话标题'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    await nextTick()
    expect(onRenameConversation).toHaveBeenCalledWith('rename-me', '新的会话标题')
  })

  it('keeps editing while an IME confirms a candidate with Enter', async () => {
    const onRenameConversation = vi.fn()
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'ime', title: '旧标题', createdAt: 1, messages: [] }],
      codingContextOpen: true,
      onRenameConversation,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="重命名编码任务"]')?.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('[aria-label="编辑会话标题"]')
    input!.value = '中文'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    // Confirming the candidate list, not the rename.
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    await nextTick()
    expect(onRenameConversation).not.toHaveBeenCalled()
    expect(host.querySelector('[aria-label="编辑会话标题"]')).not.toBeNull()

    // Escape during composition dismisses the candidate, it does not cancel the edit.
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
    await nextTick()
    expect(host.querySelector('[aria-label="编辑会话标题"]')).not.toBeNull()

    // The next Enter is a real one.
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(onRenameConversation).toHaveBeenCalledWith('ime', '中文')
  })

  it('requires confirmation before permanently deleting a conversation', async () => {
    const onDeleteConversationPermanently = vi.fn()
    const host = await mountSidebar('chat', {
      conversations: [{ id: 'delete-me', title: '待删除会话', createdAt: 1, messages: [] }],
      codingContextOpen: true,
      onDeleteConversationPermanently,
    })
    host.querySelector<HTMLButtonElement>('[aria-label="会话操作"]')?.click()
    await nextTick()
    document.querySelector<HTMLElement>('[aria-label="永久删除编码任务"]')?.click()
    await nextTick()
    expect(onDeleteConversationPermanently).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('永久删除聊天？')
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认永久删除')
    confirm?.click()
    await nextTick()
    expect(onDeleteConversationPermanently).toHaveBeenCalledWith('delete-me')
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
    const host = await mountSidebar('chat', { conversations, codingContextOpen: true })
    const temporary = host.querySelector('[data-testid="coding-temporary-group"]')
    expect(temporary).not.toBeNull()
    expect(temporary?.textContent).toContain('最近')
    expect(temporary?.textContent).toContain('草稿任务')
    expect(temporary?.querySelector('svg.lucide-clock')).not.toBeNull()
    expect(temporary?.querySelector('svg.lucide-plus')).not.toBeNull()
    expect(temporary?.querySelector('svg.lucide-folder')).toBeNull()
    expect(host.querySelector('.coding-project-group svg.lucide-folder')).not.toBeNull()
    // Flat hierarchy chrome: no chevron, no left tree rail under folders.
    expect(host.querySelector('.coding-project-chevron')).toBeNull()
    expect(host.querySelector('.coding-project-children.border-l')).toBeNull()
    expect(host.querySelector('.coding-project-child')).not.toBeNull()

    const projectNames = [...host.querySelectorAll('.coding-project-group summary')]
      .map(node => node.textContent ?? '')
    expect(projectNames.some(text => text.includes('quiet'))).toBe(true)
    expect(projectNames.some(text => text.includes('最近'))).toBe(false)

    const archive = host.querySelector('[data-testid="coding-context-drawer"]')
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
    expect(host.querySelector('[aria-label="运行中"]')?.parentElement?.classList)
      .toContain('coding-session-status')
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
    const host = await mountSidebar('chat', { conversations, codingContextOpen: true })
    const projectSummary = host.querySelector('.coding-project-group summary')
    const add = projectSummary?.querySelector<HTMLButtonElement>('.coding-project-new-session')

    expect(projectSummary?.textContent?.trim()).toBe('milksu')
    expect(add?.querySelector('svg.lucide-plus')).not.toBeNull()
    expect(add?.querySelector('svg.lucide-message-square-plus')).toBeNull()
    expect(add?.className).toContain('opacity-0')
    expect(add?.className).toContain('group-hover:opacity-100')
    expect(contextSidebarSource).not.toContain('coding-project-count')
  })

  it('marks the current Coding conversation with the document selected state', async () => {
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
    const host = await mountSidebar('chat', { conversations, codingContextOpen: true, themeMode: 'light' })
    const selected = host.querySelectorAll('[data-active-conversation-row]')
    expect(selected).toHaveLength(1)
    expect(selected[0]?.getAttribute('data-ui-selected')).toBe('')
    expect(selected[0]?.textContent).toContain('当前会话')
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('当前会话')
    expect(host.querySelectorAll('.coding-conversation-list [data-ui-selected]')).toHaveLength(1)
    expect(contextSidebarSource).toContain('color: var(--foreground)')
    expect(contextSidebarSource).toContain('agent-sidebar-item')
    expect(contextSidebarSource).toContain('overflow-hidden rounded-[8px]')
    expect(contextSidebarSource).toContain('agent-sidebar-item__menu')
    expect(contextSidebarSource).toContain('.agent-sidebar-item__menu:hover')
    expect(contextSidebarSource).toContain('background: transparent')
    expect(selected[0]?.querySelector('[data-button]')).toBeNull()
    expect(contextSidebarSource).not.toContain('--overlay-hover-strong: rgb(255 255 255 / 0.13)')
  })
})
