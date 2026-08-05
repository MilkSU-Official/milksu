export type ManagedLabLifecycle =
  | 'setup-required'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'planned'

export interface ManagedLabDefinition {
  id: string
  packageVersion: string
  instanceId?: string
  endpoint?: string
  message?: string
  challenge: string
  judgeType: string
  launchPath: string
  accessType?: string
  name: string
  vendor: string
  summary: string
  difficulty: '入门' | '进阶'
  categories: readonly string[]
  runtime: 'Docker'
  lifecycle: ManagedLabLifecycle
  startupEstimate: string
  resettable: boolean
  agentAccess: 'planned' | 'supported'
}

export interface ManagedLabPackage {
  id: string
  title: string
  version: string
  role: string
  categories: string[]
  description: string
  license: string
  challenge: string
  judgeType: string
  launchPath: string
  accessType?: string
}

export interface ManagedLabJudgeResult {
  instanceId: string
  packageId: string
  judgeType: string
  challenge: string
  completed: boolean
  solved: boolean
  summary: string
  reference: string
  receiptSha256?: string
  checkedAt: string
}

export interface ManagedLabAccess {
  instanceId: string
  type: string
  username: string
  password: string
  loginUrl: string
}

export interface ManagedLabTrainingWorkspace {
  instance: ManagedLabInstance
  ctf: CTFProjection
  handoff: CTFAgentWorkspaceHandoff
}

export interface ManagedLabJudgeResponse {
  result: ManagedLabJudgeResult
  ctf: CTFProjection
}

export interface ManagedLabInstance {
  instanceId: string
  packageId: string
  projectName: string
  phase: string
  endpoint?: string
  port?: number
  message: string
  updatedAt: string
  packageVersion: string
  imageDigest: string
  recoveryPending?: boolean
}

export type ManagedLabActionKind =
  | 'setup'
  | 'start'
  | 'open'
  | 'train'
  | 'wait'
  | 'retry'
  | 'destroy'
  | 'unavailable'

export interface ManagedLabPresentation {
  statusLabel: string
  statusTone: 'muted' | 'brand' | 'warning' | 'danger'
  actionKind: ManagedLabActionKind
  actionLabel: string
  actionDisabled: boolean
}
import type { CTFAgentWorkspaceHandoff, CTFProjection } from '@/ctfTypes'
