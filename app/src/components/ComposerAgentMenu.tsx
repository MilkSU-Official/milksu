import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { SearchableModelList } from '@/components/SearchableModelPicker'
import type { SearchableModelGroup, SearchableModelOption } from '@/lib/modelPickerSearch'
import {
  layoutComposerAgentFlyout,
  type ComposerAgentPane,
} from '@/lib/composerAgentMenu'
import type { ModelThinkingLevel } from '@/types'
import { MODEL_THINKING_LEVEL_LABELS } from '@/lib/modelThinking'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

export default function ComposerAgentMenu({
  modelKey,
  disabled,
  triggerClassName,
  ariaLabel,
  title,
  trigger,
  modelLabel,
  leading,
  groups,
  kernel = 'pi',
  thinkingLevels = [],
  thinkingLevel,
  contextLabel,
  showRuntime = true,
  onChangeModel,
  onChangeKernel,
  onChangeThinkingLevel,
}: {
  modelKey: string
  disabled?: boolean
  triggerClassName?: string
  ariaLabel?: string
  title?: string
  trigger: ReactNode
  modelLabel: string
  leading?: SearchableModelOption[]
  groups: readonly SearchableModelGroup[]
  kernel?: 'pi' | 'dsh'
  thinkingLevels?: ModelThinkingLevel[]
  thinkingLevel?: ModelThinkingLevel
  contextLabel?: string
  showRuntime?: boolean
  onChangeModel?: (value: string) => void
  onChangeKernel?: (value: 'pi' | 'dsh') => void
  onChangeThinkingLevel?: (level: ModelThinkingLevel) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<ComposerAgentPane | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<{ top: number | null; bottom: number | null; left: number } | null>(null)
  const [flyoutMaxH, setFlyoutMaxH] = useState(352)
  const panel = useRef<HTMLDivElement | null>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const runtimeLabel = kernel === 'dsh' ? 'DSH' : 'Pi'
  const thinkingLabel = thinkingLevel ? MODEL_THINKING_LEVEL_LABELS[thinkingLevel] : ''

  useEffect(() => {
    if (!open) setPane(null)
  }, [open])

  // The flyout portals to document.body: nested inside the glass panel its
  // backdrop-filter would lose the page backdrop and render almost clear.
  function openPane(next: ComposerAgentPane) {
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    const layout = layoutComposerAgentFlyout(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      next,
    )
    const width = next === 'model' ? 352 : next === 'runtime' ? 248 : 176
    const gap = 10
    let left = rect.right + gap
    if (left + width > window.innerWidth - 8) left = rect.left - width - gap
    setFlyoutPos({
      top: layout.alignBottom ? null : rect.top,
      bottom: layout.alignBottom ? window.innerHeight - rect.bottom : null,
      left: Math.max(8, left),
    })
    setFlyoutMaxH(layout.maxHeight)
    setPane(next)
  }

  function keepOpenInsideFlyout(event: Event) {
    const target = event.target
    if (target instanceof Node && flyoutRef.current?.contains(target)) event.preventDefault()
  }

  function row(id: ComposerAgentPane, label: string, value: string) {    const active = pane === id
    return (
      <button
        type="button"
        className={cn(
          'flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-sm',
          active ? 'bg-accent' : 'hover:bg-accent',
        )}
        aria-expanded={active}
        onMouseEnter={() => openPane(id)}
        onPointerEnter={() => openPane(id)}
        onClick={() => openPane(id)}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="max-w-[7rem] shrink-0 truncate text-caption text-muted-foreground">{value}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          className={cn('justify-between gap-1.5', triggerClassName)}
        >
          <span className="min-w-0 flex-1 truncate text-left">{trigger}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        onOpenAutoFocus={event => event.preventDefault()}
        onInteractOutside={keepOpenInsideFlyout}
        onFocusOutside={keepOpenInsideFlyout}
        onPointerDownOutside={keepOpenInsideFlyout}
        className="w-[15.5rem] overflow-visible border-0 bg-transparent p-0 shadow-none"
      >
        <div
          ref={panel}
          className="relative w-[15.5rem] rounded-md border border-border bg-popover p-1 text-popover-foreground"
        >
          {row('model', t('模型', 'Model'), modelLabel)}
          {thinkingLevels.length ? row('thinking', t('推理强度', 'Reasoning'), thinkingLabel) : null}
          {contextLabel ? (
            <div className="flex h-8 w-full items-center gap-3 rounded-md px-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{t('上下文', 'Context')}</span>
              <span className="max-w-[7rem] shrink-0 truncate text-caption text-muted-foreground">{contextLabel}</span>
            </div>
          ) : null}
          {showRuntime ? row('runtime', t('运行时', 'Runtime'), runtimeLabel) : null}
        </div>
      </PopoverContent>
      {/* The flyout portals to document.body, so Radix sees its clicks and
          focus as "outside" the popover and would dismiss the whole menu. */}
      {pane && flyoutPos ? createPortal(
        <div
          ref={flyoutRef}
          className={cn(
            'fixed z-50 flex transition-[opacity,scale] duration-[180ms] ease-[var(--ease-out)]',
            'starting:scale-[0.96] starting:opacity-0 scale-100 opacity-100',
          )}
          style={{ top: flyoutPos.top ?? undefined, bottom: flyoutPos.bottom ?? undefined, left: flyoutPos.left }}
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onTouchStart={event => event.stopPropagation()}
          onContextMenu={event => event.stopPropagation()}
        >
          {pane === 'model' ? (
            <div
              className="flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground"
              style={{ maxHeight: flyoutMaxH }}
            >
              <SearchableModelList
                value={modelKey}
                leading={leading}
                groups={groups}
                listClassName="max-h-none"
                onChange={value => {
                  onChangeModel?.(value)
                  setOpen(false)
                }}
              />
            </div>
          ) : pane === 'runtime' ? (
            <div className="w-[15.5rem] rounded-md border border-border bg-popover p-1 text-popover-foreground">
              {(['pi', 'dsh'] as const).map(id => (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                    kernel === id ? 'bg-accent' : 'hover:bg-accent',
                  )}
                  onClick={() => {
                    onChangeKernel?.(id)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {id === 'dsh' ? t('DeepSeek Harness', 'DeepSeek Harness') : 'Pi'}
                  </span>
                  {kernel === id ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              ))}
            </div>
          ) : (
            <div
              className="w-[11rem] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground"
              style={{ maxHeight: flyoutMaxH }}
            >
              {thinkingLevels.map(level => (
                <button
                  key={level}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
                    level === thinkingLevel ? 'bg-accent' : 'hover:bg-accent',
                  )}
                  onClick={() => onChangeThinkingLevel?.(level)}
                >
                  <span className="min-w-0 flex-1 truncate">{MODEL_THINKING_LEVEL_LABELS[level]}</span>
                  {level === thinkingLevel ? <Check className="size-3.5 shrink-0" /> : null}
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      ) : null}
    </Popover>
  )
}
