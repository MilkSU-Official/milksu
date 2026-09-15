import { Badge, Button, SettingsRow, SettingsSection } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import type { EnvironmentLease } from '@/lib/environmentTypes'

export default function EnvironmentStrip({
  lease,
  compact: _compact,
  onStart,
  onStop,
  onReset,
  onOpenTarget,
  onRetry,
  onOpenDocker,
  onOccupyGo,
  onOccupyStop,
  onOpenLabSettings,
}: {
  lease: EnvironmentLease
  compact?: boolean
  onStart?: () => void
  onStop?: () => void
  onReset?: () => void
  onOpenTarget?: () => void
  onRetry?: () => void
  onOpenDocker?: () => void
  onOccupyGo?: () => void
  onOccupyStop?: () => void
  onOpenLabSettings?: () => void
}) {
  const t = useT()

  const statusLabel = (() => {
    if (lease.provider === 'user-attached') return t('用户自带靶', 'User-attached target')
    switch (lease.state) {
      case 'none':
        return lease.packageName ? t('未启动', 'Not started') : t('没有练习包', 'No practice package')
      case 'docker-down':
        return t('Docker 未运行', 'Docker is not running')
      case 'stopped':
        return t('已停止', 'Stopped')
      case 'pulling':
        return t('启动中', 'Starting')
      case 'ready':
        return t('就绪', 'Ready')
      case 'busy':
        return t('被占用', 'Occupied')
      case 'failed':
        return t('失败', 'Failed')
      default:
        return lease.state
    }
  })()

  const canStart = lease.provider !== 'user-attached'
    && (lease.state === 'stopped' || (lease.state === 'none' && Boolean(lease.packageName)))
  const hasActions = canStart
    || lease.state === 'ready'
    || lease.state === 'docker-down'
    || lease.state === 'failed'
    || lease.state === 'busy'
    || lease.state === 'pulling'

  const statusVariant = (() => {
    switch (lease.state) {
      case 'ready':
        return 'success' as const
      case 'pulling':
        return 'warning' as const
      case 'failed':
      case 'docker-down':
      case 'busy':
        return 'destructive' as const
      default:
        return 'secondary' as const
    }
  })()

  return (
    <SettingsSection
      title={t('环境', 'Environment')}
      data-testid="environment-strip"
      data-state={lease.state}
      actions={<Badge variant={statusVariant}>{statusLabel}</Badge>}
      footer={hasActions ? (
        <>
          {canStart ? (
            <Button variant="brand" size="sm" data-testid="environment-start" onClick={onStart}>
              {t('启动', 'Start')}
            </Button>
          ) : null}
          {lease.state === 'ready' ? (
            <Button variant="brand" size="sm" data-testid="environment-open" onClick={onOpenTarget}>
              {t('打开靶', 'Open target')}
            </Button>
          ) : null}
          {lease.state === 'ready' ? (
            <Button variant="outline" size="sm" data-testid="environment-reset" onClick={onReset}>
              {t('重置', 'Reset')}
            </Button>
          ) : null}
          {lease.state === 'ready' ? (
            <Button variant="ghost" size="sm" data-testid="environment-stop" onClick={onStop}>
              {t('停止', 'Stop')}
            </Button>
          ) : null}
          {lease.state === 'docker-down' ? (
            <Button variant="outline" size="sm" data-testid="environment-open-docker" onClick={onOpenDocker}>
              {t('打开 Docker', 'Open Docker')}
            </Button>
          ) : null}
          {lease.state === 'docker-down' || lease.state === 'failed' ? (
            <Button variant="brand" size="sm" data-testid="environment-retry" onClick={onRetry}>
              {t('重试', 'Retry')}
            </Button>
          ) : null}
          {lease.provider === 'avd' && (lease.state === 'failed' || lease.state === 'none' || lease.state === 'stopped') ? (
            <Button variant="outline" size="sm" data-testid="environment-lab-settings" onClick={onOpenLabSettings}>
              {t('Lab 设置', 'Lab settings')}
            </Button>
          ) : null}
          {lease.state === 'busy' ? (
            <Button variant="brand" size="sm" data-testid="environment-occupy-go" onClick={onOccupyGo}>
              {t('去那边', 'Go there')}
            </Button>
          ) : null}
          {lease.state === 'busy' ? (
            <Button variant="outline" size="sm" data-testid="environment-occupy-stop" onClick={onOccupyStop}>
              {t('停那边', 'Stop that job')}
            </Button>
          ) : null}
          {lease.state === 'pulling' ? (
            <Button variant="ghost" size="sm" data-testid="environment-cancel" onClick={onStop}>
              {t('取消', 'Cancel')}
            </Button>
          ) : null}
        </>
      ) : undefined}
    >
      {lease.packageName ? <SettingsRow label={t('练习包', 'Package')} description={lease.packageName} /> : null}
      {lease.address ? (
        <SettingsRow label={t('地址', 'Address')} description={lease.address}>
          <span className="font-mono text-body select-text" data-testid="environment-address">{lease.address}</span>
        </SettingsRow>
      ) : null}
      {lease.detail ? <SettingsRow label={t('说明', 'Notes')} description={lease.detail} /> : null}
      {lease.occupyJobTitle ? (
        <SettingsRow
          label={t('占用', 'Occupied')}
          description={t(`被作业「${lease.occupyJobTitle}」占用`, `Occupied by job “${lease.occupyJobTitle}”`)}
        />
      ) : null}
      {lease.device ? <SettingsRow label={t('设备', 'Device')} description={lease.device} divider={false} /> : null}
      {!lease.packageName && !lease.address && !lease.detail && !lease.device ? (
        <SettingsRow label={statusLabel} divider={false} />
      ) : null}
    </SettingsSection>
  )
}
