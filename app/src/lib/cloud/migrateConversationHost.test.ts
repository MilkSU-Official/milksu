import { describe, expect, it, vi } from 'vitest'
import { CloudAgentClient } from './cloudAgentClient'
import { migrateConversationHost } from './migrateConversationHost'

describe('migrateConversationHost', () => {
  it('rejects empty-session migrate', async () => {
    await expect(migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 's1',
      messageCount: 0,
      activateTarget: async () => {},
      deleteSource: async () => {},
    })).rejects.toThrow(/flip host without migrate/)
  })

  it('copy then finalize then activate then delete for local_to_cloud', async () => {
    const order: string[] = []
    const call = vi.fn(async (method: string) => {
      order.push(method)
      if (method === 'MigrateCopy') {
        return { target_session_id: 'cloud-1', ok: true, error: '' }
      }
      if (method === 'MigrateFinalize') {
        return { ok: true, error: '' }
      }
      return {}
    })
    const result = await migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 'local-1',
      messageCount: 2,
      transcriptJson: '[]',
      client: new CloudAgentClient({ call }),
      activateTarget: async id => { order.push(`activate:${id}`) },
      deleteSource: async id => { order.push(`delete:${id}`) },
    })
    expect(result.targetSessionId).toBe('cloud-1')
    expect(order).toEqual([
      'MigrateCopy',
      'MigrateFinalize',
      'activate:cloud-1',
      'delete:local-1',
    ])
  })

  it('does not activate or delete source when finalize fails; cleans migrating target', async () => {
    const order: string[] = []
    const call = vi.fn(async (method: string) => {
      order.push(method)
      if (method === 'MigrateCopy') {
        return { target_session_id: 'cloud-orphan', ok: true, error: '' }
      }
      if (method === 'MigrateFinalize') {
        return { ok: false, error: 'finalize boom' }
      }
      if (method === 'DeleteSession') return {}
      throw new Error(`unexpected ${method}`)
    })
    await expect(migrateConversationHost({
      direction: 'local_to_cloud',
      sourceSessionId: 'local-1',
      messageCount: 2,
      transcriptJson: '[]',
      client: new CloudAgentClient({ call }),
      activateTarget: async () => { order.push('activate') },
      deleteSource: async () => { order.push('delete') },
    })).rejects.toThrow(/finalize boom/)
    expect(order).toEqual(['MigrateCopy', 'MigrateFinalize', 'DeleteSession'])
    expect(call).toHaveBeenCalledWith('DeleteSession', { session_id: 'cloud-orphan' })
  })

  it('creates local then DeleteSession then activate for cloud_to_local', async () => {
    const order: string[] = []
    const call = vi.fn(async (method: string) => {
      order.push(method)
      if (method === 'DeleteSession') return {}
      throw new Error(`unexpected ${method}`)
    })
    const result = await migrateConversationHost({
      direction: 'cloud_to_local',
      sourceSessionId: 'cloud-src',
      messageCount: 3,
      transcriptJson: '[{"role":"user"}]',
      client: new CloudAgentClient({ call }),
      activateTarget: async id => { order.push(`activate:${id}`) },
      deleteSource: async id => { order.push(`delete:${id}`) },
      createLocalFromTranscript: async () => {
        order.push('createLocal')
        return 'local-new'
      },
    })
    expect(result.targetSessionId).toBe('local-new')
    expect(order).toEqual([
      'createLocal',
      'DeleteSession',
      'activate:local-new',
      'delete:cloud-src',
    ])
  })
})
