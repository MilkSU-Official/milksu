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
  has_api_key: boolean
  remove_api_key?: boolean
  base_url?: string
  enabled: boolean
}

export interface RelayConfig {
  enabled: boolean
  url: string
  key: string
  has_key: boolean
  remove_key?: boolean
}

export interface AppSettings {
  active_provider: string
  active_model: string
  relay?: RelayConfig
  locale?: 'en' | 'zh'
  providers: Record<string, ProviderConfig>
}

export interface UsageData {
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  total_tokens: number | null
  context_limit: number | null
  cost_usd: number | null
  latency_ms: number | null
  model: string | null
  provider: string | null
  tool_call_count: number
  session_start: number | null
  session_duration_ms: number | null
}

export const EMPTY_USAGE: UsageData = {
  input_tokens: null,
  output_tokens: null,
  cache_read_tokens: null,
  total_tokens: null,
  context_limit: null,
  cost_usd: null,
  latency_ms: null,
  model: null,
  provider: null,
  tool_call_count: 0,
  session_start: null,
  session_duration_ms: null,
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
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    envKey: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash'],
    envKey: 'GEMINI_API_KEY',
    placeholder: 'AI...',
  },
  {
    id: 'groq',
    name: 'Groq',
    models: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
    envKey: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
  },
]
