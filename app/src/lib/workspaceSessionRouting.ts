import type { Conversation } from '@/types'

export type WorkspaceHome = 'chat' | 'image' | 'vuln' | 'lab' | 'reverse'

export function conversationWorkspaceHome(
  conversation: Conversation | null | undefined,
): WorkspaceHome {
  const kind = conversation?.domainTaskContext?.kind
  if (kind === 'cve') return 'vuln'
  if (kind === 'lab') return 'lab'
  const home = conversation?.workspaceHome
  if (home === 'vuln' || home === 'lab' || home === 'chat' || home === 'image' || home === 'reverse') return home
  return 'chat'
}

export function conversationsForWorkspaceHome(
  conversations: Conversation[],
  home: WorkspaceHome,
) {
  return conversations.filter(item => (
    conversationWorkspaceHome(item) === home
    && !item.parentConversationId
  ))
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
  if (context?.kind === 'lab') {
    const jobId = context.jobId.trim()
    return jobId ? `lab:${jobId}` : null
  }
  const legacyCveTitle = conversation.title
    ?.trim()
    .match(/^(CVE-\d{4}-\d{4,})\s+(?:研究接力|research handoff)$/iu)?.[1]
    ?.toLocaleLowerCase()
  if (legacyCveTitle) return `cve:${legacyCveTitle}`
  return null
}

export function relatedDomainConversations(
  conversations: Conversation[],
  conversation: Conversation | null | undefined,
) {
  const identity = conversationDomainIdentity(conversation ?? {})
  if (!identity) return conversation ? [conversation] : []
  return conversations
    .filter(item => conversationDomainIdentity(item) === identity)
    .sort((left, right) => conversationActivityAt(right) - conversationActivityAt(left))
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

export function isHomeConversation(conversation: Conversation | null | undefined) {
  return conversationWorkspaceHome(conversation) === 'chat'
}

export interface WorkspaceConversationMemory {
  codingConversationId: string | null
  vulnConversationId: string | null
  labConversationId: string | null
  imageConversationId: string | null
}

export function rememberWorkspaceConversation(
  conversation: Conversation | null | undefined,
  remembered: WorkspaceConversationMemory,
): WorkspaceConversationMemory {
  const next: WorkspaceConversationMemory = {
    codingConversationId: remembered.codingConversationId,
    vulnConversationId: remembered.vulnConversationId,
    labConversationId: remembered.labConversationId,
    imageConversationId: remembered.imageConversationId ?? null,
  }
  if (!conversation) return next
  const home = conversationWorkspaceHome(conversation)
  if (home === 'chat') next.codingConversationId = conversation.id
  if (home === 'image') next.imageConversationId = conversation.id
  if (home === 'vuln') next.vulnConversationId = conversation.id
  if (home === 'lab') next.labConversationId = conversation.id
  return next
}

export function rememberItemChatAnchor(
  anchors: Record<string, string>,
  conversation: Conversation | null | undefined,
) {
  const identity = conversationDomainIdentity(conversation ?? {})
  if (!identity || !conversation) return anchors
  if (anchors[identity] === conversation.id) return anchors
  return { ...anchors, [identity]: conversation.id }
}

export function selectAnchoredDomainConversationId(
  conversations: Conversation[],
  domainTaskContext: Conversation['domainTaskContext'],
  anchors: Record<string, string>,
) {
  const identity = conversationDomainIdentity({ domainTaskContext })
  if (identity) {
    const remembered = anchors[identity]
    if (remembered && conversations.some(item => item.id === remembered)) return remembered
  }
  return selectReusableDomainConversationId(conversations, domainTaskContext)
}

export function selectCodingConversationId(
  conversations: Conversation[],
  activeId: string | null,
  rememberedCodingConversationId: string | null,
) {
  const active = conversations.find(conversation => conversation.id === activeId)
  if (active && isHomeConversation(active)) return active.id

  const remembered = conversations.find(conversation => (
    conversation.id === rememberedCodingConversationId && isHomeConversation(conversation)
  ))
  if (remembered) return remembered.id

  return newestConversation(conversations.filter(isHomeConversation))?.id ?? null
}
