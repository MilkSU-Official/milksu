import { useEffect } from 'react'
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

/**
 * A small right-click menu offering to quote the selection. It is only ever rendered when there is
 * a selection, and it adds nothing by itself: the caller decides where the quote goes.
 */
export function ConversationQuoteMenu({
  text,
  x,
  y,
  onAdd,
  onDismiss,
}: {
  text: string
  x: number
  y: number
  onAdd: (text: string) => void
  onDismiss: () => void
}) {
  const t = useT()

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

  return (
    <div
      data-testid="conversation-quote-menu"
      role="menu"
      aria-label={t('引用这段内容', 'Quote this text')}
      className="fixed z-50 min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
      onContextMenu={event => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="conversation-quote-add"
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-control hover:bg-accent hover:text-accent-foreground"
        onClick={() => onAdd(text)}
      >
        <Quote className="size-3.5 shrink-0" aria-hidden="true" />
        {t('加入对话', 'Add to conversation')}
      </button>
    </div>
  )
}
