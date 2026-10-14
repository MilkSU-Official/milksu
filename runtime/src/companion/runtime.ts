import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { AppSettings } from '../config/settings-store.ts'
import { defaultSettings } from '../config/settings-store.ts'
import { resolvedUserInterfaceLocale } from '../settings.ts'
import { generateTraceId } from '../trace.ts'
import { handleApp, runAfter } from './app-control.ts'
import {
  companionDispatchEnabled,
  companionMemoryEnabled,
  companionMemoryExtract,
  companionMemoryExtractIdleMinutes,
  companionReplyStyle,
  companionTaskEventsEnabled,
  companionTurnAuth,
  resolveCompanionTurn,
} from './auth.ts'
import { Board } from './board.ts'
import { Dispatcher } from './dispatch.ts'
import {
  hostNoticePrompt,
  mergeHostNotice,
  shouldSpeak,
} from './gate.ts'
import {
  archiveCompanionFile,
  deleteCompanionArchive,
  findCompanionSessionFile,
  listCompanionArchives,
  localizeCompanionTranscriptAbort,
  readTranscriptPage,
  type CompanionArchive,
  type TranscriptCursor,
  type TranscriptPage,
} from './jsonl.ts'
import { Memory } from './memory.ts'
import {
  sidecarWriteLost,
  startCompanionSidecar,
  type CompanionSidecarProcess,
} from './sidecar.ts'
import {
  CREDENTIAL_WITHDRAWN_ERROR,
  SESSION_ID,
  type AppControl,
  type ApprovedMemory,
  type BoardSnapshot,
  type Catalog,
  type CompanionAttachment,
  type CompanionEvent,
  type DispatchResult,
  type MemorySnapshot,
  type PendingConfirm,
  type SessionControl,
  type SessionSearcher,
  type SpeakManyResult,
  type Speaker,
  type Status,
} from './types.ts'
import { asObject, boolValue, intValue, stringValue, trimString } from './util.ts'

type ParkedConfirm = {
  requestId: string
  input: Record<string, unknown>
  title: string
}

type WatchedSession = {
  title: string
  task: string
  live: boolean
  progressAt?: number
  stallSpoken?: boolean
}

type PersistedState = {
  todos?: unknown[]
  pending?: unknown[]
  approved?: unknown[]
  forgotten?: string[]
  deliveries?: Record<string, DispatchResult>
  watches?: Record<string, WatchedSession>
}

type MemoryViewListener = (
  revision: number,
  memories: Array<Record<string, string>>,
) => void

export type CompanionStart = (input: {
  settings: AppSettings
  agentDir: string
  onLine: (value: unknown) => void
}) => Promise<CompanionSidecarProcess> | CompanionSidecarProcess

export type CompanionRuntimeOptions = {
  home: string
  agentDir: string
  statePath: string
  helperPath?: string
  settings?: () => AppSettings
  sidecarEnv?: () => string[]
  catalog?: Catalog
  speaker?: Speaker
  control?: SessionControl
  searcher?: SessionSearcher
  app?: AppControl
  emit?: (event: CompanionEvent) => void
  start?: CompanionStart
}

const STALL_QUIET_MS = 45_000
const READY_WAIT_MS = 20_000

function pendingConfirmFromParked(pending: ParkedConfirm): PendingConfirm {
  const input = pending.input
  let hostId = trimString(input.hostRequestId) || pending.requestId.trim()
  let action = trimString(input.action) || 'stop'
  return {
    action,
    conversationId: trimString(input.conversationId),
    text: trimString(input.text),
    idempotencyKey: trimString(input.idempotencyKey),
    mode: trimString(input.mode),
    hostRequestId: hostId,
    targetTitle: pending.title,
  }
}

function mapCompanionEvent(raw: Record<string, unknown>): CompanionEvent {
  const event: CompanionEvent = {
    engine: SESSION_ID,
    sessionId: SESSION_ID,
    type: '',
    text: stringValue(raw.delta),
    error: stringValue(raw.error),
    reason: stringValue(raw.reason),
    toolName: stringValue(raw.toolName),
    toolCallId: stringValue(raw.toolCallId),
    durationMs: intValue(raw.durationMs),
  }
  const content = trimString(raw.content)
  if (content && !event.text) event.text = content
  switch (trimString(raw.type)) {
    case 'hello':
      event.type = 'companion.hello'
      break
    case 'ready':
      event.type = 'session.ready'
      event.resumed = boolValue(raw.resumed)
      break
    case 'text_delta':
      event.type = 'assistant.delta'
      break
    case 'thinking_start':
      event.type = 'assistant.thinking_started'
      break
    case 'thinking_delta':
      event.type = 'assistant.thinking_delta'
      break
    case 'thinking_done':
      event.type = 'assistant.thinking_completed'
      if (content) event.text = content
      break
    case 'tool_call_start':
      event.type = 'tool.started'
      break
    case 'tool_call_progress':
      event.type = 'tool.progress'
      event.text = ''
      break
    case 'tool_call_end':
      event.type = 'tool.completed'
      event.done = true
      if (content) event.text = content
      if (boolValue(raw.isError)) event.error = content
      break
    case 'user_message':
      event.type = 'user.message'
      if (trimString(raw.text)) event.text = trimString(raw.text)
      break
    case 'decision.recorded':
      event.type = 'decision.recorded'
      event.text = trimString(raw.text)
      event.bucket = trimString(raw.bucket)
      event.source = trimString(raw.source)
      event.done = true
      break
    case 'memory.recorded':
      event.type = 'memory.recorded'
      event.text = trimString(raw.text)
      event.done = true
      break
    case 'turn_settled':
      event.type = 'assistant.settled'
      event.done = true
      event.aborted = boolValue(raw.aborted)
      break
    case 'model_selected':
      event.type = 'session.model_selected'
      break
    case 'error':
      event.type = 'engine.error'
      break
    default:
      event.type = `companion.${trimString(raw.type)}`
  }
  return event
}

export class CompanionRuntime {
  private readonly home: string
  private readonly agentDir: string
  private readonly statePath: string
  private readonly helperPath: string
  private readonly settingsFn?: () => AppSettings
  private readonly sidecarEnvFn?: () => string[]
  private readonly catalog?: Catalog
  private readonly app?: AppControl
  private readonly emitFn?: (event: CompanionEvent) => void
  private readonly startFn?: CompanionStart
  private readonly board = new Board()
  private readonly memory: Memory
  private readonly dispatcher: Dispatcher

  private sidecar: CompanionSidecarProcess | null = null
  private ready = false
  private lastErr = ''
  private sidecarGen = 0
  private stale = false
  private inFlight = false
  private pendingConfirms = new Map<string, ParkedConfirm>()
  private watches = new Map<string, WatchedSession>()
  private stallTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingNotice = ''
  private writeChain: Promise<void> = Promise.resolve()
  private persistLock: Promise<void> = Promise.resolve()
  private memoryViewListener?: MemoryViewListener

  constructor(options: CompanionRuntimeOptions) {
    this.home = options.home
    this.agentDir = options.agentDir
    this.statePath = options.statePath
    this.helperPath = options.helperPath ?? ''
    this.settingsFn = options.settings
    this.sidecarEnvFn = options.sidecarEnv
    this.catalog = options.catalog
    this.app = options.app
    this.emitFn = options.emit
    this.startFn = options.start
    this.memory = new Memory(options.searcher, options.catalog)
    this.dispatcher = new Dispatcher(
      options.catalog,
      options.speaker,
      this.board,
      () => companionDispatchEnabled(this.resolvedSettings()),
    )
    this.dispatcher.setControl(options.control)
    this.loadState()
  }

  setControl(control: SessionControl | undefined): void {
    this.dispatcher.setControl(control)
  }

  async ensure(): Promise<Status> {
    await this.refreshBoard()
    await this.restartIfStaleIdle()
    if (this.ready && this.sidecar) return this.status()
    await this.startLocked()
    return this.status()
  }

  async send(prompt: string, attachments: CompanionAttachment[] = []): Promise<void> {
    const text = prompt.trim()
    if (!text && !attachments.length) throw new Error('companion prompt is required')
    const settings = this.resolvedSettings()
    const custom = companionTurnAuth(settings)
    await this.ensure()
    await this.refreshBoard()
    const selection = resolveCompanionTurn(settings)
    const { revision, memories } = this.memoryView()
    const command: Record<string, unknown> = {
      action: 'send_message',
      traceId: generateTraceId(),
      prompt: text,
      locale: resolvedUserInterfaceLocale(settings),
      provider: selection.provider,
      model: selection.model,
      source: selection.source,
      boardSnapshot: this.board.snapshot(),
      semanticMemories: memories,
      memoryRevision: revision,
      episodicRecalls: [],
      memorySearchEnabled: companionMemoryEnabled(settings),
      memoryExtract: companionMemoryExtract(settings),
      memoryExtractIdleMinutes: companionMemoryExtractIdleMinutes(settings),
      replyStyle: companionReplyStyle(settings),
    }
    this.markSpeaking()
    if (attachments.length) command.attachments = attachments
    if (custom) command.customProvider = custom
    try {
      await this.writeEnsured(command)
    } catch (error) {
      this.inFlight = false
      await this.flushNotice()
      throw error
    }
  }

  async stop(): Promise<void> {
    const pending = this.takeAllParked()
    await this.stopLocked()
    this.inFlight = false
    this.stale = false
    await this.finishParked(pending, 'companion sidecar stopped')
  }

  async abortTurn(): Promise<void> {
    const pending = this.takeAllParked()
    try {
      await this.write({ action: 'abort' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('sidecar is not running')) {
        await this.finishParked(pending, 'turn aborted')
        return
      }
      await this.finishParked(pending, 'turn aborted')
      throw error
    }
    await this.finishParked(pending, 'turn aborted')
  }

  markStale(): void {
    this.stale = true
  }

  stopHoldingWithdrawnCredential(): boolean {
    const pending = this.takeAllParked()
    const alive = this.ready || this.sidecar !== null || this.inFlight || pending.size > 0
    this.lastErr = CREDENTIAL_WITHDRAWN_ERROR
    if (alive) void this.stopLocked()
    this.ready = false
    this.stale = false
    this.inFlight = false
    if (pending.size) void this.finishParked(pending, CREDENTIAL_WITHDRAWN_ERROR)
    if (alive) {
      this.emitEvent({ type: 'engine.error', error: CREDENTIAL_WITHDRAWN_ERROR })
    }
    return alive
  }

  status(): Status {
    const selection = resolveCompanionTurn(this.resolvedSettings())
    const status: Status = {
      ready: this.ready,
      provider: selection.provider,
      model: selection.model,
    }
    if (this.lastErr) status.error = this.lastErr
    for (const pending of this.pendingConfirms.values()) {
      status.pendingConfirm = pendingConfirmFromParked(pending)
      break
    }
    return status
  }

  async boardSnapshot(): Promise<BoardSnapshot> {
    await this.refreshBoard()
    return this.board.snapshot()
  }

  observeEngineEvent(event: CompanionEvent): void {
    const sessionId = trimString(event.sessionId)
    if (!sessionId || sessionId === SESSION_ID) return
    switch (event.type) {
      case 'assistant.delta':
      case 'tool.started':
      case 'tool.progress':
        this.board.setSessionStatus(sessionId, 'running', '')
        break
      case 'approval.requested':
        this.board.setSessionStatus(sessionId, 'needs_approval', '')
        break
      case 'assistant.settled':
      case 'assistant.completed':
        this.board.setSessionStatus(sessionId, 'idle', '')
        break
      case 'engine.error':
        this.board.setSessionStatus(sessionId, 'error', event.error ?? '')
        break
      case 'engine.stopped':
      case 'session.destroyed':
        this.board.setSessionStatus(sessionId, 'idle', '')
        break
      default:
        break
    }
    this.noteWatchedEvent(event)
  }

  async transcript(
    limit: number,
    cursor: TranscriptCursor | null | undefined,
    before: boolean,
  ): Promise<TranscriptPage> {
    const path = await findCompanionSessionFile(this.agentDir)
    const page = await readTranscriptPage(path, limit, cursor, before)
    if (page.file) page.file = basename(page.file)
    localizeCompanionTranscriptAbort(page, resolvedUserInterfaceLocale(this.resolvedSettings()))
    return page
  }

  async archiveTranscript(): Promise<CompanionArchive> {
    const path = await findCompanionSessionFile(this.agentDir)
    if (!path.trim()) throw new Error('no companion transcript to archive')
    const archived = await archiveCompanionFile(this.agentDir, path)
    this.inFlight = false
    try {
      await this.resetCompanionSession()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('sidecar is not running')) await this.ensure()
    }
    return archived
  }

  archives(): Promise<CompanionArchive[]> {
    return listCompanionArchives(this.agentDir)
  }

  deleteArchive(name: string): Promise<void> {
    return deleteCompanionArchive(this.agentDir, name)
  }

  memorySnapshot(): MemorySnapshot {
    return this.memory.snapshot()
  }

  async approveMemory(id: string): Promise<ApprovedMemory> {
    const approved = this.memory.approve(id)
    await this.persistState()
    return approved
  }

  async forgetMemory(id: string): Promise<void> {
    this.memory.forget(id)
    await this.persistState()
    this.emitEvent({ type: 'companion.memory' })
    await this.syncLiveContext()
  }

  async confirmDispatch(
    action: string,
    conversationId: string,
    text: string,
    idempotencyKey: string,
    mode: string,
    hostRequestId: string,
    accepted: boolean,
  ): Promise<DispatchResult> {
    const pending = this.takeParked(hostRequestId)
    if (!accepted) {
      const result: DispatchResult = {
        accepted: false,
        delivered: false,
        targetTitle: pending.title,
        error: 'user declined',
      }
      if (pending.requestId) await this.respondHost(pending.requestId, result, null)
      return result
    }
    await this.refreshBoard()
    let resolvedAction = action.trim()
    if (pending.input) {
      const parkedAction = trimString(pending.input.action)
      if (parkedAction) resolvedAction = parkedAction
      pending.input.confirmed = true
    }
    switch (resolvedAction) {
      case 'speak_many': {
        if (!pending.input) throw new Error('companion confirm is missing the parked request')
        const raw = await this.dispatcher.handle(pending.input)
        await this.persistState()
        if (pending.requestId) await this.respondHost(pending.requestId, raw, null)
        this.noteDispatch('speak_many', pending.input, raw)
        const batch = raw as SpeakManyResult
        if (batch.error) {
          return { accepted: Boolean(batch.accepted), error: batch.error, delivered: false, targetTitle: pending.title }
        }
        return { accepted: true, delivered: true, targetTitle: pending.title }
      }
      case 'quit':
      case 'relaunch':
      case 'patch_settings': {
        if (!pending.input) throw new Error('companion confirm is missing the parked request')
        const outcome = await handleApp(this.app, pending.input, () => this.resolvedSettings())
        if (pending.requestId) await this.respondHost(pending.requestId, outcome, null)
        await runAfter(this.app, outcome)
        if (outcome.error) {
          return { accepted: false, delivered: false, error: outcome.error, targetTitle: pending.title }
        }
        return { accepted: outcome.ok, delivered: outcome.ok, targetTitle: pending.title }
      }
      case 'stop': {
        const result = await this.dispatcher.stop({
          conversationId,
          idempotencyKey,
          confirmed: true,
        })
        await this.finishConfirm(pending, resolvedAction, conversationId, result)
        return result
      }
      case 'speak':
      case 'steer': {
        const result = await this.dispatcher.speak({
          conversationId,
          text,
          idempotencyKey,
          mode: mode || 'steer',
          confirmed: true,
        })
        await this.finishConfirm(pending, resolvedAction, conversationId, result)
        return result
      }
      default:
        throw new Error(`unknown companion confirm action ${JSON.stringify(action)}`)
    }
  }

  publishedMemory(): { revision: number; memories: Array<Record<string, string>> } {
    return this.memoryView()
  }

  setMemoryViewListener(listener: MemoryViewListener): void {
    this.memoryViewListener = listener
  }

  async noteExternalTurn(phase: string, userText: string, assistantText: string, aborted: boolean): Promise<void> {
    const kind = phase.trim()
    if (kind === 'begin') {
      if (!this.sidecarAlive()) return
      try { await this.write({ action: 'note_turn', phase: 'begin' }) } catch { /* ignore */ }
      return
    }
    if (kind !== 'finish') return
    if (this.sidecarAlive() && companionMemoryEnabled(this.resolvedSettings())) {
      try { await this.write({ action: 'refresh_index' }) } catch { /* ignore */ }
    }
    if (companionMemoryExtract(this.resolvedSettings()) === 'off') return
    try { await this.ensure() } catch { return }
    try {
      await this.write({
        action: 'note_turn',
        phase: 'finish',
        userText,
        assistantText,
        aborted,
      })
    } catch {
      // extract failure stays off the chat
    }
  }

  async syncLiveContext(): Promise<void> {
    const settings = this.resolvedSettings()
    const { revision, memories } = this.memoryView()
    try {
      await this.write({
        action: 'update_context',
        semanticMemories: memories,
        memoryRevision: revision,
        memoryExtract: companionMemoryExtract(settings),
        memoryExtractIdleMinutes: companionMemoryExtractIdleMinutes(settings),
        memorySearchEnabled: companionMemoryEnabled(settings),
        locale: resolvedUserInterfaceLocale(settings),
        replyStyle: companionReplyStyle(settings),
      })
    } catch {
      // sidecar may be down
    }
    this.memoryViewListener?.(revision, memories)
  }

  private async finishConfirm(
    pending: ParkedConfirm,
    action: string,
    conversationId: string,
    result: DispatchResult,
  ): Promise<void> {
    const input = pending.input ?? {}
    input.action = action
    if (!trimString(input.conversationId)) input.conversationId = conversationId
    this.noteDispatch(action, input, result)
    await this.persistState()
    if (pending.requestId) await this.respondHost(pending.requestId, result, null)
  }

  private async startLocked(): Promise<void> {
    if (this.ready && this.sidecar) return
    if (this.sidecar) await this.stopLocked()
    mkdirSync(this.agentDir, { recursive: true, mode: 0o700 })
    const settings = this.resolvedSettings()
    let custom: Record<string, unknown> | null
    try {
      custom = companionTurnAuth(settings)
    } catch (error) {
      this.lastErr = error instanceof Error ? error.message : String(error)
      throw error
    }
    const gen = ++this.sidecarGen
    try {
      if (this.startFn) {
        this.sidecar = await this.startFn({
          settings,
          agentDir: this.agentDir,
          onLine: (value) => this.handleLine(value, gen),
        })
      } else {
        this.sidecar = startCompanionSidecar({
          home: this.home,
          agentDir: this.agentDir,
          helperPath: this.helperPath,
          settings,
          helperEnv: this.sidecarEnvFn?.(),
          onLine: (value) => this.handleLine(value, gen),
        })
      }
    } catch (error) {
      this.lastErr = error instanceof Error ? error.message : String(error)
      throw error
    }
    this.sidecar.child.once('exit', (code, signal) => {
      if (this.sidecarGen !== gen) return
      this.ready = false
      if (!this.lastErr) {
        const detail = this.sidecar?.stderrText().trim().replace(/\s+/g, ' ').slice(0, 240)
        const why = code != null ? `exit ${code}` : signal ? `signal ${signal}` : 'exit'
        this.lastErr = detail ? `companion sidecar stopped (${why}): ${detail}` : `companion sidecar stopped (${why})`
      }
      this.sidecar = null
      this.inFlight = false
      const pending = this.takeAllParked()
      void this.finishParked(pending, 'companion sidecar stopped')
    })
    this.ready = false
    this.lastErr = ''
    const selection = resolveCompanionTurn(settings)
    const create: Record<string, unknown> = {
      action: 'create_session',
      locale: resolvedUserInterfaceLocale(settings),
      provider: selection.provider,
      model: selection.model,
      source: selection.source,
      memorySearchEnabled: companionMemoryEnabled(settings),
      memoryExtract: companionMemoryExtract(settings),
      memoryExtractIdleMinutes: companionMemoryExtractIdleMinutes(settings),
      replyStyle: companionReplyStyle(settings),
    }
    if (custom) create.customProvider = custom
    try {
      await this.write(create)
    } catch (error) {
      this.lastErr = error instanceof Error ? error.message : String(error)
      const pending = this.takeAllParked()
      await this.stopLocked()
      await this.finishParked(pending, this.lastErr)
      throw error
    }
    const deadline = Date.now() + READY_WAIT_MS
    while (Date.now() < deadline) {
      if (this.lastErr && !this.ready) throw new Error(this.lastErr)
      if (this.ready) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('companion sidecar did not become ready')
  }

  private async stopLocked(): Promise<void> {
    const sidecar = this.sidecar
    this.sidecar = null
    this.ready = false
    if (!sidecar) return
    await sidecar.kill()
  }

  private async write(value: Record<string, unknown>): Promise<void> {
    const sidecar = this.sidecar
    if (!sidecar) throw new Error('companion sidecar is not running')
    try {
      const job = this.writeChain.then(() => sidecar.write(value))
      this.writeChain = job.catch(() => {})
      await job
    } catch (error) {
      if (sidecarWriteLost(error)) {
        if (this.sidecar === sidecar) {
          this.sidecar = null
          this.ready = false
        }
        throw new Error('companion sidecar is not running')
      }
      throw error
    }
  }

  private async writeEnsured(value: Record<string, unknown>): Promise<void> {
    try {
      await this.write(value)
    } catch (error) {
      if (!sidecarWriteLost(error) && !(error instanceof Error && error.message.includes('sidecar is not running'))) {
        throw error
      }
      await this.ensure()
      await this.write(value)
    }
  }

  private handleLine(value: unknown, gen: number): void {
    const raw = asObject(value)
    const eventType = trimString(raw.type)
    if (eventType === 'companion_host') {
      void this.answerHost(raw)
      return
    }
    if (eventType === 'ready' && this.sidecarGen === gen) {
      this.ready = true
      this.lastErr = ''
    }
    if (eventType === 'error' && this.sidecarGen === gen) {
      this.lastErr = trimString(raw.error)
    }
    this.emitEvent(mapCompanionEvent(raw))
  }

  private async answerHost(raw: Record<string, unknown>): Promise<void> {
    const requestId = trimString(raw.requestId)
    const action = trimString(raw.action)
    const input = asObject(raw.input)
    if (action === 'dispatch') {
      const parked = await this.dispatchHost(requestId, input)
      if (parked) return
      return
    }
    if (action === 'app') {
      const parked = await this.appHost(requestId, input)
      if (parked) return
      return
    }
    try {
      const result = await this.handleHost(action, input)
      await this.respondHost(requestId, result, null)
    } catch (error) {
      await this.respondHost(requestId, null, error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async respondHost(requestId: string, result: unknown, error: Error | null): Promise<void> {
    if (!requestId.trim()) return
    const response: Record<string, unknown> = {
      action: 'companion_host_response',
      requestId,
      ok: !error,
    }
    if (error) response.error = error.message
    else response.result = result
    try {
      await this.write(response)
    } catch (writeError) {
      this.emitEvent({
        type: 'engine.error',
        error: writeError instanceof Error ? writeError.message : String(writeError),
      })
    }
  }

  private async dispatchHost(requestId: string, input: Record<string, unknown>): Promise<boolean> {
    const result = await this.dispatcher.handle(input)
    this.noteDispatch(stringValue(input.action), input, result)
    await this.persistState()
    const dispatch = result as DispatchResult
    if (!dispatch?.needsConfirmation) {
      await this.respondHost(requestId, result, null)
      return false
    }
    this.parkConfirm(requestId, input, dispatch.targetTitle ?? '')
    const payload = { ...input, hostRequestId: requestId }
    this.emitEvent({
      type: 'companion.confirm',
      requestId,
      input: JSON.stringify(payload),
      notice: dispatch.targetTitle,
    })
    return true
  }

  private async appHost(requestId: string, input: Record<string, unknown>): Promise<boolean> {
    const outcome = await handleApp(this.app, input, () => this.resolvedSettings())
    if (!outcome.needsConfirmation) {
      await this.respondHost(requestId, outcome, null)
      await runAfter(this.app, outcome)
      return false
    }
    if (!trimString(input.text)) input.text = outcome.summary ?? ''
    this.parkConfirm(requestId, input, outcome.summary ?? '')
    const payload = { ...input, hostRequestId: requestId }
    this.emitEvent({
      type: 'companion.confirm',
      requestId,
      input: JSON.stringify(payload),
      notice: outcome.summary,
    })
    return true
  }

  private parkConfirm(requestId: string, input: Record<string, unknown>, title: string): void {
    this.pendingConfirms.set(requestId, { requestId, input, title })
  }

  private takeParked(hostRequestId: string): ParkedConfirm {
    const id = hostRequestId.trim()
    if (id && this.pendingConfirms.has(id)) {
      const pending = this.pendingConfirms.get(id)!
      this.pendingConfirms.delete(id)
      return pending
    }
    if (this.pendingConfirms.size === 1) {
      const [key, pending] = [...this.pendingConfirms.entries()][0]!
      this.pendingConfirms.delete(key)
      return pending
    }
    return { requestId: '', input: {}, title: '' }
  }

  private takeAllParked(): Map<string, ParkedConfirm> {
    const pending = this.pendingConfirms
    this.pendingConfirms = new Map()
    return pending
  }

  private async finishParked(pending: Map<string, ParkedConfirm>, reason: string): Promise<void> {
    for (const item of pending.values()) {
      await this.respondHost(item.requestId, {
        accepted: false,
        delivered: false,
        targetTitle: item.title,
        error: reason,
      }, null)
    }
  }

  private async handleHost(action: string, input: Record<string, unknown>): Promise<unknown> {
    await this.refreshBoard()
    switch (action) {
      case 'board':
        return this.board.handle(input)
      case 'dispatch':
        await this.dispatchHost('', input)
        return null
      case 'memory': {
        if (trimString(input.action) === 'search' && !companionMemoryEnabled(this.resolvedSettings())) {
          return { written: false, results: [] }
        }
        const result = await this.memory.handle(input)
        await this.persistState()
        const memoryAction = trimString(input.action)
        if (memoryAction === 'commit') {
          const payload = asObject(result)
          if (intValue(payload.count) > 0) {
            this.emitEvent({ type: 'companion.memory' })
            await this.syncLiveContext()
          }
        } else if (memoryAction === 'forget') {
          this.emitEvent({ type: 'companion.memory' })
          await this.syncLiveContext()
        }
        return result
      }
      case 'app':
        await this.appHost('', input)
        return null
      default:
        throw new Error(`unknown companion host action ${JSON.stringify(action)}`)
    }
  }

  private async refreshBoard(): Promise<void> {
    if (!this.catalog) return
    try {
      this.board.replaceSessions(await this.catalog.listActive())
    } catch {
      // board stays as last known
    }
  }

  private memoryView(): { revision: number; memories: Array<Record<string, string>> } {
    const { revision, approved } = this.memory.snapshotApproved()
    return {
      revision,
      memories: approved.map((memory) => ({
        id: memory.id,
        title: memory.title,
        markdown: memory.markdown,
      })),
    }
  }

  private sidecarAlive(): boolean {
    return this.ready && this.sidecar !== null
  }

  private async resetCompanionSession(): Promise<void> {
    if (!this.ready || !this.sidecar) {
      await this.ensure()
      return
    }
    const settings = this.resolvedSettings()
    const selection = resolveCompanionTurn(settings)
    let custom: Record<string, unknown> | null = null
    try { custom = companionTurnAuth(settings) } catch { /* reset still proceeds */ }
    const create: Record<string, unknown> = {
      action: 'create_session',
      locale: resolvedUserInterfaceLocale(settings),
      provider: selection.provider,
      model: selection.model,
      source: selection.source,
      memorySearchEnabled: companionMemoryEnabled(settings),
      memoryExtract: companionMemoryExtract(settings),
      memoryExtractIdleMinutes: companionMemoryExtractIdleMinutes(settings),
      replyStyle: companionReplyStyle(settings),
      reset: true,
    }
    if (custom) create.customProvider = custom
    await this.writeEnsured(create)
  }

  private async restartIfStaleIdle(): Promise<void> {
    if (!this.stale || this.inFlight) return
    const pending = this.takeAllParked()
    await this.stopLocked()
    this.stale = false
    this.inFlight = false
    await this.finishParked(pending, 'companion sidecar replaced')
  }

  private markSpeaking(): void {
    this.inFlight = true
  }

  private async flushNotice(): Promise<void> {
    const prompt = this.pendingNotice
    this.pendingNotice = ''
    if (!prompt.trim() || this.inFlight) {
      if (prompt.trim()) this.pendingNotice = mergeHostNotice(this.pendingNotice, prompt)
      return
    }
    this.inFlight = true
    await this.writeNotice(prompt)
  }

  private async writeNotice(prompt: string): Promise<void> {
    try {
      await this.write({ action: 'host_notice', prompt })
    } catch {
      this.pendingNotice = mergeHostNotice(prompt, this.pendingNotice)
      this.inFlight = false
    }
  }

  private queueNotice(prompt: string): void {
    const text = prompt.trim()
    if (!text) return
    this.pendingNotice = mergeHostNotice(this.pendingNotice, text)
    if (this.inFlight) return
    const merged = this.pendingNotice
    this.pendingNotice = ''
    this.inFlight = true
    void this.writeNotice(merged)
  }

  private noteDispatch(action: string, input: Record<string, unknown>, result: unknown): void {
    let task = trimString(input.text)
    if (!task) task = trimString(input.firstMessage)
    if (action === 'stop') {
      const dispatch = result as DispatchResult
      if (dispatch?.accepted && dispatch.delivered) {
        this.dropWatch(dispatch.conversationId || trimString(input.conversationId))
      }
      return
    }
    if (action === 'speak' || action === 'create_conversation') {
      const dispatch = result as DispatchResult
      if (dispatch?.accepted && dispatch.delivered) {
        this.armWatch(dispatch.conversationId ?? '', dispatch.targetTitle ?? '', task)
      }
      return
    }
    if (action === 'speak_many') {
      const batch = result as SpeakManyResult
      for (const item of batch.results ?? []) {
        if (item.accepted && item.delivered) this.armWatch(item.conversationId ?? '', item.targetTitle ?? '', task)
      }
    }
  }

  private armWatch(id: string, title: string, task: string): void {
    const key = id.trim()
    if (!key) return
    this.watches.set(key, { title: title.trim(), task: task.trim(), live: false })
    void this.persistState()
  }

  private dropWatch(id: string): void {
    const key = id.trim()
    if (!key) return
    this.watches.delete(key)
    this.stopStallTimer(key)
    void this.persistState()
  }

  private noteWatchedEvent(event: CompanionEvent): void {
    const id = trimString(event.sessionId)
    const item = this.watches.get(id)
    if (!item) return
    let kind = ''
    switch (event.type) {
      case 'assistant.delta':
      case 'tool.started':
      case 'tool.progress':
        item.live = true
        item.progressAt = Date.now()
        item.stallSpoken = false
        this.watches.set(id, item)
        this.armStallTimer(id)
        return
      case 'approval.requested':
        item.live = true
        kind = 'needs_approval'
        break
      case 'assistant.settled':
      case 'assistant.completed':
        if (!item.live) return
        kind = 'settled'
        break
      case 'engine.error':
        kind = 'error'
        break
      case 'session.destroyed':
        this.dropWatch(id)
        return
      default:
        return
    }
    item.live = true
    this.watches.set(id, item)
    if (kind === 'settled' || kind === 'error') {
      this.watches.delete(id)
      this.stopStallTimer(id)
      void this.persistState()
    }
    if (!companionTaskEventsEnabled(this.resolvedSettings())) return
    void this.maybeSpeak(item.title, kind, item.task)
  }

  private armStallTimer(id: string): void {
    this.stopStallTimer(id)
    this.stallTimers.set(id, setTimeout(() => {
      this.fireStall(id)
    }, STALL_QUIET_MS))
  }

  private stopStallTimer(id: string): void {
    const timer = this.stallTimers.get(id)
    if (timer) clearTimeout(timer)
    this.stallTimers.delete(id)
  }

  private fireStall(id: string): void {
    const item = this.watches.get(id)
    if (!item || !item.live || item.stallSpoken || Date.now() - (item.progressAt ?? 0) < STALL_QUIET_MS) return
    item.stallSpoken = true
    this.watches.set(id, item)
    this.stallTimers.delete(id)
    if (!companionTaskEventsEnabled(this.resolvedSettings())) return
    void this.maybeSpeak(item.title, 'stall', item.task)
  }

  private async maybeSpeak(title: string, kind: string, task: string): Promise<void> {
    if (!await shouldSpeak(null, title, kind, task)) return
    const locale = resolvedUserInterfaceLocale(this.resolvedSettings())
    this.queueNotice(hostNoticePrompt(title, kind, locale))
  }

  private emitEvent(event: CompanionEvent): void {
    if (event.type === 'assistant.settled') {
      this.inFlight = false
      void this.flushNotice()
    }
    if (!this.emitFn) return
    event.engine = SESSION_ID
    if (!event.sessionId) event.sessionId = SESSION_ID
    if (!event.schemaVersion) event.schemaVersion = 1
    if (!event.timestamp) event.timestamp = new Date().toISOString()
    this.emitFn(event)
  }

  private resolvedSettings(): AppSettings {
    return this.settingsFn?.() ?? defaultSettings()
  }

  private loadState(): void {
    if (!this.statePath.trim()) return
    try {
      const state = JSON.parse(readFileSync(this.statePath, 'utf8')) as PersistedState
      this.board.replaceTodos((state.todos ?? []) as never)
      this.memory.replace(
        (state.pending ?? []) as never,
        (state.approved ?? []) as never,
        state.forgotten ?? [],
      )
      this.dispatcher.replaceDeliveries(state.deliveries ?? {})
      this.watches = new Map()
      for (const [id, item] of Object.entries(state.watches ?? {})) {
        if (id.trim()) this.watches.set(id, item)
      }
    } catch {
      // missing or invalid state is a fresh companion
    }
  }

  private persistState(): Promise<void> {
    const job = this.persistLock.then(() => {
      if (!this.statePath.trim()) return
      mkdirSync(dirname(this.statePath), { recursive: true, mode: 0o700 })
      const snapshot = this.memory.persist()
      const state: PersistedState = {
        todos: this.board.snapshot().todos,
        pending: snapshot.pending,
        approved: snapshot.approved,
        forgotten: snapshot.forgotten,
        deliveries: this.dispatcher.snapshotDeliveries(),
        watches: Object.fromEntries(this.watches),
      }
      writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    }).catch(() => {})
    this.persistLock = job
    return job
  }
}
