import { useMemo, useRef, type SyntheticEvent } from 'react'
import {
  AppWindow,
  FileText,
  Folder,
  FolderTree,
  Image,
  LayoutDashboard,
  Lightbulb,
  Monitor,
  PenLine,
  Search,
  Server,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import AgentLiveStatus from '@/components/AgentLiveStatus'
import ChatSubagentRoster from '@/components/ChatSubagentRoster'
import ChatWorkFold from '@/components/ChatWorkFold'
import {
  buildChatActivityEntries,
  detailsToggleOpen,
  visibleChatActivityEntries,
  type ChatActivityBlock,
  type ChatActivityEntry,
} from '@/lib/chatActivity'
import { agentToolChip, agentToolIconKind } from '@/lib/agentConversation'
import { subagentTasksForActivity } from '@/lib/subagentRoster'
import type { ChatFoldModel } from '@/lib/chatWorkStatus'
import { useT } from '@/hooks/useUiLocale'
import type { SubagentTask } from '@/types'

const TOOL_ICONS: Record<ReturnType<typeof agentToolIconKind>, LucideIcon> = {
  terminal: Terminal,
  file: FileText,
  edit: PenLine,
  folder: Folder,
  search: Search,
  plan: Lightbulb,
  image: Image,
  layout: LayoutDashboard,
  worktree: FolderTree,
  workspace: AppWindow,
  server: Server,
  monitor: Monitor,
  tool: Wrench,
}

export default function ChatActivityGroup({
  activity,
  model,
  open,
  openEntryIds,
  revealCompleted = false,
  subagentTasks = [],
  onToggleGroup,
  onToggleEntry,
  onOpenSubagent,
}: {
  activity: ChatActivityBlock
  model?: ChatFoldModel
  open: boolean
  openEntryIds: ReadonlySet<string>
  revealCompleted?: boolean
  subagentTasks?: readonly SubagentTask[]
  onToggleGroup?: (open: boolean) => void
  onToggleEntry?: (entryId: string, open: boolean) => void
  onOpenSubagent?: (task: SubagentTask) => void
}) {
  const t = useT()
  const entryDetails = useRef(new Map<string, HTMLDetailsElement>())

  const toolEntries = useMemo(() => {
    const entries = buildChatActivityEntries(activity.messages)
      .filter(entry => entry.toolName !== 'subagent')
    return revealCompleted ? entries : visibleChatActivityEntries(entries, openEntryIds)
  }, [activity.messages, revealCompleted, openEntryIds])
  const roster = useMemo(
    () => subagentTasksForActivity(subagentTasks, activity.messages),
    [activity.messages, subagentTasks],
  )

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

  function toggleEntry(entryId: string, event: SyntheticEvent<HTMLDetailsElement>) {
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

  if (!toolEntries.length && !roster.length) return null

  const entries = (
    <div className="tool-activity" data-activity-open={open ? 'true' : 'false'}>
      {toolEntries.length ? (
        <div className="tool-activity__entries">
          {toolEntries.map(entry => {
            const chipValue = chip(entry)
            const Icon = TOOL_ICONS[agentToolIconKind(entry.toolName)]
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
                    <Icon className="agent-chip__glyph" size={13} strokeWidth={2} />
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
                      <AgentLiveStatus
                        label={t('工具进行中', 'Tool running')}
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
      <ChatSubagentRoster tasks={roster} onOpen={onOpenSubagent} />
    </div>
  )

  if (revealCompleted || !model) return entries

  return (
    <ChatWorkFold
      model={model}
      open={open}
      onToggle={next => onToggleGroup?.(next)}
    >
      {entries}
    </ChatWorkFold>
  )
}
