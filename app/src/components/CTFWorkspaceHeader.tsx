import { ArrowLeft, Cable } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import ConnectionLiveStatus from '@/components/ConnectionLiveStatus'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
import { useT } from '@/hooks/useUiLocale'

export default function CTFWorkspaceHeader({
  challengeTitle,
  browserStatus,
  onReturnCatalog,
  onOpenBrowserSettings,
  onRefreshBridge,
}: {
  challengeTitle?: string
  browserStatus?: 'off' | 'live' | ''
  onReturnCatalog?: () => void
  onOpenBrowserSettings?: () => void
  onRefreshBridge?: () => void
}) {
  const t = useT()
  return (
    <WorkspaceModuleTopBar
      module="ctf"
      subtitle={t('解题会话', 'Solving session')}
      leading={(
        <Button variant="ghost" size="icon-sm" aria-label={t('返回 CTF 题库', 'Back to CTF catalog')} onClick={onReturnCatalog}>
          <ArrowLeft className="size-4" />
        </Button>
      )}
      badge={challengeTitle ? (
        <Badge variant="secondary" className="max-w-[18rem] truncate">
          {challengeTitle}
        </Badge>
      ) : null}
      actions={browserStatus ? (
        <Button
          variant="outline"
          size="sm"
          className="app-no-drag shrink-0"
          data-connection-live-action
          aria-label={browserStatus === 'live' ? t('浏览器已连接', 'Browser connected') : t('浏览器未连接，打开设置', 'Browser disconnected, open settings')}
          title={browserStatus === 'live' ? t('浏览器已连接', 'Browser connected') : t('浏览器未连接', 'Browser disconnected')}
          onClick={browserStatus === 'live' ? onRefreshBridge : onOpenBrowserSettings}
        >
          <span className="connection-live-action__label">
            <Cable className="size-4" />
            {browserStatus === 'live' ? t('浏览器已连接', 'Browser connected') : t('连接浏览器', 'Connect browser')}
          </span>
          <ConnectionLiveStatus live={browserStatus === 'live'} decorative />
        </Button>
      ) : null}
    />
  )
}
