import type { SessionTurnSnapshot } from '@/lib/sessionTurnStatus'
import type { CodingMessageQueue } from '@/composables/useConversations'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingAttachment,
  CodingExecutionMode,
  CodingProductActionRequest,
  Conversation,
  CTFChatAction,
} from '@/types'

export interface CodingAgentSurfaceBind {
  settings: AppSettings | null
  workspacePath: string
  running: boolean
  aborting: boolean
  messageQueue?: CodingMessageQueue
  sessionReady: boolean
  resumed: boolean
  compacting: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: SessionTurnSnapshot
  ctfSession: boolean
  vulnerabilitySession: boolean
  ctfMode?: Conversation['ctfMode']
  ctfRole?: Conversation['ctfRole']
  modelMode?: Conversation['modelMode']
  modelProvider?: string
  modelId?: string
  modelSourcePreference?: 'auto' | 'account' | 'personal'
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
  pendingComposerDraft?: { prompt: string; visibleText: string } | null
}

export type CodingAgentSendArgs = [
  text: string,
  visibleText?: string,
  attachments?: CodingAttachment[],
  scopeToken?: 'browser-use' | 'computer-use',
  productAction?: CodingProductActionRequest,
]

export type CodingAgentSurfaceEmit = {
  send: CodingAgentSendArgs
  abort: []
  consumePendingDraft: []
  ctfAction: [action: CTFChatAction]
  compactContext: []
  rewindContext: []
  handoffContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string]
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [executionMode: CodingExecutionMode, approvalPolicy: CodingApprovalPolicy]
  changeMcpServers: [servers: string[], configDigest: string]
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
  openSettings: []
}
