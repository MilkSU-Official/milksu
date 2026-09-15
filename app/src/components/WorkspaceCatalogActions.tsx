import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Clock3, FilePlus2, Plus } from 'lucide-react'
import {
  Button,
  buttonVariants,
  menuContentClass,
  menuLabelClass,
  menuSeparatorClass,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useT } from '@/hooks/useUiLocale'

export type WorkspaceCatalogActionsHandle = {
  closeHistoryMenu: () => void
}

const WorkspaceCatalogActions = forwardRef<WorkspaceCatalogActionsHandle, {
  historyCount?: number
  historyAriaLabel?: string
  historyMenuLabel?: string
  action?: 'import' | 'create'
  actionAriaLabel?: string
  history?: ReactNode
  onAction?: () => void
}>(function WorkspaceCatalogActions({
  historyCount = 0,
  historyAriaLabel,
  historyMenuLabel,
  action = 'import',
  actionAriaLabel,
  history,
  onAction,
}, ref) {
  const t = useT()
  const historyMenu = useRef<HTMLDetailsElement | null>(null)

  const historyAria = historyAriaLabel?.trim() || t('打开历史', 'Open history')
  const historyMenuAria = historyMenuLabel?.trim() || t('历史', 'History')
  const actionLabel = action === 'create' ? t('创建', 'Create') : t('导入', 'Import')
  const actionAria = actionAriaLabel?.trim() || actionLabel
  const actionTestId = action === 'create' ? 'workspace-create' : 'workspace-import'

  function closeHistoryMenu() {
    if (historyMenu.current) historyMenu.current.open = false
  }

  function closeHistoryMenuOnOutsidePointer(event: PointerEvent) {
    if (!(event.target instanceof Node)) return
    const menu = historyMenu.current
    if (menu?.open && !menu.contains(event.target)) menu.open = false
  }

  function openAction() {
    closeHistoryMenu()
    onAction?.()
  }

  function onHistoryKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
      closeHistoryMenu()
    }
  }

  useImperativeHandle(ref, () => ({ closeHistoryMenu }))

  useEffect(() => {
    document.addEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
  }, [])

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2" data-workspace-catalog-actions>
      <details
        ref={historyMenu}
        className="app-no-drag relative shrink-0"
        data-testid="workspace-history"
        onKeyDown={onHistoryKeyDown}
      >
        <summary
          data-button=""
          data-variant="outline"
          data-size="sm"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'list-none [&::-webkit-details-marker]:hidden')}
          aria-label={historyAria}
        >
          <Clock3 className="size-4" />
          {t('历史', 'History')}
          <span className="font-mono text-caption text-muted-foreground">{historyCount}</span>
        </summary>
        <div
          data-state="open"
          data-side="bottom"
          className={cn(
            menuContentClass,
            'absolute right-0 top-[calc(100%+4px)] z-[var(--z-overlay)] max-h-[min(480px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border bg-popover shadow-lg',
          )}
          role="menu"
          aria-label={historyMenuAria}
        >
          <div className={cn(menuLabelClass, 'flex items-center justify-between gap-3 px-2.5 py-2')}>
            <span>{historyMenuAria}</span>
            <span className="font-normal text-muted-foreground">{t('仅保存在本机', 'Stored on this machine only')}</span>
          </div>
          <div className={menuSeparatorClass} />
          {history}
        </div>
      </details>
      <Button
        variant="default"
        size="sm"
        className="app-no-drag workspace-catalog-action shrink-0"
        data-testid={actionTestId}
        aria-label={actionAria}
        onClick={openAction}
      >
        {action === 'create' ? <Plus className="size-4" /> : <FilePlus2 className="size-4" />}
        {actionLabel}
      </Button>
    </div>
  )
})

export default WorkspaceCatalogActions
