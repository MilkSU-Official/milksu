import { useEffect, useState } from 'react'
import {
  companionProcessSummary,
  companionTurnHasProcess,
  type CompanionTurnProcess,
} from '@/lib/companionTurnProcess'
import { formatDemoElapsed } from '@/lib/agentConversation'
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
  const [open, setOpen] = useState(defaultOpen || process.thinkingRunning || process.tools.some(tool => tool.running))
  const thinkingRows = process.thinking
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)

  useEffect(() => {
    if (process.thinkingRunning || process.tools.some(tool => tool.running)) {
      setOpen(true)
    }
  }, [process.thinkingRunning, process.tools])

  if (!companionTurnHasProcess(process)) return null

  const summary = companionProcessSummary(process)
  const elapsed = process.thinkingDurationMs === undefined
    ? ''
    : formatDemoElapsed(process.thinkingDurationMs)

  return (
    <div className="companion-chat-process">
      {foldable ? (
        <button
          type="button"
          className="companion-chat-process-summary"
          aria-expanded={open}
          onClick={() => setOpen(current => !current)}
        >
          <span>{summary || t('过程', 'Process')}</span>
          {elapsed ? <span className="companion-chat-process-elapsed">{elapsed}</span> : null}
        </button>
      ) : (
        <p className="companion-chat-process-summary companion-chat-process-summary-static">
          <span>{summary || (process.thinkingRunning ? t('正在思考', 'Thinking') : t('过程', 'Process'))}</span>
          {elapsed ? <span className="companion-chat-process-elapsed">{elapsed}</span> : null}
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
