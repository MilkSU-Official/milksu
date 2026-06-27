import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { OutputPanel } from './components/OutputPanel'
import type { Conversation, Message } from './types'

interface AgentEvent {
  conversation_id: string
  role: string
  content: string
  tool_name?: string
  done?: boolean
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showOutput, setShowOutput] = useState(false)

  const active = conversations.find(c => c.id === activeId) ?? null

  useEffect(() => {
    const unlisten = listen<AgentEvent>('agent-message', (event) => {
      const { conversation_id, role, content, tool_name, done } = event.payload
      const msg: Message = {
        id: crypto.randomUUID(),
        role: role as Message['role'],
        content,
        timestamp: Date.now(),
        toolName: tool_name,
        status: done ? 'done' : 'running',
      }
      setConversations(prev => prev.map(c => {
        if (c.id !== conversation_id) return c
        return { ...c, messages: [...c.messages, msg] }
      }))
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  const handleNew = useCallback(() => {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: 'New conversation',
      createdAt: Date.now(),
      messages: [],
    }
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
  }, [])

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
      setConversations(prev => [conv, ...prev])
      setActiveId(convId)
    } else {
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c
        const title = c.messages.length === 0 ? text.slice(0, 40) : c.title
        return { ...c, title, messages: [...c.messages, userMsg] }
      }))
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
        return { ...c, messages: [...c.messages, errMsg] }
      }))
    }
  }, [activeId])

  return (
    <div className="flex h-screen bg-white text-[#1a1a1a]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
      />
      <div className="flex-1 flex min-w-0">
        <ChatView
          conversation={active}
          onSend={handleSend}
          onToggleOutput={() => setShowOutput(!showOutput)}
        />
        {showOutput && <OutputPanel conversation={active} />}
      </div>
    </div>
  )
}
