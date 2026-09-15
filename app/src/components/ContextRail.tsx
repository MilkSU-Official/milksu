import type { CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { clampCodingRailWidth } from '@/lib/codingRailWidth'
import { cn } from '@/lib/cn'
import { useT } from '@/hooks/useUiLocale'

export default function ContextRail({
  as: Tag = 'section',
  size = 'compact',
  bodyMode = 'scroll',
  resizable = false,
  width = null,
  header,
  footer,
  children,
  className,
  onWidthChange,
  ...rest
}: {
  as?: 'section' | 'aside' | 'div' | 'nav'
  size?: 'compact' | 'wide' | 'drawer'
  bodyMode?: 'scroll' | 'viewport'
  resizable?: boolean
  width?: number | null
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  className?: string
  onWidthChange?: (value: number) => void
} & Omit<HTMLAttributes<HTMLElement>, 'onChange'>) {
  const t = useT()
  const panelStyle: CSSProperties | undefined = width
    ? { width: `${width}px`, maxWidth: '100%' }
    : undefined

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const handle = event.currentTarget
    const panel = handle.closest('.context-rail')
    if (!panel) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width

    function onMove(move: PointerEvent) {
      onWidthChange?.(clampCodingRailWidth(startWidth + (startX - move.clientX)))
    }
    function onUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return (
    <Tag
      className={cn('context-rail', className)}
      data-panel-size={size}
      data-panel-body-mode={bodyMode}
      data-panel-resizable={resizable ? '' : undefined}
      style={panelStyle}
      {...rest}
    >
      {resizable ? (
        <div
          className="context-rail__resize app-no-drag"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('调整右侧栏宽度', 'Resize the right panel')}
          onPointerDown={startResize}
        />
      ) : null}
      {header ? <header className="context-rail__header">{header}</header> : null}
      <div className="context-rail__body">{children}</div>
      {footer ? <footer className="context-rail__footer">{footer}</footer> : null}
      <style>{contextRailCss}</style>
    </Tag>
  )
}

const contextRailCss = `
.context-rail {
  position: var(--context-rail-position, relative);
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: none;
  flex-direction: column;
  isolation: isolate;
  overflow: hidden;
  border-left: 1px solid var(--border);
  background: var(--background);
  color: var(--foreground);
  animation: agent-chrome-in-x 200ms ease-out;
}

.context-rail[data-panel-size='compact'],
.context-rail[data-panel-size='wide'] {
  width: clamp(18rem, 26cqi, 24rem);
}
.context-rail[data-panel-size='drawer'] { width: clamp(16rem, 22vw, 19rem); }

.context-rail__resize {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
}

.context-rail__resize::after {
  position: absolute;
  inset: 0 3px;
  background: transparent;
  content: '';
}

.context-rail__resize:hover::after,
.context-rail__resize:focus-visible::after {
  background: var(--hover-2);
}

.context-rail__header {
  display: flex;
  min-height: 2.5rem;
  flex: none;
  align-items: center;
  padding: 0.25rem calc(0.5rem + var(--shell-window-control-safe-right)) 0.25rem 0.5rem;
}

.context-rail__body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.context-rail__body > * {
  min-width: 0;
}

.context-rail[data-panel-body-mode='scroll'] > .context-rail__body {
  overflow-y: auto;
}

.context-rail[data-panel-body-mode='viewport'] > .context-rail__body {
  overflow: hidden;
}

.context-rail__footer {
  flex: none;
}

@keyframes agent-chrome-in-x {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .context-rail {
    animation: none;
  }
}
`
