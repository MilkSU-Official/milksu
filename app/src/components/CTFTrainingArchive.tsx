import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, Badge, Button, SettingsSection } from '@/components/ui'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileDown,
  LoaderCircle,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { invokeCommand } from '@/desktop'
import MarkdownContent from '@/components/MarkdownContent'
import { redactProviderCredentials } from '@/lib/redaction'
import { useT } from '@/hooks/useUiLocale'
import type {
  CTFAgentReplay,
  CTFAgentReplayEvent,
  CTFTrainingReportExport,
} from '@/ctfTypes'

export default function CTFTrainingArchive({
  jobId,
  replayAvailable,
}: {
  jobId: string
  replayAvailable: boolean
}) {
  const t = useT()
  const [replay, setReplay] = useState<CTFAgentReplay | null>(null)
  const [report, setReport] = useState<CTFTrainingReportExport | null>(null)
  const [replayOpen, setReplayOpen] = useState(false)
  const [replayExpanded, setReplayExpanded] = useState(false)
  const [loadingReplay, setLoadingReplay] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const visibleReplayEvents = useMemo(() => {
    const events = replay?.events ?? []
    return replayExpanded ? events.slice(-100) : events.slice(-6)
  }, [replay, replayExpanded])

  function errorMessage(reason: unknown) {
    return redactProviderCredentials(reason instanceof Error ? reason.message : String(reason))
  }

  useEffect(() => {
    setReplay(null)
    setReport(null)
    setReplayOpen(false)
    setReplayExpanded(false)
    setError('')
    setNotice('')
  }, [jobId])

  async function loadReplay() {
    if (replay) {
      setReplayOpen(value => !value)
      return
    }
    setLoadingReplay(true)
    setError('')
    setNotice('')
    try {
      setReplay(await invokeCommand<CTFAgentReplay>('get_ctf_agent_replay', { id: jobId }))
      setReplayOpen(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoadingReplay(false)
    }
  }

  async function generateReport() {
    setGeneratingReport(true)
    setError('')
    setNotice('')
    try {
      setReport(await invokeCommand<CTFTrainingReportExport>('generate_ctf_training_report', { id: jobId }))
      setNotice(t('安全报告已生成。', 'Security report generated.'))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setGeneratingReport(false)
    }
  }

  async function copy(value: string, label: string) {
    if (!value) return
    setError('')
    try {
      await navigator.clipboard.writeText(value)
      setNotice(t(`${label}已复制。`, `${label} copied.`))
    } catch (reason) {
      setError(t(`复制失败：${errorMessage(reason)}`, `Copy failed: ${errorMessage(reason)}`))
    }
  }

  function eventLabel(event: CTFAgentReplayEvent) {
    if (event.toolName) return event.toolName
    switch (event.type) {
      case 'assistant_text': return t('Agent 回复', 'Agent reply')
      case 'tool_call': return t('工具调用', 'Tool call')
      case 'tool_result': return t('工具结果', 'Tool result')
      case 'turn_end': return t('回合完成', 'Turn completed')
      case 'error': return t('运行错误', 'Run error')
      default: return event.type || t('运行事件', 'Run event')
    }
  }

  function eventSummary(event: CTFAgentReplayEvent) {
    return redactProviderCredentials(event.error || event.text || event.engine || t('该事件没有附带文本。', 'This event has no attached text.'))
  }

  function formatTime(value?: string) {
    if (!value) return ''
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value))
  }

  function actorLabel(actor: string) {
    if (actor === 'user') return t('用户完成', 'Completed by user')
    if (actor === 'agent') return t('Agent 代做', 'Completed by Agent')
    if (actor === 'shared') return t('共同完成', 'Completed together')
    return t('尚无可归属证据', 'No attributable evidence yet')
  }

  function assistanceLabel(assistance: string) {
    if (assistance === 'none') return t('无协助', 'No assistance')
    if (assistance === 'hint') return t('依赖提示', 'Used hints')
    if (assistance === 'copilot') return t('搭档协作', 'Copilot collaboration')
    return t('代理完成', 'Delegate completed')
  }

  return (
    <SettingsSection
      title={t('训练档案', 'Training archive')}
      aria-labelledby="training-archive-title"
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingReplay || !replayAvailable}
            onClick={() => { void loadReplay() }}
          >
            {loadingReplay ? <LoaderCircle className="size-4 animate-spin" /> : <TerminalSquare className="size-4" />}
            {replayOpen ? t('收起回放', 'Hide replay') : t('运行回放', 'Run replay')}
          </Button>
          <Button size="sm" disabled={generatingReport} onClick={() => { void generateReport() }}>
            {generatingReport ? <LoaderCircle className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            {report ? t('重新生成', 'Regenerate') : t('生成报告', 'Generate report')}
          </Button>
        </div>
      )}
    >
      <div className="px-5 py-5">
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <ShieldCheck className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : notice ? (
          <Alert className="mt-4">
            <Check className="size-4" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {report ? (
          <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-control font-medium">{t('可分享训练报告', 'Shareable training report')}</p>
                <Badge variant={report.report.verified ? 'secondary' : 'outline'}>
                  {report.report.verified ? t('平台已验证', 'Platform verified') : t('尚未验证', 'Not yet verified')}
                </Badge>
                <Badge variant="outline">{actorLabel(report.report.contribution.primaryActor)}</Badge>
                <Badge variant="outline">{assistanceLabel(report.report.contribution.assistance)}</Badge>
              </div>
              <span className="text-caption text-muted-foreground">
                {new Date(report.report.generatedAt).toLocaleString()}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md bg-background px-3 py-2">
                <p className="text-caption text-muted-foreground">{t('完成回合', 'Completed turns')}</p>
                <p className="mt-1 font-mono text-control">{report.report.stats.completedTurns}</p>
              </div>
              <div className="rounded-md bg-background px-3 py-2">
                <p className="text-caption text-muted-foreground">{t('工具调用', 'Tool calls')}</p>
                <p className="mt-1 font-mono text-control">{report.report.stats.toolCalls}</p>
              </div>
              <div className="rounded-md bg-background px-3 py-2">
                <p className="text-caption text-muted-foreground">{t('实验', 'Experiments')}</p>
                <p className="mt-1 font-mono text-control">{report.report.stats.experiments}</p>
              </div>
              <div className="rounded-md bg-background px-3 py-2">
                <p className="text-caption text-muted-foreground">{t('用户独立步骤', 'Independent user steps')}</p>
                <p className="mt-1 font-mono text-control">{report.report.stats.independentSteps}</p>
              </div>
            </div>

            <p className="mt-4 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-caption text-muted-foreground">
              {report.markdownPath}
            </p>
            <details className="mt-3 overflow-hidden rounded-md border border-border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-caption font-medium">
                {t('预览报告', 'Preview report')}
              </summary>
              <MarkdownContent
                className="max-h-80 overflow-y-auto border-t border-border px-4 py-4 text-caption leading-5"
                content={report.report.markdown}
              />
            </details>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { void copy(report.report.markdown, t('Markdown 报告', 'Markdown report')) }}>
                <ClipboardCopy className="size-4" />
                {t('复制 Markdown', 'Copy Markdown')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { void copy(report.markdownPath, t('报告路径', 'Report path')) }}>
                <ClipboardCopy className="size-4" />
                {t('复制路径', 'Copy path')}
              </Button>
            </div>
          </div>
        ) : null}

        {replayOpen && replay ? (
          <div className="mt-5 border-t border-border pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-control font-medium">{t('PI 逐事件回放', 'PI event-by-event replay')}</p>
                <Badge variant="outline">{t(`${replay.events.length} 个事件`, `${replay.events.length} events`)}</Badge>
                {replay.truncated ? <Badge variant="secondary">{t('后端已截断', 'Truncated by backend')}</Badge> : null}
              </div>
              <p className="text-caption text-muted-foreground">
                {t(`${replay.metrics.toolCalls} 次工具调用 · ${replay.metrics.toolErrors} 次错误`, `${replay.metrics.toolCalls} tool calls · ${replay.metrics.toolErrors} errors`)}
              </p>
            </div>

            {visibleReplayEvents.length ? (
              <div className="mt-4 space-y-2">
                {visibleReplayEvents.map(event => (
                  <article key={event.sequence} className="rounded-lg border border-border px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-caption text-muted-foreground">#{event.sequence}</span>
                      <p className="text-control font-medium">{eventLabel(event)}</p>
                      {event.truncated ? <Badge variant="secondary">{t('内容已截断', 'Content truncated')}</Badge> : null}
                      <span className="ml-auto text-caption text-muted-foreground">{formatTime(event.timestamp)}</span>
                    </div>
                    {event.type === 'tool_result' || event.type === 'tool_call' ? (
                      <pre className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-caption leading-5 ${event.error ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {eventSummary(event)}
                      </pre>
                    ) : (
                      <MarkdownContent
                        className={`mt-1 text-caption leading-5 ${event.error ? 'text-destructive' : 'text-muted-foreground'}`}
                        content={eventSummary(event)}
                        compact
                      />
                    )}
                  </article>
                ))}
              </div>
            ) : null}

            {replay.events.length > 6 ? (
              <Button
                variant="link"
                size="text"
                className="mt-3"
                onClick={() => setReplayExpanded(value => !value)}
              >
                {replayExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {replayExpanded
                  ? t('只看最近 6 个事件', 'Show last 6 events')
                  : t(`查看最近 ${Math.min(100, replay.events.length)} 个事件`, `View last ${Math.min(100, replay.events.length)} events`)}
              </Button>
            ) : null}
            {replayExpanded && replay.events.length > 100 ? (
              <p className="mt-2 text-caption text-muted-foreground">
                {t('为避免界面卡顿，这里只展示最近 100 个事件；完整轨迹仍保存在本机证据目录。', 'To keep the UI responsive, only the last 100 events are shown here; the full trajectory remains in the local evidence directory.')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
