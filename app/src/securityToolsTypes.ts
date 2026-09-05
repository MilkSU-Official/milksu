export type SecurityToolStatus =
  | 'ready'
  | 'detected'
  | 'needs_setup'
  | 'missing_app'
  | 'unavailable'
  | 'configuring'
  | 'failed'

export interface SecurityToolSnapshot {
  id: string
  name: string
  purpose: string
  status: SecurityToolStatus
  statusLabel: string
  enabled: boolean
  usableByAgent: boolean
  version?: string
  connection: string
  runtime: string
  capabilities: string[]
  schema: string[]
  problem?: string
  primaryAction?: string
  setupSupported: boolean
  codingSupported: boolean
}

export interface SecurityToolSetupStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  detail?: string
}

export interface SecurityToolSetupSnapshot {
  toolId: string
  state: 'idle' | 'running' | 'completed' | 'failed'
  percent: number
  summary: string
  steps?: SecurityToolSetupStep[]
  error?: string
  startedAt?: string
  completedAt?: string
}

export interface SecurityToolCodingHandoff {
  toolId: string
  title: string
  prompt: string
  visibleText: string
  workspacePath?: string
  executionMode: 'go'
  approvalPolicy: 'full-auto'
}
