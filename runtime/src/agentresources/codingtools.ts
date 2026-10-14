import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const SKILL_GHIDRA_RPC = 'ghidra-rpc'
export const SKILL_JADX = 'jadx'
const GHIDRA_RPC_REVISION = '1743305487b1de754fb750486dd468ea4d3c4141'
const GHIDRA_RPC_SOURCE = `git+https://github.com/cellebrite-labs/ghidra-rpc.git@${GHIDRA_RPC_REVISION}`

const STATUS_FOUND = 'found'
const STATUS_MISSING = 'missing'
const STATUS_NEEDS_SETUP = 'needs_setup'
const STATUS_CONFIGURING = 'configuring'
const STATUS_FAILED = 'failed'

export type CodingToolSkillSnapshot = {
  name: string
  status: string
  version?: string
  problem?: string
  canPrepare: boolean
  preparing: boolean
}

export type CodingToolSetupStep = {
  id: string
  label: string
  status: string
  detail?: string
}

export type CodingToolSetupSnapshot = {
  toolId: string
  state: string
  percent: number
  summary: string
  steps: CodingToolSetupStep[]
  error?: string
  startedAt: string
  completedAt?: string
}

export type CommandProbe = {
  lookPath(name: string): Promise<string>
  output(command: string, args: string[]): Promise<string>
}

const systemProbe: CommandProbe = {
  async lookPath(name) {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const which = process.platform === 'win32' ? 'where' : 'which'
    try {
      const { stdout } = await execFileAsync(which, [name], { timeout: 8000 })
      const first = String(stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (!first) throw new Error('not found')
      return first
    } catch {
      throw new Error(`not found: ${name}`)
    }
  },
  async output(command, args) {
    return runCommand(8000, command, args)
  },
}

export function isOptionalCodingSkill(name: string): boolean {
  const value = name.trim()
  return value === SKILL_GHIDRA_RPC || value === SKILL_JADX
}

export function optionalCodingSkillNames(): string[] {
  return [SKILL_GHIDRA_RPC, SKILL_JADX]
}

export class CodingToolsService {
  readonly root: string
  probe: CommandProbe
  private readonly setups = new Map<string, CodingToolSetupSnapshot>()
  private readonly emit?: (snapshot: CodingToolSetupSnapshot) => void

  constructor(
    dataDir: string,
    emit?: (snapshot: CodingToolSetupSnapshot) => void,
    probe: CommandProbe = systemProbe,
  ) {
    this.root = join(dataDir, 'services', 'coding-tools')
    this.emit = emit
    this.probe = probe
  }

  async list(): Promise<CodingToolSkillSnapshot[]> {
    return [await this.snapshot(SKILL_GHIDRA_RPC), await this.snapshot(SKILL_JADX)]
  }

  async check(name: string): Promise<CodingToolSkillSnapshot> {
    if (!isOptionalCodingSkill(name)) throw new Error(`unknown coding skill ${JSON.stringify(name)}`)
    return this.snapshot(name)
  }

  setupStatus(name: string): CodingToolSetupSnapshot {
    if (!isOptionalCodingSkill(name)) throw new Error(`unknown coding skill ${JSON.stringify(name)}`)
    return this.setups.get(name) ?? { toolId: name, state: 'idle', percent: 0, summary: '', steps: [], startedAt: '' }
  }

  async startSetup(name: string): Promise<CodingToolSetupSnapshot> {
    if (name !== SKILL_GHIDRA_RPC) throw new Error(`skill ${JSON.stringify(name)} has no prepare step`)
    const running = this.setups.get(name)
    if (running?.state === 'running') return running
    const snapshot: CodingToolSetupSnapshot = {
      toolId: name,
      state: 'running',
      percent: 0,
      summary: '正在准备 ghidra-rpc',
      startedAt: new Date().toISOString(),
      steps: [
        { id: 'detect', label: '检测 Ghidra、Java 与 uv', status: 'pending' },
        { id: 'install', label: '安装固定版本 ghidra-rpc', status: 'pending' },
        { id: 'verify', label: '运行健康检查', status: 'pending' },
      ],
    }
    this.setSetup(snapshot)
    void this.runGhidraSetup()
    return snapshot
  }

  sidecarEnvironment(): string[] {
    const environment: string[] = []
    const command = this.managedGhidraRPC()
    if (regularExecutable(command)) {
      environment.push(...appendPATH([], dirname(command)))
    }
    const install = findGhidraInstall()
    if (install) environment.push(`GHIDRA_INSTALL_DIR=${install}`)
    const state = ghidraRPCStateDir(this.root)
    if (state) environment.push(`GHIDRA_RPC_STATE_DIR=${state}`)
    return environment
  }

  private async snapshot(name: string): Promise<CodingToolSkillSnapshot> {
    const setup = this.setups.get(name)
    if (setup?.state === 'running') {
      return { name, status: STATUS_CONFIGURING, preparing: true, canPrepare: name === SKILL_GHIDRA_RPC }
    }
    if (name === SKILL_GHIDRA_RPC) return this.detectGhidra()
    if (name === SKILL_JADX) return this.detectJADX()
    return { name, status: STATUS_MISSING, canPrepare: false, preparing: false }
  }

  async detectJADX(): Promise<CodingToolSkillSnapshot> {
    for (const name of ['jadx', 'jadx-gui']) {
      try {
        const command = await this.probe.lookPath(name)
        let version = ''
        try {
          version = await this.probe.output(command, ['--version'])
        } catch {
          version = 'jadx'
        }
        return {
          name: SKILL_JADX,
          status: STATUS_FOUND,
          version: firstLine(version || 'jadx'),
          canPrepare: false,
          preparing: false,
        }
      } catch {
        continue
      }
    }
    return {
      name: SKILL_JADX,
      status: STATUS_MISSING,
      problem: '未在 PATH 中找到 jadx',
      canPrepare: false,
      preparing: false,
    }
  }

  async detectGhidra(): Promise<CodingToolSkillSnapshot> {
    const managed = this.managedGhidraRPC()
    if (regularExecutable(managed)) {
      let version = 'ghidra-rpc'
      try {
        version = firstLine((await this.probe.output(managed, ['--help'])) || 'ghidra-rpc')
      } catch {
        version = 'ghidra-rpc'
      }
      return { name: SKILL_GHIDRA_RPC, status: STATUS_FOUND, version, canPrepare: true, preparing: false }
    }
    try {
      const command = await this.probe.lookPath('ghidra-rpc')
      let version = 'ghidra-rpc'
      try {
        version = firstLine((await this.probe.output(command, ['--help'])) || 'ghidra-rpc')
      } catch {
        version = 'ghidra-rpc'
      }
      return { name: SKILL_GHIDRA_RPC, status: STATUS_FOUND, version, canPrepare: true, preparing: false }
    } catch {
      // fall through
    }
    const ghidra = findGhidraInstall()
    const java = await findJava(this.probe)
    let uvOk = false
    try {
      await this.probe.lookPath('uv')
      uvOk = true
    } catch {
      uvOk = false
    }
    if (ghidra && java && uvOk) {
      return {
        name: SKILL_GHIDRA_RPC,
        status: STATUS_NEEDS_SETUP,
        canPrepare: true,
        preparing: false,
        problem: '已找到 Ghidra，尚未准备 ghidra-rpc',
      }
    }
    let problem = '未找到 Ghidra'
    if (ghidra && !java) problem = '已找到 Ghidra，未找到 Java 17+'
    else if (ghidra && !uvOk) problem = '已找到 Ghidra，准备 ghidra-rpc 还需要 uv'
    return { name: SKILL_GHIDRA_RPC, status: STATUS_MISSING, problem, canPrepare: false, preparing: false }
  }

  private async runGhidraSetup(): Promise<void> {
    try {
      await this.setupGhidra()
    } catch (error) {
      const setup = this.setups.get(SKILL_GHIDRA_RPC)
      if (!setup) return
      setup.state = STATUS_FAILED
      setup.error = error instanceof Error ? error.message : String(error)
      setup.summary = '配置未完成'
      for (const step of setup.steps) {
        if (step.status === 'running') {
          step.status = 'failed'
          step.detail = setup.error
        }
      }
      setup.completedAt = new Date().toISOString()
      this.setSetup(setup)
    }
  }

  private async setupGhidra(): Promise<void> {
    const ghidra = findGhidraInstall()
    if (!ghidra) throw new Error('未检测到 Ghidra 安装目录')
    if (!(await findJava(this.probe))) throw new Error('未检测到 Java')
    let uv: string
    try {
      uv = await this.probe.lookPath('uv')
    } catch {
      throw new Error('需要先安装 uv')
    }
    this.updateStep(SKILL_GHIDRA_RPC, 'detect', 'completed', 20, '已检测 Ghidra、Java 与 uv')
    const root = join(this.root, SKILL_GHIDRA_RPC, GHIDRA_RPC_REVISION)
    const venv = join(root, 'venv')
    await mkdir(root, { recursive: true, mode: 0o700 })
    this.updateStep(SKILL_GHIDRA_RPC, 'install', 'running', 40, '正在安装固定版本 ghidra-rpc')
    await runCommand(4 * 60_000, uv, ['venv', venv, '--python', '3.11'])
    const python = venvPython(venv)
    await runCommand(8 * 60_000, uv, ['pip', 'install', '--python', python, GHIDRA_RPC_SOURCE])
    this.updateStep(SKILL_GHIDRA_RPC, 'install', 'completed', 80, '固定版本 ghidra-rpc 已安装')
    const command = venvCommand(venv, 'ghidra-rpc')
    this.updateStep(SKILL_GHIDRA_RPC, 'verify', 'running', 90, '正在检查 ghidra-rpc')
    await runCommand(30_000, command, ['--help'])
    const now = new Date().toISOString()
    this.setSetup({
      toolId: SKILL_GHIDRA_RPC,
      state: 'completed',
      percent: 100,
      summary: 'ghidra-rpc 已准备',
      steps: [
        { id: 'detect', label: '检测 Ghidra、Java 与 uv', status: 'completed' },
        { id: 'install', label: '安装固定版本 ghidra-rpc', status: 'completed' },
        { id: 'verify', label: '运行健康检查', status: 'completed' },
      ],
      startedAt: now,
      completedAt: now,
    })
  }

  managedGhidraRPC(): string {
    return venvCommand(join(this.root, SKILL_GHIDRA_RPC, GHIDRA_RPC_REVISION, 'venv'), 'ghidra-rpc')
  }

  private setSetup(setup: CodingToolSetupSnapshot): void {
    this.setups.set(setup.toolId, setup)
    this.emit?.(setup)
  }

  private updateStep(id: string, step: string, status: string, percent: number, detail: string): void {
    const setup = this.setups.get(id)
    if (!setup) return
    setup.percent = percent
    setup.summary = detail
    for (const item of setup.steps) {
      if (item.id === step) {
        item.status = status
        item.detail = detail
      }
    }
    this.setSetup(setup)
  }
}

export function codingToolsSidecarEnvironment(dataDir: string): string[] {
  return new CodingToolsService(dataDir).sidecarEnvironment()
}

export function findGhidraInstall(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.GHIDRA_INSTALL_DIR ?? '').trim()
  if (explicit && isGhidraInstall(explicit)) return explicit
  for (const candidate of ghidraInstallCandidates(env)) {
    if (isGhidraInstall(candidate)) return candidate
  }
  return ''
}

export function isGhidraInstall(path: string): boolean {
  const clean = path.trim()
  if (!clean) return false
  for (const relative of [
    'support/analyzeHeadless',
    'support/analyzeHeadless.bat',
    'analyzeHeadless',
    'analyzeHeadless.bat',
    'ghidraRun',
    'ghidraRun.bat',
  ]) {
    if (regularFile(join(clean, relative))) return true
  }
  try {
    if (!statSync(clean).isDirectory()) return false
  } catch {
    return false
  }
  if (process.platform === 'darwin' && clean.endsWith('.app')) {
    return isGhidraInstall(join(clean, 'Contents', 'Resources'))
  }
  return false
}

function ghidraInstallCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = []
  if (process.platform === 'darwin') {
    candidates.push(...globDirs('/Applications', /^ghidra/i))
    try {
      candidates.push(...globDirs(join(homedir(), 'Applications'), /^ghidra/i))
    } catch {
      // ignore
    }
  } else if (process.platform === 'win32') {
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']) {
      const root = String(env[key] ?? '').trim()
      if (root) candidates.push(...globDirs(root, /^ghidra/i))
    }
  } else {
    candidates.push('/opt/ghidra', '/usr/share/ghidra')
    candidates.push(...globDirs('/opt', /^ghidra/i))
  }
  return candidates.sort().reverse()
}

function globDirs(root: string, pattern: RegExp): string[] {
  try {
    return readdirSync(root)
      .filter((name) => pattern.test(name))
      .map((name) => join(root, name))
  } catch {
    return []
  }
}

async function findJava(probe: CommandProbe): Promise<string> {
  try {
    return await probe.lookPath('java')
  } catch {
    const home = String(process.env.JAVA_HOME ?? '').trim()
    if (!home) return ''
    const command = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    return regularExecutable(command) ? command : ''
  }
}

function venvPython(venv: string): string {
  return process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}

function venvCommand(venv: string, name: string): string {
  return process.platform === 'win32'
    ? join(venv, 'Scripts', `${name}.exe`)
    : join(venv, 'bin', name)
}

function appendPATH(environment: string[], directory: string): string[] {
  const value = directory.trim()
  if (!value) return environment
  const current = process.env.PATH ?? ''
  if (!current) return [...environment, `PATH=${value}`]
  return [...environment, `PATH=${value}${process.platform === 'win32' ? ';' : ':'}${current}`]
}

function ghidraRPCStateDir(root: string): string {
  try {
    const path = join(root, 'ghidra-rpc-state')
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    return path
  } catch {
    return ''
  }
}

function firstLine(value: string): string {
  return value.trim().split('\n')[0]?.trim() ?? ''
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function regularExecutable(path: string): boolean {
  try {
    const info = statSync(path)
    if (!info.isFile()) return false
    if (process.platform === 'win32') return true
    return (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function runCommand(timeoutMs: number, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(chunk as Buffer))
    child.stderr.on('data', (chunk) => chunks.push(chunk as Buffer))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('command timed out'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const output = Buffer.concat(chunks).toString('utf8').trim()
      if (code === 0) {
        resolve(output)
        return
      }
      const detail = output.length > 800 ? output.slice(-800) : output
      reject(new Error(detail ? `${command} failed: ${detail}` : `${command} failed`))
    })
  })
}
