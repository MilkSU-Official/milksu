import {
  applySaveConversationRules,
  type Engine,
  type SendMessageArgs,
} from './engine.ts'
import {
  ConversationStore,
  isValidConversationId,
  normalizeKernel,
  type StoredConversation,
} from './conversations.ts'
import { LabJobStore, type LabJob } from './lab.ts'
import type { RpcSource } from './rpc.ts'
import {
  applyGeneratedTitle,
  compactionAllowsStoredHandoff,
  ensureCodingArtifactWorkspace,
  findConversationForTitle,
  forkConversationRecord,
  handoffFromStoredConversation,
  newConversationId,
  rewindConversationRecord,
  saveHandoffConversation,
} from './session-actions.ts'
import type { AgentResourceStore } from './agentresources/store.ts'
import type { CodingToolsService } from './agentresources/codingtools.ts'
import type { SettingsStore } from './config/settings-store.ts'
import { isOwnedDomainMethod, ownedDomainMethod } from './domains.ts'
import type { VulnService } from './vuln/index.ts'
import type { ResearchService } from './research/service.ts'
import type { CompanionRuntime } from './companion/runtime.ts'
import { normalizeGeneratedTitle, titlePrompt } from './conversation-title.ts'
import { redactSnippet } from './sessionindex/index.ts'

export const ELECTRON_HOST_METHODS = new Set([
  'ListCompanionPluginPackages',
  'SetAccountModelCredential',
  'ClearAccountModelCredential',
  'SetAccountDecisionCredential',
  'ClearAccountDecisionCredential',
  'ExportSidecarEnvironment',
  'PutManagedSecret',
  'DeleteManagedSecret',
  'LookupManagedSecret',
])

export const OWNED_METHODS = new Set([
  'ListConversations',
  'ListArchivedConversations',
  'SaveConversation',
  'ArchiveConversation',
  'RestoreConversation',
  'DeleteConversation',
  'DeleteArchivedConversation',
  'ClearConversationProblem',
  'SendMessage',
  'AbortMessage',
  'AbortSubagent',
  'SteerMessage',
  'RestartEngine',
  'RespondToolApproval',
  'QueueDshMessage',
  'RemoveQueuedMessage',
  'ListLabJobs',
  'ListArchivedLabJobs',
  'SaveLabJob',
  'ArchiveLabJob',
  'RestoreLabJob',
  'ForkConversation',
  'GenerateConversationTitle',
  'EnsureCodingArtifactWorkspace',
  'RewindCodingSession',
  'HandoffCodingSession',
])

export type HandlerContext = {
  conversations: ConversationStore
  labJobs: LabJobStore
  research: ResearchService
  engine: Engine
  emit: (event: string, payload: unknown) => void
  home: string
  hostCall?: (method: string, payload?: unknown) => Promise<unknown>
  agentResources?: AgentResourceStore
  codingTools?: CodingToolsService
  settings?: SettingsStore
  invokeSource?: RpcSource | string
  vuln?: VulnService
  companion?: CompanionRuntime
}

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

export async function handleOwnedMethod(
  ctx: HandlerContext,
  source: RpcSource | string,
  method: string,
  args: unknown[] | undefined,
): Promise<unknown> {
  ctx.invokeSource = source
  const domain = ownedDomainMethod(method)
  if (domain) return domain(ctx, args)
  if (source !== 'renderer') {
    throw new Error(`desktop method ${method} is unavailable to ${source}`)
  }
  switch (method) {
    case 'ListConversations':
      return ctx.conversations.list()
    case 'ListArchivedConversations':
      return ctx.conversations.listArchived()
    case 'SaveConversation':
      return saveConversation(ctx, arg<StoredConversation>(args, 0, { id: '', title: '', createdAt: 0, messages: [] }))
    case 'ArchiveConversation':
      await ctx.engine.detachSession(arg(args, 0, ''))
      await ctx.conversations.archive(arg(args, 0, ''))
      ctx.emit('conversations-changed', {})
      return null
    case 'RestoreConversation':
      await ctx.conversations.restore(arg(args, 0, ''))
      ctx.emit('conversations-changed', {})
      return null
    case 'DeleteConversation':
      await deleteOwnedConversation(ctx, arg(args, 0, ''), false)
      return null
    case 'DeleteArchivedConversation':
      await deleteOwnedConversation(ctx, arg(args, 0, ''), true)
      return null
    case 'ClearConversationProblem':
      await ctx.engine.clearConversationProblem(arg(args, 0, ''))
      return null
    case 'SendMessage':
      await ctx.engine.sendMessage(sendMessageArgs(args))
      return null
    case 'AbortMessage':
      await ctx.engine.abortMessage(arg(args, 0, ''))
      return null
    case 'AbortSubagent':
      await ctx.engine.abortMessage(arg(args, 0, ''), arg(args, 1, ''))
      return null
    case 'SteerMessage':
      await ctx.engine.steerMessage(arg(args, 0, ''), arg(args, 1, ''))
      return null
    case 'RestartEngine':
      await ctx.engine.restartEngine(arg(args, 0, ''))
      return null
    case 'RespondToolApproval':
      await ctx.engine.respondToolApproval(
        arg(args, 0, ''),
        arg(args, 1, ''),
        Boolean(arg(args, 2, false)),
        arg(args, 3, ''),
        arg(args, 4, ''),
      )
      return null
    case 'QueueDshMessage':
      await ctx.engine.queueMessage(arg(args, 0, ''), arg(args, 1, ''))
      return null
    case 'RemoveQueuedMessage':
      await ctx.engine.removeQueuedMessage(
        arg(args, 0, ''),
        arg(args, 1, ''),
        Number(arg(args, 2, 0)),
        arg(args, 3, ''),
      )
      return null
    case 'ListLabJobs':
      return ctx.labJobs.list()
    case 'ListArchivedLabJobs':
      return ctx.labJobs.listArchived()
    case 'SaveLabJob':
      await ctx.labJobs.save(arg<LabJob>(args, 0, { id: '', title: '', scope: '', request: '', createdAt: 0, updatedAt: 0 }))
      return null
    case 'ArchiveLabJob':
      await ctx.labJobs.archive(arg(args, 0, ''))
      return null
    case 'RestoreLabJob':
      await ctx.labJobs.restore(arg(args, 0, ''))
      return null
    case 'ForkConversation':
      return forkOwnedConversation(
        ctx,
        arg(args, 0, ''),
        arg(args, 1, 'assistant'),
        Number(arg(args, 2, 0)),
      )
    case 'GenerateConversationTitle':
      return generateOwnedTitle(
        ctx,
        arg(args, 0, ''),
        arg(args, 1, ''),
        arg(args, 2, ''),
        arg(args, 3, ''),
        arg(args, 4, ''),
      )
    case 'EnsureCodingArtifactWorkspace':
      return ensureOwnedWorkspace(ctx, arg(args, 0, ''))
    case 'RewindCodingSession':
      await rewindOwnedSession(ctx, arg(args, 0, ''))
      return null
    case 'HandoffCodingSession':
      return handoffOwnedSession(ctx, arg(args, 0, ''), arg(args, 1, ''), arg(args, 2, ''))
    default:
      throw new Error(`unsupported desktop method ${JSON.stringify(method)}`)
  }
}

async function deleteOwnedConversation(
  ctx: HandlerContext,
  id: string,
  archived: boolean,
): Promise<void> {
  await ctx.engine.destroySession(id, true)
  if (archived) await ctx.conversations.deleteArchived(id)
  else await ctx.conversations.delete(id)
  ctx.emit('conversations-changed', {})
  await ctx.research.deleteConversation(id)
}

async function forkOwnedConversation(
  ctx: HandlerContext,
  conversationId: string,
  role: string,
  occurrence: number,
): Promise<string> {
  if (!isValidConversationId(conversationId)) throw new Error('invalid conversation id')
  const stored = await ctx.conversations.get(conversationId)
  let forkedId = ''
  try {
    forkedId = await ctx.engine.forkSession(conversationId, role, occurrence)
  } catch {
    forkedId = newConversationId()
  }
  if (!isValidConversationId(forkedId)) forkedId = newConversationId()
  await forkConversationRecord(ctx.conversations, conversationId, forkedId, role, occurrence)
  ctx.engine.bindSessionKernel(
    forkedId,
    normalizeKernel(stored.kernel) as 'pi' | 'dsh',
    stored.acpAgentId ?? '',
  )
  ctx.emit('conversations-changed', {})
  return forkedId
}

async function generateOwnedTitle(
  ctx: HandlerContext,
  firstMessage: string,
  _modelMode: string,
  modelProvider: string,
  modelId: string,
  conversationId: string,
): Promise<string> {
  const generated = await ctx.engine.generateText(
    titlePrompt(redactSnippet(firstMessage)),
    modelProvider,
    modelId,
  )
  const title = normalizeGeneratedTitle(redactSnippet(generated))
  let targetId = conversationId.trim()
  if (!targetId) {
    const match = await findConversationForTitle(ctx.conversations, firstMessage)
    targetId = match?.id ?? ''
  }
  if (targetId && isValidConversationId(targetId)) {
    await applyGeneratedTitle(ctx.conversations, targetId, title)
    ctx.emit('conversations-changed', {})
  }
  return title
}

async function ensureOwnedWorkspace(ctx: HandlerContext, conversationId: string): Promise<string> {
  const workspace = await ensureCodingArtifactWorkspace(
    ctx.conversations,
    conversationId,
    ctx.home,
  )
  ctx.emit('conversations-changed', {})
  return workspace
}

async function rewindOwnedSession(ctx: HandlerContext, conversationId: string): Promise<void> {
  if (ctx.engine.hasLiveSession(conversationId)) {
    await ctx.engine.rewindSession(conversationId)
  }
  await rewindConversationRecord(ctx.conversations, conversationId)
  ctx.emit('conversations-changed', {})
}

async function handoffOwnedSession(
  ctx: HandlerContext,
  conversationId: string,
  kernel: string,
  acpAgentId = '',
): Promise<{ sessionId: string; summary?: string; surfaceText?: string }> {
  const stored = await ctx.conversations.get(conversationId)
  const current = normalizeKernel(stored.kernel)
  const target = normalizeKernel(kernel || stored.kernel)
  const targetAgentId = target === 'dsh'
    ? (String(acpAgentId ?? '').trim() || String(stored.acpAgentId ?? '').trim())
    : ''
  let receipt = {
    sessionId: '',
    summary: '',
    surfaceText: '',
  }
  if (target === current) {
    receipt = {
      summary: '',
      surfaceText: '',
      ...await ctx.engine.handoffSession(conversationId),
    }
  } else {
    try {
      const compacted = await ctx.engine.compactSession(conversationId)
      receipt = {
        sessionId: newConversationId(),
        summary: String(compacted.summary ?? '').trim(),
        surfaceText: String(compacted.surfaceText ?? '').trim(),
      }
    } catch (error) {
      if (!compactionAllowsStoredHandoff(error)) throw error
      receipt = handoffFromStoredConversation(stored)
    }
  }
  if (!receipt.sessionId) throw new Error('handoff ended without a forked session')
  await saveHandoffConversation(ctx.conversations, stored, receipt, target, targetAgentId)
  ctx.engine.bindSessionKernel(receipt.sessionId, target as 'pi' | 'dsh', targetAgentId)
  ctx.emit('conversations-changed', {})
  return {
    sessionId: receipt.sessionId,
    summary: receipt.summary,
    surfaceText: receipt.surfaceText,
  }
}

async function saveConversation(ctx: HandlerContext, value: StoredConversation): Promise<null> {
  if (!isValidConversationId(String(value?.id ?? ''))) {
    throw new Error('invalid conversation id')
  }
  let existing: StoredConversation | null = null
  try {
    existing = await ctx.conversations.getAny(value.id)
  } catch {
    existing = null
  }
  if (existing && (existing.archivedAt ?? 0) !== 0) return null
  const next = applySaveConversationRules(existing, value)
  try {
    await ctx.conversations.save(next)
  } catch (error) {
    if (error instanceof Error && error.message.includes('conversation is archived')) return null
    throw error
  }
  if (!existing) ctx.emit('conversations-changed', {})
  return null
}

function sendMessageArgs(args: unknown[] | undefined): SendMessageArgs {
  return {
    conversationId: arg(args, 0, ''),
    prompt: arg(args, 1, ''),
    workspacePath: arg(args, 2, ''),
    modelMode: arg(args, 3, ''),
    modelProvider: arg(args, 4, ''),
    modelId: arg(args, 5, ''),
    thinkingLevel: arg(args, 6, ''),
    modelSourcePreference: arg(args, 7, 'auto'),
    executionMode: arg(args, 8, ''),
    approvalPolicy: arg(args, 9, ''),
    mcpConfigDigest: arg(args, 10, ''),
    mcpServers: arg(args, 11, []),
    attachments: arg(args, 12, []),
    productAction: arg(args, 13, null),
    branchFromUserOccurrence: Number.isInteger(arg(args, 14, -1)) ? Number(arg(args, 14, -1)) : -1,
    traceId: arg(args, 15, ''),
  }
}

export function assertInvokeSource(method: string, source: string): void {
  if (source !== 'renderer' && source !== 'electron_host') {
    throw new Error(`unsupported desktop RPC source ${JSON.stringify(source)}`)
  }
  if (ELECTRON_HOST_METHODS.has(method) && source !== 'electron_host') {
    throw new Error(`desktop method ${method} is unavailable to ${source}`)
  }
}

export function isOwnedMethod(method: string): boolean {
  return OWNED_METHODS.has(method) || isOwnedDomainMethod(method)
}
