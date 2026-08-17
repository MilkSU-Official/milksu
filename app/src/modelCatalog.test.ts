import { describe, expect, it } from 'vitest'
import { computed } from 'vue'
import {
  installAppModelSettings,
  installCustomProviderSettings,
  installModelCatalog,
  providerModelLabel,
  useModelCatalog,
} from './modelCatalog'
import type { ProviderConfig } from './types'

describe('runtime model catalog', () => {
  it('replaces the TokenFlux picker with refreshed canonical models and vision metadata', () => {
    installModelCatalog({
      provider: 'tokenflux',
      source: 'remote',
      credential_source: 'account',
      refreshed_at: '2026-08-13T12:30:00Z',
      models: [
        {
          id: 'grok-4.5', name: 'Grok 4.5',
          context_window: 500000, max_tokens: 32768, input: ['text', 'image'],
        },
        {
          id: 'x-ai/grok-4.6', name: 'Grok 4.6',
          context_window: 500000, max_tokens: 32768, input: ['text', 'image'],
        },
        {
          id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol',
          context_window: 1050000, max_tokens: 32768, input: ['text'],
        },
      ],
    })
    installAppModelSettings({
      providers: {},
      relay: {
        enabled: true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: true,
      },
    })

    const { providers } = useModelCatalog()
    const tokenflux = providers.value.find(provider => provider.id === 'tokenflux')
    expect(tokenflux?.models).toEqual(['grok-4.5', 'x-ai/grok-4.6', 'openai/gpt-5.6-sol'])
    expect(tokenflux?.visionModels).toEqual(['grok-4.5', 'x-ai/grok-4.6'])
    expect(providerModelLabel('tokenflux', 'x-ai/grok-4.6')).toBe('TokenFlux · Grok 4.6')
  })

  it('adds persisted and locally edited custom relays to model pickers', () => {
    const custom: Record<string, ProviderConfig> = {
      'custom-relay-team': {
        api_key: '',
        has_api_key: true,
        enabled: true,
        custom: true,
        name: 'Team Relay',
        base_url: 'https://relay.example/v1',
        models: ['vendor/model:preview'],
      },
    }
    installCustomProviderSettings(custom)
    expect(providerModelLabel('custom-relay-team', 'vendor/model:preview'))
      .toBe('Team Relay · vendor/model:preview')

    const { providerGroups, providerModelLabel: scopedLabel } = useModelCatalog(computed(() => custom))
    const relays = providerGroups.value.find(group => group.kind === 'relay')?.providers
    expect(relays?.some(provider => provider.id === 'custom-relay-team')).toBe(true)
    expect(scopedLabel('custom-relay-team', 'vendor/model:preview'))
      .toBe('Team Relay · vendor/model:preview')
  })

  it('hides unconfigured official providers from runtime pickers', () => {
    installModelCatalog({
      provider: 'tokenflux',
      source: 'remote',
      credential_source: 'account',
      refreshed_at: '2026-08-15T00:00:00Z',
      models: [
        {
          id: 'grok-4.6', name: 'Grok 4.6',
          context_window: 500_000, max_tokens: 32_768, input: ['text'],
        },
      ],
    })
    const settings: Record<string, ProviderConfig> = {
      openai: {
        api_key: '',
        has_api_key: false,
        enabled: true,
      },
    }
    installAppModelSettings({
      providers: settings,
      relay: {
        enabled: true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: true,
      },
    })

    const runtime = useModelCatalog()
    expect(runtime.providerGroups.value.map(group => group.label)).toEqual(['中转站'])
    expect(runtime.providers.value.map(provider => provider.id)).toEqual(['tokenflux'])

    const configurable = useModelCatalog(computed(() => ({
      providers: settings,
      includeUnconfigured: true,
    })))
    expect(configurable.providers.value.some(provider => provider.id === 'openai')).toBe(true)
  })

  it('does not expose bundled or public metadata as callable models', () => {
    const model = {
      id: 'grok-4.6', name: 'Grok 4.6',
      context_window: 500_000, max_tokens: 32_768, input: ['text'] as ('text' | 'image')[],
    }
    installAppModelSettings({
      providers: {},
      relay: {
        enabled: true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: true,
      },
    })

    installModelCatalog({
      provider: 'tokenflux', source: 'bundled', credential_source: 'bundled',
      refreshed_at: '2026-08-15T00:00:00Z', models: [model],
    })
    expect(useModelCatalog().providers.value).toEqual([])

    installModelCatalog({
      provider: 'tokenflux', source: 'remote', credential_source: 'public',
      refreshed_at: '2026-08-15T00:01:00Z', models: [model],
    })
    expect(useModelCatalog().providers.value).toEqual([])

    installModelCatalog({
      provider: 'tokenflux', source: 'cache', credential_source: 'account',
      refreshed_at: '2026-08-15T00:02:00Z', models: [model],
    })
    expect(useModelCatalog().providers.value.map(provider => provider.id)).toEqual(['tokenflux'])
  })

  it('lists only enabled services for the shared Coding and Settings picker', () => {
    installModelCatalog({
      provider: 'tokenflux',
      source: 'remote',
      credential_source: 'merged',
      account_model_ids: ['grok-4.5'],
      models: [
        { id: 'grok-4.5', name: 'Grok 4.5', context_window: 128000, max_tokens: 32768, input: ['text', 'image'] },
        { id: 'GPT/gpt-5', name: 'GPT 5', context_window: 128000, max_tokens: 32768, input: ['text'] },
      ],
    })
    installAppModelSettings({
      providers: {
        tokenflux: {
          api_key: '',
          has_api_key: true,
          enabled: false,
          base_url: 'https://tokenflux.dev/v1',
        },
        deepseek: {
          api_key: '',
          has_api_key: true,
          enabled: true,
          base_url: 'https://api.deepseek.com',
        },
      },
      relay: {
        enabled: true,
        url: 'https://tokenflux.dev/v1',
        key: '',
        has_key: true,
      },
    })

    const { providers } = useModelCatalog()
    expect(providers.value.map(provider => provider.id).sort()).toEqual(['deepseek', 'tokenflux'])
    expect(providers.value.find(provider => provider.id === 'tokenflux')?.models).toEqual(['grok-4.5'])
    expect(providers.value.find(provider => provider.id === 'deepseek')?.models).toContain('deepseek-v4-pro')
  })
})
