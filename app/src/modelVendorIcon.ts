/**
 * Keyword-based model vendor icons for picker rows.
 *
 * Match model id / display name only — never provider service names like
 * "TokenFlux" alone, so a custom relay's `openai/gpt-4.1` still shows OpenAI.
 *
 * Icons come from @lobehub/icons-static-svg (https://icons.lobehub.com/).
 */

export type ModelVendorId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'qwen'
  | 'mistral'
  | 'meta'
  | 'moonshot'
  | 'zhipu'
  | 'minimax'
  | 'cohere'
  | 'perplexity'
  | 'groq'
  | 'unknown'

interface VendorRule {
  id: ModelVendorId
  /** Lowercase substrings; first match in this ordered list wins. */
  keywords: string[]
  /**
   * File stem under @lobehub/icons-static-svg/icons/{stem}.svg
   * Prefer the model brand mark when LobeHub ships both (e.g. claude vs anthropic).
   */
  lobeIcon: string
}

/**
 * More specific tokens first so e.g. `claude-code` does not hit a looser rule
 * later, and `gpt` does not steal `chatgpt` from a different brand.
 */
const VENDOR_RULES: VendorRule[] = [
  {
    id: 'openai',
    lobeIcon: 'openai',
    keywords: [
      'openai',
      'gpt-5',
      'gpt-4',
      'gpt-3',
      'gpt4',
      'gpt3',
      'gpt-',
      'o1-',
      'o1',
      'o3-',
      'o3',
      'o4-',
      'o4',
      'codex',
      'chatgpt',
      'davinci',
    ],
  },
  {
    id: 'anthropic',
    lobeIcon: 'claude',
    keywords: [
      'anthropic',
      'claude',
      'sonnet',
      'opus',
      'haiku',
    ],
  },
  {
    id: 'google',
    lobeIcon: 'gemini',
    keywords: [
      'google',
      'gemini',
      'gemma',
      'palm',
    ],
  },
  {
    id: 'xai',
    lobeIcon: 'grok',
    keywords: [
      'x-ai',
      'xai',
      'grok',
    ],
  },
  {
    id: 'deepseek',
    lobeIcon: 'deepseek',
    keywords: [
      'deepseek',
    ],
  },
  {
    id: 'qwen',
    lobeIcon: 'qwen',
    keywords: [
      'qwen',
      'qwq',
      'tongyi',
      'dashscope',
    ],
  },
  {
    id: 'mistral',
    lobeIcon: 'mistral',
    keywords: [
      'mistral',
      'mixtral',
      'codestral',
      'pixtral',
      'ministral',
    ],
  },
  {
    id: 'meta',
    lobeIcon: 'meta',
    keywords: [
      'meta-llama',
      'meta/',
      'llama',
    ],
  },
  {
    id: 'moonshot',
    lobeIcon: 'kimi',
    keywords: [
      'moonshot',
      'kimi',
    ],
  },
  {
    id: 'zhipu',
    lobeIcon: 'zhipu',
    keywords: [
      'zhipu',
      'chatglm',
      'glm-4',
      'glm-3',
      'glm4',
      'glm3',
    ],
  },
  {
    id: 'minimax',
    lobeIcon: 'minimax',
    keywords: [
      'minimax',
      'abab',
    ],
  },
  {
    id: 'cohere',
    lobeIcon: 'cohere',
    keywords: [
      'cohere',
      'command-r',
      'command-a',
      'aya-',
    ],
  },
  {
    id: 'perplexity',
    lobeIcon: 'perplexity',
    keywords: [
      'perplexity',
      'sonar',
    ],
  },
  {
    id: 'groq',
    lobeIcon: 'groq',
    keywords: [
      'groq',
    ],
  },
]

/** Human-readable vendor name for aria / title. */
export const MODEL_VENDOR_LABELS: Record<ModelVendorId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  mistral: 'Mistral',
  meta: 'Meta',
  moonshot: 'Moonshot',
  zhipu: '智谱',
  minimax: 'MiniMax',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  groq: 'Groq',
  unknown: '未知厂商',
}

const VENDOR_BY_ID = Object.fromEntries(
  VENDOR_RULES.map(rule => [rule.id, rule]),
) as Record<Exclude<ModelVendorId, 'unknown'>, VendorRule>

/**
 * Resolve a model vendor from free-form id / label text via keyword match.
 * Concatenate id and display name so either side can identify the brand.
 */
export function resolveModelVendor(
  modelId: string,
  modelLabel = '',
): ModelVendorId {
  const haystack = `${modelId} ${modelLabel}`.toLowerCase()
  if (!haystack.trim()) return 'unknown'
  for (const rule of VENDOR_RULES) {
    if (rule.keywords.some(keyword => haystack.includes(keyword))) {
      return rule.id
    }
  }
  return 'unknown'
}

/** LobeHub static-svg file stem for a resolved vendor, or null when unknown. */
export function modelVendorLobeIcon(vendor: ModelVendorId): string | null {
  if (vendor === 'unknown') return null
  return VENDOR_BY_ID[vendor]?.lobeIcon ?? null
}

export function modelVendorLabel(vendor: ModelVendorId): string {
  return MODEL_VENDOR_LABELS[vendor] ?? MODEL_VENDOR_LABELS.unknown
}
