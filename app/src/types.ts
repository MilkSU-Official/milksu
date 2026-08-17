export type MessageRole = 'user' | 'assistant' | 'tool'

export interface AccountStatus {
  configured: boolean
  authenticated: boolean
  state: 'unconfigured' | 'signed_out' | 'authorizing' | 'active' | 'suspended' | 'invitation_required' | 'unavailable'
  user?: {
    githubLogin: string
    displayName: string
    avatarUrl: string
  }
  tokenFluxLinked?: boolean
  /** Main-process local bootstrap before /v1/account confirms; UI should not treat as final. */
  provisional?: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  enabled: boolean
  version?: string
  title?: string
  notes?: string
  releaseDate?: string
  percent?: number
  transferred?: number
  total?: number
  message?: string
}

export interface CodingAttachment {
  id: string
  name: string
  mediaType: string
  size: number
  sha256: string
}

export interface CodingAttachmentImport {
  name: string
  mediaType: string
  dataBase64: string
}

export interface CodingAttachmentPreview {
  name: string
  mediaType: string
  size: number
  kind: 'image' | 'text' | 'metadata'
  dataUrl?: string
  text?: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  toolName?: string
  toolCallId?: string
  durationMs?: number
  status?: 'running' | 'queued' | 'done'
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

export interface CodingProductActionRequest {
  kind: 'understand' | 'test' | 'review' | 'fix' | 'summary'
  specPath?: string
  htmlPath?: string
}
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
  /** Preferred credential source for this conversation; undefined means global order. */
  modelSourcePreference?: ModelSource
  /** Source that actually served the latest model turn. */
  modelSource?: ModelSource
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
  /** Structured CTF/CVE domain snapshot for the shared Coding/Pi panel. */
  domainTaskContext?: import('@/lib/domainTaskContext').DomainTaskContext
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
  custom?: boolean
  name?: string
  models?: string[]
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

export interface ModelCatalogItem {
  id: string
  name: string
  context_window: number
  max_tokens: number
  input: string[]
}

export interface ModelCatalogSnapshot {
  provider: string
  models: ModelCatalogItem[]
  refreshed_at?: string
  source: 'remote' | 'cache' | 'bundled'
  credential_source: 'account' | 'personal' | 'merged' | 'public' | 'bundled'
  /** TokenFlux key shape inferred from /v1/models (single-group, composite, or mixed). */
  key_shape?: 'single' | 'composite' | 'mixed' | 'unknown'
  /** Model ids visible to the account key only when both account and personal catalogs are merged. */
  account_model_ids?: string[]
}

export type ModelSource = 'account' | 'personal'
export type ModelSourcePreference = 'auto' | ModelSource

export interface ModelRoutingConfig {
  source_order: ModelSource[]
  auto_fallback: boolean
}

export interface AppSettings {
  active_provider: string
  active_model: string
  model_verification?: ModelVerification
  model_routing: ModelRoutingConfig
  relay?: RelayConfig
  nssctf_arena?: NSSCTFArenaConfig
  locale?: 'en' | 'zh'
  disabled_skills?: string[]
  security_tools?: Record<string, { enabled: boolean }>
  providers: Record<string, ProviderConfig>
}

export const PRIMARY_MODEL_SELECTION: ModelSelection = {
  provider: 'tokenflux',
  model: 'x-ai/grok-4.6',
}
export const TOKENFLUX_DEFAULT_MODEL = 'x-ai/grok-4.6'

export function withAppSettingsDefaults(value: AppSettings): AppSettings {
  const legacy = value as AppSettings & {
    providers?: Record<string, ProviderConfig>
  }
  const configuredProviders = legacy.providers ?? {}
  const configuredProvider = customProviderInfo(
    value.active_provider,
    configuredProviders[value.active_provider],
  )
  const rawActive = String(value.active_provider ?? '').trim()
  // Stale pre-release official providers (deepseek, openai, …) are not product
  // surfaces; remap them to TokenFlux so Agent turns use an enabled path.
  const providerIsSelectable = selectableProvider(rawActive)
    || Boolean(configuredProvider)
  const activeProvider = providerIsSelectable
    ? rawActive
    : PRIMARY_MODEL_SELECTION.provider
  const activeInfo = providerByID(activeProvider) ?? (
    activeProvider === rawActive ? configuredProvider : null
  )
  const requestedModel = String(value.active_model ?? '').trim()
  const activeModel = !providerIsSelectable
    ? PRIMARY_MODEL_SELECTION.model
    : activeProvider === 'tokenflux'
      ? requestedModel || TOKENFLUX_DEFAULT_MODEL
      : activeInfo?.models.includes(requestedModel)
        ? requestedModel
        : activeInfo?.models[0] ?? PRIMARY_MODEL_SELECTION.model
  return {
    ...value,
    active_provider: activeProvider,
    active_model: activeModel,
    model_routing: normalizeModelRouting(value.model_routing),
    disabled_skills: [...new Set((value.disabled_skills ?? [])
      .map(name => String(name).trim())
      .filter(name => /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)))],
    providers: configuredProviders,
  }
}

export function normalizeModelRouting(value?: Partial<ModelRoutingConfig>): ModelRoutingConfig {
  const sourceOrder: ModelSource[] = []
  for (const source of value?.source_order ?? []) {
    if ((source === 'account' || source === 'personal') && !sourceOrder.includes(source)) {
      sourceOrder.push(source)
    }
  }
  for (const source of ['account', 'personal'] as const) {
    if (!sourceOrder.includes(source)) sourceOrder.push(source)
  }
  return {
    source_order: sourceOrder,
    // Default off: only one enabled service path is used unless the user opts in.
    auto_fallback: value?.auto_fallback ?? false,
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

export interface UserArtifactDirectoryStatus {
  directory: string
}

/**
 * Desktop build provenance shown at the bottom of Settings.
 * Packaged apps expose sealed Resources/build-tracking.json fields.
 * Development/unpackaged shells set development=true and leave git/hash empty.
 * trackingId is a canonical-field integrity digest, not a package signature.
 */
export interface BuildTracking {
  schema?: string
  channel: 'stable' | 'beta' | string
  productName: string
  appId: string
  gitBranch: string
  gitCommit: string
  dirty: boolean
  sourceFingerprint?: string
  buildTime: string
  trackingId: string
  missing?: boolean
  packaged?: boolean
  development?: boolean
  provenanceSource?: string
  validationIssues?: string[]
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

// Built-in product services: only TokenFlux personal relay. Official vendor
// keys are no longer offered in Settings; users add OpenAI-compatible relays.
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'tokenflux',
    name: 'TokenFlux',
    kind: 'relay',
    models: [],
    // grok-4.5 is backed by a packaged-App image-input receipt. Grok 4.6 is
    // intentionally absent here unless the refreshed TokenFlux catalog
    // explicitly reports image input for that exact model.
    visionModels: ['grok-4.5', 'x-ai/grok-4.5'],
    envKey: 'TOKENFLUX_API_KEY',
    placeholder: 'tf_... 或 TokenFlux API Key',
    defaultBaseUrl: 'https://tokenflux.dev/v1',
    summary: '词元流动 · 可使用账户分配模型，也可接入个人 TokenFlux API Key',
  },
]

export const PROVIDER_GROUPS = [
  {
    kind: 'relay' as const,
    label: '中转站',
    providers: PROVIDERS.filter(provider => provider.kind === 'relay'),
  },
]

export function customProviderInfo(
  id: string,
  config?: ProviderConfig,
): ProviderInfo | null {
  if (
    !config?.custom
    || id.length > 64
    || !/^custom-relay-[a-z0-9-]*$/u.test(id)
  ) return null
  const seen = new Set<string>()
  const models = (config.models ?? []).flatMap(value => {
    const model = String(value ?? '').trim()
    if (!model || model.length > 256 || seen.has(model)) return []
    seen.add(model)
    return [model]
  })
  return {
    id,
    name: String(config.name ?? '').trim() || '自定义中转站',
    kind: 'relay',
    models,
    visionModels: [],
    envKey: '',
    placeholder: 'sk-... 或中转站 API Key',
    defaultBaseUrl: String(config.base_url ?? '').trim(),
    summary: '用户配置的 OpenAI-compatible 中转站',
  }
}

function providerByID(id: string) {
  return PROVIDERS.find(provider => provider.id === id)
}

function selectableProvider(id: string) {
  const provider = providerByID(id)
  return Boolean(provider)
}

export function providerModelLabel(provider: string, model: string) {
  const info = PROVIDERS.find(item => item.id === provider)
  const displayModel = ({
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'x-ai/grok-4.6': 'Grok 4.6',
    'x-ai/grok-4.5': 'Grok 4.5',
    'grok-4.3': 'Grok 4.3',
    'grok-4.5': 'Grok 4.5',
    'openai/gpt-5.6-sol': 'GPT-5.6 Sol',
    'openai/gpt-5.2-codex': 'GPT-5.2 Codex',
    'openai/gpt-4o': 'GPT-4o',
    'openai/gpt-4.1': 'GPT-4.1',
    'anthropic/claude-sonnet-4.6': 'Claude Sonnet 4.6',
    'deepseek/deepseek-v4-flash': 'DeepSeek V4 Flash',
    'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
    'google/gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
    'qwen/qwen3.6-27b': 'Qwen 3.6 27B',
    'qwen/qwen3-coder-plus': 'Qwen3 Coder Plus',
  } as Record<string, string>)[model] ?? model
  return `${info?.name ?? provider} · ${displayModel}`
}
