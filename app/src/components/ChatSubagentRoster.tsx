import { useRef } from 'react'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import { formatSubagentYield } from '@/lib/subagentRoster'
import { useT } from '@/hooks/useUiLocale'
import type { SubagentTask } from '@/types'

export default function ChatSubagentRoster({
  tasks,
}: {
  tasks: readonly SubagentTask[]
}) {
  const t = useT()
  const entryDetails = useRef(new Map<string, HTMLDetailsElement>())

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

  function onToggle(entryId: string, event: React.SyntheticEvent<HTMLDetailsElement>) {
    const details = event.currentTarget
    if (!(details instanceof HTMLDetailsElement) || event.target !== event.currentTarget) return
    if (details.open) reveal(entryDetails.current.get(entryId))
  }

  function durationLabel(durationMs?: number) {
    if (durationMs === undefined) return ''
    if (durationMs < 1000) return t(`${durationMs} 毫秒`, `${durationMs} ms`)
    if (durationMs < 10_000) return t(`${(durationMs / 1000).toFixed(1)} 秒`, `${(durationMs / 1000).toFixed(1)} s`)
    return t(`${Math.round(durationMs / 1000)} 秒`, `${Math.round(durationMs / 1000)} s`)
  }

  function statusLabel(task: SubagentTask) {
    if (task.status === 'succeeded') return t('成功', 'Succeeded')
    if (task.status === 'failed') return t('失败', 'Failed')
    return t('进行中', 'Running')
  }

  function yieldText(task: SubagentTask) {
    return formatSubagentYield(task.yield)
  }

  if (!tasks.length) return null

  return (
    <div className="tool-activity__entries" data-testid="subagent-roster">
      {tasks.map(task => (
        <details
          key={task.id}
          ref={element => setEntryDetails(task.id, element)}
          className="tool-activity-entry"
          data-subagent-status={task.status}
          onToggle={event => onToggle(task.id, event)}
        >
          <summary className="tool-activity-entry__summary agent-chip">
            <span className="agent-chip__icon" aria-hidden="true">
              <svg className="agent-chip__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3" />
                <path d="M5 19a7 7 0 0 1 14 0" />
              </svg>
              <svg className="agent-chip__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
            <strong>{task.role}</strong>
            <span className="min-w-0 truncate text-caption text-muted-foreground">{task.id}</span>
            <span className="agent-pill">
              <span className="min-w-0 truncate">{statusLabel(task)}</span>
            </span>
            <span className="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
              {task.durationMs !== undefined ? <span>{durationLabel(task.durationMs)}</span> : null}
              {task.exitCode !== undefined ? <span>{t(`结束码 ${task.exitCode}`, `exit ${task.exitCode}`)}</span> : null}
              {task.status === 'start' || task.status === 'running' ? (
                <AgentPixelLoader
                  label={t('子任务进行中', 'Subtask running')}
                  running
                />
              ) : null}
            </span>
          </summary>
          {yieldText(task) ? (
            <div className="tool-activity-entry__detail">
              <pre>{yieldText(task)}</pre>
            </div>
          ) : null}
        </details>
      ))}
    </div>
  )
}
