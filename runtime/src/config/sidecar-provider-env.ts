import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDirectory, resolveHomeRoot } from '../home.ts'
import { resolveModelThinking } from '../model-thinking.ts'
import type { AppSettings } from './settings-store.ts'

const MODEL_SOURCE_ACCOUNT = 'account'
const MODEL_SOURCE_PERSONAL = 'personal'
const PRESET_DEEPSEEK_SERVICE_ID = 'custom-relay-deepseek'
const TOKENFLUX_ACCOUNT_URL = 'https://tokenflux.dev/v1'

const PROVIDER_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  tokenflux: 'TOKENFLUX_API_KEY',
  google: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
}

const DSH_PIAI_CATALOG_PROVIDERS = [
  'anthropic',
  'baseten',
  'cerebras',
  'google',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openrouter',
  'together',
  'xai',
  'zai',
  'zai-coding-cn',
]

const OFFICIAL_DEEPSEEK_API_ROOT = 'https://api.deepseek.com'
const SIDECAR_PROVIDER_ENV_SKIP = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
])

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function providerApiKeyEnvironment(provider: string): string | undefined {
  return PROVIDER_KEY_ENV[provider]
}

function officialDeepSeekApi(baseUrl: string): boolean {
  const trimmed = baseUrl.toLowerCase().replace(/\/$/u, '')
  return trimmed === OFFICIAL_DEEPSEEK_API_ROOT
    || trimmed === `${OFFICIAL_DEEPSEEK_API_ROOT}/v1`
    || trimmed === `${OFFICIAL_DEEPSEEK_API_ROOT}/anthropic`
}

function accountRelayReady(settings: AppSettings): boolean {
  const relay = settings.relay
  return Boolean(relay?.enabled && trim(relay.key))
}

function accountModelSourceAvailable(settings: AppSettings): boolean {
  const active = settings.providers?.[trim(settings.active_provider)]
  if (active?.custom) return false
  return accountRelayReady(settings)
}

function personalModelSourceAvailable(settings: AppSettings): boolean {
  const providerId = trim(settings.active_provider)
  const configured = settings.providers?.[providerId]
  if (configured) return Boolean(configured.enabled && trim(configured.api_key))
  const envName = providerApiKeyEnvironment(providerId)
  return Boolean(envName && trim(process.env[envName]))
}

function resolvedModelSourceOrder(settings: AppSettings): string[] {
  const requested = settings.model_routing?.source_order?.length
    ? settings.model_routing.source_order
    : [MODEL_SOURCE_ACCOUNT, MODEL_SOURCE_PERSONAL]
  const available: Record<string, boolean> = {
    [MODEL_SOURCE_ACCOUNT]: accountModelSourceAvailable(settings),
    [MODEL_SOURCE_PERSONAL]: personalModelSourceAvailable(settings),
  }
  const result: string[] = []
  const seen = new Set<string>()
  for (const source of requested) {
    const name = trim(source)
    if (!available[name] || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  for (const source of [MODEL_SOURCE_ACCOUNT, MODEL_SOURCE_PERSONAL]) {
    if (available[source] && !seen.has(source)) result.push(source)
  }
  return result
}

function dshOfficialDeepSeekKey(settings: AppSettings): string {
  const providerId = trim(settings.active_provider)
  const active = settings.providers?.[providerId]
  let key = trim(active?.api_key)
  let id = providerId
  let provider = active
  if (!key) {
    for (const fallbackId of ['deepseek', PRESET_DEEPSEEK_SERVICE_ID]) {
      const fallback = settings.providers?.[fallbackId]
      const fallbackKey = trim(fallback?.api_key)
      if (!fallbackKey) continue
      id = fallbackId
      provider = fallback
      key = fallbackKey
      break
    }
  }
  if (!key) return ''
  const baseUrl = trim(provider?.base_url)
  if (id === 'deepseek' || id === PRESET_DEEPSEEK_SERVICE_ID || officialDeepSeekApi(baseUrl)) {
    return key
  }
  return ''
}

function tokenFluxCompatibleUrl(url: string): boolean {
  return url.toLowerCase().replace(/\/$/u, '') === TOKENFLUX_ACCOUNT_URL
}

function dshCustomTokenFlux(settings: AppSettings): {
  id: string
  key: string
  url: string
  name: string
  models: string[]
} | null {
  const providers = settings.providers ?? {}
  const ordered = [trim(settings.active_provider), ...Object.keys(providers)]
  const seen = new Set<string>()
  for (const id of ordered) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const provider = providers[id]
    if (!provider?.custom || !provider.enabled) continue
    const key = trim(provider.api_key)
    const url = trim(provider.base_url)
    if (!key || !tokenFluxCompatibleUrl(url)) continue
    return {
      id,
      key,
      url,
      name: trim(provider.name) || id,
      models: (provider.models ?? []).map((item) => trim(item)).filter(Boolean),
    }
  }
  return null
}

function dshTokenFluxKey(settings: AppSettings): string {
  const provider = settings.providers?.tokenflux
  if (provider?.enabled && trim(provider.api_key)) return trim(provider.api_key)
  if (settings.relay?.enabled && trim(settings.relay.key)) return trim(settings.relay.key)
  return dshCustomTokenFlux(settings)?.key ?? ''
}

function dshTokenFluxBaseURL(settings: AppSettings): string {
  if (settings.relay?.enabled && trim(settings.relay.url)) return trim(settings.relay.url)
  const custom = dshCustomTokenFlux(settings)
  if (custom) return custom.url
  return TOKENFLUX_ACCOUNT_URL
}

type DshPiAiRoute = {
  api?: string
  baseURL?: string
  apiKeyEnv: string
  displayName?: string
  compat?: {
    supportsDeveloperRole?: boolean
    supportsReasoningEffort?: boolean
    maxTokensField?: string
  }
  models?: Array<{
    id: string
    name?: string
    contextWindow?: number
    maxTokens?: number
    image?: boolean
    reasoningEfforts?: Record<string, string>
  }>
}

function dshReasoningEfforts(
  settings: AppSettings,
  model: string,
): { reasoningEfforts?: Record<string, string> } {
  const thinking = resolveModelThinking(settings, 'tokenflux', model, '')
  if (!thinking.enabled || !thinking.levels?.length) return {}
  const reasoningEfforts: Record<string, string> = {}
  for (const level of thinking.levels) reasoningEfforts[level] = level
  return { reasoningEfforts }
}

function dshTokenFluxRouteModels(settings: AppSettings): NonNullable<DshPiAiRoute['models']> {
  try {
    const cache = join(dataDirectory(resolveHomeRoot()), 'services', 'model-catalog', 'tokenflux.json')
    if (existsSync(cache)) {
      const snapshot = JSON.parse(readFileSync(cache, 'utf8')) as {
        provider?: string
        models?: Array<{
          id?: string
          name?: string
          context_window?: number
          max_tokens?: number
          input?: string[]
          image_transport?: string
        }>
      }
      if (snapshot.provider === 'tokenflux' && Array.isArray(snapshot.models)) {
        const models: NonNullable<DshPiAiRoute['models']> = []
        for (const entry of snapshot.models) {
          const id = trim(entry.id)
          if (!id || trim(entry.image_transport)) continue
          models.push({
            id,
            name: trim(entry.name) || undefined,
            contextWindow: Number(entry.context_window) || undefined,
            maxTokens: Number(entry.max_tokens) || undefined,
            image: Array.isArray(entry.input) && entry.input.includes('image') ? true : undefined,
            ...dshReasoningEfforts(settings, id),
          })
        }
        if (models.length) return models
      }
    }
  } catch {
    // missing catalog still mounts the TokenFlux route with the active model
  }
  const custom = dshCustomTokenFlux(settings)
  const id = custom?.models[0] || trim(settings.active_model) || 'deepseek-flash'
  return [{ id, name: id, ...dshReasoningEfforts(settings, id) }]
}

function encodeDshPiAiRoutes(settings: AppSettings): string {
  const providers: Record<string, DshPiAiRoute> = {}
  if (dshTokenFluxKey(settings)) {
    const route: DshPiAiRoute = {
      api: 'openai-completions',
      baseURL: dshTokenFluxBaseURL(settings),
      apiKeyEnv: 'TOKENFLUX_API_KEY',
      displayName: 'TokenFlux',
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens',
      },
      models: dshTokenFluxRouteModels(settings),
    }
    providers.tokenflux = route
    const custom = dshCustomTokenFlux(settings)
    if (custom && custom.id !== 'tokenflux') {
      providers[custom.id] = { ...route, displayName: custom.name }
    }
  }
  for (const name of DSH_PIAI_CATALOG_PROVIDERS) {
    const provider = settings.providers?.[name]
    if (!provider?.enabled || !trim(provider.api_key)) continue
    const keyEnv = providerApiKeyEnvironment(name)
    if (!keyEnv) continue
    const route: DshPiAiRoute = { apiKeyEnv: keyEnv }
    const display = trim(provider.name)
    if (display) route.displayName = display
    providers[name] = route
  }
  const deepSeekOfficial = Boolean(dshOfficialDeepSeekKey(settings))
  if (!deepSeekOfficial && Object.keys(providers).length === 0) return ''
  return JSON.stringify({
    deepseekOfficial: deepSeekOfficial,
    providers: Object.keys(providers).length ? providers : undefined,
  })
}

function imageGenCredential(settings: AppSettings): {
  provider: string
  model: string
  source: string
  apiKey: string
  baseUrl: string
} | null {
  const provider = trim(settings.imagegen_provider)
  const model = trim(settings.imagegen_model)
  const source = trim(settings.imagegen_source)
  if (!provider || !model || !source) return null
  if (source === MODEL_SOURCE_ACCOUNT) {
    if (!accountRelayReady(settings)) return null
    return {
      provider,
      model,
      source,
      apiKey: trim(settings.relay?.key),
      baseUrl: trim(settings.relay?.url) || TOKENFLUX_ACCOUNT_URL,
    }
  }
  if (source !== MODEL_SOURCE_PERSONAL && source !== 'service') return null
  const configured = settings.providers?.[provider]
  if (!configured?.enabled) return null
  const apiKey = trim(configured.api_key)
  let baseUrl = trim(configured.base_url)
  if (!baseUrl && provider === 'tokenflux') baseUrl = TOKENFLUX_ACCOUNT_URL
  if (!apiKey || !baseUrl) return null
  return { provider, model, source, apiKey, baseUrl }
}

function appendUnique(environment: string[], extra: string[]): string[] {
  const replaced = new Set<string>()
  for (const entry of extra) {
    const cut = entry.indexOf('=')
    if (cut > 0) replaced.add(entry.slice(0, cut))
  }
  const result: string[] = []
  for (const entry of environment) {
    const cut = entry.indexOf('=')
    const name = cut > 0 ? entry.slice(0, cut) : entry
    if (replaced.has(name)) continue
    result.push(entry)
  }
  return result.concat(extra)
}

export function exportSidecarProviderEnvironment(settings: AppSettings): string[] {
  const environment: string[] = []
  const activeId = trim(settings.active_provider)
  const active = settings.providers?.[activeId]
  const activeCustom = Boolean(active?.custom)

  for (const [name, provider] of Object.entries(settings.providers ?? {})) {
    if (provider.custom) continue
    const keyEnv = providerApiKeyEnvironment(name)
    if (!keyEnv || !provider.enabled || !trim(provider.api_key)) continue
    environment.push(`${keyEnv}=${trim(provider.api_key)}`)
    if (trim(provider.base_url)) {
      environment.push(`${name.toUpperCase()}_BASE_URL=${trim(provider.base_url)}`)
    }
  }

  if (activeCustom && trim(active?.api_key) && trim(active?.base_url)) {
    environment.push(
      `MILKSU_CUSTOM_PROVIDER_ID=${activeId}`,
      `MILKSU_CUSTOM_PROVIDER_NAME=${trim(active?.name)}`,
      `MILKSU_CUSTOM_PROVIDER_KEY=${trim(active?.api_key)}`,
      `MILKSU_CUSTOM_PROVIDER_URL=${trim(active?.base_url)}`,
      `MILKSU_CUSTOM_PROVIDER_API=${trim(active?.api)}`,
    )
  }

  const activeKeyEnv = providerApiKeyEnvironment(activeId)
  if (activeKeyEnv && !settings.providers?.[activeId]) {
    const fromProcess = trim(process.env[activeKeyEnv])
    if (fromProcess) environment.push(`${activeKeyEnv}=${fromProcess}`)
  }

  if (!activeCustom && settings.relay?.enabled && trim(settings.relay.key)) {
    environment.push('MILKSU_RELAY_ENABLED=1', `MILKSU_RELAY_KEY=${trim(settings.relay.key)}`)
    if (trim(settings.relay.url)) environment.push(`MILKSU_RELAY_URL=${trim(settings.relay.url)}`)
  }

  const order = resolvedModelSourceOrder(settings)
  if (order.length) {
    environment.push(`MILKSU_MODEL_SOURCE_ORDER=${order.join(',')}`)
    if (settings.model_routing?.auto_fallback) environment.push('MILKSU_MODEL_SOURCE_FALLBACK=1')
  }

  const image = imageGenCredential(settings)
  if (image) {
    environment.push(
      'MILKSU_IMAGEGEN_CONFIGURED=1',
      `MILKSU_IMAGEGEN_PROVIDER=${image.provider}`,
      `MILKSU_IMAGEGEN_MODEL=${image.model}`,
      `MILKSU_IMAGEGEN_SOURCE=${image.source}`,
      `MILKSU_IMAGEGEN_API_KEY=${image.apiKey}`,
      `MILKSU_IMAGEGEN_BASE_URL=${image.baseUrl}`,
    )
  }

  const extra: string[] = []
  const routes = encodeDshPiAiRoutes(settings)
  if (routes) extra.push(`MILKSU_DSH_PI_AI_ROUTES=${routes}`)
  const deepseek = dshOfficialDeepSeekKey(settings)
  if (deepseek) extra.push(`DEEPSEEK_API_KEY=${deepseek}`)
  const tokenflux = dshTokenFluxKey(settings)
  if (tokenflux && !environment.some((entry) => entry.startsWith('TOKENFLUX_API_KEY='))) {
    extra.push(`TOKENFLUX_API_KEY=${tokenflux}`)
  }

  return appendUnique(environment, extra).filter((entry) => {
    const cut = entry.indexOf('=')
    const name = cut > 0 ? entry.slice(0, cut) : entry
    return !SIDECAR_PROVIDER_ENV_SKIP.has(name)
  })
}
