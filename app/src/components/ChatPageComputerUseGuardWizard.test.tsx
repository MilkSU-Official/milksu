// @vitest-environment jsdom
// 权限向导自动触发（β.191 真机死循环修复）的 ChatPage 接线：agent 在对话里调
// lock_computer_use_window 撞权限守卫，界面上什么都不弹、读者只能瞎摸索。现在
// store 信号（useConversations 的 engine-event 投影）一到 ⇒ 三态向导自动打开，
// 对话本身保持当前状态（不切面板、不打断）。此处验证消费端行为：翻转 / 幂等 /
// dock 不弹 / 过期不弹。信号的产出与去抖在 useConversationsComputerUseGuard.test.ts。
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'
import type { ComputerUsePermissionGuardSignal } from '@/lib/codingComputerUsePermissionWizard'

const runtimeStub = {
  activeProblemTurn: null as unknown,
  activeEngineRecovery: null,
  activeModelRetry: null,
  activeQueuedMessage: null,
  activeEngineWarning: null,
  computerUsePermissionGuard: null as ComputerUsePermissionGuardSignal | null,
  consumeComputerUsePermissionGuard: () => { runtimeStub.computerUsePermissionGuard = null },
  conversations: [] as Conversation[],
  pendingWorkspaceHome: null as unknown,
  forceStopConversation: vi.fn(),
  wakeStuckTurn: vi.fn(async () => true),
  restartEngine: vi.fn(async () => true),
  notifyTurnStall: vi.fn(),
  toggleDshPlanMode: () => undefined,
  streamStaleSeconds: 0,
  streamStale: false,
  activeStallKind: '',
  activeEngineUnresponsive: false,
  store: { subscribe: () => () => undefined, getSnapshot: () => ({}) },
  setMultitask: () => undefined,
  selectedMultitask: false,
  runningConversationIds: [] as string[],
  dismissProblemTurn: () => undefined,
  dismissCrossConversationNotice: () => undefined,
  busySend: false,
  activeToolRunning: false,
  activeQueuedBehind: null as string | null,
  activeId: 'guard-conversation',
  activeForceStopReady: false,
  activeEngineAlive: false,
  activeCrossConversationNotices: [] as unknown[],
  abortWorkingItem: () => undefined,
  abortWorkingAll: () => undefined,
}

vi.mock('@/stores/conversationsStore', () => ({
  useConversations: () => runtimeStub,
  ConversationsProvider: ({ children }: { children: unknown }) => children,
}))

vi.mock('@/desktop', async importOriginal => {
  const actual = await importOriginal<typeof import('@/desktop')>()
  return {
    ...actual,
    invokeCommand: () => new Promise(() => undefined),
    listenEvent: () => Promise.resolve(() => undefined),
  }
})

vi.mock('@/modelCatalog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/modelCatalog')>()
  return {
    ...actual,
    useLiveModelCatalog: () => ({
      snapshot: { providers: [], relay: null, includeUnconfigured: false },
      providers: [],
      providerGroups: [],
      pickerGroups: [],
      providerModelLabel: () => '',
      pickerModelLabel: () => '',
    }),
  }
})

const mountedRoots: Root[] = []

class FakeResizeObserver {
  constructor(_callback: () => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
class FakeIntersectionObserver {
  constructor(_callback: () => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

const guardText = '请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'

function guardConversation(): Conversation {
  return {
    id: 'guard-conversation',
    title: '撞墙会话',
    createdAt: 0,
    messages: [
      { id: 'u-1', role: 'user', content: '把窗口锁到备忘录上', timestamp: 1 },
      { id: 't-1', role: 'tool', content: guardText, toolName: 'milksu_workspace', toolCallId: 'call-1', timestamp: 2, status: 'done' },
    ],
  }
}

type ChatPageComponent = (props: Record<string, unknown>) => ReactElement

let ChatPageComponentRef: ChatPageComponent | null = null

function buildElement(conversation: Conversation, surface?: 'dock'): ReactElement {
  const ChatPage = ChatPageComponentRef as ChatPageComponent
  return (
    <ChatPage
      {...(surface ? { surface } : {})}
      conversation={conversation}
      settings={null}
      workspacePath="/tmp/probe"
      running
      aborting={false}
      sessionReady
      resumed={false}
      compacting={false}
      ctfSession={false}
      ensureConversation={() => conversation.id}
    />
  )
}

async function mountChatPage(surface?: 'dock') {
  if (!ChatPageComponentRef) {
    ChatPageComponentRef = (await import('@/components/ChatPage')).default as ChatPageComponent
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const conversation = guardConversation()
  runtimeStub.conversations = [conversation]
  runtimeStub.activeId = conversation.id
  await act(async () => {
    root.render(buildElement(conversation, surface))
  })
  return { host, root, conversation }
}

function rerender(root: Root, conversation: Conversation, surface?: 'dock') {
  return act(async () => {
    root.render(buildElement(conversation, surface))
  })
}

function wizardOpen() {
  return document.body.textContent?.includes('开启 Computer Use') ?? false
}

function wizardErrorText() {
  return document.body.querySelector('.computer-use-permission-dialog [role="alert"]')?.textContent ?? ''
}

beforeEach(async () => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as unknown as Record<string, unknown>).escape = (value: string) => value
  runtimeStub.computerUsePermissionGuard = null
  const { applyUiLocale } = await import('@/lib/uiLocale')
  applyUiLocale('zh')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage 权限向导自动触发', () => {
  it('锁窗守卫信号到达 ⇒ 向导打开，守卫原文进错误行；对话不打断（转写还在、不切面板）', async () => {
    const { host } = await mountChatPage()
    expect(wizardOpen()).toBe(false)
    runtimeStub.computerUsePermissionGuard = {
      conversationId: 'guard-conversation',
      notice: guardText,
      at: Date.now(),
    }
    const root = mountedRoots[0]!
    await rerender(root, guardConversation())
    expect(wizardOpen()).toBe(true)
    expect(wizardErrorText()).toContain(guardText)
    // 消费即清：信号不残留（重挂载不翻旧账）。
    expect(runtimeStub.computerUsePermissionGuard).toBeNull()
    // 对话保持当前状态：转写还在原处（用户消息与失败的工具结果都可见）。
    expect(host.textContent).toContain('把窗口锁到备忘录上')
  })

  it('幂等：向导已开着时新信号不重弹、不重复消费', async () => {
    await mountChatPage()
    runtimeStub.computerUsePermissionGuard = {
      conversationId: 'guard-conversation',
      notice: guardText,
      at: Date.now(),
    }
    const root = mountedRoots[0]!
    await rerender(root, guardConversation())
    expect(wizardOpen()).toBe(true)
    // agent 又撞了一次墙（新信号、同对话）——向导开着 ⇒ 不动。
    const secondSignal = {
      conversationId: 'guard-conversation',
      notice: guardText,
      at: Date.now() + 1_000,
    }
    runtimeStub.computerUsePermissionGuard = secondSignal
    await rerender(root, guardConversation())
    expect(wizardOpen()).toBe(true)
    expect(document.body.querySelectorAll('.computer-use-permission-dialog').length).toBe(1)
    // 没被消费：信号原样保留。
    expect(runtimeStub.computerUsePermissionGuard).toBe(secondSignal)
  })

  it('过期信号不弹（几分钟前的守卫失败不该在重挂载时翻旧账）', async () => {
    const { host } = await mountChatPage()
    const staleSignal = {
      conversationId: 'guard-conversation',
      notice: guardText,
      at: Date.now() - 10 * 60_000,
    }
    runtimeStub.computerUsePermissionGuard = staleSignal
    const root = mountedRoots[0]!
    await rerender(root, guardConversation())
    expect(wizardOpen()).toBe(false)
    // 没消费（留给真到点的事件自己来）。
    expect(runtimeStub.computerUsePermissionGuard).toBe(staleSignal)
    expect(host.textContent).toContain('把窗口锁到备忘录上')
  })

  it('dock 挂载的 ChatPage 不弹（主界面负责，避免双弹）', async () => {
    await mountChatPage('dock')
    runtimeStub.computerUsePermissionGuard = {
      conversationId: 'guard-conversation',
      notice: guardText,
      at: Date.now(),
    }
    const root = mountedRoots[0]!
    await rerender(root, guardConversation(), 'dock')
    expect(wizardOpen()).toBe(false)
    expect(runtimeStub.computerUsePermissionGuard).not.toBeNull()
  })

  it('没有信号（非权限类失败根本不会产生信号）⇒ 向导不出现', async () => {
    await mountChatPage()
    // 非权限失败：store 不会写信号（useConversationsComputerUseGuard.test.ts 已卡），
    // 这里只验证「无信号 ⇒ 无向导」的静默路径。
    const root = mountedRoots[0]!
    await rerender(root, guardConversation())
    expect(wizardOpen()).toBe(false)
  })
})
