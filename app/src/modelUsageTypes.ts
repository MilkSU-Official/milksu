export interface CodingUsageModelBreakdown {
  provider: string
  model: string
  source: '' | 'account' | 'personal'
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  calls: number
}

export interface CodingUsageToolBreakdown {
  name: string
  calls: number
  failures: number
  durationMs: number
}

export interface CodingUsageDay {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  modelCalls: number
  toolCalls: number
  models: CodingUsageModelBreakdown[]
  tools: CodingUsageToolBreakdown[]
}

export interface CodingUsageHostBreakdown {
  host: 'local' | 'cloud' | string
  turns: number
  modelCostEstUsd: number
  sandboxCostEstUsd: number
  sandboxSeconds: number
}

export interface CodingUsageSnapshot {
  from: string
  to: string
  activeDays: number
  modelCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  localModelCostEstUsd?: number
  cloudModelCostEstUsd?: number
  cloudSandboxCostEstUsd?: number
  hosts?: CodingUsageHostBreakdown[]
  days: CodingUsageDay[]
}

export const EMPTY_CODING_USAGE: CodingUsageSnapshot = {
  from: '',
  to: '',
  activeDays: 0,
  modelCalls: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  localModelCostEstUsd: 0,
  cloudModelCostEstUsd: 0,
  cloudSandboxCostEstUsd: 0,
  hosts: [],
  days: [],
}
