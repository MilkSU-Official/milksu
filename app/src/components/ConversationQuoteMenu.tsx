import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Quote } from 'lucide-react'
import { useT } from '@/hooks/useUiLocale'

/**
 * The selected text inside the transcript, or '' when there is nothing usable. A selection that
 * starts or ends outside the transcript is ignored, so a right click on the composer can never quote
 * something the reader did not select in the conversation.
 */
export function selectedTextIn(container: HTMLElement | null): string {
  if (!container || typeof window === 'undefined') return ''
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  const text = String(selection.toString() ?? '').trim()
  if (!text) return ''
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    const node = range.commonAncestorContainer
    const element = node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
    if (!element || !container.contains(element)) return ''
  }
  return text
}

/** Where the quote chip should sit: centered above the selection, inside the window. */
export function selectionQuotePoint(container: HTMLElement | null): {
  text: string
  left: number
  top: number
  width: number
  height: number
} | null {
  const text = selectedTextIn(container)
  if (!text || typeof window === 'undefined') return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const rect = typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : { left: 0, top: 0, width: 0, height: 0 }
  return {
    text,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * A small right-click menu offering to quote the selection. It is only ever rendered when there is
 * a selection, and it adds nothing by itself: the caller decides where the quote goes.
 */
export function ConversationQuoteMenu({
  text,
  left,
  top,
  width = 0,
  height = 0,
  onAdd,
  onDismiss,
}: {
  text: string
  left: number
  top: number
  width?: number
  height?: number
  onAdd: (text: string) => void
  onDismiss: () => void
}) {
  const t = useT()
  const menu = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left, top: Math.max(8, top - 36) })

  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const margin = 8
    const box = element.getBoundingClientRect()
    const center = left + width / 2
    const above = top - box.height - 6
    const below = top + height + 6
    const nextTop = above >= margin ? above : Math.min(below, window.innerHeight - box.height - margin)
    setPosition({
      left: Math.max(margin, Math.min(center - box.width / 2, window.innerWidth - box.width - margin)),
      top: Math.max(margin, nextTop),
    })
  }, [left, top, width, height])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('[data-testid="conversation-quote-menu"]')) return
      onDismiss()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onPointerDown, true)
    }
  }, [onDismiss])

  const chip = (
    <div
      ref={menu}
      data-testid="conversation-quote-menu"
      role="menu"
      aria-label={t('引用这段内容', 'Quote this text')}
      className="pointer-events-auto fixed z-[80] w-max"
      style={{ left: position.left, top: position.top }}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="conversation-quote-add"
        className="inline-flex w-max items-center gap-1 rounded-full border border-border bg-popover px-2 py-0.5 text-xs font-medium text-popover-foreground shadow-md hover:bg-accent"
        onMouseDown={event => event.preventDefault()}
        onClick={() => onAdd(text)}
      >
        <Quote className="size-3 shrink-0" aria-hidden="true" />
        {t('加入对话', 'Add to Chat')}
      </button>
    </div>
  )
  if (typeof document === 'undefined') return chip
  return createPortal(chip, document.body)
}
