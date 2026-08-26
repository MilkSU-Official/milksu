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
    expect(conversations.workspacePath.value).toBe('/Users/me/code/home-app')

    conversations.startNew({ workspaceHome: 'ctf' })
    expect(conversations.workspacePath.value).toBe('')
    conversations.startNew({ workspaceHome: 'vuln' })
    expect(conversations.workspacePath.value).toBe('')
    conversations.startNew({ workspaceHome: 'lab' })
    expect(conversations.workspacePath.value).toBe('')
  })

  it('does not remember or reuse a project chosen in a domain chat on Home', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew({ workspaceHome: 'ctf' })
    conversations.setWorkspace('/Users/me/code/ctf-picked')
    expect(invokeCommand.mock.calls.some(call => call[0] === 'remember_coding_project')).toBe(false)
    expect(conversations.workspacePath.value).toBe('/Users/me/code/ctf-picked')

    conversations.startNew()
    await Promise.resolve()
    await Promise.resolve()
    expect(conversations.workspacePath.value).toBe('/Users/me/code/home-app')
    expect(conversations.workspacePath.value).not.toBe('/Users/me/code/ctf-picked')
  })

  it('keeps the last Home project on a Home new chat', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.setWorkspace('/Users/me/code/home-app')
    conversations.startNew()
    expect(conversations.workspacePath.value).toBe('/Users/me/code/home-app')
    expect(invokeCommand.mock.calls.some(call => (
      call[0] === 'remember_coding_project'
      && (call[1] as { path?: string })?.path === '/Users/me/code/home-app'
    ))).toBe(true)
  })

  it('does not apply Home project memory to a domain pending chat on load', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew({ workspaceHome: 'vuln' })
    await conversations.load()
    expect(conversations.workspacePath.value).toBe('')
  })
})
