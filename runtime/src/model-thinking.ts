import type { AppSettings } from './config/settings-store.ts'

export const MODEL_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number]

export type ModelThinkingConfig = {
  enabled: boolean
  levels: ModelThinkingLevel[]
  default_level?: ModelThinkingLevel
}

export type ModelThinkingProfile = {
  enabled: boolean
  levels?: ModelThinkingLevel[]
  level?: ModelThinkingLevel
}

type ThinkingSettings = Pick<AppSettings, 'model_thinking'>

export function resolveModelThinking(
  settings: ThinkingSettings | null | undefined,
  provider: string,
  model: string,
  requested: string,
): ModelThinkingProfile {
  const name = String(provider ?? '').trim()
  const id = String(model ?? '').trim()
  const manual = settings?.model_thinking?.[name]?.[id]
  const configured = normalizeModelThinkingConfig(
    manual ?? builtInModelThinking(id) ?? { enabled: false, levels: [] },
  )
  if (!configured.enabled || configured.levels.length === 0) {
    return { enabled: false }
  }
  const level = normalizeThinkingLevel(requested)
  const resolved = level && configured.levels.includes(level)
    ? level
    : configured.default_level && configured.levels.includes(configured.default_level)
      ? configured.default_level
      : configured.levels[0]
  return {
    enabled: true,
    levels: [...configured.levels],
    level: resolved,
  }
}

export function normalizeModelThinkingConfig(
  value: Partial<ModelThinkingConfig> | null | undefined,
): ModelThinkingConfig {
  const selected = new Set((value?.levels ?? []).flatMap((item) => {
    const normalized = normalizeThinkingLevel(item)
    return normalized ? [normalized] : []
  }))
  const levels = MODEL_THINKING_LEVELS.filter((item) => selected.has(item))
  const requestedDefault = normalizeThinkingLevel(value?.default_level)
  if (!value?.enabled) {
    return {
      enabled: false,
      levels,
      ...(levels.length
        ? {
            default_level: requestedDefault && levels.includes(requestedDefault)
              ? requestedDefault
              : preferredThinkingDefault(levels),
          }
        : {}),
    }
  }
  if (!levels.length) levels.push('low', 'medium', 'high')
  return {
    enabled: true,
    levels,
    default_level: requestedDefault && levels.includes(requestedDefault)
      ? requestedDefault
      : preferredThinkingDefault(levels),
  }
}

export function builtInModelThinking(model: string): ModelThinkingConfig | undefined {
  const id = canonicalThinkingModelID(model)
  const profile = (
    levels: ModelThinkingLevel[],
    defaultLevel: ModelThinkingLevel,
  ): ModelThinkingConfig => ({
    enabled: true,
    levels,
    default_level: defaultLevel,
  })

  if (
    id.includes('claude-fable-5')
    || id.includes('claude-opus-5')
    || id.includes('claude-opus-4-8')
    || id.includes('claude-opus-4-7')
    || id.includes('claude-sonnet-5')
  ) {
    return profile(['low', 'medium', 'high', 'xhigh', 'max'], 'high')
  }
  if (id.includes('claude-opus-4-6') || id.includes('claude-sonnet-4-6')) {
    return profile(['low', 'medium', 'high', 'max'], 'high')
  }
  if (id.includes('claude-opus-4-5')) {
    return profile(['low', 'medium', 'high'], 'high')
  }
  if (
    id.includes('claude-opus-')
    || id.includes('claude-sonnet-')
    || id.includes('claude-fable-')
  ) {
    return profile(['low', 'medium', 'high'], 'high')
  }

  if (id.includes('gpt-6-luna') || id.includes('gpt-6-sol')) {
    return profile(['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium')
  }
  if (id.includes('gpt-6')) {
    return profile(['low', 'medium', 'high', 'xhigh', 'max'], 'medium')
  }
  if (id.includes('gpt-5-6')) {
    return profile(['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'medium')
  }
  if (
    id.includes('gpt-5-5-pro')
    || id.includes('gpt-5-4-pro')
    || id.includes('gpt-5-2-pro')
  ) {
    return profile(['medium', 'high', 'xhigh'], 'high')
  }
  if (id.includes('gpt-5-pro')) return profile(['high'], 'high')
  if (
    id.includes('gpt-5-5')
    || id.includes('gpt-5-4')
    || id.includes('gpt-5-3')
    || id.includes('gpt-5-2')
  ) {
    return profile(['off', 'low', 'medium', 'high', 'xhigh'], 'medium')
  }
  if (id.includes('gpt-5-1')) {
    return profile(['off', 'low', 'medium', 'high'], 'medium')
  }
  if (id.includes('gpt-5') && !id.includes('chat')) {
    return profile(['minimal', 'low', 'medium', 'high'], 'medium')
  }

  if (id.includes('deepseek-v4-pro')) {
    return profile(['low', 'high', 'max'], 'high')
  }
  if (id.includes('deepseek-v4-flash') || id.includes('deepseek-flash')) {
    return profile(['low', 'high', 'max'], 'high')
  }

  if (id.includes('grok-4-7') || id.includes('grok-4-6') || id.includes('grok-4-20-multi-agent')) {
    return profile(['low', 'medium', 'high', 'xhigh'], 'medium')
  }
  if (id.includes('grok-4-5')) {
    return profile(['low', 'medium', 'high'], 'medium')
  }
  if (id.includes('grok-4-3')) {
    return profile(['off', 'low', 'medium', 'high'], 'medium')
  }

  if (
    id.includes('gemini-3-8')
    || id.includes('gemini-3-7')
    || id.includes('gemini-3-1-pro')
  ) {
    return profile(['low', 'medium', 'high'], 'medium')
  }
  if (
    id.includes('gemini-3-6')
    || id.includes('gemini-3-5')
    || id.includes('gemini-3-1-flash')
    || id.includes('gemini-3-flash')
  ) {
    return profile(['minimal', 'low', 'medium', 'high'], 'medium')
  }

  if (id.includes('qwen3-8-flash') || id.includes('qwen3-8-max')) {
    return profile(['low', 'medium', 'xhigh'], 'medium')
  }

  const base = id.split('/').at(-1) ?? id
  if (/^o[1-9](?:-|$)/u.test(base)) {
    return profile(['low', 'medium', 'high'], 'medium')
  }
  return undefined
}

function normalizeThinkingLevel(value: unknown): ModelThinkingLevel | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  return MODEL_THINKING_LEVELS.find((level) => level === normalized)
}

function preferredThinkingDefault(levels: readonly ModelThinkingLevel[]): ModelThinkingLevel {
  return (['medium', 'high', 'low', 'minimal', 'off', 'xhigh', 'max'] as const)
    .find((candidate) => levels.includes(candidate)) ?? levels[0] ?? 'medium'
}

function canonicalThinkingModelID(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll('.', '-')
}
