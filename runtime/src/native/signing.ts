import { spawn } from 'node:child_process'
import { posix as posixPath } from 'node:path'
import { validBundleId } from '../computercap/policy.ts'
import { DEFAULT_HOST_BUNDLE_ID, type SigningStatus } from '../computercap/types.ts'

const CODESIGN_TIMEOUT_MS = 2000
const APP_MACOS_MARKER = '.app/Contents/MacOS/'

export type SigningProbeOptions = {
  platform?: NodeJS.Platform
  execPath?: string
  env?: NodeJS.ProcessEnv
  inspect?: (path: string) => Promise<string>
}

function hostBundleId(env: NodeJS.ProcessEnv): string {
  for (const key of ['MILKSU_DESKTOP_APP_ID', 'CUA_DRIVER_HOST_BUNDLE_ID']) {
    const value = String(env[key] ?? '').trim()
    if (validBundleId(value)) return value
  }
  return DEFAULT_HOST_BUNDLE_ID
}

export function signingSubjectPath(executablePath: string): string {
  const cleaned = posixPath.normalize(String(executablePath ?? ''))
  const index = cleaned.indexOf(APP_MACOS_MARKER)
  if (index < 0) return cleaned
  return cleaned.slice(0, index + '.app'.length)
}

export function parseCodesignOutput(output: string, status: SigningStatus): void {
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('Identifier=')) {
      const identifier = line.slice('Identifier='.length).trim()
      if (validBundleId(identifier)) status.bundleId = identifier
      continue
    }
    if (line.startsWith('Signature=')) {
      const signature = line.slice('Signature='.length).trim()
      if (signature.toLowerCase() === 'adhoc') status.signature = 'adhoc'
      else if (signature) status.signature = 'signed'
      continue
    }
    if (line.startsWith('TeamIdentifier=')) {
      status.teamIdentifier = line.slice('TeamIdentifier='.length).trim()
    }
  }
}

function runCodesignInspect(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/codesign', ['-dv', '--verbose=4', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = (chunk: Buffer | string) => {
      output += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error('codesign timed out'))
    }, CODESIGN_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(output.trim() || `codesign exited ${code}`))
    })
  })
}

export async function probeSigning(options: SigningProbeOptions = {}): Promise<SigningStatus> {
  return platformSigningStatus(options)
}

export async function platformSigningStatus(
  options: SigningProbeOptions = {},
): Promise<SigningStatus> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  if (platform !== 'darwin') {
    return {
      bundleId: env.MILKSU_DESKTOP_APP_ID || DEFAULT_HOST_BUNDLE_ID,
      signature: 'unknown',
      stableIdentity: false,
    }
  }

  const hostBundle = hostBundleId(env)
  const executablePath = String(options.execPath ?? process.execPath ?? '').trim()
  if (!executablePath) {
    return {
      bundleId: hostBundle,
      signature: 'unknown',
      problem: '无法定位当前 MilkSU 可执行文件，不能判断 macOS 权限绑定身份。',
    }
  }

  const subjectPath = signingSubjectPath(executablePath)
  const status: SigningStatus = {
    bundleId: hostBundle,
    executablePath: subjectPath,
    signature: 'unknown',
    teamIdentifier: 'unknown',
    stableIdentity: false,
  }
  const inspect = options.inspect ?? runCodesignInspect
  let output: string
  try {
    output = await inspect(subjectPath)
  } catch {
    status.signature = 'unsigned'
    status.problem = '当前构建未能通过 codesign 检查；macOS 可能无法稳定复用辅助功能/屏幕录制授权。'
    return status
  }
  parseCodesignOutput(output, status)
  if (!status.signature || status.signature === 'unknown') status.signature = 'signed'
  if (!status.teamIdentifier) status.teamIdentifier = 'not set'
  if (!validBundleId(String(status.bundleId ?? '').trim())) status.bundleId = hostBundle
  status.stableIdentity = status.signature !== 'adhoc'
    && status.signature !== 'unsigned'
    && status.teamIdentifier !== 'not set'
    && status.teamIdentifier !== 'unknown'
  if (!status.stableIdentity && !status.problem) {
    status.problem = '当前构建不是稳定 Developer ID 签名；系统设置里显示已勾选时，TCC 探针仍可能对当前二进制返回未授权。'
  }
  return status
}
