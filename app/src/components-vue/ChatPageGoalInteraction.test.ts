// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodingGoalState, Conversation } from '@/types'
import ChatPage from './ChatPage.vue'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
}))

const mountedApps: App[] = []

function composerEditor(host: HTMLElement) {
  const editor = host.querySelector<HTMLElement>('[aria-label="消息"]')
  if (!editor) throw new Error('missing message editor')
  return editor
}

function setComposerText(editor: HTMLElement, text: string) {
  const node = document.createTextNode(text)
  editor.replaceChildren(node)
  const range = document.createRange()
  range.setStart(node, text.length)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

const activeGoal: CodingGoalState = {
  id: 'goal-1',
  text: '让 MilkSU 完成一次可审查的自举迭代',
  status: 'active',
  startedAt: 1,
  updatedAt: 2,
  iteration: 2,
  tokensUsed: 8_000,
  timeUsedSeconds: 180,
  automaticModelTurns: 2,
  queuedCount: 0,
}

function conversation(goal?: CodingGoalState): Conversation {
  return {
    id: 'conversation-1',
    title: 'Goal interaction',
    createdAt: 1,
    agentGoal: goal,
    messages: [],
  }
}

function mountPage(options: {
  goal?: CodingGoalState
  running?: boolean
  workspacePath?: string
  sessionReady?: boolean
} = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const controlledGoals: string[] = []
  let aborts = 0
  let newConversations = 0
  let compactions = 0
  const sent: unknown[][] = []
  const app = createApp(ChatPage, {
    conversation: conversation(options.goal),
    settings: null,
    workspacePath: options.workspacePath ?? '',
    running: options.running ?? false,
    aborting: false,
    sessionReady: options.sessionReady ?? false,
    resumed: false,
    compacting: false,
    ctfSession: false,
    ensureConversation: () => 'conversation-1',
    onControlGoal: (action: string) => controlledGoals.push(action),
    onAbort: () => {
      aborts += 1
    },
    onNewConversation: () => {
      newConversations += 1
    },
    onCompactContext: () => {
      compactions += 1
    },
    onSend: (...args: unknown[]) => {
      sent.push(args)
    },
  })
  app.mount(host)
  mountedApps.push(app)
  return {
    host,
    controlledGoals,
    aborts: () => aborts,
    newConversations: () => newConversations,
    compactions: () => compactions,
    sent,
  }
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage Goal interaction', () => {
  it('enters existing goalMode from the Composer slash menu and has no sidebar goal entry', async () => {
    const result = mountPage()
    await nextTick()

    expect(result.host.querySelector('[data-workspace-topbar-title]')?.textContent)
      .toBe('Goal interaction')

    expect(result.host.querySelector('[aria-label="环境信息"]')?.textContent)
      .not.toContain('设为目标')
    const textarea = composerEditor(result.host)
    setComposerText(textarea, '/')
    await nextTick()
    expect(result.host.querySelector('[aria-label="斜杠命令"]')).not.toBeNull()

    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(textarea.getAttribute('data-placeholder')).toContain('写下一个可持续目标')
    expect(document.activeElement).toBe(textarea)
    expect(result.host.querySelector('[aria-label="持续目标"]')?.textContent)
      .toContain('下一条消息会成为持续目标')
  })

  it('routes slash commands to existing Coding surfaces and parent actions', async () => {
    const panels = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    const textarea = composerEditor(panels.host)

    setComposerText(textarea, '/worktree')
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(panels.host.querySelector('[aria-label="隔离 worktree"]')).not.toBeNull()

    setComposerText(textarea, '/new')
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    expect(panels.newConversations()).toBe(1)

    setComposerText(textarea, '/compact')
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    expect(panels.compactions()).toBe(1)
  })

  it('uses interruption to pause a running Goal and Pi commands when it is idle', async () => {
    const running = mountPage({ goal: activeGoal, running: true })
    await nextTick()
    running.host.querySelector<HTMLButtonElement>('[aria-label="暂停目标"]')?.click()
    expect(running.aborts()).toBe(1)
    expect(running.controlledGoals).toEqual([])

    const paused = mountPage({
      goal: { ...activeGoal, status: 'paused' },
      running: false,
    })
    await nextTick()
    paused.host.querySelector<HTMLButtonElement>('[aria-label="继续目标"]')?.click()
    paused.host.querySelector<HTMLButtonElement>('[aria-label="清除当前目标"]')?.click()
    expect(paused.controlledGoals).toEqual(['resume', 'clear'])
  })

  it('keeps Browser Use inline until send and requests the upstream extension capability', async () => {
    const result = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    const editor = composerEditor(result.host)
    setComposerText(editor, '/browser-use')
    await nextTick()
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(editor.querySelector('[data-composer-scope-token="browser-use"]')).not.toBeNull()
    expect(result.sent).toEqual([])
    expect(result.host.querySelector('[aria-label="Browser Use"]')).not.toBeNull()

    editor.append(document.createTextNode('检查我当前打开的页面'))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    result.host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await nextTick()

    expect(result.sent).toHaveLength(1)
    expect(result.sent[0]?.[0]).toContain('Playwright MCP 官方扩展')
    expect(result.sent[0]?.[1]).toBe('检查我当前打开的页面')
    expect(result.sent[0]?.[3]).toBe('browser-use')
    expect(editor.textContent).toBe('')
  })

  it('keeps transient Computer Use out of the manually reopened sidebar', async () => {
    const result = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    const editor = composerEditor(result.host)
    setComposerText(editor, '/computer-use')
    await nextTick()
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()

    expect(result.host.querySelector('[aria-label="Computer Use"]')).not.toBeNull()
    editor.querySelector<HTMLButtonElement>('[aria-label="移除 /computer-use"]')?.click()
    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭右侧栏"]')?.click()
    await nextTick()
    result.host.querySelector<HTMLButtonElement>('[aria-label="打开右侧栏"]')?.click()
    await nextTick()

    expect(result.host.querySelector('[aria-label="浏览器"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="Computer Use"]')).toBeNull()
  })

  it('opens Terminal as an independent bottom dock while keeping the right sidebar open', async () => {
    const result = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()

    expect(result.host.querySelectorAll('[aria-label="关闭右侧栏"]')).toHaveLength(1)
    expect(result.host.querySelector('[aria-label="打开底部终端"]')).not.toBeNull()

    result.host.querySelector<HTMLButtonElement>('[aria-label="打开底部终端"]')?.click()
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(result.host.querySelector('[aria-label="底部终端面板"]')).not.toBeNull()
    expect(result.host.querySelector('aside[aria-label="环境信息"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="关闭底部终端"]')).not.toBeNull()
    expect(result.host.querySelectorAll('[aria-label="关闭右侧栏"]')).toHaveLength(1)

    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭右侧栏"]')?.click()
    await nextTick()
    expect(result.host.querySelector('aside')).toBeNull()
    expect(result.host.querySelector('[aria-label="底部终端面板"]')).not.toBeNull()

    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭底部终端"]')?.click()
    await nextTick()
    expect(result.host.querySelector('[aria-label="底部终端面板"]')).toBeNull()
  })
})
