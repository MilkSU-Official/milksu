import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { migrateAcpAgents, resolveAcpAgent, stripSecrets, type AcpAgentConfig } from '../settings.ts'
import { configDirectory, credentialsDatabasePath, settingsPath } from '../home.ts'
import {
  deleteSecretIfPresent,
  SqliteSecretStore,
  type SecretStore,
} from './secret-store.ts'
import {
  DarwinKeychainSecretStore,
  logDarwinKeychainFallback,
  usesDarwinKeychain,
} from '../native/keychain.ts'
import { exportSidecarProviderEnvironment } from './sidecar-provider-env.ts'

export const RELAY_SECRET_ACCOUNT = 'relay'
export const JEV_SECRET_ACCOUNT = 'jev'
export const PROVIDER_ACCOUNT_PREFIX = 'provider:'
export const TOKENFLUX_ACCOUNT_URL = 'https://tokenflux.dev/v1'
export const PRESET_DEEPSEEK_SERVICE_ID = 'custom-relay-deepseek'
export const PRESET_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const MODEL_SOURCE_ACCOUNT = 'account'
export const MODEL_SOURCE_PERSONAL = 'personal'

const EXTERNAL_EDITORS = new Set([
  'vscode',
  'cursor',
  'windsurf',
  'zed',
  'trae',
  'vscode-insiders',
  'sublime',
  'webstorm',
  'idea',
])

export type ProviderConfig = {
  api_key?: string
  has_api_key?: boolean
  session_only?: boolean
  remove_api_key?: boolean
  base_url?: string | null
  enabled?: boolean
  custom?: boolean
  name?: string
  models?: string[]
  api?: string
}

export type RelayConfig = {
  enabled?: boolean
  url?: string
  key?: string
  has_key?: boolean
  session_only?: boolean
  remove_key?: boolean
}

export type JevConfig = {
  api_key?: string
  has_api_key?: boolean
  remove_api_key?: boolean
  session_only?: boolean
}

export type AppSettings = {
  active_provider?: string
  active_model?: string
  default_kernel?: string
  acp_agent?: AcpAgentConfig | null
  acp_agents?: import('../settings.ts').NamedAcpAgent[]
  default_acp_agent_id?: string
  runtime_versions?: Record<string, string>
  busy_send?: string
  computer_use_enabled?: boolean | null
  browser_use_enabled?: boolean | null
  coding_browser_enabled?: boolean | null
  model_verification?: { provider?: string; model?: string; verified_at?: string } | null
  model_failures?: Array<{ provider?: string; model?: string; reason?: string; at?: string }>
  model_routing?: { source_order?: string[]; auto_fallback?: boolean | null }
  relay?: RelayConfig | null
  locale?: string | null
  disabled_skills?: string[]
  disabled_account_models?: string[]
  enabled_optional_skills?: string[]
  worker_provider?: string
  worker_model?: string
  worker_source?: string
  companion_provider?: string
  companion_model?: string
  companion_source?: string
  companion_dispatch_enabled?: boolean | null
  companion_memory_enabled?: boolean | null
  companion_float_enabled?: boolean | null
  companion_skin_id?: string
  companion_proactivity?: {
    task_events?: boolean | null
    teaching_hints?: boolean | null
    scheduled_broadcast?: boolean | null
    idle_chat?: boolean | null
  }
  task_notify?: {
    needs_input?: boolean | null
    failed?: boolean | null
    completed?: boolean | null
    stalled?: boolean | null
    sound?: boolean | null
  }
  companion_teaching?: string
  companion_reply_style?: string
  imagegen_provider?: string
  imagegen_model?: string
  imagegen_source?: string
  companion_memory_extract?: string
  companion_memory_extract_idle_minutes?: number
  jev?: JevConfig | null
  preferred_external_editor?: string
  conversation_font_size?: string
  sidebar_project_fold_limit?: number
  ui_emphasis?: string
  security_tools?: Record<string, { enabled?: boolean }>
  model_thinking?: Record<string, Record<string, { enabled?: boolean; levels?: string[]; default_level?: string }>>
  model_context_windows?: Record<string, Record<string, number>>
  lab?: { android_sdk?: string; java_home?: string; auto_create_avd?: boolean | null } | null
  providers?: Record<string, ProviderConfig>
  removed_preset_services?: string[]
  [key: string]: unknown
}

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function providerSecretAccount(name: string): string {
  return PROVIDER_ACCOUNT_PREFIX + name
}

export function defaultDeepSeekProvider(): ProviderConfig {
  return {
    enabled: false,
    custom: true,
    name: 'DeepSeek',
    base_url: PRESET_DEEPSEEK_BASE_URL,
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  }
}

export function defaultSettings(): AppSettings {
  return {
    active_provider: PRESET_DEEPSEEK_SERVICE_ID,
    active_model: 'deepseek-flash',
    default_kernel: 'pi',
    busy_send: 'interrupt',
    model_routing: {
      source_order: [MODEL_SOURCE_ACCOUNT, MODEL_SOURCE_PERSONAL],
      auto_fallback: false,
    },
    providers: {
      [PRESET_DEEPSEEK_SERVICE_ID]: defaultDeepSeekProvider(),
    },
  }
}

export function normalizeBusySend(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'queue':
    case 'queued':
    case '排队':
      return 'queue'
    default:
      return 'interrupt'
  }
}

export function normalizeDefaultKernel(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'dsh':
    case 'acp':
    case 'deepseek':
    case 'deepseek-harness':
      return 'dsh'
    default:
      return 'pi'
  }
}

export function normalizeUiFontSize(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/px$/u, '').trim()
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 11 || n > 18) return '14'
  return String(n)
}

export function normalizeSidebarProjectFoldLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(n) || n < 1 || n > 20) return 5
  return n
}

export function normalizeUiEmphasis(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'blue':
      return 'blue'
    case 'violet':
    case 'purple':
    case 'indigo':
      return 'violet'
    case 'teal':
    case 'cyan':
    case 'green':
      return 'teal'
    case 'amber':
    case 'orange':
    case 'yellow':
      return 'amber'
    case 'rose':
    case 'pink':
    case 'red':
      return 'rose'
    default:
      return 'default'
  }
}

function normalizeModelSourceOrder(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const source = String(item ?? '').trim()
    if ((source !== MODEL_SOURCE_ACCOUNT && source !== MODEL_SOURCE_PERSONAL) || seen.has(source)) continue
    seen.add(source)
    result.push(source)
  }
  for (const source of [MODEL_SOURCE_ACCOUNT, MODEL_SOURCE_PERSONAL]) {
    if (!seen.has(source)) result.push(source)
  }
  return result
}

function normalizeDisabledSkills(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const name = String(item ?? '').trim()
    if (!name || name.length > 64 || seen.has(name)) continue
    if (name.startsWith('-') || name.endsWith('-')) continue
    if (!/^[a-z0-9-]+$/u.test(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

const OPTIONAL_CODING_SKILLS = new Set(['ghidra-rpc', 'jadx'])

function normalizeEnabledOptionalSkills(value: unknown): string[] {
  return normalizeDisabledSkills(value).filter((name) => OPTIONAL_CODING_SKILLS.has(name))
}

function normalizeDisabledAccountModels(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const id = String(item ?? '').trim()
    if (!id || id.length > 256 || seen.has(id) || /[\0\r\n]/u.test(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length === 256) break
  }
  return result
}

function normalizeRemovedPresetServices(value: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const name = String(item ?? '').trim()
    if (name !== PRESET_DEEPSEEK_SERVICE_ID || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function normalizeCustomModels(values: unknown): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(values) ? values : []) {
    const model = String(item ?? '').trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    result.push(model)
  }
  return result
}

function validCustomProviderId(value: string): boolean {
  return value.startsWith('custom-relay-') && value.length <= 64 && /^[a-z0-9-]+$/u.test(value)
}

function productProviderSelectable(value: AppSettings, id: string): boolean {
  if (id === 'tokenflux') return true
  const provider = value.providers?.[id]
  return Boolean(provider?.custom)
}

function fallbackProductSelection(value: AppSettings): { provider: string; model: string } {
  if (value.providers?.[PRESET_DEEPSEEK_SERVICE_ID]) {
    return { provider: PRESET_DEEPSEEK_SERVICE_ID, model: 'deepseek-flash' }
  }
  return { provider: 'tokenflux', model: 'x-ai/grok-4.6' }
}

function ensurePresetServices(value: AppSettings): AppSettings {
  if (!value.providers) value.providers = {}
  if ((value.removed_preset_services ?? []).includes(PRESET_DEEPSEEK_SERVICE_ID)) return value
  if (value.providers[PRESET_DEEPSEEK_SERVICE_ID]) return value
  let customCount = 0
  for (const provider of Object.values(value.providers)) {
    if (provider.custom) customCount += 1
  }
  if (customCount >= 8) return value
  value.providers[PRESET_DEEPSEEK_SERVICE_ID] = defaultDeepSeekProvider()
  return value
}

function normalizeCompanionSkinId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!id || id.toLowerCase() === 'default') return 'default'
  if (id.includes('..') || /[/\\]/u.test(id)) return 'default'
  if (id.startsWith('imported:')) {
    const rest = id.slice('imported:'.length)
    if (!rest || rest === 'default') return 'default'
    return id
  }
  if (id.startsWith('plugin:')) {
    const rest = id.slice('plugin:'.length)
    if (!rest) return 'default'
    return id
  }
  return 'default'
}

function normalizeCompanionTeaching(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'hints':
    case 'hint':
      return 'hints'
    case 'review':
    case 'retro':
      return 'review'
    default:
      return 'ask_me'
  }
}

function normalizeCompanionReplyStyle(value: unknown): string {
  return String(value ?? '').trim() === 'chat' ? 'chat' : 'markdown'
}

function normalizeCompanionMemoryExtract(value: unknown): string {
  const raw = String(value ?? '').trim()
  return raw === 'off' || raw === 'idle' ? raw : 'turn'
}

function normalizeCompanionMemoryExtractIdleMinutes(value: unknown): number {
  switch (Number(value)) {
    case 5:
    case 10:
    case 15:
    case 30:
    case 60:
      return Number(value)
    default:
      return 10
  }
}

function isImageModelId(id: string): boolean {
  const slash = id.indexOf('/')
  if (slash <= '-image'.length || slash >= id.length - 1) return false
  if (/[ \t\r\n\0]/u.test(id)) return false
  const vendor = id.slice(0, slash)
  return vendor.endsWith('-image') && vendor.length > '-image'.length
}

function normalizeImageGenSettings(value: AppSettings): AppSettings {
  let provider = String(value.imagegen_provider ?? '').trim()
  const model = String(value.imagegen_model ?? '').trim()
  let source = String(value.imagegen_source ?? '').trim()
  if (!provider && !model && !source) {
    value.imagegen_provider = ''
    value.imagegen_model = ''
    value.imagegen_source = ''
    return value
  }
  if (!provider) provider = 'tokenflux'
  if (!model || !isImageModelId(model)) {
    value.imagegen_provider = ''
    value.imagegen_model = ''
    value.imagegen_source = ''
    return value
  }
  if (source !== MODEL_SOURCE_ACCOUNT && source !== MODEL_SOURCE_PERSONAL && source !== 'service') {
    source = provider === 'tokenflux' ? MODEL_SOURCE_ACCOUNT : 'service'
  }
  value.imagegen_provider = provider
  value.imagegen_model = model
  value.imagegen_source = source
  return value
}

function normalizeWorkerModel(value: AppSettings): AppSettings {
  const provider = String(value.worker_provider ?? '').trim()
  const model = String(value.worker_model ?? '').trim()
  let source = String(value.worker_source ?? '').trim()
  if (!provider || !model) {
    value.worker_provider = ''
    value.worker_model = ''
    value.worker_source = ''
    return value
  }
  if (source !== MODEL_SOURCE_ACCOUNT && source !== MODEL_SOURCE_PERSONAL && source !== 'service') {
    source = provider === 'tokenflux' ? MODEL_SOURCE_PERSONAL : 'service'
  }
  value.worker_provider = provider
  value.worker_model = model
  value.worker_source = source
  return value
}

function normalizeCompanionSettings(value: AppSettings): AppSettings {
  let provider = String(value.companion_provider ?? '').trim()
  let model = String(value.companion_model ?? '').trim()
  let usedFactory = false
  if (!provider || !model) {
    provider = 'tokenflux'
    model = 'deepseek/deepseek-flash'
    usedFactory = true
  }
  let source = String(value.companion_source ?? '').trim()
  if (source !== MODEL_SOURCE_ACCOUNT && source !== MODEL_SOURCE_PERSONAL && source !== 'service') {
    if (usedFactory) source = MODEL_SOURCE_ACCOUNT
    else source = provider === 'tokenflux' ? MODEL_SOURCE_PERSONAL : 'service'
  }
  value.companion_provider = provider
  value.companion_model = model
  value.companion_source = source
  if (value.companion_dispatch_enabled == null) value.companion_dispatch_enabled = true
  if (value.companion_memory_enabled == null) value.companion_memory_enabled = true
  if (value.companion_float_enabled == null) value.companion_float_enabled = true
  value.companion_skin_id = normalizeCompanionSkinId(value.companion_skin_id)
  value.companion_proactivity = {
    task_events: value.companion_proactivity?.task_events ?? true,
    teaching_hints: value.companion_proactivity?.teaching_hints ?? false,
    scheduled_broadcast: value.companion_proactivity?.scheduled_broadcast ?? false,
    idle_chat: value.companion_proactivity?.idle_chat ?? false,
  }
  value.task_notify = {
    needs_input: value.task_notify?.needs_input ?? false,
    failed: value.task_notify?.failed ?? false,
    completed: value.task_notify?.completed ?? false,
    stalled: value.task_notify?.stalled ?? false,
    sound: value.task_notify?.sound ?? false,
  }
  value.companion_teaching = normalizeCompanionTeaching(value.companion_teaching)
  value.companion_reply_style = normalizeCompanionReplyStyle(value.companion_reply_style)
  value.companion_memory_extract = normalizeCompanionMemoryExtract(value.companion_memory_extract)
  value.companion_memory_extract_idle_minutes = normalizeCompanionMemoryExtractIdleMinutes(
    value.companion_memory_extract_idle_minutes,
  )
  return value
}

function normalizeLabConfig(value: AppSettings['lab']): AppSettings['lab'] {
  return {
    android_sdk: String(value?.android_sdk ?? '').trim(),
    java_home: String(value?.java_home ?? '').trim(),
    auto_create_avd: value?.auto_create_avd ?? true,
  }
}

function normalizeSecurityToolPreferences(
  value: AppSettings['security_tools'],
): AppSettings['security_tools'] {
  if (!value || typeof value !== 'object') return undefined
  const result: Record<string, { enabled?: boolean }> = {}
  for (const [rawId, preference] of Object.entries(value)) {
    const id = rawId.trim()
    if (!id || id.length > 64 || !/^[a-z0-9-]+$/u.test(id)) continue
    result[id] = { enabled: Boolean(preference?.enabled) }
  }
  return Object.keys(result).length ? result : undefined
}

function normalizePreferredExternalEditor(value: unknown): string {
  const id = String(value ?? '').trim().toLowerCase()
  return EXTERNAL_EDITORS.has(id) ? id : 'vscode'
}

function migrateAcpAgent(value: AppSettings): boolean {
  const extra = value as AppSettings & Record<string, unknown>
  const hadLegacy = extra.acp_guest != null || extra.AcpGuest != null
    || (extra.acp_agent != null && extra.acp_agents == null)
  migrateAcpAgents(extra)
  return hadLegacy
}

export function withDefaults(value: AppSettings): AppSettings {
  const next = clone(value ?? {})
  const defaults = defaultSettings()
  if (!next.active_provider) next.active_provider = defaults.active_provider
  if (!next.active_model) next.active_model = defaults.active_model
  migrateAcpAgent(next)
  next.default_kernel = normalizeDefaultKernel(next.default_kernel)
  if (next.default_kernel === 'dsh' && !resolveAcpAgent(next)) next.default_kernel = 'pi'
  next.busy_send = normalizeBusySend(next.busy_send)
  if (!next.providers) next.providers = {}
  for (const [id, provider] of Object.entries(next.providers)) {
    if (!provider.custom) continue
    provider.name = String(provider.name ?? '').trim()
    provider.models = normalizeCustomModels(provider.models)
    next.providers[id] = provider
  }
  next.removed_preset_services = normalizeRemovedPresetServices(next.removed_preset_services)
  ensurePresetServices(next)
  const active = String(next.active_provider ?? '').trim()
  if (!productProviderSelectable(next, active)) {
    const fallback = fallbackProductSelection(next)
    next.active_provider = fallback.provider
    const model = String(next.active_model ?? '').trim()
    if (
      !model
      || active.toLowerCase() === 'deepseek'
      || model.toLowerCase().startsWith('deepseek')
      || ['openai', 'anthropic', 'google', 'groq', 'mistral'].includes(active.toLowerCase())
    ) {
      next.active_model = fallback.model
    }
  }
  next.model_routing = {
    source_order: normalizeModelSourceOrder(next.model_routing?.source_order),
    auto_fallback: next.model_routing?.auto_fallback ?? false,
  }
  next.disabled_skills = normalizeDisabledSkills(next.disabled_skills)
  next.disabled_account_models = normalizeDisabledAccountModels(next.disabled_account_models)
  next.enabled_optional_skills = normalizeEnabledOptionalSkills(next.enabled_optional_skills)
  normalizeWorkerModel(next)
  normalizeCompanionSettings(next)
  normalizeImageGenSettings(next)
  next.preferred_external_editor = normalizePreferredExternalEditor(next.preferred_external_editor)
  next.conversation_font_size = normalizeUiFontSize(next.conversation_font_size)
  next.sidebar_project_fold_limit = normalizeSidebarProjectFoldLimit(next.sidebar_project_fold_limit)
  next.ui_emphasis = normalizeUiEmphasis(next.ui_emphasis)
  next.security_tools = normalizeSecurityToolPreferences(next.security_tools)
  next.lab = normalizeLabConfig(next.lab)
  return next
}

function validateSecretInput(value: string): void {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('must not contain NUL or newline characters')
  }
}

function validateProviderBaseUrl(value: string): void {
  if (value.length > 2048) throw new Error('must be at most 2048 characters')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('must be a valid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('must use http or https')
  }
  if (!parsed.host) throw new Error('must include a host')
  if (parsed.username || parsed.password) throw new Error('must not include credentials')
}

function validateAccountModelUrl(value: string): void {
  validateProviderBaseUrl(value)
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new Error('must use https')
  if (parsed.toString().replace(/\/$/u, '') !== TOKENFLUX_ACCOUNT_URL) {
    throw new Error(`must use ${TOKENFLUX_ACCOUNT_URL}`)
  }
}

function validateCustomProviders(value: AppSettings): void {
  let count = 0
  for (const [id, provider] of Object.entries(value.providers ?? {})) {
    if (!provider.custom) continue
    count += 1
    if (count > 8) throw new Error('at most 8 custom relays may be configured')
    if (!validCustomProviderId(id)) throw new Error(`custom relay id ${JSON.stringify(id)} is invalid`)
    const name = String(provider.name ?? '')
    if (!name || [...name].length > 64 || /[\0\r\n]/u.test(name)) {
      throw new Error(`custom relay ${id} name must be 1 to 64 characters`)
    }
    const baseUrl = String(provider.base_url ?? '').trim()
    if (!baseUrl) throw new Error(`custom relay ${id} Base URL is required`)
    try {
      validateProviderBaseUrl(baseUrl)
    } catch (error) {
      throw new Error(`custom relay ${id} Base URL: ${error instanceof Error ? error.message : error}`)
    }
    const models = provider.models ?? []
    if (models.length === 0) throw new Error(`custom relay ${id} needs at least one model id`)
    if (models.length > 32) throw new Error(`custom relay ${id} may contain at most 32 models`)
    const api = String(provider.api ?? '').trim()
    if (api && api !== 'openai-completions' && api !== 'anthropic-messages' && api !== 'google-generative-ai') {
      throw new Error(`custom relay ${id} protocol ${JSON.stringify(api)} is not supported`)
    }
    for (const model of models) {
      if ([...model].length > 256 || /[\0\r\n]/u.test(model)) {
        throw new Error(`custom relay ${id} has an invalid model id`)
      }
    }
  }
  const active = value.providers?.[String(value.active_provider ?? '')]
  if (active?.custom) {
    if (!(active.models ?? []).includes(String(value.active_model ?? ''))) {
      throw new Error(`active model is not configured for custom relay ${value.active_provider}`)
    }
  }
}

function publicSettings(value: AppSettings): AppSettings {
  const next = stripSecrets(clone(value)) as AppSettings
  const migrated = migrateAcpAgents(next)
  if (migrated.derived) next.acp_agent = migrated.derived
  else delete next.acp_agent
  return next
}

function withoutSessionCredentials(value: AppSettings): AppSettings {
  const next = clone(value)
  for (const [name, provider] of Object.entries(next.providers ?? {})) {
    if (provider.session_only) {
      provider.has_api_key = false
      provider.session_only = false
      next.providers![name] = provider
    }
  }
  if (next.relay?.session_only) {
    next.relay.has_key = false
    next.relay.session_only = false
  }
  return next
}

function stripPersistSecrets(value: AppSettings): AppSettings {
  const next = withoutSessionCredentials(value)
  delete next.runtime_versions
  delete next.acp_agent
  delete (next as AppSettings & Record<string, unknown>).acp_guest
  delete (next as AppSettings & Record<string, unknown>).AcpGuest
  for (const provider of Object.values(next.providers ?? {})) {
    delete provider.api_key
    delete provider.remove_api_key
  }
  if (next.relay) {
    delete next.relay.key
    delete next.relay.remove_key
  }
  if (next.jev) {
    delete next.jev.api_key
    delete next.jev.remove_api_key
  }
  return next
}

async function writePrivateFile(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.milksu-${process.pid}-${Date.now()}`)
  try {
    await writeFile(temporary, data, { mode: 0o600 })
    try {
      await chmod(temporary, 0o600)
    } catch {
      // Windows file mode is best-effort.
    }
    await rename(temporary, path)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // ignore
    }
    throw error
  }
}

async function persistSettings(path: string, value: AppSettings): Promise<void> {
  const data = `${JSON.stringify(stripPersistSecrets(value), null, 2)}\n`
  await writePrivateFile(path, data)
}

export type SettingsStoreOptions = {
  home: string
  secrets?: SecretStore
  platform?: NodeJS.Platform
}

export class SettingsStore {
  private readonly mutex = new Mutex()
  private readonly path: string
  private readonly secrets: SecretStore
  private secretValues = new Map<string, string>()
  private settings: AppSettings = defaultSettings()

  constructor(path: string, secrets: SecretStore) {
    this.path = path
    this.secrets = secrets
  }

  static async open(options: SettingsStoreOptions): Promise<SettingsStore> {
    const home = options.home
    await mkdir(configDirectory(home), { recursive: true, mode: 0o700 })
    const secrets = options.secrets ?? await createDefaultSecretStore(options)
    const store = new SettingsStore(settingsPath(home), secrets)
    await store.load()
    return store
  }

  get(): AppSettings {
    return publicSettings(withDefaults(clone(this.settings)))
  }

  secretStore(): SecretStore {
    return this.secrets
  }

  getResolved(): AppSettings {
    return this.hydrateSecrets(withDefaults(clone(this.settings)), true)
  }

  exportSidecarEnvironment(): string[] {
    return exportSidecarProviderEnvironment(this.getResolved())
  }

  resolveSubmitted(submitted: AppSettings): AppSettings {
    const hasProvider = String(submitted?.active_provider ?? '').trim() !== ''
    const hasProviders = Object.keys(submitted?.providers ?? {}).length > 0
    if (!hasProvider && !hasProviders) {
      return this.hydrateSecrets(withDefaults(clone(this.settings)), true)
    }
    return this.hydrateSecrets(withDefaults(clone(submitted)), false)
  }

  setSecurityToolEnabled(id: string, enabled: boolean): Promise<void> {
    return this.mutex.run(async () => {
      const toolId = String(id ?? '').trim()
      if (!toolId || toolId.length > 64 || !/^[a-z0-9-]+$/u.test(toolId)) {
        throw new Error('security tool id is invalid')
      }
      const next = withDefaults(clone(this.settings))
      next.security_tools = { ...(next.security_tools ?? {}), [toolId]: { enabled: Boolean(enabled) } }
      await persistSettings(this.path, next)
      this.settings = next
    })
  }

  recordModelVerification(provider: string, model: string, verifiedAt = new Date()): Promise<void> {
    return this.mutex.run(async () => {
      const nextProvider = String(provider ?? '').trim()
      const nextModel = String(model ?? '').trim()
      if (!nextProvider || !nextModel) {
        throw new Error('verified provider and model are required')
      }
      const current = withDefaults(clone(this.settings))
      if (nextProvider !== String(current.active_provider ?? '') || nextModel !== String(current.active_model ?? '')) {
        throw new Error(
          `verified model ${nextProvider}/${nextModel} no longer matches active model ${current.active_provider}/${current.active_model}`,
        )
      }
      current.model_verification = {
        provider: nextProvider,
        model: nextModel,
        verified_at: verifiedAt.toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      }
      await persistSettings(this.path, current)
      this.settings = current
    })
  }

  save(value: AppSettings): Promise<void> {
    return this.mutex.run(() => this.saveLocked(value, false))
  }

  setManagedAccountRelay(baseURL: string, credential: string): Promise<boolean> {
    return this.mutex.run(async () => {
      const url = String(baseURL ?? '').trim()
      const secret = String(credential ?? '').trim()
      validateAccountModelUrl(url)
      validateSecretInput(secret)
      if (!secret) throw new Error('account model credential is required')
      const current = publicSettings(withDefaults(clone(this.settings)))
      const resolved = this.hydrateSecrets(withDefaults(clone(this.settings)), true)
      if (
        current.relay?.enabled
        && current.relay.url === url
        && resolved.relay?.key === secret
        && !current.relay.session_only
      ) {
        return false
      }
      current.relay = { enabled: true, url, key: secret }
      await this.saveLocked(current, false)
      return true
    })
  }

  clearManagedAccountRelay(): Promise<boolean> {
    return this.mutex.run(async () => {
      const current = publicSettings(withDefaults(clone(this.settings)))
      if (!current.relay || (!current.relay.has_key && !current.relay.enabled)) return false
      current.relay.enabled = false
      current.relay.remove_key = true
      await this.saveLocked(current, false)
      return true
    })
  }

  setManagedJevCredential(credential: string): Promise<boolean> {
    return this.mutex.run(async () => {
      const secret = String(credential ?? '').trim()
      validateSecretInput(secret)
      if (!secret) throw new Error('intent credential is required')
      const current = publicSettings(withDefaults(clone(this.settings)))
      const resolved = this.hydrateSecrets(withDefaults(clone(this.settings)), true)
      if (
        current.jev?.has_api_key
        && !current.jev.session_only
        && resolved.jev?.api_key === secret
      ) {
        return false
      }
      current.jev = current.jev ?? {}
      current.jev.api_key = secret
      current.jev.session_only = false
      current.jev.remove_api_key = false
      await this.saveLocked(current, true)
      return true
    })
  }

  clearManagedJevCredential(): Promise<boolean> {
    return this.mutex.run(async () => {
      const current = publicSettings(withDefaults(clone(this.settings)))
      if (!current.jev?.has_api_key) return false
      current.jev.remove_api_key = true
      current.jev.api_key = ''
      await this.saveLocked(current, true)
      return true
    })
  }

  private hydrateSecrets(value: AppSettings, replaceKeys: boolean): AppSettings {
    const providers = value.providers ?? {}
    for (const [name, provider] of Object.entries(providers)) {
      if (replaceKeys || !String(provider.api_key ?? '').trim()) {
        provider.api_key = this.secretValues.get(providerSecretAccount(name)) ?? ''
      }
      providers[name] = provider
    }
    value.providers = providers
    if (value.relay && (replaceKeys || !String(value.relay.key ?? '').trim())) {
      value.relay.key = this.secretValues.get(RELAY_SECRET_ACCOUNT) ?? ''
    }
    if (value.jev && (replaceKeys || !String(value.jev.api_key ?? '').trim())) {
      value.jev.api_key = this.secretValues.get(JEV_SECRET_ACCOUNT) ?? ''
    }
    return value
  }

  private async saveLocked(value: AppSettings, allowJevCredential: boolean): Promise<void> {
    delete value.runtime_versions
    value = withDefaults(value)
    validateCustomProviders(value)
    const secrets = new Map(this.secretValues)
    const persistenceErrors: Error[] = []

    for (const [name, previous] of Object.entries(this.settings.providers ?? {})) {
      if (!previous.custom) continue
      const next = value.providers?.[name]
      if (next?.custom) continue
      const account = providerSecretAccount(name)
      await deleteSecretIfPresent(this.secrets, account)
      secrets.delete(account)
    }

    for (const [name, provider] of Object.entries(value.providers ?? {})) {
      const account = providerSecretAccount(name)
      if (provider.base_url != null) {
        const baseUrl = String(provider.base_url).trim()
        if (!baseUrl) provider.base_url = null
        else {
          try {
            validateProviderBaseUrl(baseUrl)
          } catch (error) {
            throw new Error(`provider ${name} Base URL: ${error instanceof Error ? error.message : error}`)
          }
          provider.base_url = baseUrl
        }
      }
      const apiKey = String(provider.api_key ?? '')
      validateSecretInput(apiKey)
      if (provider.remove_api_key) {
        await deleteSecretIfPresent(this.secrets, account)
        secrets.delete(account)
        provider.session_only = false
      } else if (apiKey) {
        if (provider.session_only) {
          secrets.set(account, apiKey)
        } else {
          try {
            await this.secrets.set(account, apiKey)
            secrets.set(account, apiKey)
            provider.session_only = false
          } catch (error) {
            if (!secrets.get(account)) {
              secrets.set(account, apiKey)
              provider.session_only = true
            }
            persistenceErrors.push(new Error(
              `store provider ${name} credential: ${error instanceof Error ? error.message : error}`,
            ))
          }
        }
      }
      provider.api_key = ''
      provider.remove_api_key = false
      provider.has_api_key = Boolean(secrets.get(account))
      value.providers![name] = provider
    }

    if (value.relay) {
      value.relay.url = String(value.relay.url ?? '').trim() || TOKENFLUX_ACCOUNT_URL
      validateAccountModelUrl(value.relay.url)
      const key = String(value.relay.key ?? '')
      validateSecretInput(key)
      if (value.relay.remove_key) {
        await deleteSecretIfPresent(this.secrets, RELAY_SECRET_ACCOUNT)
        secrets.delete(RELAY_SECRET_ACCOUNT)
        value.relay.session_only = false
      } else if (key) {
        if (value.relay.session_only) {
          secrets.set(RELAY_SECRET_ACCOUNT, key)
        } else {
          try {
            await this.secrets.set(RELAY_SECRET_ACCOUNT, key)
            secrets.set(RELAY_SECRET_ACCOUNT, key)
            value.relay.session_only = false
          } catch (error) {
            if (!secrets.get(RELAY_SECRET_ACCOUNT)) {
              secrets.set(RELAY_SECRET_ACCOUNT, key)
              value.relay.session_only = true
            }
            persistenceErrors.push(new Error(
              `store relay credential: ${error instanceof Error ? error.message : error}`,
            ))
          }
        }
      }
      value.relay.key = ''
      value.relay.remove_key = false
      value.relay.has_key = Boolean(secrets.get(RELAY_SECRET_ACCOUNT))
    }

    if (value.jev && !allowJevCredential) {
      value.jev.api_key = ''
      value.jev.remove_api_key = false
      value.jev.session_only = false
    }
    if (value.jev) {
      value.jev.api_key = String(value.jev.api_key ?? '').trim()
      validateSecretInput(value.jev.api_key)
      if (value.jev.remove_api_key) {
        await deleteSecretIfPresent(this.secrets, JEV_SECRET_ACCOUNT)
        secrets.delete(JEV_SECRET_ACCOUNT)
        value.jev.session_only = false
      } else if (value.jev.api_key) {
        if (value.jev.session_only) {
          secrets.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
        } else {
          try {
            await this.secrets.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
            secrets.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
            value.jev.session_only = false
          } catch (error) {
            if (!secrets.get(JEV_SECRET_ACCOUNT)) {
              secrets.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
              value.jev.session_only = true
            }
            persistenceErrors.push(new Error(
              `store jev credential: ${error instanceof Error ? error.message : error}`,
            ))
          }
        }
      }
      value.jev.api_key = ''
      value.jev.remove_api_key = false
      value.jev.has_api_key = Boolean(secrets.get(JEV_SECRET_ACCOUNT))
    }

    await persistSettings(this.path, value)
    this.settings = clone(value)
    this.secretValues = secrets
    if (persistenceErrors.length) {
      throw new Error(persistenceErrors.map((item) => item.message).join('; '))
    }
  }

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.settings = defaultSettings()
        return
      }
      throw error
    }
    const parsed = JSON.parse(raw) as AppSettings & Record<string, unknown>
    const hadLegacyAgent = parsed.acp_guest != null || parsed.AcpGuest != null
    let value = withDefaults(parsed)
    validateCustomProviders(value)
    let migrated = hadLegacyAgent

    for (const [name, provider] of Object.entries(value.providers ?? {})) {
      const account = providerSecretAccount(name)
      const apiKey = String(provider.api_key ?? '')
      if (apiKey) {
        validateSecretInput(apiKey)
        await this.secrets.set(account, apiKey)
        this.secretValues.set(account, apiKey)
        migrated = true
      } else if (provider.has_api_key) {
        try {
          this.secretValues.set(account, await this.secrets.get(account))
        } catch {
          // missing secret stays absent
        }
      }
      provider.api_key = ''
      provider.remove_api_key = false
      provider.has_api_key = this.secretValues.has(account)
      value.providers![name] = provider
    }

    if (value.relay) {
      const key = String(value.relay.key ?? '')
      if (key) {
        validateSecretInput(key)
        await this.secrets.set(RELAY_SECRET_ACCOUNT, key)
        this.secretValues.set(RELAY_SECRET_ACCOUNT, key)
        migrated = true
      } else if (value.relay.has_key) {
        try {
          this.secretValues.set(RELAY_SECRET_ACCOUNT, await this.secrets.get(RELAY_SECRET_ACCOUNT))
        } catch {
          // missing secret stays absent
        }
      }
      value.relay.key = ''
      value.relay.remove_key = false
      value.relay.has_key = this.secretValues.has(RELAY_SECRET_ACCOUNT)
    }

    if (value.jev) {
      value.jev.api_key = String(value.jev.api_key ?? '').trim()
      if (value.jev.api_key) {
        validateSecretInput(value.jev.api_key)
        await this.secrets.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
        this.secretValues.set(JEV_SECRET_ACCOUNT, value.jev.api_key)
        migrated = true
      } else if (value.jev.has_api_key) {
        try {
          this.secretValues.set(JEV_SECRET_ACCOUNT, await this.secrets.get(JEV_SECRET_ACCOUNT))
        } catch {
          // missing secret stays absent
        }
      }
      value.jev.api_key = ''
      value.jev.remove_api_key = false
      value.jev.has_api_key = this.secretValues.has(JEV_SECRET_ACCOUNT)
    }

    this.settings = value
    if (migrated) await persistSettings(this.path, value)
  }
}

async function createDefaultSecretStore(options: SettingsStoreOptions): Promise<SecretStore> {
  if (usesDarwinKeychain(options.platform)) {
    const keychain = new DarwinKeychainSecretStore(options.home)
    if (keychain.available()) return keychain
    logDarwinKeychainFallback()
  }
  return SqliteSecretStore.open(credentialsDatabasePath(options.home))
}
