// Official lab facts come from https://models.dev/. Keep in sync with
// internal/modelcatalog/context_window.go and sidecar/pi/known-context-window.cjs.
import type { AppSettings } from '@/types'

export const MIN_MODEL_CONTEXT_WINDOW = 1024
export const MAX_MODEL_CONTEXT_WINDOW = 10_000_000

const PLACEHOLDER_CONTEXT_WINDOW = 128_000
const PLACEHOLDER_MAX_TOKENS = new Set([8_192, 16_384, 32_768])

const knownModelLimits: Array<[string, number, number]> = [
  ['grok-4.7', 500_000, 500_000],
  ['grok-4.6', 500_000, 500_000],
  ['grok-4.5', 500_000, 500_000],
  ['grok-4.20', 1_000_000, 30_000],
  ['grok-4.3', 1_000_000, 30_000],
  ['grok-4', 1_000_000, 30_000],
  ['grok-build-', 256_000, 256_000],
  ['grok-', 128_000, 0],
  ['gpt-6', 1_050_000, 128_000],
  ['gpt-5.6', 1_050_000, 128_000],
  ['gpt-5.5', 1_050_000, 128_000],
  ['gpt-5.4-mini', 400_000, 128_000],
  ['gpt-5.4-nano', 400_000, 128_000],
  ['gpt-5.4', 1_050_000, 128_000],
  ['gpt-5.3-chat', 128_000, 16_384],
  ['gpt-5.3-codex-spark', 128_000, 32_000],
  ['gpt-5.3-codex', 400_000, 128_000],
  ['gpt-5.2-chat', 128_000, 16_384],
  ['gpt-5.2-codex', 400_000, 128_000],
  ['gpt-5.2-pro', 400_000, 128_000],
  ['gpt-5.2', 400_000, 128_000],
  ['gpt-5-pro', 400_000, 272_000],
  ['gpt-5', 400_000, 128_000],
  ['gpt-4.1', 1_047_576, 32_768],
  ['gpt-4o', 128_000, 16_384],
  ['gpt-', 128_000, 0],
  ['claude-fable-5', 1_000_000, 128_000],
  ['claude-mythos-5', 1_000_000, 128_000],
  ['claude-mythos-preview', 1_000_000, 128_000],
  ['claude-opus-5', 1_000_000, 128_000],
  ['claude-sonnet-5', 1_000_000, 128_000],
  ['claude-sonnet-4.6', 1_000_000, 128_000],
  ['claude-sonnet-4-6', 1_000_000, 128_000],
  ['claude-sonnet-4.5', 1_000_000, 64_000],
  ['claude-sonnet-4-5', 1_000_000, 64_000],
  ['claude-opus-4.8', 1_000_000, 128_000],
  ['claude-opus-4-8', 1_000_000, 128_000],
  ['claude-opus-4.7', 1_000_000, 128_000],
  ['claude-opus-4-7', 1_000_000, 128_000],
  ['claude-opus-4.6', 1_000_000, 128_000],
  ['claude-opus-4-6', 1_000_000, 128_000],
  ['claude-opus-4.5', 200_000, 64_000],
  ['claude-opus-4-5', 200_000, 64_000],
  ['claude-haiku-4.5', 200_000, 64_000],
  ['claude-haiku-4-5', 200_000, 64_000],
  ['claude-', 200_000, 64_000],
  ['deepseek-v4-flash', 1_000_000, 393_216],
  ['deepseek-v4', 1_000_000, 393_216],
  ['deepseek-flash', 1_000_000, 393_216],
  ['deepseek-', 1_000_000, 393_216],
  ['gemini-3.1-flash-image-preview', 65_536, 65_536],
  ['gemini-3.1-flash-image', 131_072, 32_768],
  ['gemini-3.1-flash-lite-image', 65_536, 4_096],
  ['gemini-3.1-flash-live', 131_072, 65_536],
  ['gemini-3-pro-image-preview', 131_072, 32_768],
  ['gemini-3-pro-image', 65_536, 32_768],
  ['gemini-3', 1_048_576, 65_536],
  ['gemini-2.5', 1_048_576, 65_536],
  ['gemini-', 1_048_576, 65_536],
  ['qwen3.8', 1_000_000, 131_072],
  ['qwen3.7', 1_000_000, 131_072],
  ['qwen3.6-plus', 1_000_000, 65_536],
  ['qwen3.6-flash', 1_000_000, 65_536],
  ['qwen3.6-27b', 262_144, 65_536],
  ['qwen3.6-35b', 262_144, 65_536],
  ['qwen3-coder-plus', 1_048_576, 65_536],
  ['qwen3-coder-480b', 262_144, 65_536],
  ['qwen3-coder-30b', 262_144, 65_536],
  ['qwen3-coder', 1_000_000, 65_536],
]

function canonicalModelKey(id: string) {
  const value = String(id ?? '').trim().toLowerCase()
  if (!value) return ''
  const slash = value.lastIndexOf('/')
  return slash >= 0 ? value.slice(slash + 1) : value
}

function lookupKnownLimit(id: string) {
  const key = canonicalModelKey(id)
  if (!key) return undefined
  return knownModelLimits.find(([prefix]) => key === prefix || key.startsWith(prefix))
}

export function clampModelContextWindow(value: number) {
  return Math.min(MAX_MODEL_CONTEXT_WINDOW, Math.max(MIN_MODEL_CONTEXT_WINDOW, value))
}

export function modelContextWindowOverride(
  windows: AppSettings['model_context_windows'] | null | undefined,
  provider?: string,
  model?: string,
): number | undefined {
  const providerId = String(provider ?? '').trim()
  const modelId = String(model ?? '').trim()
  if (!providerId || !modelId) return undefined
  const parsed = Number(windows?.[providerId]?.[modelId])
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return clampModelContextWindow(Math.floor(parsed))
}

export function normalizeModelContextWindows(
  value: AppSettings['model_context_windows'],
  providers: AppSettings['providers'],
): AppSettings['model_context_windows'] {
  if (!value) return undefined
  const result: NonNullable<AppSettings['model_context_windows']> = {}
  for (const [rawProvider, models] of Object.entries(value)) {
    const provider = rawProvider.trim()
    const configuredProvider = providers[provider]
    if (!provider || (provider !== 'tokenflux' && !configuredProvider?.custom)) continue
    const normalizedModels: Record<string, number> = {}
    for (const [rawModel, window] of Object.entries(models ?? {}).slice(0, 32)) {
      const model = rawModel.trim()
      if (
        !model
        || Array.from(model).length > 256
        || Array.from(model).some(character => {
          const code = character.charCodeAt(0)
          return code === 0 || code === 10 || code === 13
        })
      ) continue
      const parsed = Number(window)
      if (!Number.isFinite(parsed) || parsed <= 0) continue
      normalizedModels[model] = clampModelContextWindow(Math.floor(parsed))
    }
    if (Object.keys(normalizedModels).length) result[provider] = normalizedModels
  }
  return Object.keys(result).length ? result : undefined
}

export function resolveModelContextWindow(
  id: string | undefined,
  catalogWindow?: number,
  override?: number,
) {
  const manual = Number(override)
  if (Number.isFinite(manual) && manual > 0) {
    return clampModelContextWindow(Math.floor(manual))
  }
  const catalog = Number(catalogWindow)
  const catalogValue = Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0
  const known = lookupKnownLimit(String(id ?? ''))?.[1] ?? 0
  if (catalogValue > 0 && catalogValue !== PLACEHOLDER_CONTEXT_WINDOW) return catalogValue
  if (known > 0) return known
  return catalogValue
}

export function formatContextWindowSize(tokens?: number) {
  const value = Math.floor(Number(tokens) || 0)
  if (value <= 0) return ''
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

export function resolveModelMaxTokens(
  id: string | undefined,
  catalogMax?: number,
) {
  const catalog = Number(catalogMax)
  const catalogValue = Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0
  const known = lookupKnownLimit(String(id ?? ''))?.[2] ?? 0
  if (catalogValue > 0 && !PLACEHOLDER_MAX_TOKENS.has(catalogValue)) return catalogValue
  if (known > 0) return known
  return catalogValue
}
