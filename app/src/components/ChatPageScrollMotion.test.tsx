// @vitest-environment jsdom
// 回归：用户滚动（手势/惯性）期间，程序绝不能改写 scrollTop。
//
// 背景（真机症状「滚动没了惯性，展开思考时特别卡」）：ChatPage 的滚动管理器有两条会
// 直接写 scrollTop 的路径 —— 钉底跟随的 ResizeObserver、窗口滑动后的元素级锚定补偿。
// 浏览器里直接赋值 scrollTop 会打断正在进行的惯性滚动；流式输出/展开思考时高度频繁变化，
// 补偿就越频繁，滚动就越「涩」，手停即停。这里用真实 ChatPage 挂上探针，包住 scrollTop
// setter 统计「用户手势期间程序写入次数」：
//   - 修复前：探针 A（钉底 + 高度变化）= 1，探针 B（翻历史 + 窗口滑动）= 1；
//   - 修复后：两者都 = 0；同时对照用例守住「钉底跟随」与「窗口锚定」不被修坏。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Message } from '@/types'

const runtimeStub = {
  activeProblemTurn: null,
  conversations: [],
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
  activeCrossConversationNotices: [],
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

type ResizeCallback = () => void
type IntersectionCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void
const resizeCallbacks: ResizeCallback[] = []
const intersectionCallbacks: IntersectionCallback[] = []

class FakeResizeObserver {
  constructor(callback: ResizeCallback) { resizeCallbacks.push(callback) }
  observe() {}
  unobserve() {}
  disconnect() {}
}
class FakeIntersectionObserver {
  constructor(callback: IntersectionCallback) { intersectionCallbacks.push(callback) }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const BLOCK_HEIGHT = 120
const VIEW_HEIGHT = 800

function buildConversation(): Conversation {
  const messages: Message[] = []
  for (let index = 0; index < 300; index += 1) {
    messages.push({ id: `u-${index}`, role: 'user', content: `问题 ${index}`, timestamp: index * 2 })
    messages.push({ id: `a-${index}`, role: 'assistant', content: `回答 ${index}`, timestamp: index * 2 + 1, status: 'done' })
  }
  return { id: 'probe-conversation', title: '探针会话', createdAt: 0, messages }
}

const mountedRoots: Root[] = []
let gestureActive = false

function domRect(top: number, height: number) {
  return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

interface Instrumented {
  writes: Array<{ duringGesture: boolean; to: number }>
  scroller: HTMLElement
  setContentHeight: (height: number) => void
  setTop: (top: number) => void
  getTop: () => number
  blockRectTop: (id: string) => number | null
}

function installInstrumentation(host: HTMLElement, initialContentHeight: number): Instrumented {
  const scroller = host.querySelector('.chat-edge-scroll') as HTMLElement
  let top = 0
  let contentHeight = initialContentHeight
  const writes: Instrumented['writes'] = []

  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { writes.push({ duringGesture: gestureActive, to: value }); top = value },
  })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => contentHeight })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW_HEIGHT })

  const originalRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this === scroller) return domRect(0, VIEW_HEIGHT)
    if (this.hasAttribute && this.hasAttribute('data-transcript-block')) {
      const blocks = Array.from(scroller.querySelectorAll('[data-transcript-block]'))
      return domRect(blocks.indexOf(this) * BLOCK_HEIGHT - top, BLOCK_HEIGHT)
    }
    return originalRect.call(this)
  }

  return {
    writes,
    scroller,
    setContentHeight: (height: number) => { contentHeight = height },
    setTop: (value: number) => { top = value },
    getTop: () => top,
    blockRectTop: (id: string) => {
      const node = scroller.querySelector<HTMLElement>(`[data-transcript-block="${id}"]`)
      return node ? node.getBoundingClientRect().top : null
    },
  }
}

async function renderChatPage() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const ChatPage = (await import('@/components/ChatPage')).default
  const conversation = buildConversation()
  await act(async () => {
    root.render(
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
      />,
    )
  })
  // 让挂载时的贴尾 rAF / 定时器先跑完，避免把安装噪声算进手势测量。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  return host
}

function firstTopSentinel(host: HTMLElement): Element | null {
  return host.querySelector('.chat-edge-scroll > .agent-thread > div.h-px')
}

/** 把滚动器停在「已上翻」的位置：先模拟一次向上滚动取消钉底，再落到顶部附近。 */
async function scrollUpIntoHistory(inst: Instrumented, contentHeight: number) {
  inst.setTop(contentHeight - VIEW_HEIGHT - 300)
  await act(async () => { inst.scroller.dispatchEvent(new Event('scroll', { bubbles: true })) })
  inst.setTop(100)
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  resizeCallbacks.length = 0
  intersectionCallbacks.length = 0
  gestureActive = false
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as unknown as Record<string, unknown>).escape = (value: string) => value
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
})

describe('ChatPage 用户滚动期间的 scrollTop 程序写入', () => {
  it('钉底时，用户 wheel 手势期间内容高度变化不写 scrollTop（探针 A，修复前为 1）', async () => {
    const host = await renderChatPage()
    const contentHeight = 400 * BLOCK_HEIGHT
    const inst = installInstrumentation(host, contentHeight)
    inst.setTop(contentHeight - VIEW_HEIGHT)

    gestureActive = true
    const before = inst.writes.length
    await act(async () => {
      inst.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      // 模拟流式输出 / 展开思考：thread 高度变化触发 ResizeObserver
      inst.setContentHeight(contentHeight + 200)
      for (const callback of resizeCallbacks) callback()
    })
    const during = inst.writes.length - before
    gestureActive = false
    expect(during).toBe(0)
  }, 30000)

  it('翻历史时，用户 wheel 手势期间窗口滑动锚定不写 scrollTop（探针 B，修复前为 1）', async () => {
    const host = await renderChatPage()
    const contentHeight = 400 * BLOCK_HEIGHT
    const inst = installInstrumentation(host, contentHeight)
    await scrollUpIntoHistory(inst, contentHeight)

    gestureActive = true
    const before = inst.writes.length
    await act(async () => {
      inst.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      // 惯性期间 scroll 事件持续触发（同时顺延手势计时器）
      inst.setTop(inst.getTop() - 5)
      inst.scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      intersectionCallbacks[intersectionCallbacks.length - 1]?.([{ isIntersecting: true, target: firstTopSentinel(host)! }])
    })
    const during = inst.writes.length - before
    gestureActive = false
    expect(during).toBe(0)
  }, 30000)

  it('对照：没有用户手势时，钉底跟随照常写 scrollTop（钉底行为不能坏）', async () => {
    const host = await renderChatPage()
    const contentHeight = 400 * BLOCK_HEIGHT
    const inst = installInstrumentation(host, contentHeight)
    inst.setTop(contentHeight - VIEW_HEIGHT)

    const before = inst.writes.length
    await act(async () => {
      inst.setContentHeight(contentHeight + 200)
      for (const callback of resizeCallbacks) callback()
    })
    expect(inst.writes.length - before).toBeGreaterThan(0)
    expect(inst.getTop()).toBe(contentHeight + 200)
  }, 30000)

  it('对照：手势期间推迟的窗口滑动，在滚动结束后补做且锚点视口位置不变（锚定行为不能坏）', async () => {
    const host = await renderChatPage()
    const contentHeight = 400 * BLOCK_HEIGHT
    const inst = installInstrumentation(host, contentHeight)
    await scrollUpIntoHistory(inst, contentHeight)

    const anchorId = inst.scroller.querySelectorAll<HTMLElement>('[data-transcript-block]')[0].dataset.transcriptBlock!

    gestureActive = true
    const beforeGesture = inst.writes.length
    await act(async () => {
      inst.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
      inst.setTop(inst.getTop() - 5)
      inst.scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      intersectionCallbacks[intersectionCallbacks.length - 1]?.([{ isIntersecting: true, target: firstTopSentinel(host)! }])
    })
    const duringGesture = inst.writes.length - beforeGesture
    gestureActive = false

    const anchorTopBefore = inst.blockRectTop(anchorId)
    const beforeEnd = inst.writes.length
    await act(async () => { inst.scroller.dispatchEvent(new Event('scrollend')) })
    const afterEnd = inst.writes.length - beforeEnd
    const anchorTopAfter = inst.blockRectTop(anchorId)

    expect(duringGesture).toBe(0)
    expect(afterEnd).toBeGreaterThan(0)
    expect(anchorTopAfter).not.toBeNull()
    expect(Math.abs((anchorTopAfter as number) - (anchorTopBefore as number))).toBeLessThan(1)
  }, 20000)
})
