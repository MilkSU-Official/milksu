import type { Conversation } from '@/types'
import {
  conversationActivityAt,
  projectUniqueDomainConversations,
} from '@/lib/workspaceSessionRouting'

export interface CodingConversationGroup {
  key: string
  name: string
  path: string | null
  paths: string[]
  temporary: boolean
  conversations: Conversation[]
  lastActiveAt: number
}

const TEMPORARY_GROUP_KEY = 'temporary'

function normalizeWorkspacePath(value?: string | null) {
  const normalized = value
    ?.trim()
    .replaceAll('\\', '/')
    .replace(/^\/private\/(tmp|var)\//, '/$1/')
    .replace(/[\\/]+$/, '')
  return normalized || null
}

function workspaceName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function isGeneratedScratchWorkspace(value?: string | null) {
  const path = normalizeWorkspacePath(value)
  if (!path) return false
  return /\/MilkSU\/Coding\/(?:新编码任务|临时任务)-[a-f0-9]{8}$/u.test(path)
    || /\/agent-workspaces\/Coding\/无项目任务-[a-f0-9]{8}$/u.test(path)
    || /\/MilkSU\/(?:Lab|CVE|CTF)\/[^/]+-[a-f0-9]{6,}$/u.test(path)
    || /\/agent-workspaces\/(?:Lab|CVE|CTF)\//u.test(path)
}

function workspaceGroupKey(path: string | null) {
  if (!path) return TEMPORARY_GROUP_KEY
  return `workspace-name:${workspaceName(path).toLocaleLowerCase()}`
}

function newestFirst(left: Conversation, right: Conversation) {
  return (
    conversationActivityAt(right) - conversationActivityAt(left)
    || right.createdAt - left.createdAt
    || left.title.localeCompare(right.title)
  )
}

export function groupCodingConversations(
  conversations: Conversation[],
  query = '',
): CodingConversationGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const groups = new Map<string, CodingConversationGroup>()

  for (const conversation of projectUniqueDomainConversations(conversations)) {
    if (conversation.ctfJobId) continue

    const normalizedPath = normalizeWorkspacePath(conversation.workspacePath)
    const path = isGeneratedScratchWorkspace(normalizedPath) ? null : normalizedPath
    const key = workspaceGroupKey(path)
    const group = groups.get(key) ?? {
      key,
      name: path ? workspaceName(path) : '无项目任务',
      path,
      paths: path ? [path] : [],
      temporary: !path,
      conversations: [],
      lastActiveAt: conversationActivityAt(conversation),
    }
    if (path && !group.paths.includes(path)) {
      group.paths.push(path)
      group.paths.sort((left, right) => left.localeCompare(right))
      group.path = group.paths.length === 1 ? group.paths[0] : null
    }
    group.conversations.push(conversation)
    group.lastActiveAt = Math.max(group.lastActiveAt, conversationActivityAt(conversation))
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => {
      group.conversations.sort(newestFirst)
      if (!normalizedQuery) return group

      const groupMatches = [group.name, group.path ?? '', ...group.paths]
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
    .sort((left, right) => {
      // Scratch/no-project tasks always sit alone at the bottom, outside project ordering.
      if (left.temporary !== right.temporary) return left.temporary ? 1 : -1
      return right.lastActiveAt - left.lastActiveAt || left.name.localeCompare(right.name)
    })
}
