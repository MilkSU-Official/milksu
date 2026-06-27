export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  toolName?: string
  status?: 'running' | 'done'
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  messages: Message[]
}
