import { describe, expect, it, vi } from 'vitest'
import { CloudAgentClient } from './cloudAgentClient'
import { migrateConversationHost } from './migrateConversationHost'

describe('migrateConversationHost', () => {
  it('rejects empty-session migrate', async () => {
    await expect(migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 's1',
      messageCount: 0,
      deleteSource: async () => {},
    })).rejects.toThrow(/flip host without migrate/)
  })

  it('copy then finalize then delete for local_to_cloud', async () => {
    const deleted: string[] = []
    const call = vi.fn(async (method: string) => {
      if (method === 'MigrateCopy') {
        return { target_session_id: 'cloud-1', ok: true, error: '' }
      }
      return { ok: true, error: '' }
    })
    const result = await migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 'local-1',
      messageCount: 2,
      transcriptJson: '[]',
      client: new CloudAgentClient({ call }),
      deleteSource: async id => { deleted.push(id) },
    })
    expect(result.targetSessionId).toBe('cloud-1')
    expect(deleted).toEqual(['local-1'])
    expect(call).toHaveBeenCalledWith('MigrateCopy', expect.objectContaining({
      source_session_id: 'local-1',
      direction: 'local_to_cloud',
    }))
    expect(call).toHaveBeenCalledWith('MigrateFinalize', expect.objectContaining({
      target_session_id: 'cloud-1',
    }))
  })

  it('creates local then DeleteSession for cloud_to_local', async () => {
    const deleted: string[] = []
    const call = vi.fn(async (method: string) => {
      if (method === 'DeleteSession') return {}
      throw new Error(`unexpected ${method}`)
    })
    const result = await migrateConversationHost({
      direction: 'cloud_to_local',
      sourceSessionId: 'cloud-src',
      messageCount: 3,
      transcriptJson: '[{"role":"user"}]',
      client: new CloudAgentClient({ call }),
      deleteSource: async id => { deleted.push(id) },
      createLocalFromTranscript: async () => 'local-new',
    })
    expect(result.targetSessionId).toBe('local-new')
    expect(deleted).toEqual(['cloud-src'])
    expect(call).toHaveBeenCalledWith('DeleteSession', { session_id: 'cloud-src' })
  })
})
