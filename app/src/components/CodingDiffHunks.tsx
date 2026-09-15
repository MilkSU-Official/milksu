import { useMemo } from 'react'
import { Button } from '@/components/ui'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { parseUnifiedDiffHunks } from '@/lib/unifiedDiff'
import { useT } from '@/hooks/useUiLocale'
import type { CodingGitHunkAction } from '@/codingEnvironmentTypes'

const HUNK_STYLES = `
.coding-diff-hunk,
.coding-diff-fallback {
  color: var(--card-foreground, var(--foreground));
}
.coding-diff-pre,
.coding-diff-pre code {
  color: inherit;
}
.coding-diff-line {
  color: inherit;
}
.coding-diff-line--add {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}
.coding-diff-line--del {
  background: color-mix(in srgb, var(--destructive) 12%, transparent);
  color: var(--destructive);
}
.coding-diff-line--meta {
  color: var(--muted-foreground);
}
`

export default function CodingDiffHunks({
  diff,
  source,
  busy,
  readOnly,
  onApply,
}: {
  diff: string
  source: 'staged' | 'working-tree'
  busy?: boolean
  readOnly?: boolean
  onApply?: (action: CodingGitHunkAction, patch: string) => void
}) {
  const t = useT()
  const hunks = useMemo(() => parseUnifiedDiffHunks(diff), [diff])

  return (
    <>
      <style>{HUNK_STYLES}</style>
      {hunks.length ? (
        <div className="space-y-3">
          {hunks.map((hunk, index) => (
            <article
              key={hunk.id}
              className="coding-diff-hunk overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
            >
              <header className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                  {hunk.header}
                </span>
                {!readOnly ? (
                  source === 'working-tree' ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t(`暂存代码块 ${index + 1}`, `Stage hunk ${index + 1}`)}
                        onClick={() => onApply?.('stage-hunk', hunk.patch)}
                      >
                        <Plus className="size-3.5" />
                        {t('暂存此块', 'Stage this hunk')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t(`撤销代码块 ${index + 1}`, `Discard hunk ${index + 1}`)}
                        onClick={() => onApply?.('discard-hunk', hunk.patch)}
                      >
                        <RotateCcw className="size-3.5" />
                        {t('撤销', 'Discard')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={t(`取消暂存代码块 ${index + 1}`, `Unstage hunk ${index + 1}`)}
                      onClick={() => onApply?.('unstage-hunk', hunk.patch)}
                    >
                      <Minus className="size-3.5" />
                      {t('取消暂存', 'Unstage')}
                    </Button>
                  )
                ) : null}
              </header>
              <pre className="coding-diff-pre max-h-80 overflow-auto py-1 font-mono text-[12px] leading-5">
                <code>
                  {hunk.lines.map((line, lineIndex) => (
                    <span
                      key={`${lineIndex}:${line.text}`}
                      className={[
                        'coding-diff-line block min-w-max px-2.5',
                        line.kind === 'addition' ? 'coding-diff-line--add' : '',
                        line.kind === 'deletion' ? 'coding-diff-line--del' : '',
                        line.kind === 'metadata' ? 'coding-diff-line--meta' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {line.text || ' '}
                    </span>
                  ))}
                </code>
              </pre>
            </article>
          ))}
        </div>
      ) : (
        <pre className="coding-diff-pre coding-diff-fallback max-h-[28rem] overflow-auto whitespace-pre font-mono text-[12px] leading-5">
          {diff}
        </pre>
      )}
    </>
  )
}
