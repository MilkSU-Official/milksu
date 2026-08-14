import { describe, expect, it } from 'vitest'
import { computed } from 'vue'
import { installCustomProviderSettings, installModelCatalog, providerModelLabel, useModelCatalog } from './modelCatalog'
import type { ProviderConfig } from './types'

describe('runtime model catalog', () => {
  it('replaces the TokenFlux picker with refreshed canonical models and vision metadata', () => {
    installModelCatalog({
      provider: 'tokenflux',
      source: 'remote',
      refreshed_at: '2026-08-13T12:30:00Z',
      models: [
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

    const { providers } = useModelCatalog()
    const tokenflux = providers.value.find(provider => provider.id === 'tokenflux')
    expect(tokenflux?.models).toEqual(['x-ai/grok-4.6', 'openai/gpt-5.6-sol'])
    expect(tokenflux?.visionModels).toEqual(['x-ai/grok-4.6'])
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
})
