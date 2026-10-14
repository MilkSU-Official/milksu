import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { applyTraceEnv } from '../../sidecar/trace-id.js'
import { dshProductIpc } from '../../sidecar/hostpath.js'
import { generateTraceId, normalizeTraceId } from './trace.ts'
import { dataDirectory, resolveHomeRoot, workspacesDirectory } from './home.ts'
import { codingToolsSidecarEnvironment } from './agentresources/codingtools.ts'
import type { RpcMessage } from './rpc.ts'
import { normalizeAcpGuest, type PublicSettings } from './settings.ts'

const PACKAGED_SIDECAR_DIRECTORY = 'milksu-sidecar'
const DEVELOPMENT_PI_BRIDGE = 'sidecar/pi/run-bridge.mjs'
const DEVELOPMENT_DSH_BRIDGE = 'sidecar/dsh/run-bridge.mjs'

export type SidecarKernel = 'pi' | 'dsh'

export function sidecarWorkspaceKey(kernel: SidecarKernel, workspace: string): string {
  return `${kernel}\0${workspace}`
}

export function spawnNodeEnvironment(node: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const name = basename(node).replace(/\.exe$/i, '').toLowerCase()
  if (name === 'node') return env
  return { ...env, ELECTRON_RUN_AS_NODE: '1' }
}

export type SidecarRuntime = {
  node: string
  bridge: string
  packaged: boolean
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function packagedRuntimeAt(directory: string, bridgeName: string): SidecarRuntime | null {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
  const node = join(directory, nodeName)
  const bridge = join(directory, bridgeName)
  if (!regularFile(node) || !regularFile(bridge)) return null
  return { node, bridge, packaged: true }
}

function projectRootContainsSidecar(root: string): boolean {
  return regularFile(join(root, 'go.mod')) && regularFile(join(root, DEVELOPMENT_PI_BRIDGE))
}

function moduleDirectory(): string {
  try {
    const dir = Function('return typeof __dirname === "string" ? __dirname : ""')() as string
    if (dir) return dir
  } catch {
    // ESM tests have no __dirname
  }
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return ''
  }
}

export function findProjectRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.MILKSU_ROOT ?? '').trim()
  if (override && projectRootContainsSidecar(override)) return override
  const starts = [process.cwd()]
  const here = moduleDirectory()
  if (here) starts.push(resolve(here, '..', '..'))
  for (const start of starts) {
    let directory = start
    for (let i = 0; i < 12; i += 1) {
      if (projectRootContainsSidecar(directory)) return directory
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  throw new Error(`cannot locate MilkSU project root containing ${DEVELOPMENT_PI_BRIDGE}`)
}

export function resolveSidecarRuntime(
  kernel: SidecarKernel,
  helperPath = '',
  env: NodeJS.ProcessEnv = process.env,
): SidecarRuntime {
  const packagedBridge = kernel === 'dsh' ? 'dsh-bridge.cjs' : 'chat-bridge.cjs'
  const sourceBridge = kernel === 'dsh' ? DEVELOPMENT_DSH_BRIDGE : DEVELOPMENT_PI_BRIDGE
  const sidecarDir = String(env.MILKSU_SIDECAR_DIR ?? '').trim()
  if (sidecarDir) {
    const runtime = packagedRuntimeAt(sidecarDir, packagedBridge)
    if (runtime) return runtime
    throw new Error(`MILKSU_SIDECAR_DIR does not contain a complete runtime: ${sidecarDir}`)
  }
  if (helperPath) {
    const beside = packagedRuntimeAt(join(dirname(helperPath), PACKAGED_SIDECAR_DIRECTORY), packagedBridge)
    if (beside) return beside
  }
  const root = findProjectRoot(env)
  const node = process.env.ELECTRON_RUN_AS_NODE === '1' ? process.execPath : process.execPath
  return { node, bridge: join(root, sourceBridge), packaged: false }
}

export function defaultAgentWorkspace(home = resolveHomeRoot()): string {
  const workspace = join(workspacesDirectory(home), 'agent-workspace')
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  mkdirSync(join(workspace, '.git'), { recursive: true, mode: 0o700 })
  return workspace
}

export function resolveAgentWorkspace(value: string, home = resolveHomeRoot()): string {
  const workspace = String(value ?? '').trim()
  if (!workspace) return defaultAgentWorkspace(home)
  const absolute = isAbsolute(workspace) ? workspace : resolve(workspace)
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error(`open Agent workspace: ${absolute}`)
  }
  return absolute
}

function sidecarRuntimeHome(home: string): string {
  const runtimeHome = join(home, 'data', 'agent', 'home')
  mkdirSync(runtimeHome, { recursive: true, mode: 0o700 })
  mkdirSync(join(runtimeHome, 'attachments'), { recursive: true, mode: 0o700 })
  mkdirSync(join(runtimeHome, 'coding-collaboration'), { recursive: true, mode: 0o700 })
  mkdirSync(join(runtimeHome, 'pi'), { recursive: true, mode: 0o700 })
  return runtimeHome
}

function workspaceRuntimeDirectory(runtimeHome: string, workspace: string): string {
  const sum = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return join(runtimeHome, 'workspaces', sum)
}

function encodeAcpGuestArgs(args: string[] | undefined): string {
  if (!args?.length) return ''
  try {
    return JSON.stringify(args)
  } catch {
    return args.join(' ')
  }
}

const HELPER_ENV_SKIP = new Set([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
])

export type NativeInvoke = (message: RpcMessage) => Promise<unknown>

export function parseSidecarHelperEnvironment(value: unknown): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue
      const cut = entry.indexOf('=')
      if (cut <= 0) continue
      const name = entry.slice(0, cut)
      if (!name || HELPER_ENV_SKIP.has(name)) continue
      result[name] = entry.slice(cut + 1)
    }
    return result
  }
  if (value && typeof value === 'object') {
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!name || HELPER_ENV_SKIP.has(name) || raw == null) continue
      if (typeof raw === 'string') result[name] = raw
    }
  }
  return result
}

export async function loadSidecarHelperEnvironment(
  invoke: NativeInvoke | undefined,
): Promise<NodeJS.ProcessEnv> {
  if (!invoke) return {}
  try {
    const result = await invoke({
      type: 'invoke',
      id: randomUUID(),
      source: 'electron_host',
      method: 'ExportSidecarEnvironment',
      args: [],
    })
    return parseSidecarHelperEnvironment(result)
  } catch {
    return {}
  }
}

export function buildSidecarEnvironment(input: {
  home: string
  workspace: string
  kernel: SidecarKernel
  settings: PublicSettings
  helperPath: string
  traceId: string
  env?: NodeJS.ProcessEnv
  helperEnv?: NodeJS.ProcessEnv | string[]
}): NodeJS.ProcessEnv {
  const env = input.env ?? process.env
  const runtimeHome = sidecarRuntimeHome(input.home)
  const workspace = resolveAgentWorkspace(input.workspace, input.home)
  const runtimeDirectory = workspaceRuntimeDirectory(runtimeHome, workspace)
  const temporaryDirectory = join(runtimeDirectory, 'tmp')
  const backgroundTasksDirectory = join(runtimeDirectory, 'background-tasks')
  for (const directory of [
    join(runtimeDirectory, 'home'),
    temporaryDirectory,
    join(runtimeDirectory, 'runtime-bin'),
    backgroundTasksDirectory,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  const next: NodeJS.ProcessEnv = {}
  for (const name of [
    'DEEPSEEK_API_KEY',
    'TOKENFLUX_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'MISTRAL_API_KEY',
    'GROQ_API_KEY',
    'MILKSU_CUSTOM_PROVIDER_KEY',
    'MILKSU_RELAY_KEY',
  ]) {
    const value = env[name]
    if (value) next[name] = value
  }
  for (const [name, value] of Object.entries(parseSidecarHelperEnvironment(input.helperEnv))) {
    if (value) next[name] = value
  }

  next.PATH = env.PATH
  next.LANG = env.LANG
  next.LC_ALL = env.LC_ALL
  next.SHELL = env.SHELL
  if (env.ELECTRON_RUN_AS_NODE) next.ELECTRON_RUN_AS_NODE = env.ELECTRON_RUN_AS_NODE
  next.SSL_CERT_DIR = env.SSL_CERT_DIR
  next.SSL_CERT_FILE = env.SSL_CERT_FILE
  next.HOME = runtimeHome
  next.TMPDIR = temporaryDirectory
  next.MILKSU_HOME = input.home
  next.MILKSU_PI_AGENT_DIR = join(runtimeHome, 'pi')
  next.MILKSU_CODING_ATTACHMENT_ROOT = join(runtimeHome, 'attachments')
  next.MILKSU_CODING_COLLABORATION_ROOT = join(runtimeHome, 'coding-collaboration')
  next.MILKSU_VISION_CACHE = join(runtimeHome, 'vision-cache.json')
  next.PI_CACHE_RETENTION = 'long'
  next.MILKSU_PLUGIN_MCP_COMMAND = input.helperPath
  next.MILKSU_PLUGIN_MCP_APPDATA = input.home
  next.MILKSU_USER_HOME = homedir()
  next.MILKSU_WORKSPACE_RUNTIME = runtimeDirectory
  next.MILKSU_BACKGROUND_TASKS_DIR = backgroundTasksDirectory
  next.MILKSU_AGENT_WORKSPACE = workspace
  if (env.SSH_AUTH_SOCK) next.MILKSU_USER_SSH_AUTH_SOCK = env.SSH_AUTH_SOCK
  if (env.MILKSU_FACTORY_SKILLS_DIR) next.MILKSU_FACTORY_SKILLS_DIR = env.MILKSU_FACTORY_SKILLS_DIR
  if (env.MILKSU_MODEL_CATALOG_PATH) next.MILKSU_MODEL_CATALOG_PATH = env.MILKSU_MODEL_CATALOG_PATH
  if (env.MILKSU_SIDECAR_DIR) next.MILKSU_SIDECAR_DIR = env.MILKSU_SIDECAR_DIR
  if (env.MILKSU_CHANNEL) next.MILKSU_CHANNEL = env.MILKSU_CHANNEL
  if (env.MILKSU_APP_VERSION) next.MILKSU_APP_VERSION = env.MILKSU_APP_VERSION

  if (input.kernel === 'dsh') {
    const suffix = String(process.pid)
    next.MILKSU_DSH_PROFILE = 'acp'
    next.MILKSU_DSH_IPC = dshProductIpc(`p${suffix}`, env, process.platform)
    next.MILKSU_DSH_HOST_IPC = dshProductIpc(`h${suffix}`, env, process.platform)
    const dshHome = join(runtimeHome, 'dsh')
    mkdirSync(dshHome, { recursive: true, mode: 0o700 })
    next.DSH_HOME = dshHome
    const guest = normalizeAcpGuest(input.settings.acp_guest)
    if (guest?.command) {
      next.MILKSU_DSH_COMMAND = guest.command
      const encoded = encodeAcpGuestArgs(guest.args)
      if (encoded) next.MILKSU_DSH_ACP_ARGS = encoded
      for (const [name, value] of Object.entries(guest.env ?? {})) {
        next[name] = value
      }
    }
  }

  for (const entry of codingToolsSidecarEnvironment(dataDirectory(input.home))) {
    const cut = entry.indexOf('=')
    if (cut <= 0) continue
    next[entry.slice(0, cut)] = entry.slice(cut + 1)
  }

  const traceId = normalizeTraceId(input.traceId) || generateTraceId()
  return applyTraceEnv(next, traceId)
}

export type SidecarProcess = {
  kernel: SidecarKernel
  workspace: string
  child: ChildProcessWithoutNullStreams
  write(command: Record<string, unknown>): Promise<void>
  kill(): Promise<void>
}

export function startSidecarProcess(input: {
  kernel: SidecarKernel
  workspace: string
  env: NodeJS.ProcessEnv
  helperPath: string
  onLine: (value: unknown) => void
}): SidecarProcess {
  const runtime = resolveSidecarRuntime(input.kernel, input.helperPath, process.env)
  const child = spawn(runtime.node, [runtime.bridge], {
    cwd: input.workspace,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnNodeEnvironment(runtime.node, input.env),
  })
  child.stderr.pipe(process.stderr)
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
    kernel: input.kernel,
    workspace: input.workspace,
    child,
    write(command: Record<string, unknown>) {
      const encoded = `${JSON.stringify(command)}\n`
      writeChain = writeChain.then(
        () => new Promise<void>((resolveWrite, reject) => {
          child.stdin.write(encoded, (error) => {
            if (error) reject(error)
            else resolveWrite()
          })
        }),
      ).catch((error) => {
        throw error
      })
      return writeChain
    },
    async kill() {
      if (child.exitCode !== null) return
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ])
      if (child.exitCode === null) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
    },
  }
}
