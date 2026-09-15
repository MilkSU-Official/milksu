import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentFileDiffChip } from '@/lib/agentConversation'
import { useT } from '@/hooks/useUiLocale'

export default function AgentFileChips({
  files,
  onOpenChanges,
}: {
  files: AgentFileDiffChip[]
  onOpenChanges?: (path: string) => void
}) {
  const t = useT()
  const [preview, setPreview] = useState<{
    file: AgentFileDiffChip
    x: number
    top?: number
    bottom?: number
  } | null>(null)

  function openPreview(file: AgentFileDiffChip, event: React.SyntheticEvent<HTMLElement>) {
    const host = (event.currentTarget as HTMLElement | null)?.closest('[data-diffchip]')
    if (!(host instanceof HTMLElement)) return
    const rect = host.getBoundingClientRect()
    const height = 38 + file.lines.length * 19
    const fitsBelow = rect.bottom + 6 + height <= window.innerHeight - 12
    setPreview({
      file,
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
      ...(fitsBelow
        ? { top: rect.bottom + 6 }
        : { bottom: window.innerHeight - rect.top + 6 }),
    })
  }

  function closePreview(file: AgentFileDiffChip) {
    setPreview(current => (current?.file.path === file.path ? null : current))
  }

  useEffect(() => () => {
    setPreview(null)
  }, [])

  if (!files.length) return null

  return (
    <>
      <div
        className="agent-diff-chips"
        aria-label={t('本轮文件改动', 'Files changed this turn')}
        data-testid="agent-file-chips"
      >
        {files.map(file => (
          <span
            key={file.path}
            data-diffchip=""
            onMouseEnter={event => openPreview(file, event)}
            onMouseLeave={() => closePreview(file)}
          >
            <button
              type="button"
              className="agent-diff-chip"
              aria-label={t(`在变更中打开 ${file.path}`, `Open ${file.path} in changes`)}
              onFocus={event => openPreview(file, event)}
              onBlur={() => closePreview(file)}
              onClick={() => onOpenChanges?.(file.path)}
            >
              <span className="min-w-0 truncate">{file.path}</span>
              {file.add ? <span className="agent-pill__add shrink-0">+{file.add}</span> : null}
              {file.del ? <span className="agent-pill__del shrink-0">-{file.del}</span> : null}
            </button>
          </span>
        ))}
      </div>
      {preview && typeof document !== 'undefined'
        ? createPortal(
            <div
              data-agent-conversation=""
              className="agent-diff-preview"
              role="tooltip"
              style={{
                left: `${preview.x}px`,
                top: preview.top === undefined ? undefined : `${preview.top}px`,
                bottom: preview.bottom === undefined ? undefined : `${preview.bottom}px`,
              }}
            >
              <div className="agent-diff-preview__bar">
                <span className="min-w-0 truncate">{preview.file.path}</span>
                <span className="shrink-0">
                  {preview.file.add ? <span className="agent-pill__add">+{preview.file.add}</span> : null}
                  {preview.file.del ? <span className="agent-pill__del"> -{preview.file.del}</span> : null}
                </span>
              </div>
              {preview.file.lines.length ? (
                <div className="py-1">
                  {preview.file.lines.map((line, index) => (
                    <div
                      key={index}
                      className={`agent-diff-preview__line${
                        line.tone === 'add'
                          ? ' agent-diff-preview__line--add'
                          : line.tone === 'del'
                            ? ' agent-diff-preview__line--del'
                            : ''
                      }`}
                    >
                      <span className="w-3 shrink-0 select-none">
                        {line.tone === 'add' ? '+' : line.tone === 'del' ? '-' : ' '}
                      </span>
                      <span className="min-w-0 truncate">{line.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                  {t('没有可预览的文本 Diff。', 'No previewable text diff.')}
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
