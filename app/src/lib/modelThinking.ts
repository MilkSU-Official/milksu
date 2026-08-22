import type { AppSettings, ModelThinkingConfig, ModelThinkingLevel } from '@/types'

export const MODEL_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ModelThinkingLevel[]

export interface ModelThinkingProfile {
  enabled: boolean
  levels: ModelThinkingLevel[]
  defaultLevel?: ModelThinkingLevel
  source: 'preset' | 'manual' | 'unavailable'
}

export const MODEL_THINKING_LEVEL_LABELS: Record<ModelThinkingLevel, string> = {
  off: '关闭',
  minimal: '最少',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

export function resolveModelThinking(
  settings: Pick<AppSettings, 'model_thinking'> | null | undefined,
  provider: string,
  model: string,
): ModelThinkingProfile {
  const manual = settings?.model_thinking?.[provider]?.[model]
  if (manual !== undefined) return profileFromConfig(manual, 'manual')
  const preset = builtInModelThinking(model)
  return preset
    ? profileFromConfig(preset, 'preset')
    : { enabled: false, levels: [], source: 'unavailable' }
}

export function effectiveModelThinkingLevel(
  profile: ModelThinkingProfile,
  requested: ModelThinkingLevel | string | null | undefined,
): ModelThinkingLevel | undefined {
  const normalized = normalizeThinkingLevel(requested)
  if (normalized && profile.levels.includes(normalized)) return normalized
  if (profile.defaultLevel && profile.levels.includes(profile.defaultLevel)) {
    return profile.defaultLevel
  }
  return profile.levels[0]
}

export function normalizeModelThinkingSettings(
  value: AppSettings['model_thinking'],
  providers: AppSettings['providers'],
): AppSettings['model_thinking'] {
  if (!value) return undefined
  const result: NonNullable<AppSettings['model_thinking']> = {}
  for (const [rawProvider, models] of Object.entries(value)) {
    const provider = rawProvider.trim()
    const configuredProvider = providers[provider]
    if (!provider || (provider !== 'tokenflux' && !configuredProvider?.custom)) continue
    const normalizedModels: Record<string, ModelThinkingConfig> = {}
    for (const [rawModel, configured] of Object.entries(models ?? {}).slice(0, 32)) {
      const model = rawModel.trim()
      if (
        !model
        || Array.from(model).length > 256
        || Array.from(model).some(character => {
          const code = character.charCodeAt(0)
          return code === 0 || code === 10 || code === 13
        })
      ) continue
      normalizedModels[model] = normalizeModelThinkingConfig(configured)
    }
    if (Object.keys(normalizedModels).length) result[provider] = normalizedModels
  }
  return Object.keys(result).length ? result : undefined
}

export function normalizeModelThinkingConfig(
  value: Partial<ModelThinkingConfig> | null | undefined,
): ModelThinkingConfig {
  const selected = new Set((value?.levels ?? []).flatMap(level => {
    const normalized = normalizeThinkingLevel(level)
    return normalized ? [normalized] : []
  }))
  const levels = MODEL_THINKING_LEVELS.filter(level => selected.has(level))
  const requestedDefault = normalizeThinkingLevel(value?.default_level)
  if (!value?.enabled) {
    return {
      enabled: false,
      levels,
      ...(levels.length
        ? { default_level: requestedDefault && levels.includes(requestedDefault)
            ? requestedDefault
            : preferredThinkingDefault(levels) }
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
  if (
    id.includes('claude-opus-')
    || id.includes('claude-sonnet-')
    || id.includes('claude-fable-')
  ) {
    return profile(['low', 'medium', 'high'], 'high')
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

  const base = id.split('/').at(-1) ?? id
  if (/^o[1-9](?:-|$)/u.test(base)) {
    return profile(['low', 'medium', 'high'], 'medium')
  }
  return undefined
}

function profileFromConfig(
  value: ModelThinkingConfig,
  source: ModelThinkingProfile['source'],
): ModelThinkingProfile {
  const normalized = normalizeModelThinkingConfig(value)
  return normalized.enabled
    ? {
        enabled: true,
        levels: [...normalized.levels],
        defaultLevel: normalized.default_level,
        source,
      }
    : { enabled: false, levels: [], source }
}

function normalizeThinkingLevel(value: unknown): ModelThinkingLevel | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  return MODEL_THINKING_LEVELS.find(level => level === normalized)
}

function preferredThinkingDefault(levels: readonly ModelThinkingLevel[]): ModelThinkingLevel {
  return ['medium', 'high', 'low', 'minimal', 'off', 'xhigh', 'max']
    .find((candidate): candidate is ModelThinkingLevel => (
      levels.includes(candidate as ModelThinkingLevel)
    )) ?? levels[0] ?? 'medium'
}

function canonicalThinkingModelID(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll('.', '-')
}
