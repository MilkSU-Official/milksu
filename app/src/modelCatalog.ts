import { createStore, useStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import { IMAGEGEN_MODEL_OFF, imageGenModelLabel, imageGenTransport, isImageGenModelID } from '@/lib/imageGenCatalog'
import type { SearchableModelGroup } from '@/lib/modelPickerSearch'
import { t } from '@/lib/uiLocale'
import {
  PRESET_DEEPSEEK_SERVICE_ID,
  PROVIDERS,
  customProviderInfo,
  providerModelLabel as fallbackModelLabel,
  type AppSettings,
  type ModelCatalogItem,
  type ModelCatalogSnapshot,
  type ProviderConfig,
  type ProviderInfo,
  type RelayConfig,
} from '@/types'

export const modelCatalogStore = createStore({
  current: null as ModelCatalogSnapshot | null,
  configuredCustomProviders: {} as Record<string, ProviderConfig>,
  configuredRelay: undefined as RelayConfig | null | undefined,
})
let configuredContextWindows: AppSettings['model_context_windows']
let disabledAccountModels = new Set<string>()

function catalogState() {
  return modelCatalogStore.getState()
}

function providerHasKey(config?: ProviderConfig) {
  return Boolean(config?.has_api_key || String(config?.api_key ?? '').trim())
}

function providerReady(settings: Record<string, ProviderConfig>, id: string) {
  const config = settings[id]
  return Boolean(config?.enabled && providerHasKey(config))
}

function accountRouteReady(relay?: RelayConfig | null) {
  return Boolean(relay?.enabled && (relay.has_key || String(relay.key ?? '').trim()))
}

function credentialedCatalog(provider: string): ModelCatalogSnapshot | null {
  const catalog = catalogState().current
  return catalog
    && provider === catalog.provider
    && catalog.models.length > 0
    && (catalog.source === 'remote' || catalog.source === 'cache')
    && (
      catalog.credential_source === 'account'
      || catalog.credential_source === 'personal'
      || catalog.credential_source === 'merged'
    )
    ? catalog
    : null
}

/** Models the TokenFlux catalog exposes for the currently enabled account/personal routes. */
export function tokenfluxCallableModels(
  catalog: ModelCatalogSnapshot | null | undefined,
  settings: {
    providers?: Record<string, ProviderConfig>
    relay?: RelayConfig | null
  },
): ModelCatalogSnapshot['models'] {
  if (!catalog || catalog.provider !== 'tokenflux' || catalog.models.length === 0) return []
  if (
    catalog.source !== 'remote' && catalog.source !== 'cache'
    || (
      catalog.credential_source !== 'account'
      && catalog.credential_source !== 'personal'
      && catalog.credential_source !== 'merged'
    )
  ) {
    return []
  }

  const accountOn = accountRouteReady(settings.relay)
  const personalOn = providerReady(settings.providers ?? {}, 'tokenflux')
  if (!accountOn && !personalOn) return []

  const imageIDs = new Set((catalog.image_models ?? []).map(model => model.id))
  const models = catalog.models.filter(model => !imageIDs.has(model.id))
  if (models.length === 0) return []

  const accountIDs = new Set(
    (catalog.account_model_ids ?? [])
      .map(id => String(id ?? '').trim())
      .filter(id => id && !imageIDs.has(id)),
  )

  if (accountOn && personalOn) return models

  if (accountOn) {
    if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
      return models.filter(model => accountIDs.has(model.id))
    }
    if (catalog.credential_source === 'account' || catalog.credential_source === 'merged') {
      return models
    }
    return []
  }

  if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
    const personal = models.filter(model => !accountIDs.has(model.id))
    return personal.length > 0 ? personal : models
  }
  if (catalog.credential_source === 'personal' || catalog.credential_source === 'merged') {
    return models
  }
  return []
}

export type PickerServiceSource = 'account' | 'personal' | 'service'

/** One enabled service slice for Settings / Coding model pickers. */
export interface PickerServiceGroup {
  /** Stable key for picker lists and selection encoding. */
  key: string
  /** Underlying provider id used by Desktop RPC / Agent (tokenflux, custom-relay-…). */
  providerId: string
  /** Credential route when provider is TokenFlux. */
  source: PickerServiceSource
  /** Group heading shown in the picker. */
  label: string
  models: string[]
  visionModels: string[]
}

function catalogModelsForTokenfluxSource(
  source: 'account' | 'personal',
  settings: {
    providers?: Record<string, ProviderConfig>
    relay?: RelayConfig | null
  },
): ModelCatalogSnapshot['models'] {
  const catalog = credentialedCatalog('tokenflux')
  if (!catalog) return []
  const accountOn = accountRouteReady(settings.relay)
  const personalOn = providerReady(settings.providers ?? {}, 'tokenflux')
  if (source === 'account' && !accountOn) return []
  if (source === 'personal' && !personalOn) return []

  const imageIDs = new Set((catalog.image_models ?? []).map(model => model.id))
  const models = catalog.models.filter(model => !imageIDs.has(model.id))
  if (models.length === 0) return []
  const accountIDs = new Set(
    (catalog.account_model_ids ?? [])
      .map(id => String(id ?? '').trim())
      .filter(id => id && !imageIDs.has(id)),
  )

  if (source === 'account') {
    let accountModels = models
    if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
      accountModels = models.filter(model => accountIDs.has(model.id))
    } else if (
      catalog.credential_source !== 'account'
      && catalog.credential_source !== 'merged'
      && accountIDs.size === 0
    ) {
      accountModels = models
    }
    if (disabledAccountModels.size === 0) return accountModels
    return accountModels.filter(model => !disabledAccountModels.has(model.id))
  }

  if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
    const personal = models.filter(model => !accountIDs.has(model.id))
    return personal.length > 0 ? personal : models
  }
  if (catalog.credential_source === 'personal' || catalog.credential_source === 'merged') {
    return models
  }
  return models
}

/** Image routes from the same TokenFlux refresh, split by which key can call them. */
export function imageModelsForTokenfluxSource(
  source: 'account' | 'personal',
  settings: {
    providers?: Record<string, ProviderConfig>
    relay?: RelayConfig | null
  },
): ModelCatalogItem[] {
  const catalog = catalogState().current
  if (!catalog || catalog.provider !== 'tokenflux') return []
  if (catalog.source !== 'remote' && catalog.source !== 'cache') return []
  if (
    catalog.credential_source !== 'account'
    && catalog.credential_source !== 'personal'
    && catalog.credential_source !== 'merged'
  ) {
    return []
  }
  const images = catalog.image_models ?? []
  if (images.length === 0) return []
  const accountOn = accountRouteReady(settings.relay)
  const personalOn = providerReady(settings.providers ?? {}, 'tokenflux')
  if (source === 'account' && !accountOn) return []
  if (source === 'personal' && !personalOn) return []

  const accountIDs = new Set(
    (catalog.account_image_model_ids ?? [])
      .map(id => String(id ?? '').trim())
      .filter(Boolean),
  )

  if (source === 'account') {
    if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
      return images.filter(model => accountIDs.has(model.id))
    }
    if (catalog.credential_source === 'account' || catalog.credential_source === 'merged') {
      return images
    }
    return images
  }

  if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
    const personal = images.filter(model => !accountIDs.has(model.id))
    return personal.length > 0 ? personal : images
  }
  return images
}

/** Composer and settings groups for image routes only. Chat models stay out. */
export function imageGenComposerGroups(settings: {
  providers?: Record<string, ProviderConfig>
  relay?: RelayConfig | null
} | null | undefined): SearchableModelGroup[] {
  if (!settings) return []
  const groups: SearchableModelGroup[] = []
  const pushTokenflux = (source: 'account' | 'personal', key: string, label: string) => {
    const models = imageModelsForTokenfluxSource(source, settings)
    if (models.length === 0) return
    groups.push({
      key,
      label,
      models: models.map(model => ({
        value: encodePickerSelection('tokenflux', model.id, source),
        label: imageGenModelLabel(model.id, model.name),
        model: model.id,
      })),
    })
  }
  pushTokenflux('account', 'imagegen-account-tokenflux', t('MilkSU 账户', 'MilkSU account'))
  pushTokenflux('personal', 'imagegen-personal-tokenflux', t('TokenFlux 中转站', 'TokenFlux relay'))
  for (const [id, config] of Object.entries(settings.providers ?? {})) {
    if (!config?.custom || !config.enabled || !config.has_api_key) continue
    const info = customProviderInfo(id, config)
    if (!info) continue
    const models = (config.models ?? []).map(model => String(model ?? '').trim()).filter(isImageGenModelID)
    if (models.length === 0) continue
    groups.push({
      key: `imagegen-service-${id}`,
      label: info.name,
      models: models.map(model => ({
        value: encodePickerSelection(id, model, 'service'),
        label: imageGenModelLabel(model),
        model,
      })),
    })
  }
  return groups
}

export function imageGenSettingsKey(settings: {
  imagegen_provider?: string
  imagegen_model?: string
  imagegen_source?: string
} | null | undefined): string {
  const provider = String(settings?.imagegen_provider ?? '').trim()
  const model = String(settings?.imagegen_model ?? '').trim()
  if (!provider || !model || !isImageGenModelID(model)) return IMAGEGEN_MODEL_OFF
  const source = settings?.imagegen_source === 'account'
    || settings?.imagegen_source === 'personal'
    || settings?.imagegen_source === 'service'
    ? settings.imagegen_source
    : 'account'
  return encodePickerSelection(provider, model, source)
}

export function imageGenSettingsFromKey(value: string): {
  imagegen_provider: string
  imagegen_model: string
  imagegen_source: '' | 'account' | 'personal' | 'service'
} {
  if (!value || value === IMAGEGEN_MODEL_OFF) {
    return { imagegen_provider: '', imagegen_model: '', imagegen_source: '' }
  }
  const selection = parsePickerSelection(value)
  if (!selection || !isImageGenModelID(selection.model)) {
    return { imagegen_provider: '', imagegen_model: '', imagegen_source: '' }
  }
  return {
    imagegen_provider: selection.providerId,
    imagegen_model: selection.model,
    imagegen_source: selection.source,
  }
}

function withTokenfluxModels(
  provider: ProviderInfo,
  settings: Record<string, ProviderConfig>,
  relay?: RelayConfig | null,
): ProviderInfo | null {
  const models = tokenfluxCallableModels(credentialedCatalog('tokenflux'), {
    providers: settings,
    relay,
  })
  if (models.length === 0) return null
  return {
    ...provider,
    models: models.map(model => model.id),
    visionModels: models.map(model => model.id),
  }
}

/**
 * Flat picker groups: every enabled service is listed side by side.
 * Account TokenFlux and personal TokenFlux appear as two groups when both on.
 */
export function callablePickerGroups(
  settings: Record<string, ProviderConfig>,
  relay?: RelayConfig | null,
): PickerServiceGroup[] {
  const groups: PickerServiceGroup[] = []
  const accountModels = catalogModelsForTokenfluxSource('account', { providers: settings, relay })
  if (accountModels.length > 0) {
    groups.push({
      key: 'tokenflux:account',
      providerId: 'tokenflux',
      source: 'account',
      label: t('MilkSU 账户', 'MilkSU account'),
      models: accountModels.map(model => model.id),
      visionModels: accountModels.map(model => model.id),
    })
  }
  const personalModels = catalogModelsForTokenfluxSource('personal', { providers: settings, relay })
  if (personalModels.length > 0) {
    groups.push({
      key: 'tokenflux:personal',
      providerId: 'tokenflux',
      source: 'personal',
      label: t('TokenFlux 中转站', 'TokenFlux relay'),
      models: personalModels.map(model => model.id),
      visionModels: personalModels.map(model => model.id),
    })
  }
  for (const [id, config] of Object.entries(settings)) {
    if (id === 'tokenflux' || !providerReady(settings, id)) continue
    const provider = customProviderInfo(id, config)
    if (!provider || provider.models.length === 0) continue
    groups.push({
      key: `service:${id}`,
      providerId: id,
      source: 'service',
      label: provider.name,
      models: [...provider.models],
      visionModels: [...provider.visionModels],
    })
  }
  return groups
}

/**
 * Callable providers for pickers (Settings default model + Coding composer).
 * Only enabled services that currently expose at least one model.
 * TokenFlux rows are merged for legacy callers; prefer callablePickerGroups.
 */
export function callableProviders(
  settings: Record<string, ProviderConfig>,
  relay?: RelayConfig | null,
): ProviderInfo[] {
  const builtIn = PROVIDERS.flatMap(provider => {
    if (provider.id === 'tokenflux') {
      const next = withTokenfluxModels(provider, settings, relay)
      return next ? [next] : []
    }
    if (!providerReady(settings, provider.id)) return []
    return [{
      ...provider,
      models: [...provider.models],
      visionModels: [...provider.visionModels],
    }]
  })
  const custom = Object.entries(settings).flatMap(([id, config]) => {
    if (!providerReady(settings, id)) return []
    const provider = customProviderInfo(id, config)
    return provider && provider.models.length > 0 ? [provider] : []
  })
  return [...builtIn, ...custom]
}

/** All known services for the Settings "模型服务" list (includes unconfigured). */
export function configurableProviders(
  settings: Record<string, ProviderConfig>,
  relay?: RelayConfig | null,
): ProviderInfo[] {
  const builtIn = PROVIDERS.flatMap(provider => {
    if (provider.id === 'tokenflux') {
      const next = withTokenfluxModels(provider, settings, relay)
      if (next) return [next]
      return [{ ...provider, models: [], visionModels: [] }]
    }
    return [{
      ...provider,
      models: [...provider.models],
      visionModels: [...provider.visionModels],
    }]
  })
  const custom = Object.entries(settings).flatMap(([id, config]) => {
    const provider = customProviderInfo(id, config)
    return provider ? [provider] : []
  })
  return [...builtIn, ...custom]
}

function groupProviders(values: ProviderInfo[]) {
  return [
    {
      kind: 'relay' as const,
      label: t('模型服务', 'Model services'),
      providers: values.filter(provider => provider.kind === 'relay' || provider.kind === 'official'),
    },
  ].filter(group => group.providers.length > 0)
}

/** Encode a picker selection so account vs personal TokenFlux stay distinct. */
export function encodePickerSelection(
  providerId: string,
  model: string,
  source: PickerServiceSource = 'service',
): string {
  return JSON.stringify([providerId, model, source])
}

export function parsePickerSelection(value: string): {
  providerId: string
  model: string
  source: PickerServiceSource
} | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      !Array.isArray(parsed)
      || parsed.length < 2
      || typeof parsed[0] !== 'string'
      || typeof parsed[1] !== 'string'
      || !parsed[0]
      || !parsed[1]
    ) return null
    const source = parsed[2] === 'account' || parsed[2] === 'personal' || parsed[2] === 'service'
      ? parsed[2]
      : 'service'
    return { providerId: parsed[0], model: parsed[1], source }
  } catch {
    return null
  }
}

/** Coding composer manual key: manual:provider:source:model */
export function encodeComposerModelKey(
  providerId: string,
  model: string,
  source: PickerServiceSource = 'service',
): string {
  return `manual:${providerId}:${source}:${model}`
}

export type ModelServiceSourceInput = {
  provider?: string | null
  model?: string | null
  modelSource?: 'account' | 'personal' | string | null
  pickerGroups?: readonly PickerServiceGroup[]
  providers?: Record<string, ProviderConfig> | null
}

function matchPickerGroupForSourceLabel(
  groups: readonly PickerServiceGroup[],
  provider: string,
  model: string,
  modelSource?: 'account' | 'personal',
): PickerServiceGroup | undefined {
  if (provider === 'tokenflux' && modelSource) {
    const preferred = groups.find(group => (
      group.providerId === 'tokenflux'
      && group.source === modelSource
      && (!model || group.models.includes(model))
    ))
    if (preferred) return preferred
    const bySource = groups.find(group => (
      group.providerId === 'tokenflux' && group.source === modelSource
    ))
    if (bySource) return bySource
  }
  if (provider && model) {
    const byProviderAndModel = groups.find(group => (
      group.providerId === provider && group.models.includes(model)
    ))
    if (byProviderAndModel) return byProviderAndModel
  }
  if (provider) {
    const byProvider = groups.filter(group => group.providerId === provider)
    if (byProvider.length === 1) return byProvider[0]
  }
  return undefined
}

function fallbackModelServiceSourceLabel(
  provider: string,
  modelSource: 'account' | 'personal' | undefined,
  providers?: Record<string, ProviderConfig> | null,
): string {
  if (provider === 'tokenflux') {
    if (modelSource === 'account') return t('MilkSU 账户', 'MilkSU account')
    return t('TokenFlux 中转站', 'TokenFlux relay')
  }
  if (provider.startsWith('custom-relay-')) {
    const config = providers?.[provider]
    const info = customProviderInfo(provider, config)
    const name = String(info?.name ?? config?.name ?? '').trim()
    if (name) return name
    if (provider === PRESET_DEEPSEEK_SERVICE_ID) return 'DeepSeek'
    return ''
  }
  return ''
}

/**
 * Environment / composer “来源” label for the currently selected service.
 * `modelSource` is only the TokenFlux credential bucket; official DeepSeek and
 * other custom relays stay on their picker / settings name.
 */
export function modelServiceSourceLabel(input: ModelServiceSourceInput): string {
  const provider = String(input.provider ?? '').trim()
  const model = String(input.model ?? '').trim()
  const modelSource = input.modelSource === 'account' || input.modelSource === 'personal'
    ? input.modelSource
    : undefined
  const matched = matchPickerGroupForSourceLabel(
    input.pickerGroups ?? [],
    provider,
    model,
    modelSource,
  )
  if (matched?.label) return matched.label
  return fallbackModelServiceSourceLabel(provider, modelSource, input.providers)
}

export function parseComposerModelKey(value: string): {
  mode: 'auto' | 'manual'
  providerId?: string
  model?: string
  source?: PickerServiceSource
} {
  if (!value || value === 'auto') return { mode: 'auto' }
  if (!value.startsWith('manual:')) return { mode: 'auto' }
  const body = value.slice('manual:'.length)
  const first = body.indexOf(':')
  if (first < 0) return { mode: 'auto' }
  const providerId = body.slice(0, first)
  const rest = body.slice(first + 1)
  const second = rest.indexOf(':')
  if (second < 0) {
    // Legacy manual:provider:model
    return { mode: 'manual', providerId, model: rest, source: 'service' }
  }
  const sourceRaw = rest.slice(0, second)
  const model = rest.slice(second + 1)
  const source: PickerServiceSource = sourceRaw === 'account' || sourceRaw === 'personal'
    ? sourceRaw
    : 'service'
  if (!providerId || !model) return { mode: 'auto' }
  return { mode: 'manual', providerId, model, source }
}

/**
 * Label for one model row inside a picker group.
 * Group headings already name the service (MilkSU 账户 / TokenFlux / custom relay),
 * so rows only show the model display name — no repeated service prefix.
 */
export function pickerModelLabel(
  group: PickerServiceGroup,
  model: string,
  catalog?: ModelCatalogSnapshot | null,
): string {
  const catalogName = (catalog ?? credentialedCatalog(group.providerId))?.models
    .find(item => item.id === model)?.name
  return catalogName || model
}

function providers() {
  return callableProviders(
    catalogState().configuredCustomProviders,
    catalogState().configuredRelay,
  )
}

function isScopedSettings(value: ModelCatalogScope): value is {
  providers: Record<string, ProviderConfig>
  relay?: RelayConfig | null
  includeUnconfigured?: boolean
} {
  return Boolean(
    value
    && typeof value === 'object'
    && 'providers' in value
    && value.providers
    && typeof value.providers === 'object'
    && !('api_key' in value.providers)
    && !('has_api_key' in value.providers),
  )
}

export function installModelCatalog(snapshot?: ModelCatalogSnapshot | null) {
  if (snapshot === null) {
    modelCatalogStore.setState({ current: null })
    return
  }
  if (!snapshot || snapshot.provider !== 'tokenflux' || !Array.isArray(snapshot.models)) return
  const seen = new Set<string>()
  const models: ModelCatalogItem[] = []
  const images: ModelCatalogItem[] = []
  const seenImage = new Set<string>()
  const takeImage = (model: ModelCatalogItem) => {
    const id = String(model?.id ?? '').trim()
    if (!id || !isImageGenModelID(id) || seenImage.has(id)) return
    seenImage.add(id)
    images.push({
      ...model,
      id,
      image_transport: model.image_transport || imageGenTransport(id),
    })
  }
  for (const model of snapshot.image_models ?? []) takeImage(model)
  for (const model of snapshot.models) {
    const id = String(model?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (isImageGenModelID(id)) {
      takeImage({ ...model, id })
      continue
    }
    models.push({ ...model, id })
  }
  if (!models.length && !images.length) return
  const accountChatIDs = Array.isArray(snapshot.account_model_ids)
    ? snapshot.account_model_ids.map(id => String(id ?? '').trim()).filter(id => id && !seenImage.has(id))
    : undefined
  const accountImageIDs = (snapshot.account_image_model_ids ?? [])
    .map(id => String(id ?? '').trim())
    .filter((id, index, all) => id && all.indexOf(id) === index)
  modelCatalogStore.setState({
    current: {
      ...snapshot,
      models,
      image_models: images,
      account_model_ids: accountChatIDs,
      account_image_model_ids: accountImageIDs.length > 0 ? accountImageIDs : snapshot.account_image_model_ids,
    },
  })
}

export function installCustomProviderSettings(settings?: Record<string, ProviderConfig>) {
  modelCatalogStore.setState({ configuredCustomProviders: settings ?? {} })
}

/** Keep Coding and Settings pickers aligned with saved (or draft) settings. */
export function installAppModelSettings(settings?: Pick<AppSettings, 'providers' | 'relay' | 'model_context_windows' | 'disabled_account_models'> | null) {
  modelCatalogStore.setState({
    configuredCustomProviders: settings?.providers ?? {},
    configuredRelay: settings?.relay,
  })
  configuredContextWindows = settings?.model_context_windows
  disabledAccountModels = new Set(
    (settings?.disabled_account_models ?? []).map(id => String(id ?? '').trim()).filter(Boolean),
  )
}

/** Account catalog rows for the settings editor. Disabled models stay listed. */
export function listedAccountModels(catalog?: ModelCatalogSnapshot | null): Array<{ id: string; name: string }> {
  if (!catalog || catalog.provider !== 'tokenflux') return []
  const imageIDs = new Set((catalog.image_models ?? []).map(model => model.id))
  const models = catalog.models.filter(model => model.id && !imageIDs.has(model.id))
  const accountIDs = new Set(
    (catalog.account_model_ids ?? []).map(id => String(id ?? '').trim()).filter(id => id && !imageIDs.has(id)),
  )
  const rows = accountIDs.size > 0 ? models.filter(model => accountIDs.has(model.id)) : models
  return rows.map(model => ({ id: model.id, name: model.name || model.id }))
}

export function installedModelContextWindows() {
  return configuredContextWindows
}

export async function loadModelCatalog() {
  try {
    installModelCatalog(await invokeCommand<ModelCatalogSnapshot>('get_model_catalog'))
  } catch {
    // Bundled definitions remain available in previews / older backends.
  }
}

export function providerModelLabel(provider: string, model: string) {
  return modelLabelFromProviders(providers(), provider, model)
}

function modelLabelFromProviders(values: ProviderInfo[], provider: string, model: string) {
  const providerInfo = values.find(item => item.id === provider)
  const catalogName = credentialedCatalog(provider)?.models
    .find(item => item.id === model)?.name
  if (catalogName) return `${providerInfo?.name ?? provider} · ${catalogName}`
  if (providerInfo && !PROVIDERS.some(item => item.id === provider)) {
    return `${providerInfo.name} · ${model}`
  }
  return fallbackModelLabel(provider, model)
}

export type ModelCatalogScope =
  | Record<string, ProviderConfig>
  | {
    providers: Record<string, ProviderConfig>
    relay?: RelayConfig | null
    /** When true, list every known service (Settings service rows). */
    includeUnconfigured?: boolean
  }

/**
 * Shared catalog surface.
 * - no args / callable settings: Coding composer + Settings default model
 * - includeUnconfigured: Settings model-service rows
 */
export type ModelCatalogScopeInput = ModelCatalogScope | (() => ModelCatalogScope | undefined)

function readScope(scope?: ModelCatalogScopeInput): ModelCatalogScope | undefined {
  return typeof scope === 'function' ? scope() : scope
}

export function useModelCatalog(scope?: ModelCatalogScopeInput) {
  function resolved() {
    const raw = readScope(scope)
    if (!raw) {
      return {
        providers: catalogState().configuredCustomProviders,
        relay: catalogState().configuredRelay,
        includeUnconfigured: false,
      }
    }
    if (isScopedSettings(raw)) {
      return {
        providers: raw.providers,
        relay: raw.relay ?? catalogState().configuredRelay,
        includeUnconfigured: Boolean(raw.includeUnconfigured),
      }
    }
    return {
      providers: raw as Record<string, ProviderConfig>,
      relay: catalogState().configuredRelay,
      includeUnconfigured: true,
    }
  }

  function scopedProviders() {
    const current = resolved()
    return current.includeUnconfigured
      ? configurableProviders(current.providers, current.relay)
      : callableProviders(current.providers, current.relay)
  }

  function scopedProviderGroups() {
    return groupProviders(scopedProviders())
  }

  function scopedPickerGroups() {
    const current = resolved()
    return current.includeUnconfigured
      ? []
      : callablePickerGroups(current.providers, current.relay)
  }

  return {
    get snapshot() { return catalogState().current },
    get providers() { return scopedProviders() },
    get providerGroups() { return scopedProviderGroups() },
    get pickerGroups() { return scopedPickerGroups() },
    providerModelLabel: (provider: string, model: string) => (
      modelLabelFromProviders(scopedProviders(), provider, model)
    ),
    pickerModelLabel: (group: PickerServiceGroup, model: string) => (
      pickerModelLabel(group, model, catalogState().current)
    ),
  }
}

export { useModelCatalog as createModelCatalog }

export function useLiveModelCatalog(scope?: ModelCatalogScopeInput) {
  useStore(modelCatalogStore)
  return useModelCatalog(scope)
}
