import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'

export default function CodingToolBudgetDialog({
  open,
  count,
  onOpenChange,
  onContinue,
  onStop,
}: {
  open: boolean
  count: number
  onOpenChange?: (open: boolean) => void
  onContinue?: () => void
  onStop?: () => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{t('继续调用工具？', 'Keep calling tools?')}</DialogTitle>
        <DialogDescription>
          {t(`已经调用了 ${count} 次工具，要继续吗？`, `Tools have already been called ${count} times. Continue?`)}
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onStop}>
            {t('停止', 'Stop')}
          </Button>
          <Button type="button" variant="brand" onClick={onContinue}>
            {t('继续', 'Continue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
