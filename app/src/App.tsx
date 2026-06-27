import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { OutputPanel } from './components/OutputPanel'
import { SettingsPage } from './components/SettingsPage'
import type { Conversation, Message, AppSettings } from './types'

interface AgentEvent {
  conversation_id: string
  role: string
  content: string
  tool_name?: string
  done?: boolean
}

interface StoredConversation {
  id: string
  title: string
  created_at: number
  messages: { id: string; role: string; content: string; timestamp: number; tool_name?: string; status?: string }[]
}

function fromStored(s: StoredConversation): Conversation {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.created_at,
    messages: s.messages.map(m => ({
      id: m.id,
      role: m.role as Message['role'],
      content: m.content,
      timestamp: m.timestamp,
      toolName: m.tool_name,
      status: (m.status as Message['status']) ?? 'done',
    })),
  }
}

function toStored(c: Conversation): StoredConversation {
  return {
    id: c.id,
    title: c.title,
    created_at: c.createdAt,
    messages: c.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      tool_name: m.toolName,
      status: m.status,
    })),
  }
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showOutput, setShowOutput] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = conversations.find(c => c.id === activeId) ?? null

  useEffect(() => {
    invoke<AppSettings>('get_settings').then(setSettings)
    invoke<StoredConversation[]>('list_conversations').then(stored => {
      setConversations(stored.map(fromStored))
    })
  }, [])

  const persistConversation = useCallback((conv: Conversation) => {
    invoke('save_conversation', { conversation: toStored(conv) }).catch(console.error)
  }, [])

  const scheduleSave = useCallback((convs: Conversation[], convId: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const conv = convs.find(c => c.id === convId)
      if (conv) persistConversation(conv)
    }, 500)
  }, [persistConversation])

  useEffect(() => {
    const unlisten = listen<AgentEvent>('agent-message', (event) => {
      const { conversation_id, role, content, tool_name, done } = event.payload

      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== conversation_id) return c

          if (role === 'assistant_delta') {
            const msgs = [...c.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant' && last.status === 'running') {
              msgs[msgs.length - 1] = { ...last, content: last.content + content }
            } else {
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content, timestamp: Date.now(), status: 'running' })
            }
            return { ...c, messages: msgs }
          }

          if (role === 'assistant' && done) {
            const msgs = [...c.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant' && last.status === 'running') {
              msgs[msgs.length - 1] = { ...last, content: content || last.content, status: 'done' as const }
            } else {
              msgs.push({ id: crypto.randomUUID(), role: 'assistant', content, timestamp: Date.now(), status: 'done' as const })
            }
            return { ...c, messages: msgs }
          }

          return {
            ...c,
            messages: [...c.messages, {
              id: crypto.randomUUID(),
              role: role as Message['role'],
              content,
              timestamp: Date.now(),
              toolName: tool_name,
              status: done ? 'done' as const : 'running' as const,
            }],
          }
        })

        scheduleSave(updated, conversation_id)
        return updated
      })
    })
    return () => { unlisten.then(fn => fn()) }
  }, [scheduleSave])

  const handleNew = useCallback(() => {
    setActiveId(null)
    setShowOutput(false)
    setShowSettings(false)
  }, [])

  const handleDelete = useCallback((id: string) => {
    invoke('delete_conversation', { id }).catch(console.error)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) setActiveId(null)
  }, [activeId])

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    let convId = activeId
    if (!convId) {
      convId = crypto.randomUUID()
      const conv: Conversation = {
        id: convId,
        title: text.slice(0, 40),
        createdAt: Date.now(),
        messages: [userMsg],
      }
      setConversations(prev => {
        const updated = [conv, ...prev]
        persistConversation(conv)
        return updated
      })
      setActiveId(convId)
    } else {
      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== convId) return c
          const title = c.messages.length === 0 ? text.slice(0, 40) : c.title
          const upd = { ...c, title, messages: [...c.messages, userMsg] }
          persistConversation(upd)
          return upd
        })
        return updated
      })
    }

    try {
      await invoke('send_message', { conversationId: convId, prompt: text })
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: Date.now(),
      }
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c
        const upd = { ...c, messages: [...c.messages, errMsg] }
        persistConversation(upd)
        return upd
      }))
    }
  }, [activeId, persistConversation])

  const handleChangeModel = useCallback(async (provider: string, model: string) => {
    if (!settings) return
    const updated = { ...settings, active_provider: provider, active_model: model }
    setSettings(updated)
    try {
      await invoke('save_settings_cmd', { newSettings: updated })
    } catch (err) {
      console.error('Failed to save model selection:', err)
    }
  }, [settings])

  return (
    <div className="flex h-screen bg-white text-[#1a1a1a]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setShowSettings(false) }}
        onNew={handleNew}
        onDelete={handleDelete}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 flex min-w-0">
        {showSettings ? (
          <SettingsPage onClose={() => {
            setShowSettings(false)
            invoke<AppSettings>('get_settings').then(setSettings)
          }} />
        ) : (
          <>
            <ChatView
              conversation={active}
              onSend={handleSend}
              onToggleOutput={() => setShowOutput(!showOutput)}
              settings={settings}
              onChangeModel={handleChangeModel}
              onOpenSettings={() => setShowSettings(true)}
            />
            {showOutput && <OutputPanel conversation={active} />}
          </>
        )}
      </div>
    </div>
  )
}
