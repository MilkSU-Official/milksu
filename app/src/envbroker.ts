export type EnvOwnerKind = 'lab' | 'cve'

export type EnvChallenge = {
  id: string
  title: string
  kind: string
  guidance: string
}

export type EnvPackage = {
  id: string
  name: string
  category?: string
  kindLabel: string
  detail: string
  source?: string
  purpose?: string
  difficulty?: string
  brief?: string
  provider: string
  surface: 'browser' | 'shell' | 'emulator' | 'device'
  address: string
  port?: number
  cveIds?: string[]
  challenges?: EnvChallenge[]
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
  device?: string
  detail?: string
  error?: string
  occupyOwner?: string
  occupyTitle?: string
  dockerAvailable?: boolean
  updatedAt?: string
}

export type LabEnvironmentStatus = {
  ready: boolean
  canStart: boolean
  canCreate: boolean
  platform: string
  studioFound: boolean
  hasLabAvd: boolean
  sdkRoot: string
  sdkSource: string
  javaHome: string
  javaSource: string
  avdmanager: string
  emulator: string
  adb: string
  systemImage: string
  javaOk: boolean
  missing: string[]
  installUrl: string
  autoDetectSdk: boolean
  autoDetectJava: boolean
}

export type EnvOwnerRequest = {
  ownerKind: EnvOwnerKind
  ownerId: string
  packageId?: string
}
