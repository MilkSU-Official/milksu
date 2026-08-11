import { describe, expect, it } from 'vitest'
import {
  normalizeModelRouting,
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
    expect(tokenflux?.defaultBaseUrl).toBe('https://tokenflux.dev/v1')
    expect(tokenflux?.envKey).toBe('TOKENFLUX_API_KEY')
    expect(tokenflux?.models).toEqual(expect.arrayContaining([
      'grok-4.3',
      'grok-4.5',
      'anthropic/claude-sonnet-4.6',
      'deepseek/deepseek-v4-flash',
    ]))
    expect(tokenflux?.visionModels).toEqual(expect.arrayContaining([
      'grok-4.5',
      'openai/gpt-4o',
    ]))
    expect(providerModelLabel('tokenflux', 'grok-4.3'))
      .toBe('TokenFlux · Grok 4.3')
  })

  it('keeps Supergrok grok-4.5 first, image-capable, and drops the retired grok-build-0.1', () => {
    const tokenflux = PROVIDERS.find(provider => provider.id === 'tokenflux')
    const tokenfluxModels = tokenflux?.models ?? []

    expect(tokenfluxModels).not.toContain('grok-build-0.1')
    expect(tokenfluxModels.indexOf('grok-4.5')).toBeGreaterThanOrEqual(0)
    expect(tokenfluxModels.indexOf('grok-4.5'))
      .toBeLessThan(tokenfluxModels.indexOf('grok-4.3'))
    expect(tokenflux?.visionModels).toContain('grok-4.5')
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
    expect(settings.model_routing).toEqual({
      source_order: ['account', 'personal'],
      auto_fallback: true,
    })
    expect(settings.disabled_skills).toEqual([])
  })

  it('normalizes disabled reviewed skill names without accepting paths', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'deepseek',
      active_model: 'deepseek-v4-flash',
      model_routing: { source_order: ['account', 'personal'], auto_fallback: true },
      providers: {},
      disabled_skills: [' product-design ', 'product-design', '../../untrusted', 'review-security'],
    })

    expect(settings.disabled_skills).toEqual(['product-design', 'review-security'])
  })

  it('keeps an explicit personal-first order and disabled fallback', () => {
    expect(normalizeModelRouting({
      source_order: ['personal', 'personal'],
      auto_fallback: false,
    })).toEqual({
      source_order: ['personal', 'account'],
      auto_fallback: false,
    })
  })
})
