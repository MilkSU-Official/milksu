export type EnvOwnerKind = 'lab' | 'cve'

export type EnvPackage = {
  id: string
  name: string
  kindLabel: string
  detail: string
  provider: string
  surface: 'browser' | 'shell' | 'emulator' | 'device'
  address: string
  port?: number
  cveIds?: string[]
}

export type EnvLease = {
  schema?: string
  ownerKind: EnvOwnerKind | string
  ownerId: string
  packageId?: string
  packageName?: string
  provider: string
  surface?: EnvPackage['surface'] | string
  state: 'none' | 'docker-down' | 'stopped' | 'pulling' | 'ready' | 'busy' | 'failed' | string
  address?: string
  detail?: string
  error?: string
  occupyOwner?: string
  dockerAvailable?: boolean
  updatedAt?: string
}

export type EnvOwnerRequest = {
  ownerKind: EnvOwnerKind
  ownerId: string
  packageId?: string
}
