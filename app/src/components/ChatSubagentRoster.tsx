import { useState } from 'react'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'
import { formatSubagentYield } from '@/lib/subagentRoster'
import { useT } from '@/hooks/useUiLocale'
import type { SubagentTask } from '@/types'

export default function ChatSubagentRoster({
  tasks,
  onOpen,
}: {
  tasks: readonly SubagentTask[]
  onOpen?: (task: SubagentTask) => void
}) {
  const t = useT()
  const [openTask, setOpenTask] = useState<SubagentTask | null>(null)

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

  function bodyText(task: SubagentTask) {
    return task.transcript || task.summary || formatSubagentYield(task.yield)
  }

  if (!tasks.length) return null

  return (
    <div className="tool-activity__entries" data-testid="subagent-roster">
      {tasks.map(task => (
        <button
          key={task.id}
          type="button"
          className="tool-activity-entry__summary agent-chip w-full text-left"
          data-subagent-status={task.status}
          onClick={() => {
            setOpenTask(task)
            onOpen?.(task)
          }}
        >
          <span className="agent-chip__icon" aria-hidden="true">
            <svg className="agent-chip__glyph" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="3" />
              <path d="M5 19a7 7 0 0 1 14 0" />
            </svg>
          </span>
          <strong>{task.role}</strong>
          <span className="min-w-0 truncate text-caption text-muted-foreground">{task.summary || statusLabel(task)}</span>
          <span className="agent-pill">
            <span className="min-w-0 truncate">{statusLabel(task)}</span>
          </span>
          <span className="agent-chip__meta shrink-0 text-caption tabular-nums text-muted-foreground">
            {task.durationMs !== undefined ? <span>{durationLabel(task.durationMs)}</span> : null}
            {task.status === 'start' || task.status === 'running' ? (
              <AgentPixelLoader
                label={t('子任务进行中', 'Subtask running')}
                running
              />
            ) : null}
          </span>
        </button>
      ))}
      <Dialog open={Boolean(openTask)} onOpenChange={open => { if (!open) setOpenTask(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openTask?.role || t('子代理', 'Subagent')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('查看这个子代理的记录', 'View this subagent transcript')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(24rem,calc(100vh-12rem))] overflow-y-auto px-1 py-2">
            <pre className="whitespace-pre-wrap break-words font-sans text-label">
              {openTask ? (bodyText(openTask) || statusLabel(openTask)) : ''}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
