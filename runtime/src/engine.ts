import { generateTraceId, normalizeTraceId } from './trace.ts'
import {
  ConversationStore,
  KERNEL_PI,
  hasStarted,
  normalizeKernel,
  preserveSentAttachments,
  type StoredAttachment,
  type StoredConversation,
  type StoredMessage,
} from './conversations.ts'
import { projectBridgeEvent, engineLifecycleEvent, type EngineEvent } from './events.ts'
import {
  readPublicSettings,
  resolvedUserInterfaceLocale,
  resolveAcpAgent,
  type PublicSettings,
} from './settings.ts'
import {
  buildSidecarEnvironment,
  loadSidecarProviderEnvironment,
  resolveAgentWorkspace,
  sidecarWorkspaceKey,
  startSidecarProcess,
  type NativeInvoke,
  type SidecarKernel,
  type SidecarProcess,
} from './sidecar.ts'
import {
  agentSessionMissingError,
  sidecarMissingError,
  type SessionHandoffResult,
} from './session-actions.ts'
import type { AgentResourceStore } from './agentresources/store.ts'
import type { AppSettings, SettingsStore } from './config/settings-store.ts'
import { buildSendMessageCommand } from './engine-turn.ts'
import {
  lookupCodingCollaboration,
  prepareCodingCollaboration,
} from './codingcollab/index.ts'
import { basename } from 'node:path'
import type { ResearchService } from './research/service.ts'
import {
  handleResearchWorkspaceAction,
  isResearchWorkspaceAction,
  researchContinuationPrompt,
} from './research/workspace.ts'
import {
  envBrokerFor,
  handleEnvWorkspaceAction,
  isEnvWorkspaceAction,
} from './envbroker/index.ts'
import type { LabJobStore } from './lab.ts'
import { TASK_INTERRUPTED, TASK_RUNNING, type Run, type WorkerUpdate } from './research/types.ts'
import { ModelUsageStore, usageFromEngineEvent } from './modelusage/index.ts'

export type { SessionHandoffResult }

export type CompactionResult = {
  summary?: string
  surfaceText?: string
  tokensBefore?: number
  estimatedTokensAfter?: number
}

export type DshCommandDescriptor = {
  name: string
  description?: string
  hint?: string
}

export type DshPlanMode = {
  active: boolean
  pending?: boolean
}

export type DshCommandResult = {
  name?: string
  commandId?: string
  kind?: string
  text?: string
  executed?: boolean
}

export type StartSidecar = (
  input: Parameters<typeof startSidecarProcess>[0],
) => SidecarProcess | Promise<SidecarProcess>

export type BackgroundTask = {
  id: string
  name?: string
  kind: string
  status: string
  startedAt: number
  endedAt?: number
  command?: string
  cwd?: string
  pid?: number
  pgid?: number
  ports?: number[]
  logPath?: string
  logTail?: string
  logTruncated?: boolean
  lastExitCode?: number
  error?: string
}

export type BackgroundRecoveryInfo = {
  state: string
  detail?: string
}

export type RuntimeStatus = {
  defaultEngine: string
  running: boolean
  sessionCount: number
  protocol: string
  workspace?: string
  backgroundTasks?: BackgroundTask[]
  backgroundRecovery?: BackgroundRecoveryInfo
}

const FORK_REWIND_TIMEOUT_MS = 8_000
const COMPACTION_TIMEOUT_MS = 130_000
const BACKGROUND_CONTROL_TIMEOUT_MS = 5_000
const BACKGROUND_RECOVERY_TIMEOUT_MS = 20_000
const DSH_CONTROL_TIMEOUT_MS = 15_000
const DSH_EXECUTE_TIMEOUT_MS = 130_000

function compactionFromEvent(event: EngineEvent): CompactionResult {
  const raw = event.compaction
  if (!raw || typeof raw !== 'object') return { summary: '', surfaceText: '' }
  const record = raw as Record<string, unknown>
  return {
    summary: asString(record.summary),
    surfaceText: asString(record.surfaceText),
    tokensBefore: Number(record.tokensBefore ?? 0) || undefined,
    estimatedTokensAfter: Number(record.estimatedTokensAfter ?? 0) || undefined,
  }
}

export type SendMessageArgs = {
  conversationId: string
  prompt: string
  workspacePath: string
  modelMode: string
  modelProvider: string
  modelId: string
  thinkingLevel: string
  modelSourcePreference: string
  executionMode: string
  approvalPolicy: string
  mcpConfigDigest: string
  mcpServers: string[]
  attachments: Array<Record<string, unknown>>
  productAction?: Record<string, unknown> | null
  branchFromUserOccurrence: number
  traceId: string
}

function asString(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeCodingPolicy(executionMode: string, approvalPolicy: string): {
  executionMode: string
  approvalPolicy: string
} {
  let execution = asString(executionMode) || 'go'
  if (execution !== 'plan' && execution !== 'go') {
    throw new Error(`unsupported Coding execution mode ${JSON.stringify(execution)}`)
  }
  let approval = asString(approvalPolicy) || 'workspace-auto'
  switch (approval) {
    case 'read-only':
    case 'ask':
    case 'workspace-auto':
    case 'full-auto':
      break
    default:
      throw new Error(`unsupported Coding approval policy ${JSON.stringify(approval)}`)
  }
  return { executionMode: execution, approvalPolicy: approval }
}

function enabledOptionalSkills(settings: PublicSettings): string[] {
  const raw = settings.enabled_optional_skills
  if (!Array.isArray(raw)) return []
  return raw.map((name) => String(name ?? '').trim()).filter((name) => name === 'ghidra-rpc' || name === 'jadx')
}

function mergeDisabledSkills(user: string[], hideFactory: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of [...user, ...hideFactory]) {
    const value = name.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function filterSkillPaths(paths: string[], disabled: string[]): string[] {
  const blocked = new Set(disabled.map((name) => name.trim()).filter(Boolean))
  return paths.filter((path) => !blocked.has(basename(path)))
}

export type CompanionMemoryHost = {
  publishedMemory(): { revision: number; memories: Array<Record<string, string>> }
  noteExternalTurn(
    phase: string,
    userText: string,
    assistantText: string,
    aborted: boolean,
  ): Promise<void>
  setMemoryViewListener(
    listener: (revision: number, memories: Array<Record<string, string>>) => void,
  ): void
}

function storedAttachments(attachments: Array<Record<string, unknown>>): StoredAttachment[] {
  const stored: StoredAttachment[] = []
  for (const item of attachments ?? []) {
    const id = asString(item.id)
    const name = asString(item.name)
    if (!id || !name) continue
    stored.push({
      id,
      name,
      mediaType: asString(item.mediaType),
      size: Number(item.size ?? 0),
      sha256: asString(item.sha256),
    })
  }
  return stored
}

function sameAttachmentSet(saved: StoredAttachment[] | undefined, incoming: StoredAttachment[]): boolean {
  if ((saved?.length ?? 0) !== incoming.length) return false
  return incoming.every((item, index) => saved![index].id === item.id && saved![index].name === item.name)
}

class ControlQueue {
  private readonly items: EngineEvent[] = []
  private readonly waiters: Array<(event: EngineEvent) => void> = []

  push(event: EngineEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter(event)
    else this.items.push(event)
  }

  take(): Promise<EngineEvent> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift()!)
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

const MAX_PARKED_SIDECARS = 3
const MAX_PARKED_SIDECARS_HARD = MAX_PARKED_SIDECARS * 2
const SIDECAR_IDLE_TIMEOUT_MS = 15 * 60 * 1000

function kernelFromWorkspaceKey(key: string): SidecarKernel {
  const cut = key.indexOf('\0')
  return (cut > 0 ? key.slice(0, cut) : key) as SidecarKernel
}

export class Engine {
  private readonly processes = new Map<string, SidecarProcess>()
  private readonly parked = new Map<string, SidecarProcess>()
  private readonly parkedAt = new Map<string, number>()
  private readonly starting = new Map<string, Promise<SidecarProcess>>()
  private readonly retiring = new Set<string>()
  private readonly sessionKernel = new Map<string, SidecarKernel>()
  private readonly sessionWorkspaces = new Map<string, string>()
  private readonly sessionAgentIds = new Map<string, string>()
  private readonly sessions = new Set<string>()
  private readonly busySessions = new Set<string>()
  private readonly researchRuns = new Map<string, string>()
  private readonly controlWaiters = new Map<string, ControlQueue>()
  private readonly home: string
  private readonly conversations: ConversationStore
  private readonly sidecarDir: string
  private readonly emit: (event: string, payload: unknown) => void
  private readonly invokeNative?: NativeInvoke
  private research: ResearchService | null = null
  private settingsStore: SettingsStore | null = null
  private usageStore: ModelUsageStore | null = null
  private labJobs: LabJobStore | null = null
  private companion: CompanionMemoryHost | null = null
  private readonly backgroundTasks = new Map<string, BackgroundTask[]>()
  private readonly recoveryFailures = new Map<string, string>()
  private readonly recoveryWaiters = new Map<string, ControlQueue[]>()
  private readonly silentSessions = new Set<string>()
  private readonly silentWaiters = new Map<string, ControlQueue>()

  private readonly resolveResources?: () => AgentResourceStore | undefined
  private readonly startSidecar: StartSidecar

  constructor(
    home: string,
    conversations: ConversationStore,
    sidecarDir: string,
    emit: (event: string, payload: unknown) => void,
    invokeNative?: NativeInvoke,
    resolveResources?: () => AgentResourceStore | undefined,
    startSidecar?: StartSidecar,
  ) {
    this.home = home
    this.conversations = conversations
    this.sidecarDir = sidecarDir
    this.emit = emit
    this.invokeNative = invokeNative
    this.resolveResources = resolveResources
    this.startSidecar = startSidecar ?? startSidecarProcess
  }

  attachResearch(service: ResearchService): void {
    this.research = service
  }

  attachSettings(store: SettingsStore): void {
    this.settingsStore = store
  }

  attachUsage(store: ModelUsageStore): void {
    this.usageStore = store
  }

  attachLabJobs(store: LabJobStore): void {
    this.labJobs = store
  }

  attachCompanion(companion: CompanionMemoryHost): void {
    this.companion = companion
    companion.setMemoryViewListener((revision, memories) => {
      void this.broadcastUserMemory(memories, revision)
    })
  }

  private async broadcastUserMemory(
    memories: Array<Record<string, string>>,
    revision: number,
  ): Promise<void> {
    for (const proc of this.liveProcesses('pi')) {
      try {
        await proc.write({
          action: 'update_user_memory',
          userMemories: memories,
          memoryRevision: revision,
        })
      } catch {
        // sidecar may have stopped
      }
    }
  }

  bindSessionKernel(sessionId: string, kernel: SidecarKernel): void {
    this.sessionKernel.set(sessionId, kernel)
  }

  kernelFor(sessionId: string, stored?: StoredConversation): SidecarKernel {
    const bound = this.sessionKernel.get(sessionId)
    if (bound) return bound
    const kernel = normalizeKernel(stored?.kernel) as SidecarKernel
    this.sessionKernel.set(sessionId, kernel)
    return kernel
  }

  private emitEngine(event: EngineEvent): void {
    this.emit('engine-event', event)
  }

  private liveProcesses(kernel?: SidecarKernel): SidecarProcess[] {
    const live: SidecarProcess[] = []
    for (const proc of this.processes.values()) {
      if (proc.child.exitCode !== null) continue
      if (kernel && proc.kernel !== kernel) continue
      live.push(proc)
    }
    return live
  }

  private parkedCount(kernel: SidecarKernel): number {
    let count = 0
    for (const key of this.parked.keys()) {
      if (kernelFromWorkspaceKey(key) === kernel) count += 1
    }
    return count
  }

  private kernelStillRunning(kernel: SidecarKernel): boolean {
    return this.liveProcesses(kernel).length > 0 || this.parkedCount(kernel) > 0
  }

  private workspaceBusy(kernel: SidecarKernel, workspace: string, agentId = ''): boolean {
    for (const [id, bound] of this.sessionWorkspaces) {
      if (
        bound === workspace
        && this.sessionKernel.get(id) === kernel
        && (this.sessionAgentIds.get(id) || '') === agentId
        && this.busySessions.has(id)
      ) {
        return true
      }
    }
    return false
  }

  private bindSessionWorkspace(
    sessionId: string,
    workspace: string,
    kernel: SidecarKernel,
    agentId = '',
  ): void {
    const id = asString(sessionId)
    if (!id || !workspace) return
    this.sessionWorkspaces.set(id, workspace)
    this.sessionKernel.set(id, kernel)
    if (kernel === 'dsh' && agentId) this.sessionAgentIds.set(id, agentId)
    else this.sessionAgentIds.delete(id)
  }

  private copySessionBinding(from: string, to: string): void {
    const kernel = this.sessionKernel.get(from)
    if (kernel) this.sessionKernel.set(to, kernel)
    const workspace = this.sessionWorkspaces.get(from)
    if (workspace) this.sessionWorkspaces.set(to, workspace)
    const agentId = this.sessionAgentIds.get(from)
    if (agentId) this.sessionAgentIds.set(to, agentId)
  }

  private processFor(sessionId: string): SidecarProcess | null {
    const kernel = this.sessionKernel.get(sessionId)
    const workspace = this.sessionWorkspaces.get(sessionId)
    if (!kernel || !workspace) return null
    const key = sidecarWorkspaceKey(kernel, workspace, this.sessionAgentIds.get(sessionId) || '')
    const bound = this.processes.get(key)
    if (bound && bound.child.exitCode === null) return bound
    const parked = this.parked.get(key)
    if (parked && parked.child.exitCode === null) return parked
    return null
  }

  private async retireProcess(key: string, proc: SidecarProcess): Promise<void> {
    this.retiring.add(key)
    if (this.processes.get(key) === proc) this.processes.delete(key)
    try {
      await proc.kill()
    } finally {
      this.retiring.delete(key)
    }
  }

  private async stopWorkspaceIfIdle(kernel: SidecarKernel, workspace: string, agentId = ''): Promise<void> {
    for (const [id, bound] of this.sessionWorkspaces) {
      if (
        bound === workspace
        && this.sessionKernel.get(id) === kernel
        && (this.sessionAgentIds.get(id) || '') === agentId
        && this.sessions.has(id)
      ) {
        return
      }
    }
    const key = sidecarWorkspaceKey(kernel, workspace, agentId)
    const proc = this.processes.get(key)
    if (!proc) return
    this.processes.delete(key)
    this.parked.set(key, proc)
    this.parkedAt.set(key, Date.now())
    await this.evictParked(kernel)
    await this.reapParked(kernel)
  }

  private async evictParked(kernel: SidecarKernel): Promise<void> {
    while (this.parkedCount(kernel) > MAX_PARKED_SIDECARS) {
      const candidate = this.oldestIdleParked(kernel)
      if (!candidate) {
        if (this.parkedCount(kernel) > MAX_PARKED_SIDECARS_HARD) {
          console.error(`[sidecar] parked eviction skipped; ${this.parkedCount(kernel)} ${kernel} sidecar(s) are still busy`)
        }
        return
      }
      const proc = this.parked.get(candidate)
      this.parked.delete(candidate)
      this.parkedAt.delete(candidate)
      if (proc) await this.retireProcess(candidate, proc)
    }
  }

  private oldestIdleParked(kernel: SidecarKernel): string | null {
    let oldestKey = ''
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [key, at] of this.parkedAt) {
      if (kernelFromWorkspaceKey(key) !== kernel) continue
      const proc = this.parked.get(key)
      if (!proc || proc.child.exitCode !== null) continue
      if (this.workspaceBusy(proc.kernel, proc.workspace, proc.agentId || '')) continue
      if (at < oldestAt) {
        oldestAt = at
        oldestKey = key
      }
    }
    return oldestKey || null
  }

  private async reapParked(kernel: SidecarKernel): Promise<void> {
    const now = Date.now()
    for (const [key, at] of [...this.parkedAt]) {
      if (kernelFromWorkspaceKey(key) !== kernel) continue
      if (now - at < SIDECAR_IDLE_TIMEOUT_MS) continue
      const proc = this.parked.get(key)
      if (!proc) {
        this.parkedAt.delete(key)
        continue
      }
      if (this.workspaceBusy(proc.kernel, proc.workspace, proc.agentId || '')) continue
      this.parked.delete(key)
      this.parkedAt.delete(key)
      await this.retireProcess(key, proc)
    }
  }

  private async ensureProcess(
    kernel: SidecarKernel,
    workspace: string,
    settings: PublicSettings,
    traceId: string,
    agentId = '',
  ): Promise<SidecarProcess> {
    const key = sidecarWorkspaceKey(kernel, workspace, agentId)
    const existing = this.processes.get(key)
    if (existing && existing.child.exitCode === null) return existing
    const parked = this.parked.get(key)
    if (parked && parked.child.exitCode === null) {
      this.parked.delete(key)
      this.parkedAt.delete(key)
      this.processes.set(key, parked)
      return parked
    }
    await this.reapParked(kernel)
    const inflight = this.starting.get(key)
    if (inflight) return inflight
    const spawn = this.spawnProcess(kernel, workspace, settings, traceId, key, agentId)
    this.starting.set(key, spawn)
    try {
      return await spawn
    } finally {
      if (this.starting.get(key) === spawn) this.starting.delete(key)
    }
  }

  private async spawnProcess(
    kernel: SidecarKernel,
    workspace: string,
    settings: PublicSettings,
    traceId: string,
    key: string,
    agentId = '',
  ): Promise<SidecarProcess> {
    const sidecarProviderEnv = this.settingsStore
      ? this.settingsStore.exportSidecarEnvironment()
      : await loadSidecarProviderEnvironment(this.invokeNative)
    const env = buildSidecarEnvironment({
      home: this.home,
      workspace,
      kernel,
      settings,
      agentId,
      sidecarDir: this.sidecarDir,
      traceId,
      sidecarProviderEnv,
    })
    const proc = await this.startSidecar({
      kernel,
      workspace,
      env,
      sidecarDir: this.sidecarDir,
      onLine: (value) => this.handleSidecarLine(kernel, key, value),
    })
    proc.agentId = agentId || undefined
    const firstOfKernel = this.liveProcesses(kernel).length === 0
    this.processes.set(key, proc)
    proc.child.once('exit', () => {
      if (this.processes.get(key) === proc) this.processes.delete(key)
      if (this.parked.get(key) === proc) {
        this.parked.delete(key)
        this.parkedAt.delete(key)
      }
      if (this.retiring.has(key)) return
      for (const [id, bound] of [...this.sessionWorkspaces]) {
        if (bound !== workspace || this.sessionKernel.get(id) !== kernel) continue
        if ((this.sessionAgentIds.get(id) || '') !== agentId) continue
        this.sessions.delete(id)
        this.busySessions.delete(id)
      }
      if (this.kernelStillRunning(kernel)) return
      const stopped = engineLifecycleEvent(kernel, 'engine.stopped')
      this.deliverControlEvent(stopped)
      this.deliverSilentEvent(stopped)
      this.emitEngine(stopped)
    })
    if (firstOfKernel) this.emitEngine(engineLifecycleEvent(kernel, 'engine.started'))
    return proc
  }

  private handleSidecarLine(kernel: SidecarKernel, processKey: string, value: unknown): void {
    const raw = (value && typeof value === 'object') ? value as Record<string, unknown> : {}
    if (asString(raw.type) === 'workspace_action') {
      void this.handleWorkspaceAction(kernel, processKey, raw)
      return
    }
    if (asString(raw.type) === 'user_memory_turn') {
      this.forwardUserMemoryTurn(raw)
      return
    }
    const event = projectBridgeEvent(raw, kernel)
    const sessionId = asString(event.sessionId)
    const silent = this.isSilentSession(sessionId)
    if (!silent && event.sessionId) this.sessions.add(event.sessionId)
    if (!silent && event.forkedSessionId) {
      this.sessions.add(event.forkedSessionId)
      const parent = asString(event.sessionId)
      this.copySessionBinding(parent, event.forkedSessionId)
      if (!this.sessionKernel.get(event.forkedSessionId)) {
        this.sessionKernel.set(event.forkedSessionId, kernel)
      }
    }
    if (!silent && event.type === 'assistant.started' && event.sessionId) this.busySessions.add(event.sessionId)
    if (
      !silent
      && (event.type === 'assistant.settled' || event.type === 'session.destroyed' || event.type === 'engine.error')
      && event.sessionId
    ) {
      this.busySessions.delete(event.sessionId)
    }
    this.deliverControlEvent(event)
    this.deliverSilentEvent(event)
    if (silent) return
    this.emitEngine(event)
    if (event.type === 'guard.alarm' || event.type === 'engine.error') {
      void this.rememberAgentProblem(event)
    }
    if (event.type === 'assistant.started') {
      void this.forgetAgentProblem(event.sessionId ?? '')
    }
    if (event.type === 'runtime.research_tasks') {
      void this.recordResearchWorkerEvent(event)
    }
    if (event.type === 'runtime.research_cancel_unconfirmed' || event.type === 'runtime.research_cancel_confirmed') {
      void this.recordResearchCancelState(event, event.type === 'runtime.research_cancel_unconfirmed')
    }
    if (event.type === 'session.destroyed' || event.type === 'engine.error') {
      void this.interruptResearchRunForSession(event.sessionId ?? '')
    }
    this.cacheBackgroundTasks(event)
    this.notifyRecoveryWaiters(event)
    this.recordUsageEvent(event)
  }

  private forwardUserMemoryTurn(raw: Record<string, unknown>): void {
    const id = asString(raw.id)
    if (
      id.startsWith('milksu_text_projection_')
      || id.startsWith('milksu_model_probe_')
    ) return
    void this.companion?.noteExternalTurn(
      asString(raw.phase),
      asString(raw.userText),
      asString(raw.assistantText),
      Boolean(raw.aborted),
    )
  }

  private async rememberAgentProblem(event: EngineEvent): Promise<void> {
    const id = asString(event.sessionId)
    const notice = asString(event.notice)
    const noticeEnglish = asString(event.noticeEnglish)
    if (!id || (!notice && !noticeEnglish && !event.error)) return
    try {
      const value = await this.conversations.get(id)
      value.agentProblem = {
        notice: notice || asString(event.error),
        noticeEnglish,
        at: Date.now(),
      }
      await this.conversations.save(value)
      this.emit('conversations-changed', {})
    } catch {
      // turn may not have been saved yet
    }
  }

  private async forgetAgentProblem(id: string): Promise<void> {
    const sessionId = asString(id)
    if (!sessionId) return
    try {
      const value = await this.conversations.get(sessionId)
      if (!value.agentProblem) return
      value.agentProblem = undefined
      await this.conversations.save(value)
      this.emit('conversations-changed', {})
    } catch {
      // missing record
    }
  }

  async clearConversationProblem(id: string): Promise<void> {
    await this.forgetAgentProblem(id)
  }

  private async rememberSentAttachments(
    conversationId: string,
    prompt: string,
    attachments: StoredAttachment[],
  ): Promise<void> {
    if (!attachments.length) return
    let stored: StoredConversation
    try {
      stored = await this.conversations.get(conversationId)
    } catch {
      return
    }
    for (let index = stored.messages.length - 1; index >= 0; index -= 1) {
      const message = stored.messages[index]
      if (message.role !== 'user' || asString(message.content) !== prompt) continue
      if (sameAttachmentSet(message.attachments, attachments)) return
      if (!message.attachments?.length) {
        stored.messages[index].attachments = attachments
        await this.conversations.save(stored)
      }
      return
    }
    const message: StoredMessage = {
      id: `att-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachments,
    }
    stored.messages.push(message)
    await this.conversations.save(stored)
  }

  private async requireAgentCommand(
    kernel: SidecarKernel,
    settings?: PublicSettings,
    agentId?: string,
  ): Promise<{ id: string; agent: NonNullable<ReturnType<typeof resolveAcpAgent>>['agent'] } | null> {
    if (kernel !== 'dsh') return null
    const resolved = settings ?? this.settingsStore?.get() ?? await readPublicSettings(this.home)
    const agent = resolveAcpAgent(resolved, agentId)
    if (!agent?.agent.command) throw new Error('Agent command is not configured')
    return agent
  }

  async sendMessage(args: SendMessageArgs): Promise<void> {
    const conversationId = asString(args.conversationId)
    const prompt = asString(args.prompt)
    if (!conversationId) throw new Error('session id is required')
    if (!prompt) throw new Error('prompt is required')

    let stored: StoredConversation | undefined
    try {
      stored = await this.conversations.get(conversationId)
    } catch {
      stored = undefined
    }

    const kernel = this.kernelFor(conversationId, stored)
    const settings = this.settingsStore
      ? this.resolvedTurnSettings()
      : await readPublicSettings(this.home)
    const agent = await this.requireAgentCommand(kernel, settings, stored?.acpAgentId)
    const agentId = kernel === 'dsh' ? (agent?.id || '') : ''
    const provider = asString(args.modelProvider) || asString(settings.active_provider)
    const model = asString(args.modelId) || asString(settings.active_model)
    const policy = normalizeCodingPolicy(args.executionMode, args.approvalPolicy)
    const workspace = resolveAgentWorkspace(args.workspacePath || stored?.workspacePath || '', this.home)
    this.bindSessionWorkspace(conversationId, workspace, kernel, agentId)
    const traceId = normalizeTraceId(args.traceId) || generateTraceId()

    let sessionRole = ''
    const kind = stored?.domainTaskContext?.kind
    if (kind === 'cve') sessionRole = 'cve-research'
    else if (kind === 'lab') sessionRole = 'lab-job'
    const imageDraw = stored?.workspaceHome === 'image'
    const memory = this.companion?.publishedMemory() ?? { memories: [], revision: 0 }

    const userDisabled = Array.isArray(settings.disabled_skills)
      ? settings.disabled_skills.map(String)
      : []
    let disabledSkills = userDisabled
    let userMcpServers: unknown
    let userSkillPaths: string[] | undefined
    const resources = await this.resolveResources?.()?.runtime(enabledOptionalSkills(settings))
    if (resources) {
      disabledSkills = mergeDisabledSkills(userDisabled, resources.hideFactorySkills)
      if (Object.keys(resources.mcpServers).length) userMcpServers = resources.mcpServers
      const skillPaths = [
        ...filterSkillPaths(resources.skillPaths, userDisabled),
        ...resources.optionalSkillPaths,
      ]
      if (skillPaths.length) userSkillPaths = skillPaths
    }

    const codingBrowser = await this.lookupCodingBrowser(conversationId)
    const computerUse = await this.lookupComputerUse(conversationId)
    const securityTools = await this.lookupSecurityTools()
    const codingCollaboration = await lookupCodingCollaboration(
      this.home,
      conversationId,
      args.workspacePath || stored?.workspacePath || '',
    )

    const command = buildSendMessageCommand({
      conversationId,
      prompt,
      workspace,
      home: this.home,
      sessionRole,
      imageDraw,
      executionMode: policy.executionMode,
      approvalPolicy: policy.approvalPolicy,
      mcpServers: Array.isArray(args.mcpServers) ? args.mcpServers : [],
      mcpConfigDigest: asString(args.mcpConfigDigest),
      attachments: args.attachments ?? [],
      productAction: args.productAction,
      branchFromUserOccurrence: args.branchFromUserOccurrence,
      traceId,
      provider,
      model,
      thinkingLevel: args.thinkingLevel || asString(settings.runtime_thinking_level),
      modelSourcePreference: args.modelSourcePreference,
      settings,
      locale: resolvedUserInterfaceLocale(settings),
      userMemories: memory.memories,
      memoryRevision: memory.revision,
      codingBrowser,
      computerUse,
      codingCollaboration,
      securityTools,
      disabledSkills,
      userMcpServers,
      userSkillPaths,
    })

    const proc = await this.ensureProcess(kernel, workspace, settings, traceId, agentId)
    await proc.write(command)
    this.sessions.add(conversationId)
    await this.rememberSentAttachments(conversationId, prompt, storedAttachments(args.attachments ?? []))
  }

  // 无工具 Pi 回合，不进对话流、不记账、不记 agentProblem。
  async generateText(prompt: string, modelProvider = '', modelId = ''): Promise<string> {
    const text = asString(prompt)
    if (!text) throw new Error('generation prompt is required')
    if ([...text].length > 48_000) throw new Error('generation prompt exceeds 48000 characters')

    const conversationId = `milksu_text_projection_${Date.now()}`
    const queue = new ControlQueue()
    this.silentSessions.add(conversationId)
    this.silentWaiters.set(conversationId, queue)
    this.sessionKernel.set(conversationId, KERNEL_PI)

    const settings = this.settingsStore
      ? this.resolvedTurnSettings()
      : await readPublicSettings(this.home)
    const provider = asString(modelProvider) || asString(settings.active_provider)
    const model = asString(modelId) || asString(settings.active_model)
    const workspace = resolveAgentWorkspace('', this.home)
    this.bindSessionWorkspace(conversationId, workspace, KERNEL_PI)
    const traceId = generateTraceId()
    const command = buildSendMessageCommand({
      conversationId,
      prompt: text,
      workspace,
      home: this.home,
      sessionRole: '',
      imageDraw: false,
      executionMode: 'plan',
      approvalPolicy: 'read-only',
      mcpServers: [],
      mcpConfigDigest: '',
      attachments: [],
      branchFromUserOccurrence: -1,
      traceId,
      provider,
      model,
      thinkingLevel: asString(settings.runtime_thinking_level),
      modelSourcePreference: '',
      settings,
      locale: resolvedUserInterfaceLocale(settings),
      userMemories: [],
      memoryRevision: 0,
    })

    const maximumOutputBytes = 128 * 1024
    const utf8Bytes = (value: string) => new TextEncoder().encode(value).length
    try {
      const proc = await this.ensureProcess(KERNEL_PI, workspace, settings, traceId)
      await proc.write(command)
      const deadline = Date.now() + 90_000
      let deltas = ''
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          await this.abortMessage(conversationId)
          throw new Error('Pi text projection timed out after 90 seconds')
        }
        const event = await this.takeSilentEvent(queue, remaining)
        switch (event.type) {
          case 'assistant.delta': {
            const piece = event.text ?? ''
            if (utf8Bytes(deltas) + utf8Bytes(piece) > maximumOutputBytes) {
              await this.abortMessage(conversationId)
              throw new Error(`Pi text projection exceeded ${maximumOutputBytes} bytes`)
            }
            deltas += piece
            break
          }
          case 'assistant.completed': {
            const result = asString(event.text) || asString(deltas)
            if (!result) throw new Error('Pi text projection returned empty output')
            if (utf8Bytes(result) > maximumOutputBytes) {
              throw new Error(`Pi text projection exceeded ${maximumOutputBytes} bytes`)
            }
            return result
          }
          case 'tool.started':
          case 'tool.progress':
          case 'tool.completed':
          case 'approval.requested':
            await this.abortMessage(conversationId)
            throw new Error('Pi text projection violated its tool-free contract')
          case 'engine.error':
          case 'engine.stopped':
          case 'engine.protocol_error':
            throw new Error(`Pi text projection failed: ${asString(event.error) || event.type}`)
          default:
            break
        }
      }
      throw new Error('Pi text projection ended without output')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('timed out after 90 seconds')) {
        try { await this.abortMessage(conversationId) } catch { /* ignore */ }
      }
      throw error
    } finally {
      const proc = this.processFor(conversationId)
      if (proc) {
        try {
          await proc.write({
            action: 'destroy_session',
            conversationId,
            deletePersisted: true,
          })
        } catch {
          // process may already be gone
        }
      }
      this.silentSessions.delete(conversationId)
      this.silentWaiters.delete(conversationId)
      this.sessionKernel.delete(conversationId)
      this.sessionWorkspaces.delete(conversationId)
      this.busySessions.delete(conversationId)
      await this.stopWorkspaceIfIdle(KERNEL_PI, workspace)
    }
  }

  private resolvedTurnSettings(): AppSettings {
    if (this.settingsStore && typeof this.settingsStore.getResolved === 'function') {
      return this.settingsStore.getResolved()
    }
    return this.settingsStore?.get() ?? {}
  }

  private async lookupCodingBrowser(conversationId: string) {
    const { codingBrowserDescriptor } = await import('./domains/browser.ts')
    return codingBrowserDescriptor(this.home, conversationId) ?? null
  }

  private async lookupComputerUse(conversationId: string) {
    const { computerUseDescriptor } = await import('./domains/computeruse.ts')
    const descriptor = computerUseDescriptor(this.home, conversationId)
    if (!descriptor) return null
    return {
      sessionId: descriptor.sessionId,
      socketPath: descriptor.socketPath,
      targetBundleId: descriptor.targetBundleId,
      targetName: descriptor.targetName,
      targetPid: descriptor.targetPid,
      targetWindowId: descriptor.targetWindowId,
    }
  }

  private async lookupSecurityTools() {
    const { securityToolsFor } = await import('./domains/platform.ts')
    return securityToolsFor(this.home)?.runtimeTools() ?? []
  }

  async abortMessage(conversationId: string, subagentId = ''): Promise<void> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    const proc = this.processFor(sessionId)
    if (!proc) return
    const command: Record<string, unknown> = {
      action: 'abort_session',
      conversationId: sessionId,
    }
    if (asString(subagentId)) command.subagentId = asString(subagentId)
    await proc.write(command)
  }

  async steerMessage(conversationId: string, prompt: string): Promise<void> {
    const sessionId = asString(conversationId)
    const text = asString(prompt)
    if (!sessionId) throw new Error('session id is required')
    if (!text) throw new Error('steering message is required')
    if ([...text].length > 16000) throw new Error('steering message exceeds 16000 characters')
    const proc = this.processFor(sessionId)
    if (!proc || !this.sessions.has(sessionId)) {
      throw new Error('session is not running')
    }
    await proc.write({
      action: 'steer_message',
      conversationId: sessionId,
      prompt: text,
    })
  }

  private async requireLiveDshSession(conversationId: string): Promise<string> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    let stored: StoredConversation | undefined
    try {
      stored = await this.conversations.get(sessionId)
    } catch {
      stored = undefined
    }
    const kernel = this.kernelFor(sessionId, stored)
    await this.requireAgentCommand(kernel)
    if (!this.sessions.has(sessionId)) throw agentSessionMissingError(sessionId, kernel)
    return sessionId
  }

  async listDshCommands(conversationId: string): Promise<DshCommandDescriptor[]> {
    const event = await this.waitHostControl(
      await this.requireLiveDshSession(conversationId),
      'list_commands',
      {},
      'runtime.dsh_commands',
      DSH_CONTROL_TIMEOUT_MS,
    )
    return Array.isArray(event.commands) ? event.commands as DshCommandDescriptor[] : []
  }

  async executeDshCommand(conversationId: string, line: string): Promise<DshCommandResult> {
    const text = asString(line)
    if (!text) throw new Error('command line is required')
    const event = await this.waitHostControl(
      await this.requireLiveDshSession(conversationId),
      'execute_command',
      { line: text },
      'runtime.dsh_command',
      DSH_EXECUTE_TIMEOUT_MS,
    )
    if (!event.command || typeof event.command !== 'object') {
      throw new Error('command ended without a result')
    }
    return event.command as DshCommandResult
  }

  async setDshPlanMode(conversationId: string, active: boolean): Promise<DshPlanMode> {
    const event = await this.waitHostControl(
      await this.requireLiveDshSession(conversationId),
      'set_plan_mode',
      { active: Boolean(active) },
      'runtime.dsh_command',
      DSH_CONTROL_TIMEOUT_MS,
    )
    if (event.planMode && typeof event.planMode === 'object') {
      return event.planMode as DshPlanMode
    }
    return { active: Boolean(active) }
  }

  async controlDshGoal(conversationId: string, action: string, objective: string): Promise<void> {
    await this.waitHostControl(
      await this.requireLiveDshSession(conversationId),
      'control_goal',
      { goalAction: action, objective },
      'runtime.dsh_command',
      DSH_CONTROL_TIMEOUT_MS,
    )
  }

  async killDshJob(conversationId: string, jobId: string): Promise<void> {
    const id = asString(jobId)
    if (!id) throw new Error('job id is required')
    await this.waitHostControl(
      await this.requireLiveDshSession(conversationId),
      'kill_job',
      { jobId: id },
      'runtime.dsh_job_killed',
      DSH_CONTROL_TIMEOUT_MS,
    )
  }

  async queueMessage(conversationId: string, prompt: string): Promise<void> {
    const sessionId = asString(conversationId)
    const text = asString(prompt)
    if (!sessionId) throw new Error('session id is required')
    if (!text) throw new Error('queued message is required')
    if ([...text].length > 16000) throw new Error('queued message exceeds 16000 characters')
    const proc = this.processFor(sessionId)
    if (!proc || !this.sessions.has(sessionId)) {
      throw new Error('session is not running')
    }
    await proc.write({
      action: 'queue_message',
      conversationId: sessionId,
      prompt: text,
    })
  }

  async removeQueuedMessage(
    conversationId: string,
    queue: string,
    index: number,
    expected: string,
  ): Promise<void> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    const proc = this.processFor(sessionId)
    if (!proc || !this.sessions.has(sessionId)) {
      throw new Error('session is not running')
    }
    await proc.write({
      action: 'remove_queued_message',
      conversationId: sessionId,
      requestId: `queue_remove_${Date.now()}`,
      queue: asString(queue),
      index,
      expected: asString(expected),
    })
  }

  async respondToolApproval(
    conversationId: string,
    requestId: string,
    approved: boolean,
    scope: string,
    choice: string,
  ): Promise<void> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    if (!asString(requestId)) throw new Error('approval request id is required')
    const proc = this.processFor(sessionId)
    if (!proc || !this.sessions.has(sessionId)) {
      throw new Error('session is not running')
    }
    const command: Record<string, unknown> = {
      action: 'approval_response',
      conversationId: sessionId,
      requestId: asString(requestId),
      approved: Boolean(approved),
    }
    if (asString(scope) === 'conversation') command.scope = 'conversation'
    if (asString(choice)) command.choice = asString(choice)
    await proc.write(command)
  }

  async restartEngine(conversationId: string): Promise<void> {
    const sessionId = asString(conversationId)
    const kernel = this.sessionKernel.get(sessionId)
    if (!kernel) return
    const victims: Array<[string, SidecarProcess]> = []
    for (const [key, proc] of [...this.processes.entries()]) {
      if (proc.kernel !== kernel) continue
      victims.push([key, proc])
    }
    for (const [key, proc] of victims) {
      await this.retireProcess(key, proc)
    }
    for (const [id, bound] of [...this.sessionKernel]) {
      if (bound !== kernel) continue
      this.sessions.delete(id)
      this.busySessions.delete(id)
    }
  }

  async destroySession(conversationId: string, deletePersisted = true): Promise<void> {
    const sessionId = asString(conversationId)
    const proc = this.processFor(sessionId)
    if (proc) {
      try {
        await proc.write({
          action: 'destroy_session',
          conversationId: sessionId,
          deletePersisted,
        })
      } catch {
        // process may already be gone
      }
    }
    this.sessions.delete(sessionId)
    this.busySessions.delete(sessionId)
    const kernel = this.sessionKernel.get(sessionId)
    const workspace = this.sessionWorkspaces.get(sessionId)
    const agentId = this.sessionAgentIds.get(sessionId) || ''
    this.sessionKernel.delete(sessionId)
    this.sessionWorkspaces.delete(sessionId)
    this.sessionAgentIds.delete(sessionId)
    if (kernel && workspace) await this.stopWorkspaceIfIdle(kernel, workspace, agentId)
  }

  async detachSession(conversationId: string): Promise<void> {
    await this.destroySession(conversationId, false)
  }

  hasLiveSession(conversationId: string): boolean {
    const sessionId = asString(conversationId)
    return this.sessions.has(sessionId) && this.processFor(sessionId) !== null
  }

  hasRegisteredSession(conversationId: string): boolean {
    return this.sessions.has(asString(conversationId))
  }

  sessionBusy(conversationId: string): boolean {
    const id = asString(conversationId)
    return Boolean(id) && this.busySessions.has(id)
  }

  async sendRegisteredMessage(conversationId: string, prompt: string): Promise<void> {
    const id = asString(conversationId)
    const text = asString(prompt)
    if (!id) throw new Error('session id is required')
    if (!text) throw new Error('relay message is required')
    if ([...text].length > 16000) throw new Error('relay message exceeds 16000 characters')
    if (!this.sessions.has(id)) throw agentSessionMissingError(id, this.sessionKernel.get(id) ?? 'pi')
    await this.writeControl(id, { action: 'relay_message', conversationId: id, prompt: text })
    this.busySessions.add(id)
  }

  async followUpMessage(conversationId: string, prompt: string): Promise<void> {
    const id = asString(conversationId)
    const text = asString(prompt)
    if (!id) throw new Error('session id is required')
    if (!text) throw new Error('follow-up message is required')
    if ([...text].length > 16000) throw new Error('follow-up message exceeds 16000 characters')
    if (!this.sessions.has(id)) throw agentSessionMissingError(id, this.sessionKernel.get(id) ?? 'pi')
    await this.writeControl(id, { action: 'followup_message', conversationId: id, prompt: text })
  }

  private isSilentSession(sessionId: string): boolean {
    return Boolean(sessionId) && (
      this.silentSessions.has(sessionId)
      || sessionId.startsWith('milksu_text_projection_')
    )
  }

  private deliverSilentEvent(event: EngineEvent): void {
    const sessionId = asString(event.sessionId)
    if (sessionId) {
      this.silentWaiters.get(sessionId)?.push(event)
      return
    }
    if (event.type !== 'engine.stopped' && event.type !== 'engine.protocol_error') return
    for (const waiter of this.silentWaiters.values()) waiter.push(event)
  }

  private async takeSilentEvent(queue: ControlQueue, timeoutMs: number): Promise<EngineEvent> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        queue.take(),
        new Promise<EngineEvent>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Pi text projection timed out after 90 seconds')),
            timeoutMs,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private deliverControlEvent(event: EngineEvent): void {
    if (event.type === 'runtime.compaction_started') return
    const requestId = asString(event.requestId)
    if (requestId) {
      this.controlWaiters.get(requestId)?.push(event)
      return
    }
    if (event.type !== 'engine.stopped' && event.type !== 'engine.protocol_error') return
    for (const waiter of this.controlWaiters.values()) waiter.push(event)
  }

  private async takeControl(
    requestId: string,
    timeoutMs: number,
    timedOut: string,
  ): Promise<EngineEvent> {
    const queue = this.controlWaiters.get(requestId)
    if (!queue) throw new Error(timedOut)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        queue.take(),
        new Promise<EngineEvent>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timedOut)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async waitControl(
    requestId: string,
    timeoutMs: number,
    timedOut: string,
  ): Promise<EngineEvent> {
    try {
      return await this.takeControl(requestId, timeoutMs, timedOut)
    } finally {
      this.controlWaiters.delete(requestId)
    }
  }

  private async writeControl(
    sessionId: string,
    command: Record<string, unknown>,
  ): Promise<void> {
    const proc = this.processFor(sessionId)
    if (!proc) throw sidecarMissingError(this.sessionKernel.get(sessionId) ?? 'pi')
    await proc.write(command)
  }

  private async waitHostControl(
    sessionId: string,
    action: string,
    payload: Record<string, unknown>,
    doneType: string,
    timeoutMs: number,
  ): Promise<EngineEvent> {
    const requestId = `dsh_${action}_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(sessionId, {
        action,
        conversationId: sessionId,
        requestId,
        ...payload,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw error
    }
    const event = await this.waitControl(requestId, timeoutMs, `${action} timed out`)
    if (asString(event.error)) throw new Error(asString(event.error))
    if (event.type === 'engine.stopped' || event.type === 'engine.protocol_error') {
      throw sidecarMissingError(this.sessionKernel.get(sessionId) ?? 'dsh')
    }
    if (event.type !== doneType) throw new Error(`${action} ended without a result`)
    return event
  }

  async forkSession(conversationId: string, role: string, occurrence: number): Promise<string> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    const pointRole = role === 'user' ? 'user' : 'assistant'
    const index = occurrence < 0 ? 0 : occurrence
    const requestId = `fork_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(sessionId, {
        action: 'fork_session',
        conversationId: sessionId,
        requestId,
        role: pointRole,
        occurrence: index,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw error
    }
    const event = await this.waitControl(requestId, FORK_REWIND_TIMEOUT_MS, 'forking the conversation timed out')
    if (asString(event.error)) throw new Error(asString(event.error))
    const forkedId = asString(event.forkedSessionId)
    if (!forkedId) throw new Error('forked session id is missing')
    this.sessions.add(forkedId)
    this.copySessionBinding(sessionId, forkedId)
    return forkedId
  }

  async rewindSession(conversationId: string): Promise<void> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    if (!this.sessions.has(sessionId)) {
      throw agentSessionMissingError(sessionId, this.sessionKernel.get(sessionId) ?? 'pi')
    }
    const requestId = `rewind_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(sessionId, {
        action: 'rewind_session',
        conversationId: sessionId,
        requestId,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw error
    }
    const event = await this.waitControl(requestId, FORK_REWIND_TIMEOUT_MS, 'rewinding the conversation timed out')
    if (asString(event.error)) throw new Error(asString(event.error))
    if (event.type !== 'session.rewound') throw new Error('rewind ended without a result')
  }

  async handoffSession(conversationId: string): Promise<SessionHandoffResult> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    if (!this.sessions.has(sessionId)) {
      throw agentSessionMissingError(sessionId, this.sessionKernel.get(sessionId) ?? 'pi')
    }
    const requestId = `handoff_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(sessionId, {
        action: 'handoff_session',
        conversationId: sessionId,
        requestId,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw error
    }
    const event = await this.waitControl(
      requestId,
      COMPACTION_TIMEOUT_MS,
      'handing off the conversation timed out',
    )
    if (asString(event.error)) throw new Error(asString(event.error))
    const forkedId = asString(event.forkedSessionId)
    if (event.type !== 'session.handoff' || !forkedId) {
      throw new Error('handoff ended without a forked session')
    }
    this.sessions.add(forkedId)
    this.copySessionBinding(sessionId, forkedId)
    const compaction = compactionFromEvent(event)
    return {
      sessionId: forkedId,
      summary: compaction.summary,
      surfaceText: compaction.surfaceText,
    }
  }

  async compactSession(conversationId: string): Promise<CompactionResult> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    if (!this.sessions.has(sessionId)) {
      throw agentSessionMissingError(sessionId, this.sessionKernel.get(sessionId) ?? 'pi')
    }
    const requestId = `comp_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(sessionId, {
        action: 'compact_session',
        conversationId: sessionId,
        requestId,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw error
    }
    const deadline = Date.now() + COMPACTION_TIMEOUT_MS
    try {
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('context compaction timed out after 130s')
        const event = await this.takeControl(
          requestId,
          remaining,
          'context compaction timed out after 130s',
        )
        if (event.type === 'engine.stopped' || event.type === 'engine.protocol_error') {
          throw new Error(`context compaction stopped: ${asString(event.error) || event.type}`)
        }
        if (asString(event.error)) {
          throw new Error(`context compaction failed: ${asString(event.error)}`)
        }
        if (event.type === 'runtime.compaction_completed') return compactionFromEvent(event)
      }
    } finally {
      this.controlWaiters.delete(requestId)
    }
  }

  trackResearchRun(sessionId: string, runId: string, active: boolean): void {
    const id = asString(sessionId)
    const researchId = asString(runId)
    if (!id) return
    if (active) {
      if (researchId) this.researchRuns.set(id, researchId)
      return
    }
    const current = this.researchRuns.get(id)
    if (current === researchId || !researchId) this.researchRuns.delete(id)
  }

  async cancelResearchRun(conversationId: string, runId: string): Promise<Run> {
    if (!this.research) throw new Error('research runtime is unavailable')
    const id = asString(conversationId)
    const researchId = asString(runId)
    if (!id || !researchId) throw new Error('conversation and research run id are required')
    const snapshot = await this.research.get(id, researchId)
    let workerStopMayBeNeeded = snapshot.run.workerStopUnconfirmed
    for (const task of snapshot.tasks) {
      if (task.status === TASK_RUNNING || task.status === TASK_INTERRUPTED) {
        workerStopMayBeNeeded = true
        break
      }
    }
    let run = await this.research.cancel(id, researchId)
    this.trackResearchRun(id, run.id, false)
    const livePi = this.hasLiveSession(id) && this.kernelFor(id) === KERNEL_PI
    if (workerStopMayBeNeeded) {
      run = await this.research.setWorkerStopUnconfirmed(id, run.id, true)
    }
    if (livePi) {
      try {
        await this.writeControl(id, {
          action: 'cancel_research_run',
          conversationId: id,
          runId: run.id,
          workerStopMayBeRunning: workerStopMayBeNeeded,
        })
      } catch (error) {
        throw new Error(
          `research run was cancelled but worker stop could not be requested: ${error instanceof Error ? error.message : error}`,
        )
      }
    }
    return run
  }

  private async requirePiResearchConversation(conversationId: string): Promise<void> {
    const id = asString(conversationId)
    if (!id) throw new Error('research conversation is unavailable')
    const stored = await this.conversations.get(id)
    if (normalizeKernel(stored.kernel) !== KERNEL_PI) {
      throw new Error('Deep Research runs require a Pi conversation')
    }
    if (this.kernelFor(id, stored) !== KERNEL_PI) {
      throw new Error("Deep Research runs require the conversation's Pi session")
    }
  }

  private async handleWorkspaceAction(
    kernel: SidecarKernel,
    processKey: string,
    raw: Record<string, unknown>,
  ): Promise<void> {
    const conversationId = asString(raw.id)
    const action = asString(raw.action)
    const requestId = asString(raw.requestId)
    const fromKey = this.processes.get(processKey)
    const proc = (fromKey && fromKey.child.exitCode === null)
      ? fromKey
      : this.processFor(conversationId)
    if (!proc || proc.child.exitCode !== null) return
    if (
      action !== 'prepare_coding_worktree'
      && !isResearchWorkspaceAction(action)
      && !isEnvWorkspaceAction(action)
    ) return
    let result = ''
    let error = ''
    try {
      if (action === 'prepare_coding_worktree') {
        result = await this.prepareCodingWorktree(conversationId, asString(raw.input), kernel)
      } else if (isEnvWorkspaceAction(action)) {
        result = await this.dispatchEnvWorkspaceAction(conversationId, action)
      } else {
        if (!this.research) throw new Error('research runtime is unavailable')
        await this.requirePiResearchConversation(conversationId)
        result = await handleResearchWorkspaceAction(
          {
            service: this.research,
            cancelRun: (id, runId) => this.cancelResearchRun(id, runId),
            trackRun: (id, runId, active) => this.trackResearchRun(id, runId, active),
          },
          conversationId,
          action,
          asString(raw.input),
        )
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    const response: Record<string, unknown> = {
      action: 'workspace_action_response',
      conversationId,
      requestId,
      ok: error === '',
      result,
    }
    if (error) {
      response.error = error
      response.ok = false
    }
    await proc.write(response)
  }

  private async prepareCodingWorktree(
    conversationId: string,
    input: string,
    kernel: SidecarKernel,
  ): Promise<string> {
    let writers = 1
    let path = ''
    const raw = asString(input)
    if (raw) {
      let parsed: { writers?: unknown; path?: unknown }
      try {
        parsed = JSON.parse(raw) as { writers?: unknown; path?: unknown }
      } catch {
        throw new Error('invalid workspace action input')
      }
      if (Number.isInteger(parsed.writers)) writers = Number(parsed.writers)
      path = asString(parsed.path)
    }
    let stored: StoredConversation | undefined
    try {
      stored = await this.conversations.get(conversationId)
    } catch {
      stored = undefined
    }
    const workspacePath = path || stored?.workspacePath || ''
    if (!asString(workspacePath)) {
      throw new Error('this task has no Git project to isolate')
    }
    const toolCallId = `milksu-worktree-${conversationId}`
    const started = Date.now()
    this.emitEngine({
      schemaVersion: 1,
      engine: kernel,
      sessionId: conversationId,
      type: 'tool.started',
      timestamp: new Date().toISOString(),
      toolName: 'milksu_worktree',
      toolCallId,
    })
    try {
      const descriptor = await prepareCodingCollaboration(
        this.home,
        conversationId,
        workspacePath,
        writers,
      )
      this.emitEngine({
        schemaVersion: 1,
        engine: kernel,
        sessionId: conversationId,
        type: 'tool.completed',
        timestamp: new Date().toISOString(),
        toolName: 'milksu_worktree',
        toolCallId,
        durationMs: Date.now() - started,
        done: true,
      })
      return JSON.stringify(descriptor)
    } catch (error) {
      this.emitEngine({
        schemaVersion: 1,
        engine: kernel,
        sessionId: conversationId,
        type: 'tool.completed',
        timestamp: new Date().toISOString(),
        toolName: 'milksu_worktree',
        toolCallId,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        done: true,
      })
      throw error
    }
  }

  private async dispatchEnvWorkspaceAction(conversationId: string, action: string): Promise<string> {
    const service = await envBrokerFor(this.home)
    const lab = this.settingsStore?.get().lab
    if (lab) {
      service.setAndroidTooling({
        sdkRoot: String(lab.android_sdk ?? '').trim(),
        javaHome: String(lab.java_home ?? '').trim(),
        autoCreateAVD: lab.auto_create_avd !== false,
      })
    }
    return handleEnvWorkspaceAction(
      {
        service,
        conversations: this.conversations,
        labJobs: this.labJobs,
      },
      conversationId,
      action,
    )
  }

  private async continueResearchSession(sessionId: string, prompt: string): Promise<void> {
    const id = asString(sessionId)
    const text = asString(prompt)
    if (!id) throw new Error('session id is required')
    if (!text) throw new Error('continuation message is required')
    if ([...text].length > 16000) throw new Error('continuation message exceeds 16000 characters')
    if (!this.sessions.has(id)) throw agentSessionMissingError(id, this.sessionKernel.get(id) ?? 'pi')
    if (this.kernelFor(id) !== KERNEL_PI) throw new Error('research continuations require a Pi session')
    const action = this.busySessions.has(id) ? 'followup_message' : 'relay_message'
    await this.writeControl(id, { action, conversationId: id, prompt: text })
    if (action === 'relay_message') this.busySessions.add(id)
  }

  private async recordResearchWorkerEvent(event: EngineEvent): Promise<void> {
    if (!this.research || !event.sessionId || !event.researchRunId) return
    const updates: WorkerUpdate[] = []
    if (Array.isArray(event.researchTasks)) {
      for (const item of event.researchTasks) {
        if (!item || typeof item !== 'object') continue
        const task = item as Record<string, unknown>
        updates.push({
          id: asString(task.id),
          prompt: asString(task.prompt),
          status: asString(task.status),
          workerId: asString(task.workerId),
          result: asString(task.result),
        })
      }
    }
    try {
      const { ready } = await this.research.recordWorkerUpdates(
        event.sessionId,
        event.researchRunId,
        updates,
      )
      if (!ready) return
      const claimed = await this.research.claimContinuation(event.sessionId, event.researchRunId)
      if (!claimed.claimed) return
      const settings = await readPublicSettings(this.home)
      await this.continueResearchSession(
        event.sessionId,
        researchContinuationPrompt(claimed.run, resolvedUserInterfaceLocale(settings)),
      )
    } catch {
      await this.research.markInterrupted(event.sessionId, event.researchRunId)
      this.trackResearchRun(event.sessionId, event.researchRunId, false)
    }
  }

  private async recordResearchCancelState(event: EngineEvent, unconfirmed: boolean): Promise<void> {
    if (!this.research || !event.sessionId || !event.researchRunId) return
    try {
      await this.research.setWorkerStopUnconfirmed(event.sessionId, event.researchRunId, unconfirmed)
    } catch {
      // cancel receipt is best-effort
    }
  }

  private async interruptResearchRunForSession(conversationId: string): Promise<void> {
    if (!this.research || !asString(conversationId)) return
    try {
      const runs = await this.research.list(conversationId)
      for (const run of runs) {
        if (run.status !== 'running') continue
        await this.research.markInterrupted(conversationId, run.id)
        this.trackResearchRun(conversationId, run.id, false)
      }
    } catch {
      // session loss still proceeds
    }
  }

  statusForSession(sessionId: string): RuntimeStatus {
    const id = asString(sessionId)
    const proc = this.processFor(id) ?? (id ? null : [...this.processes.values()][0] ?? null)
    const running = [...this.processes.values()].some((item) => item.child.exitCode === null)
    const status: RuntimeStatus = {
      defaultEngine: 'pi',
      running,
      sessionCount: this.sessions.size,
      protocol: 'jsonl-stdio/v1alpha1',
    }
    if (proc?.workspace) status.workspace = proc.workspace
    const tasks = id ? this.backgroundTasks.get(id) ?? [] : []
    if (tasks.length) status.backgroundTasks = tasks.map(cloneBackgroundTask)
    return status
  }

  async startBackgroundTask(
    conversationId: string,
    workspacePath: string,
    command: string,
    name: string,
    executionMode: string,
    approvalPolicy: string,
  ): Promise<RuntimeStatus> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    const terminal = asString(command)
    if (!terminal) throw new Error('terminal command is required')
    const policy = normalizeCodingPolicy(executionMode, approvalPolicy)
    if (policy.executionMode !== 'go' || policy.approvalPolicy === 'read-only') {
      throw new Error('terminal commands require Go mode with a writable permission policy')
    }
    await this.bindKernelProcess(sessionId, workspacePath)
    return this.sendBackgroundTaskControl(sessionId, 'start background task', {
      control: 'spawn',
      command: terminal,
      name: asString(name),
      executionMode: policy.executionMode,
      approvalPolicy: policy.approvalPolicy,
    })
  }

  async stopBackgroundTask(conversationId: string, taskId: string): Promise<RuntimeStatus> {
    const id = asString(taskId)
    if (!id) throw new Error('background task id is required')
    return this.sendBackgroundTaskControl(conversationId, 'stop background task', {
      control: 'stop',
      taskId: id,
    })
  }

  async refreshBackgroundTasks(
    conversationId: string,
    workspacePath: string,
    executionMode: string,
    approvalPolicy: string,
  ): Promise<RuntimeStatus> {
    const sessionId = asString(conversationId)
    if (!sessionId) throw new Error('session id is required')
    const policy = normalizeCodingPolicy(executionMode, approvalPolicy)
    const proc = await this.bindKernelProcess(sessionId, workspacePath)
    const status = await this.sendBackgroundTaskControl(sessionId, 'refresh background tasks', {
      control: 'list',
    })
    if (!hasRunningBackgroundTask(status.backgroundTasks ?? [])) return status
    try {
      const recovered = await this.recoverBackgroundTaskSession(sessionId, proc.workspace, policy)
      const recoveredStatus = await this.sendBackgroundTaskControl(
        sessionId,
        'refresh recovered background tasks',
        { control: 'list' },
      )
      recoveredStatus.backgroundRecovery = { state: recovered ? 'recovered' : 'attached' }
      return recoveredStatus
    } catch (error) {
      status.backgroundRecovery = {
        state: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      }
      return status
    }
  }

  private async bindKernelProcess(sessionId: string, workspacePath: string): Promise<SidecarProcess> {
    let stored: StoredConversation | undefined
    try {
      stored = await this.conversations.get(sessionId)
    } catch {
      stored = undefined
    }
    const kernel = this.kernelFor(sessionId, stored)
    const settings = this.settingsStore?.get() ?? await readPublicSettings(this.home)
    const agent = kernel === 'dsh' ? resolveAcpAgent(settings, stored?.acpAgentId) : null
    const agentId = agent?.id || ''
    const workspace = resolveAgentWorkspace(workspacePath || stored?.workspacePath || '', this.home)
    this.bindSessionWorkspace(sessionId, workspace, kernel, agentId)
    return this.ensureProcess(kernel, workspace, settings, generateTraceId(), agentId)
  }

  private async sendBackgroundTaskControl(
    sessionId: string,
    label: string,
    payload: Record<string, unknown>,
  ): Promise<RuntimeStatus> {
    const id = asString(sessionId)
    if (!id) throw new Error('session id is required')
    const requestId = `bg_control_${Date.now()}`
    this.controlWaiters.set(requestId, new ControlQueue())
    try {
      await this.writeControl(id, {
        action: 'background_task_control',
        conversationId: id,
        requestId,
        ...payload,
      })
    } catch (error) {
      this.controlWaiters.delete(requestId)
      throw new Error(`${label}: ${error instanceof Error ? error.message : error}`)
    }
    const event = await this.waitControl(requestId, BACKGROUND_CONTROL_TIMEOUT_MS, `${label} timed out`)
    if (asString(event.error)) throw new Error(`${label}: ${asString(event.error)}`)
    return this.statusForSession(id)
  }

  private async recoverBackgroundTaskSession(
    sessionId: string,
    workspace: string,
    policy: { executionMode: string; approvalPolicy: string },
  ): Promise<boolean> {
    const proc = this.processFor(sessionId)
    if (!proc || proc.workspace !== workspace) {
      throw new Error('Coding workspace changed while background tasks were recovering')
    }
    if (this.sessions.has(sessionId)) {
      const failure = this.recoveryFailures.get(sessionId)
      if (failure) throw new Error(failure)
      return false
    }
    this.recoveryFailures.delete(sessionId)
    const settings = this.settingsStore?.get() ?? await readPublicSettings(this.home)
    const queue = new ControlQueue()
    const waiters = this.recoveryWaiters.get(sessionId) ?? []
    waiters.push(queue)
    this.recoveryWaiters.set(sessionId, waiters)
    const command: Record<string, unknown> = {
      action: 'create_session',
      conversationId: sessionId,
      executionMode: policy.executionMode,
      approvalPolicy: policy.approvalPolicy,
      recoveryPurpose: 'background-tasks',
      provider: asString(settings.active_provider),
      model: asString(settings.active_model),
      modelSourceOrder: Array.isArray(settings.model_routing?.source_order)
        ? settings.model_routing!.source_order!.map(String)
        : [],
    }
    this.sessions.add(sessionId)
    try {
      await proc.write(command)
      const deadline = Date.now() + BACKGROUND_RECOVERY_TIMEOUT_MS
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          const failure = `recover background task session timed out after ${BACKGROUND_RECOVERY_TIMEOUT_MS / 1000}s`
          this.recoveryFailures.set(sessionId, failure)
          throw new Error(failure)
        }
        const event = await Promise.race([
          queue.take(),
          new Promise<EngineEvent>((_, reject) => {
            setTimeout(() => reject(new Error(
              `recover background task session timed out after ${BACKGROUND_RECOVERY_TIMEOUT_MS / 1000}s`,
            )), remaining)
          }),
        ])
        if (event.type === 'session.ready') return true
        if (
          event.type === 'engine.error'
          || event.type === 'session.destroyed'
          || event.type === 'engine.stopped'
          || event.type === 'engine.protocol_error'
        ) {
          throw new Error(`recover background task session: ${asString(event.error) || event.type}`)
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        this.recoveryFailures.set(sessionId, error.message)
      }
      throw error
    } finally {
      const remainingWaiters = (this.recoveryWaiters.get(sessionId) ?? []).filter((item) => item !== queue)
      if (remainingWaiters.length) this.recoveryWaiters.set(sessionId, remainingWaiters)
      else this.recoveryWaiters.delete(sessionId)
    }
  }

  private cacheBackgroundTasks(event: EngineEvent): void {
    if (event.type !== 'runtime.background_tasks' && event.type !== 'runtime.background_task_controlled') return
    const sessionId = asString(event.sessionId)
    if (!sessionId) return
    this.backgroundTasks.set(sessionId, cloneBackgroundTasks(event.backgroundTasks))
  }

  private notifyRecoveryWaiters(event: EngineEvent): void {
    const sessionId = asString(event.sessionId)
    if (!sessionId) return
    for (const queue of this.recoveryWaiters.get(sessionId) ?? []) queue.push(event)
  }

  private recordUsageEvent(event: EngineEvent): void {
    if (!this.usageStore) return
    const record = usageFromEngineEvent(event)
    if (!record) return
    try {
      this.usageStore.record(record)
    } catch {
      // malformed usage events stay out of the ledger
    }
  }

  async stopAll(): Promise<void> {
    const victims = [...this.processes.entries(), ...this.parked.entries()]
    for (const [key] of victims) this.retiring.add(key)
    this.processes.clear()
    this.parked.clear()
    this.parkedAt.clear()
    this.starting.clear()
    this.sessions.clear()
    this.busySessions.clear()
    this.sessionKernel.clear()
    this.sessionWorkspaces.clear()
    this.sessionAgentIds.clear()
    this.researchRuns.clear()
    this.backgroundTasks.clear()
    this.recoveryFailures.clear()
    this.recoveryWaiters.clear()
    this.silentSessions.clear()
    this.silentWaiters.clear()
    await Promise.all(victims.map(([, proc]) => proc.kill()))
    this.retiring.clear()
  }
}

function hasRunningBackgroundTask(tasks: BackgroundTask[]): boolean {
  return tasks.some((task) => task.status === 'running')
}

function cloneBackgroundTasks(value: unknown): BackgroundTask[] {
  if (!Array.isArray(value)) return []
  const tasks: BackgroundTask[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = asString(raw.id)
    if (!id) continue
    tasks.push(cloneBackgroundTask({
      id,
      name: asString(raw.name) || undefined,
      kind: asString(raw.kind),
      status: asString(raw.status),
      startedAt: Number(raw.startedAt ?? 0) || 0,
      endedAt: Number(raw.endedAt ?? 0) || undefined,
      command: asString(raw.command) || undefined,
      cwd: asString(raw.cwd) || undefined,
      pid: Number(raw.pid ?? 0) || undefined,
      pgid: Number(raw.pgid ?? 0) || undefined,
      ports: Array.isArray(raw.ports)
        ? raw.ports.map((port) => Number(port)).filter((port) => Number.isInteger(port) && port > 0)
        : undefined,
      logPath: asString(raw.logPath) || undefined,
      logTail: asString(raw.logTail) || undefined,
      logTruncated: Boolean(raw.logTruncated) || undefined,
      lastExitCode: raw.lastExitCode === undefined || raw.lastExitCode === null
        ? undefined
        : Number(raw.lastExitCode),
      error: asString(raw.error) || undefined,
    }))
  }
  return tasks
}

function cloneBackgroundTask(task: BackgroundTask): BackgroundTask {
  return {
    ...task,
    ports: task.ports ? [...task.ports] : undefined,
  }
}

export function applySaveConversationRules(
  existing: StoredConversation | null,
  value: StoredConversation,
): StoredConversation {
  value.kernel = normalizeKernel(value.kernel)
  if (existing && hasStarted(existing)) {
    value.kernel = normalizeKernel(existing.kernel)
    value.acpAgentId = existing.acpAgentId
  }
  if (existing) preserveSentAttachments(existing, value)
  return value
}
