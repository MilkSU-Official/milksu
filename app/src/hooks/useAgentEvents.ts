import { useEffect } from 'react'
import { listenEvent } from '../tauri'
import { mergePanelUpdate } from './useConversations'
import type { Conversation, Message, TaskType } from '../types'

interface AgentEvent {
  conversation_id: string
  role: string
  content: string
  tool_name?: string
  done?: boolean
}

interface PanelUpdateEvent {
  conversation_id: string
  set_fields: Record<string, unknown>
  append_items: Record<string, unknown[]>
}

export function useAgentEvents(
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>,
  scheduleSave: (convs: Conversation[], convId: string) => void,
  persistConversation: (conv: Conversation) => void,
  activeIdRef: React.RefObject<string | null>,
  setShowTaskPanel: (show: boolean) => void,
) {
  useEffect(() => {
    const unlisten = listenEvent<AgentEvent>('agent-message', (event) => {
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
  }, [setConversations, scheduleSave])

  useEffect(() => {
    const unlisten = listenEvent<PanelUpdateEvent>('panel-update', (event) => {
      const { conversation_id, set_fields, append_items } = event.payload

      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== conversation_id) return c
          const newState = mergePanelUpdate(c.taskState, c.taskType as TaskType, set_fields, append_items)
          return { ...c, taskState: newState }
        })

        const conv = updated.find(c => c.id === conversation_id)
        if (conv) persistConversation(conv)

        return updated
      })

      if (conversation_id === activeIdRef.current) {
        setShowTaskPanel(true)
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [setConversations, persistConversation, activeIdRef, setShowTaskPanel])
}
