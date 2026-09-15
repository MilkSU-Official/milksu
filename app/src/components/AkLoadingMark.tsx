import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

export default function AkLoadingMark({
  label,
  showLabel = false,
}: {
  label?: string
  showLabel?: boolean
}) {
  const t = useT()
  const resolvedLabel = label ?? t('进行中', 'In progress')
  return (
    <span
      className={cn('inline-flex items-center gap-2', showLabel && 'text-caption text-muted-foreground')}
      role="status"
      aria-label={resolvedLabel}
    >
      <span
        className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-foreground"
        aria-hidden="true"
      />
      {showLabel ? <span>{resolvedLabel}</span> : null}
    </span>
  )
}
