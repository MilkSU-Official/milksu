import { useEffect, useState } from 'react'
import {
  companionProcessSummary,
  companionTurnHasProcess,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { companionLooksLikeDebugPayload } from '@/lib/companionUserError'
import { useT } from '@/hooks/useUiLocale'

export default function CompanionTurnProcessView({
  process,
  foldable = false,
  defaultOpen = false,
}: {
  process: CompanionTurnProcess
  foldable?: boolean
  defaultOpen?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(defaultOpen)
  const [now, setNow] = useState(0)
  const thinkingRows = process.thinking
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)

  useEffect(() => {
    if (!process.thinkingRunning || process.thinkingStartedAt == null) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [process.thinkingRunning, process.thinkingStartedAt])

  if (!companionTurnHasProcess(process)) return null

  const live = process.thinkingRunning || process.tools.some(tool => tool.running)

  const liveElapsed = process.thinkingRunning && process.thinkingStartedAt != null
    ? Math.max(0, now - process.thinkingStartedAt)
    : undefined
  const summary = companionProcessSummary(process, liveElapsed)
  const runningTool = process.tools.find(tool => tool.running)
  const liveLabel = runningTool
    ? (runningTool.detail && runningTool.detail !== runningTool.name && !companionLooksLikeDebugPayload(runningTool.detail)
      ? `${runningTool.name} ${runningTool.detail}`
      : runningTool.name)
    : ''

  return (
    <div className="companion-chat-process">
      {foldable ? (
        <button
          type="button"
          className="companion-chat-process-summary"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          <span className={live ? 'companion-chat-process-activity' : undefined}>{summary || t('过程', 'Process')}</span>
        </button>
      ) : (
        <p className="companion-chat-process-summary companion-chat-process-summary-static">
          <span className={live ? 'companion-chat-process-activity' : undefined}>{summary || (process.thinkingRunning ? t('正在思考', 'Thinking') : t('过程', 'Process'))}</span>
        </p>
      )}
      {liveLabel ? (
        <p className="companion-chat-process-live companion-chat-process-activity">{liveLabel}</p>
      ) : null}
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
              <span className={`companion-chat-process-tool-name${tool.running ? ' companion-chat-process-activity' : ''}`}>{tool.name}</span>
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
