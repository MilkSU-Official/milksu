<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleDot,
  ExternalLink,
  FileDiff,
  FileImage,
  Flag,
  FolderOpen,
  GitBranch,
  Globe2,
  KeyRound,
  LoaderCircle,
  MousePointer2,
  MessageSquarePlus,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-vue-next'
import { invokeCommand, listenEvent } from '@/desktop'
import { nextChatAutoScrollPinned } from '@/lib/chatAutoScroll'
import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import ChatActivityGroup from '@/components-vue/ChatActivityGroup.vue'
import ChatComposer from '@/components-vue/ChatComposer.vue'
import MissionOperationPanel from '@/components-vue/MissionOperationPanel.vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import CodingArtifactPreviewPanel from '@/components-vue/CodingArtifactPreviewPanel.vue'
import CodingChangesPanel from '@/components-vue/CodingChangesPanel.vue'
import CodingComputerUsePanel from '@/components-vue/CodingComputerUsePanel.vue'
import CodingComputerUsePermissionDialog from '@/components-vue/CodingComputerUsePermissionDialog.vue'
import CodingMCPReviewCard from '@/components-vue/CodingMCPReviewCard.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import DomainTaskContextPanel from '@/components-vue/DomainTaskContextPanel.vue'
import TacticalPanelShell from '@/components-vue/TacticalPanelShell.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import type {
  CodingArtifactPreview,
  CodingBrowserStatus,
  CodingComputerUsePermission,
  CodingComputerUseStatus,
  CodingComputerUseTarget,
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitActionResult,
  CodingMCPConfigSnapshot,
  CodingProjectMemory,
} from '@/codingEnvironmentTypes'
import { normalizeCodingBrowserAddress } from '@/codingBrowserAddress'
import {
  codingBrowserAddressFromStatus,
  codingBrowserViewportSyncKey,
} from '@/lib/codingBrowserTabs'
import { readCodingRailWidth, writeCodingRailWidth } from '@/lib/codingRailWidth'
import {
  clampCodingTerminalHeight,
  readCodingTerminalHeight,
  writeCodingTerminalHeight,
} from '@/lib/codingTerminalHeight'
import {
  codingWorkspaceLabel,
  LOCAL_CODING_SHELL_ID,
  shouldRememberCodingProject,
} from '@/lib/codingProjectMemory'
import { buildChatTranscript } from '@/lib/chatActivity'
import {
  chatActivityGroupOpen,
  chatActivityOpenEntryIds,
  createChatActivityExpansionState,
  pruneChatActivityExpansion,
  setChatActivityEntryOpen,
  setChatActivityGroupOpen,
  type ChatActivityExpansionState,
} from '@/lib/chatActivityExpansion'
import { chatTopbarPresentation } from '@/lib/chatTopbar'
import { resolveModelContextWindow } from '@/lib/knownContextWindow'
import {
  effectiveModelThinkingLevel,
  resolveModelThinking,
} from '@/lib/modelThinking'
import {
  applySessionContextWindow,
  presentContextUsage,
  presentRunTiming,
  type SessionTurnSnapshot,
} from '@/lib/sessionTurnStatus'
import AgentExecutionPlan from '@/components-vue/AgentExecutionPlan.vue'
import ContextUsageMeter from '@/components-vue/ContextUsageMeter.vue'
import {
  presentDomainTaskContext,
  refreshCTFDomainTaskContext,
  sharedCodingSessionKind,
  type DomainTaskContext,
} from '@/lib/domainTaskContext'
import {
  agentRecoveryPrompt,
  recoverableAgentFailureId,
} from '@/lib/agentRecovery'
import {
  codingProductAction,
  codingReviewPrompt,
  type CodingProductActionKind,
} from '@/lib/codingProductActions'
import { extractLatestComputerUseOperationEvidence } from '@/lib/codingComputerUseEvidence'

import {
  computerUseTargetKey,
  computerUseStartArgs,
  describeActiveComputerUseCapability,
  describePendingComputerUseCapability,
  nextComputerUseTargetKey,
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
  selectedComputerUseTarget as resolveSelectedComputerUseTarget,
} from '@/lib/codingPolicy'
import { codingContinuityPresentation } from '@/lib/codingContinuityPresentation'
import type {
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFProjection,
  CTFToolWorkshopState,
} from '@/ctfTypes'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingAttachment,
  CodingExecutionMode,
  CodingProductActionRequest,
  Conversation,
  CTFChatAction,
  ModelThinkingLevel,
} from '@/types'
import type { CodingMessageQueue } from '@/composables/useConversations'
import {
  encodeComposerModelKey,
  parseComposerModelKey,
  providerModelLabel,
  useModelCatalog,
} from '@/modelCatalog'
import { enabledCodingSkillNames } from '@/codingSkills'

const CodingTerminalPanel = defineAsyncComponent(
  () => import('@/components-vue/CodingTerminalPanel.vue'),
)

const props = defineProps<{
  conversation: Conversation | null
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
  /** Last model usage + run clock from Pi (session-scoped projection). */
  turnStatus?: SessionTurnSnapshot
  ctfSession: boolean
  vulnerabilitySession?: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  thinkingLevel?: ModelThinkingLevel
  modelSourcePreference?: 'auto' | 'account' | 'personal'
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
  ensureConversation: (title?: string) => string
  /** Unsent handoff draft staged by CTF/CVE open path; never auto-starts Pi. */
  pendingComposerDraft?: { prompt: string; visibleText: string } | null
  conversationDrawerOpen?: boolean
}>()

const emit = defineEmits<{
  send: [
    text: string,
    visibleText?: string,
    attachments?: CodingAttachment[],
    scopeToken?: 'browser-use' | 'computer-use',
    productAction?: CodingProductActionRequest,
  ]
  ctfAction: [action: CTFChatAction]
  abort: []
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeThinkingLevel: [level: ModelThinkingLevel]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
  compactContext: []
  newConversation: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  openSettings: []
  openConversation: [conversationId: string]
  returnCtf: []
  returnVuln: []
  switchCtfAgent: [role: 'solver' | 'tool-builder' | 'strategist']
  consumePendingDraft: []
  toggleConversationDrawer: []
}>()

const goalMode = ref(false)
const stagedComposerPrompt = ref<{ conversationId: string; prompt: string } | null>(null)
const composer = ref<{ appendDraftText: (text: string) => void } | null>(null)
const scrollArea = ref<HTMLElement | null>(null)
const chatAutoScrollPinned = ref(true)
const lastChatScrollTop = ref(0)
const workshopState = ref<CTFToolWorkshopState | null>(null)
// Right context rail starts collapsed so the chat canvas stays wide.
const environmentOpen = ref(false)
const contextRailWidth = ref<number | null>(readCodingRailWidth())
// Domain context is the primary right-rail content for CTF/CVE (one rail only).
// Collapse to a floating PiP with a text control; reopen via the floating chip.
const domainContextCollapsed = ref(false)
const contextRailVisible = computed(() => (
  environmentOpen.value && !domainContextCollapsed.value
))
const terminalOpen = ref(false)
const terminalHeight = ref(readCodingTerminalHeight())
const terminalDockStyle = computed(() => ({ height: `${terminalHeight.value}px` }))
const contextPanelValues = [
  'domain',
  'environment',
  'changes',
  'artifacts',
  'browser',
  'browser-use',
  'computer-use',
  'collaboration',
  'evidence',
] as const
type ContextPanel = typeof contextPanelValues[number]
const contextPanel = ref<ContextPanel>(
  props.ctfSession || props.vulnerabilitySession ? 'domain' : 'environment',
)
const artifactPanel = ref<InstanceType<typeof CodingArtifactPreviewPanel> | null>(null)
const requestedArtifactPath = ref('')
const environmentLoading = ref(false)
const environmentError = ref('')
const browserPanelError = ref('')
const codingBrowserLoading = ref(false)
const codingBrowserURL = ref('')
const codingBrowserStatus = ref<CodingBrowserStatus | null>(null)
const codingBrowserViewport = ref<HTMLElement | null>(null)
const codingBrowserEvidenceLoading = ref(false)
const codingBrowserEvidenceError = ref('')
const codingBrowserEvidenceRevealed = ref(false)
const artifactPreviewEvidence = ref<{ relativePath: string; kind: CodingArtifactPreview['kind'] } | null>(null)
const browserEvidence = ref<{ path: string } | null>(null)
const computerUseEvidence = ref<{ name: string; bundleId: string; pid: number; windowId: number; windowTitle?: string } | null>(null)
const computerUseLoading = ref(false)
const computerUseStatus = ref<CodingComputerUseStatus | null>(null)
const computerUseTargets = ref<CodingComputerUseTarget[]>([])
const selectedComputerUseTargetKey = ref('')
const computerUsePermissionDialogOpen = ref(false)
const computerUsePermissionRequesting = ref<CodingComputerUsePermission | null>(null)
const computerUsePermissionPolling = ref(false)
const computerUsePermissionError = ref('')
const computerUsePermissionCompleting = ref(false)

const changesFocusPath = ref('')
const codingEnvironment = ref<CodingEnvironmentSnapshot | null>(null)
const mcpConfig = ref<CodingMCPConfigSnapshot | null>(null)
const mcpConfigLoading = ref(false)
const ctfBudget = ref<CTFAgentBudgetStatus | null>(null)
const ctfCheckpoint = ref<CTFAgentRunCheckpoint | null>(null)
const ctfProjection = ref<CTFProjection | null>(null)
const automaticModel = computed(() => {
  if (!props.settings) return null
  return {
    provider: props.settings.active_provider,
    model: props.settings.active_model,
  }
})
const effectiveModelMode = computed(() => (
  props.modelMode ?? 'auto'
))
const { pickerGroups, pickerModelLabel, snapshot: modelCatalogSnapshot } = useModelCatalog()
const currentModelKey = computed(() => {
  if (!props.settings) return ''
  if (effectiveModelMode.value === 'auto') return 'auto'
  const provider = props.modelProvider || props.settings.active_provider
  const model = props.modelId || props.settings.active_model
  // Prefer matching an enabled picker group so account vs personal stay distinct.
  const match = pickerGroups.value.find(group => (
    group.providerId === provider && group.models.includes(model)
  ))
  const source = match?.source ?? 'service'
  return encodeComposerModelKey(provider, model, source)
})
const automaticModelLabel = computed(() => {
  const selection = automaticModel.value
  if (!selection) return 'Default'
  const match = pickerGroups.value.find(group => (
    group.providerId === selection.provider && group.models.includes(selection.model)
  ))
  if (match) return `Default · ${pickerModelLabel(match, selection.model)}`
  return `Default · ${providerModelLabel(selection.provider, selection.model)}`
})
const currentModelSelection = computed(() => ({
  provider: effectiveModelMode.value === 'auto'
    ? automaticModel.value?.provider ?? ''
    : props.modelProvider || props.settings?.active_provider || '',
  model: effectiveModelMode.value === 'auto'
    ? automaticModel.value?.model ?? ''
    : props.modelId || props.settings?.active_model || '',
}))
const currentThinkingProfile = computed(() => resolveModelThinking(
  props.settings,
  currentModelSelection.value.provider,
  currentModelSelection.value.model,
))
const currentThinkingLevel = computed(() => effectiveModelThinkingLevel(
  currentThinkingProfile.value,
  props.thinkingLevel,
))
const activeExtensions = computed(() => (
  props.conversation?.agentExtensions ?? []
))
const selectedMCPServers = computed(() => props.mcpServers ?? [])
const activeSkills = computed(() => (
  props.ctfSession
    ? []
    : enabledCodingSkillNames(props.settings?.disabled_skills)
))
const activeTools = computed(() => (
  props.conversation?.agentTools ?? []
))
const activeGoal = computed(() => props.conversation?.agentGoal)
const composerGitSummary = computed(() => {
  const git = codingEnvironment.value?.git
  if (!git?.isRepository || !git.dirty || git.changedFiles <= 0) return undefined
  return {
    changedFiles: git.changedFiles,
    additions: git.additions,
    deletions: git.deletions,
    changes: git.changes ?? [],
    changesTruncated: git.changesTruncated,
  }
})
const continuity = computed(() => codingContinuityPresentation({
  sessionReady: props.sessionReady,
  resumed: props.resumed,
  compacting: props.compacting,
  compactedAt: props.compactedAt,
  running: props.running,
}))
/** Tick so run elapsed labels update while the turn is active. */
const runClockNow = ref(Date.now())
let runClockTimer: number | undefined
watch(
  () => [props.running, props.turnStatus?.runStartedAt] as const,
  ([running, startedAt]) => {
    if (runClockTimer !== undefined) {
      window.clearInterval(runClockTimer)
      runClockTimer = undefined
    }
    if (running && startedAt !== undefined) {
      runClockNow.value = Date.now()
      runClockTimer = window.setInterval(() => {
        runClockNow.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (runClockTimer !== undefined) window.clearInterval(runClockTimer)
})
const effectiveTurnStatus = computed<SessionTurnSnapshot>(() => {
  const base = props.turnStatus ?? { compacting: props.compacting }
  const model = effectiveModelMode.value === 'auto'
    ? automaticModel.value?.model
    : props.modelId || props.settings?.active_model
  const usageModel = base.usage?.model
  const catalog = modelCatalogSnapshot.value
  const catalogWindowFor = (id: string | undefined) => (
    id ? catalog?.models.find(entry => entry.id === id)?.context_window : undefined
  )
  const catalogWindow = catalogWindowFor(model)
    ?? catalogWindowFor(usageModel)
    ?? base.contextWindow
  const contextWindow = resolveModelContextWindow(usageModel || model, catalogWindow)
    || base.contextWindow
  return applySessionContextWindow(
    { ...base, compacting: props.compacting || Boolean(base.compacting) },
    contextWindow,
  )
})
const contextUsagePresentation = computed(() => presentContextUsage(effectiveTurnStatus.value))
const runTimingPresentation = computed(() => (
  presentRunTiming(effectiveTurnStatus.value, runClockNow.value)
))

const effectiveExecutionMode = computed(() => (
  normalizeCodingExecutionMode(props.executionMode)
))
const effectiveApprovalPolicy = computed(() => (
  normalizeCodingApprovalPolicy(props.approvalPolicy)
))
const computerUseOwnedByCurrentTask = computed(() => Boolean(
  computerUseStatus.value?.conversationId
  && computerUseStatus.value.conversationId === props.conversation?.id,
))
const computerUseReadyForCurrentTask = computed(() => Boolean(
  computerUseStatus.value?.enabled
  && computerUseOwnedByCurrentTask.value,
))
const computerUsePermissionsReady = computed(() => Boolean(
  computerUseStatus.value?.permissions.accessibility
  && computerUseStatus.value.permissions.screenRecording,
))
const scopedComputerUseTargets = computed(() => computerUseTargets.value)
const browserUseReadyForCurrentTask = computed(() => Boolean(
  !props.ctfSession
  && props.workspacePath
  && effectiveExecutionMode.value === 'go'
  && effectiveApprovalPolicy.value !== 'read-only',
))
const externalAppUseReadyForCurrentTask = computed(() => Boolean(
  computerUseReadyForCurrentTask.value
  && computerUseStatus.value?.target,
))
const selectedComputerUseTarget = computed(() => (
  resolveSelectedComputerUseTarget(
    scopedComputerUseTargets.value,
    selectedComputerUseTargetKey.value,
  )
))
const codingCapabilities = computed(() => {
  const capabilities = props.conversation?.agentCapabilities?.length
    ? props.conversation.agentCapabilities
    : previewCodingCapabilities(
        effectiveExecutionMode.value,
        effectiveApprovalPolicy.value,
        Boolean(
          props.settings?.providers?.openai?.enabled
          && props.settings.providers.openai.has_api_key,
        ),
      )
  if (!computerUseStatus.value) {
    return capabilities
  }
  const target = computerUseStatus.value?.target
  const selectedTarget = selectedComputerUseTarget.value
  const computerUseCapability = computerUseReadyForCurrentTask.value && target
    ? describeActiveComputerUseCapability(
        effectiveExecutionMode.value,
        effectiveApprovalPolicy.value,
        target,
      )
    : describePendingComputerUseCapability(
        effectiveExecutionMode.value,
        effectiveApprovalPolicy.value,
        target ?? selectedTarget,
        {
          available: Boolean(computerUseStatus.value.available),
          permissionsReady: Boolean(
            computerUseStatus.value.permissions.accessibility
            && computerUseStatus.value.permissions.screenRecording,
          ),
          attachedToOtherTask: Boolean(
            computerUseStatus.value.conversationId
            && !computerUseOwnedByCurrentTask.value,
          ),
          problem: computerUseStatus.value.problem,
        },
      )
  return capabilities.map(capability => capability.id === 'computer-use'
    ? {
        ...capability,
        ...computerUseCapability,
      }
    : capability)
})
const codingPolicyLabel = computed(() => {
  const mode = effectiveExecutionMode.value === 'plan' ? 'Plan' : 'Go'
  const approval = effectiveApprovalPolicy.value === 'read-only'
    ? '只读'
    : effectiveApprovalPolicy.value === 'ask'
      ? '每次询问'
      : effectiveApprovalPolicy.value === 'full-auto'
        ? '完全访问'
        : '项目自动'
  return `${mode} · ${approval}`
})
const topbarPresentation = computed(() => chatTopbarPresentation({
  ctfSession: props.ctfSession,
  vulnerabilitySession: props.vulnerabilitySession,
  conversationTitle: props.conversation?.title,
  workspacePath: props.workspacePath,
  codingPolicyLabel: codingPolicyLabel.value,
  ctfMode: props.ctfMode,
}))
const topbarModule = computed(() => (
  props.ctfSession
    ? 'ctf'
    : props.vulnerabilitySession
      ? 'cve'
      : 'coding'
))
const codingDraftIdle = computed(() => (
  !props.ctfSession
  && !props.vulnerabilitySession
  && !(props.conversation?.messages.length)
))
const approvalMenuLabel = computed(() => (
  effectiveApprovalPolicy.value === 'full-auto'
    ? '完全访问'
    : effectiveApprovalPolicy.value === 'workspace-auto'
      ? '替我审批'
      : effectiveApprovalPolicy.value === 'ask'
        ? '请求批准'
        : '只读'
))
const compactModelLabel = computed(() => {
  const provider = effectiveModelMode.value === 'auto'
    ? automaticModel.value?.provider
    : props.modelProvider || props.settings?.active_provider
  const model = effectiveModelMode.value === 'auto'
    ? automaticModel.value?.model
    : props.modelId || props.settings?.active_model
  if (!provider || !model) {
    return effectiveModelMode.value === 'auto' ? 'Default' : '选择模型'
  }
  const modelName = providerModelLabel(provider, model).split(' · ').at(-1) || model
  return modelName.replace(/^DeepSeek\s+/i, '')
})
const capabilityStatusLabel = (status: string) => (
  status === 'allowed'
    ? '允许'
    : status === 'approval-required'
      ? '需批准'
      : status === 'unavailable'
        ? '未接入'
        : '阻止'
)
const extensionLabel = (value: string) => (
  value === 'milksu-workflow'
    ? 'MilkSU Workflow'
    : value === 'pi-lsp'
      ? 'PI LSP'
      : value === 'pi-goal'
        ? 'PI Goal'
        : value === 'pi-background-tasks'
          ? 'PI Background Tasks'
        : value === 'pi-mcp-adapter'
            ? 'PI MCP Adapter'
            : value === 'pi-sub-agent'
              ? 'PI Sub Agent'
        : value
)
const hasCredential = computed(() => {
  if (!props.settings) return false
  if (props.settings.relay?.enabled && props.settings.relay.has_key) return true
  const provider = props.settings.providers[props.settings.active_provider]
  return Boolean(provider?.enabled && provider.has_api_key)
})
const automaticScratchWorkspace = computed(() => (
  isGeneratedScratchWorkspace(props.workspacePath)
))
const projectMemory = ref<CodingProjectMemory | null>(null)
const gitBranchError = ref('')
const homeDirectory = computed(() => projectMemory.value?.homeDirectory ?? '')
const recentProjects = computed(() => projectMemory.value?.recents ?? [])
const gitBranches = computed(() => codingEnvironment.value?.git.localBranches ?? [])
const gitBranch = computed(() => codingEnvironment.value?.git.branch ?? '')
const gitRepository = computed(() => Boolean(codingEnvironment.value?.git.isRepository))
const workspaceName = computed(() => {
  if (automaticScratchWorkspace.value) return '无项目任务'
  return codingWorkspaceLabel(props.workspacePath, homeDirectory.value)
})
const selectedCodingProjectName = computed(() => {
  if (!shouldRememberCodingProject(props.workspacePath)) return ''
  return codingWorkspaceLabel(props.workspacePath, homeDirectory.value)
})
const codingEmptyHeading = computed(() => {
  const name = selectedCodingProjectName.value
  if (name && name !== '~') return `我们在 ${name} 中构建什么`
  return '我们要构建什么'
})
const terminalConversationId = computed(() => (
  props.conversation?.id || LOCAL_CODING_SHELL_ID
))
const terminalWorkspacePath = computed(() => props.workspacePath || homeDirectory.value)
const codingBrowserEvidencePath = computed(() => {
  const sessionID = codingBrowserStatus.value?.sessionId?.trim()
  return sessionID ? `.milksu/browser-evidence/${sessionID}` : ''
})
const codingBrowserTabs = computed(() => codingBrowserStatus.value?.tabs ?? [])
const codingBrowserPage = computed(() => codingBrowserStatus.value?.pages?.[0] ?? null)
const activeCodingBrowserTab = computed(() => (
  codingBrowserTabs.value.find(tab => tab.active)
  ?? codingBrowserTabs.value[0]
  ?? null
))
const codingBrowserTabTitle = computed(() => (
  activeCodingBrowserTab.value?.title
  || codingBrowserPage.value?.title
  || codingBrowserStatus.value?.initialUrl
  || '新标签页'
))
const workspaceLocked = computed(() => Boolean(props.conversation?.messages.length))
const activeModelLabel = computed(() => {
  if (effectiveModelMode.value === 'auto') return automaticModelLabel.value.replace(/^Default · /, '')
  const provider = props.modelProvider || props.settings?.active_provider
  const model = props.modelId || props.settings?.active_model
  return provider && model ? providerModelLabel(provider, model) : '等待选择'
})
const activeModelSourceLabel = computed(() => (
  props.conversation?.modelSource === 'account'
    ? 'MilkSU 账户'
    : props.conversation?.modelSource === 'personal'
      ? 'TokenFlux 中转站'
      : ''
))

const computerUseOperationEvidence = computed(() => (
  extractLatestComputerUseOperationEvidence(props.conversation?.messages ?? [])
))
const chatTranscript = computed(() => (
  buildChatTranscript(props.conversation?.messages ?? [], props.running)
))
const chatActivityExpansion = ref(new Map<string, ChatActivityExpansionState>())
const emptyActivityExpansion = createChatActivityExpansionState()

function currentActivityExpansion(): ChatActivityExpansionState {
  return chatActivityExpansion.value.get(props.conversation?.id ?? '') ?? emptyActivityExpansion
}

function chatActivityGroupIsOpen(activityId: string): boolean {
  return chatActivityGroupOpen(currentActivityExpansion(), activityId)
}

function chatActivityOpenEntries(activityId: string): ReadonlySet<string> {
  return chatActivityOpenEntryIds(currentActivityExpansion(), activityId)
}

function applyActivityExpansion(next: ChatActivityExpansionState) {
  const conversationId = props.conversation?.id ?? ''
  const states = new Map(chatActivityExpansion.value)
  states.set(conversationId, next)
  chatActivityExpansion.value = states
}

function handleActivityGroupToggle(activityId: string, open: boolean) {
  applyActivityExpansion(setChatActivityGroupOpen(currentActivityExpansion(), activityId, open))
}

function handleActivityEntryToggle(activityId: string, entryId: string, open: boolean) {
  applyActivityExpansion(
    setChatActivityEntryOpen(currentActivityExpansion(), activityId, entryId, open),
  )
}

watch(chatTranscript, blocks => {
  const conversationId = props.conversation?.id ?? ''
  if (!conversationId) return
  const current = chatActivityExpansion.value.get(conversationId)
  if (!current) return
  const pruned = pruneChatActivityExpansion(current, blocks)
  if (pruned !== current) applyActivityExpansion(pruned)
})
const waitingForModel = computed(() => {
  if (!props.running) return false
  const last = chatTranscript.value.at(-1)
  if (!last) return true
  if (last.kind === 'activity') return !last.running
  return last.message.status !== 'running' && last.message.role !== 'assistant'
})
const recoverableFailureId = computed(() => (
  recoverableAgentFailureId(
    props.conversation?.messages ?? [],
    props.running,
  )
))
const latestJudge = computed(() => ctfProjection.value?.judgeReceipts.at(-1))
const domainSessionKind = computed(() => (
  sharedCodingSessionKind(props.ctfSession, Boolean(props.vulnerabilitySession))
))
const contextPanelTitle = computed(() => ({
  domain: props.ctfSession ? 'CTF 领域上下文' : props.vulnerabilitySession ? 'CVE 领域上下文' : '领域上下文',
  environment: props.ctfSession ? '解题环境' : '环境信息',
  changes: '变更',
  artifacts: '产物',
  browser: '浏览器',
  'browser-use': 'Browser Use',
  'computer-use': 'Computer Use',
  collaboration: 'Agent 协作',
  evidence: '证据与 Judge',
})[contextPanel.value])
const transientComputerUsePanel = computed(() => (
  contextPanel.value === 'browser-use' || contextPanel.value === 'computer-use'
))
const ctfRoleLabel = computed(() => {
  if (props.ctfRole === 'tool-builder') return 'Coding Agent 工具工坊'
  if (props.ctfRole === 'strategist') return '策略 Agent 复盘'
  return 'CTF 解题会话'
})
const activeDomainTaskContext = computed<DomainTaskContext | null>(() => {
  const kind = domainSessionKind.value
  if (kind === 'coding') return null
  const attached = props.conversation?.domainTaskContext
  if (kind === 'ctf') {
    const base = attached?.kind === 'ctf'
      ? attached
      : null
    if (!base) return null
    const live = ctfProjection.value
    return refreshCTFDomainTaskContext(base, live ? {
      challengeId: live.challenge?.id,
      challengeTitle: live.challenge?.title,
      materials: live.challenge?.materials,
      // Base grant + approved endpoint scopes; both must stay visible mid-turn.
      sourceScope: live.challenge?.source?.scope ?? null,
      networkScopes: live.networkScopes ?? [],
      evidenceCount: live.evidence?.length,
      artifactCount: live.artifacts?.length,
      judgeReceipts: live.judgeReceipts,
    } : null)
  }
  if (attached?.kind === 'cve') return attached
  return null
})
const domainTaskPresentation = computed(() => {
  const context = activeDomainTaskContext.value
  return context ? presentDomainTaskContext(context) : null
})
const workshopSummary = computed(() => {
  const state = workshopState.value
  if (!state) return '正在读取工具交接状态'
  if (state.pendingCount) return `${state.pendingCount} 个工具请求待实现`
  if (state.readyCount) return `${state.readyCount} 个工具已交付，等待解题 Agent 验收`
  if (state.blockedCount) return `${state.blockedCount} 个工具请求被阻塞`
  if (state.unknownCount) return `${state.unknownCount} 个请求缺少有效状态`
  return state.toolCount
    ? `${state.toolCount} 个本题工具已保存在工作区`
    : '当前没有工具请求'
})
function sendComposerMessage(
  prompt: string,
  visibleText?: string,
  attachments?: CodingAttachment[],
  scopeToken?: 'browser-use' | 'computer-use',
  productAction?: CodingProductActionRequest,
) {
  goalMode.value = false
  if (scopeToken === 'browser-use' && !browserUseReadyForCurrentTask.value) {
    showBrowserUseScope()
    return
  }
  if (scopeToken === 'computer-use' && !externalAppUseReadyForCurrentTask.value) {
    void showComputerUseScope()
    return
  }
  const stagedPrompt = stagedComposerPrompt.value
  const submittedPrompt = stagedPrompt
    && stagedPrompt.conversationId === props.conversation?.id
    && stagedPrompt.prompt !== prompt
    ? `${stagedPrompt.prompt}\n\n用户当前请求：${prompt}`
    : prompt
  stagedComposerPrompt.value = null
  const scopedPrompt = scopeToken === 'browser-use'
    ? `本轮通过 Playwright MCP 官方扩展请求连接真实用户浏览器；首次调用时等我在 Chrome/Edge 里选择并批准准确标签页。只操作扩展返回的标签页，不要改用 MilkSU 内置浏览器或 Computer Use。\n\n${submittedPrompt}`
    : scopeToken === 'computer-use'
      ? `本轮使用已锁定的可见 App 窗口完成请求；若尚未接入准确窗口，先停下让我选择。\n\n${submittedPrompt}`
      : submittedPrompt
  emit('send', scopedPrompt, visibleText, attachments, scopeToken, productAction)
}

function controlComposerGoal(action: 'pause' | 'resume' | 'clear') {
  if (action === 'pause' && props.running) {
    emit('abort')
    return
  }
  emit('controlGoal', action)
}

function resumeAfterFailure() {
  if (props.running || !recoverableFailureId.value) return
  const lastUserMessage = [...(props.conversation?.messages ?? [])]
    .reverse()
    .find(message => message.role === 'user')
  emit(
    'send',
    agentRecoveryPrompt(props.ctfSession),
    '继续',
    lastUserMessage?.attachments,
  )
}

function changeModel(value: string) {
  const parsed = parseComposerModelKey(value)
  if (parsed.mode === 'auto') {
    emit('changeModel', 'auto')
    return
  }
  if (parsed.providerId && parsed.model) {
    // Source preference follows the group the user picked (account vs personal).
    if (parsed.source === 'account' || parsed.source === 'personal') {
      emit('changeModelSource', parsed.source)
    }
    emit('changeModel', 'manual', parsed.providerId, parsed.model)
  }
}

function changeExecutionMode(value: string) {
  const executionMode = normalizeCodingExecutionMode(value)
  emit('changeCodingPolicy', executionMode, effectiveApprovalPolicy.value)
}

function changeApprovalPolicy(value: string) {
  const approvalPolicy = normalizeCodingApprovalPolicy(value)
  emit('changeCodingPolicy', effectiveExecutionMode.value, approvalPolicy)
}

async function refreshMCPConfig() {
  if (props.ctfSession || !props.workspacePath) {
    mcpConfig.value = null
    return
  }
  mcpConfigLoading.value = true
  try {
    const snapshot = await invokeCommand<CodingMCPConfigSnapshot>(
      'get_coding_mcp_config',
      { workspacePath: props.workspacePath },
    )
    mcpConfig.value = snapshot
    if (!selectedMCPServers.value.length) return

    const available = new Set(snapshot.servers.map(server => server.name))
    const selectionIsStale = props.mcpConfigDigest !== snapshot.digest
      || selectedMCPServers.value.some(server => !available.has(server))
    if (selectionIsStale) emit('changeMcpServers', [], '')
  } catch (reason) {
    mcpConfig.value = {
      workspace: props.workspacePath,
      configured: false,
      servers: [],
      problem: reason instanceof Error
        ? reason.message
        : '暂时无法读取项目 MCP 配置。',
    }
    if (selectedMCPServers.value.length) emit('changeMcpServers', [], '')
  } finally {
    mcpConfigLoading.value = false
  }
}

function toggleMCPServer(server: CodingMCPConfigSnapshot['servers'][number]) {
  if (props.running || !mcpConfig.value?.digest || !server.reviewReady) return
  const name = server.name
  const selection = new Set(selectedMCPServers.value)
  if (selection.has(name)) selection.delete(name)
  else selection.add(name)
  emit(
    'changeMcpServers',
    [...selection].sort((left, right) => left.localeCompare(right)),
    mcpConfig.value.digest,
  )
}

function persistContextRailWidth(width: number) {
  contextRailWidth.value = writeCodingRailWidth(width)
}

function persistTerminalHeight(height: number) {
  terminalHeight.value = writeCodingTerminalHeight(height)
}

function startTerminalResize(event: PointerEvent) {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement
  const dock = handle.closest('.coding-terminal-dock')
  if (!dock) return
  event.preventDefault()
  handle.setPointerCapture(event.pointerId)
  const startY = event.clientY
  const startHeight = dock.getBoundingClientRect().height

  function onMove(move: PointerEvent) {
    persistTerminalHeight(clampCodingTerminalHeight(startHeight + (startY - move.clientY)))
  }
  function onUp(up: PointerEvent) {
    handle.releasePointerCapture(up.pointerId)
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
}

function showCodingPermissions() {
  contextPanel.value = 'environment'
  environmentOpen.value = true
}

function toggleManualContextSidebar() {
  if (environmentOpen.value) {
    environmentOpen.value = false
    return
  }
  contextPanel.value = 'browser'
  environmentOpen.value = true
}

function toggleTerminalPanel() {
  terminalOpen.value = !terminalOpen.value
}

function showBrowserUseScope() {
  contextPanel.value = 'browser-use'
  environmentOpen.value = true
}

async function showComputerUseScope() {
  contextPanel.value = 'computer-use'
  environmentOpen.value = true
  await refreshBrowserPanel()
  if (computerUseStatus.value?.available && !computerUsePermissionsReady.value) {
    computerUsePermissionError.value = ''
    computerUsePermissionDialogOpen.value = true
    return
  }
  await continueComputerUseScope()
}

async function continueComputerUseScope() {
  selectedComputerUseTargetKey.value = nextComputerUseTargetKey(
    scopedComputerUseTargets.value,
    selectedComputerUseTargetKey.value,
    computerUseStatus.value?.conversationId
      ? computerUseStatus.value.target
      : computerUseStatus.value?.grantedTarget,
    {
      hostBundleId: computerUseStatus.value?.signing?.bundleId,
    },
  )
  const status = computerUseStatus.value
  const canStartOnlyVisibleTarget = Boolean(
    status?.available
    && computerUsePermissionsReady.value
    && !status.enabled
    && !status.conversationId
    && scopedComputerUseTargets.value.length === 1,
  )
  if (canStartOnlyVisibleTarget) {
    selectedComputerUseTargetKey.value = computerUseTargetKey(
      scopedComputerUseTargets.value[0],
    )
    await startComputerUse()
  }
}

async function openPlaywrightBrowserExtension() {
  browserPanelError.value = ''
  try {
    await invokeCommand('open_playwright_browser_extension')
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '无法打开 Playwright MCP 官方扩展页面。'
  }
}

function runSlashCommand(command: string) {
  if (command === 'new') {
    emit('newConversation')
    return
  }
  if (command === 'compact') {
    emit('compactContext')
    return
  }
  if (['understand', 'test', 'review', 'fix', 'summary'].includes(command)) {
    void runCodingProductAction(command as CodingProductActionKind)
    return
  }
  if (command === 'browser') {
    revealBuiltInBrowser()
    return
  }
  if (command === 'browser-use') {
    showBrowserUseScope()
    return
  }
  if (command === 'computer-use') {
    void showComputerUseScope()
    return
  }

  const panel = ({
    status: 'environment',
    diff: 'changes',
    mcp: 'environment',
  } as const)[command as 'status' | 'diff' | 'mcp']
  if (panel) changeContextPanel(panel)
}

function chooseWorkspaceFromCurrentTask() {
  if (workspaceLocked.value) {
    emit('chooseWorkspaceForNewTask')
    return
  }
  emit('chooseWorkspace')
}

async function loadProjectMemory() {
  try {
    projectMemory.value = await invokeCommand<CodingProjectMemory>('get_coding_project_memory')
  } catch {
    // New-chat recents stay empty until Desktop RPC is available.
  }
}

function selectRecentProject(path: string) {
  const next = path.trim()
  if (!next) return
  emit('selectWorkspace', next)
}

async function forgetRecentProject(path: string) {
  try {
    projectMemory.value = await invokeCommand<CodingProjectMemory>('forget_coding_project', { path })
  } catch {
    await loadProjectMemory()
  }
  emit('forgetWorkspace', path)
}

async function checkoutGitBranch(branch: string) {
  const workspace = props.workspacePath
  const next = branch.trim()
  if (!workspace || !next || next === gitBranch.value || props.running) return
  gitBranchError.value = ''
  try {
    const result = await invokeCommand<CodingGitActionResult>('apply_coding_git_action', {
      workspacePath: workspace,
      action: 'checkout',
      relativePath: next,
      message: '',
    })
    if (result?.snapshot) codingEnvironment.value = result.snapshot
    else await refreshEnvironment()
  } catch (reason) {
    gitBranchError.value = reason instanceof Error ? reason.message : '无法切换分支。'
  }
}

async function runCodingProductAction(kind: CodingProductActionKind) {
  if (!props.workspacePath) {
    emit('chooseWorkspace')
    return
  }
  if (props.running) return
  const action = codingProductAction(kind)
  contextPanel.value = action.panel
  environmentOpen.value = true
  emit(
    'changeCodingPolicy',
    action.executionMode,
    action.approvalPolicy ?? effectiveApprovalPolicy.value,
  )
  let prompt = action.prompt
  if (kind === 'review') {
    await refreshEnvironment()
    const environment = codingEnvironment.value
    if (!environment?.git.isRepository) {
      environmentError.value = environment?.git.problem
        || '当前目录不是 Git 仓库，无法审阅变更。'
      return
    }
    const changes = environment.git.changes ?? []
    const diffResults = await Promise.allSettled(
      changes.slice(0, 20).map(change => invokeCommand<CodingDiffSnapshot>(
        'get_coding_diff',
        {
          workspacePath: props.workspacePath,
          relativePath: change.path,
        },
      )),
    )
    const diffs = diffResults.flatMap(result => (
      result.status === 'fulfilled' ? [result.value] : []
    ))
    prompt = codingReviewPrompt(prompt, environment, diffs)
  }
  emit('send', prompt, action.visibleText, undefined, undefined, { kind })
}

async function loadWorkshopState() {
  const jobId = props.conversation?.ctfJobId
  if (!props.ctfSession || !jobId || props.ctfRole === 'strategist') {
    workshopState.value = null
    return
  }
  try {
    workshopState.value = await invokeCommand<CTFToolWorkshopState>(
      'get_ctf_tool_workshop_state',
      { id: jobId },
    )
  } catch {
    workshopState.value = null
  }
}

/**
 * Read-only CTF domain projection for the shared session panel.
 * Must run regardless of Agent running state so exact challenge id/title,
 * materials, authorized network scopes and Judge/evidence stay visible while
 * the turn is in progress. Does not refresh workshop/coding environment UI.
 */
async function loadCTFDomainProjection() {
  if (!props.ctfSession) {
    ctfProjection.value = null
    return
  }
  const jobId = props.conversation?.ctfJobId
  if (!jobId) {
    ctfProjection.value = null
    return
  }
  try {
    ctfProjection.value = await invokeCommand<CTFProjection>('get_ctf_job', { id: jobId })
  } catch {
    // Keep the last successful projection if a mid-turn read fails.
  }
}

async function refreshEnvironment() {
  environmentError.value = ''
  if (props.ctfSession) {
    codingEnvironment.value = null
    const jobId = props.conversation?.ctfJobId
    if (!jobId) {
      ctfBudget.value = null
      ctfCheckpoint.value = null
      ctfProjection.value = null
      return
    }
    environmentLoading.value = true
    const [budget, checkpoint] = await Promise.allSettled([
      invokeCommand<CTFAgentBudgetStatus>('get_ctf_agent_budget_status', { id: jobId }),
      invokeCommand<CTFAgentRunCheckpoint | null>('get_ctf_agent_run_checkpoint', { id: jobId }),
    ])
    // Domain projection is owned by loadCTFDomainProjection (running-agnostic).
    await loadCTFDomainProjection()
    ctfBudget.value = budget.status === 'fulfilled' ? budget.value : null
    ctfCheckpoint.value = checkpoint.status === 'fulfilled' ? checkpoint.value : null
    if (
      [budget, checkpoint].every(result => result.status === 'rejected')
      && !ctfProjection.value
    ) {
      environmentError.value = '暂时无法读取解题环境。'
    }
    environmentLoading.value = false
    return
  }

  ctfBudget.value = null
  ctfCheckpoint.value = null
  ctfProjection.value = null
  if (!props.workspacePath) {
    codingEnvironment.value = null
    return
  }
  environmentLoading.value = true
  try {
    codingEnvironment.value = await invokeCommand<CodingEnvironmentSnapshot>(
      'get_coding_environment',
      { workspacePath: props.workspacePath },
    )
  } catch (reason) {
    codingEnvironment.value = null
    environmentError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取项目环境。'
  } finally {
    environmentLoading.value = false
  }
}

async function refreshBrowserPanel() {
  browserPanelError.value = ''
  if (codingBrowserLoading.value || computerUseLoading.value) return
  codingBrowserLoading.value = true
  computerUseLoading.value = true
  const conversationID = props.conversation?.id
  const [browser, computerUse, computerUseTargetsResult] = await Promise.allSettled([
    conversationID
      ? invokeCommand<CodingBrowserStatus>(
          'get_coding_browser_status',
          { conversationId: conversationID },
        )
      : Promise.resolve<CodingBrowserStatus>({
          enabled: false,
          conversationId: '',
          phase: 'disabled',
          pages: [],
        }),
    conversationID
      ? invokeCommand<CodingComputerUseStatus>('activate_coding_computer_use', {
          conversationId: conversationID,
        })
      : invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status'),
    invokeCommand<CodingComputerUseTarget[]>('list_coding_computer_use_targets'),
  ])
  if (browser.status === 'fulfilled') {
    codingBrowserStatus.value = browser.value
    if (codingBrowserStatus.value.initialUrl) {
      codingBrowserURL.value = codingBrowserStatus.value.initialUrl
    }
  } else {
    codingBrowserStatus.value = null
    browserPanelError.value = browser.reason instanceof Error
      ? browser.reason.message
      : '暂时无法读取浏览器状态。'
  }
  if (computerUse.status === 'fulfilled') {
    computerUseStatus.value = computerUse.value
  } else {
    computerUseStatus.value = null
    if (!browserPanelError.value) {
      browserPanelError.value = computerUse.reason instanceof Error
        ? computerUse.reason.message
        : '暂时无法读取 Computer Use 状态。'
    }
  }
  if (computerUseTargetsResult.status === 'fulfilled') {
    computerUseTargets.value = computerUseTargetsResult.value
    selectedComputerUseTargetKey.value = nextComputerUseTargetKey(
      scopedComputerUseTargets.value,
      selectedComputerUseTargetKey.value,
      computerUseStatus.value?.conversationId
        ? computerUseStatus.value.target
        : computerUseStatus.value?.grantedTarget,
      {
        hostBundleId: computerUseStatus.value?.signing?.bundleId,
      },
    )
  } else {
    computerUseTargets.value = []
    if (!browserPanelError.value) {
      browserPanelError.value = computerUseTargetsResult.reason instanceof Error
        ? computerUseTargetsResult.reason.message
        : '暂时无法读取可见 App 窗口。'
    }
  }
  codingBrowserLoading.value = false
  computerUseLoading.value = false
}

function applyCodingBrowserAddress(status: CodingBrowserStatus | null | undefined) {
  if (document.activeElement?.getAttribute('aria-label') === '浏览器地址') return
  codingBrowserURL.value = codingBrowserAddressFromStatus(status)
}

async function ensureCodingBrowser() {
  const conversationID = props.conversation?.id
  if (!conversationID) return
  if (codingBrowserStatus.value?.enabled) {
    await refreshCodingBrowserState()
    return
  }
  codingBrowserLoading.value = true
  browserPanelError.value = ''
  try {
    codingBrowserStatus.value = await invokeCommand<CodingBrowserStatus>(
      'ensure_coding_browser',
      { conversationId: conversationID },
    )
    await refreshCodingBrowserState()
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '浏览器启动失败。'
  } finally {
    codingBrowserLoading.value = false
  }
}

function revealBuiltInBrowser() {
  contextPanel.value = 'browser'
  environmentOpen.value = true
  void ensureCodingBrowser()
}

function applyWorkspaceReveal(payload?: {
  conversationId?: string
  panel?: string
  artifactPath?: string
  changePath?: string
  terminal?: string
}) {
  if (payload?.conversationId && payload.conversationId !== props.conversation?.id) return
  const panel = payload?.panel
  if (panel === 'browser' || panel === 'artifacts' || panel === 'changes' || panel === 'environment') {
    contextPanel.value = panel
    environmentOpen.value = true
  }
  if (payload?.artifactPath) {
    requestedArtifactPath.value = payload.artifactPath
  }
  if (payload?.changePath) {
    changesFocusPath.value = payload.changePath
    contextPanel.value = 'changes'
    environmentOpen.value = true
  }
  if (payload?.terminal === 'open') terminalOpen.value = true
  if (payload?.terminal === 'close') terminalOpen.value = false
  if (panel === 'browser') void refreshCodingBrowserState()
}

async function startCodingBrowser() {
  browserPanelError.value = ''
  let initialURL = ''
  try {
    initialURL = normalizeCodingBrowserAddress(codingBrowserURL.value)
    codingBrowserURL.value = initialURL
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : '无法识别这个地址。'
    return
  }
  const workspaceName = props.workspacePath
    .replace(/\/+$/, '')
    .split('/')
    .at(-1)
  const conversationID = props.ensureConversation(
    workspaceName ? `${workspaceName} · 浏览器` : '浏览器',
  )
  codingBrowserLoading.value = true
  try {
    codingBrowserStatus.value = await invokeCommand<CodingBrowserStatus>(
      'start_coding_browser',
      { conversationId: conversationID, initialUrl: initialURL },
    )
    codingBrowserEvidenceError.value = ''
    codingBrowserEvidenceRevealed.value = false
    browserEvidence.value = null
    const pageURL = codingBrowserStatus.value.pages?.[0]?.url
    if (pageURL) codingBrowserURL.value = pageURL
    await nextTick()
    await syncCodingBrowserViewport()
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '浏览器启动失败。'
  } finally {
    codingBrowserLoading.value = false
  }
}

async function stopCodingBrowser() {
  const conversationID = props.conversation?.id
  if (!conversationID) return
  browserPanelError.value = ''
  codingBrowserLoading.value = true
  try {
    await hideCodingBrowserViewport(conversationID)
    codingBrowserStatus.value = await invokeCommand<CodingBrowserStatus>(
      'stop_coding_browser',
      { conversationId: conversationID },
    )
    codingBrowserEvidenceError.value = ''
    codingBrowserEvidenceRevealed.value = false
    browserEvidence.value = null
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '浏览器停止失败。'
  } finally {
    codingBrowserLoading.value = false
  }
}

async function navigateCodingBrowser() {
  let initialURL = ''
  try {
    initialURL = normalizeCodingBrowserAddress(codingBrowserURL.value)
    codingBrowserURL.value = initialURL
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : '无法识别这个地址。'
    return
  }
  if (!codingBrowserStatus.value?.enabled) {
    await startCodingBrowser()
    return
  }
  const conversationID = props.conversation?.id
  if (!conversationID) return
  browserPanelError.value = ''
  codingBrowserLoading.value = true
  try {
    await invokeCommand('navigate_coding_browser', {
      conversationId: conversationID,
      targetUrl: initialURL,
    })
    window.setTimeout(() => void refreshCodingBrowserState(), 250)
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '页面导航失败。'
  } finally {
    codingBrowserLoading.value = false
  }
}

async function mutateCodingBrowserTab(
  command: 'create_coding_browser_tab' | 'activate_coding_browser_tab' | 'close_coding_browser_tab',
  payload: Record<string, string> = {},
) {
  const conversationID = props.conversation?.id
  if (!conversationID || !codingBrowserStatus.value?.enabled) return
  browserPanelError.value = ''
  try {
    codingBrowserStatus.value = await invokeCommand<CodingBrowserStatus>(command, {
      conversationId: conversationID,
      ...payload,
    })
    lastCodingBrowserViewport = ''
    applyCodingBrowserAddress(codingBrowserStatus.value)
    await refreshCodingBrowserState()
    await syncCodingBrowserViewport()
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '标签页操作失败。'
  }
}

async function createCodingBrowserTab() {
  if (!codingBrowserStatus.value?.enabled) {
    await ensureCodingBrowser()
    return
  }
  await mutateCodingBrowserTab('create_coding_browser_tab')
}

async function activateCodingBrowserTab(tabId: string) {
  await mutateCodingBrowserTab('activate_coding_browser_tab', { tabId })
}

async function closeCodingBrowserTab(tabId: string) {
  if (codingBrowserTabs.value.length <= 1) {
    await stopCodingBrowser()
    return
  }
  await mutateCodingBrowserTab('close_coding_browser_tab', { tabId })
}

async function runCodingBrowserNavigation(action: 'back' | 'forward' | 'reload') {
  const conversationID = props.conversation?.id
  if (!conversationID || !codingBrowserStatus.value?.enabled) return
  browserPanelError.value = ''
  try {
    await invokeCommand({
      back: 'coding_browser_go_back',
      forward: 'coding_browser_go_forward',
      reload: 'reload_coding_browser',
    }[action], { conversationId: conversationID })
    window.setTimeout(() => void refreshCodingBrowserState(), 180)
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '浏览器操作失败。'
  }
}

let codingBrowserResizeObserver: ResizeObserver | null = null
let codingBrowserStatusTimer = 0
let lastCodingBrowserViewport = ''
let stopBrowserReady: (() => void) | undefined
let stopWorkspaceReveal: (() => void) | undefined

async function syncCodingBrowserViewport() {
  const conversationID = props.conversation?.id
  const viewport = codingBrowserViewport.value
  const visible = Boolean(
    environmentOpen.value
    && contextPanel.value === 'browser'
    && codingBrowserStatus.value?.enabled
    && viewport,
  )
  if (!conversationID || !codingBrowserStatus.value?.enabled || !viewport) return
  const rect = viewport.getBoundingClientRect()
  const geometry = {
    conversationId: conversationID,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    visible,
  }
  const key = codingBrowserViewportSyncKey(
    geometry,
    codingBrowserStatus.value.activeTabId
      || codingBrowserStatus.value.tabs?.find(tab => tab.active)?.id
      || '',
  )
  if (key === lastCodingBrowserViewport) return
  lastCodingBrowserViewport = key
  try {
    await invokeCommand('set_coding_browser_viewport', geometry)
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '无法放置内嵌浏览器。'
  }
}

async function hideCodingBrowserViewport(conversationID = props.conversation?.id ?? '') {
  if (!conversationID || !codingBrowserStatus.value?.enabled) return
  lastCodingBrowserViewport = ''
  try {
    await invokeCommand('set_coding_browser_viewport', {
      conversationId: conversationID,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      visible: false,
    })
  } catch {
    // The native view may already have been disposed with its conversation.
  }
}

async function refreshCodingBrowserState() {
  const conversationID = props.conversation?.id
  if (!conversationID || !codingBrowserStatus.value?.enabled) return
  try {
    const status = await invokeCommand<CodingBrowserStatus>(
      'get_coding_browser_status',
      { conversationId: conversationID },
    )
    codingBrowserStatus.value = status
    applyCodingBrowserAddress(status)
    await syncCodingBrowserViewport()
  } catch {
    // The regular panel refresh reports actionable errors; polling stays quiet.
  }
}

async function revealCodingBrowserEvidence() {
  const conversationID = props.conversation?.id
  if (!conversationID) {
    codingBrowserEvidenceError.value = '当前会话尚未就绪，无法定位浏览器证据。'
    return
  }
  // Only the trusted conversation id leaves the frontend: the backend derives
  // the exact evidence directory from the live Coding Browser session and its
  // trusted project or fixed temporary workspace.
  codingBrowserEvidenceError.value = ''
  codingBrowserEvidenceRevealed.value = false
  codingBrowserEvidenceLoading.value = true
  try {
    await invokeCommand('reveal_coding_browser_evidence', {
      conversationId: conversationID,
    })
    codingBrowserEvidenceRevealed.value = true
    browserEvidence.value = codingBrowserEvidencePath.value
      ? { path: codingBrowserEvidencePath.value }
      : null
  } catch (reason) {
    codingBrowserEvidenceError.value = reason instanceof Error
      ? reason.message
      : '无法在 Finder 中显示浏览器证据。'
  } finally {
    codingBrowserEvidenceLoading.value = false
  }
}

async function requestComputerUsePermissions(permission: CodingComputerUsePermission) {
  browserPanelError.value = ''
  computerUsePermissionError.value = ''
  computerUsePermissionDialogOpen.value = true
  computerUsePermissionRequesting.value = permission
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
      'request_coding_computer_use_permissions',
      { permission },
    )
  } catch (reason) {
    computerUsePermissionError.value = reason instanceof Error
      ? reason.message
      : '无法请求 MilkSU 的系统权限。'
  } finally {
    computerUsePermissionRequesting.value = null
  }
}

async function pollComputerUsePermissions() {
  if (!computerUsePermissionDialogOpen.value || computerUsePermissionPolling.value) return
  computerUsePermissionPolling.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
      'get_coding_computer_use_status',
    )
    computerUsePermissionError.value = ''
  } catch (reason) {
    computerUsePermissionError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取 Computer Use 权限状态。'
  } finally {
    computerUsePermissionPolling.value = false
  }
}

async function handleComputerUsePermissionComplete() {
  if (computerUsePermissionCompleting.value) return
  computerUsePermissionCompleting.value = true
  computerUsePermissionDialogOpen.value = false
  try {
    await refreshBrowserPanel()
    await continueComputerUseScope()
  } finally {
    computerUsePermissionCompleting.value = false
  }
}

async function startComputerUse() {
  browserPanelError.value = ''
  const target = selectedComputerUseTarget.value
  if (!target) {
    browserPanelError.value = '请先选择一个当前可见的 App 窗口。'
    return
  }
  const workspaceName = props.workspacePath
    .replace(/\/+$/, '')
    .split('/')
    .at(-1)
  const conversationID = props.ensureConversation(
    workspaceName ? `${workspaceName} · ${target.name}` : `${target.name} 可见会话`,
  )
  computerUseLoading.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
      'start_coding_computer_use',
      computerUseStartArgs(conversationID, target),
    )
    if (computerUseStatus.value.enabled && computerUseStatus.value.target) {
      computerUseEvidence.value = {
        name: computerUseStatus.value.target.name,
        bundleId: computerUseStatus.value.target.bundleId,
        pid: computerUseStatus.value.target.pid,
        windowId: computerUseStatus.value.target.windowId,
        windowTitle: computerUseStatus.value.target.windowTitle,
      }
    }
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : 'Computer Use 可见会话启动失败。'
  } finally {
    computerUseLoading.value = false
  }
  await refreshBrowserPanel()
}

async function stopComputerUse() {
  const conversationID = props.conversation?.id
  if (!conversationID || !computerUseOwnedByCurrentTask.value) return
  browserPanelError.value = ''
  computerUseLoading.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
      'stop_coding_computer_use',
      { conversationId: conversationID },
    )
    computerUseEvidence.value = null
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : 'Computer Use 可见会话停止失败。'
  } finally {
    computerUseLoading.value = false
  }
}

async function refreshContextPanel() {
  if (contextPanel.value === 'artifacts') {
    await artifactPanel.value?.refresh()
    return
  }
  if (['browser', 'computer-use'].includes(contextPanel.value)) {
    await refreshBrowserPanel()
    return
  }
  await Promise.all([
    refreshEnvironment(),
    loadWorkshopState(),
    ...(props.ctfSession ? [] : [refreshMCPConfig()]),
  ])
}

function changeContextPanel(value: string) {
  if (!contextPanelValues.some(panel => panel === value)) return
  if (value === 'collaboration' && !props.ctfSession) return
  contextPanel.value = value as ContextPanel
  environmentOpen.value = true
  void refreshContextPanel()
}

function openChanges(path = '') {
  changesFocusPath.value = path
  changeContextPanel('changes')
}


function recordArtifactPreview(preview: CodingArtifactPreview) {
  artifactPreviewEvidence.value = {
    relativePath: preview.relativePath,
    kind: preview.kind,
  }
}

function requestTool() {
  emit('ctfAction', {
    kind: 'handoff',
    prompt: '检查 notes.md 当前真正的阻塞点。如果确实需要一个可重复使用的辅助工具，请按 TOOLING.md 在 work/tool-requests/ 新建一个 status: pending 的最小请求，写清单一假设、输入输出契约、验收条件、fixture 和安全边界；这一步只写请求，不实现工具。若一次性命令已足够，请说明为什么不需要委托 Coding Agent。',
  })
}

function verifyDeliveredTool() {
  emit('ctfAction', {
    kind: 'handoff',
    prompt: '读取 work/tool-requests/ 中最新的 ready 请求和对应的 work/tools/ 实现。不要相信交付声明本身：独立运行验收测试，用当前题目材料验证输出契约，把命令、关键输出、结论和限制写入 notes.md，再决定是否把工具用于下一步解题。',
  })
}

function handleChatScroll() {
  const element = scrollArea.value
  if (!element) return
  chatAutoScrollPinned.value = nextChatAutoScrollPinned(
    lastChatScrollTop.value,
    element.scrollTop,
    element.clientHeight,
    element.scrollHeight,
  )
  lastChatScrollTop.value = element.scrollTop
}

async function scrollChatToBottom(force = false) {
  if (!force && !chatAutoScrollPinned.value) return
  await nextTick()
  if (!force && !chatAutoScrollPinned.value) return
  const element = scrollArea.value
  if (!element) return
  element.scrollTop = element.scrollHeight
  lastChatScrollTop.value = element.scrollTop
  if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    if (!force && !chatAutoScrollPinned.value) return
    if (scrollArea.value) {
      scrollArea.value.scrollTop = scrollArea.value.scrollHeight
      lastChatScrollTop.value = scrollArea.value.scrollTop
    }
  }
}

onMounted(() => {
  void loadProjectMemory()
  void scrollChatToBottom(true)
  if (props.conversation?.id && !props.running) void refreshBrowserPanel()
  window.addEventListener('focus', refreshComputerUseAfterSettings)
  void listenEvent<CodingBrowserStatus>('coding-browser.ready', event => {
    const status = event.payload
    if (status?.conversationId && status.conversationId !== props.conversation?.id) return
    if (status?.enabled) codingBrowserStatus.value = status
    revealBuiltInBrowser()
  }).then(stop => {
    stopBrowserReady = stop
  })
  void listenEvent<{
    conversationId?: string
    panel?: string
    artifactPath?: string
    changePath?: string
    terminal?: string
  }>('coding-workspace.reveal', event => {
    applyWorkspaceReveal(event.payload)
  }).then(stop => {
    stopWorkspaceReveal = stop
  })
  if (typeof ResizeObserver !== 'undefined') {
    codingBrowserResizeObserver = new ResizeObserver(() => {
      lastCodingBrowserViewport = ''
      void syncCodingBrowserViewport()
    })
  }
  codingBrowserStatusTimer = window.setInterval(() => {
    if (environmentOpen.value && contextPanel.value === 'browser') {
      void refreshCodingBrowserState()
    }
  }, 750)
})

onBeforeUnmount(() => {
  stopBrowserReady?.()
  stopWorkspaceReveal?.()
  void hideCodingBrowserViewport()
  window.removeEventListener('focus', refreshComputerUseAfterSettings)
  codingBrowserResizeObserver?.disconnect()
  if (codingBrowserStatusTimer) window.clearInterval(codingBrowserStatusTimer)
})

function refreshComputerUseAfterSettings() {
  if (computerUsePermissionDialogOpen.value) {
    void pollComputerUsePermissions()
    return
  }
  if (!computerUseStatus.value || (
    computerUseStatus.value.permissions.accessibility
    && computerUseStatus.value.permissions.screenRecording
  )) return
  void refreshBrowserPanel()
}

watch(codingBrowserViewport, (current, previous) => {
  if (previous) codingBrowserResizeObserver?.unobserve(previous)
  if (current) {
    codingBrowserResizeObserver?.observe(current)
    lastCodingBrowserViewport = ''
    void syncCodingBrowserViewport()
  }
})

watch(environmentOpen, open => {
  if (open && contextPanel.value === 'browser') {
    void nextTick(() => syncCodingBrowserViewport())
  } else {
    void hideCodingBrowserViewport()
  }
})

watch(() => props.conversation?.messages.length, () => {
  void scrollChatToBottom()
})
watch(
  () => [props.ctfSession, props.vulnerabilitySession] as const,
  ([ctf, vuln]) => {
    environmentOpen.value = true
    domainContextCollapsed.value = false
    if (ctf || vuln) contextPanel.value = 'domain'
    else if (contextPanel.value === 'domain') contextPanel.value = 'environment'
  },
)
watch(
  () => props.pendingComposerDraft,
  draft => {
    if (!draft?.prompt) return
    // Stage unsent draft only — never emit send / start tools / network.
    void nextTick(() => {
      stagedComposerPrompt.value = {
        conversationId: props.conversation?.id ?? '',
        prompt: draft.prompt,
      }
      composer.value?.appendDraftText(draft.visibleText || draft.prompt)
      emit('consumePendingDraft')
    })
  },
  { immediate: true },
)
watch(() => props.conversation?.id, (_current, previous) => {
  if (previous && codingBrowserStatus.value?.enabled) {
    void hideCodingBrowserViewport(previous)
  }
  goalMode.value = false
  codingBrowserStatus.value = null
  codingBrowserEvidenceError.value = ''
  codingBrowserEvidenceRevealed.value = false
  artifactPreviewEvidence.value = null
  browserEvidence.value = null
  computerUseEvidence.value = null
  computerUsePermissionDialogOpen.value = false
  computerUsePermissionRequesting.value = null
  computerUsePermissionError.value = ''
  chatAutoScrollPinned.value = true
  lastChatScrollTop.value = 0
  void scrollChatToBottom(true)
  if (props.conversation?.id && !props.running) void refreshBrowserPanel()
  if (['browser', 'browser-use', 'computer-use'].includes(contextPanel.value) && environmentOpen.value) {
    void refreshBrowserPanel()
  }
})
watch(
  () => [
    props.conversation?.id,
    props.conversation?.messages.length ?? 0,
    props.ctfSession,
    props.vulnerabilitySession,
  ] as const,
  () => {
    void scrollChatToBottom()
  },
)
watch(
  () => [props.ctfSession, props.workspacePath] as const,
  () => void refreshMCPConfig(),
  { immediate: true },
)
watch(
  () => props.workspacePath,
  path => {
    if (!shouldRememberCodingProject(path)) return
    void invokeCommand<CodingProjectMemory>('remember_coding_project', { path })
      .then(memory => {
        projectMemory.value = memory
      })
      .catch(() => undefined)
  },
  { immediate: true },
)
watch(contextPanel, (panel, previous) => {
  if (previous === 'browser' && panel !== 'browser') void hideCodingBrowserViewport()
  if (['browser', 'browser-use', 'computer-use'].includes(panel) && environmentOpen.value) {
    void refreshBrowserPanel()
  }
  if (['artifacts', 'changes'].includes(panel) && environmentOpen.value) void refreshEnvironment()
  if (panel === 'browser' && environmentOpen.value) {
    void ensureCodingBrowser().then(() => nextTick(() => syncCodingBrowserViewport()))
  }
})
// Domain panel projection: conversation/job change only. Independent of running.
watch(
  () => [props.ctfSession, props.conversation?.ctfJobId] as const,
  async ([ctfSession, jobId]) => {
    if (ctfSession && jobId) {
      await loadCTFDomainProjection()
      return
    }
    if (!ctfSession) ctfProjection.value = null
  },
  { immediate: true },
)
watch(
  () => [props.ctfSession, props.conversation?.ctfJobId, props.ctfRole, props.running] as const,
  async ([ctfSession, jobId, _role, running]) => {
    // Workshop / budget / checkpoint stay idle-path only; domain projection is above.
    if (ctfSession && jobId && !running) {
      await Promise.all([loadWorkshopState(), refreshEnvironment()])
    }
  },
  { immediate: true },
)
watch(
  () => [
    props.ctfSession,
    props.conversation?.id,
    props.workspacePath,
    props.running,
  ] as const,
  async ([_ctfSession, _conversationId, _workspacePath, running]) => {
    if (!running) {
      await refreshEnvironment()
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-editor">
  <div class="coding-workspace relative flex min-h-0 flex-1 overflow-hidden">
  <main class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-editor">
    <WorkspaceModuleTopBar
      v-if="!contextRailVisible"
      :module="topbarModule"
      :title="topbarPresentation.title"
      :subtitle="topbarPresentation.subtitle"
      :hide-identity="codingDraftIdle"
    >
      <template v-if="!conversationDrawerOpen" #leading>
        <!--
          Collapsed history: the same two icons that sat in the sidebar header
          park on the topbar leading edge so expand/new feel continuous.
        -->
        <div class="coding-history-collapsed-controls app-no-drag flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            class="app-no-drag"
            data-testid="coding-history-toggle"
            aria-label="展开会话历史"
            title="展开会话历史"
            :aria-expanded="false"
            aria-controls="coding-context-sidebar"
            @click="$emit('toggleConversationDrawer')"
          >
            <PanelLeftOpen class="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="app-no-drag"
            data-testid="coding-new-task-button"
            aria-label="新建编码任务"
            title="新建编码任务"
            @click="$emit('newConversation')"
          >
            <MessageSquarePlus class="size-4" />
          </Button>
        </div>
      </template>
      <template v-if="ctfSession || vulnerabilitySession" #badge>
        <Badge variant="secondary" class="max-w-full truncate">
          {{ ctfSession ? ctfRoleLabel : 'CVE 接力' }}
        </Badge>
      </template>
      <template #actions>
        <Button
          v-if="domainTaskPresentation"
          variant="ghost"
          size="sm"
          :aria-label="domainTaskPresentation.returnAriaLabel"
          @click="domainTaskPresentation.kind === 'ctf' ? $emit('returnCtf') : $emit('returnVuln')"
        >
          <Flag v-if="domainTaskPresentation.kind === 'ctf'" class="size-4" />
          <ShieldCheck v-else class="size-4" />
          {{ domainTaskPresentation.returnLabel }}
        </Button>
        <Button
          v-if="!ctfSession"
          variant="ghost"
          size="icon-sm"
          :aria-label="terminalOpen ? '关闭底部终端' : '打开底部终端'"
          :title="terminalOpen ? '关闭底部终端' : '打开底部终端'"
          @click="toggleTerminalPanel"
        >
          <SquareTerminal class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="coding-rail-toggle"
          aria-label="打开右侧栏"
          title="打开右侧栏"
          @click="toggleManualContextSidebar"
        >
          <PanelRightOpen class="size-4" />
        </Button>
      </template>
    </WorkspaceModuleTopBar>
    <div
      v-else-if="!conversationDrawerOpen"
      class="coding-history-collapsed-controls app-drag flex items-center gap-1.5 px-3 py-2"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        class="app-no-drag"
        data-testid="coding-history-toggle"
        aria-label="展开会话历史"
        title="展开会话历史"
        :aria-expanded="false"
        aria-controls="coding-context-sidebar"
        @click="$emit('toggleConversationDrawer')"
      >
        <PanelLeftOpen class="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="app-no-drag"
        data-testid="coding-new-task-button"
        aria-label="新建编码任务"
        title="新建编码任务"
        @click="$emit('newConversation')"
      >
        <MessageSquarePlus class="size-4" />
      </Button>
    </div>

    <div
      ref="scrollArea"
      class="min-h-0 flex-1 overflow-y-auto"
      @scroll.passive="handleChatScroll"
    >
      <div v-if="!conversation?.messages.length && domainTaskPresentation" class="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center px-5 py-5 2xl:px-8">
        <MissionOperationPanel :presentation="domainTaskPresentation" :running="running" />
        <div class="mt-4 flex items-center gap-2">
          <Button v-if="!workspacePath" class="tactical-action" @click="$emit('chooseWorkspace')">
            <FolderOpen class="size-4" />
            选择项目目录
          </Button>
          <Badge v-else variant="outline" class="max-w-md truncate">任务工作区已就绪</Badge>
          <Button v-if="!hasCredential" variant="outline" @click="$emit('openSettings')">
            <KeyRound class="size-4" />
            配置模型
          </Button>
        </div>
      </div>
      <div
        v-else-if="!conversation?.messages.length"
        class="flex min-h-full flex-col items-center justify-center px-8"
      >
        <h1 class="text-center text-2xl font-medium tracking-tight text-foreground">
          {{ codingEmptyHeading }}
        </h1>
        <p v-if="gitBranchError" class="mt-3 text-center text-caption text-destructive">{{ gitBranchError }}</p>
      </div>

      <div v-else class="mx-auto max-w-3xl px-8 py-8">
        <template v-for="item in chatTranscript" :key="item.id">
          <ChatActivityGroup
            v-if="item.kind === 'activity'"
            :activity="item"
            :open="chatActivityGroupIsOpen(item.id)"
            :open-entry-ids="chatActivityOpenEntries(item.id)"
            @toggle-group="open => handleActivityGroupToggle(item.id, open)"
            @toggle-entry="(entryId, open) => handleActivityEntryToggle(item.id, entryId, open)"
          />
          <ChatMessageItem
            v-else
            :message="item.message"
            :recoverable="item.message.id === recoverableFailureId"
            :recovery-context="ctfSession ? 'ctf' : 'coding'"
            @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
            @retry="resumeAfterFailure"
          />
        </template>
        <p v-if="waitingForModel && !compacting" class="chat-model-loading">
          <AkLoadingMark label="模型回复中" show-label />
        </p>
      </div>
    </div>

    <p
      v-if="compacting"
      class="chat-model-loading mx-auto w-full max-w-5xl px-4 pb-1"
      data-testid="context-compaction-status"
      role="status"
    >
      <AkLoadingMark label="正在整理上下文" show-label />
    </p>
    <p
      v-else-if="compactionError"
      class="mx-auto w-full max-w-5xl px-4 pb-1 text-caption text-foreground"
      data-testid="context-compaction-error"
      role="status"
    >
      {{ compactionError }}
    </p>

    <ChatComposer
      ref="composer"
      :running="running"
      :aborting="aborting"
      :compacting="compacting"
      :queued-guidance="messageQueue?.steering ?? []"
      :ctf-session="ctfSession"
      :ctf-mode="ctfMode"
      :ctf-role="ctfRole"
      :goal-mode="goalMode"
      :goal="activeGoal"
      :git-summary="composerGitSummary"
      :execution-mode="effectiveExecutionMode"
      :approval-policy="effectiveApprovalPolicy"
      :approval-label="approvalMenuLabel"
      :model-key="currentModelKey"
      :automatic-model-label="automaticModelLabel"
      :compact-model-label="compactModelLabel"
      :thinking-levels="currentThinkingProfile.levels"
      :thinking-level="currentThinkingLevel"
      :compact-disabled="continuity.compactDisabled"
      :context-usage="contextUsagePresentation"
      :run-elapsed-label="runTimingPresentation?.label"
      :workspace-ready="Boolean(workspacePath)"
      :workspace-locked="workspaceLocked"
      :workspace-name="workspaceName"
      :workspace-path="workspacePath"
      :home-directory="homeDirectory"
      :recent-projects="recentProjects"
      :git-repository="gitRepository"
      :git-branch="gitBranch"
      :git-branches="gitBranches"
      :browser-use-ready="browserUseReadyForCurrentTask"
      :computer-use-ready="externalAppUseReadyForCurrentTask"
      :available-skills="activeSkills"
      :selected-mcp-servers="selectedMCPServers"
      @send="sendComposerMessage"
      @open-changes="openChanges"
      @ctf-action="$emit('ctfAction', $event)"
      @abort="$emit('abort')"
      @change-execution-mode="changeExecutionMode"
      @change-approval-policy="changeApprovalPolicy"
      @change-model="changeModel"
      @change-thinking-level="$emit('changeThinkingLevel', $event)"
      @show-permissions="showCodingPermissions"
      @choose-workspace="chooseWorkspaceFromCurrentTask"
      @select-workspace="selectRecentProject"
      @forget-workspace="forgetRecentProject"
      @clear-workspace="$emit('clearWorkspace')"
      @checkout-branch="checkoutGitBranch"
      @cancel-queued-guidance="$emit('cancelQueuedGuidance', $event)"
      @edit-queued-guidance="$emit('editQueuedGuidance', $event)"
      @consume-goal="goalMode = false"
      @start-goal="goalMode = true"
      @run-slash-command="runSlashCommand"
      @control-goal="controlComposerGoal"
    />
  </main>
  <TacticalPanelShell
    v-if="environmentOpen && !domainContextCollapsed"
    as="aside"
    class="context-sidebar"
    size="wide"
    resizable
    :width="contextRailWidth"
    :body-mode="contextPanel === 'browser' ? 'viewport' : 'scroll'"
    :aria-label="contextPanelTitle"
    data-testid="single-right-context-rail"
    @update:width="persistContextRailWidth"
  >
    <template #header>
    <div class="app-drag flex w-full items-center justify-between">
      <Select
        v-if="!transientComputerUsePanel"
        :model-value="contextPanel"
        @update:model-value="value => changeContextPanel(String(value ?? ''))"
      >
        <SelectTrigger
          size="sm"
          class="app-no-drag min-w-44 border-0 bg-transparent px-0 shadow-none"
          aria-label="选择右侧页面"
        >
          <Flag v-if="contextPanel === 'domain' && ctfSession" class="size-4 text-primary" />
          <ShieldCheck v-else-if="contextPanel === 'domain'" class="size-4 text-primary" />
          <Activity v-else-if="contextPanel === 'environment'" class="size-4 text-primary" />
          <FileDiff v-else-if="contextPanel === 'changes'" class="size-4 text-primary" />
          <FileImage v-else-if="contextPanel === 'artifacts'" class="size-4 text-primary" />
          <Globe2 v-else-if="contextPanel === 'browser'" class="size-4 text-primary" />
          <Wrench v-else-if="contextPanel === 'collaboration'" class="size-4 text-primary" />
          <CircleDot v-else class="size-4 text-primary" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent size="sm" align="start" class="min-w-56">
          <SelectItem v-if="domainTaskPresentation" value="domain">领域上下文</SelectItem>
          <SelectItem value="environment">{{ ctfSession ? '解题环境' : '环境信息' }}</SelectItem>
          <SelectItem v-if="!ctfSession" value="changes">变更</SelectItem>
          <SelectItem v-if="!ctfSession" value="artifacts">产物</SelectItem>
          <SelectItem value="browser">浏览器</SelectItem>
          <template v-if="ctfSession">
            <SelectSeparator />
            <SelectItem value="collaboration">Agent 协作</SelectItem>
            <SelectItem value="evidence">证据与 Judge</SelectItem>
          </template>
        </SelectContent>
      </Select>
      <div v-else class="app-no-drag flex min-w-0 items-center gap-2 text-control font-medium">
        <Globe2 v-if="contextPanel === 'browser-use'" class="size-4 shrink-0 text-primary" />
        <MousePointer2 v-else class="size-4 shrink-0 text-primary" />
        <span class="truncate">{{ contextPanelTitle }}</span>
      </div>
      <div class="app-no-drag flex items-center gap-1">
        <Button
          v-if="domainTaskPresentation"
          variant="outline"
          size="sm"
          class="min-h-9 px-3"
          aria-label="收起任务信息"
          data-testid="collapse-domain-to-pip"
          @click="domainContextCollapsed = true"
        >
          收起
        </Button>
        <Button
          v-if="!ctfSession"
          variant="ghost"
          size="icon-sm"
          data-testid="coding-rail-terminal"
          :aria-label="terminalOpen ? '关闭底部终端' : '打开底部终端'"
          :title="terminalOpen ? '关闭底部终端' : '打开底部终端'"
          @click="toggleTerminalPanel"
        >
          <SquareTerminal class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="coding-rail-toggle"
          aria-label="关闭右侧栏"
          title="关闭右侧栏"
          @click="toggleManualContextSidebar"
        >
          <PanelRightClose class="size-4" />
        </Button>
      </div>
    </div>
    </template>

    <div
      class="min-h-0 flex-1"
    >
      <template v-if="contextPanel === 'domain' && domainTaskPresentation">
        <DomainTaskContextPanel
          class="domain-task-context-inline"
          :presentation="domainTaskPresentation"
          :collapsed="false"
          @update:collapsed="domainContextCollapsed = $event"
          @return-domain="domainTaskPresentation.kind === 'ctf' ? $emit('returnCtf') : $emit('returnVuln')"
        />
      </template>
      <template v-else-if="contextPanel === 'environment'">
        <div v-if="environmentError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ environmentError }}
        </div>

        <section class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium text-muted-foreground">工作区</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="running"
              @click="chooseWorkspaceFromCurrentTask"
            >
              {{ workspaceLocked ? '新任务使用其他目录' : '更换' }}
            </Button>
          </div>
          <div class="mt-3 flex items-start gap-3">
            <FolderOpen class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <p class="truncate text-body font-medium">
                {{ automaticScratchWorkspace ? workspaceName : codingEnvironment?.workspaceName || workspaceName }}
              </p>
              <p
                v-if="automaticScratchWorkspace || workspacePath"
                class="mt-1 truncate font-mono text-caption text-muted-foreground"
                :title="workspacePath"
              >
                {{ automaticScratchWorkspace
                  ? '无项目任务 · MilkSU 本地临时工作区'
                  : workspacePath }}
              </p>
            </div>
          </div>
        </section>

        <template v-if="!ctfSession">
        <section class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between">
            <p class="text-caption font-medium text-muted-foreground">Git</p>
            <Badge
              v-if="codingEnvironment?.git.isRepository"
              :variant="codingEnvironment.git.dirty ? 'secondary' : 'outline'"
            >
              {{ codingEnvironment.git.dirty ? '有变更' : '干净' }}
            </Badge>
          </div>
          <div v-if="codingEnvironment?.git.isRepository" class="mt-3 space-y-3 text-body">
            <div class="flex items-center justify-between gap-3">
              <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
                <GitBranch class="size-4 shrink-0" />
                <span class="truncate">{{ codingEnvironment.git.branch || 'detached' }}</span>
              </span>
              <span v-if="codingEnvironment.git.ahead || codingEnvironment.git.behind" class="font-mono text-caption">
                ↑{{ codingEnvironment.git.ahead }} ↓{{ codingEnvironment.git.behind }}
              </span>
            </div>
            <div v-if="codingEnvironment.git.head" class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">提交</span>
              <span class="font-mono text-caption">{{ codingEnvironment.git.head }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">变更</span>
              <span class="font-mono text-caption">
                {{ codingEnvironment.git.changedFiles }} 文件
                <span class="text-primary">+{{ codingEnvironment.git.additions }}</span>
                <span class="text-destructive">-{{ codingEnvironment.git.deletions }}</span>
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-caption text-muted-foreground">
              <span>暂存 {{ codingEnvironment.git.staged }}</span>
              <span>修改 {{ codingEnvironment.git.modified }}</span>
              <span>未跟踪 {{ codingEnvironment.git.untracked }}</span>
              <span :class="{ 'text-destructive': codingEnvironment.git.conflicts }">
                冲突 {{ codingEnvironment.git.conflicts }}
              </span>
            </div>
            <Button
              variant="outline"
              class="w-full justify-between"
              @click="changeContextPanel('changes')"
            >
              <span class="flex items-center gap-2">
                <FileDiff class="size-4" />
                查看文件级变更
              </span>
              <span class="text-caption text-muted-foreground">
                {{ codingEnvironment.git.changedFiles }} 文件
              </span>
            </Button>
          </div>
          <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
            {{ codingEnvironment?.git.problem || '当前目录不是 Git 仓库。' }}
          </p>
        </section>
        </template>

        <template v-else>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">当前解题</p>
          <div class="mt-3 space-y-3 text-body">
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">角色</span>
              <span>{{ ctfRoleLabel }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">协作</span>
              <span>{{ ctfMode === 'coach' ? '教练' : ctfMode === 'delegate' ? '代理' : '搭档' }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">阶段</span>
              <span>{{ ctfCheckpoint?.progress?.phase || ctfCheckpoint?.status || '待启动' }}</span>
            </div>
            <div v-if="ctfBudget" class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">回合预算</span>
              <span class="font-mono text-caption">
                {{ ctfBudget.remainingTurns }}/{{ ctfBudget.budget.maxTurns }}
              </span>
            </div>
          </div>
        </section>

        </template>

        <AgentExecutionPlan
          :messages="conversation?.messages ?? []"
        />

        <section class="border-b border-border px-4 py-4">
        <p class="text-caption font-medium text-muted-foreground">Agent</p>
        <div class="mt-3 space-y-3 text-body">
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">状态</span>
            <span class="flex items-center gap-2">
              <AkLoadingMark v-if="running" label="执行中" />
              <span
                v-else
                class="size-1.5 rounded-full bg-muted-foreground"
              />
              {{ running ? '执行中' : '空闲' }}
            </span>
          </div>
          <div v-if="runTimingPresentation" class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">本轮用时</span>
            <span
              class="font-mono text-caption tabular-nums"
              data-testid="agent-run-elapsed"
            >
              {{ runTimingPresentation.label }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">模型</span>
            <span class="text-right text-caption leading-5">{{ activeModelLabel }}</span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">来源</span>
            <span class="text-right text-caption leading-5">
              {{ activeModelSourceLabel }}
            </span>
          </div>
          <div
            v-if="contextUsagePresentation"
            class="flex items-center justify-between gap-3"
          >
            <span class="text-muted-foreground">上下文</span>
            <ContextUsageMeter
              :usage="contextUsagePresentation"
              size="md"
            />
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">插件</span>
            <span class="text-right text-caption leading-5">
              {{ activeExtensions.length ? activeExtensions.map(extensionLabel).join(' · ') : '' }}
            </span>
          </div>
          <div v-if="activeSkills.length" class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">技能</span>
            <span class="text-right text-caption leading-5">
              {{ activeSkills.join(' · ') }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">工具</span>
            <span class="text-right text-caption leading-5">
              {{ activeTools.length }} 个
            </span>
          </div>
          <details v-if="activeTools.length" class="rounded-md bg-muted/40 px-2.5 py-2">
            <summary class="cursor-pointer text-caption text-muted-foreground">
              查看本任务工具
            </summary>
            <p class="mt-2 break-words text-caption leading-5 text-muted-foreground">
              {{ activeTools.join(' · ') }}
            </p>
          </details>
        </div>
        </section>

        <section v-if="!ctfSession" class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium text-muted-foreground">执行与权限</p>
            <Badge variant="outline">{{ codingPolicyLabel }}</Badge>
          </div>
          <div class="mt-3 space-y-3">
            <div
              v-for="capability in codingCapabilities"
              :key="capability.id"
              class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1"
            >
              <p class="text-body">{{ capability.label }}</p>
              <span
                class="text-caption"
                :class="capability.status === 'allowed'
                  ? 'text-primary'
                  : capability.status === 'approval-required'
                    ? 'text-amber-500'
                    : 'text-muted-foreground'"
              >
                {{ capabilityStatusLabel(capability.status) }}
              </span>
              <p
                v-if="capability.status !== 'allowed' && capability.detail"
                class="col-span-2 text-caption leading-5 text-muted-foreground"
              >
                {{ capability.detail }}
              </p>
            </div>
          </div>
          <div class="mt-4 border-t border-border/70 pt-4">
            <p class="text-caption font-medium text-muted-foreground">项目 MCP</p>
            <p v-if="mcpConfigLoading" class="mt-2 text-caption text-muted-foreground">
              正在读取
            </p>
            <p
              v-else-if="mcpConfig?.problem"
              class="mt-2 text-caption leading-5 text-destructive"
            >
              {{ mcpConfig.problem }}
            </p>

            <div v-else-if="mcpConfig" class="mt-2 space-y-2">
              <CodingMCPReviewCard
                v-for="server in mcpConfig.servers"
                :key="server.name"
                :server="server"
                :selected="selectedMCPServers.includes(server.name)"
                :running="running"
                @toggle="toggleMCPServer(server)"
              />
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="contextPanel === 'changes'">
        <CodingChangesPanel
          :workspace-path="workspacePath"
          :environment="codingEnvironment"
          :running="running"
          :focus-path="changesFocusPath"
          :preferred-editor="settings?.preferred_external_editor"
          @review="runCodingProductAction('review')"
          @refresh="refreshEnvironment"
        />
      </template>

      <template v-else-if="contextPanel === 'artifacts'">
        <CodingArtifactPreviewPanel
          ref="artifactPanel"
          :workspace-path="workspacePath"
          :environment="codingEnvironment"
          :requested-path="requestedArtifactPath"
          @previewed="recordArtifactPreview"
        />
      </template>

      <template v-else-if="contextPanel === 'browser'">
        <section class="coding-browser-panel flex h-full min-h-0 flex-col">
          <div v-if="browserPanelError" class="shrink-0 border-b border-border px-3 py-2 text-caption text-destructive">
            {{ browserPanelError }}
          </div>

          <div class="flex h-11 shrink-0 items-end gap-1 border-b border-border bg-muted/35 px-2 pt-1.5">
            <div class="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
              <button
                v-for="tab in (codingBrowserTabs.length ? codingBrowserTabs : [{
                  id: 'current',
                  title: codingBrowserTabTitle,
                  url: codingBrowserURL,
                  active: true,
                }])"
                :key="tab.id"
                type="button"
                class="flex h-9 min-w-0 max-w-52 flex-1 items-center gap-2 rounded-t-lg border border-b-0 px-3"
                :class="tab.active
                  ? 'border-border bg-background'
                  : 'border-transparent bg-transparent text-muted-foreground'"
                :aria-current="tab.active ? 'page' : undefined"
                :aria-label="tab.title || tab.url || '新标签页'"
                @click="tab.id === 'current' ? undefined : activateCodingBrowserTab(tab.id)"
              >
                <Globe2 class="size-3.5 shrink-0 text-primary" />
                <span class="min-w-0 flex-1 truncate text-left text-control">{{ tab.title || tab.url || '新标签页' }}</span>
                <span
                  v-if="codingBrowserStatus?.enabled"
                  role="button"
                  tabindex="0"
                  class="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                  :aria-label="codingBrowserTabs.length > 1 ? `关闭 ${tab.title || '标签页'}` : '关闭浏览器'"
                  @click.stop="tab.id === 'current' ? stopCodingBrowser() : closeCodingBrowserTab(tab.id)"
                  @keydown.enter.prevent="tab.id === 'current' ? stopCodingBrowser() : closeCodingBrowserTab(tab.id)"
                >
                  <X class="size-3.5" />
                </span>
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              class="mb-1 size-7 shrink-0"
              aria-label="新标签页"
              :disabled="codingBrowserLoading || codingBrowserTabs.length >= 8"
              @click="createCodingBrowserTab"
            >
              <Plus class="size-3.5" />
            </Button>
          </div>

          <div class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="!codingBrowserStatus?.enabled"
              aria-label="后退"
              @click="runCodingBrowserNavigation('back')"
            >
              <ArrowLeft class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="!codingBrowserStatus?.enabled"
              aria-label="前进"
              @click="runCodingBrowserNavigation('forward')"
            >
              <ArrowRight class="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="!codingBrowserStatus?.enabled || codingBrowserLoading"
              aria-label="重新加载"
              @click="runCodingBrowserNavigation('reload')"
            >
              <RefreshCw class="size-4" :class="{ 'animate-spin': codingBrowserLoading }" />
            </Button>
            <Input
              v-model="codingBrowserURL"
              :disabled="codingBrowserLoading"
              class="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption"
              aria-label="浏览器地址"
              placeholder="输入网址或搜索内容"
              @keydown.enter.prevent="navigateCodingBrowser"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="codingBrowserLoading"
              :aria-label="codingBrowserStatus?.enabled ? '打开地址' : '启动浏览器'"
              @click="navigateCodingBrowser"
            >
              <LoaderCircle v-if="codingBrowserLoading" class="size-4 animate-spin" />
              <ArrowRight v-else class="size-4" />
            </Button>
          </div>

          <div class="relative min-h-0 flex-1 bg-white">
            <div
              ref="codingBrowserViewport"
              class="absolute inset-0"
              data-coding-browser-viewport
              :aria-label="codingBrowserStatus?.enabled ? '浏览器页面' : '浏览器未启动'"
            />
            <div
              v-if="!codingBrowserStatus?.enabled"
              class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background px-8 text-center"
            >
              <Globe2 class="size-7 text-muted-foreground" />
              <p class="mt-3 text-label font-medium">浏览器</p>
              <p class="mt-1 text-caption text-muted-foreground">输入地址后按回车</p>
            </div>
          </div>

          <footer class="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-3 text-caption text-muted-foreground">
            <span class="min-w-0 truncate">
              {{ codingBrowserStatus?.enabled ? codingBrowserStatus.profileLabel : '独立 profile · 不读取日常浏览器' }}
            </span>
            <Button
              v-if="codingBrowserEvidencePath"
              variant="ghost"
              size="sm"
              class="shrink-0"
              :disabled="codingBrowserEvidenceLoading"
              aria-label="在 Finder 中显示浏览器证据"
              @click="revealCodingBrowserEvidence"
            >
              <LoaderCircle v-if="codingBrowserEvidenceLoading" class="size-3.5 animate-spin" />
              <FolderOpen v-else class="size-3.5" />
              证据
            </Button>
          </footer>
        </section>
      </template>

      <template v-else-if="contextPanel === 'browser-use'">
        <div v-if="browserPanelError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ browserPanelError }}
        </div>
        <section class="px-4 py-5">
          <div class="rounded-xl border border-border bg-muted/25 p-4">
            <div class="flex items-start gap-3">
              <Globe2 class="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p class="text-body font-medium">真实用户浏览器</p>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  发送任务后，在 Chrome/Edge 中批准要操作的标签页。
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="mt-4"
              @click="openPlaywrightBrowserExtension"
            >
              <ExternalLink class="size-3.5" />
              安装 Playwright 官方扩展
            </Button>
          </div>
        </section>
      </template>

      <template v-else-if="contextPanel === 'computer-use'">
        <div v-if="browserPanelError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ browserPanelError }}
        </div>
        <section class="px-4 py-5">
          <CodingComputerUsePanel
            v-model:selected-target-key="selectedComputerUseTargetKey"
            standalone
            :status="computerUseStatus"
            :targets="scopedComputerUseTargets"
            :loading="computerUseLoading"
            :running="running"
            :owned-by-current-task="computerUseOwnedByCurrentTask"
            :execution-mode="effectiveExecutionMode"
            :approval-policy="effectiveApprovalPolicy"
            :operation-evidence="computerUseOperationEvidence"
            @request-permissions="requestComputerUsePermissions"
            @refresh="refreshBrowserPanel"
            @start="startComputerUse"
            @stop="stopComputerUse"
          />
        </section>
      </template>

      <template v-else-if="contextPanel === 'collaboration'">
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">当前角色</p>
          <div class="mt-3 grid gap-2">
            <Button
              :variant="ctfRole === 'solver' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'solver')"
            >
              <Flag class="size-4" />
              解题 Agent
            </Button>
            <Button
              :variant="ctfRole === 'tool-builder' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'tool-builder')"
            >
              <Wrench class="size-4" />
              Coding Agent 工具工坊
            </Button>
            <Button
              :variant="ctfRole === 'strategist' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'strategist')"
            >
              <Route class="size-4" />
              策略复盘
            </Button>
          </div>
          <div
            v-if="ctfRole === 'strategist'"
            class="mt-3 rounded-lg bg-primary/5 px-3 py-3"
          >
            <p class="text-body font-medium">策略 Agent 复盘</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              独立审阅题面、轨迹与证据；不执行命令，不修改解题笔记或候选。
            </p>
            <Button
              variant="link"
              size="text"
              class="mt-2"
              @click="$emit('switchCtfAgent', 'solver')"
            >
              复盘完成后返回验证
            </Button>
          </div>
        </section>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">工具交接</p>
          <p class="mt-2 text-body">{{ workshopSummary }}</p>
          <p
            v-if="workshopState?.latestRequest"
            class="mt-1 truncate text-caption text-muted-foreground"
            :title="workshopState.latestRequest.relativePath"
          >
            {{ workshopState.latestRequest.title }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button
              v-if="ctfRole !== 'tool-builder' && workshopState?.readyCount"
              variant="outline"
              size="sm"
              :disabled="running"
              @click="verifyDeliveredTool"
            >
              验收工具
            </Button>
            <Button
              v-else-if="ctfRole !== 'tool-builder' && !workshopState?.pendingCount"
              variant="outline"
              size="sm"
              :disabled="running"
              @click="requestTool"
            >
              提出工具需求
            </Button>
          </div>
        </section>
        <section class="px-4 py-4">
          <Button variant="outline" class="w-full justify-start" @click="$emit('returnCtf')">
            <Flag class="size-4" />
            返回训练工作台
          </Button>
        </section>
      </template>

      <template v-else>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">证据与 Judge</p>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p class="text-xl font-semibold">{{ ctfProjection?.evidence.length ?? 0 }}</p>
              <p class="text-caption text-muted-foreground">证据</p>
            </div>
            <div>
              <p class="text-xl font-semibold">{{ ctfProjection?.artifacts.length ?? 0 }}</p>
              <p class="text-caption text-muted-foreground">制品</p>
            </div>
          </div>
          <div v-if="latestJudge" class="mt-4 flex items-start gap-2">
            <CircleDot
              class="mt-0.5 size-4 shrink-0"
              :class="latestJudge.correct ? 'text-primary' : 'text-muted-foreground'"
            />
            <div>
              <p class="text-body font-medium">{{ latestJudge.platform }} · {{ latestJudge.status }}</p>
              <MarkdownContent
                class="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                :content="latestJudge.summary"
                compact
              />
            </div>
          </div>
          <p v-else class="mt-3 text-caption text-muted-foreground">尚无外部 Judge 回执。</p>
        </section>
        <section class="px-4 py-4">
          <Button variant="outline" class="w-full justify-start" @click="$emit('returnCtf')">
            查看完整轨迹与提交
          </Button>
        </section>
      </template>
    </div>
  </TacticalPanelShell>
  </div>
  <DomainTaskContextPanel
    v-if="domainTaskPresentation && domainContextCollapsed"
    class="domain-task-context-pip"
    :presentation="domainTaskPresentation"
    :collapsed="true"
    data-testid="domain-task-context-pip"
    @update:collapsed="value => {
      domainContextCollapsed = value
      if (!value) {
        environmentOpen = true
        contextPanel = 'domain'
      }
    }"
    @return-domain="domainTaskPresentation.kind === 'ctf' ? $emit('returnCtf') : $emit('returnVuln')"
  />
  <div
    v-if="terminalOpen"
    class="coding-terminal-dock min-w-0 shrink-0 overflow-hidden border-t border-border bg-card"
    :style="terminalDockStyle"
    aria-label="底部终端面板"
  >
    <div
      class="coding-terminal-dock__resize app-no-drag"
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整终端高度"
      @pointerdown="startTerminalResize"
    />
    <CodingTerminalPanel
      class="min-h-0 flex-1"
      :active="terminalOpen"
      :conversation-id="terminalConversationId"
      :workspace-path="terminalWorkspacePath"
      @close="terminalOpen = false"
    />
  </div>
  <CodingComputerUsePermissionDialog
    v-model:open="computerUsePermissionDialogOpen"
    :status="computerUseStatus"
    :requesting="computerUsePermissionRequesting"
    :error="computerUsePermissionError"
    @request-permissions="requestComputerUsePermissions"
    @poll="pollComputerUsePermissions"
    @complete="handleComputerUsePermissionComplete"
  />
  </section>
</template>

<style scoped>
.chat-main {
  container-name: chat-main;
  container-type: inline-size;
}

.coding-workspace {
  container-name: coding-workspace;
  container-type: inline-size;
}

.coding-browser-panel {
  background-color: var(--tactical-ink-2);
}

.coding-action-option {
  display: flex;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
}

.domain-task-context-pip {
  position: absolute;
  right: 1rem;
  bottom: 5.75rem;
  z-index: 30;
}

.coding-terminal-dock {
  position: relative;
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.coding-terminal-dock__resize {
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  height: 8px;
  margin-top: -3px;
  cursor: row-resize;
  touch-action: none;
}

.coding-terminal-dock__resize::after {
  position: absolute;
  inset: 3px 0;
  background: transparent;
  content: '';
}

.coding-terminal-dock__resize:hover::after,
.coding-terminal-dock__resize:focus-visible::after {
  background: var(--brand);
  opacity: .55;
}

</style>
