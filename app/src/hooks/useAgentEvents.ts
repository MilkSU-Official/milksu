import { useEffect } from 'react'
import { listenEvent } from '../tauri'
import type { Conversation, Message } from '../types'

interface AgentEvent {
  conversation_id: string
  role: string
  content: string
  tool_name?: string
  done?: boolean
}

export function useAgentEvents(
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>,
  scheduleSave: (conversations: Conversation[], conversationId: string) => void,
) {
  useEffect(() => {
    const unlisten = listenEvent<AgentEvent>('agent-message', event => {
      const { conversation_id, role, content, tool_name, done } = event.payload

      setConversations(previous => {
        const updated = previous.map(conversation => {
          if (conversation.id !== conversation_id) return conversation

          if (role === 'assistant_delta') {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant' && last.status === 'running') {
              messages[messages.length - 1] = { ...last, content: last.content + content }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content,
                timestamp: Date.now(),
                status: 'running',
              })
            }
            return { ...conversation, messages }
          }

          if (role === 'assistant' && done) {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'assistant' && last.status === 'running') {
              messages[messages.length - 1] = {
                ...last,
                content: content || last.content,
                status: 'done',
              }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content,
                timestamp: Date.now(),
                status: 'done',
              })
            }
            return { ...conversation, messages }
          }

          if (role === 'tool') {
            const messages = [...conversation.messages]
            const last = messages[messages.length - 1]
            if (last?.role === 'tool' && last.toolName === tool_name && last.status === 'running') {
              messages[messages.length - 1] = {
                ...last,
                content: content || last.content,
                status: done ? 'done' : 'running',
              }
            } else {
              messages.push({
                id: crypto.randomUUID(),
                role: 'tool',
                content,
                timestamp: Date.now(),
                toolName: tool_name,
                status: done ? 'done' : 'running',
              })
            }
            return { ...conversation, messages }
          }

          return {
            ...conversation,
            messages: [...conversation.messages, {
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

    return () => {
      unlisten.then(dispose => dispose())
    }
  }, [scheduleSave, setConversations])
}
