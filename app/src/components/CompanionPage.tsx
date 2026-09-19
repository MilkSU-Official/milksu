import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@/components/ui'
import ContextRail from '@/components/ContextRail'
import { useCompanion } from '@/composables/useCompanion'
import { useT } from '@/hooks/useUiLocale'

export default function CompanionPage() {
  const t = useT()
  const companion = useCompanion()
  const parentRef = useRef<HTMLDivElement>(null)
  const stickToEnd = useRef(true)
  const virtualizer = useVirtualizer({
    count: companion.entries.length + (companion.hasMore ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 16,
    getItemKey: index => {
      if (companion.hasMore && index === 0) return 'older'
      return companion.entries[index - (companion.hasMore ? 1 : 0)]?.id ?? index
    },
  })

  useEffect(() => {
    if (!stickToEnd.current || companion.entries.length === 0) return
    virtualizer.scrollToIndex(companion.entries.length + (companion.hasMore ? 1 : 0) - 1, {
      align: 'end',
    })
  }, [companion.entries, companion.hasMore, virtualizer])

  const empty = companion.entries.length === 0 && !companion.busy

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 bg-surface-editor">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {empty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
            <h1 className="text-title font-semibold tracking-[-0.02em] text-foreground">
              {t('桌宠', 'Companion')}
            </h1>
            <div className="mt-6 w-full max-w-2xl">
              <Composer companion={companion} />
            </div>
          </div>
        ) : (
          <>
            <div
              ref={parentRef}
              className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
              onScroll={event => {
                const node = event.currentTarget
                stickToEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
                if (node.scrollTop < 48 && companion.hasMore) void companion.loadOlder()
              }}
            >
              <div className="page-column page-stack relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                {virtualizer.getVirtualItems().map(item => {
                  if (companion.hasMore && item.index === 0) {
                    return (
                      <div
                        key={item.key}
                        className="absolute left-0 top-0 w-full text-caption text-muted-foreground"
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
                      className="absolute left-0 top-0 w-full"
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
            </div>
            <div className="border-t border-border px-6 py-3">
              <Composer companion={companion} />
            </div>
          </>
        )}
      </div>
      <ContextRail
        as="aside"
        size="compact"
        resizable
        header={<span className="text-label">{t('看板', 'Board')}</span>}
      >
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            {(companion.board.sessions ?? []).map(session => (
              <div key={session.id} className="rounded-md border border-border bg-card p-3">
                <p className="truncate text-label text-foreground">{session.title}</p>
                <p className="text-caption text-muted-foreground">{session.status}</p>
                {session.lastError ? (
                  <p className="text-caption text-destructive">{session.lastError}</p>
                ) : null}
              </div>
            ))}
            {(companion.board.todos ?? []).map(todo => (
              <div key={todo.id} className="rounded-md border border-border bg-card p-3">
                <p className="text-label text-foreground">{todo.title}</p>
                <p className="text-caption text-muted-foreground">{todo.status}</p>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <p className="text-label">{t('记忆', 'Memory')}</p>
            {(companion.memory.pending ?? []).map(item => (
              <div key={item.id} className="space-y-2 rounded-md border border-border bg-card p-3">
                <p className="text-label">{item.title}</p>
                <p className="whitespace-pre-wrap text-caption text-muted-foreground">{item.markdown}</p>
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
            {(companion.memory.approved ?? []).map(item => (
              <div key={item.id} className="space-y-2 rounded-md border border-border bg-card p-3">
                <p className="text-label">{item.title}</p>
                <p className="whitespace-pre-wrap text-caption text-muted-foreground">{item.markdown}</p>
                <Button size="sm" variant="outline" onClick={() => void companion.forgetMemory(item.id)}>
                  {t('忘掉', 'Forget')}
                </Button>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-label">{t('归档', 'Archives')}</p>
              <Button size="sm" variant="outline" onClick={() => void companion.archive()}>
                {t('归档当前段', 'Archive current')}
              </Button>
            </div>
            {(companion.archives ?? []).map(item => (
              <div key={item.name} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <p className="truncate text-caption">{item.name}</p>
                <Button size="sm" variant="outline" onClick={() => void companion.removeArchive(item.name)}>
                  {t('删除', 'Delete')}
                </Button>
              </div>
            ))}
          </section>
        </div>
      </ContextRail>
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

function Composer({
  companion,
}: {
  companion: ReturnType<typeof useCompanion>
}) {
  const t = useT()
  return (
    <div className="space-y-2">
      {companion.error ? (
        <p className="text-caption text-destructive">{companion.error}</p>
      ) : null}
      <p className="text-caption text-muted-foreground">
        {companion.status.model || companion.status.provider}
      </p>
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
  )
}
