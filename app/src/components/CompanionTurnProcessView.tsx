import { useEffect, useState } from 'react'
import {
  companionProcessSummary,
  companionTurnHasProcess,
  processComponent,
  processComponents,
  type CompanionProcessComponent,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { companionLooksLikeDebugPayload } from '@/lib/companionUserError'
import { useT } from '@/hooks/useUiLocale'

function componentDetail(component: CompanionProcessComponent) {
  const detail = component.detail.trim()
  if (!detail || detail === component.title || companionLooksLikeDebugPayload(detail)) return ''
  return detail
}

export default function CompanionTurnProcessView({
  process,
  foldable = true,
  defaultOpen = false,
}: {
  process: CompanionTurnProcess
  foldable?: boolean
  defaultOpen?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const [now, setNow] = useState(0)
  const thinking = processComponent(process, 'thinking')
  const runningTool = processComponents(process, 'tool').find(component => component.running)

  useEffect(() => {
    if (!thinking?.running || thinking.startedAt == null) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [thinking?.running, thinking?.startedAt])

  if (!companionTurnHasProcess(process)) return null

  const live = Boolean(thinking?.running) || process.components.some(component => component.running)
  const liveElapsed = thinking?.running && thinking.startedAt != null
    ? Math.max(0, now - thinking.startedAt)
    : undefined
  const summary = companionProcessSummary(process, liveElapsed)
  const liveLabel = runningTool
    ? (componentDetail(runningTool) ? `${runningTool.title} ${componentDetail(runningTool)}` : runningTool.title)
    : ''
  const statusLabel = live
    ? t('进行中', 'Running')
    : thinking?.running
      ? t('思考中', 'Thinking')
      : t('过程', 'Process')

  return (
    <div className="companion-chat-process">
      {foldable ? (
        <button
          type="button"
          className="companion-chat-process-summary"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          <span
            className="companion-chat-process-status-dot"
            data-running={live ? 'true' : 'false'}
            aria-hidden="true"
          />
          <span className="companion-chat-process-status">{statusLabel}</span>
          <span className={live ? 'companion-chat-process-activity' : undefined}>{summary || t('过程', 'Process')}</span>
        </button>
      ) : (
        <p className="companion-chat-process-summary companion-chat-process-summary-static">
          <span
            className="companion-chat-process-status-dot"
            data-running={live ? 'true' : 'false'}
            aria-hidden="true"
          />
          <span className="companion-chat-process-status">{statusLabel}</span>
          <span className={live ? 'companion-chat-process-activity' : undefined}>{summary || (thinking?.running ? t('正在思考', 'Thinking') : t('过程', 'Process'))}</span>
        </p>
      )}
      {liveLabel ? (
        <p className="companion-chat-process-live companion-chat-process-activity">{liveLabel}</p>
      ) : null}
      {(!foldable || open) ? (
        <div className="companion-chat-process-body">
          {process.components.map(component => {
            if (component.kind === 'thinking') {
              const rows = component.detail.split(/\n+/).map(line => line.trim()).filter(Boolean)
              if (!rows.length && component.running) {
                return <p key={component.id} className="companion-chat-process-think">{t('正在思考', 'Thinking')}</p>
              }
              return rows.map((row, index) => (
                <p key={`${component.id}:${index}`} className="companion-chat-process-think">{row}</p>
              ))
            }
            if (component.kind === 'tool') {
              const detail = componentDetail(component)
              return (
                <p
                  key={component.id}
                  className={`companion-chat-process-tool${component.running ? ' is-running' : ''}${component.error ? ' is-error' : ''}`}
                >
                  <span className={`companion-chat-process-tool-name${component.running ? ' companion-chat-process-activity' : ''}`}>{component.title}</span>
                  {detail ? <span className="companion-chat-process-tool-detail">{detail}</span> : null}
                </p>
              )
            }
            const detail = component.detail.trim() || component.title.trim()
            if (!detail) return null
            return (
              <p key={component.id} className="companion-chat-process-tool">
                <span className="companion-chat-process-tool-detail">{detail}</span>
              </p>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
