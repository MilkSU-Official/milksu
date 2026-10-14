import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { DEFAULT_HOST_BUNDLE_ID, type Target } from './types.ts'

export function validConversationId(value: string): boolean {
  const id = String(value ?? '')
  if (!id || id.length > 128) return false
  return /^[A-Za-z0-9_-]+$/.test(id)
}

export function validBundleId(value: string): boolean {
  const id = String(value ?? '')
  if (!id || id.length > 256) return false
  return /^[A-Za-z0-9.-]+$/.test(id)
}

export function validGrantedTarget(target: Target): boolean {
  return String(target.name ?? '').trim() !== ''
    && validBundleId(String(target.bundleId ?? '').trim())
    && target.pid > 1
    && target.windowId > 0
}

export function syntheticBundleId(name: string): string {
  let out = ''
  let lastDot = false
  for (const character of String(name ?? '').trim()) {
    const ok = /[A-Za-z0-9.-]/.test(character)
    if (ok) {
      out += character
      lastDot = character === '.'
      continue
    }
    if (out.length > 0 && !lastDot) {
      out += '.'
      lastDot = true
    }
  }
  out = out.replace(/^\.+|\.+$/g, '')
  if (!out) return 'app.unsigned'
  return out.length > 256 ? out.slice(0, 256) : out
}

export function isSelfComputerUseTarget(target: Target, hostBundleId: string, hostPid: number): boolean {
  if (hostPid > 1 && target.pid === hostPid) return true
  const host = String(hostBundleId ?? '').trim()
  if (host && target.bundleId.toLowerCase() === host.toLowerCase()) return true
  return false
}

export function filterValidTargets(
  targets: Target[],
  hostBundleId: string,
  hostPid: number,
  hostExecutable = '',
): Target[] {
  const host = String(hostBundleId ?? '').trim()
  const hostPath = String(hostExecutable ?? '').trim()
  const filtered: Target[] = []
  const seen = new Set<string>()
  for (const raw of targets) {
    const target: Target = {
      ...raw,
      name: String(raw.name ?? '').trim(),
      bundleId: String(raw.bundleId ?? '').trim(),
      windowTitle: String(raw.windowTitle ?? '').trim() || undefined,
      executablePath: String(raw.executablePath ?? '').trim() || undefined,
    }
    if (!validBundleId(target.bundleId)) target.bundleId = syntheticBundleId(target.name)
    if (target.pid <= 1 || target.windowId <= 0 || !target.name || !validBundleId(target.bundleId)) continue
    if (isSelfComputerUseTarget(target, host, hostPid)) continue
    if (
      hostPath
      && target.executablePath
      && resolve(target.executablePath).toLowerCase() === resolve(hostPath).toLowerCase()
    ) {
      continue
    }
    const key = `${target.pid}/${target.windowId}`
    if (seen.has(key)) continue
    seen.add(key)
    filtered.push(target)
  }
  return filtered
}

export function defaultTarget(pid: number, hostBundleId: string): Target {
  let nextPid = pid
  if (nextPid <= 1) nextPid = process.pid
  let bundle = String(hostBundleId ?? '').trim()
  if (!validBundleId(bundle)) bundle = DEFAULT_HOST_BUNDLE_ID
  const name = bundle.toLowerCase() === 'com.milksu.app.beta' ? 'MilkSU Beta' : 'MilkSU'
  return { name, bundleId: bundle, pid: nextPid }
}

export function resolveGrantedTarget(granted: Target, targets: Target[]): Target {
  for (const target of targets) {
    if (
      target.pid === granted.pid
      && target.windowId === granted.windowId
      && target.bundleId.toLowerCase() === granted.bundleId.toLowerCase()
    ) {
      return target
    }
  }
  const candidates = targets.filter((target) => target.bundleId.toLowerCase() === granted.bundleId.toLowerCase())
  if (granted.windowTitle) {
    const titleMatches = candidates.filter((target) => target.windowTitle === granted.windowTitle)
    if (titleMatches.length === 1) return titleMatches[0]!
  }
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length > 1) {
    throw new Error(`之前授权的 ${granted.name} 当前有多个可见窗口，请重新选择准确窗口`)
  }
  throw new Error(`之前授权的 ${granted.name} 当前不可见，请打开目标 App 后重试`)
}

export function sessionManifest(bundleId: string): string {
  let id = String(bundleId ?? '').trim()
  if (!validBundleId(id)) id = DEFAULT_HOST_BUNDLE_ID
  return `version: 2
mode: bounded
expires_after: 8h
idle_timeout: 30m
resources:
  apps:
    - bundle_id: ${id}
      launch: false
      windows: all
      terminate: deny
allow:
  tools:
    - check_permissions
    - start_session
    - get_session_state
    - end_session
    - list_windows
    - get_window_state
    - click
    - type_text
    - press_key
    - scroll
deny:
  tools:
    - get_desktop_state
    - launch_app
    - hotkey
    - drag
    - page
    - browser_prepare
    - escalate_session
    - start_recording
`
}

export function sessionManifestForTarget(target: Target, goos: string): string {
  if (goos !== 'windows') return sessionManifest(target.bundleId)
  const executable = resolve(String(target.executablePath ?? '').trim()).replaceAll("'", "''")
  return `version: 2
mode: bounded
expires_after: 8h
idle_timeout: 30m
resources:
  apps:
    - executable: '${executable}'
      launch: false
      windows: all
      terminate: deny
allow:
  tools:
    - check_permissions
    - start_session
    - get_session_state
    - end_session
    - list_windows
    - get_window_state
    - click
    - type_text
    - press_key
    - scroll
deny:
  tools:
    - get_desktop_state
    - launch_app
    - hotkey
    - drag
    - page
    - browser_prepare
    - escalate_session
    - start_recording
`
}

export function driverExecutableName(goos: string): string {
  return goos === 'windows' || goos === 'win32' ? 'cua-driver.exe' : 'cua-driver'
}

export async function createRuntimeDirectory(root: string, directory: string): Promise<void> {
  const clean = resolve(directory)
  const cleanRoot = resolve(root)
  if (dirname(clean) !== cleanRoot || !basename(clean).startsWith('computer_')) {
    throw new Error('refusing to create an invalid Computer Use runtime directory')
  }
  await mkdir(cleanRoot, { recursive: true, mode: 0o700 })
  const rootInfo = await lstat(cleanRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error('Computer Use runtime root is not a private app-owned directory')
  }
  if (process.platform !== 'win32' && typeof rootInfo.uid === 'number' && rootInfo.uid !== process.getuid?.()) {
    throw new Error('Computer Use runtime root is not a private app-owned directory')
  }
  try {
    await chmod(cleanRoot, 0o700)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
  await mkdir(clean, { recursive: false, mode: 0o700 })
  try {
    await chmod(clean, 0o700)
  } catch (error) {
    await cleanupRuntimeDirectory(cleanRoot, clean)
    if (process.platform !== 'win32') throw error
  }
}

export async function cleanupRuntimeDirectory(root: string, directory: string): Promise<void> {
  const clean = resolve(directory)
  const cleanRoot = resolve(root)
  if (dirname(clean) !== cleanRoot || !basename(clean).startsWith('computer_')) {
    throw new Error('refusing to clean an invalid Computer Use runtime directory')
  }
  await rm(clean, { recursive: true, force: true })
}

export function sessionDirectory(root: string, sessionId: string): string {
  return join(root, sessionId)
}

export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) && !value.includes(`..${sep}`)
}
