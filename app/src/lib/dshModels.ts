/** DeepSeek Harness ACP catalog from @deepseek-ai/dsh-llm-deepseek. */
export const DSH_ACP_MODEL_IDS = [
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
] as const

const catalog = new Set<string>(DSH_ACP_MODEL_IDS)

export function dshAcpModelLeaf(modelId: string) {
  const raw = String(modelId ?? '').trim().toLowerCase()
  if (!raw) return ''
  const leaf = raw.split('/').pop() ?? raw
  return leaf
}

/** Whether this Settings / composer model id is in the DSH ACP catalog. */
export function dshAcpSupportsModel(modelId: string) {
  const leaf = dshAcpModelLeaf(modelId)
  return Boolean(leaf) && catalog.has(leaf)
}
