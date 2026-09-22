import { describe, expect, it } from 'vitest'
import {
  effectiveModelThinkingLevel,
  MODEL_THINKING_LEVEL_LABELS,
  normalizeModelThinkingConfig,
  resolveModelThinking,
} from '@/lib/modelThinking'
import type { AppSettings } from '@/types'

const settings = (modelThinking?: AppSettings['model_thinking']) => ({
  model_thinking: modelThinking,
})

describe('model thinking profiles', () => {
  it('uses the canonical English level names as user-visible labels', () => {
    expect(MODEL_THINKING_LEVEL_LABELS).toEqual({
      off: 'off',
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    })
  })

  it('presets reasoning-capable families from models.dev effort lists', () => {
    expect(resolveModelThinking(settings(), 'tokenflux', 'openai/gpt-5.6')).toMatchObject({
      enabled: true,
      defaultLevel: 'medium',
      levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(resolveModelThinking(settings(), 'tokenflux', 'anthropic/claude-fable-5')).toMatchObject({
      enabled: true,
      defaultLevel: 'high',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(resolveModelThinking(settings(), 'tokenflux', 'deepseek-flash')).toMatchObject({
      enabled: true,
      defaultLevel: 'high',
      levels: ['low', 'high', 'max'],
    })
    expect(resolveModelThinking(settings(), 'tokenflux', 'deepseek-v4-pro')).toMatchObject({
      enabled: true,
      defaultLevel: 'high',
      levels: ['low', 'high', 'max'],
    })
    expect(resolveModelThinking(settings(), 'tokenflux', 'x-ai/grok-4.7')).toMatchObject({
      enabled: true,
      defaultLevel: 'medium',
      levels: ['low', 'medium', 'high', 'xhigh'],
    })
    expect(resolveModelThinking(settings(), 'tokenflux', 'x-ai/grok-4.6')).toMatchObject({
      enabled: true,
      defaultLevel: 'medium',
      levels: ['low', 'medium', 'high', 'xhigh'],
    })
  })

  it('requires an explicit override for models outside the preset families', () => {
    expect(resolveModelThinking(settings(), 'tokenflux', 'vendor/unknown-chat').enabled).toBe(false)
    const configured = settings({
      tokenflux: {
        'vendor/unknown-chat': {
          enabled: true,
          levels: ['low', 'high'],
          default_level: 'high',
        },
      },
    })
    const profile = resolveModelThinking(configured, 'tokenflux', 'vendor/unknown-chat')
    expect(profile.source).toBe('manual')
    expect(effectiveModelThinkingLevel(profile, 'medium')).toBe('high')
  })

  it('filters unsupported labels including ultra', () => {
    expect(normalizeModelThinkingConfig({
      enabled: true,
      levels: ['medium', 'ultra', 'max'] as never[],
      default_level: 'ultra' as never,
    })).toEqual({
      enabled: true,
      levels: ['medium', 'max'],
      default_level: 'medium',
    })
    expect(normalizeModelThinkingConfig({
      enabled: false,
      levels: ['low', 'high', 'max'],
      default_level: 'high',
    })).toEqual({
      enabled: false,
      levels: ['low', 'high', 'max'],
      default_level: 'high',
    })
  })
})
