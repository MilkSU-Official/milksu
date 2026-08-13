import { describe, expect, it } from 'vitest'
import { installModelCatalog, providerModelLabel, useModelCatalog } from './modelCatalog'

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
})
