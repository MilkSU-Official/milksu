import { describe, expect, it, vi } from 'vitest'
import { migrateConversationHost } from './migrateConversationHost'

describe('migrateConversationHost', () => {
  it('rejects empty-session migrate', async () => {
    await expect(migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 's1',
      messageCount: 0,
      getAccessToken: async () => 'tok',
      deleteSource: async () => {},
    })).rejects.toThrow(/flip host without migrate/)
  })

  it('copy then finalize then delete for local_to_cloud', async () => {
    const deleted: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('MigrateCopy')) {
        return new Response(JSON.stringify({ target_session_id: 'cloud-1', ok: true, error: '' }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, error: '' }), { status: 200 })
    }) as unknown as typeof fetch
    // Patch client by injecting via migrate's CloudAgentClient — use global fetch mock
    const original = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const result = await migrateConversationHost({
        direction: 'local_to_cloud',
        sourceSessionId: 'local-1',
        messageCount: 2,
        transcriptJson: '[]',
        getAccessToken: async () => 'tok',
        baseUrl: 'https://agent.example',
        deleteSource: async id => { deleted.push(id) },
      })
      expect(result.targetSessionId).toBe('cloud-1')
      expect(deleted).toEqual(['local-1'])
    } finally {
      globalThis.fetch = original
    }
  })
})
