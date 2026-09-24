export const MODEL_PROVIDER_APIS = [
  'openai-completions',
  'anthropic-messages',
  'google-generative-ai',
] as const

export type ModelProviderApi = typeof MODEL_PROVIDER_APIS[number]

export const MODEL_PROVIDER_API_LABELS: Record<ModelProviderApi, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'anthropic-messages': 'Anthropic Messages',
  'google-generative-ai': 'Gemini',
}

export interface CatalogModelProvider {
  id: string
  name: string
  api: ModelProviderApi
  baseUrl: string
  models: string[]
}

// Pi already ships these endpoints and one of the three protocols MilkSU can send.
// Bedrock, Vertex, Copilot, Azure, and Responses-only routes stay off this list.
export const CATALOG_MODEL_PROVIDERS: CatalogModelProvider[] = [
  { id: 'anthropic', name: 'Anthropic', api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', models: ['claude-fable-5'] },
  { id: 'baseten', name: 'Baseten', api: 'openai-completions', baseUrl: 'https://inference.baseten.co/v1', models: ['deepseek-ai/DeepSeek-V4-Flash-0731'] },
  { id: 'cerebras', name: 'Cerebras', api: 'openai-completions', baseUrl: 'https://api.cerebras.ai/v1', models: ['gpt-oss-120b'] },
  { id: 'deepseek', name: 'DeepSeek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash'] },
  { id: 'google', name: 'Google', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.5-flash'] },
  { id: 'groq', name: 'Groq', api: 'openai-completions', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
  { id: 'huggingface', name: 'Hugging Face', api: 'openai-completions', baseUrl: 'https://router.huggingface.co/v1', models: ['MiniMaxAI/MiniMax-M2'] },
  { id: 'kimi-coding', name: 'Kimi For Coding', api: 'anthropic-messages', baseUrl: 'https://api.kimi.com/coding', models: ['k3'] },
  { id: 'minimax', name: 'MiniMax', api: 'anthropic-messages', baseUrl: 'https://api.minimax.io/anthropic', models: ['MiniMax-M2.7'] },
  { id: 'minimax-cn', name: 'MiniMax CN', api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', models: ['MiniMax-M2.7'] },
  { id: 'moonshotai', name: 'Moonshot AI', api: 'openai-completions', baseUrl: 'https://api.moonshot.ai/v1', models: ['kimi-k2.6'] },
  { id: 'moonshotai-cn', name: 'Moonshot AI CN', api: 'openai-completions', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.6'] },
  { id: 'nvidia', name: 'NVIDIA', api: 'openai-completions', baseUrl: 'https://integrate.api.nvidia.com/v1', models: ['google/gemma-3-12b-it'] },
  { id: 'openai', name: 'OpenAI', api: 'openai-completions', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4.1'] },
  { id: 'openrouter', name: 'OpenRouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-fable-5'] },
  { id: 'together', name: 'Together', api: 'openai-completions', baseUrl: 'https://api.together.ai/v1', models: ['MiniMaxAI/MiniMax-M2.7'] },
  { id: 'xai', name: 'xAI', api: 'openai-completions', baseUrl: 'https://api.x.ai/v1', models: ['grok-4.5'] },
  { id: 'zai', name: 'Z.AI', api: 'openai-completions', baseUrl: 'https://api.z.ai/api/coding/paas/v4', models: ['glm-5-turbo'] },
  { id: 'zai-coding-cn', name: 'Z.AI Coding CN', api: 'openai-completions', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', models: ['glm-5.3'] },
]

const CATALOG_PROVIDER_ICONS: Record<string, string> = {
  anthropic: 'claude',
  google: 'gemini',
  xai: 'grok',
  moonshotai: 'kimi',
  'moonshotai-cn': 'kimi',
  'kimi-coding': 'kimi',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  zai: 'zai',
  'zai-coding-cn': 'zai',
}

/** LobeHub icon stem for a catalog provider. Same package as model row icons. */
export function catalogProviderIcon(id: string): string {
  return CATALOG_PROVIDER_ICONS[id] ?? id
}

export function catalogModelProvider(id: string): CatalogModelProvider | undefined {
  return CATALOG_MODEL_PROVIDERS.find(item => item.id === id)
}

export function isModelProviderApi(value: string): value is ModelProviderApi {
  return (MODEL_PROVIDER_APIS as readonly string[]).includes(value)
}

export function providerSlug(id: string): string {
  return id.startsWith('custom-relay-') ? id.slice('custom-relay-'.length) : id
}

export function validProviderSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{0,50}$/u.test(slug) && `custom-relay-${slug}`.length <= 64
}
