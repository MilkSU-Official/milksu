import { describe, expect, it } from 'vitest'
import {
  PROVIDERS,
  PROVIDER_GROUPS,
  providerModelLabel,
  withAppSettingsDefaults,
  type AppSettings,
} from './types'

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

  it('keeps normal model pickers focused on the single daily model path', () => {
    const visibleProviders = PROVIDER_GROUPS.flatMap(group => group.providers.map(provider => provider.id))
    expect(visibleProviders).toContain('deepseek')
    expect(visibleProviders).toContain('tokenflux')
    expect(visibleProviders).not.toContain('kourichat')
  })

  it('normalizes unknown pre-release providers back to the current daily model', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'legacy-relay',
      active_model: 'legacy-model',
      providers: {},
    } as AppSettings)

    expect(settings.active_provider).toBe('deepseek')
    expect(settings.active_model).toBe('deepseek-v4-flash')
    expect('model_routing' in settings).toBe(false)
  })
})
