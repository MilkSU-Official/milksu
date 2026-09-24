import type { CodingAttachment, CompanionTranscriptEntry } from '@/types'
import { explainModelCallFailure, type ModelServiceErrorContext } from './tokenFluxError'
import { t } from './uiLocale'

const CREDENTIAL_WITHDRAWN = /companion credential withdrawn/i
const CREDENTIAL_MISSING = /companion credential missing/i
const SIDECAR_DOWN = /companion sidecar stopped|companion sidecar did not become ready|companion sidecar is not running|companion runtime is not configured|cannot find module.*current-provider-runtime|broken pipe|EPIPE|看板娘暂时连不上|The Companion could not start/i
const ARCHIVE_EMPTY = /no companion transcript to archive|没有可归档的抄本/i
const SESSION_NOT_READY = /companion session is not ready|coding session is not ready|deepseek harness session is not ready|session is not ready/i
const MODEL_ROUTE_MISSING = /companion provider and model are required|companion model not found/i
const MISSING_API_KEY = /no API key is configured|No API key for|当前模型没有可用的 API Key|No API key is available for the current model|当前模型没有可用凭据|No credentials are available for the current model/i
const PROMPT_REQUIRED = /companion prompt is required/i
const UNKNOWN_ACTION = /unknown companion action/i
const ATTACHMENT_BLOCK = /(?:^|\n{2,})\[MilkSU attachments\][\s\S]*$/u
const ATTACHMENT_ROW = /^- (.+?) \(([^,]+), [^,]+, sha256:([a-f0-9]{64}),/gmu
const ATTACHMENT_LABEL = /^(附件：|Attachments:)/u

export function explainCompanionError(
  reason: unknown,
  context?: ModelServiceErrorContext,
): string {
  const message = String(reason ?? '').trim()
  if (!message) return ''
  if (CREDENTIAL_WITHDRAWN.test(message)) {
    return t(
      '账户已退出或密钥已移除，看板娘没法继续。请重新登录，或改选一个已有密钥的模型。',
      'The Companion cannot continue because the account signed out or the key was removed. Sign in again, or pick a model that has a key.',
    )
  }
  if (CREDENTIAL_MISSING.test(message)) {
    return t(
      '看板娘这个来源还没有密钥。请重新登录，或改选一个已有密钥的模型。',
      'This Companion source has no key. Sign in again, or pick a model that has a key.',
    )
  }
  if (SIDECAR_DOWN.test(message) || UNKNOWN_ACTION.test(message)) {
    return t('看板娘暂时连不上。', 'The Companion could not start.')
  }
  if (ARCHIVE_EMPTY.test(message)) {
    return t('没有可归档的抄本。', 'There is no Companion transcript to archive.')
  }
  if (SESSION_NOT_READY.test(message)) {
    return t('看板娘还没准备好，请稍后再试。', 'The Companion is not ready yet. Try again.')
  }
  if (MODEL_ROUTE_MISSING.test(message)) {
    return t('看板娘还没有可用的模型。', 'The Companion does not have a model yet.')
  }
  if (PROMPT_REQUIRED.test(message)) {
    return t('还没有可发送的内容。', 'There is nothing to send yet.')
  }
  if (/companion model returned no text/i.test(message)) {
    return t('这一轮没有回复。', 'This turn did not produce a reply.')
  }
  if (companionChatNeedsNewConversation(message)) {
    return t('这段对话没法继续了。', 'This chat can\'t continue.')
  }
  // AbortCompanionTurn / recover teardown aborts the in-flight Pi HTTP
  // request. undici surfaces that as "Request aborted" — not a model outage.
  if (companionTurnCancelled(message)) {
    return t('这一轮已取消。', 'This turn was cancelled.')
  }
  // Host IPC (board / dispatch / memory / app) must not look like a model outage.
  // The model may still be streaming while a host wait times out or is aborted.
  if (companionHostToolFailure(message)) {
    return t('看板娘操作已取消或超时，请再试一次。', 'The Companion action was cancelled or timed out. Try again.')
  }
  if (
    /\bconnection error\b|request timed out|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|network is unreachable/i
      .test(message)
  ) {
    return t('连不上模型服务，请稍后重试。', 'Could not reach the model service. Try again later.')
  }
  if (companionMissingApiKey(message)) {
    return t('当前模型没有可用的 API Key。', 'No API key is available for the current model.')
  }
  return explainModelCallFailure(message, context) || message
}

/**
 * Missing credentials before the user has sent. The pet stays idle; do not
 * park this on the bubble after a later route already became ready.
 */
export function companionAccountModelAlignedNotice() {
  return t(
    '看板娘的账户模型已不在目录里，已换成还能用的模型。',
    'The account model for the companion left the catalog, so it was switched to one that is still available.',
  )
}

export function companionMissingApiKey(reason: unknown): boolean {
  return MISSING_API_KEY.test(String(reason ?? ''))
}

export function companionCredentialMissing(reason: unknown): boolean {
  return CREDENTIAL_MISSING.test(String(reason ?? ''))
}

export function companionSidecarDown(reason: unknown): boolean {
  return SIDECAR_DOWN.test(String(reason ?? ''))
}

/**
 * Host board/dispatch/memory/app failure. Pi must turn this into an error
 * toolResult and keep the agent loop; MilkSU must not abort the run.
 */
export function companionHostToolFailure(reason: unknown): boolean {
  return /companion host request timed out|companion host request failed|companion host cancelled|turn aborted|unknown companion host request|companion-host-\d+/i
    .test(String(reason ?? ''))
}

/**
 * In-flight model HTTP was cancelled (AbortCompanionTurn, StopCompanion,
 * recover teardown, user stop). Distinct from host-tool timeout.
 */
export function companionTurnCancelled(reason: unknown): boolean {
  return /abort\s*error|request (?:was )?aborted|this operation was aborted|the operation was aborted|operation was aborted|这一轮已取消|This turn was cancelled/i
    .test(String(reason ?? ''))
}

/**
 * Host / sidecar / settings dumps. Never a chat bubble, process detail, or
 * error line. Fuzz user prompts are Chinese prose and do not match.
 */
export function companionLooksLikeDebugPayload(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (/\[object Object\]/i.test(text)) return true
  if (/companion-host-\d+/i.test(text)) return true
  if (/companion_float_enabled|tokenflux\.dev\/v1/i.test(text) && /[{[]/.test(text)) {
    return true
  }
  if (!/^[{\[]/.test(text)) return false
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return /"settings"\s*:|"ok"\s*:\s*true|"relay"\s*:/.test(text)
  }
}

export function companionChatIsVisibleEntry(entry: {
  role?: string
  text?: string
  thinking?: string
  tools?: string[]
  components?: { kind?: string; detail?: string }[]
  attachments?: CodingAttachment[]
}): boolean {
  const role = String(entry.role ?? '').trim()
  if (role === 'tool' || role === 'toolResult' || role === 'custom') return false
  if (role && role !== 'user' && role !== 'assistant') return false
  const plain = companionChatUserFacingText(entry.text ?? '', Boolean(entry.attachments?.length))
  if (companionLooksLikeDebugPayload(plain)) {
    return Boolean(
      String(entry.thinking ?? '').trim()
      || (entry.tools?.length ?? 0) > 0
      || (entry.components?.length ?? 0) > 0,
    )
  }
  return true
}

/**
 * Maps a broken tool history to start-over copy for the rare case repair
 * could not run (provider still rejects). Prefer repair over Archive.
 */
export function companionChatNeedsNewConversation(reason: unknown): boolean {
  return /role ['"]tool['"].*tool_calls|工具记录断了|tool history is broken|这段对话没法继续了|This chat can't continue/i
    .test(String(reason ?? ''))
}

export function companionChatImageFile(
  text: string,
  attachment: Pick<CodingAttachment, 'name' | 'sha256'>,
): { workspacePath: string; relativePath: string } | null {
  const block = String(text ?? '').split('[MilkSU attachments]')[1]
  if (!block) return null
  const name = String(attachment.name ?? '').trim()
  const sha = String(attachment.sha256 ?? '').trim().toLowerCase()
  for (const line of block.split('\n')) {
    if (name && !line.includes(name) && sha && !line.toLowerCase().includes(sha)) continue
    if (sha && !line.toLowerCase().includes(sha)) continue
    const match = line.match(/(?:只读路径|read-only path):\s*(.+?)\)?\s*$/i)
    const absolute = String(match?.[1] ?? '').trim().replace(/[),.;]+$/u, '')
    const slash = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'))
    if (slash <= 0) continue
    const relativePath = absolute.slice(slash + 1)
    if (!relativePath || (name && relativePath !== name)) continue
    return { workspacePath: absolute.slice(0, slash), relativePath }
  }
  return null
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

export function companionChatPlainText(entry: {
  text?: string
  attachments?: CodingAttachment[]
}): string {
  const attachments = entry.attachments?.length
    ? entry.attachments
    : companionChatAttachmentsFromText(entry.text ?? '')
  const text = companionChatUserFacingText(entry.text ?? '', attachments.length > 0)
  if (companionLooksLikeDebugPayload(text) || companionTurnCancelled(text)) return ''
  return text
}

export function companionChatVisibleText(entry: {
  text?: string
  type?: string
  error?: string
  role?: string
  thinking?: string
  tools?: string[]
  attachments?: CodingAttachment[]
}): string {
  const attachments = entry.attachments?.length
    ? entry.attachments
    : companionChatAttachmentsFromText(entry.text ?? '')
  const text = companionChatUserFacingText(entry.text ?? '', attachments.length > 0)
  const type = String(entry.type ?? '').trim()
  const error = String(entry.error ?? '').trim()
  if (companionTurnCancelled(error || text)) {
    return explainCompanionError(error || text)
  }
  if (companionLooksLikeDebugPayload(text)) {
    if (error) return explainCompanionError(error) || ''
    return ''
  }
  if (text && text !== type) return text
  if (error) return explainCompanionError(error) || error
  // Thinking / tool-only rows are process chrome. Truly empty final replies are
  // decided by the phone renderer after the turn settles.
  return ''
}
