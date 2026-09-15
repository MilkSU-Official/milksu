import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'

export default function UpdateInstallDialog({
  open,
  version,
  onOpenChange,
  onConfirm,
  onLater,
}: {
  open: boolean
  version?: string
  onOpenChange?: (open: boolean) => void
  onConfirm?: () => void
  onLater?: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('安装更新并重启？', 'Install the update and restart?')}</DialogTitle>
        <DialogDescription>
          {t(
            `MilkSU ${version || ''} 已经下载完成。现在安装会中断正在运行的任务并重启。`,
            `MilkSU ${version || ''} is ready. Installing now will stop running tasks and restart.`,
          )}
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onLater}>
            {t('稍后', 'Later')}
          </Button>
          <Button type="button" variant="brand" onClick={onConfirm}>
            {t('安装并重启', 'Install and restart')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
