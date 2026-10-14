// @vitest-environment jsdom
// 停滞看门狗 UI 回归：状态判定正确还不够，**界面必须明确呈现**，并给出「重试 / 停止」。
// 真事（2026-09-29 00:40）：模型请求挂死，界面却一直装活着地转圈，没有任何出口。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'

const runtimeStub = {
  activeProblemTurn: null as unknown,
  conversations: [] as Conversation[],
  pendingWorkspaceHome: null as unknown,
  forceStopConversation: vi.fn(),
  wakeStuckTurn: vi.fn(async () => true),
  restartEngine: vi.fn(async () => true),
  notifyTurnStall: vi.fn(),
  toggleDshPlanMode: () => undefined,
  streamStaleSeconds: 0,
  streamStale: false,
  activeStallKind: '' as '' | 'engine-gone' | 'model-stalled',
  activeEngineUnresponsive: false,
  activeEngineWarning: null as null | { at: number; stage: string; budgetMs: number; payloadBytes: number },
  store: { subscribe: () => () => undefined, getSnapshot: () => ({}) },
  setMultitask: () => undefined,
  selectedMultitask: false,
  runningConversationIds: [] as string[],
  dismissProblemTurn: () => undefined,
  dismissCrossConversationNotice: () => undefined,
  busySend: false,
  activeToolRunning: false,
  activeQueuedBehind: null as string | null,
  activeId: 'stalled-conversation',
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

function stalledConversation(): Conversation {
  return {
    id: 'stalled-conversation',
    title: '卡住的会话',
    createdAt: 0,
    messages: [
      { id: 'u-1', role: 'user', content: '把这件事做完', timestamp: 1 },
      // 事故的形状：一条空的 assistant 消息卡在那里，之后再无字节。
      { id: 'a-1', role: 'assistant', content: '', timestamp: 2, status: 'running' },
    ],
  }
}

async function renderChatPage() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const ChatPage = (await import('@/components/ChatPage')).default
  const conversation = stalledConversation()
  runtimeStub.conversations = [conversation]
  runtimeStub.activeId = conversation.id
  const element = (
    <ChatPage
      conversation={conversation}
      settings={null}
      workspacePath="/tmp/probe"
      running
      aborting={false}
      sessionReady
      resumed={false}
      compacting={false}
      ensureConversation={() => conversation.id}
    />
  )
  await act(async () => {
    root.render(element)
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  return { host, root, element }
}

function clickButton(host: HTMLElement, testid: string) {
  const button = host.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null
  expect(button, `expected ${testid} to be rendered`).not.toBeNull()
  return button as HTMLElement
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as unknown as Record<string, unknown>).escape = (value: string) => value
  runtimeStub.forceStopConversation.mockClear()
  runtimeStub.wakeStuckTurn.mockClear()
  runtimeStub.restartEngine.mockClear()
  runtimeStub.notifyTurnStall.mockClear()
  runtimeStub.streamStale = true
  runtimeStub.streamStaleSeconds = 130
  runtimeStub.activeStallKind = 'model-stalled'
  runtimeStub.activeToolRunning = false
  runtimeStub.activeQueuedBehind = null
  runtimeStub.activeEngineUnresponsive = false
  runtimeStub.activeEngineWarning = null
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage 停滞看门狗呈现', () => {
  it('shows an explicit stalled banner with the elapsed time and a Retry/Stop exit', async () => {
    const { host } = await renderChatPage()
    const banner = host.querySelector('[data-testid="stream-stale"]')
    expect(banner).not.toBeNull()
    // 明确说“已停滞”，而不是继续装活着。
    expect(banner?.textContent).toContain('已停滞')
    expect(banner?.textContent).toContain('2m 10.0s')
    // 两个真实出口都在。
    expect(host.querySelector('[data-testid="wake-stuck-turn"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="cancel-stuck-turn"]')).not.toBeNull()
  })

  it('Retry re-dispatches the last unanswered prompt through the runtime', async () => {
    const { host } = await renderChatPage()
    const retry = clickButton(host, 'wake-stuck-turn')
    await act(async () => { retry.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(runtimeStub.wakeStuckTurn).toHaveBeenCalledWith('stalled-conversation')
  })

  it('Stop hard-stops the stalled conversation', async () => {
    const { host } = await renderChatPage()
    const stop = clickButton(host, 'cancel-stuck-turn')
    await act(async () => { stop.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(runtimeStub.forceStopConversation).toHaveBeenCalledWith('stalled-conversation')
  })

  it('a long-running tool keeps the neutral “tool running” wording instead of stalling', async () => {
    runtimeStub.activeStallKind = ''
    runtimeStub.activeToolRunning = true
    const { host } = await renderChatPage()
    const banner = host.querySelector('[data-testid="stream-stale"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('工具执行中')
    expect(host.querySelector('[data-testid="stalled-turn"]')).toBeNull()
  })

  it('detects the dead process too: engine-gone wording without pretending progress', async () => {
    runtimeStub.activeStallKind = 'engine-gone'
    const { host } = await renderChatPage()
    const banner = host.querySelector('[data-testid="stream-stale"]')
    expect(banner?.textContent).toContain('已停滞')
    expect(banner?.textContent).toContain('心跳已停')
    expect(host.querySelector('[data-testid="wake-stuck-turn"]')).not.toBeNull()
  })

  it('进入停滞的边沿只发一次系统通知，持续停滞不重复发', async () => {
    const { root, element } = await renderChatPage()
    expect(runtimeStub.notifyTurnStall).toHaveBeenCalledTimes(1)
    expect(runtimeStub.notifyTurnStall).toHaveBeenCalledWith({
      conversationId: 'stalled-conversation',
      stallKind: 'model-stalled',
      quietMs: 130_000,
    })
    // 持续停滞：时长继续涨（每秒重渲染），但 stalled 没翻转 ⇒ 不再发。
    runtimeStub.streamStaleSeconds = 260
    await act(async () => { root.render(element) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(runtimeStub.notifyTurnStall).toHaveBeenCalledTimes(1)
  })

  it('没有停滞（工具在跑/排队）就不发通知', async () => {
    runtimeStub.activeStallKind = ''
    runtimeStub.activeToolRunning = true
    await renderChatPage()
    expect(runtimeStub.notifyTurnStall).not.toHaveBeenCalled()
  })

  it('预算软告警时把「为什么算停滞」换成预算与体积，而不是笼统的「停滞」', async () => {
    runtimeStub.activeEngineWarning = { at: 0, stage: 'ttfb', budgetMs: 17_900, payloadBytes: 3_313_500 }
    const { host } = await renderChatPage()
    const banner = host.querySelector('[data-testid="stream-stale"]')
    expect(banner?.textContent).toContain('超过等待预算')
    expect(banner?.textContent).toContain('3.2MB')
  })

  it('sidecar 不响应 abort 时给出「重启引擎」，且只有读者点了才动', async () => {
    runtimeStub.activeEngineUnresponsive = true
    const { host } = await renderChatPage()
    // 没有暂停/自动重启：只有按钮存在，重启函数未被调用。
    expect(runtimeStub.restartEngine).not.toHaveBeenCalled()
    const restart = clickButton(host, 'restart-engine')
    await act(async () => { restart.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(runtimeStub.restartEngine).toHaveBeenCalledWith('stalled-conversation')
  })

  it('sidecar 还在响应 abort 时不显示「重启引擎」', async () => {
    runtimeStub.activeEngineUnresponsive = false
    const { host } = await renderChatPage()
    expect(host.querySelector('[data-testid="restart-engine"]')).toBeNull()
  })
})
