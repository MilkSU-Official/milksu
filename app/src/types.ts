export type TaskType = 'chat' | 'pentest' | 'ctf' | 'recon' | 'reverse'

export interface TaskTypeInfo {
  id: TaskType
  label: string
  description: string
  color: string
  phases?: string[]
}

export const TASK_TYPES: TaskTypeInfo[] = [
  { id: 'chat', label: 'Chat', description: 'General conversation', color: 'neutral' },
  {
    id: 'pentest',
    label: 'Pentest',
    description: 'Penetration testing workflow',
    color: 'red',
    phases: ['Recon', 'Scanning', 'Enumeration', 'Exploitation', 'Post-Exploitation', 'Reporting'],
  },
  {
    id: 'ctf',
    label: 'CTF',
    description: 'Capture the flag challenge',
    color: 'purple',
    phases: ['Analysis', 'Research', 'Exploitation', 'Flag'],
  },
  {
    id: 'recon',
    label: 'Recon',
    description: 'Network reconnaissance and OSINT',
    color: 'blue',
    phases: ['Passive', 'Active', 'Enumeration', 'Report'],
  },
  {
    id: 'reverse',
    label: 'Reverse',
    description: 'Binary analysis and reverse engineering',
    color: 'amber',
    phases: ['Triage', 'Static Analysis', 'Dynamic Analysis', 'Documentation'],
  },
]

export interface PentestState {
  target: string
  phase: number
  vulnerabilities: { severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; title: string; detail?: string }[]
  ports: { port: number; service: string; state: string }[]
  tools_used: string[]
}

export interface CtfState {
  challenge: string
  category: string
  points: number | null
  flags: string[]
  hints: string[]
  solved: boolean
}

export interface ReconState {
  scope: string[]
  hosts: { ip: string; hostname?: string; os?: string }[]
  ports: { host: string; port: number; service: string; version?: string }[]
  findings: string[]
}

export interface ReverseState {
  binary: string
  arch: string
  protections: { nx: boolean; canary: boolean; pie: boolean; relro: string }
  functions: { name: string; address: string; note?: string }[]
  findings: string[]
}

export type TaskState = PentestState | CtfState | ReconState | ReverseState

export const EMPTY_PENTEST: PentestState = { target: '', phase: 0, vulnerabilities: [], ports: [], tools_used: [] }
export const EMPTY_CTF: CtfState = { challenge: '', category: '', points: null, flags: [], hints: [], solved: false }
export const EMPTY_RECON: ReconState = { scope: [], hosts: [], ports: [], findings: [] }
export const EMPTY_REVERSE: ReverseState = { binary: '', arch: '', protections: { nx: false, canary: false, pie: false, relro: 'none' }, functions: [], findings: [] }

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
  taskType: TaskType
  taskState?: TaskState
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
