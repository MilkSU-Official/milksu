import type { Conversation } from '@/types'
import { t } from '@/lib/uiLocale'
import {
  conversationActivityAt,
  conversationDomainIdentity,
  conversationsForWorkspaceHome,
  projectUniqueDomainConversations,
  type WorkspaceHome,
} from '@/lib/workspaceSessionRouting'

export interface CodingConversationGroup {
  key: string
  name: string
  path: string | null
  paths: string[]
  temporary: boolean
  /** Draw chats sit directly under the sidebar header. No second folder. */
  flat?: boolean
  conversations: Conversation[]
  lastActiveAt: number
}

const TEMPORARY_GROUP_KEY = 'temporary'
const PINNED_GROUP_KEY = 'pinned'

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
  const pinnedConversations: Conversation[] = []

  for (const conversation of projectUniqueDomainConversations(conversations)) {
    if (conversation.ctfJobId || conversation.parentConversationId) continue
    if (conversation.pinned) {
      pinnedConversations.push(conversation)
      continue
    }

    const normalizedPath = normalizeWorkspacePath(conversation.workspacePath)
    const path = isGeneratedScratchWorkspace(normalizedPath) ? null : normalizedPath
    const key = workspaceGroupKey(path)
    const group = groups.get(key) ?? {
      key,
      name: path ? workspaceName(path) : t('最近', 'Recent'),
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

  const result = [...groups.values()]
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

  // Pinned chats get one section at the very top, across every project, ordered by
  // hand only: new messages and running turns must never move them.
  if (pinnedConversations.length) {
    const pinned = [...pinnedConversations].sort((left, right) => (
      (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt - right.createdAt
      || left.title.localeCompare(right.title)
    ))
    const matching = normalizedQuery
      ? pinned.filter(conversation => (
          conversation.title.toLocaleLowerCase().includes(normalizedQuery)
        ))
      : pinned
    if (matching.length) {
      result.unshift({
        key: PINNED_GROUP_KEY,
        name: t('钉选', 'Pinned'),
        path: null,
        paths: [],
        temporary: false,
        conversations: matching,
        lastActiveAt: Math.max(...matching.map(conversationActivityAt)),
      })
    }
  }

  return result
}

function domainGroupName(conversation: Conversation) {
  const context = conversation.domainTaskContext
  if (context?.kind === 'cve') return context.cveId
  if (context?.kind === 'lab') return context.title
  if (context?.kind === 'ctf') return context.challengeTitle
  return conversation.title
}

export function groupWorkspaceConversations(
  conversations: Conversation[],
  home: WorkspaceHome,
  query = '',
): CodingConversationGroup[] {
  if (home === 'chat') {
    return groupCodingConversations(
      conversationsForWorkspaceHome(conversations, 'chat'),
      query,
    )
  }
  if (home === 'image') {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const matching = conversationsForWorkspaceHome(conversations, 'image')
      .filter(conversation => (
        !normalizedQuery
        || conversation.title.toLocaleLowerCase().includes(normalizedQuery)
      ))
      .sort(newestFirst)
    if (!matching.length) return []
    return [{
      key: 'image',
      name: '',
      path: null,
      paths: [],
      temporary: false,
      flat: true,
      conversations: matching,
      lastActiveAt: Math.max(...matching.map(conversationActivityAt)),
    }]
  }
  const scoped = conversationsForWorkspaceHome(conversations, home)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const groups = new Map<string, CodingConversationGroup>()
  for (const conversation of scoped) {
    const identity = conversationDomainIdentity(conversation) ?? `home:${home}`
    const name = conversationDomainIdentity(conversation)
      ? domainGroupName(conversation)
      : t('会话', 'Chats')
    const group = groups.get(identity) ?? {
      key: identity,
      name,
      path: null,
      paths: [],
      temporary: false,
      conversations: [],
      lastActiveAt: conversationActivityAt(conversation),
    }
    group.conversations.push(conversation)
    group.lastActiveAt = Math.max(group.lastActiveAt, conversationActivityAt(conversation))
    groups.set(identity, group)
  }
  return [...groups.values()]
    .map(group => {
      group.conversations.sort(newestFirst)
      if (!normalizedQuery) return group
      const groupMatches = group.name.toLocaleLowerCase().includes(normalizedQuery)
      if (groupMatches) return group
      const matchingConversations = group.conversations.filter(conversation => (
        conversation.title.toLocaleLowerCase().includes(normalizedQuery)
      ))
      return matchingConversations.length ? { ...group, conversations: matchingConversations } : null
    })
    .filter((group): group is CodingConversationGroup => Boolean(group))
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt || left.name.localeCompare(right.name))
}
