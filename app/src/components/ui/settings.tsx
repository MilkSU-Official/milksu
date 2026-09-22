import * as React from 'react'
import { useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { cn } from '@/lib/cn'

/** Shared by SettingsRow labels and trailing pickers so Button `text-sm` cannot drift the right side. */
const settingsControlTypeClass = 'settings-row-type'

function SettingsSection({
  title,
  className,
  children,
  actions,
  footer,
  ...props
}: React.ComponentProps<'section'> & {
  title?: string
  actions?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section className={cn('space-y-2', className)} {...props}>
      {(title || actions) && (
        <div className="flex min-h-6 items-center justify-between gap-4 px-1">
          {title ? <h2 className="text-xs font-medium text-muted-foreground">{title}</h2> : null}
          {actions}
        </div>
      )}
      <div className={cn('overflow-hidden rounded-md border border-border bg-card', footer && '[&>:nth-last-child(2)]:border-b-0')}>
        {children}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function SettingsRow({
  label,
  description,
  align = 'center',
  stack = 'never',
  divider = true,
  className,
  children,
  trailing,
  ...props
}: React.ComponentProps<'div'> & {
  label?: string
  description?: string
  align?: 'center' | 'start'
  stack?: 'never' | 'sm' | 'always'
  divider?: boolean
  trailing?: React.ReactNode
}) {
  const rowStack =
    stack === 'always'
      ? 'flex-col items-stretch gap-2'
      : stack === 'sm'
        ? align === 'start'
          ? 'flex-col gap-2 sm:flex-row sm:items-start'
          : 'flex-col gap-2 sm:flex-row sm:items-center'
        : align === 'start'
          ? 'items-start'
          : 'items-center'
  return (
    <div
      className={cn(
        'flex min-h-12 justify-between gap-4 border-border px-4 py-2.5',
        divider ? 'border-b last:border-b-0' : 'border-b-0',
        rowStack,
        stack === 'always' && 'settings-row-stack',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 overflow-hidden">
        {label ? <div className={settingsControlTypeClass}>{label}</div> : null}
        {description ? <p className="mt-0.5 break-words text-[length:var(--text-caption)] leading-[var(--text-caption--line-height)] text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {trailing ? (
        <div className={cn('relative z-10 flex shrink-0 items-center justify-end gap-2', stack === 'always' && 'w-full justify-start')}>
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

function SettingsGhostPicker({
  value,
  ariaLabel,
  options,
  onChange,
  wide = false,
  menuClassName,
}: {
  value: string
  ariaLabel: string
  options: { value: string; label: string; leading?: ReactNode }[]
  onChange: (value: string) => void
  wide?: boolean
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={selected?.label}
          className={cn(
            'settings-control inline-flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-left text-foreground hover:bg-accent',
            settingsControlTypeClass,
          )}
        >
          <span className="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-left">
            {selected?.leading}
            <span className="min-w-0 truncate">{selected?.label ?? ''}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn('settings-picker-menu p-1', wide ? 'w-[20rem]' : 'w-[14rem]', menuClassName)}
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            className={cn(
              'flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-foreground hover:bg-accent',
              settingsControlTypeClass,
            )}
            onClick={() => {
              onChange(option.value)
              setOpen(false)
            }}
          >
            {option.leading}
            <span className={cn('min-w-0 flex-1', wide ? 'whitespace-normal' : 'truncate')}>
              {option.label}
            </span>
            {value === option.value ? <Check className="size-3.5 shrink-0" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export { SettingsGhostPicker, SettingsRow, SettingsSection, settingsControlTypeClass }
