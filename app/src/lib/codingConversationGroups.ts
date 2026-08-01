import type { Conversation } from '@/types'

export interface CodingConversationGroup {
  key: string
  name: string
  path: string | null
  temporary: boolean
  conversations: Conversation[]
  lastActiveAt: number
}

const TEMPORARY_GROUP_KEY = 'temporary'

function normalizeWorkspacePath(value?: string) {
  const normalized = value?.trim().replace(/[\\/]+$/, '')
  return normalized || null
}

function workspaceName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function newestFirst(left: Conversation, right: Conversation) {
  return right.createdAt - left.createdAt || left.title.localeCompare(right.title)
}

export function groupCodingConversations(
  conversations: Conversation[],
  query = '',
): CodingConversationGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const groups = new Map<string, CodingConversationGroup>()

  for (const conversation of conversations) {
    if (conversation.ctfJobId) continue

    const path = normalizeWorkspacePath(conversation.workspacePath)
    const key = path ? `workspace:${path}` : TEMPORARY_GROUP_KEY
    const group = groups.get(key) ?? {
      key,
      name: path ? workspaceName(path) : '临时沙盒',
      path,
      temporary: !path,
      conversations: [],
      lastActiveAt: conversation.createdAt,
    }
    group.conversations.push(conversation)
    group.lastActiveAt = Math.max(group.lastActiveAt, conversation.createdAt)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => {
      group.conversations.sort(newestFirst)
      if (!normalizedQuery) return group

      const groupMatches = [group.name, group.path ?? '']
        .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
      if (groupMatches) return group

      const matchingConversations = group.conversations.filter(conversation => (
        conversation.title.toLocaleLowerCase().includes(normalizedQuery)
      ))
      return matchingConversations.length
        ? { ...group, conversations: matchingConversations }
        : null
    })
    .filter((group): group is CodingConversationGroup => Boolean(group))
    .sort((left, right) => (
      right.lastActiveAt - left.lastActiveAt || left.name.localeCompare(right.name)
    ))
}
