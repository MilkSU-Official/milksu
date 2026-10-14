import { spawn } from 'node:child_process'
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const execFileAsync = promisify(execFile)

export const MAX_GIT_OUTPUT_BYTES = 2 << 20
export const MAX_DIFF_SECTION_BYTES = 384 << 10

export function toSlash(value: string): string {
  return value.replaceAll('\\', '/')
}

export function fromSlash(value: string): string {
  return value.split('/').join(sep)
}

export function isMilkSUInternalPath(value: string): boolean {
  const normalized = toSlash(value.trim())
  return normalized === '.milksu' || normalized.startsWith('.milksu/')
}

export async function lookPath(name: string): Promise<string | null> {
  const which = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(which, [name], { timeout: 8000 })
    const first = String(stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

export async function resolveWorkspace(value: string): Promise<string> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Coding workspace is required')
  const absolute = resolve(trimmed)
  let resolved = absolute
  try {
    resolved = await realpath(absolute)
  } catch (error) {
    throw new Error(`resolve Coding workspace links: ${error instanceof Error ? error.message : error}`)
  }
  let info
  try {
    info = await stat(resolved)
  } catch (error) {
    throw new Error(`open Coding workspace: ${error instanceof Error ? error.message : error}`)
  }
  if (!info.isDirectory()) throw new Error('Coding workspace is not a directory')
  return resolved
}

export async function resolveGitPathspec(workspace: string, value: string): Promise<string> {
  if (!value.trim() || isAbsolute(value)) {
    throw new Error('Git diff path must be a relative workspace path')
  }
  const cleaned = fromSlash(value).split(sep).filter((part) => part && part !== '.').join(sep)
  const normalized = cleaned || '.'
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith(`..${sep}`)
    || normalized === '.git'
    || normalized.startsWith(`.git${sep}`)
    || normalized === '.milksu'
    || normalized.startsWith(`.milksu${sep}`)
  ) {
    throw new Error('Git diff path leaves the project workspace')
  }
  const absolute = join(workspace, normalized)
  const rel = relative(workspace, absolute)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('Git diff path leaves the project workspace')
  }
  try {
    const resolved = await realpath(absolute)
    const resolvedRel = relative(workspace, resolved)
    if (!resolvedRel || isAbsolute(resolvedRel) || resolvedRel === '..' || resolvedRel.startsWith(`..${sep}`)) {
      throw new Error('Git diff path resolves outside the project workspace')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside the project workspace')) throw error
  }
  return toSlash(rel)
}

export async function resolveWorkspaceFile(workspace: string, relativePath: string): Promise<string> {
  const resolved = await resolveWorkspace(workspace)
  const pathspec = await resolveGitPathspec(resolved, relativePath)
  return join(resolved, fromSlash(pathspec))
}

export async function resolveArtifactPreviewPath(
  workspace: string,
  value: string,
): Promise<{ cleaned: string; absolute: string }> {
  if (!value.trim() || isAbsolute(value)) {
    throw new Error('artifact preview path must be workspace-relative')
  }
  const cleaned = fromSlash(value).split(sep).filter((part) => part && part !== '.').join(sep)
  if (!cleaned || cleaned === '..' || cleaned.startsWith(`..${sep}`)) {
    throw new Error('artifact preview escapes the Coding workspace')
  }
  let target: string
  try {
    target = await realpath(join(workspace, cleaned))
  } catch (error) {
    throw new Error(`resolve artifact preview: ${error instanceof Error ? error.message : error}`)
  }
  const relativeTarget = relative(workspace, target)
  if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new Error('artifact preview escapes the Coding workspace')
  }
  return { cleaned, absolute: target }
}

export function detectContentType(data: Uint8Array): string {
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png'
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg'
  }
  if (data.length >= 6) {
    const header = Buffer.from(data.subarray(0, 6)).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (data.length >= 12
    && Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  const sample = Buffer.from(data.subarray(0, Math.min(data.length, 512))).toString('latin1')
  if (sample.includes('\0')) return 'application/octet-stream'
  const lower = sample.slice(0, 64).toLowerCase()
  if (lower.includes('<html') || lower.includes('<!doctype html')) return 'text/html'
  return 'text/plain; charset=utf-8'
}

export function artifactImageMediaType(extension: string): string {
  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return ''
  }
}

export async function isRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

export type HostedCommandResult = {
  output: string
  code: number | null
}

export async function runHosted(
  program: string,
  args: string[],
  options: {
    cwd?: string
    input?: string
    timeoutMs: number
    maxBytes?: number
  },
): Promise<HostedCommandResult> {
  const maxBytes = options.maxBytes ?? MAX_GIT_OUTPUT_BYTES
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      fail(new Error('timed out'))
    }, options.timeoutMs)
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({ output: Buffer.concat(chunks).toString('utf8'), code })
    }
    const onData = (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        fail(new Error(`output exceeded ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    child.on('close', (code) => finish(code))
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}
