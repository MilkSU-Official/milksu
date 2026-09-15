import * as React from 'react'
import { cn } from '@/lib/cn'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
