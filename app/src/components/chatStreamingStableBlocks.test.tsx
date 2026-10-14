// @vitest-environment jsdom
// 回归（第四条独立卡死路径）：巨型对话 + 流式时，**未变的折叠块不能再重渲染**。
//
// 真机事故（β.163，2026-09-29 15:16）：2.1 万条对话挂在前台、agent 流式输出 read/edit 结果，
// 主线程彻底堵死（CDP `1+1` 45s+ 无返回、CPU 120~135% 十分钟不降）。
// 根因是 memo 边界被击穿：每个流式增量都会把 `conversation.messages` 换成新数组，
// `buildChatTranscript` 于是重建**所有**块对象 ⇒ 可见窗口里每一个 `ChatProcessFold`
// 的 `process`/`model` prop 身份都变一次 ⇒ 185 个折叠块每增量整窗重渲染（真机实测 ~80ms/增量）
// ⇒ 主线程被流式喂满，看起来就是死机。
//
// 修复：`createChatTranscriptBuilder` 复用未变块的对象身份 + 折叠模型按
// (块身份 + 上下文签名) 复用 ⇒ 只有真正变了的尾部块重渲染。
// 这条测试卡住「未变折叠块一律 0 重渲染」。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Message } from '@/types'

const counts = vi.hoisted(() => ({ fold: 0, item: 0 }))

const runtimeStub = {
  activeProblemTurn: null,
  conversations: [] as Conversation[],
  pendingWorkspaceHome: null,
  forceStopConversation: () => undefined,
  toggleDshPlanMode: () => undefined,
  streamStaleSeconds: 0,
  streamStale: false,
  store: { subscribe: () => () => undefined, getSnapshot: () => ({}) },
  setMultitask: () => undefined,
  selectedMultitask: false,
  runningConversationIds: [],
  dismissProblemTurn: () => undefined,
  dismissCrossConversationNotice: () => undefined,
  busySend: false,
  activeToolRunning: false,
  activeQueuedBehind: null,
  activeId: '',
  activeForceStopReady: false,
  activeEngineAlive: false,
  activeStallKind: '' as '' | 'engine-gone' | 'model-stalled',
  wakeStuckTurn: () => undefined,
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
  return { ...actual, invokeCommand: () => new Promise(() => undefined), listenEvent: () => Promise.resolve(() => undefined) }
})
vi.mock('@/modelCatalog', async importOriginal => {
  const actual = await importOriginal<typeof import('@/modelCatalog')>()
  return {
    ...actual,
    useLiveModelCatalog: () => ({
      snapshot: { providers: [], relay: null, includeUnconfigured: false },
      providers: [], providerGroups: [], pickerGroups: [],
      providerModelLabel: () => '', pickerModelLabel: () => '',
    }),
  }
})

// 计数用真实组件：外面再包一层 memo(计数桩)，把每组件的渲染次数记下来。
vi.mock('@/components/ChatProcessFold', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ChatProcessFold')>()
  const React = await import('react')
  return {
    default: React.memo((props: Record<string, unknown>) => {
      counts.fold += 1
      return React.createElement(actual.default as never, props as never)
    }),
  }
})
vi.mock('@/components/ChatMessageItem', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ChatMessageItem')>()
  const React = await import('react')
  return {
    default: React.memo((props: Record<string, unknown>) => {
      counts.item += 1
      return React.createElement(actual.default as never, props as never)
    }),
  }
})

class FakeResizeObserver { constructor(_c: unknown) {} observe() {} unobserve() {} disconnect() {} }
class FakeIntersectionObserver { constructor(_c: unknown) {} observe() {} unobserve() {} disconnect() {} }

// 12 轮「user → 只想不说的 assistant → read 工具」，每轮合成一个 process 折叠块；
// 最后一轮留一条**可见正文**的 assistant，用它承载流式增量。
function buildConversation(): Conversation {
  const messages: Message[] = []
  for (let i = 0; i < 12; i += 1) {
    messages.push({ id: `u-${i}`, role: 'user', content: `问题 ${i}`, timestamp: i * 4 })
    messages.push({
      id: `t-${i}`,
      role: 'assistant',
      content: '',
      thinking: `第 ${i} 轮思考`,
      thinkingStatus: 'done',
      thinkingDurationMs: 1500,
      timestamp: i * 4 + 1,
      status: 'done',
    })
    messages.push({
      id: `r-${i}`,
      role: 'tool',
      content: `/repo/file-${i}.ts`,
      toolName: 'read',
      toolCallId: `call-${i}`,
      timestamp: i * 4 + 2,
      status: 'done',
    })
  }
  messages.push({ id: 'u-last', role: 'user', content: '继续', timestamp: 100 })
  messages.push({
    id: 'a-last',
    role: 'assistant',
    content: '开始输出',
    timestamp: 101,
    status: 'running',
  })
  return { id: 'stream-conversation', title: '流式', createdAt: 0, messages }
}

const mountedRoots: Root[] = []

beforeEach(() => {
  counts.fold = 0
  counts.item = 0
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (v: string) => v }
})
afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

describe('流式增量不击穿未变折叠块的 memo', () => {
  it('only the changed tail block re-renders; every untouched fold stays put', async () => {
    const conversation = buildConversation()
    runtimeStub.conversations = [conversation]
    runtimeStub.activeId = conversation.id
    const ChatPage = (await import('@/components/ChatPage')).default

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mountedRoots.push(root)

    const render = async (conv: Conversation) => {
      await act(async () => {
        root.render(
          <ChatPage conversation={conv} settings={null} workspacePath="/tmp/probe" running aborting={false}
            sessionReady resumed={false} compacting={false} ensureConversation={() => conv.id} />,
        )
        await new Promise(r => setTimeout(r, 0))
      })
    }

    await render(conversation)
    // 前提：这 12 个折叠块真的都挂上了（否则测试没有意义）。
    expect(host.querySelectorAll('[data-transcript-block]').length).toBeGreaterThanOrEqual(12)
    const foldsOnMount = counts.fold
    expect(foldsOnMount).toBeGreaterThanOrEqual(12)

    // 模拟一次流式增量：只有尾部 assistant 的内容变了（其余消息对象原样保留）。
    counts.fold = 0
    counts.item = 0
    const messages = conversation.messages.slice()
    const last = { ...messages[messages.length - 1] }
    last.content = `${String(last.content)}，又收到一段增量`
    messages[messages.length - 1] = last
    await render({ ...conversation, messages })

    // 只有承载增量的那一条消息重渲染；12 个未变折叠块必须一个都不动。
    expect(counts.fold).toBe(0)
    expect(counts.item).toBe(1)
  })
})
