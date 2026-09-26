// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  listenEvent: vi.fn(async () => () => {}),
}))

describe('useConversations workspace home isolation', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
  })

  it('does not inject a Home project into CTF, CVE, or Lab new chats', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.setWorkspace('/Users/me/code/home-app')
    expect(conversations.workspacePath).toBe('/Users/me/code/home-app')

    conversations.startNew({ workspaceHome: 'ctf' })
    expect(conversations.workspacePath).toBe('')
    conversations.startNew({ workspaceHome: 'vuln' })
    expect(conversations.workspacePath).toBe('')
    conversations.startNew({ workspaceHome: 'lab' })
    expect(conversations.workspacePath).toBe('')
  })

  it('does not remember or reuse a project chosen in a domain chat on Home', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew({ workspaceHome: 'ctf' })
    conversations.setWorkspace('/Users/me/code/ctf-picked')
    expect(invokeCommand.mock.calls.some(call => call[0] === 'remember_coding_project')).toBe(false)
    expect(conversations.workspacePath).toBe('/Users/me/code/ctf-picked')

    conversations.startNew()
    await Promise.resolve()
    await Promise.resolve()
    expect(conversations.workspacePath).toBe('')
    expect(conversations.workspacePath).not.toBe('/Users/me/code/ctf-picked')
    expect(conversations.workspacePath).not.toBe('/Users/me/code/home-app')
  })

  it('starts a Home new chat without the last Home project', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.setWorkspace('/Users/me/code/home-app')
    expect(invokeCommand.mock.calls.some(call => (
      call[0] === 'remember_coding_project'
      && (call[1] as { path?: string })?.path === '/Users/me/code/home-app'
    ))).toBe(true)
    conversations.startNew()
    expect(conversations.workspacePath).toBe('')
  })

  it('does not pre-fill the remembered Home project on load', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()
    expect(conversations.workspacePath).toBe('')
  })

  it('does not bind a project onto a draw chat', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew({ workspaceHome: 'image' })
    conversations.setWorkspace('/Users/me/code/milksu')
    expect(conversations.workspacePath).toBe('')
    expect(invokeCommand.mock.calls.some(call => call[0] === 'remember_coding_project')).toBe(false)
  })

  it('does not apply Home project memory to a domain pending chat on load', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew({ workspaceHome: 'vuln' })
    await conversations.load()
    expect(conversations.workspacePath).toBe('')
  })
})
