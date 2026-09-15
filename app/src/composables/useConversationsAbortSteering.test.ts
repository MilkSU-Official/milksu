// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function storedConversation(id: string) {
  return { id, title: id, createdAt: 1, messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations abort confirmation', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // AbortMessage only submits the interrupt. If Pi never answers with a terminal
  // event the stop button stayed disabled forever; it must become retryable.
  it('releases the stop button when the engine never confirms the abort', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeRunning).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting).toBe(true)
    expect(conversations.activeAbortStalled).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAborting).toBe(false)
    expect(conversations.activeAbortStalled).toBe(true)

    await conversations.abort('conversation-1')
    expect(conversations.activeAborting).toBe(true)
    expect(conversations.activeAbortStalled).toBe(false)
  })

  it('clears the stalled stop state once the turn actually settles', async () => {
    vi.useFakeTimers()
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.abort('conversation-1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(conversations.activeAbortStalled).toBe(true)

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.activeAbortStalled).toBe(false)
  })
})

describe('useConversations steering delivery', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A steering message must never disappear silently. When the turn settles
  // before Pi consumed it, it stays visible as an undelivered queue entry.
  it('keeps unconsumed steering visible when the turn settles', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')

    expect(conversations.activeMessageQueue.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.stalled).toBeUndefined()

    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.steering).toEqual(['先保留修改'])
    expect(conversations.activeMessageQueue.stalled).toBe(true)
  })

  it('drops the undelivered marker once Pi reports an empty queue', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    await conversations.send('先保留修改')
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeMessageQueue.stalled).toBe(true)

    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: [] })
    expect(conversations.activeMessageQueue.steering).toEqual([])
    expect(conversations.activeMessageQueue.stalled).toBeFalsy()
  })
})

describe('useConversations engine stop scoping', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // A session-less engine.stopped used to clear every running conversation.
  // A turn on another engine instance must keep its running state.
  it('keeps a concurrent turn on another engine running', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi', title: 'pi', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-dsh', title: 'dsh', createdAt: 2, kernel: 'dsh', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi', { type: 'assistant.started' })
    emit('conversation-dsh', { type: 'assistant.started' })
    expect([...conversations.runningConversationIds].sort())
      .toEqual(['conversation-dsh', 'conversation-pi'])

    emit('', { type: 'engine.stopped', engine: 'pi', sessions: ['conversation-pi'], error: 'sidecar exited' })
    expect(conversations.runningConversationIds).toEqual(['conversation-dsh'])
    const stopped = conversations.conversations.find(item => item.id === 'conversation-pi')
    const survivor = conversations.conversations.find(item => item.id === 'conversation-dsh')
    expect(String(stopped?.messages.at(-1)?.content)).toContain('Agent 已停止')
    expect(survivor?.messages.some(message => String(message.content).includes('Agent 已停止'))).toBe(false)
  })

  it('clears every session served by the stopped engine', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [
      { id: 'conversation-pi-a', title: 'a', createdAt: 1, kernel: 'pi', messages: [] },
      { id: 'conversation-pi-b', title: 'b', createdAt: 2, kernel: 'pi', messages: [] },
    ]
    await conversations.load()
    await conversations.listen()
    emit('conversation-pi-a', { type: 'assistant.started' })
    emit('conversation-pi-b', { type: 'assistant.started' })
    expect(conversations.runningConversationIds).toHaveLength(2)

    emit('', {
      type: 'engine.protocol_error',
      engine: 'pi',
      sessions: ['conversation-pi-a', 'conversation-pi-b'],
      error: 'stream closed',
    })
    expect(conversations.runningConversationIds).toEqual([])
  })

  // Without an engine identity there is nothing safe to notify: broadcasting a
  // stop marked seven unrelated sessions as stopped on 2026-09-13.
  it('does not broadcast a stop that carries no session identity', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1'), storedConversation('conversation-2')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    emit('conversation-2', { type: 'assistant.started' })
    expect(conversations.runningConversationIds).toHaveLength(2)

    emit('', { type: 'engine.stopped', engine: 'pi', error: 'signal: killed' })

    expect([...conversations.runningConversationIds].sort())
      .toEqual(['conversation-1', 'conversation-2'])
    const messages = conversations.conversations.flatMap(item => item.messages)
    expect(messages.some(message => String(message.content).includes('Agent 已停止'))).toBe(false)
  })
})

describe('useConversations run-state recovery', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
  })

  // The running marker used to be set only at assistant.started, so one cleared
  // marker hid the rest of a long turn. In-turn events must restore it.
  it('restores a running marker cleared by an engine stop', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.runningConversationIds).toEqual(['conversation-1'])

    emit('', { type: 'engine.stopped', engine: 'pi', sessions: ['conversation-1'], error: 'signal: killed' })
    expect(conversations.runningConversationIds).toEqual([])

    emit('conversation-1', { type: 'assistant.delta', text: '还在跑' })
    expect(conversations.runningConversationIds).toEqual(['conversation-1'])
  })

  it('restores the running marker from a tool event too', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'

    emit('conversation-1', { type: 'tool.started', text: 'bash', toolName: 'bash', toolCallId: 'c1' })
    expect(conversations.runningConversationIds).toEqual(['conversation-1'])
  })

  // A session whose running marker was already gone still has to be told that its
  // engine died, otherwise that turn dies silently.
  it('covers sessions that only still show a running turn', async () => {
    const { projectEngineStopAffected } = await import('@/composables/useConversations')
    const runningTool = {
      id: 'm1',
      role: 'tool',
      content: 'sleep 600',
      timestamp: 1,
      toolName: 'bash',
      status: 'running',
    }
    const conversations = [
      { id: 'residue', title: 'r', createdAt: 1, kernel: 'pi', messages: [runningTool] },
      { id: 'marked', title: 'm', createdAt: 2, kernel: 'pi', messages: [] },
      { id: 'other-engine', title: 'o', createdAt: 3, kernel: 'dsh', messages: [runningTool] },
    ] as unknown as Parameters<typeof projectEngineStopAffected>[0]

    expect(projectEngineStopAffected(conversations, new Set(['marked']), 'pi'))
      .toEqual(['residue', 'marked'])
  })
})
