import type { CodingAttachment, CompanionTranscriptEntry } from '@/types'

export interface CompanionOutgoing {
  id: string
  prompt: string
  attachments: CodingAttachment[]
}

function attachmentKeys(attachments: CodingAttachment[] | undefined) {
  return (attachments ?? [])
    .map(item => `${item.sha256 || item.id}:${item.name}`)
    .filter(Boolean)
    .sort()
    .join('|')
}

export function transcriptHasOutgoing(
  entries: CompanionTranscriptEntry[],
  pending: CompanionOutgoing,
) {
  return entries.some(entry => {
    if (entry.id === pending.id || entry.role !== 'user') return entry.id === pending.id
    if (pending.attachments.length && attachmentKeys(entry.attachments) === attachmentKeys(pending.attachments)) {
      return true
    }
    return Boolean(pending.prompt) && String(entry.text ?? '').includes(pending.prompt)
  })
}

/** A transcript refresh must not drop the user line that has not been flushed yet. */
export function mergeCompanionTranscriptTail(
  hydrated: CompanionTranscriptEntry[],
  current: CompanionTranscriptEntry[],
  pending: CompanionOutgoing | null,
) {
  if (!pending || transcriptHasOutgoing(hydrated, pending)) return hydrated
  const optimistic = current.find(entry => entry.id === pending.id)
  if (!optimistic) return hydrated
  return [...hydrated, optimistic]
}
