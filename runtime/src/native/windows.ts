import { realpath } from 'node:fs/promises'
import type { Target } from '../computercap/types.ts'
import { loadNativeAddon } from './addon.ts'

type NativeWindow = {
  name?: unknown
  bundleId?: unknown
  pid?: unknown
  windowId?: unknown
  windowTitle?: unknown
  executablePath?: unknown
}

type WindowsAddon = {
  listWindows(): NativeWindow[]
  hostExecutable(pid: number): string
}

function asTarget(raw: NativeWindow): Target {
  const target: Target = {
    name: String(raw.name ?? ''),
    bundleId: String(raw.bundleId ?? ''),
    pid: Number(raw.pid ?? 0),
    windowId: Number(raw.windowId ?? 0),
  }
  const title = String(raw.windowTitle ?? '').trim()
  if (title) target.windowTitle = title
  const executable = String(raw.executablePath ?? '').trim()
  if (executable) target.executablePath = executable
  return target
}

function windowsAddon(platform: NodeJS.Platform): WindowsAddon | null {
  const name = platform === 'darwin' ? 'macos-windows' : platform === 'win32' ? 'windows-windows' : ''
  if (!name) return null
  const loaded = loadNativeAddon(name) as WindowsAddon | null
  if (!loaded || typeof loaded.listWindows !== 'function') return null
  return loaded
}

export async function listPlatformWindows(platform = process.platform): Promise<Target[]> {
  const addon = windowsAddon(platform)
  if (!addon) return []
  try {
    const listed = addon.listWindows()
    if (!Array.isArray(listed)) return []
    return listed.map(asTarget)
  } catch {
    return []
  }
}

export async function hostExecutable(pid: number, platform = process.platform): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 1) return ''
  if (platform === 'linux') {
    try {
      return await realpath(`/proc/${pid}/exe`)
    } catch {
      return ''
    }
  }
  if (platform !== 'darwin' && platform !== 'win32') return ''
  const addon = windowsAddon(platform)
  if (!addon || typeof addon.hostExecutable !== 'function') return ''
  try {
    const value = addon.hostExecutable(pid)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}
