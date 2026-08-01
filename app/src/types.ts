export type MessageRole = 'user' | 'assistant' | 'tool'

export interface CodingAttachment {
  id: string
  name: string
  mediaType: string
  size: number
  sha256: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  toolName?: string
  status?: 'running' | 'done'
  approvalRequestId?: string
  approvalInput?: string
  approvalState?: 'pending' | 'approved' | 'denied' | 'expired'
  approvalReason?: string
  attachments?: CodingAttachment[]
}

export type CodingExecutionMode = 'plan' | 'go'
export type CodingApprovalPolicy =
  | 'read-only'
  | 'ask'
  | 'workspace-auto'
  | 'full-auto'
export type CodingCapabilityStatus = 'allowed' | 'blocked' | 'approval-required' | 'unavailable'

export interface CodingCapability {
  id: string
  label: string
  status: CodingCapabilityStatus
  detail: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  workspacePath?: string
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  agentTools?: string[]
  agentExtensions?: string[]
  agentSkills?: string[]
  agentCapabilities?: CodingCapability[]
  ctfJobId?: string
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  messages: Message[]
}

export interface CTFChatAction {
  kind: 'orient' | 'hint' | 'replan' | 'handoff'
  prompt: string
  level?: 1 | 2
}

export interface ProviderConfig {
  api_key: string
  has_api_key: boolean
  session_only?: boolean
  remove_api_key?: boolean
  base_url?: string
  enabled: boolean
}

export interface RelayConfig {
  enabled: boolean
  url: string
  key: string
  has_key: boolean
  session_only?: boolean
  remove_key?: boolean
}

export interface NSSCTFArenaConfig {
  token: string
  has_token: boolean
  session_only?: boolean
  remove_token?: boolean
}

export interface ModelVerification {
  provider: string
  model: string
  verified_at: string
}

export interface ModelSelection {
  provider: string
  model: string
}

export interface ModelRoutingConfig {
  default_mode: 'auto' | 'manual'
  fast: ModelSelection
  deep: ModelSelection
}

export interface AppSettings {
  active_provider: string
  active_model: string
  model_routing: ModelRoutingConfig
  model_verification?: ModelVerification
  relay?: RelayConfig
  nssctf_arena?: NSSCTFArenaConfig
  locale?: 'en' | 'zh'
  providers: Record<string, ProviderConfig>
}

export const DEFAULT_MODEL_ROUTING: ModelRoutingConfig = {
  default_mode: 'auto',
  fast: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  deep: { provider: 'kourichat', model: 'kimi-k3' },
}

export function withAppSettingsDefaults(value: AppSettings): AppSettings {
  const legacy = value as AppSettings & {
    model_routing?: Partial<ModelRoutingConfig>
    providers?: Record<string, ProviderConfig>
  }
  const routing = legacy.model_routing
  const fast = routing?.fast
  const deep = routing?.deep
  return {
    ...value,
    active_provider: value.active_provider || 'deepseek',
    active_model: value.active_model || 'deepseek-v4-flash',
    model_routing: {
      default_mode: routing?.default_mode === 'manual' ? 'manual' : 'auto',
      fast: fast?.provider && fast.model
        ? fast
        : { ...DEFAULT_MODEL_ROUTING.fast },
      deep: deep?.provider && deep.model
        ? deep
        : { ...DEFAULT_MODEL_ROUTING.deep },
    },
    providers: legacy.providers ?? {},
  }
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

export interface ModelProbeResult {
  provider: string
  model: string
  ready: boolean
  latencyMs: number
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
  kind: 'official' | 'relay'
  models: string[]
  envKey: string
  placeholder: string
  defaultBaseUrl: string
  summary: string
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'official',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    envKey: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    defaultBaseUrl: 'https://api.deepseek.com',
    summary: '快速执行、代码迭代与连续工具调用',
  },
  {
    id: 'kourichat',
    name: 'KouriChat',
    kind: 'relay',
    models: ['kimi-k3'],
    envKey: 'KOURICHAT_API_KEY',
    placeholder: 'sk-...',
    defaultBaseUrl: 'https://api.kourichat.com/v1',
    summary: 'Kimi K3 · 深度策略、卡关复盘与复杂推理',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'official',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
    envKey: 'ANTHROPIC_API_KEY',
    placeholder: 'sk-ant-...',
    defaultBaseUrl: 'https://api.anthropic.com',
    summary: '通用推理与编码',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'official',
    models: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    envKey: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
    defaultBaseUrl: 'https://api.openai.com/v1',
    summary: '通用推理与编码',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'official',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash'],
    envKey: 'GEMINI_API_KEY',
    placeholder: 'AI...',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    summary: '长上下文与多模态任务',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'official',
    models: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b'],
    envKey: 'GROQ_API_KEY',
    placeholder: 'gsk_...',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    summary: '低延迟开源模型推理',
  },
]

export const PROVIDER_GROUPS = [
  {
    kind: 'official' as const,
    label: '原厂',
    providers: PROVIDERS.filter(provider => provider.kind === 'official'),
  },
  {
    kind: 'relay' as const,
    label: '中转站',
    providers: PROVIDERS.filter(provider => provider.kind === 'relay'),
  },
]

export function providerModelLabel(provider: string, model: string) {
  const info = PROVIDERS.find(item => item.id === provider)
  const displayModel = model === 'kimi-k3'
    ? 'Kimi K3'
    : model === 'deepseek-v4-flash'
      ? 'DeepSeek V4 Flash'
      : model
  return `${info?.name ?? provider} · ${displayModel}`
}
