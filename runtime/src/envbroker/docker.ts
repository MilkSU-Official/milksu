import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { composeBytes } from './catalog.ts'
import type { Owner, Package } from './types.ts'

export type CommandResult = {
  output: Buffer
  error?: Error
  exitCode: number
}

export type ComposeRunner = {
  lookPath(name: string): string | undefined
  run(executable: string, args: string[], directory: string, signal?: AbortSignal): Promise<CommandResult>
  runProgress?(
    executable: string,
    args: string[],
    directory: string,
    progress: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<CommandResult>
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function lookPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names = process.platform === 'win32' && !name.endsWith('.exe') ? [`${name}.exe`, name] : [name]
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const file of names) {
      const candidate = join(dir, file)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

export function findDocker(runner: ComposeRunner): string {
  const looked = runner.lookPath('docker')
  if (looked) return looked
  for (const candidate of [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
  ]) {
    if (isExecutable(candidate)) return candidate
  }
  throw new Error('docker executable was not found')
}

export function composeInvocation(runner: ComposeRunner): { executable: string; prefix: string[] } {
  const docker = findDocker(runner)
  const compose = runner.lookPath('docker-compose')
  if (compose) return { executable: compose, prefix: [] }
  return { executable: docker, prefix: ['compose', '--ansi', 'never'] }
}

function runSpawned(
  executable: string,
  args: string[],
  directory: string,
  progress?: (line: string) => void,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: directory || undefined,
      env: process.env,
      signal,
    })
    const chunks: Buffer[] = []
    let lineBuffer = ''
    const take = (chunk: Buffer) => {
      chunks.push(chunk)
      if (!progress) return
      lineBuffer += chunk.toString('utf8')
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() ?? ''
      for (const line of lines) progress(line)
    }
    child.stdout.on('data', (chunk) => take(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => take(Buffer.from(chunk)))
    child.on('error', (error) => {
      resolve({ output: Buffer.concat(chunks), error, exitCode: 1 })
    })
    child.on('close', (code) => {
      if (progress && lineBuffer) progress(lineBuffer)
      const output = Buffer.concat(chunks)
      if (code === 0) resolve({ output, exitCode: 0 })
      else resolve({ output, error: new Error(`exit ${code ?? 1}`), exitCode: code ?? 1 })
    })
  })
}

export const execComposeRunner: ComposeRunner = {
  lookPath(name) {
    return lookPath(name)
  },
  run(executable, args, directory, signal) {
    return runSpawned(executable, args, directory, undefined, signal)
  },
  runProgress(executable, args, directory, progress, signal) {
    return runSpawned(executable, args, directory, progress, signal)
  },
}

async function runCompose(
  runner: ComposeRunner,
  executable: string,
  args: string[],
  directory: string,
  progress: ((line: string) => void) | undefined,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (progress && runner.runProgress) {
    return runner.runProgress(executable, args, directory, progress, signal)
  }
  return runner.run(executable, args, directory, signal)
}

export async function dockerAvailable(runner: ComposeRunner): Promise<Error | undefined> {
  let docker: string
  try {
    docker = findDocker(runner)
  } catch {
    return new Error('Docker CLI 不可用')
  }
  const signal = AbortSignal.timeout(8_000)
  const result = await runner.run(docker, ['version', '--format', '{{.Server.Version}}'], '', signal)
  if (result.error) {
    return new Error(`Docker 未运行: ${result.output.toString('utf8').trim()}`)
  }
  return undefined
}

function httpTarget(address: string): string {
  return address.includes('://') ? address : `http://${address}`
}

export async function waitHTTPReady(address: string, signal?: AbortSignal): Promise<void> {
  const trimmed = address.trim()
  if (!trimmed) return
  const target = httpTarget(trimmed)
  const deadline = Date.now() + 90_000
  let last = '等待超时'
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error(String(signal.reason ?? 'aborted'))
    try {
      const response = await fetch(target, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)].filter(Boolean) as AbortSignal[]) })
      await response.arrayBuffer()
      return
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(800, signal)
  }
  throw new Error(`${address} 未就绪: ${last}`)
}

export async function httpReady(address: string, signal?: AbortSignal): Promise<boolean> {
  const trimmed = address.trim()
  if (!trimmed) return false
  try {
    const response = await fetch(httpTarget(trimmed), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)].filter(Boolean) as AbortSignal[]),
    })
    await response.arrayBuffer()
    return true
  } catch {
    return false
  }
}

export async function startCompose(
  runner: ComposeRunner,
  directory: string,
  project: string,
  progress: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { executable, prefix } = composeInvocation(runner)
  const args = [...prefix, '--project-name', project, '--file', 'compose.yaml', 'up', '--detach', '--remove-orphans']
  const result = await runCompose(runner, executable, args, directory, progress, signal)
  if (result.error) {
    throw new Error(`启动容器失败: ${result.output.toString('utf8').trim()}`)
  }
}

export async function composeStatus(
  runner: ComposeRunner,
  directory: string,
  project: string,
  signal?: AbortSignal,
): Promise<{ state: string; error?: Error }> {
  let invocation: { executable: string; prefix: string[] }
  try {
    invocation = composeInvocation(runner)
  } catch (error) {
    return { state: 'unknown', error: error instanceof Error ? error : new Error(String(error)) }
  }
  const args = [...invocation.prefix, '--project-name', project, '--file', 'compose.yaml', 'ps', '--format', '{{.State}}']
  const result = await runner.run(invocation.executable, args, directory, signal ?? AbortSignal.timeout(20_000))
  if (result.error) {
    return { state: 'unknown', error: new Error(`查询容器失败: ${result.output.toString('utf8').trim()}`) }
  }
  const text = result.output.toString('utf8').trim().toLowerCase()
  if (text.includes('running')) return { state: 'ready' }
  return { state: 'stopped' }
}

export async function stopCompose(
  runner: ComposeRunner,
  directory: string,
  project: string,
  signal?: AbortSignal,
): Promise<void> {
  const { executable, prefix } = composeInvocation(runner)
  const args = [...prefix, '--project-name', project, '--file', 'compose.yaml', 'down', '--remove-orphans']
  const result = await runner.run(executable, args, directory, signal ?? AbortSignal.timeout(120_000))
  if (result.error) {
    throw new Error(`停止容器失败: ${result.output.toString('utf8').trim()}`)
  }
}

export function sanitizeOwner(owner: Owner): string {
  const raw = `${owner.kind}-${owner.id}`.toLowerCase()
  let out = ''
  for (const char of raw) {
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '-' || char === '_') out += char
    else out += '-'
  }
  if (!out) return 'job'
  return out.length > 80 ? out.slice(0, 80) : out
}

export function projectName(item: Package): string {
  return `milksu-env-${item.id}`
}

export function instanceDirectory(dataDirectory: string, owner: Owner, packageID: string): string {
  return join(dataDirectory, 'services', 'envbroker', 'instances', sanitizeOwner(owner), packageID)
}

export async function materializeCompose(dataDirectory: string, owner: Owner, item: Package): Promise<string> {
  const data = await composeBytes(item)
  if (data.length === 0) throw new Error(`package ${item.id} has no compose file`)
  const directory = instanceDirectory(dataDirectory, owner, item.id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'compose.yaml')
  await writeFile(path, data, { mode: 0o600 })
  try {
    await chmod(path, 0o600)
  } catch {
    // Windows file mode is best-effort.
  }
  return directory
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(String(signal.reason ?? 'aborted')))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error(String(signal.reason ?? 'aborted')))
    }, { once: true })
  })
}

export function startDetached(executable: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      env: env ?? process.env,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function openDockerDesktop(): Promise<void> {
  if (process.platform === 'darwin') {
    await startDetached('open', ['-a', 'Docker'])
    return
  }
  if (process.platform === 'win32') {
    await startDetached('cmd', ['/c', 'start', '', 'Docker Desktop'])
    return
  }
  const systemctl = lookPath('systemctl')
  if (systemctl) {
    await startDetached(systemctl, ['--user', 'start', 'docker-desktop'])
    return
  }
  throw new Error('请手动启动 Docker')
}
