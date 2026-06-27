import type { Conversation } from '../types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

function timeLabel(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 3600_000) return `${Math.max(1, Math.floor(diff / 60_000))} min`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} hr`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} days`
  return `${Math.floor(diff / 604800_000)} wk`
}

export function Sidebar({ conversations, activeId, onSelect, onNew }: Props) {
  return (
    <div className="w-60 border-r border-[#e5e5e5] flex flex-col bg-[#fafafa]">
      <div className="p-2 pt-3 space-y-0.5">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#333] hover:bg-[#eee] rounded-lg transition-colors"
        >
          <span className="text-base text-[#888]">+</span>
          New conversation
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#333] hover:bg-[#eee] rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5 text-[#888]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Search
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 mt-2">
        {conversations.length > 0 && (
          <p className="text-xs text-[#999] px-3 py-1.5 uppercase tracking-wider">Conversations</p>
        )}
        {conversations.map(conv => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 transition-colors ${
              conv.id === activeId
                ? 'bg-[#e8e8e8]'
                : 'hover:bg-[#f0f0f0]'
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm truncate flex-1">{conv.title}</p>
              <span className="text-xs text-[#bbb] ml-2 shrink-0">{timeLabel(conv.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
