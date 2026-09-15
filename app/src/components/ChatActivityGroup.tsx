import { useMemo, useRef } from 'react'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import ChatSubagentRoster from '@/components/ChatSubagentRoster'
import {
  buildChatActivityEntries,
  detailsToggleOpen,
  visibleChatActivityEntries,
  type ChatActivityBlock,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
import { agentToolChip } from '@/lib/agentConversation'
import { subagentTasksForActivity } from '@/lib/subagentRoster'
import { useT } from '@/hooks/useUiLocale'
import type { SubagentTask } from '@/types'

export default function ChatActivityGroup({
  activity,
  open,
  openEntryIds,
  revealCompleted = false,
  subagentTasks = [],
  onToggleGroup: _onToggleGroup,
  onToggleEntry,
}: {
  activity: ChatActivityBlock
  open: boolean
  openEntryIds: ReadonlySet<string>
  revealCompleted?: boolean
  subagentTasks?: readonly SubagentTask[]
  onToggleGroup?: (open: boolean) => void
  onToggleEntry?: (entryId: string, open: boolean) => void
}) {
  const t = useT()
  const entryDetails = useRef(new Map<string, HTMLDetailsElement>())

  const rosterTasks = useMemo(() => (
    subagentTasksForActivity(subagentTasks, activity.messages)
  ), [subagentTasks, activity.messages])
  const rosterCallIds = useMemo(() => new Set(
    rosterTasks.flatMap(task => [task.id, task.toolCallId].filter(Boolean) as string[]),
  ), [rosterTasks])
  const toolEntries = useMemo(() => {
    const entries = buildChatActivityEntries(activity.messages)
      .filter(entry => (
        entry.toolName !== 'subagent'
        || !rosterCallIds.has(String(entry.request?.toolCallId ?? ''))
      ))
    return revealCompleted ? entries : visibleChatActivityEntries(entries, openEntryIds)
  }, [activity.messages, rosterCallIds, revealCompleted, openEntryIds])

  function setEntryDetails(entryId: string, element: HTMLDetailsElement | null) {
    if (element) entryDetails.current.set(entryId, element)
    else entryDetails.current.delete(entryId)
  }

  function reveal(element: Element | null | undefined) {
    if (!element || typeof element.scrollIntoView !== 'function') return
    queueMicrotask(() => {
      element.scrollIntoView({ block: 'nearest' })
    })
  }

  function toggleEntry(entryId: string, event: React.SyntheticEvent<HTMLDetailsElement>) {
    const nextOpen = detailsToggleOpen({
      target: event.target,
      currentTarget: event.currentTarget,
    })
    if (nextOpen === undefined) return
    onToggleEntry?.(entryId, nextOpen)
    if (nextOpen) reveal(entryDetails.current.get(entryId))
  }

  function chip(entry: ChatActivityEntry) {
    return agentToolChip(entry)
  }

  function durationLabel(durationMs?: number) {
    if (durationMs === undefined) return ''
    if (durationMs < 1000) return t(`${durationMs} 毫秒`, `${durationMs} ms`)
    if (durationMs < 10_000) return t(`${(durationMs / 1000).toFixed(1)} 秒`, `${(durationMs / 1000).toFixed(1)} s`)
    return t(`${Math.round(durationMs / 1000)} 秒`, `${Math.round(durationMs / 1000)} s`)
  }

  if (!toolEntries.length && !rosterTasks.length) return null

  return (
    <div
      className="tool-activity mb-7"
      data-activity-open={open ? 'true' : 'false'}
    >
      <ChatSubagentRoster tasks={rosterTasks} />
      {toolEntries.length ? (
        <div className="tool-activity__entries">
          {toolEntries.map(entry => {
            const chipValue = chip(entry)
            return (
              <details
                key={entry.id}
                ref={element => setEntryDetails(entry.id, element)}
                className="tool-activity-entry"
                open={openEntryIds.has(entry.id)}
                onToggle={event => toggleEntry(entry.id, event)}
              >
                <summary className="tool-activity-entry__summary agent-chip">
                  <span className="agent-chip__icon" aria-hidden="true">
                    <svg className="agent-chip__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {chipValue.verb === 'Edit' || chipValue.verb === 'Write' ? (
                        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
                      ) : chipValue.verb === 'bash' ? (
                        <path d="M4 17l6-5-6-5M12 19h8" />
                      ) : (
                        <g>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </g>
                      )}
                    </svg>
                    <svg className="agent-chip__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                  <strong>{chipValue.verb}</strong>
                  {chipValue.pill ? (
                    <span className="agent-pill">
                      <span className="min-w-0 truncate">{chipValue.pill}</span>
                      {chipValue.add !== undefined ? <span className="agent-pill__add">+{chipValue.add}</span> : null}
                      {chipValue.del !== undefined ? <span className="agent-pill__del">-{chipValue.del}</span> : null}
                    </span>
                  ) : null}
                  <span className="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
                    {entry.durationMs !== undefined ? <span>{durationLabel(entry.durationMs)}</span> : null}
                    {entry.running ? (
                      <AgentPixelLoader
                        label={t('工具进行中', 'Tool running')}
                        running
                      />
                    ) : null}
                  </span>
                </summary>
                <div className="tool-activity-entry__detail">
                  {entry.request ? (
                    <pre>{entry.request.content || t('工具没有可显示的输入。', 'This tool had no displayable input.')}</pre>
                  ) : null}
                  {entry.result ? (
                    <>
                      {entry.request ? (
                        <p className="tool-activity-entry__result-label">
                          {t('结果', 'Result')}
                        </p>
                      ) : null}
                      <pre>{entry.result.content || t('工具没有返回可显示的内容。', 'This tool returned no displayable output.')}</pre>
                    </>
                  ) : null}
                </div>
              </details>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
