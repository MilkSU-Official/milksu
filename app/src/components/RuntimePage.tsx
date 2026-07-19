import { useTranslation } from 'react-i18next'
import { useJobRuntime } from '../hooks/useJobRuntime'
import type { JobProjection, JobStatus, RuntimeEvent } from '../runtimeTypes'

interface Props {
  onOpenSettings: () => void
}

const ACTIVE_STATUSES = new Set<JobStatus>(['queued', 'running', 'cancelling', 'recovering'])

const EVENT_TONES: Record<string, string> = {
  'job.created': 'bg-slate-300',
  'attempt.started': 'bg-blue-500',
  'environment.prepared': 'bg-cyan-500',
  'step.started': 'bg-violet-500',
  'action.proposed': 'bg-amber-500',
  'action.started': 'bg-orange-500',
  'observation.committed': 'bg-indigo-500',
  'artifact.committed': 'bg-fuchsia-500',
  'effect.committed': 'bg-rose-500',
  'effect.reused': 'bg-emerald-500',
  'evidence.linked': 'bg-teal-500',
  'evaluation.recorded': 'bg-emerald-600',
  'outcome.decided': 'bg-black',
  'job.completed': 'bg-emerald-700',
  'job.failed': 'bg-red-600',
  'job.cancelled': 'bg-slate-500',
}

export function RuntimePage({ onOpenSettings }: Props) {
  const { t } = useTranslation()
  const runtime = useJobRuntime()
  const selected = runtime.projection
  const canCancel = selected ? ACTIVE_STATUSES.has(selected.job.status) : false

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[#f7f7f5]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#e5e5e2] bg-white px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold text-[#1e1e1c]">{t('runtime.title')}</h1>
            <span className="rounded-full bg-[#efefec] px-2 py-0.5 font-mono text-[10px] text-[#666]">v1alpha1</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runtime.loadJobs()}
            className="rounded-lg border border-[#deded9] bg-white px-3 py-1.5 text-xs text-[#555] hover:bg-[#f5f5f2]"
          >
            {t('runtime.refresh')}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg border border-[#deded9] bg-white p-1.5 text-[#777] hover:bg-[#f5f5f2]"
            title={t('sidebar.settings')}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[310px] shrink-0 flex-col border-r border-[#e3e3df] bg-[#fbfbf9]">
          <div className="border-b border-[#e7e7e3] p-4">
            <button
              type="button"
              onClick={() => void runtime.startJob()}
              disabled={runtime.creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f1f1d] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-wait disabled:bg-[#777]"
            >
              <span className="text-base leading-none">+</span>
              {runtime.creating ? t('runtime.creating') : t('runtime.create')}
            </button>
            <p className="mt-2.5 text-xs leading-5 text-[#85857f]">{t('runtime.createHelp')}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {runtime.loading && runtime.jobs.length === 0 ? (
              <p className="px-3 py-4 text-xs text-[#999]">{t('runtime.loading')}</p>
            ) : null}
            {!runtime.loading && runtime.jobs.length === 0 ? (
              <div className="px-3 py-7 text-center">
                <p className="text-sm text-[#555]">{t('runtime.empty')}</p>
                <p className="mt-1.5 text-xs leading-5 text-[#999]">{t('runtime.emptyHelp')}</p>
              </div>
            ) : null}
            {runtime.jobs.map(job => (
              <button
                key={job.id}
                type="button"
                onClick={() => void runtime.selectJob(job.id)}
                className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                  runtime.selectedId === job.id
                    ? 'border-[#d4d4ce] bg-white shadow-sm'
                    : 'border-transparent hover:bg-[#f1f1ed]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#292927]">{job.title}</p>
                  <StatusPill status={job.status} />
                </div>
                <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-[#92928c]">
                  <span>{job.attemptCount} attempt</span>
                  <span>{job.evidenceCount} evidence</span>
                  <span>{formatShortTime(job.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto">
          {runtime.error ? (
            <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {runtime.error}
            </div>
          ) : null}
          {selected ? (
            <JobDetail
              projection={selected}
              canCancel={canCancel}
              onCancel={() => void runtime.cancelJob(selected.job.id)}
            />
          ) : (
            <EmptyDetail />
          )}
        </section>
      </div>
    </main>
  )
}

function JobDetail({
  projection,
  canCancel,
  onCancel,
}: {
  projection: JobProjection
  canCancel: boolean
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const latestEvaluation = projection.evaluations.at(-1)
  const latestAttempt = projection.attempts.at(-1)

  return (
    <div className="mx-auto w-full max-w-[1040px] px-7 py-6">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={projection.job.status} large />
            <span className="font-mono text-[11px] text-[#8b8b85]">{projection.contractVersion}</span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#1c1c1a]">{projection.job.title}</h2>
          <p className="mt-1.5 text-sm text-[#777771]">{t('runtime.jobHelp')}</p>
        </div>
        {canCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg border border-[#d8d8d2] bg-white px-3 py-2 text-xs font-medium text-[#555] hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            {t('runtime.cancel')}
          </button>
        ) : null}
      </div>

      <div className="mt-6 grid grid-cols-4 gap-3">
        <FactCard label={t('runtime.attempts')} value={String(projection.attempts.length)} detail={latestAttempt?.status ?? '—'} />
        <FactCard label={t('runtime.evidence')} value={String(projection.evidence.length)} detail={projection.artifacts.length ? `${projection.artifacts.length} artifact` : '—'} />
        <FactCard label={t('runtime.effects')} value={String(projection.effects.length)} detail={projection.effects.at(-1)?.state ?? '—'} />
        <FactCard label={t('runtime.evaluator')} value={latestEvaluation?.verdict ?? '—'} detail={latestEvaluation ? `${latestEvaluation.evaluator}@${latestEvaluation.version}` : t('runtime.notRun')} />
      </div>

      {projection.outcome ? (
        <div className={`mt-4 rounded-2xl border px-5 py-4 ${
          projection.outcome.status === 'succeeded'
            ? 'border-emerald-200 bg-emerald-50/70'
            : projection.outcome.status === 'failed'
              ? 'border-red-200 bg-red-50/70'
              : 'border-slate-200 bg-slate-50'
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#777]">{t('runtime.outcome')}</p>
              <p className="mt-1 text-sm font-medium text-[#292927]">{projection.outcome.summary}</p>
            </div>
            <span className="font-mono text-xs text-[#777]">{projection.outcome.status}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_280px] gap-5">
        <div className="rounded-2xl border border-[#dfdfda] bg-white">
          <div className="flex items-center justify-between border-b border-[#e8e8e4] px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold text-[#292927]">{t('runtime.eventStream')}</h3>
              <p className="mt-0.5 text-xs text-[#92928c]">{t('runtime.eventHelp')}</p>
            </div>
            <span className="font-mono text-[11px] text-[#999]">{projection.events.length} events</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto px-4 py-2 [content-visibility:auto]">
            {projection.events.map(event => <EventRow key={event.eventId} event={event} />)}
          </div>
        </div>

        <div className="space-y-4">
          <DetailCard title={t('runtime.boundary')}>
            <KeyValue label="Role" value={projection.job.role} />
            <KeyValue label="Mode" value={projection.job.collaborationMode} />
            <KeyValue label="Engine" value={latestAttempt?.engine ?? '—'} />
            <KeyValue label="Model" value={latestAttempt?.model ?? '—'} />
            <KeyValue label="Environment" value={latestAttempt?.environment ?? '—'} />
          </DetailCard>

          <DetailCard title={t('runtime.lastEvidence')}>
            {projection.evidence.length ? (
              <>
                <p className="text-xs leading-5 text-[#555]">{projection.evidence.at(-1)?.claim}</p>
                <p className="mt-2 break-all font-mono text-[10px] leading-4 text-[#999]">
                  {projection.artifacts.at(-1)?.id}
                </p>
              </>
            ) : (
              <p className="text-xs text-[#999]">{t('runtime.waitingEvidence')}</p>
            )}
          </DetailCard>
        </div>
      </div>
    </div>
  )
}

function EmptyDetail() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[#deded8] bg-white font-mono text-sm font-semibold text-[#555]">M1</div>
        <h2 className="mt-5 text-lg font-semibold text-[#292927]">{t('runtime.emptyDetail')}</h2>
        <p className="mt-2 text-sm leading-6 text-[#85857f]">{t('runtime.emptyDetailHelp')}</p>
      </div>
    </div>
  )
}

function EventRow({ event }: { event: RuntimeEvent }) {
  return (
    <div className="group grid grid-cols-[42px_12px_minmax(0,1fr)] gap-3 py-2.5">
      <span className="pt-0.5 text-right font-mono text-[10px] text-[#aaa]">#{event.sequence}</span>
      <div className="relative flex justify-center">
        <span className={`relative z-10 mt-1 size-2.5 rounded-full ring-4 ring-white ${EVENT_TONES[event.kind] ?? 'bg-slate-400'}`} />
        <span className="absolute bottom-[-14px] top-3 w-px bg-[#e7e7e2] group-last:hidden" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <code className="truncate text-[11px] font-medium text-[#3f3f3b]">{event.kind}</code>
          <span className="shrink-0 font-mono text-[9px] text-[#aaa]">{formatEventTime(event.occurredAt)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#85857f]">{describeEvent(event)}</p>
      </div>
    </div>
  )
}

function FactCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[#dfdfda] bg-white px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#969690]">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-xl font-semibold tracking-tight text-[#252523]">{value}</span>
        <span className="truncate font-mono text-[10px] text-[#999]">{detail}</span>
      </div>
    </div>
  )
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#dfdfda] bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#777]">{title}</h3>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-[#999]">{label}</span>
      <span className="max-w-[170px] break-words text-right font-mono text-[10px] leading-4 text-[#555]">{value}</span>
    </div>
  )
}

function StatusPill({ status, large = false }: { status: JobStatus; large?: boolean }) {
  const className = status === 'succeeded'
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'failed'
      ? 'bg-red-100 text-red-700'
      : status === 'cancelled'
        ? 'bg-slate-200 text-slate-600'
        : status === 'cancelling'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-blue-100 text-blue-800'
  return (
    <span className={`shrink-0 rounded-full font-mono font-medium ${className} ${large ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[9px]'}`}>
      {status}
    </span>
  )
}

function describeEvent(event: RuntimeEvent): string {
  const payload = event.payload
  const object = (key: string) => payload[key] as Record<string, unknown> | undefined
  switch (event.kind) {
    case 'job.created':
      return String(object('job')?.title ?? 'Job accepted')
    case 'attempt.started': {
      const attempt = object('attempt')
      return `${attempt?.engine ?? 'engine'} · ${attempt?.model ?? 'model'}`
    }
    case 'step.started':
      return String(object('step')?.description ?? 'Step started')
    case 'action.proposed': {
      const action = object('action')
      return `${action?.capability ?? 'capability'} · ${action?.name ?? 'action'}`
    }
    case 'observation.committed':
      return String(object('observation')?.summary ?? 'Observation committed')
    case 'artifact.committed': {
      const artifact = object('artifact')
      return `${artifact?.mediaType ?? 'artifact'} · ${artifact?.size ?? 0} bytes`
    }
    case 'effect.committed':
    case 'effect.reused': {
      const effect = object('effect')
      return `${effect?.class ?? 'effect'} · ${effect?.state ?? ''}`
    }
    case 'evidence.linked':
      return String(object('evidence')?.claim ?? 'Evidence linked')
    case 'evaluation.recorded': {
      const evaluation = object('evaluation')
      return `${evaluation?.verdict ?? 'verdict'} · ${evaluation?.summary ?? ''}`
    }
    case 'outcome.decided':
      return String(object('outcome')?.summary ?? 'Outcome decided')
    default:
      return event.attemptId ? event.attemptId : event.jobId
  }
}

function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}

function SettingsIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
    </svg>
  )
}
