import { useCallback, useRef, useState } from 'react'
import { invokeCommand } from '../tauri'
import type { Conversation, Message } from '../types'

function normalizeConversation(raw: Record<string, unknown>): Conversation {
  const messages = (raw.messages as Record<string, unknown>[] | undefined) ?? []
  return {
    id: raw.id as string,
    title: raw.title as string,
    createdAt: (raw.createdAt as number) ?? 0,
    messages: messages.map(message => ({
      id: message.id as string,
      role: message.role as Message['role'],
      content: message.content as string,
      timestamp: message.timestamp as number,
      toolName: message.toolName as string | undefined,
      status: (message.status as Message['status']) ?? 'done',
    })),
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = conversations.find(conversation => conversation.id === activeId) ?? null

  const persistConversation = useCallback((conversation: Conversation) => {
    invokeCommand('save_conversation', { conversation }).catch(console.error)
  }, [])

  const scheduleSave = useCallback((items: Conversation[], conversationId: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const conversation = items.find(item => item.id === conversationId)
      if (conversation) persistConversation(conversation)
    }, 500)
  }, [persistConversation])

  const loadConversations = useCallback(() => {
    invokeCommand<Record<string, unknown>[]>('list_conversations').then(stored => {
      setConversations(stored.map(normalizeConversation))
    })
  }, [])

  const deleteConversation = useCallback((id: string) => {
    invokeCommand('delete_conversation', { id }).catch(console.error)
    setConversations(previous => previous.filter(conversation => conversation.id !== id))
    if (activeIdRef.current === id) setActiveId(null)
  }, [])

  const updateConversation = useCallback((id: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations(previous => previous.map(conversation => {
      if (conversation.id !== id) return conversation
      const updated = updater(conversation)
      persistConversation(updated)
      return updated
    }))
  }, [persistConversation])

  return {
    conversations,
    setConversations,
    active,
    activeId,
    setActiveId,
    persistConversation,
    scheduleSave,
    loadConversations,
    deleteConversation,
    updateConversation,
  }
}
