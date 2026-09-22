import { useEffect, useMemo, useRef, useState } from 'react'
import { Square, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import { useT } from '@/hooks/useUiLocale'
import {
  liveWorkingItems,
  workingCapsuleCopy,
  type WorkingItem,
} from '@/lib/workingRoster'
import type { Conversation } from '@/types'

export default function WorkingTray({
  items,
  conversations,
  onStopOne,
  onStopAll,
  onOpenItem,
}: {
  items: readonly WorkingItem[]
  conversations: readonly Conversation[]
  onStopOne?: (item: WorkingItem) => void
  onStopAll?: () => void
  onOpenItem?: (item: WorkingItem) => void
}) {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [viewingId, setViewingId] = useState('')
  const [viewingItem, setViewingItem] = useState<WorkingItem | null>(null)
  const live = useMemo(() => liveWorkingItems(items), [items])
  const viewing = conversations.find(item => item.id === viewingId) ?? null
  const viewingOpen = Boolean(viewing || viewingItem)
  const capsuleLabel = workingCapsuleCopy(live.length, t)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!live.length) return null

  function statusLabel(item: WorkingItem) {
    if (item.status === 'succeeded') return t('成功', 'Succeeded')
    if (item.status === 'failed') return t('失败', 'Failed')
    return t('进行中', 'Working')
  }

  function openItem(item: WorkingItem) {
    setViewingItem(item)
    setViewingId(item.conversationId ?? '')
    if (item.kind === 'subagent') onOpenItem?.(item)
  }

  return (
    <div className="agent-working agent-thread">
      <div ref={root} className="agent-working__anchor">
        {open ? (
          <div
            className="agent-working__panel"
            role="dialog"
            aria-label={t('进行中', 'Working')}
          >
            <div className="agent-working__panel-head">
              <p className="agent-working__panel-title">{t('进行中', 'Working')}</p>
              <div className="agent-working__panel-actions">
                <button
                  type="button"
                  className="agent-working__action"
                  onClick={() => onStopAll?.()}
                >
                  {t('全部停止', 'Stop all')}
                </button>
                <button
                  type="button"
                  className="agent-working__action agent-working__action--icon"
                  aria-label={t('关闭', 'Close')}
                  onClick={() => setOpen(false)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
            <ul>
              {items.map(item => (
                <li key={item.id}>
                  <div className="agent-working__row">
                    <button
                      type="button"
                      className="agent-working__row-main"
                      onClick={() => openItem(item)}
                    >
                      <span className="agent-working__row-title">{item.title}</span>
                      <span className="agent-working__row-status">{statusLabel(item)}</span>
                    </button>
                    {item.status === 'running' ? (
                      <button
                        type="button"
                        className="agent-working__action agent-working__action--icon"
                        disabled={!item.stoppable && items.every(entry => !entry.stoppable)}
                        aria-label={item.stoppable
                          ? t('停止此项', 'Stop this')
                          : t('全部停止', 'Stop all')}
                        onClick={() => {
                          if (item.stoppable) onStopOne?.(item)
                          else onStopAll?.()
                        }}
                      >
                        <Square className="size-3 fill-current" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          className="agent-working__capsule"
          aria-expanded={open}
          aria-label={capsuleLabel}
          onClick={() => setOpen(current => !current)}
        >
          <AgentPixelLoader compact running />
          <span>{capsuleLabel}</span>
        </button>
      </div>

      <Dialog
        open={viewingOpen}
        onOpenChange={next => {
          if (!next) {
            setViewingId('')
            setViewingItem(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.title || viewingItem?.title || t('子代理', 'Subagent')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('查看这个子代理正在跑的对话', 'View this subagent conversation')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(24rem,calc(100vh-12rem))] space-y-3 overflow-y-auto px-1 py-2">
            {(viewing?.messages ?? []).length ? (viewing?.messages ?? []).map(message => (
              <div key={message.id} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="mb-1 text-label text-muted-foreground">
                  {message.role === 'user'
                    ? t('你', 'You')
                    : message.role === 'tool'
                      ? (message.toolName || t('工具', 'Tool'))
                      : t('子代理', 'Subagent')}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-label">
                  {message.content}
                </pre>
              </div>
            )) : (
              <div className="rounded-md border border-border bg-card px-3 py-2">
                <p className="mb-1 text-label text-muted-foreground">
                  {viewingItem ? statusLabel(viewingItem) : t('子代理', 'Subagent')}
                </p>
                <pre className="whitespace-pre-wrap break-words font-sans text-label">
                  {viewingItem?.detail || viewingItem?.title || ''}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
