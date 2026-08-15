import { computed, shallowRef, unref, type MaybeRef } from 'vue'
import { invokeCommand } from '@/desktop'
import {
  PROVIDERS,
  customProviderInfo,
  providerModelLabel as fallbackModelLabel,
  type ModelCatalogSnapshot,
  type ProviderConfig,
  type ProviderInfo,
} from '@/types'

const current = shallowRef<ModelCatalogSnapshot | null>(null)
const configuredCustomProviders = shallowRef<Record<string, ProviderConfig>>({})

function providerReady(settings: Record<string, ProviderConfig>, id: string) {
  const config = settings[id]
  return Boolean(
    config?.enabled
    && (config.has_api_key || String(config.api_key ?? '').trim()),
  )
}

function providerList(
  settings: Record<string, ProviderConfig>,
  { includeUnconfigured = false } = {},
) {
  const builtIn = PROVIDERS.flatMap(provider => {
    const catalog = current.value
    const catalogReady = provider.id === catalog?.provider && catalog.models.length > 0
    if (!includeUnconfigured && !catalogReady && !providerReady(settings, provider.id)) return []
    if (!catalogReady) {
      return [{ ...provider, models: [...provider.models], visionModels: [...provider.visionModels] }]
    }
    return [{
      ...provider,
      models: catalog.models.map(model => model.id),
      visionModels: catalog.models
        .filter(model => model.input.includes('image'))
        .map(model => model.id),
    }]
  })
  const custom = Object.entries(settings).flatMap(([id, config]) => {
    const provider = customProviderInfo(id, config)
    if (!provider || (!includeUnconfigured && !providerReady(settings, id))) return []
    return [provider]
  })
  return [...builtIn, ...custom]
}

const providers = computed<ProviderInfo[]>(() => providerList(configuredCustomProviders.value))

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
  current.value = { ...snapshot, models }
}

export function installCustomProviderSettings(settings?: Record<string, ProviderConfig>) {
  configuredCustomProviders.value = settings ?? {}
}

export async function loadModelCatalog() {
  try {
    installModelCatalog(await invokeCommand<ModelCatalogSnapshot>('get_model_catalog'))
  } catch {
    // The bundled provider definitions remain available in previews and when
    // an older backend is running during a development hot reload.
  }
}

export function providerModelLabel(provider: string, model: string) {
  return modelLabelFromProviders(providers.value, provider, model)
}

function modelLabelFromProviders(values: ProviderInfo[], provider: string, model: string) {
  const providerInfo = values.find(item => item.id === provider)
  const catalogName = provider === current.value?.provider
    ? current.value.models.find(item => item.id === model)?.name
    : undefined
  if (catalogName) return `${providerInfo?.name ?? provider} · ${catalogName}`
  if (providerInfo && !PROVIDERS.some(item => item.id === provider)) {
    return `${providerInfo.name} · ${model}`
  }
  return fallbackModelLabel(provider, model)
}

export function useModelCatalog(
  providerSettings?: MaybeRef<Record<string, ProviderConfig>>,
) {
  const scopedProviders = providerSettings
    ? computed(() => providerList(unref(providerSettings), { includeUnconfigured: true }))
    : providers
  const scopedProviderGroups = providerSettings
    ? computed(() => groupProviders(scopedProviders.value))
    : providerGroups
  return {
    snapshot: current,
    providers: scopedProviders,
    providerGroups: scopedProviderGroups,
    providerModelLabel: (provider: string, model: string) => (
      modelLabelFromProviders(scopedProviders.value, provider, model)
    ),
  }
}
