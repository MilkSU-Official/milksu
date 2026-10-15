import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'
import { applyTraceEnv } from '../../../sidecar/trace-id.js'
import { generateTraceId } from '../trace.ts'
import { dataDirectory, resolveHomeRoot } from '../home.ts'
import {
  buildSidecarEnvironment,
  defaultAgentWorkspace,
  findProjectRoot,
  spawnNodeEnvironment,
} from '../sidecar.ts'
import type { AppSettings } from '../config/settings-store.ts'
import { exportSidecarProviderEnvironment } from '../config/sidecar-provider-env.ts'

const PACKAGED_SIDECAR_DIRECTORY = 'milksu-sidecar'
const PACKAGED_COMPANION_BRIDGE = 'companion-bridge.cjs'
const DEVELOPMENT_COMPANION_BRIDGE = 'sidecar/companion/run-bridge.mjs'

export type CompanionSidecarProcess = {
  child: ChildProcessWithoutNullStreams
  write(command: Record<string, unknown>): Promise<void>
  kill(): Promise<void>
  stderrText(): string
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function packagedRuntimeAt(directory: string): { node: string; bridge: string } | null {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  const node = join(directory, nodeName)
  const bridge = join(directory, PACKAGED_COMPANION_BRIDGE)
  if (!regularFile(node) || !regularFile(bridge)) return null
  return { node, bridge }
}

export function companionAgentDirectory(home = resolveHomeRoot()): string {
  const directory = join(dataDirectory(home), 'agent', 'home', 'companion')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

export function companionStatePath(home = resolveHomeRoot()): string {
  const directory = join(dataDirectory(home), 'companion')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return join(directory, 'state.json')
}

export function resolveCompanionSidecarRuntime(
  sidecarDir = '',
  env: NodeJS.ProcessEnv = process.env,
): { node: string; bridge: string } {
  const fromEnv = String(env.MILKSU_SIDECAR_DIR ?? sidecarDir ?? '').trim()
  if (fromEnv) {
    const runtime = packagedRuntimeAt(fromEnv)
    if (runtime) return runtime
    throw new Error(`MILKSU_SIDECAR_DIR does not contain a complete companion runtime: ${fromEnv}`)
  }
  const resources = String(env.MILKSU_RESOURCES ?? '').trim()
  if (resources) {
    const beside = packagedRuntimeAt(join(resources, PACKAGED_SIDECAR_DIRECTORY))
    if (beside) return beside
  }
  const root = findProjectRoot(env)
  return { node: process.execPath, bridge: join(root, DEVELOPMENT_COMPANION_BRIDGE) }
}

export function companionSidecarEnvironment(input: {
  home: string
  agentDir: string
  sidecarDir?: string
  settings: AppSettings
  sidecarProviderEnv?: NodeJS.ProcessEnv | string[]
  traceId?: string
}): NodeJS.ProcessEnv {
  const workspace = defaultAgentWorkspace(input.home)
  const runtimeHome = join(input.home, 'data', 'agent', 'home')
  mkdirSync(runtimeHome, { recursive: true, mode: 0o700 })
  mkdirSync(join(runtimeHome, 'pi'), { recursive: true, mode: 0o700 })
  mkdirSync(join(runtimeHome, 'dsh'), { recursive: true, mode: 0o700 })
  mkdirSync(join(input.agentDir, 'sessions'), { recursive: true, mode: 0o700 })
  const dataDir = dataDirectory(input.home)
  const indexDir = join(dataDir, 'companion')
  mkdirSync(indexDir, { recursive: true, mode: 0o700 })

  const env = buildSidecarEnvironment({
    home: input.home,
    workspace,
    kernel: 'pi',
    settings: input.settings,
    sidecarDir: input.sidecarDir,
    traceId: input.traceId || generateTraceId(),
    sidecarProviderEnv: input.sidecarProviderEnv ?? exportSidecarProviderEnvironment(input.settings),
  })
  env.MILKSU_COMPANION_AGENT_DIR = input.agentDir
  env.MILKSU_COMPANION_INDEX_PATH = join(indexDir, 'obelisk.sqlite')
  env.MILKSU_PI_SESSIONS_DIR = join(runtimeHome, 'pi', 'sessions')
  env.MILKSU_DSH_SESSIONS_DIR = join(runtimeHome, 'dsh', 'sessions')
  env.MILKSU_COMPANION_SESSIONS_DIR = join(input.agentDir, 'sessions')
  env.MILKSU_CONVERSATIONS_DIR = join(dataDir, 'stores', 'conversations')
  return applyTraceEnv(env, input.traceId || generateTraceId())
}

export function startCompanionSidecar(input: {
  home: string
  agentDir: string
  sidecarDir?: string
  settings: AppSettings
  sidecarProviderEnv?: NodeJS.ProcessEnv | string[]
  traceId?: string
  onLine: (value: unknown) => void
  env?: NodeJS.ProcessEnv
}): CompanionSidecarProcess {
  mkdirSync(input.agentDir, { recursive: true, mode: 0o700 })
  const workspace = defaultAgentWorkspace(input.home)
  const runtime = resolveCompanionSidecarRuntime(
    input.sidecarDir ?? '',
    input.env ?? process.env,
  )
  const child = spawn(runtime.node, [runtime.bridge], {
    cwd: workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnNodeEnvironment(runtime.node, companionSidecarEnvironment(input)),
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    const text = String(chunk)
    stderr += text
    if (stderr.length > 4000) stderr = stderr.slice(-4000)
    process.stderr.write(chunk)
  })
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line: string) => {
    try {
      input.onLine(JSON.parse(line))
    } catch (error) {
      input.onLine({
        type: 'error',
        error: error instanceof Error ? error.message : 'sidecar protocol error',
      })
    }
  })
  let writeChain = Promise.resolve()
  return {
    child,
    stderrText() {
      return stderr
    },
    write(command: Record<string, unknown>) {
      const encoded = `${JSON.stringify(command)}\n`
      writeChain = writeChain.then(
        () => new Promise<void>((resolveWrite, reject) => {
          child.stdin.write(encoded, (error) => {
            if (error) reject(error)
            else resolveWrite()
          })
        }),
      )
      return writeChain
    },
    async kill() {
      if (child.exitCode !== null) return
      try {
        child.stdin.write(`${JSON.stringify({ action: 'shutdown' })}\n`)
        child.stdin.end()
      } catch {
        // already closed
      }
      await Promise.race([
        new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 800)),
      ])
      if (child.exitCode === null) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
    },
  }
}

export function sidecarWriteLost(error: unknown): boolean {
  if (!error) return false
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()
  const code = (error as NodeJS.ErrnoException).code?.toLowerCase() ?? ''
  return text.includes('sidecar is not running')
    || text.includes('broken pipe')
    || text.includes('epipe')
    || text.includes('closed pipe')
    || code === 'epipe'
    || code === 'err_stream_destroy'
}

