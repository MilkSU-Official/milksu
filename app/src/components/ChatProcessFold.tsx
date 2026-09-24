import { useMemo } from 'react'
import ChatActivityGroup from '@/components/ChatActivityGroup'
import ChatMessageItem from '@/components/ChatMessageItem'
import ChatWorkFold from '@/components/ChatWorkFold'
import {
  isThinkingOnlyAssistant,
  mergeProcessThinking,
  type ChatProcessFoldBlock,
  type ChatTurnBlock,
} from '@/lib/chatActivity'
import type { ChatFoldModel } from '@/lib/chatWorkStatus'
import type { SubagentTask } from '@/types'

export default function ChatProcessFold({
  protectedFolders,
  process,
  model,
  recoverableFailureId,
  recoveryContext,
  rewindableUserMessageId,
  rewindDisabled,
  kernel,
  activityOpen,
  activityOpenEntries,
  subagentTasks,
  onToggleGroup,
  onToggleEntry,
  onRespondApproval,
  onRetry,
  onEditUser,
  onRewindContext,
  onBranchAssistant,
  onOpenSubagent,
}: {
  process: ChatProcessFoldBlock
  model: ChatFoldModel
  recoverableFailureId?: string | null
  recoveryContext?: 'ctf' | 'coding'
  rewindableUserMessageId?: string
  rewindDisabled?: boolean
  kernel?: 'pi' | 'dsh'
  /** 受限文件夹的**生效列表**（总开关关掉时为空）：透传给消息项，让折叠里的审批也用同一份事实。 */
  protectedFolders?: string[]
  activityOpen: (activityId: string) => boolean
  activityOpenEntries: (activityId: string) => ReadonlySet<string>
  subagentTasks?: readonly SubagentTask[]
  memoKey: string
  onToggleGroup?: (activityId: string, open: boolean) => void
  onToggleEntry?: (activityId: string, entryId: string, open: boolean) => void
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onRetry?: () => void
  onEditUser?: (messageId: string, content: string) => void
  onRewindContext?: () => void
  onBranchAssistant?: (messageId: string) => void
  onOpenSubagent?: (task: SubagentTask) => void
}) {
  const foldedThinking = useMemo(() => mergeProcessThinking(process.blocks), [process.blocks])
  const visibleBlocks = useMemo(() => (
    process.blocks.filter((block): block is ChatTurnBlock => (
      block.kind === 'activity'
      || (block.kind === 'message' && !isThinkingOnlyAssistant(block.message))
    ))
  ), [process.blocks])

  return (
    <ChatWorkFold model={model}>
        {foldedThinking ? (
          <ChatMessageItem
            protectedFolders={protectedFolders}
            message={foldedThinking}
            thinkingTotal
          />
        ) : null}
        {visibleBlocks.map(item => (
          item.kind === 'activity' ? (
            <ChatActivityGroup
              key={item.id}
              activity={item}
              open={activityOpen(item.id)}
              openEntryIds={activityOpenEntries(item.id)}
              subagentTasks={subagentTasks}
              revealCompleted
              onToggleGroup={open => onToggleGroup?.(item.id, open)}
              onToggleEntry={(entryId, open) => onToggleEntry?.(item.id, entryId, open)}
              onOpenSubagent={onOpenSubagent}
            />
          ) : (
            <ChatMessageItem
            protectedFolders={protectedFolders}
              key={item.id}
              message={item.message}
              recoverable={item.message.id === recoverableFailureId}
              recoveryContext={recoveryContext}
              canRewind={item.message.id === rewindableUserMessageId}
              rewindDisabled={rewindDisabled}
              kernel={kernel}
              onRespondApproval={(requestId, approved, scope, choice) => onRespondApproval?.(requestId, approved, scope, choice)}
              onRetry={onRetry}
              onEditUser={(messageId, content) => onEditUser?.(messageId, content)}
              onRewindContext={onRewindContext}
              onBranchAssistant={messageId => onBranchAssistant?.(messageId)}
            />
          )
        ))}
    </ChatWorkFold>
  )
}
