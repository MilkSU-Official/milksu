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

export interface ProviderConfig {
  api_key: string
  base_url?: string
  enabled: boolean
}

export interface AppSettings {
  active_provider: string
  active_model: string
  providers: Record<string, ProviderConfig>
}

export interface ProviderInfo {
  id: string
  name: string
  models: string[]
  envKey: string
  placeholder: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    envKey: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-opus-4-20250514'],
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    envKey: 'GEMINI_API_KEY',
    placeholder: 'AI...',
  },
  {
    id: 'groq',
    name: 'Groq',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    envKey: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
  },
]
