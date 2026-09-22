import type { ConversationHost } from '@/lib/conversationHost'
import { canFlipHostWithoutMigrate } from '@/lib/conversationHost'
import {
  CloudAgentClient,
  desktopCloudAgentClient,
} from '@/lib/cloud/cloudAgentClient'

/**
 * Copy-then-delete host migration (docs/developer/cloud-agent.md).
 * Local→cloud uses CloudAgentClient.MigrateCopy then Finalize.
 * Cloud→local copies transcript into a new local conversation id supplied by caller.
 * Product path uses desktopCloudAgentClient (token in Electron main).
 */
export async function migrateConversationHost(input: {
  direction: 'local_to_cloud' | 'cloud_to_local'
  sourceSessionId: string
  messageCount: number
  transcriptJson?: string
  /** Optional override for tests; product code omits this. */
  client?: CloudAgentClient
  /** Called only after target is verified; deletes or archives the source. */
  deleteSource: (sourceSessionId: string) => Promise<void>
  /** Cloud→local: create local conversation from transcript; return new id. */
  createLocalFromTranscript?: (transcriptJson: string) => Promise<string>
}): Promise<{ targetSessionId: string }> {
  if (canFlipHostWithoutMigrate(input.messageCount)) {
    throw new Error('Empty conversations should flip host without migrate')
  }

  if (input.direction === 'local_to_cloud') {
    const client = input.client ?? desktopCloudAgentClient()
    const copied = await client.migrateCopy({
      sourceSessionId: input.sourceSessionId,
      direction: 'local_to_cloud',
      transcriptJson: input.transcriptJson,
    })
    if (!copied.ok || !copied.target_session_id) {
      throw new Error(copied.error || 'Cloud migrate copy failed')
    }
    const finalized = await client.migrateFinalize({
      sourceSessionId: input.sourceSessionId,
      targetSessionId: copied.target_session_id,
      direction: 'local_to_cloud',
    })
    if (!finalized.ok) {
      throw new Error(finalized.error || 'Cloud migrate finalize failed')
    }
    await input.deleteSource(input.sourceSessionId)
    return { targetSessionId: copied.target_session_id }
  }

  const createLocal = input.createLocalFromTranscript
  if (!createLocal) {
    throw new Error('cloud_to_local requires createLocalFromTranscript')
  }
  const targetSessionId = await createLocal(input.transcriptJson ?? '[]')
  await input.deleteSource(input.sourceSessionId)
  return { targetSessionId }
}

export type { ConversationHost }
