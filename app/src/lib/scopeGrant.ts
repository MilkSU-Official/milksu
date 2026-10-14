export type ScopeTargetKind = 'origin' | 'directory' | 'socket' | 'ssh' | 'lab' | 'browser_tab'

export interface ScopeTarget {
  kind: ScopeTargetKind
  value: string
}

export interface ScopeGrant {
  id: string
  source: string
  purpose: string
  targets: ScopeTarget[]
  grantedBy: string
  createdAt: string
  expiresAt: string
  revocable: boolean
  revokedAt?: string
}
