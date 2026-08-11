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

export function conversationDomainIdentity(
  conversation: Pick<Conversation, 'domainTaskContext'> & Partial<Pick<Conversation, 'title'>>,
) {
  const context = conversation.domainTaskContext
  if (context?.kind === 'cve') {
    const cveId = context.cveId.trim().toLocaleLowerCase()
    return cveId ? `cve:${cveId}` : null
  }
  const legacyCveTitle = conversation.title
    ?.trim()
    .match(/^(CVE-\d{4}-\d{4,})\s+研究接力$/iu)?.[1]
    ?.toLocaleLowerCase()
  if (legacyCveTitle) return `cve:${legacyCveTitle}`
  return null
}

export function selectReusableDomainConversationId(
  conversations: Conversation[],
  domainTaskContext: Conversation['domainTaskContext'],
) {
  const identity = conversationDomainIdentity({ domainTaskContext })
  if (!identity) return null
  return newestConversation(conversations.filter(conversation => (
    conversationDomainIdentity(conversation) === identity
  )))?.id ?? null
}

/**
 * Pre-release legacy builds could persist several Coding rows for one CVE.
 * Keep the history intact, but project only the newest row for each domain task.
 */
export function projectUniqueDomainConversations(conversations: Conversation[]) {
  const newestByIdentity = new Map<string, Conversation>()
  for (const conversation of conversations) {
    const identity = conversationDomainIdentity(conversation)
    if (!identity) continue
    const current = newestByIdentity.get(identity)
    if (!current || newestConversation([current, conversation])?.id === conversation.id) {
      newestByIdentity.set(identity, conversation)
    }
  }
  return conversations.filter(conversation => {
    const identity = conversationDomainIdentity(conversation)
    return !identity || newestByIdentity.get(identity)?.id === conversation.id
  })
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
