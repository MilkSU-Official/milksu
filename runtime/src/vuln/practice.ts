import { createHash } from 'node:crypto'
import { accessSync, constants, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { CVE_ID_PATTERN, formatRFC3339, runeCount } from './ids.ts'

export const PRACTICE_RUN_SCHEMA = 'milksu-vuln-practice-run/v1'
const MAX_COMPOSE_BYTES = 2 << 20
const MAX_COMMAND_BYTES = 12 << 10
const PRACTICE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/

export type PracticeRequest = {
  cveId: string
  environmentId: string
  directory: string
  sourceRevision?: string
  projectName?: string
  cleanupVolumes?: boolean
}

export type PracticeRun = {
  schema: string
  action: string
  state: string
  cveId: string
  environmentId: string
  directory: string
  composeFile: string
  projectName: string
  sourceRevision?: string
  observedAt: string
  evidencePath?: string
  composeSha256?: string
  containerCount: number
  containers?: PracticeContainer[]
  commandSummaries?: PracticeCommandSummary[]
  gates: PracticeRunGates
  limitations?: string[]
  error?: string
}

export type PracticeRunGates = {
  dockerAvailable: boolean
  composeFileValidated: boolean
  started: boolean
  statusObserved: boolean
  stopped: boolean
  noCredentialLeak: boolean
}

export type PracticeContainer = {
  name?: string
  service?: string
  state?: string
  health?: string
}

export type PracticeCommandSummary = {
  name: string
  args: string[]
  exitCode: number
  output?: string
  outputSha256?: string
}

export type PracticeCommandRunner = {
  executables(): { docker: string; compose: string; prefix: string[] }
  run(executable: string, args: string[], environment: string[], directory: string): Promise<{ output: Buffer; error?: Error; exitCode: number }>
}

type ResolvedPractice = {
  request: PracticeRequest
  directory: string
  composeFile: string
  composeHash: string
  projectName: string
}

export async function startPracticeEnvironment(
  dataDirectory: string,
  request: PracticeRequest,
  runner: PracticeCommandRunner = dockerPracticeRunner,
): Promise<PracticeRun> {
  return runPracticeEnvironment(dataDirectory, request, 'start', runner)
}

export async function getPracticeEnvironmentStatus(
  dataDirectory: string,
  request: PracticeRequest,
  runner: PracticeCommandRunner = dockerPracticeRunner,
): Promise<PracticeRun> {
  return runPracticeEnvironment(dataDirectory, request, 'status', runner)
}

export async function stopPracticeEnvironment(
  dataDirectory: string,
  request: PracticeRequest,
  runner: PracticeCommandRunner = dockerPracticeRunner,
): Promise<PracticeRun> {
  return runPracticeEnvironment(dataDirectory, request, 'stop', runner)
}

export async function runPracticeEnvironment(
  dataDirectory: string,
  request: PracticeRequest,
  action: string,
  runner: PracticeCommandRunner,
): Promise<PracticeRun> {
  let resolved: ResolvedPractice
  try {
    resolved = resolvePracticeRequest(request)
  } catch (error) {
    const run = newPracticeRun(action, { request, directory: '', composeFile: '', composeHash: '', projectName: '' })
    run.error = error instanceof Error ? error.message : String(error)
    run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
    persistPracticeRun(dataDirectory, run)
    throw error
  }
  const run = newPracticeRun(action, resolved)
  const environment = practiceCommandEnvironment()
  let dockerExecutable: string
  let composeExecutable: string
  let composePrefix: string[]
  try {
    ;({ docker: dockerExecutable, compose: composeExecutable, prefix: composePrefix } = runner.executables())
  } catch (error) {
    run.error = 'Docker CLI is unavailable'
    run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
    persistPracticeRun(dataDirectory, run)
    throw new Error(`start vulnerability practice: docker CLI unavailable: ${error instanceof Error ? error.message : error}`)
  }
  const composeArgs = (...args: string[]) => [
    ...composePrefix,
    '--ansi', 'never',
    '--project-name', resolved.projectName,
    '--file', resolved.composeFile,
    ...args,
  ]
  const runDocker = async (name: string, args: string[]) => {
    const result = await runner.run(dockerExecutable, args, environment, resolved.directory)
    run.commandSummaries = [...(run.commandSummaries ?? []), summarizePracticeCommand(name, args, result.output, result.error, result.exitCode)]
    return result
  }
  const runCompose = async (name: string, args: string[]) => {
    const result = await runner.run(composeExecutable, args, environment, resolved.directory)
    run.commandSummaries = [...(run.commandSummaries ?? []), summarizePracticeCommand(name, args, result.output, result.error, result.exitCode)]
    return result
  }

  const version = await runDocker('docker version', ['version', '--format', '{{.Server.Version}}'])
  if (version.error) {
    run.error = 'Docker daemon is unavailable'
    run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
    persistPracticeRun(dataDirectory, run)
    throw new Error(`check Docker daemon: ${version.error.message}: ${version.output.toString('utf8').trim()}`)
  }
  run.gates.dockerAvailable = true

  const config = await runCompose('docker compose config', composeArgs('config', '--quiet'))
  if (config.error) {
    run.error = 'Docker Compose rejected the selected practice directory'
    run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
    persistPracticeRun(dataDirectory, run)
    throw new Error(`validate vulnerability practice compose: ${config.error.message}: ${config.output.toString('utf8').trim()}`)
  }
  run.gates.composeFileValidated = true

  if (action === 'start') {
    const up = await runCompose('docker compose up', composeArgs('up', '--detach', '--remove-orphans'))
    if (up.error) {
      run.state = 'failed'
      run.error = 'Docker Compose failed to start the practice environment'
      run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
      persistPracticeRun(dataDirectory, run)
      throw new Error(`start vulnerability practice compose: ${up.error.message}: ${up.output.toString('utf8').trim()}`)
    }
    run.state = 'running'
    run.gates.started = true
    const ps = await runCompose('docker compose ps', composeArgs('ps', '--format', 'json'))
    if (!ps.error) {
      run.containers = parsePracticeContainers(ps.output)
      run.containerCount = run.containers.length
      run.gates.statusObserved = true
    }
  } else if (action === 'status') {
    const ps = await runCompose('docker compose ps', composeArgs('ps', '--format', 'json'))
    if (ps.error) {
      run.state = 'unknown'
      run.error = 'Docker Compose status failed'
      run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
      persistPracticeRun(dataDirectory, run)
      throw new Error(`inspect vulnerability practice compose: ${ps.error.message}: ${ps.output.toString('utf8').trim()}`)
    }
    run.containers = parsePracticeContainers(ps.output)
    run.containerCount = run.containers.length
    run.state = practiceStateFromContainers(run.containers)
    run.gates.statusObserved = true
  } else if (action === 'stop') {
    const args = composeArgs('down', '--remove-orphans')
    if (request.cleanupVolumes) args.push('--volumes')
    const down = await runCompose('docker compose down', args)
    if (down.error) {
      run.state = 'failed'
      run.error = 'Docker Compose failed to stop the practice environment'
      run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
      persistPracticeRun(dataDirectory, run)
      throw new Error(`stop vulnerability practice compose: ${down.error.message}: ${down.output.toString('utf8').trim()}`)
    }
    run.state = 'stopped'
    run.gates.stopped = true
    run.gates.statusObserved = true
  } else {
    run.error = `unsupported vulnerability practice action ${JSON.stringify(action)}`
    run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
    persistPracticeRun(dataDirectory, run)
    throw new Error(run.error)
  }
  run.gates.noCredentialLeak = !practiceRunContainsSensitiveShape(run)
  persistPracticeRun(dataDirectory, run)
  return run
}

const dockerPracticeRunner: PracticeCommandRunner = {
  executables() {
    return findDockerPracticeExecutables()
  },
  run(executable, args, environment, directory) {
    return runCommand(executable, args, environment, directory)
  },
}

function findDockerPracticeExecutables(): { docker: string; compose: string; prefix: string[] } {
  const docker = findDockerExecutable()
  const compose = findDockerComposeExecutable()
  if (compose) return { docker, compose, prefix: [] }
  return { docker, compose: docker, prefix: ['compose'] }
}

function findDockerExecutable(): string {
  const looked = lookPath('docker')
  if (looked) return looked
  const candidates = [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
  ]
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }
  throw new Error('docker executable was not found')
}

function findDockerComposeExecutable(): string | undefined {
  const looked = lookPath('docker-compose')
  if (looked) return looked
  const candidates = [
    join(homedir(), '.docker', 'cli-plugins', 'docker-compose'),
    '/Applications/Docker.app/Contents/Resources/cli-plugins/docker-compose',
    '/usr/local/lib/docker/cli-plugins/docker-compose',
    '/opt/homebrew/lib/docker/cli-plugins/docker-compose',
  ]
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

function lookPath(name: string): string | undefined {
  const names = process.platform === 'win32' && !name.endsWith('.exe') ? [`${name}.exe`, name] : [name]
  for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const file of names) {
      const candidate = join(dir, file)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    const info = statSync(path)
    return info.isFile()
  } catch {
    return false
  }
}

function runCommand(
  executable: string,
  args: string[],
  environment: string[],
  directory: string,
): Promise<{ output: Buffer; error?: Error; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: directory,
      env: Object.fromEntries(environment.map((entry) => {
        const index = entry.indexOf('=')
        return index >= 0 ? [entry.slice(0, index), entry.slice(index + 1)] : [entry, '']
      })),
      timeout: 120_000,
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', (error) => {
      resolve({ output: Buffer.concat(chunks), error, exitCode: 1 })
    })
    child.on('close', (code) => {
      const output = Buffer.concat(chunks)
      if (code === 0) resolve({ output, exitCode: 0 })
      else resolve({ output, error: new Error(`exit ${code ?? 1}`), exitCode: code ?? 1 })
    })
  })
}

function newPracticeRun(action: string, resolved: ResolvedPractice): PracticeRun {
  const request = resolved.request
  return {
    schema: PRACTICE_RUN_SCHEMA,
    action,
    state: action === 'stop' ? 'stopping' : 'pending',
    cveId: String(request.cveId ?? '').trim().toUpperCase(),
    environmentId: String(request.environmentId ?? '').trim(),
    directory: resolved.directory,
    composeFile: resolved.composeFile,
    projectName: resolved.projectName,
    sourceRevision: String(request.sourceRevision ?? '').trim() || undefined,
    observedAt: formatRFC3339(new Date()),
    composeSha256: resolved.composeHash || undefined,
    containerCount: 0,
    gates: {
      dockerAvailable: false,
      composeFileValidated: false,
      started: false,
      statusObserved: false,
      stopped: false,
      noCredentialLeak: false,
    },
    limitations: [
      'This run only starts, inspects, and stops a local Docker Compose learning environment.',
      'It does not run exploit code, submit vulnerability-triggering input, scan external targets, or prove a real asset is vulnerable.',
    ],
  }
}

export function resolvePracticeRequest(request: PracticeRequest): ResolvedPractice {
  const next: PracticeRequest = {
    cveId: String(request.cveId ?? '').trim().toUpperCase(),
    environmentId: String(request.environmentId ?? '').trim(),
    directory: String(request.directory ?? '').trim(),
    sourceRevision: String(request.sourceRevision ?? '').trim(),
    projectName: String(request.projectName ?? '').trim(),
    cleanupVolumes: request.cleanupVolumes,
  }
  if (!CVE_ID_PATTERN.test(next.cveId)) {
    throw new Error('vulnerability practice requires a valid CVE id')
  }
  if (!next.environmentId || runeCount(next.environmentId) > 160) {
    throw new Error('vulnerability practice requires a bounded environment id')
  }
  if (!next.directory) throw new Error('vulnerability practice requires a local directory')
  const absolute = isAbsolute(next.directory) ? next.directory : join(process.cwd(), next.directory)
  let resolvedDirectory: string
  try {
    resolvedDirectory = realpathSync(absolute)
  } catch (error) {
    throw new Error(`resolve vulnerability practice directory: ${error instanceof Error ? error.message : error}`)
  }
  const info = statSync(resolvedDirectory)
  if (!info.isDirectory()) throw new Error('vulnerability practice path must be a directory')
  const composeFile = findPracticeComposeFile(resolvedDirectory)
  const composeData = readFileSync(composeFile)
  if (composeData.length === 0 || composeData.length > MAX_COMPOSE_BYTES) {
    throw new Error(`vulnerability practice compose must be 1 byte to ${MAX_COMPOSE_BYTES} bytes`)
  }
  rejectUnsafePracticeCompose(composeData)
  const composeHash = createHash('sha256').update(composeData).digest('hex')
  let projectName = next.projectName || practiceProjectName(next.cveId, resolvedDirectory)
  if (!PRACTICE_PROJECT_PATTERN.test(projectName)) {
    throw new Error('invalid vulnerability practice compose project name')
  }
  return {
    request: next,
    directory: resolvedDirectory,
    composeFile,
    composeHash,
    projectName,
  }
}

function findPracticeComposeFile(directory: string): string {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const candidate = join(directory, name)
    if (!existsSync(candidate)) continue
    let resolved: string
    try {
      resolved = realpathSync(candidate)
    } catch (error) {
      throw new Error(`resolve vulnerability practice compose: ${error instanceof Error ? error.message : error}`)
    }
    if (!resolved.startsWith(directory + sep)) {
      throw new Error('vulnerability practice compose escapes selected directory')
    }
    const info = statSync(resolved)
    if (info.isFile()) return resolved
  }
  throw new Error('vulnerability practice directory must contain docker-compose.yml, docker-compose.yaml, compose.yml, or compose.yaml')
}

function rejectUnsafePracticeCompose(data: Buffer): void {
  const lower = data.toString('utf8').toLowerCase()
  for (const forbidden of [
    'network_mode: host',
    'network_mode: "host"',
    "network_mode: 'host'",
    'privileged: true',
    'privileged: "true"',
    "privileged: 'true'",
    'pid: host',
    'pid: "host"',
    "pid: 'host'",
    '/var/run/docker.sock',
  ]) {
    if (lower.includes(forbidden)) {
      throw new Error(`vulnerability practice compose requests unsafe host-level access: ${forbidden}`)
    }
  }
}

function practiceProjectName(cveId: string, directory: string): string {
  const sum = createHash('sha256').update(`${cveId.toLowerCase()}\n${directory}`).digest('hex')
  const suffix = sum.slice(0, 10)
  let compact = cveId.toLowerCase().replaceAll('cve-', '').replaceAll('_', '-').replaceAll('.', '-').replaceAll('/', '-')
  let name = `milksu-cve-${compact}-${suffix}`
  if (name.length > 63) name = name.slice(0, 63)
  name = name.replace(/[_-]+$/, '')
  return name || `milksu-cve-${suffix}`
}

function practiceCommandEnvironment(): string[] {
  const allowed = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR']
  const environment: string[] = []
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment.push(`${name}=${process.env[name]}`)
  }
  return environment
}

function summarizePracticeCommand(
  name: string,
  args: string[],
  output: Buffer,
  runErr: Error | undefined,
  exitCode: number,
): PracticeCommandSummary {
  const hash = createHash('sha256').update(output).digest('hex')
  return {
    name,
    args: [...args],
    exitCode: runErr ? exitCode || 1 : 0,
    output: truncatePracticeOutput(redactPracticeText(output.toString('utf8'))),
    outputSha256: hash,
  }
}

function truncatePracticeOutput(value: string): string {
  if (Buffer.byteLength(value) <= MAX_COMMAND_BYTES) return value
  return `${value.slice(0, MAX_COMMAND_BYTES)}\n[truncated]`
}

function redactPracticeText(value: string): string {
  const replacements = [
    /(api[_-]?key\s*[:=]\s*)[^\s"']+/gi,
    /(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi,
    /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    /(token\s*[:=]\s*)[^\s"']+/gi,
    /(secret\s*[:=]\s*)[^\s"']+/gi,
    /(password\s*[:=]\s*)[^\s"']+/gi,
    /(sk-)[A-Za-z0-9_-]{8,}/g,
  ]
  let redacted = value
  for (const pattern of replacements) {
    redacted = redacted.replace(pattern, '$1[credential redacted]')
  }
  return redacted
}

function practiceRunContainsSensitiveShape(run: PracticeRun): boolean {
  const encoded = JSON.stringify(run).toLowerCase()
  for (const forbidden of [
    'api_key=',
    'api-key=',
    'x-api-key',
    'authorization: bearer',
    'bearer sk-',
    'sk-',
    'password=',
    'secret=',
    'token=',
  ]) {
    if (encoded.includes(forbidden)) return true
  }
  return false
}

function parsePracticeContainers(output: Buffer): PracticeContainer[] {
  const trimmed = output.toString('utf8').trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      return practiceContainersFromMaps(JSON.parse(trimmed) as Array<Record<string, unknown>>)
    } catch {
      // fall through to NDJSON
    }
  }
  const values: Array<Record<string, unknown>> = []
  for (const line of trimmed.split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      values.push(JSON.parse(text) as Record<string, unknown>)
    } catch {
      // skip
    }
  }
  return practiceContainersFromMaps(values)
}

function practiceContainersFromMaps(values: Array<Record<string, unknown>>): PracticeContainer[] {
  const containers: PracticeContainer[] = []
  for (const value of values) {
    const container: PracticeContainer = {
      name: stringFromMap(value, 'Name', 'name'),
      service: stringFromMap(value, 'Service', 'service'),
      state: stringFromMap(value, 'State', 'state'),
      health: stringFromMap(value, 'Health', 'health'),
    }
    if (!container.name && !container.service && !container.state) continue
    containers.push(container)
  }
  return containers
}

function stringFromMap(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = value[key]
    if (typeof raw === 'string' && raw) return raw
  }
  return undefined
}

function practiceStateFromContainers(containers: PracticeContainer[]): string {
  if (containers.length === 0) return 'stopped'
  if (containers.some((container) => (container.state ?? '').toLowerCase() === 'running')) return 'running'
  return 'created'
}

function persistPracticeRun(dataDirectory: string, run: PracticeRun): void {
  if (!dataDirectory.trim()) return
  const safeCve = (run.cveId || 'unknown').toLowerCase().replaceAll('/', '-')
  const root = join(dataDirectory, 'domain', 'vuln', 'practice-runs', safeCve)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const stamp = new Date().toISOString().replace(/[-:]/g, '')
  const path = join(root, `${stamp}-${run.action}.json`)
  run.evidencePath = path
  const payload = `${JSON.stringify(run, null, 2)}\n`
  writeFileSync(path, payload, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // ignore
  }
}
