import type { AppSettings, SettingsStore } from '../config/settings-store.ts'
import {
  ConversationStore,
  KERNEL_PI,
  normalizeKernel,
  type StoredConversation,
} from '../conversations.ts'
import type { Engine } from '../engine.ts'
import { generateTraceId } from '../trace.ts'
import { excerptFromMessages } from './app-control.ts'
import { planDispatchedSession, speakRoute } from './dispatch.ts'
import { RELAY_PREFIX, type AppControl, type Catalog, type ConversationRef, type SessionControl, type Speaker } from './types.ts'
import { firstNonEmpty, trimString } from './util.ts'

function conversationKind(stored: StoredConversation): string {
  if (stored.workspaceHome === 'image') return 'image'
  const kind = stored.domainTaskContext?.kind
  if (typeof kind === 'string' && kind.trim()) return kind.trim()
  return 'coding'
}

function conversationRef(stored: StoredConversation, archived: boolean): ConversationRef {
  return {
    id: stored.id,
    title: firstNonEmpty(stored.title, stored.id),
    kind: conversationKind(stored),
    workspacePath: stored.workspacePath,
    kernel: stored.kernel,
    status: 'idle',
    archived: archived || (stored.archivedAt ?? 0) > 0,
  }
}

export function createCompanionCatalog(input: {
  conversations: ConversationStore
  settings?: SettingsStore
  emit: (event: string, payload: unknown) => void
}): Catalog {
  return {
    async lookup(id) {
      try {
        return conversationRef(await input.conversations.get(id), false)
      } catch (error) {
        const archived = await input.conversations.listArchived()
        const found = archived.find((item) => item.id === id)
        if (found) return conversationRef(found, true)
        throw error
      }
    },
    async listActive() {
      const stored = await input.conversations.list()
      return stored.map((item) => conversationRef(item, false))
    },
    async listArchived() {
      const stored = await input.conversations.listArchived()
      return stored.map((item) => conversationRef(item, true))
    },
    async create(ref) {
      const kernel = input.settings?.get().default_kernel ?? KERNEL_PI
      const planned = planDispatchedSession(ref.kind ?? '', ref.title, ref.workspacePath ?? '', kernel)
      const stored: StoredConversation = {
        id: planned.id,
        title: planned.title,
        createdAt: Date.now(),
        workspacePath: planned.workspace,
        workspaceHome: planned.workspaceHome || undefined,
        kernel: normalizeKernel(planned.kernel),
        executionMode: planned.executionMode,
        approvalPolicy: planned.approvalPolicy,
        messages: [],
      }
      if (planned.kind === 'cve' || planned.kind === 'lab') {
        stored.domainTaskContext = { kind: planned.kind }
      }
      await input.conversations.save(stored)
      input.emit('conversations-changed', {})
      return conversationRef(stored, false)
    },
  }
}

export function createCompanionControl(engine: Engine): SessionControl {
  return {
    abort(conversationId) {
      return engine.abortMessage(conversationId)
    },
    steer(conversationId, text) {
      return engine.steerMessage(conversationId, RELAY_PREFIX + text)
    },
  }
}

export function createCompanionSpeaker(input: {
  conversations: ConversationStore
  engine: Engine
}): Speaker {
  const kernelOf = async (conversationId: string): Promise<string> => {
    try {
      const stored = await input.conversations.get(conversationId)
      return normalizeKernel(stored.kernel)
    } catch {
      return input.engine.kernelFor(conversationId)
    }
  }

  const ackId = (route: string, conversationId: string) => `cmp_ack_${route}_${conversationId}`

  const startCold = async (conversationId: string, text: string) => {
    const stored = await input.conversations.get(conversationId)
    const prompt = RELAY_PREFIX + text
    const entryId = `cmp_entry_${Date.now()}`
    stored.messages.push({
      id: entryId,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    })
    await input.conversations.save(stored)
    const executionMode = trimString(stored.executionMode) || 'go'
    const approvalPolicy = trimString(stored.approvalPolicy) || 'workspace-auto'
    await input.engine.sendMessage({
      conversationId,
      prompt,
      workspacePath: stored.workspacePath ?? '',
      modelMode: stored.modelMode ?? '',
      modelProvider: stored.modelProvider ?? '',
      modelId: stored.modelId ?? '',
      thinkingLevel: stored.thinkingLevel ?? '',
      modelSourcePreference: 'auto',
      executionMode,
      approvalPolicy,
      mcpConfigDigest: stored.mcpConfigDigest ?? '',
      mcpServers: stored.mcpServers ?? [],
      attachments: [],
      branchFromUserOccurrence: 0,
      traceId: generateTraceId(),
    })
    return { entryId, produced: true }
  }

  const appendRelay = async (conversationId: string, text: string) => {
    const stored = await input.conversations.get(conversationId)
    const entryId = `cmp_entry_${Date.now()}`
    stored.messages.push({
      id: entryId,
      role: 'user',
      content: RELAY_PREFIX + text,
      timestamp: Date.now(),
    })
    await input.conversations.save(stored)
    return { entryId, produced: true }
  }

  return {
    async deliverSpeak(conversationId, text) {
      const registered = input.engine.hasRegisteredSession(conversationId)
      const busy = input.engine.sessionBusy(conversationId)
      const route = speakRoute(registered, busy, await kernelOf(conversationId))
      const prompt = RELAY_PREFIX + text
      switch (route) {
        case 'save':
          try {
            return await startCold(conversationId, text)
          } catch {
            return appendRelay(conversationId, text)
          }
        case 'send':
          await input.engine.sendRegisteredMessage(conversationId, prompt)
          return { entryId: ackId('send', conversationId), produced: true }
        case 'queue':
          await input.engine.queueMessage(conversationId, prompt)
          return { entryId: ackId('queue', conversationId), produced: true }
        case 'followup':
          await input.engine.followUpMessage(conversationId, prompt)
          return { entryId: ackId('followup', conversationId), produced: true }
        default:
          throw new Error('unsupported companion speak route')
      }
    },
    async deliverSteer(conversationId, text) {
      if (!input.engine.hasRegisteredSession(conversationId)) {
        throw new Error('target conversation is not running')
      }
      await input.engine.steerMessage(conversationId, RELAY_PREFIX + text)
      return { entryId: ackId('steer', conversationId), produced: true }
    },
  }
}

export function createCompanionAppControl(input: {
  conversations: ConversationStore
  settings?: SettingsStore
  hostCall?: (method: string, payload?: unknown) => Promise<unknown>
  emit: (event: string, payload: unknown) => void
}): AppControl {
  const lookupActive = async (id: string): Promise<StoredConversation> => {
    try {
      const stored = await input.conversations.get(id)
      if ((stored.archivedAt ?? 0) > 0) throw new Error('conversation is archived')
      return stored
    } catch (error) {
      const archived = await input.conversations.listArchived()
      if (archived.some((item) => item.id === id)) throw new Error('conversation is archived')
      throw error instanceof Error ? error : new Error('conversation was not found')
    }
  }

  return {
    async openMainWindow() {
      if (!input.hostCall) throw new Error('desktop host is unavailable')
      await input.hostCall('window.show', {})
    },
    async focusConversation(id) {
      await lookupActive(id)
      if (!input.hostCall) throw new Error('desktop host is unavailable')
      await input.hostCall('window.show', {})
      input.emit('companion-focus', { conversationId: id })
    },
    async readConversation(id, limit) {
      const stored = await lookupActive(id)
      return excerptFromMessages(
        stored.id,
        firstNonEmpty(stored.title, stored.id),
        stored.messages.map((message) => message.role),
        stored.messages.map((message) => message.content),
        limit,
      )
    },
    async currentSettings() {
      if (!input.settings) throw new Error('settings are not configured')
      return input.settings.get() as unknown as Record<string, unknown>
    },
    async saveSettings(next) {
      if (!input.settings) throw new Error('settings are not configured')
      await input.settings.save(next as AppSettings)
    },
    async quit() {
      if (!input.hostCall) throw new Error('desktop host is unavailable')
      await input.hostCall('app.quit', null)
    },
    async relaunch() {
      if (!input.hostCall) throw new Error('desktop host is unavailable')
      await input.hostCall('app.relaunch', null)
    },
  }
}
