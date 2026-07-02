import { useState, useCallback, useRef } from 'react'
import { invokeCommand } from '../tauri'
import type { Conversation, Message, TaskType, TaskState } from '../types'
import { EMPTY_PENTEST, EMPTY_CTF, EMPTY_RECON, EMPTY_REVERSE } from '../types'

function normalizeConversation(raw: Record<string, unknown>): Conversation {
  const messages = (raw.messages as Record<string, unknown>[] | undefined) ?? []
  return {
    id: raw.id as string,
    title: raw.title as string,
    createdAt: (raw.createdAt as number) ?? 0,
    taskType: ((raw.taskType as TaskType) ?? 'chat'),
    taskState: raw.taskState as Conversation['taskState'],
    engagementId: (raw.engagementId as string | null) ?? null,
    messages: messages.map(m => ({
      id: m.id as string,
      role: m.role as Message['role'],
      content: m.content as string,
      timestamp: m.timestamp as number,
      toolName: m.toolName as string | undefined,
      status: (m.status as Message['status']) ?? 'done',
    })),
  }
}

export function emptyStateFor(taskType: TaskType): TaskState | undefined {
  switch (taskType) {
    case 'pentest': return { ...EMPTY_PENTEST }
    case 'ctf': return { ...EMPTY_CTF }
    case 'recon': return { ...EMPTY_RECON }
    case 'reverse': return { ...EMPTY_REVERSE }
    default: return undefined
  }
}

export function mergePanelUpdate(
  current: TaskState | undefined,
  taskType: TaskType,
  setFields: Record<string, unknown>,
  appendItems: Record<string, unknown[]>,
): TaskState | undefined {
  const base = current ?? emptyStateFor(taskType)
  if (!base) return undefined

  const merged = { ...base } as Record<string, unknown>

  for (const [key, value] of Object.entries(setFields)) {
    merged[key] = value
  }

  for (const [key, items] of Object.entries(appendItems)) {
    const existing = Array.isArray(merged[key]) ? (merged[key] as unknown[]) : []
    merged[key] = [...existing, ...items]
  }

  return merged as unknown as TaskState
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = conversations.find(c => c.id === activeId) ?? null

  const persistConversation = useCallback((conv: Conversation) => {
    invokeCommand('save_conversation', { conversation: conv }).catch(console.error)
  }, [])

  const scheduleSave = useCallback((convs: Conversation[], convId: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const conv = convs.find(c => c.id === convId)
      if (conv) persistConversation(conv)
    }, 500)
  }, [persistConversation])

  const loadConversations = useCallback(() => {
    invokeCommand<Record<string, unknown>[]>('list_conversations').then(stored => {
      setConversations(stored.map(normalizeConversation))
    })
  }, [])

  const deleteConversation = useCallback((id: string) => {
    invokeCommand('delete_conversation', { id }).catch(console.error)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeIdRef.current === id) setActiveId(null)
  }, [])

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== id) return c
      const updated = updater(c)
      persistConversation(updated)
      return updated
    }))
  }, [persistConversation])

  return {
    conversations,
    setConversations,
    active,
    activeId,
    activeIdRef,
    setActiveId,
    persistConversation,
    scheduleSave,
    loadConversations,
    deleteConversation,
    updateConversation,
  }
}
