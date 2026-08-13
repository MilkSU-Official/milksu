import { computed, shallowRef } from 'vue'
import { invokeCommand } from '@/desktop'
import {
  PROVIDERS,
  providerModelLabel as fallbackModelLabel,
  type ModelCatalogSnapshot,
  type ProviderInfo,
} from '@/types'

const current = shallowRef<ModelCatalogSnapshot | null>(null)

const providers = computed<ProviderInfo[]>(() => PROVIDERS.map(provider => {
  if (provider.id !== current.value?.provider || !current.value.models.length) {
    return { ...provider, models: [...provider.models], visionModels: [...provider.visionModels] }
  }
  return {
    ...provider,
    models: current.value.models.map(model => model.id),
    visionModels: current.value.models
      .filter(model => model.input.includes('image'))
      .map(model => model.id),
  }
}))

const providerGroups = computed(() => [
  {
    kind: 'official' as const,
    label: '原厂',
    providers: providers.value.filter(provider => provider.kind === 'official'),
  },
  {
    kind: 'relay' as const,
    label: '中转站',
    providers: providers.value.filter(provider => provider.kind === 'relay'),
  },
])

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

export async function loadModelCatalog() {
  try {
    installModelCatalog(await invokeCommand<ModelCatalogSnapshot>('get_model_catalog'))
  } catch {
    // The bundled provider definitions remain available in previews and when
    // an older backend is running during a development hot reload.
  }
}

export function providerModelLabel(provider: string, model: string) {
  const providerInfo = providers.value.find(item => item.id === provider)
  const catalogName = provider === current.value?.provider
    ? current.value.models.find(item => item.id === model)?.name
    : undefined
  if (catalogName) return `${providerInfo?.name ?? provider} · ${catalogName}`
  return fallbackModelLabel(provider, model)
}

export function useModelCatalog() {
  return {
    snapshot: current,
    providers,
    providerGroups,
    providerModelLabel,
  }
}
