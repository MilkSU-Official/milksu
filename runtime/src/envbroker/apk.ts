import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CommandResult } from './docker.ts'
import type { Package } from './types.ts'

const MAX_APK_BYTES = 80 << 20

export type ApkFetcher = {
  fetch(url: string, destination: string, signal?: AbortSignal): Promise<void>
}

export type AndroidCommandRunner = {
  lookPath(name: string): Promise<string>
  combinedOutput(name: string, args: string[], signal?: AbortSignal): Promise<CommandResult>
}

export const httpAPKFetcher: ApkFetcher = {
  async fetch(url, destination, signal) {
    const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`下载 APK 失败: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length === 0 || data.length > MAX_APK_BYTES) {
      throw new Error('下载 APK 失败: 超过大小上限')
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await writeFile(destination, data, { mode: 0o600 })
  },
}

export async function matchAPKHash(path: string, want: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const file = await open(path, 'r')
  try {
    const hash = createHash('sha256')
    let remaining = MAX_APK_BYTES
    const buffer = Buffer.alloc(64 * 1024)
    while (remaining > 0) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, remaining), null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      remaining -= bytesRead
    }
    return hash.digest('hex').toLowerCase() === want.trim().toLowerCase()
  } finally {
    await file.close()
  }
}

export async function cacheAndroidAPK(
  fetcher: ApkFetcher,
  dataDirectory: string,
  item: Package,
  signal?: AbortSignal,
): Promise<string> {
  if (!item.apkURL || !item.apkName || !item.apkSHA256) {
    throw new Error('练习包没有钉死 APK')
  }
  const directory = join(dataDirectory, 'services', 'envbroker', 'cache')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, basename(item.apkName))
  if (await matchAPKHash(path, item.apkSHA256)) return path
  const tmp = `${path}.part`
  try {
    await unlink(tmp)
  } catch {
    // ignore
  }
  try {
    await fetcher.fetch(item.apkURL, tmp, signal)
    if (!(await matchAPKHash(tmp, item.apkSHA256))) {
      await unlink(tmp).catch(() => undefined)
      throw new Error('APK 校验失败，与钉死的 SHA-256 不一致')
    }
    try {
      await unlink(path)
    } catch {
      // ignore
    }
    await rename(tmp, path)
    return path
  } catch (error) {
    try {
      await unlink(tmp)
    } catch {
      // ignore
    }
    throw error
  }
}

export function androidPackageName(launcher: string): string {
  const trimmed = launcher.trim()
  if (!trimmed) return ''
  const index = trimmed.indexOf('/')
  return index > 0 ? trimmed.slice(0, index) : trimmed
}

export async function installAndroidLab(
  runner: AndroidCommandRunner,
  serial: string,
  apkPath: string,
  launcher: string,
  signal?: AbortSignal,
): Promise<void> {
  const adb = await runner.lookPath('adb')
  const target = serial || 'emulator-5554'
  const result = await runner.combinedOutput(adb, ['-s', target, 'install', '-r', '-t', apkPath], signal)
  const output = result.output.toString('utf8')
  if (result.error || !output.toLowerCase().includes('success')) {
    throw new Error(`安装练习 APK 失败: ${output.trim()}`)
  }
  if (!launcher) return
  await runner.combinedOutput(adb, ['-s', target, 'shell', 'am', 'start', '-n', launcher], signal)
}

export async function androidPackageInstalled(
  runner: AndroidCommandRunner,
  serial: string,
  pkg: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!pkg) return true
  try {
    const adb = await runner.lookPath('adb')
    const result = await runner.combinedOutput(
      adb,
      ['-s', serial || 'emulator-5554', 'shell', 'pm', 'path', pkg],
      signal,
    )
    return !result.error && result.output.toString('utf8').includes('package:')
  } catch {
    return false
  }
}
