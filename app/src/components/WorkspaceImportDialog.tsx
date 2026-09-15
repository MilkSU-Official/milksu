import type { ReactNode } from 'react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'

export default function WorkspaceImportDialog({
  open,
  title = '',
  description = '',
  children,
  onOpenChange,
}: {
  open: boolean
  title?: string
  description?: string
  children?: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel className="workspace-import-dialog sm:max-w-2xl" data-testid="workspace-import-dialog">
        <DialogHeader>
          <DialogTitle>{title || t('导入', 'Import')}</DialogTitle>
          <DialogDescription className={description ? '' : 'sr-only'}>
            {description || t('同步公开来源，或导入本机材料。', 'Sync a public source, or import local materials.')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">{children}</DialogBody>
      </DialogPanel>
    </Dialog>
  )
}
