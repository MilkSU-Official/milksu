import { describe, expect, it } from 'vitest'
import {
  effectiveModelThinkingLevel,
  normalizeModelThinkingConfig,
  resolveModelThinking,
} from '@/lib/modelThinking'
import type { AppSettings } from '@/types'

const settings = (modelThinking?: AppSettings['model_thinking']) => ({
  model_thinking: modelThinking,
})

describe('model thinking profiles', () => {
  it('presets GPT and Claude reasoning-capable models', () => {
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
  })

  it('requires an explicit override for models outside the preset families', () => {
    expect(resolveModelThinking(settings(), 'tokenflux', 'x-ai/grok-4.6').enabled).toBe(false)
    const configured = settings({
      tokenflux: {
        'x-ai/grok-4.6': {
          enabled: true,
          levels: ['low', 'high'],
          default_level: 'high',
        },
      },
    })
    const profile = resolveModelThinking(configured, 'tokenflux', 'x-ai/grok-4.6')
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
