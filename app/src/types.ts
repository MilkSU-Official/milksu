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
  toolCallId?: string
  durationMs?: number
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

export type CodingGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usage_limited'
  | 'budget_limited'
  | 'complete'
  | 'queued'

export interface CodingGoalState {
  id: string
  text: string
  status: CodingGoalStatus
  startedAt: number
  updatedAt: number
  iteration: number
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
  automaticModelTurns: number
  queuedCount: number
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
  mcpServers?: string[]
  mcpConfigDigest?: string
  agentTools?: string[]
  agentExtensions?: string[]
  agentSkills?: string[]
  agentCapabilities?: CodingCapability[]
  agentGoal?: CodingGoalState
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
  vision?: ModelSelection
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
      vision: routing?.vision?.provider && routing.vision.model
        ? routing.vision
        : undefined,
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

export type DatabaseCompatibilityState = 'compatible' | 'missing' | 'newer' | 'corrupt' | 'remaining'

export interface DatabaseCompatibilityStatus {
  logicalName: string
  relativePath: string
  current?: number
  supported?: number
  state: DatabaseCompatibilityState
  error?: string
}

export interface LocalDataStatus {
  directory: string
  fileCount: number
  bytes: number
  lastModifiedAt?: string
  databases?: DatabaseCompatibilityStatus[]
}

export interface LocalDataBackupExport {
  path: string
  createdAt: string
  fileCount: number
  bytes: number
  credentialsIncluded: boolean
  cancelled?: boolean
}

export interface LocalDataBackupRestore {
  createdAt: string
  fileCount: number
  bytes: number
  requiresRestart: boolean
  cancelled?: boolean
}

export interface LocalDiagnosticExport {
  path: string
  generatedAt: string
  bytes: number
  eventCount: number
  cancelled?: boolean
}

export type PreviousExitState = 'none' | 'clean' | 'abnormal'

/**
 * 启动/退出状态摘要：由桌面端在启动时读取上次 lifespan 标记后返回。
 * 不含会话正文、工具输出或任何凭据，只有时间戳、退出分类、进程号与连续异常次数。
 */
export interface StartupRecoveryStatus {
  previousExit: PreviousExitState
  previousStartedAt?: string
  lastCleanExitAt?: string
  consecutiveAbnormalExits: number
  previousPid?: number
  startedAt: string
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
  visionModels: string[]
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
    visionModels: [],
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
    visionModels: [],
    envKey: 'KOURICHAT_API_KEY',
    placeholder: 'sk-...',
    defaultBaseUrl: 'https://api.kourichat.com/v1',
    summary: 'Kimi K3 · 深度策略、卡关复盘与复杂推理',
  },
  {
    id: 'tokenflux',
    name: 'TokenFlux',
    kind: 'relay',
    models: [
      'x-ai/grok-4.3',
      'x-ai/grok-4.5',
      'x-ai/grok-build-0.1',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.2-codex',
      'anthropic/claude-sonnet-4.6',
      'deepseek/deepseek-v4-flash',
      'google/gemini-3.1-pro-preview',
      'qwen/qwen3-coder-plus',
    ],
    visionModels: ['openai/gpt-4o', 'openai/gpt-4.1', 'google/gemini-3.1-flash-image'],
    envKey: 'TOKENFLUX_API_KEY',
    placeholder: 'tf_... 或 TokenFlux API Key',
    defaultBaseUrl: 'https://tokenflux.ai/v1',
    summary: '词元流动 · Grok、Claude、OpenAI、DeepSeek 等统一网关',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'official',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
    visionModels: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
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
    visionModels: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
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
    visionModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash'],
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
    visionModels: [],
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
  const displayModel = ({
    'kimi-k3': 'Kimi K3',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'x-ai/grok-4.3': 'Grok 4.3',
    'x-ai/grok-4.5': 'Grok 4.5',
    'x-ai/grok-build-0.1': 'Grok Build 0.1',
    'openai/gpt-5.6-sol': 'GPT-5.6 Sol',
    'openai/gpt-5.2-codex': 'GPT-5.2 Codex',
    'openai/gpt-4o': 'GPT-4o',
    'openai/gpt-4.1': 'GPT-4.1',
    'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
    'deepseek/deepseek-v4-flash': 'DeepSeek V4 Flash',
    'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'google/gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
    'qwen/qwen3-coder-plus': 'Qwen3 Coder Plus',
  } as Record<string, string>)[model] ?? model
  return `${info?.name ?? provider} · ${displayModel}`
}
