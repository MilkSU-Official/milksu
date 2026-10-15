import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFile, chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_HOST_BUNDLE_ID, DRIVER_VERSION, MISSING_DRIVER_PROBLEM, type PrepareResult } from './types.ts'
import { driverExecutableName, validBundleId } from './policy.ts'

export type SpawnSpec = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdio?: 'pipe' | 'ignore-stdout'
}

export type CommandFactory = (spec: SpawnSpec) => ChildProcess

const DRIVER_COMPANIONS = [
  'cua-driver-uia.exe',
  'cua_driver_sdk.dll',
  'libgcc_s_seh-1.dll',
  'libwinpthread-1.dll',
  'libstdc++-6.dll',
  'LICENSE.md',
]

export function newSessionId(): string {
  return `computer_${randomBytes(16).toString('hex')}`
}

export function defaultCommandFactory(spec: SpawnSpec): ChildProcess {
  const stdout = spec.stdio === 'pipe' ? 'pipe' : 'ignore'
  return spawn(spec.command, spec.args, {
    env: spec.env,
    stdio: ['ignore', stdout, 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
}

export function driverEnvironment(os: string, directory: string, hostBundleId: string): NodeJS.ProcessEnv {
  let host = String(hostBundleId ?? '').trim()
  if (!validBundleId(host)) host = DEFAULT_HOST_BUNDLE_ID
  const env: NodeJS.ProcessEnv = {
    CUA_DRIVER_EMBEDDED: '1',
    CUA_DRIVER_HOST_BUNDLE_ID: host,
    CUA_DRIVER_PERMISSION_MODE: 'bounded',
    CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    CUA_LOG: 'warn',
  }
  if (os === 'windows' || os === 'win32') {
    const systemRoot = String(process.env.SystemRoot ?? '').trim() || 'C:\\Windows'
    env.SystemRoot = systemRoot
    env.WINDIR = systemRoot
    env.USERPROFILE = join(directory, 'home')
    env.APPDATA = join(directory, 'home', 'AppData', 'Roaming')
    env.LOCALAPPDATA = join(directory, 'home', 'AppData', 'Local')
    env.TEMP = join(directory, 'tmp')
    env.TMP = join(directory, 'tmp')
    env.PATH = join(systemRoot, 'System32')
  } else {
    env.HOME = join(directory, 'home')
    env.TMPDIR = join(directory, 'tmp')
    env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
    env.LANG = 'en_US.UTF-8'
  }
  return env
}

export async function ensureDriverSandbox(directory: string): Promise<void> {
  await mkdir(join(directory, 'home'), { recursive: true, mode: 0o700 })
  await mkdir(join(directory, 'tmp'), { recursive: true, mode: 0o700 })
}

export async function inspectDriverFile(path: string): Promise<boolean> {
  try {
    const canonical = resolve(path)
    const info = await lstat(canonical)
    if (info.isSymbolicLink() || !info.isFile()) return false
    return true
  } catch {
    return false
  }
}

export async function inspectExecutable(path: string, os: string): Promise<boolean> {
  try {
    const canonical = resolve(path)
    const info = await lstat(canonical)
    if (info.isSymbolicLink() || !info.isFile()) return false
    const windows = process.platform === 'win32' || os === 'windows' || os === 'win32'
    if (!windows && (info.mode & 0o111) === 0) return false
    return true
  } catch {
    return false
  }
}

export function preparedDriverPath(home: string, os: string): string {
  return join(home, 'data', 'services', 'computer-use', driverExecutableName(os))
}

export function binaryCandidates(options: {
  binaryPath?: string
  os: string
  home: string
  sidecarDir?: string
  cwd?: string
}): string[] {
  const name = driverExecutableName(options.os)
  const candidates = [String(options.binaryPath ?? '').trim()]
  const sidecar = String(options.sidecarDir ?? process.env.MILKSU_SIDECAR_DIR ?? '').trim()
  if (sidecar) candidates.push(join(sidecar, name))
  let arch = process.arch
  if (arch === 'x64') arch = 'amd64'
  const cwd = options.cwd ?? process.cwd()
  candidates.push(join(cwd, 'build', 'sidecar', `${options.os}-${arch}`, name))
  candidates.push(preparedDriverPath(options.home, options.os))
  return candidates.filter(Boolean)
}

export async function resolveDriverBinary(options: {
  binaryPath?: string
  os: string
  home: string
  sidecarDir?: string
  cwd?: string
}): Promise<string> {
  for (const candidate of binaryCandidates(options)) {
    if (await inspectExecutable(candidate, options.os)) return resolve(candidate)
  }
  throw new Error(`MilkSU packaged Cua Driver ${DRIVER_VERSION} is unavailable`)
}

export async function verifyDriverVersion(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  factory: CommandFactory,
): Promise<void> {
  const child = factory({ command: binaryPath, args: ['--version'], env, stdio: 'pipe' })
  const output = await collectProcessOutput(child, 3000)
  const version = output.split('\n').map((line) => line.trim()).find((line) => line.startsWith('cua-driver '))
  if (version !== `cua-driver ${DRIVER_VERSION}`) {
    throw new Error(`unexpected Cua Driver version; MilkSU requires ${DRIVER_VERSION}`)
  }
}

function collectProcessOutput(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    const timer = setTimeout(() => {
      killChild(child, true)
      reject(new Error('inspect packaged Cua Driver: timed out'))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`inspect packaged Cua Driver: ${error.message}`))
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`inspect packaged Cua Driver: ${stderr.trim() || `exit ${code}`}`))
        return
      }
      resolveOutput(stdout + stderr)
    })
  })
}

export function waitForChildExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit) => {
    child.once('exit', (code) => resolveExit(code))
    child.once('error', () => resolveExit(1))
  })
}

export async function waitForEndpoint(
  path: string,
  timeoutMs: number,
  exited: Promise<unknown>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let finished = false
  const exit = exited.then((value) => {
    finished = true
    return value
  })
  while (Date.now() < deadline) {
    if (await tryConnect(path)) return
    if (finished) throw new Error('driver stopped before opening its private socket')
    const winner = await Promise.race([
      exit.then(() => 'exit' as const),
      sleep(40).then(() => 'tick' as const),
    ])
    if (winner === 'exit') throw new Error('driver stopped before opening its private socket')
  }
  throw new Error('start Computer Use private driver: timed out')
}

function tryConnect(path: string): Promise<boolean> {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ path })
    const finish = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolveConnect(ok)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    setTimeout(() => finish(false), 80)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

export async function stopChild(child: ChildProcess | undefined, force = false): Promise<void> {
  if (!child || child.exitCode !== null) return
  killChild(child, force)
}

export function killChild(child: ChildProcess, force = false): void {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const systemRoot = String(process.env.SystemRoot ?? '').trim() || 'C:\\Windows'
    const taskkill = join(systemRoot, 'System32', 'taskkill.exe')
    const args = ['/PID', String(child.pid), '/T']
    if (force) args.push('/F')
    spawn(taskkill, args, { stdio: 'ignore', windowsHide: true }).on('error', () => {
      try { child.kill() } catch { /* ignore */ }
    })
    return
  }
  const signal = force ? 'SIGKILL' : 'SIGTERM'
  try {
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* ignore */ }
  }
}

export async function copyRegularFile(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(source, destination)
  try {
    await chmod(destination, 0o755)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

export async function copyDriverBundle(sourceBinary: string, destinationBinary: string): Promise<void> {
  await copyRegularFile(sourceBinary, destinationBinary)
  const sourceDir = dirname(sourceBinary)
  const destinationDir = dirname(destinationBinary)
  for (const name of DRIVER_COMPANIONS) {
    const source = join(sourceDir, name)
    if (!await inspectDriverFile(source)) continue
    await copyRegularFile(source, join(destinationDir, name))
  }
}

export function findRepositoryRoot(start = process.cwd()): string {
  let directory = start
  for (let i = 0; i < 8; i += 1) {
    const script = join(directory, 'scripts', 'build-windows-cua-driver.mjs')
    const patch = join(directory, 'third_party', 'cua-driver')
    if (existsSync(script) && existsSync(patch)) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return ''
}

export function windowsBuildScript(root: string): string {
  return join(root, 'scripts', 'build-windows-cua-driver.mjs')
}

export async function rustcLooksUsable(): Promise<boolean> {
  try {
    const child = spawn('rustc', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const output = await collectProcessOutput(child, 3000)
    return output.trim().startsWith('rustc 1.97.')
  } catch {
    return false
  }
}

export async function runReviewedWindowsBuild(root: string, timeoutMs = 12 * 60_000): Promise<void> {
  const script = windowsBuildScript(root)
  let node = 'node'
  const sidecar = String(process.env.MILKSU_SIDECAR_DIR ?? '').trim()
  if (sidecar) {
    for (const name of ['node.exe', 'node']) {
      const candidate = join(sidecar, name)
      if (await inspectDriverFile(candidate)) {
        node = candidate
        break
      }
    }
  }
  const child = spawn(node, [script], {
    cwd: root,
    env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const output = await collectProcessOutput(child, timeoutMs)
    void output
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`MilkSU 审阅过的 Windows Driver 构建失败：${detail.slice(-2000)}`)
  }
}

export function sidecarBuildCandidate(os: string, cwd = process.cwd()): string {
  let arch = process.arch
  if (arch === 'x64') arch = 'amd64'
  return join(cwd, 'build', 'sidecar', `${os}-${arch}`, driverExecutableName(os))
}

export function sourceBuildRuntimeCandidate(root: string, os: string): string {
  return join(root, 'build', 'sidecar-cache', `cua-windows-${DRIVER_VERSION}`, 'r', driverExecutableName(os))
}

export async function cleanupEndpoint(socketPath: string): Promise<void> {
  if (process.platform === 'win32' || !socketPath.trim()) return
  try {
    await rm(socketPath, { force: true })
  } catch {
    // socket may not exist yet
  }
}

export function digestShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export function missingDriverResult(recipe = '', nextStep = ''): PrepareResult {
  return {
    ready: false,
    version: DRIVER_VERSION,
    problem: MISSING_DRIVER_PROBLEM,
    recipe: recipe || undefined,
    nextStep: nextStep || '请重装带 Sidecar 的 MilkSU，让安装包自带审阅过的 Cua Driver。',
  }
}
