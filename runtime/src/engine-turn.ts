import { computerUseSocket } from './computercap/hostpath.ts'
import {
  MODEL_SOURCE_ACCOUNT,
  MODEL_SOURCE_PERSONAL,
  type AppSettings,
} from './config/settings-store.ts'
import {
  ensureCollaborationRoot,
  normalizeCodingCollaborationDescriptor,
  type CodingCollaborationDescriptor,
} from './codingcollab/index.ts'
import { resolveModelThinking } from './model-thinking.ts'

export const CODING_BROWSER_MCP = 'milksu-playwright'
export const BROWSER_USE_MCP = 'milksu-playwright-user'
export const COMPUTER_USE_MCP = 'milksu-computer-use'

export type CodingBrowserDescriptor = {
  sessionId: string
  cdpEndpoint: string
}

export type ComputerUseDescriptor = {
  sessionId: string
  socketPath: string
  targetBundleId: string
  targetName: string
  targetPid: number
  targetWindowId: number
}

export type SendMessageTurnInput = {
  conversationId: string
  prompt: string
  workspace: string
  home: string
  sessionRole: string
  imageDraw: boolean
  executionMode: string
  approvalPolicy: string
  mcpServers: string[]
  mcpConfigDigest: string
  attachments: Array<Record<string, unknown>>
  productAction?: Record<string, unknown> | null
  branchFromUserOccurrence: number
  traceId: string
  provider: string
  model: string
  thinkingLevel: string
  modelSourcePreference: string
  settings: AppSettings
  locale: string
  userMemories: Array<Record<string, string>>
  memoryRevision: number
  codingBrowser?: CodingBrowserDescriptor | null
  computerUse?: ComputerUseDescriptor | null
  codingCollaboration?: CodingCollaborationDescriptor | null
  securityTools?: unknown[]
  disabledSkills?: string[]
  userMcpServers?: unknown
  userSkillPaths?: string[]
}

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function flagAllowed(value: boolean | null | undefined): boolean {
  return value == null || value === true
}

function removeMCPServer(names: string[], blocked: string): string[] {
  return names.filter((name) => trim(name) !== blocked)
}

function customProviderTurnPayload(
  settings: AppSettings,
  providerName: string,
): Record<string, unknown> | null {
  const name = trim(providerName)
  if (!name) return null
  const provider = settings.providers?.[name]
  if (!provider?.custom || !provider.enabled) return null
  const baseUrl = trim(provider.base_url)
  const key = trim(provider.api_key)
  if (!baseUrl || !key) return null
  return {
    id: name,
    name: trim(provider.name),
    key,
    baseUrl,
    api: trim(provider.api),
  }
}

function resolveWorkerModel(settings: AppSettings): {
  provider: string
  model: string
  source: string
} | null {
  const provider = trim(settings.worker_provider)
  const model = trim(settings.worker_model)
  if (!provider || !model) return null
  let source = trim(settings.worker_source)
  if (source !== MODEL_SOURCE_ACCOUNT && source !== MODEL_SOURCE_PERSONAL && source !== 'service') {
    source = provider === 'tokenflux' ? MODEL_SOURCE_PERSONAL : 'service'
  }
  return { provider, model, source }
}

export function normalizeCodingBrowserDescriptor(
  descriptor: CodingBrowserDescriptor | null | undefined,
): CodingBrowserDescriptor | null {
  if (!descriptor) return null
  const sessionId = trim(descriptor.sessionId)
  const endpoint = trim(descriptor.cdpEndpoint)
  if (!sessionId.startsWith('browser_') || sessionId.length > 160) {
    throw new Error('invalid Coding browser session id')
  }
  for (const character of sessionId) {
    if (!/[a-zA-Z0-9_-]/u.test(character)) {
      throw new Error('invalid Coding browser session id')
    }
  }
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error('invalid Coding browser CDP endpoint')
  }
  const port = Number(parsed.port)
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
    || !Number.isInteger(port)
    || port <= 0
    || port > 65535
    || parsed.host !== `127.0.0.1:${port}`
  ) {
    throw new Error('invalid Coding browser CDP endpoint')
  }
  return { sessionId, cdpEndpoint: endpoint }
}

function validComputerUseBundleID(value: string): boolean {
  if (!value || value.length > 256) return false
  return /^[a-zA-Z0-9.-]+$/u.test(value)
}

export function normalizeComputerUseDescriptor(
  descriptor: ComputerUseDescriptor | null | undefined,
): ComputerUseDescriptor | null {
  if (!descriptor) return null
  const sessionId = trim(descriptor.sessionId)
  const sessionSuffix = sessionId.startsWith('computer_') ? sessionId.slice('computer_'.length) : ''
  if (!sessionSuffix || sessionSuffix.length < 8 || sessionSuffix.length > 128) return null
  if (!/^[a-zA-Z0-9-]+$/u.test(sessionSuffix)) return null
  const expectedSocket = computerUseSocket(sessionId)
  if (trim(descriptor.socketPath) !== expectedSocket) return null
  const targetBundleId = trim(descriptor.targetBundleId)
  const targetName = trim(descriptor.targetName)
  if (!validComputerUseBundleID(targetBundleId)) return null
  if (!targetName || targetName.length > 120 || targetName.includes('\0')) return null
  const targetPid = Number(descriptor.targetPid)
  const targetWindowId = Number(descriptor.targetWindowId)
  if (!Number.isInteger(targetPid) || targetPid <= 1) return null
  if (!Number.isInteger(targetWindowId) || targetWindowId <= 0) return null
  return {
    sessionId,
    socketPath: expectedSocket,
    targetBundleId,
    targetName,
    targetPid,
    targetWindowId,
  }
}

export function buildSendMessageCommand(input: SendMessageTurnInput): Record<string, unknown> {
  const settings = input.settings ?? {}
  const executionMode = trim(input.executionMode) || 'go'
  const approvalPolicy = trim(input.approvalPolicy) || 'workspace-auto'
  let mcpServers = Array.isArray(input.mcpServers) ? [...input.mcpServers] : []

  let codingBrowser: CodingBrowserDescriptor | null = null
  try {
    codingBrowser = normalizeCodingBrowserDescriptor(input.codingBrowser)
  } catch (error) {
    if (input.codingBrowser) throw error
  }
  if (executionMode !== 'go' || !flagAllowed(settings.coding_browser_enabled)) {
    codingBrowser = null
    mcpServers = removeMCPServer(mcpServers, CODING_BROWSER_MCP)
  }

  let computerUse = normalizeComputerUseDescriptor(input.computerUse)
  if (
    executionMode !== 'go'
    || approvalPolicy === 'read-only'
    || !flagAllowed(settings.computer_use_enabled)
  ) {
    computerUse = null
    mcpServers = removeMCPServer(mcpServers, COMPUTER_USE_MCP)
  }

  if (!flagAllowed(settings.browser_use_enabled)) {
    mcpServers = removeMCPServer(mcpServers, BROWSER_USE_MCP)
  }

  let codingCollaboration: CodingCollaborationDescriptor | null = null
  if (input.codingCollaboration) {
    codingCollaboration = normalizeCodingCollaborationDescriptor(
      input.codingCollaboration,
      input.conversationId,
      input.workspace,
      ensureCollaborationRoot(input.home),
    )
  }
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    codingCollaboration = null
  }

  const thinking = resolveModelThinking(
    settings,
    input.provider,
    input.model,
    input.thinkingLevel,
  )

  const command: Record<string, unknown> = {
    action: 'send_message',
    conversationId: input.conversationId,
    prompt: input.prompt,
    locale: input.locale,
    provider: input.provider,
    model: input.model,
    thinking,
    sessionRole: trim(input.sessionRole),
    executionMode,
    approvalPolicy,
    imageDraw: Boolean(input.imageDraw),
    mcpServers,
    mcpConfigDigest: trim(input.mcpConfigDigest),
    disabledSkills: Array.isArray(input.disabledSkills) ? input.disabledSkills : [],
    attachments: input.attachments ?? [],
    modelSourceOrder: [MODEL_SOURCE_ACCOUNT, MODEL_SOURCE_PERSONAL].includes(
      trim(input.modelSourcePreference),
    )
      ? [trim(input.modelSourcePreference)]
      : [],
    userMemories: Array.isArray(input.userMemories) ? input.userMemories : [],
    memoryRevision: Number(input.memoryRevision) || 0,
    traceId: input.traceId,
  }

  const customProvider = customProviderTurnPayload(settings, input.provider)
  if (customProvider) command.customProvider = customProvider

  const sessionId = trim(input.conversationId)
  if (
    sessionId.startsWith('milksu_text_projection_')
    || sessionId.startsWith('milksu_model_probe_')
  ) {
    command.turnPolicy = {
      toolAccess: 'none',
      reason: 'text_projection',
    }
  }

  if (Array.isArray(input.securityTools) && input.securityTools.length > 0) {
    command.securityTools = input.securityTools
  }
  if (input.userMcpServers && typeof input.userMcpServers === 'object') {
    command.userMcpServers = input.userMcpServers
  }
  if (Array.isArray(input.userSkillPaths) && input.userSkillPaths.length > 0) {
    command.userSkillPaths = input.userSkillPaths
  }

  const worker = resolveWorkerModel(settings)
  if (worker) {
    command.workerModel = {
      provider: worker.provider,
      model: worker.model,
      source: worker.source,
      thinking: resolveModelThinking(settings, worker.provider, worker.model, ''),
    }
  }

  if (codingBrowser) command.codingBrowser = codingBrowser
  if (computerUse) command.computerUse = computerUse
  if (codingCollaboration) command.codingCollaboration = codingCollaboration
  if (input.productAction && typeof input.productAction === 'object') {
    command.productAction = input.productAction
  }
  if (Number.isInteger(input.branchFromUserOccurrence) && input.branchFromUserOccurrence >= 0) {
    command.branchFromUserOccurrence = input.branchFromUserOccurrence
  }
  return command
}
