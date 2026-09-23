import { isBackgroundDshJob } from '@/lib/dshHostSurface'
import { subagentRecordText } from '@/lib/subagentRoster'
import type { Conversation, SubagentTask } from '@/types'

export type WorkingItemKind = 'subagent' | 'child' | 'job'

export type WorkingItem = {
  id: string
  title: string
  status: 'running' | 'succeeded' | 'failed'
  kind: WorkingItemKind
  conversationId?: string
  role?: string
  detail?: string
  stoppable: boolean
}

export function isMultitaskChildConversation(conversation: Conversation | null | undefined) {
  return Boolean(String(conversation?.parentConversationId ?? '').trim())
}

export function workingRootConversation(
  conversation: Conversation | null | undefined,
  conversations: readonly Conversation[],
): Conversation | null {
  if (!conversation) return null
  const parentId = String(conversation.parentConversationId ?? '').trim()
  if (!parentId) return conversation
  return conversations.find(item => item.id === parentId) ?? conversation
}

export function childConversationsFor(
  parentId: string,
  conversations: readonly Conversation[],
): Conversation[] {
  const id = String(parentId ?? '').trim()
  if (!id) return []
  return conversations.filter(item => item.parentConversationId === id)
}

function taskStatus(task: SubagentTask): WorkingItem['status'] {
  if (task.status === 'succeeded') return 'succeeded'
  if (task.status === 'failed') return 'failed'
  return 'running'
}

function childStatus(
  conversation: Conversation,
  runningIds: ReadonlySet<string>,
): WorkingItem['status'] {
  if (runningIds.has(conversation.id)) return 'running'
  const last = [...conversation.messages].reverse().find(message => (
    message.role === 'assistant' || message.role === 'tool'
  ))
  if (last?.status === 'running' || last?.status === 'queued') return 'running'
  return 'succeeded'
}

export function workingItemsForConversation(
  conversation: Conversation | null | undefined,
  conversations: readonly Conversation[],
  runningIds: readonly string[] | ReadonlySet<string> = [],
): WorkingItem[] {
  const root = workingRootConversation(conversation, conversations)
  if (!root) return []
  const running = runningIds instanceof Set ? runningIds : new Set(runningIds)
  const kernel = root.kernel === 'dsh' ? 'dsh' : 'pi'
  const children = childConversationsFor(root.id, conversations)
  const tasks = (root.subagentTasks ?? []).map((task): WorkingItem => {
    const child = children.find(item => (
      item.id === task.id || item.id === task.toolCallId
    ))
    return {
      id: task.id,
      title: task.role,
      status: taskStatus(task),
      kind: 'subagent',
      conversationId: child?.id,
      role: task.role,
      detail: subagentRecordText(task),
      stoppable: kernel === 'dsh',
    }
  })
  const jobs = (root.dshJobs ?? [])
    .filter(job => isBackgroundDshJob(job))
    .filter(job => !tasks.some(task => task.id === job.id))
    .map((job): WorkingItem => ({
      id: job.id,
      title: job.label || job.id,
      status: job.status === 'failed' || job.status === 'killed' ? 'failed' : 'running',
      kind: 'job',
      role: job.kind,
      detail: job.detail,
      stoppable: true,
    }))
  const extraChildren = children
    .filter(child => !tasks.some(task => (
      task.id === child.id || task.conversationId === child.id
    )))
    .map((child): WorkingItem => ({
      id: child.id,
      title: child.title,
      status: childStatus(child, running),
      kind: 'child',
      conversationId: child.id,
      detail: child.messages.find(message => message.role === 'user')?.content,
      stoppable: true,
    }))
  return [...tasks, ...jobs, ...extraChildren]
}

export function liveWorkingItems(items: readonly WorkingItem[]) {
  return items.filter(item => item.status === 'running')
}

export function workingCapsuleCopy(
  liveCount: number,
  t: (zh: string, en: string) => string,
): string {
  if (liveCount <= 1) return t('进行中', 'Working')
  return t(`进行中 · ${liveCount}`, `Working · ${liveCount}`)
}
