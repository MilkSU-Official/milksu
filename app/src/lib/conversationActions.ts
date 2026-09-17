import type { Conversation, Message } from '@/types'
import { redactProviderCredentials } from '@/lib/redaction'

export interface ConversationHandoffReceipt {
  sessionId: string
  summary?: string
  surfaceText?: string
}

/** Title plus the conversation id. Never include credentials, keys, or local paths. */
export function conversationCopyText(conversation: Pick<Conversation, 'id' | 'title'>): string {
  const title = String(conversation.title ?? '').trim()
  const id = String(conversation.id ?? '').trim()
  return [title, id].filter(Boolean).join('\n')
}

export function assistantForkPoint(messages: Message[]): { index: number, occurrence: number } | null {
  let occurrence = -1
  let index = -1
  for (let cursor = 0; cursor < messages.length; cursor += 1) {
    if (messages[cursor]?.role !== 'assistant') continue
    occurrence += 1
    index = cursor
  }
  if (index < 0 || occurrence < 0) return null
  return { index, occurrence }
}

/**
 * Clone the product conversation row for a sidebar Fork.
 * Pi owns true session-fork (`fork_conversation` from an assistant turn).
 * Without that point, MilkSU only copies workspace / project / home / kernel
 * settings onto a new row — not a second agent harness.
 */
export function cloneConversationForFork(
  source: Conversation,
  options: { id: string, title?: string, messages?: Message[] },
): Conversation {
  const title = String(options.title ?? source.title).trim().slice(0, 40) || source.title
  return {
    ...source,
    id: options.id,
    title,
    createdAt: Date.now(),
    pinned: undefined,
    pinnedOrder: undefined,
    archivedAt: undefined,
    lastContextUsage: undefined,
    subagentTasks: undefined,
    parentConversationId: undefined,
    multitask: undefined,
    messages: (options.messages ?? []).map(item => ({ ...item })),
  }
}

export function parseSessionHandoffResult(value: unknown): ConversationHandoffReceipt {
  if (typeof value === 'string') {
    return { sessionId: value.trim(), summary: '', surfaceText: '' }
  }
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    sessionId: String(record.sessionId ?? '').trim(),
    summary: String(record.summary ?? '').trim(),
    surfaceText: String(record.surfaceText ?? '').trim(),
  }
}

export function visibleHandoffSourceMessages(messages: Message[]): Message[] {
  return messages
    .filter(message => (
      (message.role === 'user' || message.role === 'assistant')
      && message.status !== 'queued'
      && String(message.content ?? '').trim()
    ))
    .map(message => ({
      ...message,
      status: 'done',
      thinkingStatus: message.thinkingStatus === 'running' ? 'done' : message.thinkingStatus,
    }))
}

function handoffCarriedMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: redactProviderCredentials(content),
    timestamp: Date.now(),
    status: 'done',
  }
}

/** Prefer the harness summary when compact produced one; otherwise copy the previous visible turns. */
export function handoffVisibleMessages(
  source: Message[],
  receipt?: Pick<ConversationHandoffReceipt, 'summary' | 'surfaceText'>,
): Message[] {
  const summary = String(receipt?.summary ?? '').trim()
  if (summary) return [handoffCarriedMessage(summary)]
  const original = visibleHandoffSourceMessages(source)
  if (original.length > 0) return original
  const surfaceText = String(receipt?.surfaceText ?? '').trim()
  if (surfaceText) return [handoffCarriedMessage(surfaceText)]
  return []
}
