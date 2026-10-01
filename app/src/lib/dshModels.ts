

/** DSH ACP official DeepSeek catalog from @deepseek-ai/dsh-llm-deepseek. */
export const DSH_ACP_MODEL_IDS = [
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
] as const

const catalog = new Set<string>(DSH_ACP_MODEL_IDS)

/**
 * Provider ids the DSH multi-provider face can route: the TokenFlux gateway
 * plus the official providers with an installed pi-ai catalog route. Kept in
 * step with dshPIAICatalogProviders on the Go side.
 */
const routedProviderIds = new Set([
  'tokenflux',
  'anthropic',
  'baseten',
  'cerebras',
  'google',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openrouter',
  'together',
  'xai',
  'zai',
  'zai-coding-cn',
])

export function dshAcpModelLeaf(modelId: string) {
  const raw = String(modelId ?? '').trim().toLowerCase()
  if (!raw) return ''
  const leaf = raw.split('/').pop() ?? raw
  return leaf
}

/** Whether a Settings / composer selection routes on the DSH kernel. */
export function dshAcpSupportsModel(modelId: string, providerId = '') {
  const provider = String(providerId ?? '').trim().toLowerCase()
  if (provider === 'deepseek' || provider === 'custom-relay-deepseek') {
    const leaf = dshAcpModelLeaf(modelId)
    return Boolean(leaf) && catalog.has(leaf)
  }
  if (provider) {
    return routedProviderIds.has(provider)
  }
  // Selections without a provider keep the legacy DeepSeek-name check.
  const leaf = dshAcpModelLeaf(modelId)
  return Boolean(leaf) && catalog.has(leaf)
}
