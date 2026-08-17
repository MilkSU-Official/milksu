import { computed, shallowRef, unref, type MaybeRef } from 'vue'
import { invokeCommand } from '@/desktop'
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
 * Callable providers for pickers (Settings default model + Coding composer).
 * Only enabled services that currently expose at least one model.
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
      kind: 'official' as const,
      label: '原厂',
      providers: values.filter(provider => provider.kind === 'official'),
    },
    {
      kind: 'relay' as const,
      label: '中转站',
      providers: values.filter(provider => provider.kind === 'relay'),
    },
  ].filter(group => group.providers.length > 0)
}

const providers = computed(() => callableProviders(
  configuredCustomProviders.value,
  configuredRelay.value,
))
const providerGroups = computed(() => groupProviders(providers.value))

export function installModelCatalog(snapshot?: ModelCatalogSnapshot | null) {
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
    if ('providers' in raw && raw.providers && typeof raw.providers === 'object') {
      return {
        providers: raw.providers,
        relay: 'relay' in raw ? raw.relay : configuredRelay.value,
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

  return {
    snapshot: current,
    providers: scopedProviders,
    providerGroups: scopedProviderGroups,
    providerModelLabel: (provider: string, model: string) => (
      modelLabelFromProviders(scopedProviders.value, provider, model)
    ),
  }
}
