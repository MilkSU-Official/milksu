import * as React from 'react'
import { cn } from '@/lib/cn'

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
    <section className={cn('space-y-2.5', className)} {...props}>
      {(title || actions) && (
        <div className="flex min-h-7 items-center justify-between gap-4 px-2">
          {title ? <h2 className="text-sm font-medium text-muted-foreground">{title}</h2> : null}
          {actions}
        </div>
      )}
      <div className={cn('overflow-hidden rounded-xl border border-border bg-card', footer && '[&>:nth-last-child(2)]:border-b-0')}>
        {children}
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
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
      ? 'flex-col gap-3'
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
        'flex min-h-15 justify-between gap-4 border-border px-4 py-3',
        divider ? 'border-b last:border-b-0' : 'border-b-0',
        rowStack,
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {label ? <div className="text-sm font-medium">{label}</div> : null}
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        {children}
      </div>
      {trailing ? <div className={cn(stack === 'always' && 'w-full')}>{trailing}</div> : null}
    </div>
  )
}

export { SettingsRow, SettingsSection }
