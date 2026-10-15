import { randomUUID } from 'node:crypto'
import { access, constants, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { createRequireFromModule } from '../module-path.ts'
import { lookPath } from './paths.ts'

type PtyProcess = {
  pid: number
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
}

type PtyModule = {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: Record<string, string>
      useConpty?: boolean
    },
  ): PtyProcess
}

function loadNodePty(): PtyModule {
  return createRequireFromModule()('node-pty') as PtyModule
}

export const DEFAULT_COLUMNS = 100
export const DEFAULT_ROWS = 28
export const MAX_COLUMNS = 400
export const MAX_ROWS = 200
export const MAX_INPUT_BYTES = 64 * 1024
export const MAX_OUTPUT_BYTES = 512 * 1024
export const MAX_RUNNING_PER_SESSION = 4
const MAX_COMPLETED_PER_SESSION = 12
const MAX_PENDING_PTY_EVENTS = 32

export type TerminalStatus = 'running' | 'exited' | 'stopped' | 'failed'

export type TerminalSession = {
  id: string
  conversationId: string
  workspace: string
  shell: string
  status: TerminalStatus
  pid?: number
  columns: number
  rows: number
  startedAt: number
  endedAt?: number
  exitCode?: number
  output?: string
  outputTrimmed?: boolean
  error?: string
}

export type TerminalEvent = {
  type:
    | 'terminal.started'
    | 'terminal.output'
    | 'terminal.resized'
    | 'terminal.exited'
    | 'terminal.closed'
  conversationId: string
  terminalId: string
  data?: string
  session?: TerminalSession
}

export type PtyHandle = {
  id: string
  pid: number
}

export type PtyOpenRequest = {
  command: string
  args: string[]
  cwd: string
  env: string[]
  columns: number
  rows: number
}

export type PtyDriver = {
  open(request: PtyOpenRequest): Promise<PtyHandle>
  write(id: string, data: string): Promise<void>
  resize(id: string, columns: number, rows: number): Promise<void>
  close(id: string): Promise<void>
}

type PtySink = {
  output: (ptyId: string, data: string) => void
  exit: (ptyId: string, exitCode: number, error?: string) => void
}

const BLOCKED_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'KOURICHAT_API_KEY',
  'MILKSU_RELAY_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
])

type TerminalEntry = {
  view: TerminalSession
  ptyId: string
  output: string
  outputTrimmed: boolean
  stopRequested: boolean
  dismissed: boolean
}

type PendingPtyEvent =
  | { kind: 'output'; data: string }
  | { kind: 'exit'; exitCode: number; error?: string }

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolveNext) => {
      release = resolveNext
    })
    return previous.then(fn).finally(() => release())
  }
}

function newTerminalId(): string {
  return `term_${randomUUID().replaceAll('-', '')}`
}

export function environFromProcess(env: NodeJS.ProcessEnv = process.env): string[] {
  const entries: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    entries.push(`${name}=${value}`)
  }
  return entries
}

export function terminalEnvironment(source: string[]): string[] {
  const environment: string[] = []
  let hasPath = false
  for (const entry of source) {
    const cut = entry.indexOf('=')
    if (cut <= 0) continue
    const name = entry.slice(0, cut)
    if (BLOCKED_ENV.has(name)) continue
    if (name === 'TERM' || name === 'COLORTERM' || name === 'MILKSU_TERMINAL') continue
    if (name === 'PATH') hasPath = true
    environment.push(entry)
  }
  if (!hasPath) {
    if (process.platform === 'win32') {
      const systemRoot = String(process.env.SystemRoot ?? '').trim() || 'C:\\Windows'
      environment.push(`PATH=${join(systemRoot, 'System32')}`)
    } else {
      environment.push('PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
    }
  }
  environment.push('TERM=xterm-256color', 'COLORTERM=truecolor', 'MILKSU_TERMINAL=1')
  return environment
}

export function normalizedSize(columns: number, rows: number): { columns: number; rows: number } {
  let nextColumns = Number.isFinite(columns) ? Math.trunc(columns) : 0
  let nextRows = Number.isFinite(rows) ? Math.trunc(rows) : 0
  if (nextColumns < 20) nextColumns = DEFAULT_COLUMNS
  if (nextRows < 5) nextRows = DEFAULT_ROWS
  if (nextColumns > MAX_COLUMNS) nextColumns = MAX_COLUMNS
  if (nextRows > MAX_ROWS) nextRows = MAX_ROWS
  return { columns: nextColumns, rows: nextRows }
}

export function validateConversationId(value: string): string {
  const next = value.trim()
  if (!next) throw new Error('conversation id is required')
  if (next.length > 200 || next.includes('\0')) throw new Error('invalid conversation id')
  return next
}

function validateTerminalId(value: string): string {
  const next = value.trim()
  if (!next.startsWith('term_') || next.length > 96) {
    throw new Error('invalid terminal session id')
  }
  return next
}

export async function resolveTerminalWorkspace(value: string): Promise<string> {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('project directory is required')
  const absolute = resolve(trimmed)
  let resolved = absolute
  try {
    resolved = await realpath(absolute)
  } catch (error) {
    throw new Error(`resolve project directory: ${error instanceof Error ? error.message : error}`)
  }
  let info
  try {
    info = await stat(resolved)
  } catch (error) {
    throw new Error(`inspect project directory: ${error instanceof Error ? error.message : error}`)
  }
  if (!info.isDirectory()) throw new Error('project directory must be a directory')
  return resolved
}

async function resolveRunnableShell(candidate: string): Promise<string | null> {
  let path = candidate.trim()
  if (!path) return null
  if (!isAbsolute(path)) {
    const found = await lookPath(path)
    if (!found) return null
    path = found
  }
  try {
    const info = await stat(path)
    if (info.isDirectory()) return null
    if (process.platform !== 'win32') await access(path, constants.X_OK)
    return path
  } catch {
    return null
  }
}

function windowsBashCandidates(): string[] {
  const candidates: string[] = []
  const programFiles = String(process.env.ProgramFiles ?? '').trim()
  if (programFiles) candidates.push(join(programFiles, 'Git', 'bin', 'bash.exe'))
  const programFilesX86 = String(process.env['ProgramFiles(x86)'] ?? '').trim()
  if (programFilesX86) candidates.push(join(programFilesX86, 'Git', 'bin', 'bash.exe'))
  candidates.push('bash.exe')
  return candidates
}

export async function resolveShell(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates = [String(env.SHELL ?? '').trim()]
  if (process.platform === 'win32') candidates.push(...windowsBashCandidates())
  else candidates.push('/bin/zsh', '/bin/bash', '/bin/sh')
  for (const candidate of candidates) {
    const resolved = await resolveRunnableShell(candidate)
    if (resolved) return resolved
  }
  throw new Error('no supported local shell is available')
}

function snapshotOf(entry: TerminalEntry): TerminalSession {
  const view: TerminalSession = {
    id: entry.view.id,
    conversationId: entry.view.conversationId,
    workspace: entry.view.workspace,
    shell: entry.view.shell,
    status: entry.view.status,
    columns: entry.view.columns,
    rows: entry.view.rows,
    startedAt: entry.view.startedAt,
  }
  if (entry.view.pid) view.pid = entry.view.pid
  if (entry.view.endedAt !== undefined) view.endedAt = entry.view.endedAt
  if (entry.view.exitCode !== undefined) view.exitCode = entry.view.exitCode
  if (entry.output) view.output = entry.output
  if (entry.outputTrimmed) view.outputTrimmed = true
  if (entry.view.error) view.error = entry.view.error
  return view
}

function appendOutput(entry: TerminalEntry, data: string): void {
  entry.output += data
  if (entry.output.length > MAX_OUTPUT_BYTES) {
    entry.output = entry.output.slice(entry.output.length - MAX_OUTPUT_BYTES)
    entry.outputTrimmed = true
  }
}

function environmentObject(entries: string[]): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const entry of entries) {
    const cut = entry.indexOf('=')
    if (cut <= 0) continue
    environment[entry.slice(0, cut)] = entry.slice(cut + 1)
  }
  return environment
}

export class NodePtyDriver implements PtyDriver {
  private sink: PtySink | null = null
  private readonly sessions = new Map<string, PtyProcess>()
  private closed = false
  private ptyModule: PtyModule | undefined

  constructor(pty?: PtyModule) {
    this.ptyModule = pty
  }

  private pty(): PtyModule {
    if (!this.ptyModule) this.ptyModule = loadNodePty()
    return this.ptyModule
  }

  attach(sink: PtySink): void {
    this.sink = sink
  }

  async open(request: PtyOpenRequest): Promise<PtyHandle> {
    if (this.closed) throw new Error('PTY helper is closed')
    const command = request.command.trim()
    if (!command) throw new Error('shell command is required')
    const cwd = request.cwd.trim()
    if (!cwd) throw new Error('project directory is required')
    const size = normalizedSize(request.columns, request.rows)
    let ptyProcess: PtyProcess
    try {
      ptyProcess = this.pty().spawn(command, request.args, {
        name: 'xterm-256color',
        cols: size.columns,
        rows: size.rows,
        cwd,
        env: environmentObject(request.env),
        useConpty: process.platform === 'win32',
      })
    } catch (error) {
      throw new Error(`start project terminal: ${error instanceof Error ? error.message : error}`)
    }
    const id = `pty_${randomUUID().replaceAll('-', '')}`
    this.sessions.set(id, ptyProcess)
    ptyProcess.onData((data) => {
      this.sink?.output(id, data)
    })
    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.sink?.exit(id, Number.isFinite(exitCode) ? exitCode : -1)
    })
    return { id, pid: Number.isFinite(ptyProcess.pid) ? Math.trunc(ptyProcess.pid) : 0 }
  }

  async write(id: string, data: string): Promise<void> {
    const session = this.session(id)
    if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) {
      throw new Error(`terminal input must be at most ${MAX_INPUT_BYTES} bytes`)
    }
    session.write(data)
  }

  async resize(id: string, columns: number, rows: number): Promise<void> {
    const session = this.session(id)
    const size = normalizedSize(columns, rows)
    session.resize(size.columns, size.rows)
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id.trim())
    if (!session) return
    this.sessions.delete(id.trim())
    try {
      session.kill()
    } catch {
      // process may already have exited
    }
  }

  async closeAll(): Promise<void> {
    this.closed = true
    const running = [...this.sessions.values()]
    this.sessions.clear()
    for (const session of running) {
      try {
        session.kill()
      } catch {
        // process may already have exited
      }
    }
  }

  private session(id: string): PtyProcess {
    const next = id.trim()
    if (!next.startsWith('pty_') || next.length > 96) {
      throw new Error('invalid terminal session id')
    }
    const session = this.sessions.get(next)
    if (!session) throw new Error('terminal session not found')
    return session
  }
}

export class TerminalManager {
  private readonly mutex = new Mutex()
  private readonly sessions = new Map<string, TerminalEntry>()
  private readonly byPty = new Map<string, string>()
  private readonly pendingPty = new Map<string, PendingPtyEvent[]>()
  private readonly driver: PtyDriver
  private readonly emitFn?: (event: TerminalEvent) => void
  private closed = false
  private lastStartedAt = 0

  constructor(options: { driver: PtyDriver; emit?: (event: TerminalEvent) => void }) {
    this.driver = options.driver
    this.emitFn = options.emit
  }

  start(conversationId: string, workspacePath: string, columns: number, rows: number): Promise<TerminalSession> {
    return this.mutex.run(() => this.startLocked(conversationId, workspacePath, columns, rows))
  }

  list(conversationId: string): Promise<TerminalSession[]> {
    return this.mutex.run(async () => {
      const id = validateConversationId(conversationId)
      const result: TerminalSession[] = []
      for (const entry of this.sessions.values()) {
        if (entry.view.conversationId === id) result.push(snapshotOf(entry))
      }
      result.sort((left, right) => {
        if (left.startedAt === right.startedAt) return left.id.localeCompare(right.id)
        return left.startedAt - right.startedAt
      })
      return result
    })
  }

  write(conversationId: string, terminalId: string, data: string): Promise<void> {
    return this.mutex.run(async () => {
      const entry = this.requireSession(conversationId, terminalId)
      if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error(`terminal input must be at most ${MAX_INPUT_BYTES} bytes`)
      }
      if (entry.view.status !== 'running' || !entry.ptyId) {
        throw new Error('terminal session is not running')
      }
      const ptyId = entry.ptyId
      try {
        await this.driver.write(ptyId, data)
      } catch (error) {
        throw new Error(`write project terminal: ${error instanceof Error ? error.message : error}`)
      }
    })
  }

  resize(
    conversationId: string,
    terminalId: string,
    columns: number,
    rows: number,
  ): Promise<TerminalSession> {
    return this.mutex.run(async () => {
      const entry = this.requireSession(conversationId, terminalId)
      const size = normalizedSize(columns, rows)
      if (entry.view.status !== 'running' || !entry.ptyId) {
        throw new Error('terminal session is not running')
      }
      const ptyId = entry.ptyId
      entry.view.columns = size.columns
      entry.view.rows = size.rows
      const view = snapshotOf(entry)
      try {
        await this.driver.resize(ptyId, size.columns, size.rows)
      } catch (error) {
        throw new Error(`resize project terminal: ${error instanceof Error ? error.message : error}`)
      }
      this.emit({
        type: 'terminal.resized',
        conversationId: view.conversationId,
        terminalId: view.id,
        session: view,
      })
      return view
    })
  }

  stop(conversationId: string, terminalId: string): Promise<TerminalSession> {
    return this.mutex.run(async () => {
      const entry = this.requireSession(conversationId, terminalId)
      if (entry.view.status !== 'running') return snapshotOf(entry)
      entry.stopRequested = true
      const ptyId = entry.ptyId
      if (ptyId) {
        try {
          await this.driver.close(ptyId)
        } catch {
          // helper may already have exited
        }
      }
      return snapshotOf(entry)
    })
  }

  closeSession(conversationId: string, terminalId: string): Promise<void> {
    return this.mutex.run(async () => {
      const entry = this.requireSession(conversationId, terminalId)
      const current = this.sessions.get(entry.view.id)
      if (current !== entry) throw new Error('terminal session not found')
      entry.dismissed = true
      const running = entry.view.status === 'running'
      if (running) entry.stopRequested = true
      const ptyId = entry.ptyId
      this.forget(entry)
      if (running && ptyId) {
        try {
          await this.driver.close(ptyId)
        } catch {
          // helper may already have exited
        }
      }
      this.emit({
        type: 'terminal.closed',
        conversationId,
        terminalId: entry.view.id,
      })
    })
  }

  closeConversation(conversationId: string): Promise<void> {
    const id = conversationId.trim()
    if (!id) return Promise.resolve()
    return this.mutex.run(async () => {
      const identifiers: string[] = []
      for (const entry of this.sessions.values()) {
        if (entry.view.conversationId === id) identifiers.push(entry.view.id)
      }
      for (const terminalId of identifiers) {
        const entry = this.sessions.get(terminalId)
        if (!entry || entry.view.status !== 'running') continue
        entry.stopRequested = true
        const ptyId = entry.ptyId
        if (!ptyId) continue
        try {
          await this.driver.close(ptyId)
        } catch {
          // helper may already have exited
        }
      }
    })
  }

  close(): Promise<void> {
    return this.mutex.run(async () => {
      if (this.closed) return
      this.closed = true
      const running = [...this.sessions.values()].filter((entry) => entry.view.status === 'running')
      for (const entry of running) {
        entry.stopRequested = true
        const ptyId = entry.ptyId
        if (!ptyId) continue
        try {
          await this.driver.close(ptyId)
        } catch {
          // helper may already have exited
        }
      }
    })
  }

  handlePtyOutput(ptyId: string, data: string): void {
    const terminalId = this.byPty.get(ptyId)
    if (!terminalId) {
      this.bufferPty(ptyId, { kind: 'output', data })
      return
    }
    const entry = this.sessions.get(terminalId)
    if (!entry || entry.dismissed) return
    appendOutput(entry, data)
    this.emit({
      type: 'terminal.output',
      conversationId: entry.view.conversationId,
      terminalId: entry.view.id,
      data,
    })
  }

  handlePtyExit(ptyId: string, exitCode: number, error?: string): void {
    const terminalId = this.byPty.get(ptyId)
    if (!terminalId) {
      this.bufferPty(ptyId, { kind: 'exit', exitCode, error })
      return
    }
    this.applyExit(terminalId, exitCode, error)
  }

  nextStartedAtForTest(): number {
    return this.nextStartedAt()
  }

  replaceSessionsForTest(sessions: TerminalSession[]): void {
    this.sessions.clear()
    this.byPty.clear()
    this.pendingPty.clear()
    for (const view of sessions) {
      this.sessions.set(view.id, {
        view: { ...view },
        ptyId: '',
        output: view.output ?? '',
        outputTrimmed: Boolean(view.outputTrimmed),
        stopRequested: false,
        dismissed: false,
      })
    }
  }

  private async startLocked(
    conversationId: string,
    workspacePath: string,
    columns: number,
    rows: number,
  ): Promise<TerminalSession> {
    const conversation = validateConversationId(conversationId)
    const workspace = await resolveTerminalWorkspace(workspacePath)
    const size = normalizedSize(columns, rows)
    const shell = await resolveShell()
    if (this.closed) throw new Error('Coding terminal manager is closed')
    this.pruneConversation(conversation, MAX_COMPLETED_PER_SESSION)
    let running = 0
    for (const candidate of this.sessions.values()) {
      if (candidate.view.conversationId === conversation && candidate.view.status === 'running') {
        running += 1
      }
    }
    if (running >= MAX_RUNNING_PER_SESSION) {
      throw new Error(`at most ${MAX_RUNNING_PER_SESSION} terminal sessions can run for one Coding task`)
    }

    let handle: PtyHandle
    try {
      handle = await this.driver.open({
        command: shell,
        args: ['-l'],
        cwd: workspace,
        env: terminalEnvironment(environFromProcess()),
        columns: size.columns,
        rows: size.rows,
      })
    } catch (error) {
      throw new Error(`start project terminal: ${error instanceof Error ? error.message : error}`)
    }

    if (this.closed) {
      try {
        await this.driver.close(handle.id)
      } catch {
        // manager is already closed
      }
      throw new Error('Coding terminal manager is closed')
    }

    const entry: TerminalEntry = {
      view: {
        id: newTerminalId(),
        conversationId: conversation,
        workspace,
        shell,
        status: 'running',
        pid: handle.pid || undefined,
        columns: size.columns,
        rows: size.rows,
        startedAt: this.nextStartedAt(),
      },
      ptyId: handle.id,
      output: '',
      outputTrimmed: false,
      stopRequested: false,
      dismissed: false,
    }
    this.sessions.set(entry.view.id, entry)
    this.byPty.set(handle.id, entry.view.id)
    const view = snapshotOf(entry)
    this.emit({
      type: 'terminal.started',
      conversationId: conversation,
      terminalId: view.id,
      session: view,
    })
    this.flushPty(handle.id)
    return view
  }

  private requireSession(conversationId: string, terminalId: string): TerminalEntry {
    const conversation = validateConversationId(conversationId)
    const id = validateTerminalId(terminalId)
    const entry = this.sessions.get(id)
    if (!entry) throw new Error('terminal session not found')
    if (entry.view.conversationId !== conversation) {
      throw new Error('terminal session does not belong to this Coding task')
    }
    return entry
  }

  private pruneConversation(conversationId: string, retain: number): void {
    const completed: TerminalEntry[] = []
    for (const entry of this.sessions.values()) {
      if (entry.view.conversationId === conversationId && entry.view.status !== 'running') {
        completed.push(entry)
      }
    }
    if (completed.length <= retain) return
    completed.sort((left, right) => right.view.startedAt - left.view.startedAt)
    for (const entry of completed.slice(retain)) this.forget(entry)
  }

  private forget(entry: TerminalEntry): void {
    this.sessions.delete(entry.view.id)
    if (entry.ptyId) {
      this.byPty.delete(entry.ptyId)
      this.pendingPty.delete(entry.ptyId)
    }
  }

  private nextStartedAt(): number {
    let startedAt = Date.now()
    if (startedAt <= this.lastStartedAt) startedAt = this.lastStartedAt + 1
    this.lastStartedAt = startedAt
    return startedAt
  }

  private bufferPty(ptyId: string, event: PendingPtyEvent): void {
    const queued = this.pendingPty.get(ptyId) ?? []
    queued.push(event)
    if (queued.length > MAX_PENDING_PTY_EVENTS) queued.splice(0, queued.length - MAX_PENDING_PTY_EVENTS)
    this.pendingPty.set(ptyId, queued)
  }

  private flushPty(ptyId: string): void {
    const queued = this.pendingPty.get(ptyId)
    if (!queued?.length) return
    this.pendingPty.delete(ptyId)
    for (const event of queued) {
      if (event.kind === 'output') this.handlePtyOutput(ptyId, event.data)
      else this.handlePtyExit(ptyId, event.exitCode, event.error)
    }
  }

  private applyExit(terminalId: string, exitCode: number, error?: string): void {
    const entry = this.sessions.get(terminalId)
    if (!entry) return
    if (entry.view.status !== 'running') return
    const endedAt = Date.now()
    if (entry.stopRequested) entry.view.status = 'stopped'
    else if (!error && exitCode === 0) entry.view.status = 'exited'
    else {
      entry.view.status = 'failed'
      if (error) entry.view.error = error
    }
    entry.view.endedAt = endedAt
    entry.view.exitCode = exitCode
    const ptyId = entry.ptyId
    entry.ptyId = ''
    if (ptyId) this.byPty.delete(ptyId)
    if (entry.dismissed) return
    const view = snapshotOf(entry)
    this.emit({
      type: 'terminal.exited',
      conversationId: view.conversationId,
      terminalId: view.id,
      session: view,
    })
  }

  private emit(event: TerminalEvent): void {
    this.emitFn?.(event)
  }
}
