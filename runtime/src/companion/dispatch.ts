import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import type { Board } from './board.ts'
import type {
  Catalog,
  ConversationRef,
  DispatchResult,
  SessionControl,
  SpeakManyResult,
  Speaker,
} from './types.ts'
import { boolValue, stringSlice, trimString } from './util.ts'

export const SPEAK_ROUTE_SAVE = 'save'
export const SPEAK_ROUTE_SEND = 'send'
export const SPEAK_ROUTE_QUEUE = 'queue'
export const SPEAK_ROUTE_FOLLOW_UP = 'followup'

const MAX_SPEAK_MANY = 8

export type SpeakRequest = {
  conversationId: string
  text: string
  idempotencyKey: string
  mode: string
  confirmed: boolean
}

export type CreateRequest = {
  kind: string
  workspacePath: string
  title: string
  firstMessage: string
  idempotencyKey: string
}

export type StopRequest = {
  conversationId: string
  idempotencyKey: string
  confirmed: boolean
}

export type SpeakManyRequest = {
  conversationIds: string[]
  text: string
  idempotencyKey: string
  mode: string
  confirmed: boolean
}

export type DispatchedSession = {
  id: string
  title: string
  kind: string
  workspace: string
  workspaceHome: string
  kernel: string
  executionMode: string
  approvalPolicy: string
}

export function speakRoute(registered: boolean, busy: boolean, kernel: string): string {
  if (!registered) return SPEAK_ROUTE_SAVE
  if (!busy) return SPEAK_ROUTE_SEND
  if (kernel.trim().toLowerCase() === 'dsh') return SPEAK_ROUTE_QUEUE
  return SPEAK_ROUTE_FOLLOW_UP
}

export function normalizeConversationKind(value: string): string {
  switch (value.trim().toLowerCase()) {
    case 'image':
    case 'draw':
      return 'image'
    case 'cve':
      return 'cve'
    case 'lab':
      return 'lab'
    default:
      return 'coding'
  }
}

function acceptedDispatchWorkspace(path: string): string {
  const raw = path.trim()
  if (!raw) return ''
  const cleaned = normalize(isAbsolute(raw) ? raw : resolve(raw))
  const tempRoot = normalize(tmpdir())
  if (cleaned === tempRoot || cleaned.startsWith(tempRoot + sep)) return ''
  try {
    if (!statSync(cleaned).isDirectory()) return ''
  } catch {
    return ''
  }
  return cleaned
}

export function planDispatchedSession(
  kind: string,
  title: string,
  workspace: string,
  kernel: string,
): DispatchedSession {
  const normalizedKind = normalizeConversationKind(kind)
  let sessionTitle = title.trim()
  if (!sessionTitle) sessionTitle = normalizedKind
  let sessionKernel = kernel.trim()
  if (!sessionKernel) sessionKernel = 'pi'
  const session: DispatchedSession = {
    id: randomUUID(),
    title: sessionTitle,
    kind: normalizedKind,
    workspace: '',
    workspaceHome: '',
    kernel: sessionKernel,
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
  }
  if (normalizedKind === 'image') {
    session.workspaceHome = 'image'
    return session
  }
  session.workspace = acceptedDispatchWorkspace(workspace)
  return session
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export class Dispatcher {
  private readonly catalog: Catalog | undefined
  private readonly speaker: Speaker | undefined
  private readonly board: Board | undefined
  private readonly enabled: () => boolean
  private control: SessionControl | undefined
  private deliveries = new Map<string, DispatchResult>()

  constructor(
    catalog: Catalog | undefined,
    speaker: Speaker | undefined,
    board: Board | undefined,
    enabled: () => boolean,
  ) {
    this.catalog = catalog
    this.speaker = speaker
    this.board = board
    this.enabled = enabled
  }

  setControl(control: SessionControl | undefined): void {
    this.control = control
  }

  async handle(input: Record<string, unknown>): Promise<unknown> {
    const action = trimString(input.action)
    switch (action) {
      case 'speak':
        return this.speak({
          conversationId: trimString(input.conversationId),
          text: trimString(input.text),
          idempotencyKey: trimString(input.idempotencyKey),
          mode: trimString(input.mode),
          confirmed: boolValue(input.confirmed),
        })
      case 'create_conversation':
        return this.createConversation({
          kind: trimString(input.kind),
          workspacePath: trimString(input.workspacePath),
          title: trimString(input.title),
          firstMessage: trimString(input.firstMessage),
          idempotencyKey: trimString(input.idempotencyKey),
        })
      case 'stop':
        return this.stop({
          conversationId: trimString(input.conversationId),
          idempotencyKey: trimString(input.idempotencyKey),
          confirmed: boolValue(input.confirmed),
        })
      case 'speak_many':
        return this.speakMany({
          conversationIds: stringSlice(input.conversationIds),
          text: trimString(input.text),
          idempotencyKey: trimString(input.idempotencyKey),
          mode: trimString(input.mode),
          confirmed: boolValue(input.confirmed),
        })
      default:
        throw new Error(`unknown companion_dispatch action ${JSON.stringify(action)}`)
    }
  }

  async speak(req: SpeakRequest): Promise<DispatchResult> {
    const replayed = this.replay(req.idempotencyKey)
    if (replayed) return replayed
    if (!this.dispatchEnabled()) return this.fail(req.idempotencyKey, '', 'companion dispatch is turned off')
    if (!req.conversationId) return this.fail(req.idempotencyKey, '', 'speak requires conversationId')
    if (!req.text) return this.fail(req.idempotencyKey, '', 'speak requires text')
    if (!req.idempotencyKey) return this.fail(req.idempotencyKey, '', 'speak requires idempotencyKey')
    if (!this.catalog) return this.fail(req.idempotencyKey, '', 'conversation was not found')
    let ref: ConversationRef
    try {
      ref = await this.catalog.lookup(req.conversationId)
    } catch {
      return this.fail(req.idempotencyKey, '', 'conversation was not found')
    }
    if (ref.archived) return this.fail(req.idempotencyKey, ref.title, 'conversation is archived')
    let mode = req.mode.toLowerCase().trim()
    if (!mode) mode = 'queue'
    if (mode === 'steer' && !req.confirmed) {
      return {
        accepted: false,
        delivered: false,
        targetTitle: ref.title,
        needsConfirmation: true,
      }
    }
    if (mode !== 'queue' && mode !== 'steer') {
      return this.fail(req.idempotencyKey, ref.title, 'speak mode must be queue or steer')
    }
    if (!this.speaker) return this.recordFailure(req.idempotencyKey, ref, '', 'delivery is not configured')
    try {
      const delivered = mode === 'steer'
        ? await this.speaker.deliverSteer(ref.id, req.text)
        : await this.speaker.deliverSpeak(ref.id, req.text)
      if (!delivered.produced) {
        return this.recordFailure(req.idempotencyKey, ref, delivered.entryId, 'target conversation did not receive a user entry')
      }
      const result: DispatchResult = {
        accepted: true,
        delivered: true,
        conversationId: ref.id,
        targetTitle: ref.title,
        entryId: delivered.entryId,
      }
      this.store(req.idempotencyKey, result)
      return result
    } catch (error) {
      return this.recordFailure(req.idempotencyKey, ref, '', error instanceof Error ? error.message : String(error))
    }
  }

  async speakMany(req: SpeakManyRequest): Promise<SpeakManyResult | DispatchResult> {
    const replayed = this.replay(req.idempotencyKey)
    if (replayed) return replayed
    if (!this.dispatchEnabled()) return this.fail(req.idempotencyKey, '', 'companion dispatch is turned off')
    if (!req.text.trim()) return this.fail(req.idempotencyKey, '', 'speak_many requires text')
    if (!req.idempotencyKey) return this.fail(req.idempotencyKey, '', 'speak_many requires idempotencyKey')
    const ids = uniqueIds(req.conversationIds)
    if (!ids.length) return this.fail(req.idempotencyKey, '', 'speak_many requires conversationIds')
    if (ids.length > MAX_SPEAK_MANY) {
      return this.fail(req.idempotencyKey, '', `speak_many accepts at most ${MAX_SPEAK_MANY} conversations`)
    }
    let mode = req.mode.toLowerCase().trim()
    if (!mode) mode = 'queue'
    if (mode !== 'queue' && mode !== 'steer') {
      return this.fail(req.idempotencyKey, '', 'speak mode must be queue or steer')
    }
    if (mode === 'steer' && !req.confirmed) {
      return {
        accepted: false,
        delivered: false,
        targetTitle: req.text,
        needsConfirmation: true,
      }
    }
    const results: DispatchResult[] = []
    let accepted = false
    for (const id of ids) {
      const item = await this.speak({
        conversationId: id,
        text: req.text,
        idempotencyKey: `${req.idempotencyKey}:${id}`,
        mode,
        confirmed: req.confirmed || mode === 'queue',
      })
      if (item.accepted && item.delivered) accepted = true
      results.push(item)
    }
    const batch: SpeakManyResult = { accepted, results }
    if (!accepted) batch.error = 'no conversation received the instruction'
    return batch
  }

  async createConversation(req: CreateRequest): Promise<DispatchResult> {
    const replayed = this.replay(req.idempotencyKey)
    if (replayed) return replayed
    if (!this.dispatchEnabled()) return this.fail(req.idempotencyKey, '', 'companion dispatch is turned off')
    if (!this.catalog) return this.fail(req.idempotencyKey, '', 'conversation catalog is not configured')
    const kind = normalizeConversationKind(req.kind)
    const title = req.title || kind
    let ref: ConversationRef
    try {
      ref = await this.catalog.create({ title, kind, workspacePath: req.workspacePath, id: '' })
    } catch (error) {
      return this.fail(req.idempotencyKey, title, error instanceof Error ? error.message : String(error))
    }
    const result: DispatchResult = {
      accepted: true,
      delivered: true,
      conversationId: ref.id,
      targetTitle: ref.title,
      entryId: ref.id,
    }
    if (req.firstMessage && this.speaker) {
      try {
        const spoken = await this.speaker.deliverSpeak(ref.id, req.firstMessage)
        if (!spoken.produced) {
          return this.recordFailure(req.idempotencyKey, ref, ref.id, 'created conversation but first message was not delivered')
        }
        result.entryId = spoken.entryId
      } catch (error) {
        return this.recordFailure(req.idempotencyKey, ref, ref.id, error instanceof Error ? error.message : String(error))
      }
    }
    this.store(req.idempotencyKey, result)
    return result
  }

  async stop(req: StopRequest): Promise<DispatchResult> {
    const replayed = this.replay(req.idempotencyKey)
    if (replayed) return replayed
    if (!this.dispatchEnabled()) return this.fail(req.idempotencyKey, '', 'companion dispatch is turned off')
    if (!req.conversationId) return this.fail(req.idempotencyKey, '', 'stop requires conversationId')
    if (!req.idempotencyKey) return this.fail(req.idempotencyKey, '', 'stop requires idempotencyKey')
    if (!this.catalog) return this.fail(req.idempotencyKey, '', 'conversation was not found')
    let ref: ConversationRef
    try {
      ref = await this.catalog.lookup(req.conversationId)
    } catch {
      return this.fail(req.idempotencyKey, '', 'conversation was not found')
    }
    if (ref.archived) return this.fail(req.idempotencyKey, ref.title, 'conversation is archived')
    if (!req.confirmed) {
      return {
        accepted: false,
        delivered: false,
        targetTitle: ref.title,
        needsConfirmation: true,
      }
    }
    if (!this.control) return this.recordFailure(req.idempotencyKey, ref, '', 'session control is not configured')
    try {
      await this.control.abort(ref.id)
    } catch (error) {
      return this.recordFailure(req.idempotencyKey, ref, '', error instanceof Error ? error.message : String(error))
    }
    const result: DispatchResult = {
      accepted: true,
      delivered: true,
      targetTitle: ref.title,
      conversationId: ref.id,
    }
    this.store(req.idempotencyKey, result)
    return result
  }

  replaceDeliveries(results: Record<string, DispatchResult>): void {
    this.deliveries = new Map()
    for (const [key, result] of Object.entries(results)) {
      if (!key.trim()) continue
      this.deliveries.set(key, result)
    }
  }

  snapshotDeliveries(): Record<string, DispatchResult> {
    return Object.fromEntries(this.deliveries)
  }

  private dispatchEnabled(): boolean {
    return this.enabled()
  }

  private replay(key: string): DispatchResult | null {
    const id = key.trim()
    if (!id) return null
    const result = this.deliveries.get(id)
    if (!result) return null
    return { ...result, idempotentReplay: true }
  }

  private store(key: string, result: DispatchResult): void {
    const id = key.trim()
    if (!id) return
    this.deliveries.set(id, result)
  }

  private fail(key: string, title: string, reason: string): DispatchResult {
    const result: DispatchResult = {
      accepted: false,
      delivered: false,
      targetTitle: title,
      error: reason,
    }
    this.store(key, result)
    return result
  }

  private recordFailure(key: string, ref: ConversationRef, entryId: string, reason: string): DispatchResult {
    const result: DispatchResult = {
      accepted: true,
      delivered: false,
      targetTitle: ref.title,
      entryId,
      error: reason,
    }
    this.store(key, result)
    this.board?.recordDispatchFailure(ref.id, reason)
    return result
  }
}
