import type { ConversationHost } from '@/lib/conversationHost'
import { canFlipHostWithoutMigrate } from '@/lib/conversationHost'
import {
  CloudAgentClient,
  desktopCloudAgentClient,
} from '@/lib/cloud/cloudAgentClient'

/**
 * Copy-then-delete host migration (docs/developer/cloud-agent.md).
 *
 * Order (fail-safe):
 * 1. Create / verify target (MigrateCopy+Finalize or createLocal)
 * 2. activateTarget — UI flips host only here
 * 3. deleteSource — archive / retire source only after activate succeeds
 *
 * On any failure before step 2, source is untouched and host must not flip.
 * If Finalize fails after MigrateCopy, the migrating cloud target is deleted.
 */
export async function migrateConversationHost(input: {
  direction: 'local_to_cloud' | 'cloud_to_local'
  /** local_to_cloud: local conversation id; cloud_to_local: cloud session id to delete after copy. */
  sourceSessionId: string
  messageCount: number
  transcriptJson?: string
  /** Optional override for tests; product code omits this. */
  client?: CloudAgentClient
  /**
   * Called after the target is verified and before source retirement.
   * Product UI flips host / selects the target conversation here — never earlier.
   */
  activateTarget: (targetSessionId: string) => Promise<void>
  /** Called only after activateTarget; deletes or archives the source. */
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
    const targetId = copied.target_session_id
    try {
      const finalized = await client.migrateFinalize({
        sourceSessionId: input.sourceSessionId,
        targetSessionId: targetId,
        direction: 'local_to_cloud',
      })
      if (!finalized.ok) {
        throw new Error(finalized.error || 'Cloud migrate finalize failed')
      }
    } catch (error) {
      // Drop the migrating cloud row so a failed migrate does not leave orphans.
      try {
        await client.deleteSession(targetId)
      } catch {
        // Best-effort cleanup; surface the original finalize error.
      }
      throw error
    }
    await input.activateTarget(targetId)
    await input.deleteSource(input.sourceSessionId)
    return { targetSessionId: targetId }
  }

  const createLocal = input.createLocalFromTranscript
  if (!createLocal) {
    throw new Error('cloud_to_local requires createLocalFromTranscript')
  }
  const targetSessionId = await createLocal(input.transcriptJson ?? '[]')
  const client = input.client ?? desktopCloudAgentClient()
  // Target local exists first; only then delete the cloud source (copy-then-delete).
  if (input.sourceSessionId.trim()) {
    await client.deleteSession(input.sourceSessionId)
  }
  await input.activateTarget(targetSessionId)
  await input.deleteSource(input.sourceSessionId)
  return { targetSessionId }
}

export type { ConversationHost }
