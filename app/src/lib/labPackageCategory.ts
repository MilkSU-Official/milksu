import type { EnvPackage } from '@/envbroker'
import { t } from '@/lib/uiLocale'

export type LabPackageCategory = 'probe' | 'web' | 'linux' | 'android' | 'cve' | 'other'

export const LAB_PACKAGE_CATEGORY_ORDER: LabPackageCategory[] = [
  'probe',
  'web',
  'linux',
  'android',
  'cve',
  'other',
]

const explicitCategory: Record<string, LabPackageCategory> = {
  probe: 'probe',
  connectivity: 'probe',
  web: 'web',
  linux: 'linux',
  android: 'android',
  cve: 'cve',
}

export function labPackageCategory(
  pkg: Pick<EnvPackage, 'id' | 'provider' | 'surface' | 'kindLabel'> & { category?: string },
): LabPackageCategory {
  const explicit = explicitCategory[String(pkg.category ?? '').trim().toLowerCase()]
  if (explicit) return explicit
  if (pkg.provider === 'android-avd' || pkg.surface === 'emulator' || pkg.kindLabel === '安卓') {
    return 'android'
  }
  if (pkg.kindLabel === 'Web') return 'web'
  if (pkg.kindLabel === 'CVE') return 'cve'
  if (pkg.kindLabel === 'Linux') return 'linux'
  if (pkg.kindLabel === '连通性' || pkg.id === 'whoami') return 'probe'
  if (pkg.surface === 'shell') return 'linux'
  if (pkg.surface === 'browser') return 'web'
  return 'other'
}

export function labPackageCategoryLabel(category: LabPackageCategory): string {
  if (category === 'probe') return t('连通性', 'Connectivity')
  if (category === 'web') return 'Web'
  if (category === 'linux') return 'Linux'
  if (category === 'android') return t('安卓', 'Android')
  if (category === 'cve') return 'CVE'
  return t('其他', 'Other')
}

export function groupLabPackages<T extends Pick<EnvPackage, 'id' | 'provider' | 'surface' | 'kindLabel'> & { category?: string }>(
  packages: T[],
): Array<{ category: LabPackageCategory; label: string; packages: T[] }> {
  const buckets = new Map<LabPackageCategory, T[]>()
  for (const pkg of packages) {
    const category = labPackageCategory(pkg)
    const list = buckets.get(category)
    if (list) list.push(pkg)
    else buckets.set(category, [pkg])
  }
  return LAB_PACKAGE_CATEGORY_ORDER.flatMap(category => {
    const items = buckets.get(category)
    if (!items?.length) return []
    return [{ category, label: labPackageCategoryLabel(category), packages: items }]
  })
}
