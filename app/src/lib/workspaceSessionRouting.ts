import type { Conversation } from '@/types'

export interface CTFResumePoint {
  conversationId: string | null
  jobId: string | null
}

export function isCTFConversation(conversation: Conversation | null | undefined) {
  return Boolean(conversation?.ctfJobId)
}

export function conversationActivityAt(conversation: Conversation) {
  return conversation.messages.reduce(
    (latest, message) => Math.max(latest, message.timestamp),
    conversation.createdAt,
  )
}

function newestConversation(conversations: Conversation[]) {
  return conversations.reduce<Conversation | null>((newest, conversation) => {
    if (!newest) return conversation
    const activity = conversationActivityAt(conversation)
    const newestActivity = conversationActivityAt(newest)
    if (activity > newestActivity) return conversation
    if (activity === newestActivity && conversation.createdAt > newest.createdAt) return conversation
    return newest
  }, null)
}

export function rememberWorkspaceConversation(
  conversation: Conversation | null | undefined,
  remembered: {
    codingConversationId: string | null
    ctfConversationId: string | null
  },
) {
  if (!conversation) return remembered
  return isCTFConversation(conversation)
    ? { ...remembered, ctfConversationId: conversation.id }
    : { ...remembered, codingConversationId: conversation.id }
}

export function selectCodingConversationId(
  conversations: Conversation[],
  activeId: string | null,
  rememberedCodingConversationId: string | null,
) {
  const active = conversations.find(conversation => conversation.id === activeId)
  if (active && !isCTFConversation(active)) return active.id

  const remembered = conversations.find(conversation => (
    conversation.id === rememberedCodingConversationId && !isCTFConversation(conversation)
  ))
  if (remembered) return remembered.id

  return newestConversation(conversations.filter(conversation => !isCTFConversation(conversation)))?.id ?? null
}

export function selectCTFResumePoint(
  conversations: Conversation[],
  activeId: string | null,
  rememberedCTFConversationId: string | null,
): CTFResumePoint {
  const active = conversations.find(conversation => conversation.id === activeId)
  const activeCTF = isCTFConversation(active) ? active : null
  const remembered = conversations.find(conversation => (
    conversation.id === rememberedCTFConversationId && isCTFConversation(conversation)
  ))
  const next = activeCTF
    ?? remembered
    ?? newestConversation(conversations.filter(isCTFConversation))
  return {
    conversationId: next?.id ?? null,
    jobId: next?.ctfJobId ?? null,
  }
}
