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
  it('keeps TokenFlux as a first-class relay while runtime models come from Desktop RPC', () => {
    const tokenflux = PROVIDERS.find(provider => provider.id === 'tokenflux')

    expect(tokenflux).toBeDefined()
    expect(tokenflux?.kind).toBe('relay')
    expect(tokenflux?.defaultBaseUrl).toBe('https://tokenflux.dev/v1')
    expect(tokenflux?.envKey).toBe('TOKENFLUX_API_KEY')
    expect(tokenflux?.models).toEqual([])
    expect(tokenflux?.visionModels).toEqual(['grok-4.5', 'x-ai/grok-4.5'])
    expect(providerModelLabel('tokenflux', 'grok-4.3'))
      .toBe('TokenFlux · Grok 4.3')
    expect(providerModelLabel('tokenflux', 'x-ai/grok-4.6'))
      .toBe('TokenFlux · Grok 4.6')
  })

  it('exposes Groq vision only for its current image-understanding model', () => {
    const groq = PROVIDERS.find(provider => provider.id === 'groq')
    expect(groq?.models).toEqual(['qwen/qwen3.6-27b'])
    expect(groq?.visionModels).toEqual(['qwen/qwen3.6-27b'])
    expect(providerModelLabel('groq', 'qwen/qwen3.6-27b'))
      .toBe('Groq · Qwen 3.6 27B')
  })

  it('preserves a refreshed model selection that is not in bundled provider metadata', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'tokenflux',
      active_model: 'x-ai/grok-4.6',
      providers: {},
    } as AppSettings)
    expect(settings.active_model).toBe('x-ai/grok-4.6')
  })

  it('still rejects an unknown model for a static provider', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'deepseek',
      active_model: 'unknown-model',
      providers: {},
    } as AppSettings)
    expect(settings.active_model).toBe('deepseek-v4-flash')
  })

  it('keeps a configured custom relay and its exact model id', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'custom-relay-team',
      active_model: 'vendor/model:preview',
      model_routing: { source_order: ['personal', 'account'], auto_fallback: true },
      providers: {
        'custom-relay-team': {
          api_key: '',
          has_api_key: true,
          enabled: true,
          custom: true,
          name: 'Team Relay',
          base_url: 'https://relay.example/v1',
          models: ['vendor/model:preview'],
        },
      },
    } as AppSettings)

    expect(settings.active_provider).toBe('custom-relay-team')
    expect(settings.active_model).toBe('vendor/model:preview')
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

    expect(settings.active_provider).toBe('tokenflux')
    expect(settings.active_model).toBe('x-ai/grok-4.6')
    expect(settings.model_routing).toEqual({
      source_order: ['account', 'personal'],
      auto_fallback: false,
    })
    expect(settings.disabled_skills).toEqual([])
  })

  it('normalizes disabled reviewed skill names without accepting paths', () => {
    const settings = withAppSettingsDefaults({
      active_provider: 'deepseek',
      active_model: 'deepseek-v4-flash',
      model_routing: { source_order: ['account', 'personal'], auto_fallback: false },
      providers: {},
      disabled_skills: [' product-design ', 'product-design', '../../untrusted', 'review-security'],
    })

    expect(settings.disabled_skills).toEqual(['product-design', 'review-security'])
  })

  it('keeps an explicit personal-first order and disabled fallback by default', () => {
    expect(normalizeModelRouting({
      source_order: ['personal', 'personal'],
    })).toEqual({
      source_order: ['personal', 'account'],
      auto_fallback: false,
    })
    expect(normalizeModelRouting({
      source_order: ['personal', 'account'],
      auto_fallback: true,
    })).toEqual({
      source_order: ['personal', 'account'],
      auto_fallback: true,
    })
  })
})
