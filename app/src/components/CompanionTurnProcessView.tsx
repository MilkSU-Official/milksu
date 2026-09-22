import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  companionLiveSummary,
  companionProcessSummary,
  companionTurnHasProcess,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { companionLooksLikeDebugPayload } from '@/lib/companionUserError'
import { useT } from '@/hooks/useUiLocale'

export default function CompanionTurnProcessView({
  process,
  foldable = true,
  defaultOpen = false,
  live = false,
}: {
  process: CompanionTurnProcess
  foldable?: boolean
  defaultOpen?: boolean
  live?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const [now, setNow] = useState(0)
  const thinkingRows = process.thinking
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)

  useEffect(() => {
    if (!live) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [live])

  if (!companionTurnHasProcess(process)) return null

  const liveLine = live ? companionLiveSummary(process, now || Date.now()) : null
  const summary = liveLine
    ? [liveLine.activity, liveLine.elapsed].filter(Boolean).join(' ')
      + (liveLine.tools ? ` · ${liveLine.tools}` : '')
    : companionProcessSummary(process)

  const summaryBody = liveLine ? (
    <>
      <span className="companion-chat-process-activity">{liveLine.activity}</span>
      {liveLine.elapsed ? <span className="companion-chat-process-meter">{liveLine.elapsed}</span> : null}
      {liveLine.tools ? <span className="companion-chat-process-meter">{`· ${liveLine.tools}`}</span> : null}
    </>
  ) : (
    <span>{summary || t('过程', 'Process')}</span>
  )

  return (
    <div className="companion-chat-process">
      {foldable ? (
        <button
          type="button"
          className="companion-chat-process-summary"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          {summaryBody}
          <ChevronDown aria-hidden="true" className={`companion-chat-process-chevron${open ? ' is-open' : ''}`} />
        </button>
      ) : (
        <p className="companion-chat-process-summary companion-chat-process-summary-static">
          {summaryBody}
        </p>
      )}
      {(!foldable || open) ? (
        <div className="companion-chat-process-body">
          {thinkingRows.map((row, index) => (
            <p key={`think:${index}`} className="companion-chat-process-think">{row}</p>
          ))}
          {process.thinkingRunning && !thinkingRows.length ? (
            <p className="companion-chat-process-think">{t('正在思考', 'Thinking')}</p>
          ) : null}
          {process.tools.map(tool => (
            <p
              key={tool.id}
              className={`companion-chat-process-tool${tool.running ? ' is-running' : ''}${tool.error ? ' is-error' : ''}`}
            >
              <span className="companion-chat-process-tool-name">{tool.name}</span>
              {tool.detail && tool.detail !== tool.name && !companionLooksLikeDebugPayload(tool.detail) ? (
                <span className="companion-chat-process-tool-detail">{tool.detail}</span>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
