import { useMemo } from 'react'
import ChatActivityGroup from '@/components/ChatActivityGroup'
import ChatMessageItem from '@/components/ChatMessageItem'
import {
  isThinkingOnlyAssistant,
  mergeProcessThinking,
  processFoldSummary,
  type ChatProcessFoldBlock,
  type ChatTurnBlock,
} from '@/lib/chatActivity'
import { useT } from '@/hooks/useUiLocale'
import type { SubagentTask } from '@/types'

export default function ChatProcessFold({
  process,
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
}: {
  process: ChatProcessFoldBlock
  recoverableFailureId?: string | null
  recoveryContext?: 'ctf' | 'coding'
  rewindableUserMessageId?: string
  rewindDisabled?: boolean
  kernel?: 'pi' | 'dsh'
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
}) {
  const t = useT()
  const foldSummary = useMemo(() => processFoldSummary(process.blocks), [process.blocks])
  const foldedThinking = useMemo(() => mergeProcessThinking(process.blocks), [process.blocks])
  const visibleBlocks = useMemo(() => (
    process.blocks.filter((block): block is ChatTurnBlock => (
      block.kind === 'activity'
      || (block.kind === 'message' && !isThinkingOnlyAssistant(block.message))
    ))
  ), [process.blocks])

  return (
    <details className="agent-process mb-7">
      <summary className="agent-process__summary">
        <span>{t('过程', 'Process')}</span>
        {foldSummary ? <span className="agent-process__count">{foldSummary}</span> : null}
      </summary>
      <div className="agent-process__body">
        {foldedThinking ? (
          <ChatMessageItem
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
            />
          ) : (
            <ChatMessageItem
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
      </div>
    </details>
  )
}
