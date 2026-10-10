import { cn } from '@/lib/cn'
import type { HTMLAttributes } from 'react'

export interface WindowTopDragRegionProps extends HTMLAttributes<HTMLDivElement> {}

export default function WindowTopDragRegion({
  className,
  ...props
}: WindowTopDragRegionProps) {
  return (
    <div
      className={cn('window-top-drag-region app-drag', className)}
      aria-hidden="true"
      {...props}
    />
  )
}
