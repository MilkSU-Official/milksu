import { useMemo, useRef, useState } from 'react'
import AgentFileChips from '@/components/AgentFileChips'
import type { AgentFileDiffChip } from '@/lib/agentConversation'
import type { CodingGitChange } from '@/codingEnvironmentTypes'
import { useT } from '@/hooks/useUiLocale'

export default function AgentChangeSummary({
  summary,
  previews,
  onOpenChanges,
}: {
  summary?: {
    changedFiles: number
    additions: number
    deletions: number
    changes?: CodingGitChange[]
    changesTruncated?: boolean
  }
  previews?: AgentFileDiffChip[]
  onOpenChanges?: (path?: string) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const files = useMemo((): AgentFileDiffChip[] => {
    const changes = summary?.changes ?? []
    if (!changes.length && previews?.length) return previews
    return changes.map(change => {
      const base = change.path.split(/[/\\]/).at(-1) ?? change.path
      const preview = previews?.find(file => file.path === change.path || file.path === base)
      return {
        path: change.path,
        add: change.additions ?? preview?.add ?? 0,
        del: change.deletions ?? preview?.del ?? 0,
        lines: preview?.lines ?? [],
      }
    })
  }, [summary?.changes, previews])

  function open() {
    if (closeTimer.current !== undefined) clearTimeout(closeTimer.current)
    setExpanded(true)
  }

  function close(event?: React.MouseEvent | React.FocusEvent) {
    const next = event && 'relatedTarget' in event ? event.relatedTarget : null
    if (next instanceof Node && event?.currentTarget instanceof Node && event.currentTarget.contains(next)) {
      return
    }
    if (next instanceof Element && next.closest('.agent-diff-preview')) return
    closeTimer.current = setTimeout(() => {
      setExpanded(false)
    }, 180)
  }

  function toggle() {
    setExpanded(current => !current)
  }

  function openFile(path: string) {
    onOpenChanges?.(path)
    setExpanded(false)
  }

  if (!summary || summary.changedFiles <= 0) return null

  return (
    <section
      className="agent-change-rows"
      aria-label={t('代码变更', 'Code changes')}
      data-testid="agent-change-summary"
      onMouseEnter={open}
      onMouseLeave={event => close(event)}
      onFocusCapture={open}
      onBlur={event => close(event)}
    >
      <div className="agent-task-row" data-open={expanded ? 'true' : 'false'}>
        <button
          type="button"
          className="agent-task-row__head"
          aria-expanded={expanded}
          aria-label={t('查看代码变更', 'View code changes')}
          onClick={event => {
            event.stopPropagation()
            toggle()
          }}
        >
          <span className="agent-task-row__label">
            {t(`${summary.changedFiles} 个文件已更改`, `${summary.changedFiles} files changed`)}
          </span>
          <span className="agent-task-row__amount">
            <span className="agent-change-add">+{summary.additions}</span>
            <span className="agent-change-del">-{summary.deletions}</span>
          </span>
        </button>
      </div>

      <div className="agent-task-rows__more" data-open={expanded ? 'true' : 'false'}>
        <div className="agent-task-rows__more-inner">
          <AgentFileChips
            files={files}
            onOpenChanges={openFile}
          />
        </div>
      </div>
    </section>
  )
}
