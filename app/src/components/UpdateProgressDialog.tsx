import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import {
  formatUpdateMegabytes,
  updatePhaseBusy,
  updatePhaseMessage,
  updateReadyDetail,
  updateStatusMessage,
  updateWorking,
} from '@/lib/updateStatus'
import type { UpdateStatus } from '@/types'

export function UpdateReadyButton({
  status,
  onClick,
}: {
  status: UpdateStatus | null
  onClick?: () => void
}) {
  const t = useT()
  if (status?.state !== 'downloaded' || status.phase === 'installing') return null
  return (
    <Button
      type="button"
      className="fixed right-6 bottom-6 z-50"
      onClick={onClick}
    >
      {t('更新已就绪 · 安装并重启', 'Update ready · Install and restart')}
    </Button>
  )
}

export default function UpdateProgressDialog({
  open,
  status,
  onOpenChange,
  onCancelDownload,
  onInstall,
  onRetry,
}: {
  open: boolean
  status: UpdateStatus | null
  onOpenChange?: (open: boolean) => void
  onCancelDownload?: () => void
  onInstall?: () => void
  onRetry?: () => void
}) {
  const t = useT()
  const working = updateWorking(status)
  const busy = updatePhaseBusy(status)
  const percent = Math.max(0, Math.min(100, Number(status?.percent) || 0))
  const ready = status?.state === 'downloaded' && status.phase !== 'installing'
  const failed = status?.state === 'error'
  const downloading = status?.state === 'downloading' && (status.phase === 'downloading' || !status.phase)
  const canCancel = status?.state === 'downloading' && (!status.phase || status.phase === 'checking' || status.phase === 'downloading')
  const indeterminate = busy && !downloading
  const version = status?.version || status?.title || t('正在检查新版本', 'Checking for a new version')
  const message = failed ? updateStatusMessage(status) : updatePhaseMessage(status)
  const barClass = failed
    ? 'bg-destructive'
    : ready
      ? 'bg-emphasis'
      : 'bg-emphasis'

  return (
    <Dialog open={open} onOpenChange={next => {
      if (!next && working) return
      onOpenChange?.(next)
    }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!working}>
        <DialogTitle>{t('更新 MilkSU', 'Update MilkSU')}</DialogTitle>
        <DialogDescription className="text-base font-semibold text-foreground">
          {version}
        </DialogDescription>
        <div
          className="h-2 overflow-hidden rounded-lg bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : percent}
          aria-label={message}
        >
          {indeterminate ? (
            <div className="h-full w-1/3 animate-pulse bg-emphasis" />
          ) : (
            <div
              className={`h-full transition-[width] duration-300 ${barClass}`}
              style={{ width: `${failed ? 100 : percent}%` }}
            />
          )}
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
        {downloading ? (
          <p className="text-caption text-muted-foreground">
            {formatUpdateMegabytes(status?.transferred)} / {formatUpdateMegabytes(status?.total)}
          </p>
        ) : null}
        {ready ? (
          <p className="text-caption text-muted-foreground">{updateReadyDetail()}</p>
        ) : null}
        <DialogFooter>
          {canCancel ? (
            <Button type="button" variant="outline" onClick={onCancelDownload}>
              {t('取消下载', 'Cancel download')}
            </Button>
          ) : null}
          {ready ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
                {t('稍后安装', 'Install later')}
              </Button>
              <Button type="button" onClick={onInstall}>
                {t('安装并重启', 'Install and restart')}
              </Button>
            </>
          ) : null}
          {failed ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
                {t('关闭', 'Close')}
              </Button>
              <Button type="button" onClick={onRetry}>
                {t('检查并重试', 'Check and retry')}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
