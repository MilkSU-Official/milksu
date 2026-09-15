import { Badge } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

export default function ConnectionLiveStatus({
  live,
  decorative = false,
}: {
  live: boolean
  decorative?: boolean
}) {
  const t = useT()
  return (
    <Badge
      variant={live ? 'success' : 'secondary'}
      data-connection-live={live ? 'live' : 'off'}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : live ? t('已连接', 'Connected') : t('未连接', 'Not connected')}
      className={cn('gap-1.5 font-medium', !live && 'text-muted-foreground')}
    >
      <span className={cn('size-1.5 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/50')} />
      {live ? t('已连接', 'Connected') : t('未连接', 'Not connected')}
    </Badge>
  )
}
