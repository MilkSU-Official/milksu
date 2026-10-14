import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import type { AppSettings, SettingsStore } from '../config/settings-store.ts'
import { findProjectRoot } from '../sidecar.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KERNEL_PACKAGES: Record<string, string> = {
  pi: '@earendil-works/pi-coding-agent',
  dsh: '@deepseek-ai/dsh',
}

function requireSettings(ctx: HandlerContext): SettingsStore {
  if (!ctx.settings) throw new Error('settings store is unavailable')
  return ctx.settings
}

function requireSource(ctx: HandlerContext, method: string, allowed: 'renderer' | 'electron_host'): void {
  const source = String(ctx.invokeSource ?? '')
  if (source !== allowed) {
    throw new Error(`desktop method ${method} is unavailable to ${source || 'unknown'}`)
  }
}

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

async function runtimeVersions(): Promise<Record<string, string> | undefined> {
  const versions: Record<string, string> = {}
  const roots: string[] = []
  const sidecarDir = String(process.env.MILKSU_SIDECAR_DIR ?? '').trim()
  if (sidecarDir) roots.push(join(sidecarDir, 'node_modules'))
  try {
    roots.push(join(findProjectRoot(), 'node_modules'))
  } catch {
    // packaged runtime without a checkout
  }
  for (const [name, pkg] of Object.entries(KERNEL_PACKAGES)) {
    for (const root of roots) {
      try {
        const raw = await readFile(join(root, pkg, 'package.json'), 'utf8')
        const version = String((JSON.parse(raw) as { version?: string }).version ?? '').trim()
        if (version) {
          versions[name] = version
          break
        }
      } catch {
        // try the next root
      }
    }
  }
  return Object.keys(versions).length ? versions : undefined
}

async function getSettings(ctx: HandlerContext): Promise<AppSettings> {
  requireSource(ctx, 'GetSettings', 'renderer')
  const settings = requireSettings(ctx).get()
  const versions = await runtimeVersions()
  if (versions) settings.runtime_versions = versions
  return settings
}

async function saveSettings(ctx: HandlerContext, args: unknown[] | undefined): Promise<null> {
  requireSource(ctx, 'SaveSettingsCmd', 'renderer')
  await requireSettings(ctx).save(arg<AppSettings>(args, 0, {}))
  ctx.emit('settings-changed', requireSettings(ctx).get())
  return null
}

async function setAccountModelCredential(ctx: HandlerContext, args: unknown[] | undefined): Promise<null> {
  requireSource(ctx, 'SetAccountModelCredential', 'electron_host')
  await requireSettings(ctx).setManagedAccountRelay(arg(args, 0, ''), arg(args, 1, ''))
  return null
}

async function clearAccountModelCredential(ctx: HandlerContext): Promise<null> {
  requireSource(ctx, 'ClearAccountModelCredential', 'electron_host')
  await requireSettings(ctx).clearManagedAccountRelay()
  return null
}

async function setAccountDecisionCredential(ctx: HandlerContext, args: unknown[] | undefined): Promise<null> {
  requireSource(ctx, 'SetAccountDecisionCredential', 'electron_host')
  await requireSettings(ctx).setManagedJevCredential(arg(args, 0, ''))
  return null
}

async function clearAccountDecisionCredential(ctx: HandlerContext): Promise<null> {
  requireSource(ctx, 'ClearAccountDecisionCredential', 'electron_host')
  await requireSettings(ctx).clearManagedJevCredential()
  return null
}

async function exportSidecarEnvironment(ctx: HandlerContext): Promise<string[]> {
  requireSource(ctx, 'ExportSidecarEnvironment', 'electron_host')
  return requireSettings(ctx).exportSidecarEnvironment()
}

registerOwnedHandlers({
  GetSettings: (ctx) => getSettings(ctx),
  SaveSettingsCmd: (ctx, args) => saveSettings(ctx, args),
  SetAccountModelCredential: (ctx, args) => setAccountModelCredential(ctx, args),
  ClearAccountModelCredential: (ctx) => clearAccountModelCredential(ctx),
  SetAccountDecisionCredential: (ctx, args) => setAccountDecisionCredential(ctx, args),
  ClearAccountDecisionCredential: (ctx) => clearAccountDecisionCredential(ctx),
  ExportSidecarEnvironment: (ctx) => exportSidecarEnvironment(ctx),
})
