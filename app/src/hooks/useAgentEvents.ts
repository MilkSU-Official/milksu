import { useEffect } from 'react'
import i18next from 'i18next'
import { listenEvent } from '../tauri'
import { mergePanelUpdate } from './useConversations'
import type { Conversation, Message, SubagentResult, TaskType } from '../types'

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

interface SubagentsStartEvent {
  conversationId: string
  count: number
}

interface SubagentDeltaEvent {
  conversationId: string
  subId: number
  content: string
}

interface SubagentsDoneEvent {
  conversationId: string
  results: SubagentResult[]
}

function findSubagentMessageIndex(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (
      message.role === 'tool' &&
      message.toolName === 'spawn_subagents' &&
      (message.status === 'running' || (message.subagentResults?.length ?? 0) === 0)
    ) {
      return i
    }
  }
  return -1
}

function formatSubagentResults(results: SubagentResult[]) {
  const sorted = [...results].sort((a, b) => a.subId - b.subId)
  return [
    i18next.t('chat.subagents.results'),
    ...sorted.map(result => [
      i18next.t('chat.subagents.resultTitle', { index: result.subId + 1 }),
      result.content || i18next.t('chat.subagents.noResult'),
    ].join('\n')),
  ].join('\n\n')
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

          if (role === 'tool') {
            const msgs = [...c.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'tool' && last.toolName === tool_name && last.status === 'running') {
              msgs[msgs.length - 1] = {
                ...last,
                content: content || last.content,
                status: done ? 'done' as const : 'running' as const,
              }
            } else {
              msgs.push({
                id: crypto.randomUUID(),
                role: 'tool',
                content,
                timestamp: Date.now(),
                toolName: tool_name,
                status: done ? 'done' as const : 'running' as const,
              })
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

  useEffect(() => {
    const unlistenStart = listenEvent<SubagentsStartEvent>('subagents-start', (event) => {
      const { conversationId, count } = event.payload

      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== conversationId) return c
          const msgs = [...c.messages]
          const index = findSubagentMessageIndex(msgs)
          const message: Message = {
            id: index >= 0 ? msgs[index]!.id : crypto.randomUUID(),
            role: 'tool',
            content: i18next.t('chat.subagents.spawning', { count }),
            timestamp: index >= 0 ? msgs[index]!.timestamp : Date.now(),
            toolName: 'spawn_subagents',
            status: 'running',
            subagentCount: count,
            subagentResults: [],
          }

          if (index >= 0) {
            msgs[index] = { ...msgs[index], ...message }
          } else {
            msgs.push(message)
          }
          return { ...c, messages: msgs }
        })

        scheduleSave(updated, conversationId)
        return updated
      })
    })

    const unlistenDelta = listenEvent<SubagentDeltaEvent>('subagent-delta', (event) => {
      const { conversationId, subId, content } = event.payload

      setConversations(prev => prev.map(c => {
        if (c.id !== conversationId) return c
        const msgs = [...c.messages]
        const index = findSubagentMessageIndex(msgs)
        if (index < 0) return c

        const message = msgs[index]!
        const results = [...(message.subagentResults ?? [])]
        const existing = results.findIndex(result => result.subId === subId)
        if (existing >= 0) {
          results[existing] = {
            ...results[existing]!,
            content: `${results[existing]!.content ?? ''}${content}`,
          }
        } else {
          results.push({ subId, content })
        }

        msgs[index] = { ...message, subagentResults: results }
        return { ...c, messages: msgs }
      }))
    })

    const unlistenDone = listenEvent<SubagentsDoneEvent>('subagents-done', (event) => {
      const { conversationId, results } = event.payload

      setConversations(prev => {
        const updated = prev.map(c => {
          if (c.id !== conversationId) return c
          const msgs = [...c.messages]
          const index = findSubagentMessageIndex(msgs)
          const content = formatSubagentResults(results)
          const message: Message = {
            id: index >= 0 ? msgs[index]!.id : crypto.randomUUID(),
            role: 'tool',
            content,
            timestamp: index >= 0 ? msgs[index]!.timestamp : Date.now(),
            toolName: 'spawn_subagents',
            status: 'done',
            subagentCount: results.length,
            subagentResults: results,
          }

          if (index >= 0) {
            msgs[index] = { ...msgs[index], ...message }
          } else {
            msgs.push(message)
          }
          return { ...c, messages: msgs }
        })

        scheduleSave(updated, conversationId)
        return updated
      })
    })

    return () => {
      unlistenStart.then(fn => fn())
      unlistenDelta.then(fn => fn())
      unlistenDone.then(fn => fn())
    }
  }, [setConversations, scheduleSave])
}
