import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const alertVariants = cva(
  'relative w-full rounded-md border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-foreground',
        destructive: 'border-destructive-border bg-destructive-soft text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export { Alert, AlertDescription }
