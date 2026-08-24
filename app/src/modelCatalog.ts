import { computed, shallowRef, unref, type MaybeRef } from 'vue'
import { invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'
import {
  PROVIDERS,
  customProviderInfo,
  providerModelLabel as fallbackModelLabel,
  type AppSettings,
  type ModelCatalogSnapshot,
  type ProviderConfig,
  type ProviderInfo,
  type RelayConfig,
} from '@/types'

const current = shallowRef<ModelCatalogSnapshot | null>(null)
const configuredCustomProviders = shallowRef<Record<string, ProviderConfig>>({})
const configuredRelay = shallowRef<RelayConfig | null | undefined>(undefined)

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
  const catalog = current.value
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

  const accountIDs = new Set(
    (catalog.account_model_ids ?? [])
      .map(id => String(id ?? '').trim())
      .filter(Boolean),
  )

  if (accountOn && personalOn) return catalog.models

  if (accountOn) {
    if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
      return catalog.models.filter(model => accountIDs.has(model.id))
    }
    if (catalog.credential_source === 'account' || catalog.credential_source === 'merged') {
      return catalog.models
    }
    return []
  }

  if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
    const personal = catalog.models.filter(model => !accountIDs.has(model.id))
    return personal.length > 0 ? personal : catalog.models
  }
  if (catalog.credential_source === 'personal' || catalog.credential_source === 'merged') {
    return catalog.models
  }
  return []
}

export type PickerServiceSource = 'account' | 'personal' | 'service'

/** One enabled service slice for Settings / Coding model pickers. */
export interface PickerServiceGroup {
  /** Stable key for Vue lists and selection encoding. */
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

  const accountIDs = new Set(
    (catalog.account_model_ids ?? [])
      .map(id => String(id ?? '').trim())
      .filter(Boolean),
  )

  if (source === 'account') {
    if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
      return catalog.models.filter(model => accountIDs.has(model.id))
    }
    if (catalog.credential_source === 'account' || catalog.credential_source === 'merged') {
      return catalog.models
    }
    // Account route on but catalog only has personal metadata — still list all
    // known TokenFlux models so the account row is usable.
    return catalog.models
  }

  if (catalog.credential_source === 'merged' && accountIDs.size > 0) {
    const personal = catalog.models.filter(model => !accountIDs.has(model.id))
    return personal.length > 0 ? personal : catalog.models
  }
  if (catalog.credential_source === 'personal' || catalog.credential_source === 'merged') {
    return catalog.models
  }
  return catalog.models
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
    visionModels: models
      .filter(model => model.input.includes('image'))
      .map(model => model.id),
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
      visionModels: accountModels
        .filter(model => model.input.includes('image'))
        .map(model => model.id),
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
      visionModels: personalModels
        .filter(model => model.input.includes('image'))
        .map(model => model.id),
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

const providers = computed(() => callableProviders(
  configuredCustomProviders.value,
  configuredRelay.value,
))

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
    current.value = null
    return
  }
  if (!snapshot || snapshot.provider !== 'tokenflux' || !Array.isArray(snapshot.models)) return
  const seen = new Set<string>()
  const models = snapshot.models.filter(model => {
    const id = String(model.id ?? '').trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (!models.length) return
  current.value = {
    ...snapshot,
    models,
    account_model_ids: Array.isArray(snapshot.account_model_ids)
      ? snapshot.account_model_ids.map(id => String(id ?? '').trim()).filter(Boolean)
      : undefined,
  }
}

export function installCustomProviderSettings(settings?: Record<string, ProviderConfig>) {
  configuredCustomProviders.value = settings ?? {}
}

/** Keep Coding and Settings pickers aligned with saved (or draft) settings. */
export function installAppModelSettings(settings?: Pick<AppSettings, 'providers' | 'relay'> | null) {
  installCustomProviderSettings(settings?.providers)
  configuredRelay.value = settings?.relay
}

export async function loadModelCatalog() {
  try {
    installModelCatalog(await invokeCommand<ModelCatalogSnapshot>('get_model_catalog'))
  } catch {
    // Bundled definitions remain available in previews / older backends.
  }
}

export function providerModelLabel(provider: string, model: string) {
  return modelLabelFromProviders(providers.value, provider, model)
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
export function useModelCatalog(scope?: MaybeRef<ModelCatalogScope | undefined>) {
  const resolved = computed(() => {
    const raw = scope ? unref(scope) : undefined
    if (!raw) {
      return {
        providers: configuredCustomProviders.value,
        relay: configuredRelay.value,
        includeUnconfigured: false,
      }
    }
    if (isScopedSettings(raw)) {
      return {
        providers: raw.providers,
        relay: raw.relay ?? configuredRelay.value,
        includeUnconfigured: Boolean(raw.includeUnconfigured),
      }
    }
    // Legacy: plain provider map means the Settings service editor.
    return {
      providers: raw as Record<string, ProviderConfig>,
      relay: configuredRelay.value,
      includeUnconfigured: true,
    }
  })

  const scopedProviders = computed(() => (
    resolved.value.includeUnconfigured
      ? configurableProviders(resolved.value.providers, resolved.value.relay)
      : callableProviders(resolved.value.providers, resolved.value.relay)
  ))
  const scopedProviderGroups = computed(() => groupProviders(scopedProviders.value))
  /** Flat enabled-service groups for Settings + Coding pickers (account / personal / custom). */
  const scopedPickerGroups = computed(() => (
    resolved.value.includeUnconfigured
      ? []
      : callablePickerGroups(resolved.value.providers, resolved.value.relay)
  ))

  return {
    snapshot: current,
    providers: scopedProviders,
    providerGroups: scopedProviderGroups,
    pickerGroups: scopedPickerGroups,
    providerModelLabel: (provider: string, model: string) => (
      modelLabelFromProviders(scopedProviders.value, provider, model)
    ),
    pickerModelLabel: (group: PickerServiceGroup, model: string) => (
      pickerModelLabel(group, model, current.value)
    ),
  }
}
