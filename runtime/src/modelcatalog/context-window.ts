const PLACEHOLDER_CONTEXT_WINDOW = 128_000
const PLACEHOLDER_MAX_8K = 8_192
const PLACEHOLDER_MAX_16K = 16_384
const PLACEHOLDER_MAX_32K = 32_768

type KnownLimit = { key: string; window: number; maxTokens: number }

const KNOWN_MODEL_LIMITS: KnownLimit[] = [
  { key: 'grok-4.7', window: 500_000, maxTokens: 500_000 },
  { key: 'grok-4.6', window: 500_000, maxTokens: 500_000 },
  { key: 'grok-4.5', window: 500_000, maxTokens: 500_000 },
  { key: 'grok-4.20', window: 1_000_000, maxTokens: 30_000 },
  { key: 'grok-4.3', window: 1_000_000, maxTokens: 30_000 },
  { key: 'grok-4', window: 1_000_000, maxTokens: 30_000 },
  { key: 'grok-build-', window: 256_000, maxTokens: 256_000 },
  { key: 'grok-', window: 128_000, maxTokens: 0 },
  { key: 'gpt-6', window: 1_050_000, maxTokens: 128_000 },
  { key: 'gpt-5.6', window: 1_050_000, maxTokens: 128_000 },
  { key: 'gpt-5.5', window: 1_050_000, maxTokens: 128_000 },
  { key: 'gpt-5.4-mini', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5.4-nano', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5.4', window: 1_050_000, maxTokens: 128_000 },
  { key: 'gpt-5.3-chat', window: 128_000, maxTokens: 16_384 },
  { key: 'gpt-5.3-codex-spark', window: 128_000, maxTokens: 32_000 },
  { key: 'gpt-5.3-codex', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5.2-chat', window: 128_000, maxTokens: 16_384 },
  { key: 'gpt-5.2-codex', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5.2-pro', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5.2', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-5-pro', window: 400_000, maxTokens: 272_000 },
  { key: 'gpt-5', window: 400_000, maxTokens: 128_000 },
  { key: 'gpt-4.1', window: 1_047_576, maxTokens: 32_768 },
  { key: 'gpt-4o', window: 128_000, maxTokens: 16_384 },
  { key: 'gpt-', window: 128_000, maxTokens: 0 },
  { key: 'claude-fable-5', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-mythos-5', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-mythos-preview', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-5', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-sonnet-5', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-sonnet-4.6', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-sonnet-4-6', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-sonnet-4.5', window: 1_000_000, maxTokens: 64_000 },
  { key: 'claude-sonnet-4-5', window: 1_000_000, maxTokens: 64_000 },
  { key: 'claude-opus-4.8', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4-8', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4.7', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4-7', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4.6', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4-6', window: 1_000_000, maxTokens: 128_000 },
  { key: 'claude-opus-4.5', window: 200_000, maxTokens: 64_000 },
  { key: 'claude-opus-4-5', window: 200_000, maxTokens: 64_000 },
  { key: 'claude-haiku-4.5', window: 200_000, maxTokens: 64_000 },
  { key: 'claude-haiku-4-5', window: 200_000, maxTokens: 64_000 },
  { key: 'claude-', window: 200_000, maxTokens: 64_000 },
  { key: 'deepseek-v4-flash', window: 1_000_000, maxTokens: 393_216 },
  { key: 'deepseek-v4', window: 1_000_000, maxTokens: 393_216 },
  { key: 'deepseek-flash', window: 1_000_000, maxTokens: 393_216 },
  { key: 'deepseek-', window: 1_000_000, maxTokens: 393_216 },
  { key: 'gemini-3.1-flash-image-preview', window: 65_536, maxTokens: 65_536 },
  { key: 'gemini-3.1-flash-image', window: 131_072, maxTokens: 32_768 },
  { key: 'gemini-3.1-flash-lite-image', window: 65_536, maxTokens: 4_096 },
  { key: 'gemini-3.1-flash-live', window: 131_072, maxTokens: 65_536 },
  { key: 'gemini-3-pro-image-preview', window: 131_072, maxTokens: 32_768 },
  { key: 'gemini-3-pro-image', window: 65_536, maxTokens: 32_768 },
  { key: 'gemini-3', window: 1_048_576, maxTokens: 65_536 },
  { key: 'gemini-2.5', window: 1_048_576, maxTokens: 65_536 },
  { key: 'gemini-', window: 1_048_576, maxTokens: 65_536 },
  { key: 'qwen3.8', window: 1_000_000, maxTokens: 131_072 },
  { key: 'qwen3.7', window: 1_000_000, maxTokens: 131_072 },
  { key: 'qwen3.6-plus', window: 1_000_000, maxTokens: 65_536 },
  { key: 'qwen3.6-flash', window: 1_000_000, maxTokens: 65_536 },
  { key: 'qwen3.6-27b', window: 262_144, maxTokens: 65_536 },
  { key: 'qwen3.6-35b', window: 262_144, maxTokens: 65_536 },
  { key: 'qwen3-coder-plus', window: 1_048_576, maxTokens: 65_536 },
  { key: 'qwen3-coder-480b', window: 262_144, maxTokens: 65_536 },
  { key: 'qwen3-coder-30b', window: 262_144, maxTokens: 65_536 },
  { key: 'qwen3-coder', window: 1_000_000, maxTokens: 65_536 },
]

function canonicalModelKey(id: string): string {
  let value = String(id ?? '').trim().toLowerCase()
  const index = value.lastIndexOf('/')
  if (index >= 0) value = value.slice(index + 1)
  return value
}

function lookupKnownLimit(id: string): KnownLimit | undefined {
  const key = canonicalModelKey(id)
  if (!key) return undefined
  return KNOWN_MODEL_LIMITS.find((entry) => key === entry.key || key.startsWith(entry.key))
}

export function resolveModelContextWindow(id: string, catalogWindow: number): number {
  const known = lookupKnownLimit(id)?.window ?? 0
  if (catalogWindow > 0 && catalogWindow !== PLACEHOLDER_CONTEXT_WINDOW) return catalogWindow
  if (known > 0) return known
  return catalogWindow > 0 ? catalogWindow : 0
}

export function resolveModelMaxTokens(id: string, catalogMax: number): number {
  const known = lookupKnownLimit(id)?.maxTokens ?? 0
  const placeholder = catalogMax === PLACEHOLDER_MAX_8K || catalogMax === PLACEHOLDER_MAX_16K || catalogMax === PLACEHOLDER_MAX_32K
  if (catalogMax > 0 && !placeholder) return catalogMax
  if (known > 0) return known
  return catalogMax > 0 ? catalogMax : 0
}

export function resolveSettingsContextWindow(
  settings: { model_context_windows?: Record<string, Record<string, number>> },
  provider: string,
  model: string,
  catalogWindow: number,
): number {
  const override = settings.model_context_windows?.[provider]?.[model]
  if (override && override > 0) return Math.min(10_000_000, Math.max(1024, override))
  return catalogWindow > 0 ? catalogWindow : 0
}
