import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { X } from 'lucide-react'
import companionIdle from '@/assets/companion/idle.png'
import { Button, Textarea } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { invokeCommand, listenEvent } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import {
  companionChatIsBubble,
  companionChatIsUser,
  companionChatShowsTimeCaption,
  companionChatShowsTimeDivider,
  companionChatTimestampMs,
  formatCompanionChatStamp,
} from '@/lib/companionChatLayout'
import { cn } from '@/lib/cn'
import type { AppSettings, CompanionSkinResolved } from '@/types'

function fitComposer(node: HTMLTextAreaElement | null) {
  if (!node) return
  node.style.height = '0px'
  node.style.height = `${Math.min(Math.max(node.scrollHeight, 22), 72)}px`
}

export default function CompanionPage() {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const parentRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToEnd = useRef(true)
  const [avatar, setAvatar] = useState(companionIdle)
  const olderOffset = companion.hasMore ? 1 : 0
  const typing = companion.busy && !companion.streaming
  const virtualizer = useVirtualizer({
    count: companion.entries.length + olderOffset,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
    getItemKey: index => {
      if (companion.hasMore && index === 0) return 'older'
      return companion.entries[index - olderOffset]?.id ?? index
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
    let cancelled = false
    async function loadSkin(id?: string) {
      try {
        const settings = await invokeCommand<AppSettings>('get_settings')
        const resolved = await invokeCommand<CompanionSkinResolved>('get_companion_skin', {
          id: id || settings.companion_skin_id || 'default',
        })
        const src = resolved?.frames.idle || resolved?.frames.talk || companionIdle
        if (!cancelled) setAvatar(src)
      } catch {
        if (!cancelled) setAvatar(companionIdle)
      }
    }
    void loadSkin()
    let stop: (() => void) | undefined
    void listenEvent<{ id?: string }>('companion-skin.changed', event => {
      void loadSkin(event.payload?.id)
    }).then(unlisten => {
      stop = unlisten
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  useEffect(() => {
    fitComposer(inputRef.current)
  }, [companion.draft])

  useEffect(() => {
    if (!stickToEnd.current || companion.entries.length === 0) return
    virtualizer.scrollToIndex(companion.entries.length + olderOffset - 1, {
      align: 'end',
    })
  }, [companion.entries, olderOffset, typing, virtualizer])

  return (
    <main className="companion-chat" data-testid="companion-chat">
      <header className="companion-chat-head">
        <img className="companion-chat-avatar" src={avatar} alt="" draggable={false} />
        <p className="companion-chat-title">{t('桌宠', 'Companion')}</p>
        <button
          type="button"
          className="companion-chat-icon"
          aria-label={t('关闭对话', 'Close chat')}
          onClick={() => void invokeCommand('hide_companion_chat_window', { locale })}
        >
          <X className="size-3.5" />
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
        {companion.entries.length === 0 ? null : (
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map(item => {
              if (companion.hasMore && item.index === 0) {
                return (
                  <div
                    key={item.key}
                    className="companion-chat-time absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {t('更早的对话', 'Earlier messages')}
                  </div>
                )
              }
              const entryIndex = item.index - olderOffset
              const entry = companion.entries[entryIndex]
              if (!entry) return null
              const previous = companion.entries[entryIndex - 1]
              const next = companion.entries[entryIndex + 1]
              const currentMs = companionChatTimestampMs(entry.timestamp)
              const showDivider = companionChatShowsTimeDivider(
                currentMs,
                companionChatTimestampMs(previous?.timestamp),
              )
              const showCaption = companionChatShowsTimeCaption({
                currentMs,
                nextMs: companionChatTimestampMs(next?.timestamp),
                currentRole: entry.role,
                nextRole: next?.role,
                showDivider,
                isLast: entryIndex === companion.entries.length - 1,
              })
              const stamp = formatCompanionChatStamp(entry.timestamp, locale)
              const user = companionChatIsUser(entry.role)
              const bubble = companionChatIsBubble(entry.role)
              return (
                <article
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className={cn(
                    'companion-chat-row absolute left-0 top-0 w-full',
                    user ? 'companion-chat-row-user' : 'companion-chat-row-assistant',
                    !bubble && 'companion-chat-row-system',
                  )}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {showDivider && stamp ? <p className="companion-chat-time">{stamp}</p> : null}
                  {bubble ? (
                    <p className={cn(
                      'companion-chat-bubble',
                      user ? 'companion-chat-bubble-user' : 'companion-chat-bubble-assistant',
                      showCaption && 'companion-chat-bubble-tail',
                    )}>
                      {entry.text || entry.type}
                    </p>
                  ) : (
                    <p className="companion-chat-system">{entry.text || entry.type}</p>
                  )}
                  {showCaption && stamp ? <p className="companion-chat-stamp">{stamp}</p> : null}
                </article>
              )
            })}
          </div>
        )}
        {typing ? (
          <div className="companion-chat-row companion-chat-row-assistant">
            <p className="companion-chat-bubble companion-chat-bubble-assistant companion-chat-typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </p>
            <span className="sr-only">{t('正在回复', 'Replying')}</span>
          </div>
        ) : null}
      </div>
      {(companion.memory.pending ?? []).length || companion.confirm ? (
        <div className="companion-chat-dock">
          {(companion.memory.pending ?? []).map(item => (
            <div key={item.id} className="companion-chat-memory">
              <p>{item.title}</p>
              <Button size="sm" className="h-7" onClick={() => void companion.approveMemory(item.id)}>
                {t('批准', 'Approve')}
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => void companion.forgetMemory(item.id)}>
                {t('忘掉', 'Forget')}
              </Button>
            </div>
          ))}
          {companion.confirm ? (
            <div className="companion-chat-confirm">
              <p>
                {companion.confirm.action === 'stop'
                  ? t('终止这个会话的当前回合。', 'Stop the current turn in this conversation.')
                  : companion.confirm.text.trim() || companion.confirm.targetTitle.trim()
                    || t('把这条指令插入正在进行的回合。', 'Steer the current turn with this instruction.')}
              </p>
              <div className="companion-chat-confirm-actions">
                <Button size="sm" variant="outline" className="h-7" onClick={() => void companion.resolveConfirm(false)}>
                  {t('取消', 'Cancel')}
                </Button>
                <Button size="sm" className="h-7" onClick={() => void companion.resolveConfirm(true)}>
                  {t('确认', 'Confirm')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="companion-chat-composer">
        {companion.error ? (
          <p className="companion-chat-error">{companion.error}</p>
        ) : null}
        <div className="companion-chat-well">
          <Textarea
            ref={inputRef}
            className="companion-chat-input min-h-0 max-h-[72px] flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:border-transparent"
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
          <Button
            className="companion-chat-send"
            disabled={companion.busy || !companion.draft.trim()}
            onClick={() => void companion.send()}
          >
            {companion.busy ? t('排队', 'Queue') : t('发送', 'Send')}
          </Button>
        </div>
      </div>
    </main>
  )
}
