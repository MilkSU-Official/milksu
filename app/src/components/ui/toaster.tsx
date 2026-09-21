import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { dismissToast, subscribeToasts, type AppToast } from '@/lib/appToast'

export function Toaster() {
  const [toasts, setToasts] = useState<AppToast[]>([])

  useEffect(() => subscribeToasts(setToasts), [])
  if (!toasts.length) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4"
      data-testid="app-toaster"
    >
      <div className="flex w-[min(24rem,100%)] flex-col gap-2">
        {toasts.map(item => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'pointer-events-auto w-full rounded-md border border-border bg-popover px-3 py-2 text-left text-sm text-popover-foreground',
              'transition-[opacity,translate] duration-[180ms] ease-[var(--ease-out)] starting:translate-y-2 starting:opacity-0',
              item.leaving && 'pointer-events-none translate-y-2 opacity-0',
              item.tone === 'destructive' && 'border-destructive-border text-destructive',
            )}
            onClick={() => dismissToast(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
    </div>
  )
}
