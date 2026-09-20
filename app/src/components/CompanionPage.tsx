import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { invokeCommand } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'

export default function CompanionPage() {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const parentRef = useRef<HTMLDivElement>(null)
  const stickToEnd = useRef(true)
  const virtualizer = useVirtualizer({
    count: companion.entries.length + (companion.hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: index => {
      if (companion.hasMore && index === 0) return 'older'
      return companion.entries[index - (companion.hasMore ? 1 : 0)]?.id ?? index
    },
  })

  useEffect(() => {
    document.documentElement.classList.add('companion-chat-surface')
    document.body.classList.add('companion-chat-surface')
    return () => {
      document.documentElement.classList.remove('companion-chat-surface')
      document.body.classList.remove('companion-chat-surface')
    }
  }, [])

  useEffect(() => {
    if (!stickToEnd.current || companion.entries.length === 0) return
    virtualizer.scrollToIndex(companion.entries.length + (companion.hasMore ? 1 : 0) - 1, {
      align: 'end',
    })
  }, [companion.entries, companion.hasMore, virtualizer])

  return (
    <main className="companion-chat" data-testid="companion-chat">
      <header className="companion-chat-head">
        <p className="min-w-0 flex-1 truncate text-label font-medium">{t('桌宠', 'Companion')}</p>
        <button
          type="button"
          className="companion-chat-icon"
          aria-label={t('关闭对话', 'Close chat')}
          onClick={() => void invokeCommand('hide_companion_chat_window', { locale })}
        >
          {t('关闭', 'Close')}
        </button>
      </header>
      <div
        ref={parentRef}
        className="companion-chat-log"
        onScroll={event => {
          const node = event.currentTarget
          stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
          if (node.scrollTop < 48 && companion.hasMore) void companion.loadOlder()
        }}
      >
        {companion.entries.length === 0 && !companion.busy ? (
          <p className="px-3 py-2 text-caption text-muted-foreground">
            {companion.status.model || companion.status.provider || t('桌宠', 'Companion')}
          </p>
        ) : (
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map(item => {
              if (companion.hasMore && item.index === 0) {
                return (
                  <div
                    key={item.key}
                    className="absolute left-0 top-0 w-full px-3 text-caption text-muted-foreground"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {t('更早的对话', 'Earlier messages')}
                  </div>
                )
              }
              const entry = companion.entries[item.index - (companion.hasMore ? 1 : 0)]
              if (!entry) return null
              return (
                <article
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full px-3 py-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <p className="text-caption text-muted-foreground">
                    {entry.role === 'user' ? t('你', 'You') : t('桌宠', 'Companion')}
                  </p>
                  <p className="whitespace-pre-wrap text-body text-foreground">{entry.text || entry.type}</p>
                </article>
              )
            })}
          </div>
        )}
      </div>
      {(companion.memory.pending ?? []).length ? (
        <div className="companion-chat-side">
          {(companion.memory.pending ?? []).map(item => (
            <div key={item.id} className="space-y-2 rounded-md border border-border bg-card p-2">
              <p className="text-label">{item.title}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void companion.approveMemory(item.id)}>
                  {t('批准', 'Approve')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void companion.forgetMemory(item.id)}>
                  {t('忘掉', 'Forget')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="companion-chat-composer">
        {companion.error ? (
          <p className="text-caption text-destructive">{companion.error}</p>
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            className="min-h-11 flex-1"
            value={companion.draft}
            onChange={event => companion.setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void companion.send()
              }
            }}
            aria-label={t('桌宠输入', 'Companion message')}
          />
          <Button disabled={companion.busy || !companion.draft.trim()} onClick={() => void companion.send()}>
            {companion.busy ? t('排队', 'Queue') : t('发送', 'Send')}
          </Button>
        </div>
      </div>
      <Dialog open={Boolean(companion.confirm)} onOpenChange={open => { if (!open) void companion.resolveConfirm(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('确认调度', 'Confirm dispatch')}</DialogTitle>
            <DialogDescription>
              {companion.confirm?.targetTitle || companion.confirm?.conversationId}
            </DialogDescription>
          </DialogHeader>
          <p className="text-body text-foreground">
            {companion.confirm?.action === 'stop'
              ? t('终止这个会话的当前回合。', 'Stop the current turn in this conversation.')
              : t('把这条指令插入正在进行的回合。', 'Steer the current turn with this instruction.')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => void companion.resolveConfirm(false)}>
              {t('取消', 'Cancel')}
            </Button>
            <Button onClick={() => void companion.resolveConfirm(true)}>
              {t('确认', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
