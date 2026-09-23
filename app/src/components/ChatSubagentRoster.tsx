import { useEffect, useRef, useState } from 'react'
import { UserRound } from 'lucide-react'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'
import { subagentRecordText } from '@/lib/subagentRoster'
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
  const [openId, setOpenId] = useState<string | null>(null)
  const recordRef = useRef<HTMLDivElement>(null)
  const stickToEnd = useRef(true)
  const openTask = openId ? tasks.find(task => task.id === openId) ?? null : null

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

  const record = openTask ? (subagentRecordText(openTask) || statusLabel(openTask)) : ''

  useEffect(() => {
    if (openId && !tasks.some(task => task.id === openId)) setOpenId(null)
  }, [openId, tasks])

  useEffect(() => {
    const node = recordRef.current
    if (!node || !stickToEnd.current) return
    node.scrollTop = node.scrollHeight
  }, [record])

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
            stickToEnd.current = true
            setOpenId(task.id)
            onOpen?.(task)
          }}
        >
          <span className="agent-chip__icon" aria-hidden="true">
            <UserRound className="agent-chip__glyph size-3.5" />
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
      <Dialog open={Boolean(openTask)} onOpenChange={open => { if (!open) setOpenId(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openTask?.role || t('子代理', 'Subagent')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('查看这个子代理的记录', 'View this subagent transcript')}
            </DialogDescription>
          </DialogHeader>
          <div
            ref={recordRef}
            className="max-h-[min(24rem,calc(100vh-12rem))] overflow-y-auto px-1 py-2"
            onScroll={() => {
              const node = recordRef.current
              if (!node) return
              stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
            }}
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-label">
              {record}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
