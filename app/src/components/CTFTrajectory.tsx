import { useMemo, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Flag,
  RotateCcw,
  X,
} from 'lucide-react'
import type { CTFProjection } from '@/ctfTypes'
import MarkdownContent from '@/components/MarkdownContent'
import { useT } from '@/hooks/useUiLocale'

type TimelineKind = 'agent' | 'experiment' | 'submission' | 'failure'

interface TimelineEntry {
  id: string
  number: number
  kind: TimelineKind
  title: string
  summary: string
  status: string
  detail: string
  artifactCount: number
  occurredAt: string
}

export default function CTFTrajectory({
  projection,
}: {
  projection: CTFProjection
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  function actionTitle(name: string) {
    switch (name) {
      case 'ctf.pi_agent_turn':
        return { kind: 'agent' as const, title: t('PI Agent 解题回合', 'PI Agent solving turn') }
      case 'ctf.submit_flag':
        return { kind: 'submission' as const, title: t('候选进入 Judge 闸门', 'Candidate entered the Judge gate') }
      case 'ctf.record_learning':
        return { kind: 'experiment' as const, title: t('训练观察已记录', 'Training observation recorded') }
      default:
        return { kind: 'experiment' as const, title: name || t('可复现实验', 'Reproducible experiment') }
    }
  }

  const entries = useMemo<TimelineEntry[]>(() => {
    const attempts = new Map(projection.attempts.map(attempt => [attempt.id, attempt]))
    const experimentAttemptIds = new Set(projection.experiments.map(experiment => experiment.attemptId))
    const values = projection.experiments.map(experiment => {
      const attempt = attempts.get(experiment.attemptId)
      const action = experiment.action
      const definition = actionTitle(action?.name ?? '')
      const observation = experiment.observations.at(-1)?.summary
      const failed = experiment.status === 'failed' || attempt?.status === 'failed'
      return {
        id: experiment.id,
        number: experiment.number,
        kind: failed ? 'failure' as const : definition.kind,
        title: failed ? t(`${definition.title}失败`, `${definition.title} failed`) : definition.title,
        summary: failed
          ? t('这个回合没有完成。需要诊断时可回到关联的 Coding 会话继续处理。', 'This turn did not complete. Open the related Coding session if you need to diagnose it.')
          : observation || action?.rationale || t('该步骤尚未形成完整观察。', 'This step does not yet have a complete observation.'),
        status: failed ? 'failed' : experiment.status,
        detail: [attempt?.engine, attempt?.model].filter(Boolean).join(' · '),
        artifactCount: experiment.artifactIds.length,
        occurredAt: experiment.finishedAt || experiment.startedAt,
      }
    })
    for (const attempt of projection.attempts) {
      if (experimentAttemptIds.has(attempt.id) || (!attempt.reason && attempt.status !== 'failed')) continue
      values.push({
        id: attempt.id,
        number: values.length + 1,
        kind: 'failure',
        title: t('Agent 回合中断', 'Agent turn interrupted'),
        summary: t('这个回合没有完成。需要诊断时可回到关联的 Coding 会话继续处理。', 'This turn did not complete. Open the related Coding session if you need to diagnose it.'),
        status: attempt.status,
        detail: [attempt.engine, attempt.model].filter(Boolean).join(' · '),
        artifactCount: 0,
        occurredAt: attempt.finishedAt || attempt.startedAt,
      })
    }
    return values.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  }, [projection, t])

  const visibleEntries = expanded || entries.length <= 5 ? entries : entries.slice(-5)

  function formatTime(value: string) {
    if (!value) return ''
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value))
  }

  function statusLabel(status: string) {
    switch (status) {
      case 'completed': return t('已完成', 'Completed')
      case 'running': return t('进行中', 'In progress')
      case 'failed': return t('失败', 'Failed')
      case 'cancelled':
      case 'aborted':
      case 'interrupted': return t('已中断', 'Interrupted')
      default: return status || t('等待', 'Waiting')
    }
  }

  return (
    <details className="group overflow-hidden rounded-menu-shell border border-border bg-card px-5 py-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="flex items-center gap-2 text-label font-medium">
            <RotateCcw className="size-4" />
            {t('解题轨迹', 'Solving trajectory')}
          </h2>
        </div>
        <span className="flex items-center gap-2">
          <Badge variant="outline">{t(`${entries.length} 步`, `${entries.length} steps`)}</Badge>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>

      {visibleEntries.length ? (
        <div className="mt-5 border-t border-border pt-5">
          {visibleEntries.map((entry, index) => (
            <article
              key={entry.id}
              className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
            >
              {index < visibleEntries.length - 1 ? (
                <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" aria-hidden="true" />
              ) : null}
              <span
                className={`relative z-10 flex size-7 items-center justify-center rounded-full border bg-background ${
                  entry.kind === 'failure' ? 'border-destructive/50 text-destructive' : 'border-border text-foreground'
                }`}
              >
                {entry.kind === 'failure' ? <X className="size-3.5" />
                  : entry.kind === 'agent' ? <Bot className="size-3.5" />
                    : entry.kind === 'submission' ? <Flag className="size-3.5" />
                      : <FileCode2 className="size-3.5" />}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-caption text-muted-foreground">#{entry.number}</span>
                  <p className="text-control font-medium">{entry.title}</p>
                  <Badge variant={entry.kind === 'failure' ? 'destructive' : 'outline'}>
                    {statusLabel(entry.status)}
                  </Badge>
                  <span className="text-caption text-muted-foreground">{formatTime(entry.occurredAt)}</span>
                </div>
                <MarkdownContent
                  className="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                  content={entry.summary}
                  compact
                />
                {entry.detail || entry.artifactCount ? (
                  <div className="mt-2 flex flex-wrap gap-3 text-caption text-muted-foreground">
                    {entry.detail ? <span>{entry.detail}</span> : null}
                    {entry.artifactCount ? <span>{t(`${entry.artifactCount} 个制品`, `${entry.artifactCount} artifacts`)}</span> : null}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-5 border-t border-border" />
      )}

      {entries.length > 5 ? (
        <Button
          variant="link"
          size="text"
          className="mt-4"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? t('只看最近 5 步', 'Show last 5 steps') : t(`展开全部 ${entries.length} 步`, `Expand all ${entries.length} steps`)}
        </Button>
      ) : null}
    </details>
  )
}
