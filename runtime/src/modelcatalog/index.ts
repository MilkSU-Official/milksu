import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../config/settings-store.ts'
import { TOKENFLUX_ACCOUNT_URL } from '../config/settings-store.ts'
import { resolveModelContextWindow, resolveModelMaxTokens, resolveSettingsContextWindow } from './context-window.ts'
import { describeImageModel, imageTransport, isImageModelID, type ImageGenSnapshot } from './imagegen.ts'

export { describeImageModel, imageTransport, isImageModelID, IMAGEGEN_SCHEMA } from './imagegen.ts'
export type { ImageGenModel, ImageGenSnapshot } from './imagegen.ts'

export const PROVIDER_TOKENFLUX = 'tokenflux'
export const CATALOG_SCHEMA = 'milksu-model-catalog/v1'
const PUBLIC_TOKENFLUX_CATALOG_URL = 'https://tokenflux.dev/v1/models'
const DEFAULT_MAX_TOKENS = 32_768
const MAX_CATALOG_RESPONSE_BYTES = 8 << 20

export const CREDENTIAL_SOURCE_ACCOUNT = 'account'
export const CREDENTIAL_SOURCE_PERSONAL = 'personal'
export const CREDENTIAL_SOURCE_MERGED = 'merged'
export const CREDENTIAL_SOURCE_PUBLIC = 'public'
export const CREDENTIAL_SOURCE_BUNDLED = 'bundled'

export type CatalogModel = {
  id: string
  name: string
  context_window: number
  max_tokens: number
  input: string[]
  image_transport?: string
}

export type CatalogSnapshot = {
  schema: string
  provider: string
  models: CatalogModel[]
  refreshed_at?: string
  source: string
  credential_source: string
  key_shape?: string
  account_model_ids?: string[]
  image_models?: CatalogModel[]
  account_image_model_ids?: string[]
}

type CatalogCandidate = {
  url: string
  key: string
  credentialSource: string
}

export class ModelCatalogService {
  readonly cachePath: string
  private snapshot: CatalogSnapshot
  private readonly settings: () => AppSettings
  private readonly now: () => Date
  private readonly publicCatalogURL: string
  private readonly fetchImpl: typeof fetch

  constructor(options: {
    dataDirectory: string
    settings: () => AppSettings
    now?: () => Date
    publicCatalogURL?: string
    fetchImpl?: typeof fetch
  }) {
    this.cachePath = join(options.dataDirectory, 'services', 'model-catalog', 'tokenflux.json')
    this.settings = options.settings
    this.now = options.now ?? (() => new Date())
    this.publicCatalogURL = String(options.publicCatalogURL ?? '').trim() || PUBLIC_TOKENFLUX_CATALOG_URL
    this.fetchImpl = options.fetchImpl ?? fetch
    this.snapshot = fallbackSnapshot()
  }

  static async open(dataDirectory: string, settings: () => AppSettings): Promise<ModelCatalogService> {
    const service = new ModelCatalogService({ dataDirectory, settings })
    try {
      service.snapshot = await readSnapshot(service.cachePath)
      service.snapshot.source = 'cache'
      applyKnownContextWindows(service.snapshot.models, {})
    } catch {
      await writeSnapshot(service.cachePath, service.snapshot)
    }
    return service
  }

  current(): CatalogSnapshot {
    const next = cloneSnapshot(this.snapshot)
    applyKnownContextWindows(next.models, this.settings())
    return next
  }

  imageCatalog(): ImageGenSnapshot {
    return {
      schema: 'milksu-imagegen-catalog/v1',
      models: (this.current().image_models ?? [])
        .filter((item) => String(item.image_transport ?? '').trim())
        .map((item) => describeImageModel(item.id, item.name)),
    }
  }

  async refresh(): Promise<CatalogSnapshot> {
    const candidates = catalogCandidates(this.settings(), this.publicCatalogURL)
    const failures: Error[] = []
    let merged: CatalogModel[] = []
    let mergedImage: CatalogModel[] = []
    let accountIDs: string[] = []
    let accountImageIDs: string[] = []
    const sources: string[] = []
    const shapes: string[] = []
    let usedCredential = false
    for (const candidate of candidates) {
      if (candidate.credentialSource === CREDENTIAL_SOURCE_PUBLIC && usedCredential) continue
      try {
        const { chat, image } = await this.fetchCatalog(candidate)
        const shape = detectKeyShape([...chat, ...image])
        if (candidate.credentialSource === CREDENTIAL_SOURCE_ACCOUNT || candidate.credentialSource === CREDENTIAL_SOURCE_PERSONAL) {
          usedCredential = true
          sources.push(candidate.credentialSource)
          shapes.push(shape)
          if (candidate.credentialSource === CREDENTIAL_SOURCE_ACCOUNT) {
            accountIDs = modelIDs(chat)
            accountImageIDs = modelIDs(image)
          }
          merged = mergeModels(merged, chat)
          mergedImage = mergeModels(mergedImage, image)
          continue
        }
        if (merged.length === 0 && mergedImage.length === 0) {
          const next: CatalogSnapshot = {
            schema: CATALOG_SCHEMA,
            provider: PROVIDER_TOKENFLUX,
            models: chat,
            image_models: image,
            refreshed_at: this.now().toISOString(),
            source: 'remote',
            credential_source: candidate.credentialSource,
            key_shape: shape,
          }
          await this.persist(next)
          return cloneSnapshot(next)
        }
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (merged.length > 0 || mergedImage.length > 0) {
      const next: CatalogSnapshot = {
        schema: CATALOG_SCHEMA,
        provider: PROVIDER_TOKENFLUX,
        models: merged,
        image_models: mergedImage,
        refreshed_at: this.now().toISOString(),
        source: 'remote',
        credential_source: mergeCredentialSources(sources),
        key_shape: mergeKeyShapes(shapes),
        account_model_ids: accountIDs,
        account_image_model_ids: accountImageIDs,
      }
      await this.persist(next)
      return cloneSnapshot(next)
    }
    if (failures.length === 0) throw new Error('no model catalog endpoint is available')
    throw new Error(`refresh TokenFlux model catalog: ${failures.map((item) => item.message).join('; ')}`)
  }

  private async persist(next: CatalogSnapshot): Promise<void> {
    applyKnownContextWindows(next.models, {})
    await writeSnapshot(this.cachePath, next)
    this.snapshot = next
  }

  private async fetchCatalog(candidate: CatalogCandidate): Promise<{ chat: CatalogModel[]; image: CatalogModel[] }> {
    let parsed: URL
    try {
      parsed = new URL(candidate.url)
    } catch {
      throw new Error('model catalog endpoint is invalid')
    }
    if (!parsed.protocol || !parsed.host) throw new Error('model catalog endpoint is invalid')
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'MilkSU/model-catalog',
    }
    if (candidate.key) headers.Authorization = `Bearer ${candidate.key}`
    const response = await this.fetchImpl(parsed.toString(), { headers, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) throw new Error(`model catalog returned HTTP ${response.status}`)
    const raw = Buffer.from(await response.arrayBuffer())
    if (raw.length > MAX_CATALOG_RESPONSE_BYTES) throw new Error('model catalog returned invalid JSON')
    const payload = JSON.parse(raw.toString('utf8')) as { data?: Array<Record<string, unknown>> }
    const models = normalizeModels(payload.data ?? [])
    annotateImageTransports(models)
    return splitImageTransports(models)
  }
}

function catalogCandidates(settings: AppSettings, publicURL: string): CatalogCandidate[] {
  const result: CatalogCandidate[] = []
  const seen = new Set<string>()
  const add = (baseURL: string, key: string, credentialSource: string, alreadyCatalogURL: boolean) => {
    baseURL = String(baseURL ?? '').trim()
    if (!baseURL) return
    const catalogURL = alreadyCatalogURL ? baseURL : `${baseURL.replace(/\/$/u, '')}/models`
    key = String(key ?? '').trim()
    const identity = `${catalogURL}\0${key}`
    if (seen.has(identity)) return
    seen.add(identity)
    result.push({ url: catalogURL, key, credentialSource })
  }
  if (settings.relay?.enabled && settings.relay.key) {
    add(String(settings.relay.url ?? '').trim() || TOKENFLUX_ACCOUNT_URL, settings.relay.key, CREDENTIAL_SOURCE_ACCOUNT, false)
  }
  const provider = settings.providers?.[PROVIDER_TOKENFLUX]
  if (provider?.enabled && provider.api_key) {
    add(String(provider.base_url ?? '').trim() || TOKENFLUX_ACCOUNT_URL, provider.api_key, CREDENTIAL_SOURCE_PERSONAL, false)
  }
  add(publicURL, '', CREDENTIAL_SOURCE_PUBLIC, true)
  return result
}

function normalizeModels(values: Array<Record<string, unknown>>): CatalogModel[] {
  const result: CatalogModel[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const id = String(value.id ?? '').trim()
    if (!id || id.length > 256 || seen.has(id) || /[\0\r\n\t ]/u.test(id)) continue
    const kind = String(value.type ?? '').trim()
    if (kind && kind !== 'chat' && kind !== 'model') continue
    const architecture = (value.architecture ?? {}) as { input_modalities?: string[] }
    const input = normalizeInput(architecture.input_modalities ?? [])
    if (!input.includes('text')) continue
    const catalogWindow = Number(value.context_length || value.context_window || 0)
    const catalogMax = Number(value.max_tokens || value.max_output_tokens || 0)
    let maxTokens = resolveModelMaxTokens(id, catalogMax)
    if (maxTokens <= 0) maxTokens = DEFAULT_MAX_TOKENS
    let name = String(value.name ?? '').trim() || String(value.display_name ?? '').trim() || id
    seen.add(id)
    result.push({
      id,
      name,
      context_window: resolveModelContextWindow(id, catalogWindow),
      max_tokens: maxTokens,
      input,
    })
  }
  result.sort((left, right) => {
    const leftPriority = modelPriority(left.id)
    const rightPriority = modelPriority(right.id)
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return left.id.localeCompare(right.id)
  })
  return result
}

function annotateImageTransports(models: CatalogModel[]): void {
  for (const model of models) {
    const transport = imageTransport(model.id)
    if (transport) model.image_transport = transport
  }
}

function splitImageTransports(models: CatalogModel[]): { chat: CatalogModel[]; image: CatalogModel[] } {
  const chat: CatalogModel[] = []
  const image: CatalogModel[] = []
  for (const model of models) {
    if (String(model.image_transport ?? '').trim()) image.push(model)
    else chat.push(model)
  }
  return { chat, image }
}

function normalizeInput(values: string[]): string[] {
  const result: string[] = []
  for (const value of values) {
    const next = String(value ?? '').trim().toLowerCase()
    if ((next === 'text' || next === 'image') && !result.includes(next)) result.push(next)
  }
  if (!result.includes('text')) result.unshift('text')
  if (!result.includes('image')) result.push('image')
  return result
}

function modelPriority(id: string): number {
  const prefixes = ['x-ai/grok-', 'grok-', 'openai/', 'anthropic/', 'deepseek/', 'google/', 'qwen/', 'bailian/', 'dashscope/']
  const index = prefixes.findIndex((prefix) => id.startsWith(prefix))
  if (index >= 0) return index
  return id.includes('/') ? 50 : 100
}

function detectKeyShape(models: CatalogModel[]): string {
  if (!models.length) return 'unknown'
  const prefixed = models.filter((model) => isCompositeCatalogID(model.id)).length
  if (prefixed === models.length) return 'composite'
  if (prefixed === 0) return 'single'
  return 'mixed'
}

function isCompositeCatalogID(id: string): boolean {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash >= id.length - 1) return false
  const prefix = id.slice(0, slash)
  if (prefix.length > 32) return false
  return /^[A-Za-z0-9_-]+$/u.test(prefix)
}

function mergeModels(base: CatalogModel[], extra: CatalogModel[]): CatalogModel[] {
  const seen = new Set<string>()
  const result: CatalogModel[] = []
  for (const model of [...base, ...extra]) {
    const id = String(model.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(model)
  }
  result.sort((left, right) => {
    const leftPriority = modelPriority(left.id)
    const rightPriority = modelPriority(right.id)
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return left.id.localeCompare(right.id)
  })
  return result
}

function modelIDs(models: CatalogModel[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const model of models) {
    const id = String(model.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function mergeCredentialSources(sources: string[]): string {
  const hasAccount = sources.includes(CREDENTIAL_SOURCE_ACCOUNT)
  const hasPersonal = sources.includes(CREDENTIAL_SOURCE_PERSONAL)
  if (hasAccount && hasPersonal) return CREDENTIAL_SOURCE_MERGED
  if (hasAccount) return CREDENTIAL_SOURCE_ACCOUNT
  if (hasPersonal) return CREDENTIAL_SOURCE_PERSONAL
  return CREDENTIAL_SOURCE_PUBLIC
}

function mergeKeyShapes(shapes: string[]): string {
  const seen = new Set(shapes.filter((shape) => shape && shape !== 'unknown'))
  if (seen.size === 0) return 'unknown'
  if (seen.size === 1) return [...seen][0]!
  return 'mixed'
}

async function readSnapshot(path: string): Promise<CatalogSnapshot> {
  const value = JSON.parse(await readFile(path, 'utf8')) as CatalogSnapshot
  const combined = [...(value.models ?? []), ...(value.image_models ?? [])]
  annotateImageTransports(combined)
  const split = splitImageTransports(combined)
  value.models = split.chat
  value.image_models = split.image
  const ids = splitImageIDLists(value.account_model_ids ?? [], value.account_image_model_ids ?? [])
  value.account_model_ids = ids.chat
  value.account_image_model_ids = ids.image
  if (value.schema !== CATALOG_SCHEMA || value.provider !== PROVIDER_TOKENFLUX
    || (value.models.length === 0 && (value.image_models?.length ?? 0) === 0)
    || !validCredentialSource(value.credential_source)) {
    throw new Error('cached model catalog is incomplete')
  }
  if (!value.key_shape) value.key_shape = detectKeyShape([...(value.models ?? []), ...(value.image_models ?? [])])
  return value
}

function splitImageIDLists(chatIDs: string[], imageIDs: string[]): { chat: string[]; image: string[] } {
  const image = [...imageIDs]
  const seen = new Set(image.map((id) => id.trim()))
  const chat: string[] = []
  for (const raw of chatIDs) {
    const id = raw.trim()
    if (!id) continue
    if (isImageModelID(id)) {
      if (!seen.has(id)) {
        image.push(id)
        seen.add(id)
      }
      continue
    }
    chat.push(id)
  }
  return { chat, image }
}

async function writeSnapshot(path: string, value: CatalogSnapshot): Promise<void> {
  const data = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.model-catalog-${process.pid}-${Date.now()}`)
  await writeFile(temporary, data, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

function fallbackSnapshot(): CatalogSnapshot {
  const models: CatalogModel[] = [
    { id: 'x-ai/grok-4.6', name: 'Grok 4.6', context_window: 500_000, max_tokens: 500_000, input: ['text', 'image'] },
    { id: 'x-ai/grok-4.5', name: 'Grok 4.5', context_window: 500_000, max_tokens: 500_000, input: ['text', 'image'] },
    { id: 'grok-4.3', name: 'Grok 4.3', context_window: 1_000_000, max_tokens: 30_000, input: ['text', 'image'] },
    { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', context_window: 1_050_000, max_tokens: 128_000, input: ['text', 'image'] },
    { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', context_window: 1_050_000, max_tokens: 128_000, input: ['text', 'image'] },
    { id: 'anthropic/claude-fable-5-1', name: 'Claude Fable 5.1', context_window: 1_000_000, max_tokens: 128_000, input: ['text', 'image'] },
    { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', context_window: 1_000_000, max_tokens: 128_000, input: ['text', 'image'] },
    { id: 'deepseek/deepseek-flash', name: 'DeepSeek V4.1 Flash', context_window: 1_000_000, max_tokens: 393_216, input: ['text', 'image'] },
    { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', context_window: 1_000_000, max_tokens: 393_216, input: ['text', 'image'] },
    { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', context_window: 1_048_576, max_tokens: 65_536, input: ['text', 'image'] },
    { id: 'qwen/qwen3.8-flash', name: 'Qwen3.8 Flash', context_window: 1_000_000, max_tokens: 131_072, input: ['text', 'image'] },
  ]
  return {
    schema: CATALOG_SCHEMA,
    provider: PROVIDER_TOKENFLUX,
    models,
    source: 'bundled',
    credential_source: CREDENTIAL_SOURCE_BUNDLED,
    key_shape: detectKeyShape(models),
  }
}

function validCredentialSource(value: string): boolean {
  return [
    CREDENTIAL_SOURCE_ACCOUNT,
    CREDENTIAL_SOURCE_PERSONAL,
    CREDENTIAL_SOURCE_MERGED,
    CREDENTIAL_SOURCE_PUBLIC,
    CREDENTIAL_SOURCE_BUNDLED,
  ].includes(value)
}

function applyKnownContextWindows(models: CatalogModel[], settings: AppSettings): void {
  for (const model of models) {
    const resolved = resolveModelContextWindow(model.id, model.context_window)
    model.context_window = resolveSettingsContextWindow(settings, PROVIDER_TOKENFLUX, model.id, resolved)
    model.max_tokens = resolveModelMaxTokens(model.id, model.max_tokens)
  }
}

function cloneSnapshot(value: CatalogSnapshot): CatalogSnapshot {
  return structuredClone(value)
}
