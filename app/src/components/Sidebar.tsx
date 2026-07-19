import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onOpenSettings }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const filtered = search
    ? conversations.filter(conversation =>
        conversation.title.toLowerCase().includes(search.toLowerCase()) ||
        conversation.messages.some(message => message.content.toLowerCase().includes(search.toLowerCase())),
      )
    : conversations

  const timeLabel = (timestamp: number): string => {
    const difference = Date.now() - timestamp
    if (difference < 3600_000) return t('sidebar.time.minutes', { count: Math.max(1, Math.floor(difference / 60_000)) })
    if (difference < 86400_000) return t('sidebar.time.hours', { count: Math.floor(difference / 3600_000) })
    if (difference < 604800_000) return t('sidebar.time.days', { count: Math.floor(difference / 86400_000) })
    return t('sidebar.time.weeks', { count: Math.floor(difference / 604800_000) })
  }

  return (
    <div className="flex w-60 flex-col border-r border-[#e5e5e5] bg-[#fafafa]">
      <div className="space-y-0.5 p-2 pt-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#333] transition-colors hover:bg-[#eee]"
        >
          <span className="text-base text-[#888]">+</span>
          {t('sidebar.newConversation')}
        </button>
        <button
          onClick={() => setShowSearch(previous => !previous)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#333] transition-colors hover:bg-[#eee]"
        >
          <svg className="size-3.5 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          {t('sidebar.search')}
        </button>
        {showSearch && (
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('sidebar.filterConversations')}
            autoFocus
            className="w-full rounded-lg border border-[#ddd] bg-white px-3 py-1.5 text-sm outline-none transition-colors focus:border-[#999]"
          />
        )}
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2">
        {filtered.length > 0 && (
          <p className="px-3 py-1.5 text-xs uppercase tracking-wider text-[#999]">{t('sidebar.conversations')}</p>
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-xs text-[#999]">{t('sidebar.noResults')}</p>
        )}
        {filtered.map(conversation => (
          <div
            key={conversation.id}
            className={`group relative mb-0.5 rounded-lg transition-colors ${
              conversation.id === activeId ? 'bg-[#e8e8e8]' : 'hover:bg-[#f0f0f0]'
            }`}
          >
            <button onClick={() => onSelect(conversation.id)} className="w-full px-3 py-2 text-left">
              <div className="flex items-center gap-1.5">
                <p className="flex-1 truncate pr-6 text-sm">{conversation.title}</p>
                <span className="shrink-0 text-xs text-[#bbb]">{timeLabel(conversation.createdAt)}</span>
              </div>
            </button>
            <button
              onClick={event => {
                event.stopPropagation()
                onDelete(conversation.id)
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#ccc] opacity-0 transition-all hover:text-[#888] group-hover:opacity-100"
              title={t('sidebar.deleteConversation')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-[#e5e5e5] p-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#333] transition-colors hover:bg-[#eee]"
        >
          <svg className="size-3.5 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          {t('sidebar.settings')}
        </button>
      </div>
    </div>
  )
}
