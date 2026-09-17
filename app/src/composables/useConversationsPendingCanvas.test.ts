// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationsRuntime } from '@/composables/useConversations'
import {
  readComposerDraft,
  resetComposerDrafts,
  writeComposerDraft,
} from '@/lib/composerDraftStore'

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return []
  if (command === 'save_conversation') return null
  if (command === 'get_coding_project_memory') {
    return {
      lastWorkspacePath: '/Users/me/code/home-app',
      recents: [{ path: '/Users/me/code/home-app' }],
    }
  }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => undefined),
}))

describe('pending empty-canvas survives navigation', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
    resetComposerDrafts()
  })

  afterEach(() => {
    resetComposerDrafts()
  })

  it('parks Coding chips when opening a domain canvas and restores them on resume', () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setWorkspace('/Users/me/code/milksu')
    conversations.setKernel('pi')
    conversations.setModelSelection('manual', 'deepseek', 'deepseek-flash')
    conversations.setThinkingLevel('high')

    conversations.startNew({ workspaceHome: 'ctf' })
    expect(conversations.activeId).toBeNull()
    expect(conversations.pendingWorkspaceHome).toBe('ctf')
    expect(conversations.selectedKernel).toBe('pi')
    expect(conversations.workspacePath).toBe('')

    conversations.resumePendingHome('chat')
    expect(conversations.activeId).toBeNull()
    expect(conversations.pendingWorkspaceHome).toBe('chat')
    expect(conversations.workspacePath).toBe('/Users/me/code/milksu')
    expect(conversations.selectedKernel).toBe('pi')
    expect(conversations.selectedModelMode).toBe('manual')
    expect(conversations.selectedModelProvider).toBe('deepseek')
    expect(conversations.selectedModelId).toBe('deepseek-flash')
    expect(conversations.selectedThinkingLevel).toBe('high')
    conversations.dispose()
  })

  it('does not reset the current pending Coding canvas when resume is a no-op', () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setKernel('dsh')
    conversations.setModelSelection('manual', 'openai', 'gpt-5.4')
    conversations.resumePendingHome('chat')
    expect(conversations.selectedKernel).toBe('dsh')
    expect(conversations.selectedModelId).toBe('gpt-5.4')
    conversations.dispose()
  })

  it('keeps a customized pending kernel when settings reload the default', () => {
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('pi')
    conversations.startNew()
    conversations.setKernel('dsh')
    conversations.setDefaultKernel('pi')
    expect(conversations.selectedKernel).toBe('dsh')
    conversations.dispose()
  })

  it('updates the unused pending kernel when the settings default changes', () => {
    const conversations = createConversationsRuntime()
    conversations.setDefaultKernel('pi')
    conversations.startNew()
    expect(conversations.selectedKernel).toBe('pi')
    conversations.setDefaultKernel('dsh')
    expect(conversations.selectedKernel).toBe('dsh')
    conversations.dispose()
  })

  it('keeps DSH Multitask on the empty canvas and restores it after parking', () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setKernel('dsh')
    conversations.setMultitask(true)
    expect(conversations.activeId).toBeNull()
    expect(conversations.selectedMultitask).toBe(true)

    conversations.startNew({ workspaceHome: 'ctf' })
    expect(conversations.selectedMultitask).toBe(false)

    conversations.resumePendingHome('chat')
    expect(conversations.activeId).toBeNull()
    expect(conversations.selectedKernel).toBe('dsh')
    expect(conversations.selectedMultitask).toBe(true)
    conversations.dispose()
  })

  it('does not enable Multitask on a pending Pi canvas', () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setKernel('pi')
    conversations.setMultitask(true)
    expect(conversations.selectedMultitask).toBe(false)
    conversations.dispose()
  })

  it('copies pending Multitask onto the first sent conversation', async () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setKernel('dsh')
    conversations.setMultitask(true)
    const sent = await conversations.send('start in parallel')
    expect(sent).toBe(true)
    const created = conversations.conversations.find(item => item.id === conversations.activeId)
    expect(created?.kernel).toBe('dsh')
    expect(created?.multitask).toBe(true)
    conversations.dispose()
  })

  it('clears the parked Coding draft only on an explicit New conversation', () => {
    const conversations = createConversationsRuntime()
    conversations.startNew()
    conversations.setKernel('dsh')
    writeComposerDraft('pending:chat', {
      html: '修好草稿',
      text: '修好草稿',
      attachments: [],
    })
    conversations.startNew({ workspaceHome: 'lab' })
    expect(readComposerDraft('pending:chat')).toEqual({
      html: '修好草稿',
      text: '修好草稿',
      attachments: [],
    })
    conversations.resumePendingHome('chat')
    expect(conversations.selectedKernel).toBe('dsh')
    conversations.startNew()
    expect(readComposerDraft('pending:chat')).toBeUndefined()
    expect(conversations.selectedKernel).toBe('pi')
    conversations.dispose()
  })
})
