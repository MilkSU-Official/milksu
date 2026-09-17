import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui'
import { Settings, Terminal } from 'lucide-react'
import {
  commandPanelAccent,
  commandPanelItems,
  dispatchCommandPanelSlash,
  formatCommandPanelAge,
  visibleCommandPanelItems,
  type CommandPanelFilter,
  type CommandPanelItem,
} from '@/lib/commandPanel'
import type { NormalizedSettingsCategory } from '@/lib/settingsNavigation'
import type { Conversation } from '@/types'
import { useT } from '@/hooks/useUiLocale'

const FILTERS: Array<{ id: CommandPanelFilter; zh: string; en: string }> = [
  { id: 'all', zh: '全部', en: 'All' },
  { id: 'conversation', zh: '会话', en: 'Chats' },
  { id: 'settings', zh: '设置', en: 'Settings' },
  { id: 'slash', zh: '命令', en: 'Commands' },
]

export default function CommandPanel({
  open,
  conversations,
  onOpenChange,
  onSelectConversation,
  onSelectSettings,
}: {
  open: boolean
  conversations: Conversation[]
  onOpenChange: (open: boolean) => void
  onSelectConversation?: (id: string) => void
  onSelectSettings?: (category: NormalizedSettingsCategory) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<CommandPanelFilter>('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const input = useRef<HTMLInputElement | null>(null)
  const items = useMemo(
    () => visibleCommandPanelItems(commandPanelItems(conversations), query, filter),
    [conversations, filter, query],
  )

  useEffect(() => {
    if (!open) return
    setQuery('')
    setFilter('all')
    setActiveIndex(0)
    const frame = window.requestAnimationFrame(() => input.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [filter, query])

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(Math.max(0, items.length - 1))
  }, [activeIndex, items.length])

  function close() {
    onOpenChange(false)
  }

  function choose(item: CommandPanelItem | undefined) {
    if (!item) return
    close()
    if (item.kind === 'conversation') onSelectConversation?.(item.id)
    else if (item.kind === 'settings') onSelectSettings?.(item.category)
    else dispatchCommandPanelSlash(item.id)
  }

  const grouped = [
    {
      key: 'conversation',
      label: query.trim() ? t('会话', 'Chats') : t('最近会话', 'Recent chats'),
      items: items.filter(item => item.kind === 'conversation'),
    },
    { key: 'settings', label: t('设置', 'Settings'), items: items.filter(item => item.kind === 'settings') },
    { key: 'slash', label: t('命令', 'Commands'), items: items.filter(item => item.kind === 'slash') },
  ].filter(group => group.items.length)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/20"
        data-command-panel=""
        className="top-[16%] w-[min(40rem,calc(100vw-2rem))] max-w-none translate-y-0 gap-0 overflow-hidden rounded-[12px] border border-border bg-popover p-0 shadow-xl"
      >
        <DialogTitle className="sr-only">{t('搜索', 'Search')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('搜索会话、设置或命令', 'Search chats, settings, or commands')}
        </DialogDescription>
        <div className="px-4 pt-3">
          <input
            ref={input}
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="h-10 w-full border-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            placeholder={t('搜索会话、设置、命令', 'Search chats, settings, commands')}
            aria-label={t('搜索', 'Search')}
            onKeyDown={event => {
              if (event.key === 'Tab') {
                event.preventDefault()
                const order = FILTERS.map(item => item.id)
                const index = order.indexOf(filter)
                const delta = event.shiftKey ? -1 : 1
                setFilter(order[(index + delta + order.length) % order.length])
                return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!items.length) return
                const delta = event.key === 'ArrowDown' ? 1 : -1
                setActiveIndex(current => (current + delta + items.length) % items.length)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                choose(items[activeIndex])
              }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {FILTERS.map(item => {
            const selected = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`h-7 rounded-full px-2.5 text-label ${selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                aria-pressed={selected}
                onClick={() => setFilter(item.id)}
              >
                {t(item.zh, item.en)}
              </button>
            )
          })}
        </div>
        <div className="max-h-[min(22rem,50vh)] overflow-y-auto px-1.5 pb-1">
          {grouped.map(group => (
            <section key={group.key} className="py-1">
              <p className="px-2.5 py-1 text-caption text-muted-foreground">{group.label}</p>
              {group.items.map(item => {
                const index = items.indexOf(item)
                return (
                  <button
                    key={`${item.kind}:${item.kind === 'settings' ? item.category : item.id}`}
                    type="button"
                    className={`flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-sm ${index === activeIndex ? 'bg-accent' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                  >
                    {item.kind === 'conversation' ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: commandPanelAccent(item.id) }}
                        aria-hidden="true"
                      />
                    ) : item.kind === 'settings' ? (
                      <Settings className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.kind === 'conversation' && item.subtitle ? (
                      <span className="max-w-[8rem] shrink-0 truncate text-caption text-muted-foreground">
                        {item.subtitle}
                      </span>
                    ) : null}
                    {item.kind === 'conversation' ? (
                      <span className="w-8 shrink-0 text-right text-caption text-muted-foreground">
                        {formatCommandPanelAge(item.activityAt)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </section>
          ))}
          {query.trim() && !items.length ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t('没有匹配的会话', 'No matching chats')}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-caption text-muted-foreground">
          <span>↵ {t('打开', 'Open')}</span>
          <span>↑↓ {t('选择', 'Select')}</span>
          <span>Tab {t('筛选', 'Filter')}</span>
          <span>Esc {t('关闭', 'Close')}</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
