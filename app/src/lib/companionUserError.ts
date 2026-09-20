import type { CodingAttachment, CompanionTranscriptEntry } from '@/types'
import { explainModelCallFailure, type ModelServiceErrorContext } from './tokenFluxError'
import { t } from './uiLocale'

const SIDECAR_DOWN = /companion sidecar stopped|companion sidecar did not become ready|companion sidecar is not running|companion runtime is not configured|cannot find module.*current-provider-runtime/i
const ATTACHMENT_BLOCK = /\n\n\[MilkSU attachments\][\s\S]*$/u
const ATTACHMENT_ROW = /^- (.+?) \(([^,]+), [^,]+, sha256:([a-f0-9]{64}),/gmu
const ATTACHMENT_LABEL = /^(附件：|Attachments:)/u

export function explainCompanionError(
  reason: unknown,
  context?: ModelServiceErrorContext,
): string {
  const message = String(reason ?? '').trim()
  if (!message) return ''
  if (SIDECAR_DOWN.test(message)) {
    return t('桌宠暂时连不上。', 'The companion could not start.')
  }
  return explainModelCallFailure(message, context) || message
}

export function companionChatAttachmentsFromText(text: string): CodingAttachment[] {
  const block = String(text ?? '').split('[MilkSU attachments]')[1]
  if (!block) return []
  const attachments: CodingAttachment[] = []
  for (const match of block.matchAll(ATTACHMENT_ROW)) {
    const name = String(match[1] ?? '').trim()
    const mediaType = String(match[2] ?? '').trim()
    const sha256 = String(match[3] ?? '').trim()
    if (!name || !sha256) continue
    attachments.push({
      id: sha256,
      name,
      mediaType: mediaType || 'application/octet-stream',
      size: 0,
      sha256,
    })
  }
  return attachments
}

export function companionChatHydrateEntry(entry: CompanionTranscriptEntry): CompanionTranscriptEntry {
  if (entry.attachments?.length) return entry
  const attachments = companionChatAttachmentsFromText(entry.text ?? '')
  return attachments.length ? { ...entry, attachments } : entry
}

function companionChatUserFacingText(text: string, hasAttachments: boolean) {
  let value = String(text ?? '').trim().replace(ATTACHMENT_BLOCK, '').trim()
  if (!hasAttachments) return value
  if (
    value === '请看这些附件。'
    || value === 'Please look at these attachments.'
    || ATTACHMENT_LABEL.test(value)
  ) return ''
  return value
}

export function companionChatVisibleText(entry: {
  text?: string
  type?: string
  error?: string
  attachments?: CodingAttachment[]
}): string {
  const attachments = entry.attachments?.length
    ? entry.attachments
    : companionChatAttachmentsFromText(entry.text ?? '')
  const text = companionChatUserFacingText(entry.text ?? '', attachments.length > 0)
  const type = String(entry.type ?? '').trim()
  if (text && text !== type) return text
  return String(entry.error ?? '').trim()
}
