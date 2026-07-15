import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, TaskType } from '../types'
import { Shield, Flag, Network, Binary } from 'lucide-react'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}

const TASK_ICON_COLORS: Record<TaskType, string> = {
  chat: '',
  pentest: 'text-red-400',
  ctf: 'text-purple-400',
  recon: 'text-blue-400',
  reverse: 'text-amber-400',
}

function TaskIcon({ type }: { type: TaskType }) {
  if (type === 'chat') return null
  const cls = `size-3 shrink-0 ${TASK_ICON_COLORS[type]}`
  switch (type) {
    case 'pentest': return <Shield className={cls} />
    case 'ctf': return <Flag className={cls} />
    case 'recon': return <Network className={cls} />
    case 'reverse': return <Binary className={cls} />
  }
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onOpenSettings }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [showSearch, setShowSearch] = useState(false)

  const filtered = search
    ? conversations.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.messages.some(m => m.content.toLowerCase().includes(search.toLowerCase()))
      )
    : conversations

  const timeLabel = (ts: number): string => {
    const diff = Date.now() - ts
    if (diff < 3600_000) return t('sidebar.time.minutes', { count: Math.max(1, Math.floor(diff / 60_000)) })
    if (diff < 86400_000) return t('sidebar.time.hours', { count: Math.floor(diff / 3600_000) })
    if (diff < 604800_000) return t('sidebar.time.days', { count: Math.floor(diff / 86400_000) })
    return t('sidebar.time.weeks', { count: Math.floor(diff / 604800_000) })
  }

  return (
    <div className="w-60 border-r border-[#e5e5e5] flex flex-col bg-[#fafafa]">
      <div className="p-2 pt-3 space-y-0.5">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#333] hover:bg-[#eee] rounded-lg transition-colors"
        >
          <span className="text-base text-[#888]">+</span>
          {t('sidebar.newConversation')}
        </button>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#333] hover:bg-[#eee] rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          {t('sidebar.search')}
        </button>
        {showSearch && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('sidebar.filterConversations')}
            autoFocus
            className="w-full px-3 py-1.5 text-sm bg-white border border-[#ddd] rounded-lg outline-none focus:border-[#999] transition-colors"
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-2">
        {filtered.length > 0 && (
          <p className="text-xs text-[#999] px-3 py-1.5 uppercase tracking-wider">{t('sidebar.conversations')}</p>
        )}
        {filtered.length === 0 && (
          <p className="text-xs text-[#999] px-3 py-3">{t('sidebar.noResults')}</p>
        )}
        {filtered.map(conv => (
          <div
            key={conv.id}
            className={`group relative rounded-lg mb-0.5 transition-colors ${
              conv.id === activeId ? 'bg-[#e8e8e8]' : 'hover:bg-[#f0f0f0]'
            }`}
          >
            <button
              onClick={() => onSelect(conv.id)}
              className="w-full text-left px-3 py-2"
            >
              <div className="flex items-center gap-1.5">
                <TaskIcon type={conv.taskType} />
                <p className="text-sm truncate flex-1 pr-6">{conv.title}</p>
                <span className="text-xs text-[#bbb] shrink-0">{timeLabel(conv.createdAt)}</span>
              </div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-[#ccc] hover:text-[#888] transition-all p-1"
              title={t('sidebar.deleteConversation')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-[#e5e5e5]">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#333] hover:bg-[#eee] rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          {t('sidebar.settings')}
        </button>
      </div>
    </div>
  )
}
