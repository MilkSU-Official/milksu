import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

function resourcesPath(env: NodeJS.ProcessEnv): string {
  const fromEnv = String(env.MILKSU_RESOURCES ?? '').trim()
  if (fromEnv) return fromEnv
  const electron = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return String(electron ?? '').trim()
}

function bundledDirectory(): string {
  try {
    return Function('return typeof __dirname === "string" ? __dirname : ""')() as string
  } catch {
    return ''
  }
}

function hasCompose(root: string): boolean {
  return existsSync(join(root, 'whoami', 'compose.yaml'))
}

export function resolvePackagesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.MILKSU_ENVBROKER_PACKAGES ?? '').trim()
  if (override) {
    const root = isAbsolute(override) ? override : join(process.cwd(), override)
    if (hasCompose(root)) return root
  }

  const milksuRoot = String(env.MILKSU_ROOT ?? '').trim()
  if (milksuRoot) {
    for (const relative of ['runtime/src/envbroker/packages']) {
      const candidate = join(milksuRoot, relative)
      if (hasCompose(candidate)) return candidate
    }
  }

  for (const candidate of [
    join(process.cwd(), 'runtime', 'src', 'envbroker', 'packages'),
  ]) {
    if (hasCompose(candidate)) return candidate
  }

  const moduleDir = bundledDirectory()
  if (moduleDir) {
    for (const candidate of [
      join(moduleDir, 'packages'),
      join(moduleDir, 'envbroker', 'packages'),
      join(moduleDir, '..', 'envbroker', 'packages'),
    ]) {
      if (hasCompose(candidate)) return candidate
    }
  }

  const packed = resourcesPath(env)
  if (packed) {
    const candidate = join(packed, 'envbroker', 'packages')
    if (hasCompose(candidate)) return candidate
  }

  throw new Error('envbroker packages directory was not found')
}

export function composeFilePath(composePath: string, env: NodeJS.ProcessEnv = process.env): string {
  const relative = String(composePath ?? '').trim()
  if (!relative) throw new Error('package has no compose file')
  return join(resolvePackagesRoot(env), relative)
}
