import { join } from 'node:path'
import { createRequireFromModule, moduleDirectory } from '../module-path.ts'

const loaded = new Map<string, unknown | null>()

function nativeRequire(): NodeJS.Require {
  return createRequireFromModule()
}

function candidatePaths(name: string): string[] {
  const paths: string[] = []
  const addonDir = String(process.env.MILKSU_NATIVE_ADDON_DIR ?? '').trim()
  if (addonDir) {
    paths.push(addonDir)
    paths.push(join(addonDir, name))
  }
  const resources = String(process.env.MILKSU_RESOURCES ?? '').trim()
  if (resources) {
    paths.push(resources)
    paths.push(join(resources, name))
  }
  paths.push(join(moduleDirectory(), '../../../build/desktop', `${name}.node`))
  paths.push(join(process.cwd(), 'build', 'desktop', `${name}.node`))
  return paths
}

export function loadNativeAddon(name: string): unknown | null {
  const key = String(name ?? '').trim()
  if (!key) return null
  if (loaded.has(key)) return loaded.get(key) ?? null
  const requireAddon = nativeRequire()
  for (const candidate of candidatePaths(key)) {
    if (!candidate) continue
    try {
      const addon = requireAddon(candidate)
      loaded.set(key, addon)
      return addon
    } catch {
      // Missing or unloadable addon is not fatal.
    }
  }
  loaded.set(key, null)
  return null
}
