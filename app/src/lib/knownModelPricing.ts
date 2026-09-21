// Official lab USD / 1M-token rates from https://models.dev/ (api.json).
// Product runtime must not fetch models.dev. Refresh this table before each
// release together with knownContextWindow / modelThinking (see release-process §1.5).
// Checked against models.dev official labs on 2026-09-21.

export interface ModelTokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** USD charged per one million tokens. Missing cache/reasoning fields mean 0. */
export interface ModelPricingRate {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}

type PricingRow = [string, ModelPricingRate]

// Specific series must precede broader family presets.
const knownModelPricing: PricingRow[] = [
  ['deepseek-v4-pro', { input: 0.435, output: 0.87, cacheRead: 0.003625, reasoning: 0.87 }],
  ['deepseek-v4-flash', { input: 0.15, output: 0.6, cacheRead: 0.003, reasoning: 0.6 }],
  ['deepseek-flash', { input: 0.15, output: 0.6, cacheRead: 0.003, reasoning: 0.6 }],
  ['deepseek-', { input: 0.15, output: 0.6, cacheRead: 0.003, reasoning: 0.6 }],
  ['grok-4.6', { input: 2, output: 6, cacheRead: 0.5 }],
  ['grok-4.5', { input: 2, output: 6, cacheRead: 0.3 }],
  ['grok-4.20', { input: 1.25, output: 2.5, cacheRead: 0.2 }],
  ['grok-4.3', { input: 1.25, output: 2.5, cacheRead: 0.2 }],
  ['grok-build-', { input: 1, output: 2, cacheRead: 0.2 }],
  ['grok-4', { input: 1.25, output: 2.5, cacheRead: 0.2 }],
  ['gpt-5.6', { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 }],
  ['gpt-5.5-pro', { input: 30, output: 180 }],
  ['gpt-5.5', { input: 5, output: 30, cacheRead: 0.5 }],
  ['gpt-5.4-pro', { input: 30, output: 180 }],
  ['gpt-5.4-mini', { input: 0.75, output: 4.5, cacheRead: 0.075 }],
  ['gpt-5.4-nano', { input: 0.2, output: 1.25, cacheRead: 0.02 }],
  ['gpt-5.4', { input: 2.5, output: 15, cacheRead: 0.25 }],
  ['gpt-5.3-codex', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.3-chat', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5.2-pro', { input: 21, output: 168 }],
  ['gpt-5.2', { input: 1.75, output: 14, cacheRead: 0.175 }],
  ['gpt-5-pro', { input: 15, output: 120 }],
  ['gpt-5-mini', { input: 0.25, output: 2, cacheRead: 0.025 }],
  ['gpt-5-nano', { input: 0.05, output: 0.4, cacheRead: 0.005 }],
  ['gpt-5', { input: 1.25, output: 10, cacheRead: 0.125 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6, cacheRead: 0.1 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4, cacheRead: 0.025 }],
  ['gpt-4.1', { input: 2, output: 8, cacheRead: 0.5 }],
  ['gpt-4o-mini', { input: 0.15, output: 0.6, cacheRead: 0.075 }],
  ['gpt-4o', { input: 2.5, output: 10, cacheRead: 1.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-sonnet-4.6', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['claude-sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['claude-sonnet-4.5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['claude-sonnet-4-5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['claude-opus-4.8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4.7', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4.6', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4.5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-haiku-4.5', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ['claude-', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['gemini-3.1-pro', { input: 2, output: 12, cacheRead: 0.2 }],
  ['gemini-3.8-flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }],
  ['gemini-3.7-flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }],
  ['gemini-3.6-flash', { input: 0.75, output: 3.75, cacheRead: 0.075 }],
  ['gemini-3.5-flash', { input: 1.5, output: 9, cacheRead: 0.15 }],
  ['gemini-3-flash', { input: 0.5, output: 3, cacheRead: 0.05 }],
  ['gemini-3', { input: 2, output: 12, cacheRead: 0.2 }],
  ['gemini-2.5-pro', { input: 1.25, output: 10, cacheRead: 0.125 }],
  ['gemini-2.5-flash', { input: 0.3, output: 2.5, cacheRead: 0.03 }],
  ['gemini-', { input: 0.3, output: 2.5, cacheRead: 0.03 }],
  ['qwen3.8-max', { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 }],
  ['qwen3.8-flash', { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 }],
  ['qwen3.8', { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 }],
  ['qwen3-coder-plus', { input: 1, output: 5 }],
  ['qwen3-coder', { input: 1, output: 5 }],
  ['qwen3-max', { input: 1.2, output: 6 }],
]

function canonicalModelKey(id: string) {
  const value = String(id ?? '').trim().toLowerCase()
  if (!value) return ''
  const slash = value.lastIndexOf('/')
  return slash >= 0 ? value.slice(slash + 1) : value
}

function nonNegative(value: number | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) < 0) return 0
  return value ?? 0
}

export function lookupKnownModelPricing(model: string): ModelPricingRate | undefined {
  const key = canonicalModelKey(model)
  if (!key) return undefined
  const row = knownModelPricing.find(([prefix]) => key === prefix || key.startsWith(prefix))
  return row?.[1]
}

/** Estimate USD from token buckets and a pinned models.dev rate. Not a bill. */
export function estimateUsageCostUsd(
  model: string,
  usage: ModelTokenUsage,
): number | undefined {
  const rate = lookupKnownModelPricing(model)
  if (!rate) return undefined
  const input = nonNegative(usage.inputTokens)
  const output = nonNegative(usage.outputTokens)
  const cacheRead = nonNegative(usage.cacheReadTokens)
  const cacheWrite = nonNegative(usage.cacheWriteTokens)
  const reasoning = nonNegative(usage.reasoningTokens)
  const perMillion = (tokens: number, usdPerMillion: number) => (tokens / 1_000_000) * usdPerMillion
  // Prefer billed output over a separate reasoning bucket when rates match, so
  // providers that already fold thinking into output are not double-counted.
  const reasoningRate = rate.reasoning
  const chargeReasoningSeparately = reasoning > 0
    && reasoningRate !== undefined
    && reasoningRate !== rate.output
  return (
    perMillion(input, rate.input)
    + perMillion(output, rate.output)
    + perMillion(cacheRead, rate.cacheRead ?? 0)
    + perMillion(cacheWrite, rate.cacheWrite ?? 0)
    + (chargeReasoningSeparately ? perMillion(reasoning, reasoningRate) : 0)
  )
}

export function formatEstimatedUsd(amount: number | undefined, locale: 'zh' | 'en' = 'zh') {
  if (amount === undefined || !Number.isFinite(amount)) {
    return locale === 'zh' ? '暂无估价' : 'No estimate'
  }
  if (amount < 0.005 && amount > 0) {
    return locale === 'zh' ? '约 <$0.01' : 'est. <$0.01'
  }
  const digits = amount < 0.1 ? 3 : amount < 10 ? 2 : 2
  const body = amount.toLocaleString(locale === 'zh' ? 'en-US' : 'en-US', {
    minimumFractionDigits: amount < 1 ? digits : 2,
    maximumFractionDigits: digits,
  })
  return locale === 'zh' ? `约 $${body}` : `est. $${body}`
}
