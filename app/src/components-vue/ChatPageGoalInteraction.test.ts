// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodingGoalState, Conversation } from '@/types'
import { invokeCommand } from '@/desktop'
import ChatPage from './ChatPage.vue'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
  listenEvent: vi.fn(async () => () => undefined),
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
  compacting?: boolean
  compactionError?: string
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
    compacting: options.compacting ?? false,
    compactionError: options.compactionError,
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
  const invoke = vi.mocked(invokeCommand)
  invoke.mockReset()
  invoke.mockImplementation(async () => {
    throw new Error('desktop runtime unavailable in component test')
  })
})

describe('ChatPage Goal interaction', () => {
  it('enters existing goalMode from the Composer slash menu and has no sidebar goal entry', async () => {
    const result = mountPage()
    await nextTick()

    expect(result.host.querySelector('[data-workspace-topbar-title]')).toBeNull()
    expect(result.host.textContent).toContain('我们要构建什么')

    // Right rail is collapsed by default; goal controls must not live there.
    expect(result.host.querySelector('aside[aria-label="环境信息"]')).toBeNull()
    expect(result.host.textContent).not.toContain('设为目标')
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

  it('names the empty canvas after the selected project', async () => {
    const panels = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    expect(panels.host.textContent).toContain('我们在 milksu 中构建什么')
    expect(panels.host.textContent).not.toContain('我们要构建什么')
  })

  it('routes slash commands to existing Coding surfaces and parent actions', async () => {
    const panels = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    const textarea = composerEditor(panels.host)

    setComposerText(textarea, '/diff')
    await nextTick()
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await nextTick()
    expect(panels.host.querySelector('[aria-label="变更"]')).not.toBeNull()
    expect(panels.host.textContent).not.toContain('隔离 worktree')

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

  it('shows a live compaction status while Pi is compacting', async () => {
    const page = mountPage({ compacting: true, sessionReady: true })
    await nextTick()
    const status = page.host.querySelector('[data-testid="context-compaction-status"]')
    expect(status?.textContent).toContain('正在整理上下文')
    expect(page.host.querySelector('[aria-label="停止整理上下文"]')).not.toBeNull()
  })

  it('surfaces a compaction error after the run ends', async () => {
    const page = mountPage({
      sessionReady: true,
      compactionError: '上下文压缩超时，已取消。',
    })
    await nextTick()
    expect(page.host.querySelector('[data-testid="context-compaction-error"]')?.textContent)
      .toContain('上下文压缩超时')
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
    await nextTick()
    // Close transient Computer Use surface, then reopen the manual environment rail.
    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭右侧栏"]')?.click()
    await nextTick()
    result.host.querySelector<HTMLButtonElement>('[aria-label="打开右侧栏"]')?.click()
    await nextTick()

    expect(result.host.querySelector('[aria-label="浏览器"]') || result.host.querySelector('[aria-label="环境信息"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="Computer Use"]')).toBeNull()
  })

  it('opens one permission dialog and automatically starts the only visible Computer Use target', async () => {
    const target = {
      name: 'Preview',
      bundleId: 'com.example.preview',
      pid: 4242,
      windowId: 9001,
      windowTitle: 'Permission integration',
    }
    const permissions = {
      accessibility: false,
      screenRecording: false,
    }
    const computerUseStatus = () => ({
      available: true,
      enabled: false,
      phase: 'disabled',
      permissions: { ...permissions },
    })
    vi.mocked(invokeCommand).mockImplementation(async (command, args) => {
      if (command === 'get_coding_browser_status') {
        return {
          enabled: false,
          conversationId: '',
          phase: 'disabled',
          pages: [],
        } as never
      }
      if (command === 'activate_coding_computer_use'
        || command === 'get_coding_computer_use_status') {
        return computerUseStatus() as never
      }
      if (command === 'list_coding_computer_use_targets') return [target] as never
      if (command === 'request_coding_computer_use_permissions') {
        const permission = (args as { permission?: string } | undefined)?.permission
        if (permission === 'accessibility') permissions.accessibility = true
        if (permission === 'screen-recording') permissions.screenRecording = true
        return computerUseStatus() as never
      }
      if (command === 'start_coding_computer_use') {
        return {
          ...computerUseStatus(),
          enabled: true,
          phase: 'ready',
          conversationId: 'conversation-1',
          target,
        } as never
      }
      throw new Error(`unsupported test command ${command}`)
    })

    const result = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()
    await vi.waitFor(() => {
      expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
        'activate_coding_computer_use',
        { conversationId: 'conversation-1' },
      )
    })
    const editor = composerEditor(result.host)
    setComposerText(editor, '/computer-use')
    await nextTick()
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('开启 Computer Use')
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('0 / 2')

    document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开辅助功能系统设置"]',
    )?.click()
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('1 / 2')
    })

    document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开屏幕录制系统设置"]',
    )?.click()
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(vi.mocked(invokeCommand)).toHaveBeenCalledWith(
        'start_coding_computer_use',
        expect.objectContaining({
          conversationId: 'conversation-1',
          targetPid: 4242,
          targetWindowId: 9001,
        }),
      )
    })
  })

  it('opens Terminal as an independent bottom dock while keeping the right sidebar open', async () => {
    const result = mountPage({ workspacePath: '/tmp/milksu', sessionReady: true })
    await nextTick()

    // Right rail starts collapsed; open it for this interaction contract.
    result.host.querySelector<HTMLButtonElement>('[aria-label="打开右侧栏"]')?.click()
    await nextTick()

    expect(result.host.querySelectorAll('[aria-label="关闭右侧栏"]')).toHaveLength(1)
    expect(result.host.querySelector('[aria-label="打开底部终端"]')).not.toBeNull()

    result.host.querySelector<HTMLButtonElement>('[aria-label="打开底部终端"]')?.click()
    await nextTick()
    await Promise.resolve()
    await nextTick()

    expect(result.host.querySelector('[aria-label="底部终端面板"]')).not.toBeNull()
    expect(result.host.querySelector('[data-testid="single-right-context-rail"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="调整右侧栏宽度"]')).not.toBeNull()
    expect(result.host.querySelector('[aria-label="关闭底部终端"]')).not.toBeNull()
    expect(result.host.querySelectorAll('[aria-label="关闭右侧栏"]')).toHaveLength(1)

    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭右侧栏"]')?.click()
    await nextTick()
    expect(result.host.querySelector('[data-testid="single-right-context-rail"]')).toBeNull()
    expect(result.host.querySelector('[aria-label="底部终端面板"]')).not.toBeNull()

    result.host.querySelector<HTMLButtonElement>('[aria-label="关闭底部终端"]')?.click()
    await nextTick()
    expect(result.host.querySelector('[aria-label="底部终端面板"]')).toBeNull()
  })
})

describe('ChatPage Lab return', () => {
  it('does not put a return-to-Lab action in the conversation column', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ChatPage, {
      conversation: {
        id: 'lab-job-1',
        title: 'InjuredAndroid',
        createdAt: 1,
        messages: [{
          id: 'm1',
          role: 'user',
          content: '看登录页',
          timestamp: 1,
        }],
        domainTaskContext: {
          kind: 'lab',
          jobId: 'job-1',
          title: 'InjuredAndroid',
          scope: 'local',
          request: '看登录页怎么判成功。',
        },
      } satisfies Conversation,
      settings: null,
      workspacePath: '/tmp/lab',
      running: false,
      aborting: false,
      sessionReady: true,
      resumed: false,
      compacting: false,
      ctfSession: false,
      ensureConversation: () => 'lab-job-1',
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.querySelector('[aria-label="返回实验室"]')).toBeNull()
    expect(host.textContent).not.toContain('返回实验室')
  })
})
