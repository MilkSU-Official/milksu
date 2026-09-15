import * as React from 'react'
import { cn } from '@/lib/cn'

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      data-slot="native-select"
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
NativeSelect.displayName = 'NativeSelect'

function NativeSelectOption(props: React.ComponentProps<'option'>) {
  return <option {...props} />
}

export { NativeSelect, NativeSelectOption }
