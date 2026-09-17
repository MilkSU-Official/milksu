// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composerRunPhase,
  composerShowsStop,
  parentHasActiveTurnResidue,
} from '@/lib/composerRunState'
import {
  liveWorkingItems,
  workingItemsForConversation,
} from '@/lib/workingRoster'
import type { ConversationsRuntime } from '@/composables/useConversations'
import type { AgentKernel } from '@/lib/agentKernel'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()

const invokeCommand = vi.fn(async (command: string) => {
  if (command === 'list_conversations') return []
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  if (command === 'save_conversation') return null
  if (command === 'send_message') return null
  if (command === 'ensure_coding_artifact_workspace') return ''
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

function phaseFor(conversations: ConversationsRuntime, id: string) {
  const conversation = conversations.conversations.find(item => item.id === id)
  const kernel: AgentKernel = conversation?.kernel === 'dsh' ? 'dsh' : 'pi'
  const liveWorkingCount = liveWorkingItems(workingItemsForConversation(
    conversation,
    conversations.conversations,
    conversations.runningConversationIds,
  )).length
  return composerRunPhase({
    kernel,
    parentMarkedRunning: conversations.runningConversationIds.includes(id),
    aborting: conversations.activeId === id && conversations.activeAborting,
    compacting: conversations.activeId === id && conversations.activeCompacting,
    liveWorkingCount,
    parentHasActiveTurnResidue: parentHasActiveTurnResidue(
      conversation?.messages ?? [],
      kernel,
      { liveWorkingCount },
    ),
  })
}

describe('default kernel and DSH multitask children', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockReset()
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_conversations') return []
      if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
      if (command === 'save_conversation') return null
      if (command === 'send_message') return null
      if (command === 'ensure_coding_artifact_workspace') return ''
      return null
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('uses Pi as the factory default kernel for a new conversation', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.startNew()
    const id = conversations.ensureConversation('task')
    expect(conversations.conversations.find(item => item.id === id)?.kernel).toBe('pi')
    conversations.dispose()
  })

  it('applies the settings default kernel only to new conversations', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const id = conversations.ensureConversation('task')
    expect(conversations.conversations.find(item => item.id === id)?.kernel).toBe('dsh')

    conversations.setKernel('pi')
    conversations.setDefaultKernel('dsh')
    expect(conversations.conversations.find(item => item.id === id)?.kernel).toBe('pi')
    conversations.dispose()
  })

  it('enables Multitask on a new empty DSH canvas before the first message', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    expect(conversations.activeId).toBeNull()
    expect(conversations.selectedKernel).toBe('dsh')
    conversations.setMultitask(true)
    expect(conversations.selectedMultitask).toBe(true)
    const id = conversations.ensureConversation('task')
    expect(conversations.conversations.find(item => item.id === id)?.multitask).toBe(true)
    conversations.dispose()
  })

  it('spawns a DSH child session instead of steering when Multitask is on', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    conversations.setMultitask(true)
    await conversations.send('first turn')
    const sent = await conversations.send('review auth')
    expect(sent).toBe(true)
    const child = conversations.conversations.find(item => item.parentConversationId === parentId)
    expect(child?.kernel).toBe('dsh')
    expect(child?.messages[0]?.content).toBe('review auth')
    expect(conversations.activeId).toBe(parentId)
    expect(invokeCommand).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ conversationId: child?.id, prompt: 'review auth' }),
    )
    conversations.dispose()
  })

  it('stops a DSH native subagent without aborting the parent turn', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    const current = conversations.conversations.find(item => item.id === parentId)
    if (current) {
      Object.assign(current, {
        kernel: 'dsh',
        subagentTasks: [{ id: 'cf4fb9a2', role: '环境巡检', status: 'running' }],
      })
    }
    await conversations.abortWorkingItem('cf4fb9a2')
    expect(invokeCommand).toHaveBeenCalledWith(
      'abort_message',
      expect.objectContaining({ conversationId: parentId, subagentId: 'cf4fb9a2' }),
    )
    conversations.dispose()
  })

  it('queues a DSH parent message through inbox when busy-send is queue', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.setBusySend('queue')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    await conversations.send('first turn')
    const sent = await conversations.send('after this turn')
    expect(sent).toBe(true)
    expect(invokeCommand).toHaveBeenCalledWith(
      'queue_dsh_message',
      expect.objectContaining({ conversationId: parentId, prompt: 'after this turn' }),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'steer_message',
      expect.objectContaining({ conversationId: parentId, prompt: 'after this turn' }),
    )
    conversations.dispose()
  })

  it('executes listed DSH slash through host and rejects unknown slash', async () => {
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_conversations') return []
      if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
      if (command === 'save_conversation') return null
      if (command === 'send_message') return null
      if (command === 'ensure_coding_artifact_workspace') return ''
      if (command === 'execute_dsh_command') return { text: 'Plan mode on.', kind: 'success' }
      return null
    })
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    const current = conversations.conversations.find(item => item.id === parentId)
    if (current) {
      Object.assign(current, {
        dshCommands: [{ name: 'plan', description: 'Enter or leave plan mode' }],
      })
    }
    const planned = await conversations.send('/plan')
    expect(planned).toBe(true)
    expect(invokeCommand).toHaveBeenCalledWith(
      'execute_dsh_command',
      expect.objectContaining({ conversationId: parentId, line: '/plan' }),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ prompt: '/plan' }),
    )
    invokeCommand.mockClear()
    const rejected = await conversations.send('/not-real')
    expect(rejected).toBe(false)
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ prompt: '/not-real' }),
    )
    const parent = conversations.conversations.find(item => item.id === parentId)
    expect(parent?.messages.some(message => message.content.includes('未知命令：/not-real'))).toBe(true)
    conversations.dispose()
  })

  it('sends DSH /goal through host execute, not as prompt text', async () => {
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_conversations') return []
      if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
      if (command === 'save_conversation') return null
      if (command === 'send_message') return null
      if (command === 'ensure_coding_artifact_workspace') return ''
      if (command === 'execute_dsh_command') return { text: 'Goal set.', kind: 'success' }
      return null
    })
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    const current = conversations.conversations.find(item => item.id === parentId)
    if (current) {
      Object.assign(current, {
        dshCommands: [{ name: 'goal' }],
      })
    }
    const sent = await conversations.send('/goal ship the dock')
    expect(sent).toBe(true)
    expect(invokeCommand).toHaveBeenCalledWith(
      'execute_dsh_command',
      expect.objectContaining({ conversationId: parentId, line: '/goal ship the dock' }),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ prompt: '/goal ship the dock' }),
    )
    conversations.dispose()
  })

  it('stops a DSH background job from Working without aborting the parent', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    const current = conversations.conversations.find(item => item.id === parentId)
    if (current) {
      Object.assign(current, {
        kernel: 'dsh',
        dshJobs: [{ id: 'bash-1', kind: 'bash', label: 'sleep 30', status: 'running' }],
      })
    }
    await conversations.abortWorkingItem('bash-1')
    expect(invokeCommand).toHaveBeenCalledWith(
      'kill_dsh_job',
      expect.objectContaining({ conversationId: parentId, jobId: 'bash-1' }),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'abort_message',
      expect.objectContaining({ conversationId: parentId }),
    )
    conversations.dispose()
  })

  it('follows up the DSH parent while it is running without opening Multitask', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    await conversations.send('first turn')
    const sent = await conversations.send('keep talking')
    expect(sent).toBe(true)
    expect(conversations.conversations.some(item => item.parentConversationId === parentId)).toBe(false)
    expect(invokeCommand).toHaveBeenCalledWith(
      'steer_message',
      expect.objectContaining({ conversationId: parentId, prompt: 'keep talking' }),
    )
    conversations.dispose()
  })

  it('keeps Pi /goal as a session prompt and still uses write-protect plan', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('pi')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    conversations.setCodingPolicy('plan', 'workspace-auto')
    expect(conversations.conversations.find(item => item.id === parentId)?.executionMode).toBe('plan')
    const sent = await conversations.send('/goal ship the dock')
    expect(sent).toBe(true)
    expect(invokeCommand).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ conversationId: parentId, prompt: '/goal ship the dock' }),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'execute_dsh_command',
      expect.anything(),
    )
    conversations.dispose()
  })

  it('does not spawn a child on Pi', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('pi')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    conversations.setMultitask(true)
    expect(conversations.conversations.find(item => item.id === parentId)?.multitask).toBeUndefined()
    await conversations.send('first turn')
    const sent = await conversations.send('review auth')
    expect(sent).toBe(true)
    expect(conversations.conversations.some(item => item.parentConversationId === parentId)).toBe(false)
    expect(invokeCommand).toHaveBeenCalledWith(
      'steer_message',
      expect.objectContaining({ conversationId: parentId }),
    )
    conversations.dispose()
  })

  it('clears parent runningIds when the last DSH subagent succeeds even if ACP has not settled', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    await conversations.listen()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    await conversations.send('inspect workspace')
    expect(conversations.runningConversationIds).toContain(parentId)

    emit(parentId, { type: 'assistant.started' })
    emit(parentId, { type: 'assistant.delta', text: 'I will look around.' })
    emit(parentId, { type: 'tool.started', toolName: 'subagent', toolCallId: 'cf4fb9a2' })
    emit(parentId, {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf4fb9a2', role: '环境巡检', status: 'running', toolCallId: 'cf4fb9a2' }],
    })
    const livePhase = phaseFor(conversations, parentId)
    expect(livePhase).toBe('working')
    expect(composerShowsStop(livePhase)).toBe(false)
    expect(conversations.runningConversationIds).toContain(parentId)

    emit(parentId, { type: 'tool.completed', toolName: 'subagent', toolCallId: 'cf4fb9a2', done: true })
    emit(parentId, {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf4fb9a2', role: '环境巡检', status: 'succeeded', toolCallId: 'cf4fb9a2' }],
    })
    expect(conversations.runningConversationIds).not.toContain(parentId)
    const settledPhase = phaseFor(conversations, parentId)
    expect(settledPhase).toBe('idle')
    expect(composerShowsStop(settledPhase)).toBe(false)
    const parent = conversations.conversations.find(item => item.id === parentId)
    expect(parent?.messages.some(message => message.status === 'running' && !message.approvalRequestId)).toBe(false)
    conversations.dispose()
  })

  it('keeps Pi parent running and Stop while its subagent tool is still open', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    await conversations.listen()
    conversations.setDefaultKernel('pi')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    await conversations.send('delegate review')
    emit(parentId, { type: 'assistant.started' })
    emit(parentId, { type: 'assistant.delta', text: 'starting reviewer' })
    emit(parentId, { type: 'tool.started', toolName: 'subagent', toolCallId: 'call-1' })
    emit(parentId, {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'call-1', role: 'reviewer', status: 'running', toolCallId: 'call-1' }],
    })
    expect(conversations.runningConversationIds).toContain(parentId)
    const phase = phaseFor(conversations, parentId)
    expect(phase).toBe('parent')
    expect(composerShowsStop(phase)).toBe(true)
    conversations.dispose()
  })

  it('keeps composer Stop during compact and abort', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime()
    await conversations.listen()
    conversations.setDefaultKernel('dsh')
    conversations.startNew()
    const parentId = conversations.ensureConversation('parent')
    await conversations.send('compact later')
    emit(parentId, { type: 'assistant.started' })
    emit(parentId, { type: 'runtime.compaction_started' })
    expect(conversations.activeCompacting).toBe(true)
    expect(phaseFor(conversations, parentId)).toBe('compacting')
    expect(composerShowsStop('compacting')).toBe(true)

    emit(parentId, { type: 'runtime.compaction_completed' })
    await conversations.abort(parentId)
    expect(conversations.activeAborting).toBe(true)
    expect(phaseFor(conversations, parentId)).toBe('aborting')
    expect(composerShowsStop('aborting')).toBe(true)
    conversations.dispose()
  })
})
