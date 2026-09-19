import { Quote, X } from 'lucide-react'
import { useT } from '@/hooks/useUiLocale'
import type { ComposerQuote } from '@/lib/composerQuote'

const PREVIEW_LIMIT = 160

function preview(text: string) {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim()
  return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT)}…` : collapsed
}

/**
 * The quoted material the reader picked in the transcript, shown above the input while they type the
 * question it belongs to. Each quote can be removed on its own: quoting several passages must not
 * become all-or-nothing.
 */
export function ComposerQuoteList({
  quotes,
  onRemove,
}: {
  quotes: readonly ComposerQuote[]
  onRemove: (id: string) => void
}) {
  const t = useT()
  const usable = quotes.filter(quote => String(quote?.text ?? '').trim())
  if (!usable.length) return null

  return (
    <div
      data-testid="composer-quote-list"
      className="mb-1.5 flex flex-wrap items-center gap-1.5"
      aria-label={t('已引用的内容', 'Quoted material')}
    >
      {usable.map(quote => (
        <span
          key={quote.id}
          data-testid={`composer-quote-${quote.id}`}
          className="flex min-w-0 max-w-[22rem] items-center gap-1 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-caption text-muted-foreground"
        >
          <Quote className="size-3 shrink-0" aria-hidden="true" />
          {quote.sourceLabel ? (
            <span className="shrink-0 font-medium">{quote.sourceLabel}</span>
          ) : null}
          <span data-testid={`composer-quote-text-${quote.id}`} className="min-w-0 truncate">
            {preview(quote.text)}
          </span>
          <button
            type="button"
            data-testid={`composer-quote-remove-${quote.id}`}
            aria-label={t('移除这条引用', 'Remove this quote')}
            className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-accent-foreground"
            onClick={() => onRemove(quote.id)}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  )
}
