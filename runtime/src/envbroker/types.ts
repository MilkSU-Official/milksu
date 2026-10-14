export const LEASE_SCHEMA = 'milksu-env-lease/v1'
export const ANDROID_STUDIO_INSTALL_URL = 'https://developer.android.com/studio'
export const LAB_AVD_PREFIX = 'MilkSU-Lab'

export type Owner = {
  kind: string
  id: string
}

export type Challenge = {
  id: string
  title: string
  kind: string
  guidance: string
}

export type Package = {
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
  surface: string
  address: string
  port?: number
  cveIds?: string[]
  challenges?: Challenge[]
  composePath?: string
  apkURL?: string
  apkSHA256?: string
  apkName?: string
  launcher?: string
}

export type PublicPackage = Omit<Package, 'composePath' | 'apkURL' | 'apkSHA256' | 'apkName' | 'launcher'>

export type Lease = {
  schema: string
  ownerKind: string
  ownerId: string
  packageId?: string
  packageName?: string
  provider: string
  surface?: string
  state: string
  address?: string
  device?: string
  detail?: string
  error?: string
  occupyOwner?: string
  occupyTitle?: string
  dockerAvailable?: boolean
  updatedAt: string
}

export type OwnerRequest = {
  ownerKind: string
  ownerId: string
  packageId?: string
}

export type LabEnvironmentProbe = {
  androidSdk?: string
  javaHome?: string
  autoCreateAvd?: boolean
}

export type AndroidTooling = {
  sdkRoot?: string
  javaHome?: string
  autoCreateAVD: boolean
}

export type AndroidToolingStatus = {
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

export type EnvCVEPackage = {
  found: boolean
  package: PublicPackage
}

export function ownerKey(owner: Owner): string {
  return `${owner.kind}:${owner.id}`
}

export function ownerFromLease(lease: Lease): Owner {
  return { kind: lease.ownerKind, id: lease.ownerId }
}

export function emptyLease(owner: Owner): Lease {
  return {
    schema: LEASE_SCHEMA,
    ownerKind: owner.kind,
    ownerId: owner.id,
    provider: '',
    state: 'none',
    updatedAt: new Date().toISOString(),
  }
}

export function publicPackage(item: Package): PublicPackage {
  return {
    id: item.id,
    name: item.name,
    category: item.category || undefined,
    kindLabel: item.kindLabel,
    detail: item.detail,
    source: item.source || undefined,
    purpose: item.purpose || undefined,
    difficulty: item.difficulty || undefined,
    brief: item.brief || undefined,
    provider: item.provider,
    surface: item.surface,
    address: item.address,
    port: item.port || undefined,
    cveIds: item.cveIds?.length ? item.cveIds : undefined,
    challenges: item.challenges?.length ? item.challenges : undefined,
  }
}
