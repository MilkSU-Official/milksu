import { useEffect } from 'react'
import { listenEvent } from '../desktop'
import type { Conversation, Message } from '../types'

interface AgentEvent {
  schemaVersion: number
  engine: string
  sessionId?: string
  type: string
  text?: string
  toolName?: string
  error?: string
  done?: boolean
}

export function useAgentEvents(
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>,
  scheduleSave: (conversations: Conversation[], conversationId: string) => void,
) {
  useEffect(() => {
    const unlisten = listenEvent<AgentEvent>('engine-event', event => {
      const { sessionId, type, text = '', toolName, error, done } = event.payload
      if (!sessionId) return

      setConversations(previous => {
        const updated = previous.map(conversation => {
          if (conversation.id !== sessionId) return conversation

          if (type === 'assistant.delta') {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant' && last.status === 'running') {
              messages[messages.length - 1] = { ...last, content: last.content + text }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: text,
                timestamp: Date.now(),
                status: 'running',
              })
            }
            return { ...conversation, messages }
          }

          if (type === 'assistant.completed') {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant' && last.status === 'running') {
              messages[messages.length - 1] = {
                ...last,
                content: text || last.content,
                status: 'done',
              }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: text,
                timestamp: Date.now(),
                status: 'done',
              })
            }
            return { ...conversation, messages }
          }

          if (type === 'tool.started' || type === 'tool.completed') {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'tool' && last.toolName === toolName && last.status === 'running') {
              messages[messages.length - 1] = {
                ...last,
                content: text || last.content,
                status: type === 'tool.completed' || done ? 'done' : 'running',
              }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'tool',
                content: text,
                timestamp: Date.now(),
                toolName,
                status: type === 'tool.completed' || done ? 'done' : 'running',
              })
            }
            return { ...conversation, messages }
          }

          if (type === 'engine.error') {
            return {
              ...conversation,
              messages: [...conversation.messages, {
                id: crypto.randomUUID(),
                role: 'assistant' as Message['role'],
                content: `Error: ${error ?? 'Agent engine failed'}`,
                timestamp: Date.now(),
                status: 'done' as const,
              }],
            }
          }

          return conversation
        })

        scheduleSave(updated, sessionId)
        return updated
      })
    })

    return () => {
      unlisten.then(dispose => dispose())
    }
  }, [scheduleSave, setConversations])
}
