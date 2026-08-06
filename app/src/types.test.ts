import { describe, expect, it } from 'vitest'
import { PROVIDERS, providerModelLabel } from './types'

describe('model provider catalog', () => {
  it('includes TokenFlux Grok and gateway models as a first-class relay provider', () => {
    const tokenflux = PROVIDERS.find(provider => provider.id === 'tokenflux')

    expect(tokenflux).toBeDefined()
    expect(tokenflux?.kind).toBe('relay')
    expect(tokenflux?.defaultBaseUrl).toBe('https://tokenflux.ai/v1')
    expect(tokenflux?.envKey).toBe('TOKENFLUX_API_KEY')
    expect(tokenflux?.models).toEqual(expect.arrayContaining([
      'x-ai/grok-4.3',
      'x-ai/grok-4.5',
      'x-ai/grok-build-0.1',
      'anthropic/claude-sonnet-4.6',
      'deepseek/deepseek-v4-flash',
    ]))
    expect(tokenflux?.visionModels).toContain('openai/gpt-4o')
    expect(providerModelLabel('tokenflux', 'x-ai/grok-4.3'))
      .toBe('TokenFlux · Grok 4.3')
  })
})
