import { useMemo, useState, type ReactNode } from 'react'
import { Input, Popover, PopoverContent, PopoverTrigger, settingsControlTypeClass } from '@/components/ui'
import { Check, ChevronDown } from 'lucide-react'
import ModelVendorIcon from '@/components/ModelVendorIcon'
import {
  filterSearchableModelGroups,
  filterSearchableModelOptions,
  type SearchableModelGroup,
  type SearchableModelOption,
} from '@/lib/modelPickerSearch'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

/**
 * The tooltip for one option: the provider's own failure text and when it happened, so a red mark
 * explains itself without opening anything.
 */
function modelFailureTitle(
  option: SearchableModelOption,
  failedLabel: string,
  fallback?: string,
) {
  if (option.failedReason === undefined) return fallback
  const reason = String(option.failedReason).trim()
  const at = String(option.failedAt ?? '').trim()
  const when = at ? new Date(at) : null
  const stamp = when && !Number.isNaN(when.getTime())
    ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
    : ''
  return [reason || failedLabel, stamp].filter(Boolean).join(' · ')
}

export function SearchableModelList({
  value,
  leading,
  groups,
  listClassName,
  onChange,
}: {
  value: string
  leading?: SearchableModelOption[]
  groups: readonly SearchableModelGroup[]
  listClassName?: string
  onChange?: (value: string) => void
}) {
  const t = useT()
  const failedLabel = t('这个模型上次调用失败', 'This model failed the last time it was called')
  const [query, setQuery] = useState('')
  const leadingItems = useMemo(
    () => filterSearchableModelOptions(leading ?? [], query),
    [leading, query],
  )
  const visibleGroups = useMemo(
    () => filterSearchableModelGroups(groups, query),
    [groups, query],
  )

  function choose(next: string, optionDisabled?: boolean) {
    if (optionDisabled) return
    onChange?.(next)
  }

  function optionButton(option: SearchableModelOption) {
    return (
      <button
        key={option.value}
        type="button"
        disabled={option.disabled}
        data-testid={`model-option-${option.value}`}
        title={modelFailureTitle(option, failedLabel, option.title)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
          settingsControlTypeClass,
          option.value === value ? 'bg-accent' : 'hover:bg-accent',
          option.disabled && 'opacity-50',
        )}
        onClick={() => choose(option.value, option.disabled)}
      >
        <ModelVendorIcon model={option.model || option.label} label={option.label} />
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.failedReason !== undefined ? (
          // A red mark, never a disable: the reader may still pick this model, and the record
          // disappears as soon as it answers again.
          <span
            data-testid="model-failure-mark"
            title={modelFailureTitle(option, failedLabel, option.title)}
            aria-label={t('这个模型上次调用失败过', 'This model failed the last time it was called')}
            className="size-2 shrink-0 rounded-full bg-destructive"
          />
        ) : null}
        {option.value === value ? <Check className="size-3.5 shrink-0" /> : null}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="h-8"
          placeholder={t('搜索模型', 'Search models')}
          aria-label={t('搜索模型', 'Search models')}
        />
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto p-1', listClassName ?? 'max-h-72')}>
        {leadingItems.map(optionButton)}
        {leadingItems.length && visibleGroups.length ? <div className="my-1 h-px bg-border" /> : null}
        {visibleGroups.map((group, index) => (
          <div key={group.key}>
            {index > 0 || leadingItems.length ? <div className="my-1 h-px bg-border" /> : null}
            <p className="px-2 py-1 text-caption text-muted-foreground">{group.label}</p>
            {group.models.map(optionButton)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SearchableModelPicker({
  value,
  disabled,
  triggerClassName,
  ariaLabel,
  title,
  trigger,
  leading,
  groups,
  footer,
  align = 'end',
  onChange,
}: {
  value: string
  disabled?: boolean
  triggerClassName?: string
  ariaLabel?: string
  title?: string
  trigger: ReactNode
  leading?: SearchableModelOption[]
  groups: readonly SearchableModelGroup[]
  footer?: ReactNode
  align?: 'start' | 'center' | 'end'
  onChange?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          className={cn(
            'inline-flex items-center justify-between gap-1.5 rounded-md text-left text-foreground hover:bg-accent disabled:opacity-40',
            settingsControlTypeClass,
            triggerClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">{trigger}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={8} className="settings-picker-menu w-[22rem] max-w-[calc(100vw-2rem)] p-0">
        <SearchableModelList
          value={value}
          leading={leading}
          groups={groups}
          onChange={next => {
            onChange?.(next)
            setOpen(false)
          }}
        />
        {footer}
      </PopoverContent>
    </Popover>
  )
}
