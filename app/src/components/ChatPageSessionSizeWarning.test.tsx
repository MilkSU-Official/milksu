// @vitest-environment jsdom
// 会话过胖预警 UI 回归：超过阈值收成一枚小指示（点开才展开），且**不阻断**（可压缩、可继续用）。
// 2026-09-30 用户拍板：全宽横幅 → composer footer 左侧小 pill；「知道了」要持久化。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  toggleDshPlanMode: () => undefined,
  streamStaleSeconds: 0,
  streamStale: false,
  activeStallKind: '' as '' | 'engine-gone' | 'model-stalled',
  store: { subscribe: () => () => undefined, getSnapshot: () => ({}) },
  setMultitask: () => undefined,
  selectedMultitask: false,
  runningConversationIds: [] as string[],
  dismissProblemTurn: () => undefined,
  dismissCrossConversationNotice: () => undefined,
  busySend: false,
  activeToolRunning: false,
  activeQueuedBehind: null as string | null,
  activeId: 'fat-conversation',
  activeForceStopReady: false,
  activeEngineAlive: true,
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

// jsdom 不做排版，所以「真的能点」只能靠结构守住：小指示必须落在 dock 白名单里的
// `.chat-composer__island` 内，展开的面板由 Radix portal 到 body、不在 pointer-events:none
// 的 dock 里。上一版横幅就是死在 pointer-events 上（看得见按不动），这里用 CSS 源文件兜底。
const rawCss = readFileSync(resolve(process.cwd(), 'src/styles/agent-conversation.css'), 'utf8')
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')

function conversationWith(chars: number): Conversation {
  return {
    id: 'fat-conversation',
    title: '很大的会话',
    createdAt: 0,
    messages: [
      { id: 'u-1', role: 'user', content: 'x'.repeat(chars), timestamp: 1 },
      { id: 'a-1', role: 'assistant', content: 'done', timestamp: 2 },
    ],
  }
}

async function renderChatPage(
  chars: number,
  options: { onCompactContext?: () => void; compacting?: boolean } = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)
  const ChatPage = (await import('@/components/ChatPage')).default
  const conversation = conversationWith(chars)
  runtimeStub.conversations = [conversation]
  runtimeStub.activeId = conversation.id
  await act(async () => {
    root.render(
      <ChatPage
        conversation={conversation}
        settings={null}
        workspacePath="/tmp/probe"
        running={false}
        aborting={false}
        sessionReady
        resumed={false}
        compacting={options.compacting ?? false}
        ensureConversation={() => conversation.id}
        onCompactContext={options.onCompactContext}
      />,
    )
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  return { host, root }
}

function pillIn(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="session-size-warning"]')
}

function panelIn(): HTMLElement | null {
  return document.querySelector('[data-testid="session-size-warning-panel"]')
}

async function openWarningPanel(host: HTMLElement): Promise<HTMLElement> {
  const pill = pillIn(host)
  expect(pill).not.toBeNull()
  await act(async () => {
    pill?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const panel = panelIn()
  expect(panel).not.toBeNull()
  return panel as HTMLElement
}

async function clickIn(target: HTMLElement | null) {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
  ;(globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver
  if (typeof CSS === 'undefined') (globalThis as unknown as Record<string, unknown>).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as unknown as Record<string, unknown>).escape = (value: string) => value
  window.localStorage.clear()
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount()
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('ChatPage 会话过胖预警呈现', () => {
  it('stays silent below the threshold', async () => {
    const { host } = await renderChatPage(64 * 1024)
    expect(pillIn(host)).toBeNull()
  })

  it('collapses into a small pill next to the context meter (even without meter data)', async () => {
    const { host } = await renderChatPage(2.5 * 1024 * 1024)
    const pill = pillIn(host)
    expect(pill).not.toBeNull()
    // 收起态：一短枚指示，文案里有体积，但没有展开的全文。
    expect(pill?.textContent).toContain('MB')
    expect(pill?.textContent).not.toContain('请求容易超时')
    expect(panelIn()).toBeNull()
    // 上下文表没有数据（contextUsage 为 null）时 footerEnd 原本不渲染，小指示也要照常待在那。
    expect(host.querySelector('[data-testid="context-usage-meter"]')).toBeNull()
    expect(pill?.closest('.chat-composer__meta-end')).not.toBeNull()
  })

  it('expands the full advice and buttons only after a click', async () => {
    const onCompact = vi.fn()
    const { host } = await renderChatPage(2.5 * 1024 * 1024, { onCompactContext: onCompact })
    const panel = await openWarningPanel(host)
    expect(panel.textContent).toContain('请求容易超时')
    expect(panel.textContent).toContain('压缩')
    expect(panel.textContent).toContain('新开')
    expect(panel.textContent).toContain('MB')

    const compact = panel.querySelector('[data-testid="session-size-compact"]') as HTMLElement | null
    const dismiss = panel.querySelector('[data-testid="session-size-dismiss"]') as HTMLElement | null
    expect(compact?.getAttribute('type')).toBe('button')
    expect(dismiss?.getAttribute('type')).toBe('button')

    await clickIn(compact)
    expect(onCompact).toHaveBeenCalledTimes(1)
    // 预警不是阻断：压缩动作不该顺手把会话弄没，提示仍在。
    expect(pillIn(host)).not.toBeNull()
  })

  it('hides the compact button while a compaction is already running', async () => {
    const { host } = await renderChatPage(2.5 * 1024 * 1024, { onCompactContext: vi.fn(), compacting: true })
    const panel = await openWarningPanel(host)
    expect(panel.querySelector('[data-testid="session-size-compact"]')).toBeNull()
    expect(panel.querySelector('[data-testid="session-size-dismiss"]')).not.toBeNull()
  })

  it('“知道了” hides the pill and survives a simulated restart', { timeout: 20000 }, async () => {
    const first = await renderChatPage(2.5 * 1024 * 1024)
    const panel = await openWarningPanel(first.host)
    await clickIn(panel.querySelector('[data-testid="session-size-dismiss"]'))
    expect(pillIn(first.host)).toBeNull()
    expect(window.localStorage.getItem('milksu.session-size-dismissed.v1')).toContain('fat-conversation:1')

    // 模拟重开：卸载旧实例、清掉 DOM，再用同一份 localStorage 挂一个全新实例。
    await act(async () => { first.root.unmount() })
    const index = mountedRoots.indexOf(first.root)
    if (index >= 0) mountedRoots.splice(index, 1)
    document.body.innerHTML = ''

    const second = await renderChatPage(2.5 * 1024 * 1024)
    expect(pillIn(second.host)).toBeNull()
  })

  it('re-arms the warning once the conversation grows another tier', { timeout: 20000 }, async () => {
    const first = await renderChatPage(2.5 * 1024 * 1024)
    const panel = await openWarningPanel(first.host)
    await clickIn(panel.querySelector('[data-testid="session-size-dismiss"]'))
    expect(pillIn(first.host)).toBeNull()

    await act(async () => { first.root.unmount() })
    const index = mountedRoots.indexOf(first.root)
    if (index >= 0) mountedRoots.splice(index, 1)
    document.body.innerHTML = ''

    // 同一个会话再涨一档（比例从 1 档到 3 档）→ key 变了 → 重新提醒。
    const second = await renderChatPage(6 * 1024 * 1024)
    expect(pillIn(second.host)).not.toBeNull()
  })

  it('keeps the pill clickable: inside the whitelisted island, panel portaled outside the dock', async () => {
    const { host } = await renderChatPage(2.5 * 1024 * 1024, { onCompactContext: vi.fn() })
    const pill = pillIn(host)
    expect(pill).not.toBeNull()
    expect(pill?.getAttribute('type')).toBe('button')
    // 小指示落在 dock pointer-events 白名单里的 composer island 内（见下方 CSS 断言）。
    expect(pill?.closest('.chat-composer__island')).not.toBeNull()

    const panel = await openWarningPanel(host)
    const dock = host.querySelector('.chat-column__dock')
    expect(dock).not.toBeNull()
    // 展开的面板 portal 到 body：不在 pointer-events:none 的 dock 内，也不会被 chat-edge-scroll 盖住。
    expect(dock?.contains(panel)).toBe(false)
    expect(panel.closest('.chat-column__dock')).toBeNull()
    // 收起态与展开后的按钮都必须是真按钮（上一版横幅就是按钮按不动）。
    expect(panel.querySelector('[data-testid="session-size-compact"]')?.getAttribute('type')).toBe('button')

    // 白名单必须仍然罩住 composer island；旧的横幅类已随横幅一起清理（新的 -pill 后缀不算）。
    expect(css).toContain('.chat-column__dock .chat-composer__island,')
    expect(css).not.toMatch(/\.session-size-warning(?!-)/)
  })
})
