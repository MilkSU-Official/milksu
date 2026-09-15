import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { menuItemClass } from '@/components/ui'
import { formatCatalogHistoryTime } from '@/lib/catalogHistoryTime'
import { cn } from '@/lib/cn'

export default function WorkspaceCatalogHistoryItem({
  title,
  subtitle,
  time,
  current,
  titleMono,
  leading,
  onSelect,
}: {
  title: string
  subtitle?: string
  time?: string | number
  current?: boolean
  titleMono?: boolean
  leading?: ReactNode
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        menuItemClass,
        'items-start gap-3 px-2.5 py-2.5 text-left hover:bg-[color:var(--ui-selected)] focus-visible:bg-[color:var(--ui-selected)]',
      )}
      aria-current={current ? 'true' : undefined}
      data-workspace-catalog-history-item
      onClick={onSelect}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-control font-medium', titleMono && 'font-mono')}>
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {time !== undefined && time !== '' ? (
        <span className="mt-1 shrink-0 text-caption text-muted-foreground">
          {formatCatalogHistoryTime(time)}
        </span>
      ) : null}
      {current ? <Check className="mt-1 size-4 shrink-0 text-brand" /> : null}
    </button>
  )
}
