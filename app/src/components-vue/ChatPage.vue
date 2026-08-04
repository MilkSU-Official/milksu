<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  markRaw,
  nextTick,
  onMounted,
  ref,
  watch,
} from 'vue'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
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
  Bot,
  ChevronDown,
  CircleDot,
  Compass,
  Copy,
  ExternalLink,
  FileDiff,
  FileImage,
  FilePenLine,
  FileText,
  Files,
  Flag,
  FolderOpen,
  GitBranch,
  Globe2,
  KeyRound,
  LoaderCircle,
  Network,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Route,
  Shrink,
  Sparkles,
  Target,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import ChatActivityGroup from '@/components-vue/ChatActivityGroup.vue'
import ChatComposer from '@/components-vue/ChatComposer.vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import CodingArtifactPreviewPanel from '@/components-vue/CodingArtifactPreviewPanel.vue'
import CodingChangesPanel from '@/components-vue/CodingChangesPanel.vue'
import CodingComputerUsePanel from '@/components-vue/CodingComputerUsePanel.vue'
import CodingMCPReviewCard from '@/components-vue/CodingMCPReviewCard.vue'
import CodingProductLoopPanel from '@/components-vue/CodingProductLoopPanel.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import WorkspaceSettingsButton from '@/components-vue/WorkspaceSettingsButton.vue'
import type {
  CodingArchitecturePreview,
  CodingArtifactPreview,
  CodingBrowserStatus,
  CodingComputerUseStatus,
  CodingComputerUseTarget,
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitDeliveryEvidence,
  CodingMCPConfigSnapshot,
} from '@/codingEnvironmentTypes'
import type { CTFShowCatalogStatus } from '@/ctfshowTypes'
import { buildChatTranscript } from '@/lib/chatActivity'
import { chatTopbarPresentation } from '@/lib/chatTopbar'
import {
  agentRecoveryPrompt,
  recoverableAgentFailureId,
} from '@/lib/agentRecovery'
import { buildCodingArchitectureAction } from '@/lib/codingArchitecture'
import {
  codingProductAction,
  codingProductActions,
  codingReviewPrompt,
  type CodingProductActionKind,
} from '@/lib/codingProductActions'
import { extractLatestComputerUseOperationEvidence } from '@/lib/codingComputerUseEvidence'

import {
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
  Conversation,
  CTFChatAction,
} from '@/types'
import type { NSSCTFWebBridgeStatus } from '@/nssctfWebTypes'
import { providerModelLabel } from '@/types'

const CodingTerminalPanel = defineAsyncComponent(
  () => import('@/components-vue/CodingTerminalPanel.vue'),
)
const CodingCollaborationPanel = defineAsyncComponent(
  () => import('@/components-vue/CodingCollaborationPanel.vue'),
)

const props = defineProps<{
  conversation: Conversation | null
  settings: AppSettings | null
  workspacePath: string
  running: boolean
  aborting: boolean
  sessionReady: boolean
  resumed: boolean
  compacting: boolean
  compactedAt?: number
  compactionError?: string
  ctfSession: boolean
  vulnerabilitySession?: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
  ensureConversation: (title?: string) => string
}>()

const emit = defineEmits<{
  send: [text: string, visibleText?: string, attachments?: CodingAttachment[]]
  ctfAction: [action: CTFChatAction]
  abort: []
  chooseWorkspace: []
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeCodingPolicy: [
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  respondApproval: [requestId: string, approved: boolean]
  compactContext: []
  controlGoal: [action: 'resume' | 'clear']
  openSettings: []
  returnCtf: []
  returnVuln: []
  switchCtfAgent: [role: 'solver' | 'tool-builder' | 'strategist']
}>()

const goalMode = ref(false)
const scrollArea = ref<HTMLElement | null>(null)
const workshopState = ref<CTFToolWorkshopState | null>(null)
const environmentOpen = ref(!props.ctfSession)
const contextPanelValues = [
  'environment',
  'changes',
  'terminal',
  'artifacts',
  'architecture',
  'browser',
  'collaboration',
  'evidence',
] as const
type ContextPanel = typeof contextPanelValues[number]
const contextPanel = ref<ContextPanel>('environment')
const artifactPanel = ref<InstanceType<typeof CodingArtifactPreviewPanel> | null>(null)
const collaborationPanel = ref<{ refresh: () => Promise<void> } | null>(null)
const environmentLoading = ref(false)
const environmentError = ref('')
const architecturePreview = ref<CodingArchitecturePreview | null>(null)
const architecturePreviewLoading = ref(false)
const architecturePreviewError = ref('')
const requestedArchitecturePath = ref('')
const browserPanelError = ref('')
const codingBrowserLoading = ref(false)
const codingBrowserURL = ref('http://127.0.0.1:3000')
const codingBrowserStatus = ref<CodingBrowserStatus | null>(null)
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
const gitDeliveryEvidence = ref<CodingGitDeliveryEvidence | null>(null)
const nssctfBrowserStatus = ref<NSSCTFWebBridgeStatus | null>(null)
const ctfshowBrowserStatus = ref<CTFShowCatalogStatus | null>(null)
const codingEnvironment = ref<CodingEnvironmentSnapshot | null>(null)
const mcpConfig = ref<CodingMCPConfigSnapshot | null>(null)
const mcpConfigLoading = ref(false)
const ctfBudget = ref<CTFAgentBudgetStatus | null>(null)
const ctfCheckpoint = ref<CTFAgentRunCheckpoint | null>(null)
const ctfProjection = ref<CTFProjection | null>(null)
const automaticModel = computed(() => {
  if (!props.settings) return null
  const preferred = props.ctfRole === 'strategist'
    ? props.settings.model_routing.deep
    : props.settings.model_routing.fast
  const fast = props.settings.model_routing.fast
  const active = {
    provider: props.settings.active_provider,
    model: props.settings.active_model,
  }
  return [preferred, fast, active].find(selection => {
    if (props.settings?.relay?.enabled && props.settings.relay.has_key) return true
    const configured = props.settings?.providers[selection.provider]
    return Boolean(configured?.enabled && configured.has_api_key)
  }) ?? preferred
})
const effectiveModelMode = computed(() => (
  props.modelMode ?? props.settings?.model_routing.default_mode ?? 'auto'
))
const currentModelKey = computed(() => {
  if (!props.settings) return ''
  if (effectiveModelMode.value === 'auto') return 'auto'
  const provider = props.modelProvider || props.settings.active_provider
  const model = props.modelId || props.settings.active_model
  return `manual:${provider}:${model}`
})
const automaticModelLabel = computed(() => {
  const selection = automaticModel.value
  if (!selection) return '自动编排'
  const task = props.ctfRole === 'strategist' ? '深度策略' : '快速执行'
  return `自动 · ${providerModelLabel(selection.provider, selection.model)} · ${task}`
})
const activeExtensions = computed(() => (
  props.conversation?.agentExtensions ?? []
))
const selectedMCPServers = computed(() => props.mcpServers ?? [])
const activeSkills = computed(() => (
  props.conversation?.agentSkills ?? []
))
const activeTools = computed(() => (
  props.conversation?.agentTools ?? []
))
const activeGoal = computed(() => props.conversation?.agentGoal)
const hasUnfinishedGoal = computed(() => (
  Boolean(activeGoal.value && activeGoal.value.status !== 'complete')
))
const goalStatusLabel = computed(() => {
  const status = activeGoal.value?.status
  if (status === 'active') return '进行中'
  if (status === 'paused') return '已暂停'
  if (status === 'blocked') return '受阻'
  if (status === 'usage_limited') return '额度受限'
  if (status === 'budget_limited') return '预算已用完'
  if (status === 'queued') return '排队中'
  return '已完成'
})
const resumableGoal = computed(() => (
  ['paused', 'blocked', 'usage_limited', 'budget_limited'].includes(
    activeGoal.value?.status ?? '',
  )
))
const goalUsageLabel = computed(() => {
  const goal = activeGoal.value
  if (!goal?.tokenBudget) return ''
  return `${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens`
})
const continuity = computed(() => codingContinuityPresentation({
  sessionReady: props.sessionReady,
  resumed: props.resumed,
  compacting: props.compacting,
  compactedAt: props.compactedAt,
  running: props.running,
}))
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
const selectedComputerUseTarget = computed(() => (
  resolveSelectedComputerUseTarget(
    computerUseTargets.value,
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
    return effectiveModelMode.value === 'auto' ? '自动编排' : '选择模型'
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
  if (props.settings.relay?.enabled) return props.settings.relay.has_key
  const provider = props.settings.providers[props.settings.active_provider]
  return Boolean(provider?.enabled && provider.has_api_key)
})
const workspaceName = computed(() => {
  const value = props.workspacePath.replace(/\/+$/, '')
  return value.split('/').at(-1) || '临时沙盒'
})
const architectureAction = computed(() => (
  props.workspacePath
    ? buildCodingArchitectureAction(props.workspacePath)
    : null
))
const architecturePath = computed(() => (
  requestedArchitecturePath.value
  || architectureAction.value?.relativeHtmlPath
  || ''
))
const architecturePreviewSource = computed(() => {
  const html = architecturePreview.value?.html
  if (!html) return ''
  const policy = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    'media-src data: blob:',
  ].join('; ')
  const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(\s[^>]*)?>/i, match => `${match}${csp}`)
    : `${csp}${html}`
})
const codingBrowserEvidencePath = computed(() => {
  const sessionID = codingBrowserStatus.value?.sessionId?.trim()
  return sessionID ? `.milksu/browser-evidence/${sessionID}` : ''
})
const codingBrowserApprovalDetail = computed(() => (
  effectiveApprovalPolicy.value === 'ask'
    ? '请求批准档会逐次确认浏览器调用。'
    : effectiveApprovalPolicy.value === 'read-only'
      ? '只读档不会把浏览器加载给 Agent。'
      : effectiveApprovalPolicy.value === 'full-auto'
        ? '完全访问会自动执行已启用的浏览器调用，固定会话边界和硬阻断仍然有效。'
        : '替我审批会自动执行已启用的浏览器调用；扩大外部账户授权时仍会确认。'
))
const workspaceLocked = computed(() => Boolean(props.conversation?.messages.length))
const activeModelLabel = computed(() => {
  if (effectiveModelMode.value === 'auto') return automaticModelLabel.value.replace(/^自动 · /, '')
  const provider = props.modelProvider || props.settings?.active_provider
  const model = props.modelId || props.settings?.active_model
  return provider && model ? providerModelLabel(provider, model) : '等待选择'
})
const messageCount = computed(() => props.conversation?.messages.length ?? 0)
const toolMessageCount = computed(() => (
  props.conversation?.messages.filter(message => message.role === 'tool').length ?? 0
))
const computerUseOperationEvidence = computed(() => (
  extractLatestComputerUseOperationEvidence(props.conversation?.messages ?? [])
))
const chatTranscript = computed(() => (
  buildChatTranscript(props.conversation?.messages ?? [], props.running)
))
const recoverableFailureId = computed(() => (
  recoverableAgentFailureId(
    props.conversation?.messages ?? [],
    props.running,
  )
))
const latestJudge = computed(() => ctfProjection.value?.judgeReceipts.at(-1))
const contextPanelTitle = computed(() => ({
  environment: props.ctfSession ? '解题环境' : '环境信息',
  changes: '变更',
  terminal: '终端',
  artifacts: '产物',
  architecture: '架构图',
  browser: props.ctfSession ? '浏览器' : '浏览器与 App',
  collaboration: 'Agent 协作',
  evidence: '证据与 Judge',
})[contextPanel.value])
const codingActionIcons = {
  understand: Compass,
  test: Terminal,
  review: FileDiff,
  fix: Wrench,
  summary: FileText,
} as const
const codingActionOptions = computed(() => (
  codingProductActions().map(action => ({
    ...action,
    icon: markRaw(codingActionIcons[action.kind]),
  }))
))
const ctfRoleLabel = computed(() => {
  if (props.ctfRole === 'tool-builder') return 'Coding Agent 工具工坊'
  if (props.ctfRole === 'strategist') return '策略 Agent 复盘'
  return 'CTF 解题会话'
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
) {
  goalMode.value = false
  emit('send', prompt, visibleText, attachments)
}

function resumeAfterFailure() {
  if (props.running || !recoverableFailureId.value) return
  emit('send', agentRecoveryPrompt(props.ctfSession), '继续')
}

function changeModel(value: string) {
  if (value === 'auto') {
    emit('changeModel', 'auto')
    return
  }
  const [mode, provider, model] = value.split(':')
  if (mode === 'manual' && provider && model) emit('changeModel', 'manual', provider, model)
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

function showCodingPermissions() {
  contextPanel.value = 'environment'
  environmentOpen.value = true
}

function generateArchitecture() {
  if (!props.workspacePath) {
    emit('chooseWorkspace')
    return
  }
  if (props.running || !architectureAction.value) return
  requestedArchitecturePath.value = architectureAction.value.relativeHtmlPath
  architecturePreview.value = null
  architecturePreviewError.value = ''
  contextPanel.value = 'architecture'
  environmentOpen.value = true
  emit('changeCodingPolicy', 'go', 'workspace-auto')
  emit(
    'send',
    architectureAction.value.prompt,
    architectureAction.value.visibleText,
  )
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
  emit('send', prompt, action.visibleText)
}

async function refreshArchitecturePreview() {
  architecturePreviewError.value = ''
  if (!props.workspacePath || !architecturePath.value) {
    architecturePreview.value = null
    return
  }
  architecturePreviewLoading.value = true
  try {
    architecturePreview.value = await invokeCommand<CodingArchitecturePreview>(
      'get_coding_architecture_preview',
      {
        workspacePath: props.workspacePath,
        relativePath: architecturePath.value,
      },
    )
  } catch (reason) {
    architecturePreview.value = null
    architecturePreviewError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取架构图。'
  } finally {
    architecturePreviewLoading.value = false
  }
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
    const [budget, checkpoint, projection] = await Promise.allSettled([
      invokeCommand<CTFAgentBudgetStatus>('get_ctf_agent_budget_status', { id: jobId }),
      invokeCommand<CTFAgentRunCheckpoint | null>('get_ctf_agent_run_checkpoint', { id: jobId }),
      invokeCommand<CTFProjection>('get_ctf_job', { id: jobId }),
    ])
    ctfBudget.value = budget.status === 'fulfilled' ? budget.value : null
    ctfCheckpoint.value = checkpoint.status === 'fulfilled' ? checkpoint.value : null
    ctfProjection.value = projection.status === 'fulfilled' ? projection.value : null
    if ([budget, checkpoint, projection].every(result => result.status === 'rejected')) {
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
  if (!props.ctfSession) {
    nssctfBrowserStatus.value = null
    ctfshowBrowserStatus.value = null
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
      invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status'),
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
        : '暂时无法读取 Coding 浏览器状态。'
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
        computerUseTargets.value,
        selectedComputerUseTargetKey.value,
        computerUseStatus.value?.conversationId ? computerUseStatus.value.target : null,
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
    return
  }
  environmentLoading.value = true
  const [nssctf, ctfshow] = await Promise.allSettled([
    invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status'),
    invokeCommand<CTFShowCatalogStatus>('get_ctfshow_catalog_status'),
  ])
  nssctfBrowserStatus.value = nssctf.status === 'fulfilled' ? nssctf.value : null
  ctfshowBrowserStatus.value = ctfshow.status === 'fulfilled' ? ctfshow.value : null
  if (nssctf.status === 'rejected' && ctfshow.status === 'rejected') {
    browserPanelError.value = '暂时无法读取浏览器连接。'
  }
  environmentLoading.value = false
}

async function startCodingBrowser() {
  browserPanelError.value = ''
  const initialURL = codingBrowserURL.value.trim()
  if (!/^https?:\/\//i.test(initialURL)) {
    browserPanelError.value = '请输入以 http:// 或 https:// 开头的地址。'
    return
  }
  const workspaceName = props.workspacePath
    .replace(/\/+$/, '')
    .split('/')
    .at(-1)
  const conversationID = props.ensureConversation(
    workspaceName ? `${workspaceName} · 浏览器` : 'Coding 浏览器',
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
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : 'Coding 浏览器启动失败。'
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
      : 'Coding 浏览器停止失败。'
  } finally {
    codingBrowserLoading.value = false
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

async function requestComputerUsePermissions() {
  browserPanelError.value = ''
  computerUseLoading.value = true
  try {
    computerUseStatus.value = await invokeCommand<CodingComputerUseStatus>(
      'request_coding_computer_use_permissions',
    )
  } catch (reason) {
    browserPanelError.value = reason instanceof Error
      ? reason.message
      : '无法请求 MilkSU 的系统权限。'
  } finally {
    computerUseLoading.value = false
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
  if (contextPanel.value === 'terminal') {
    return
  }
  if (contextPanel.value === 'architecture') {
    await refreshArchitecturePreview()
    return
  }
  if (contextPanel.value === 'artifacts') {
    await artifactPanel.value?.refresh()
    return
  }
  if (contextPanel.value === 'browser') {
    await refreshBrowserPanel()
    return
  }
  if (contextPanel.value === 'collaboration' && !props.ctfSession) {
    await collaborationPanel.value?.refresh()
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
  contextPanel.value = value as ContextPanel
  environmentOpen.value = true
  void refreshContextPanel()
}

function recordArtifactPreview(preview: CodingArtifactPreview) {
  artifactPreviewEvidence.value = {
    relativePath: preview.relativePath,
    kind: preview.kind,
  }
}

function recordGitDeliveryEvidence(evidence: CodingGitDeliveryEvidence) {
  gitDeliveryEvidence.value = evidence
}

async function revealBrowserExtension() {
  browserPanelError.value = ''
  try {
    await invokeCommand('reveal_browser_extension')
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function copyPairingCode(value: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    browserPanelError.value = '复制失败，请回到训练工作台手动复制配对码。'
  }
}

async function openSharedBrowserPage(url: string) {
  if (!url) return
  try {
    await invokeCommand('open_ctf_source_url', { url })
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : String(reason)
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

async function scrollChatToBottom() {
  await nextTick()
  if (!scrollArea.value) return
  scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  }
}

onMounted(() => {
  void scrollChatToBottom()
})

watch(() => props.conversation?.messages.length, () => {
  void scrollChatToBottom()
})
watch(() => props.ctfSession, (current, previous) => {
  if (current !== previous) {
    environmentOpen.value = !current
    contextPanel.value = 'environment'
  }
})
watch(() => props.conversation?.id, () => {
  goalMode.value = false
  codingBrowserStatus.value = null
  codingBrowserEvidenceError.value = ''
  codingBrowserEvidenceRevealed.value = false
  artifactPreviewEvidence.value = null
  browserEvidence.value = null
  computerUseEvidence.value = null
  gitDeliveryEvidence.value = null
  void scrollChatToBottom()
  if (contextPanel.value === 'browser' && environmentOpen.value) {
    void refreshBrowserPanel()
  }
  if (
    contextPanel.value === 'collaboration'
    && !props.ctfSession
    && environmentOpen.value
  ) {
    void collaborationPanel.value?.refresh()
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
watch(contextPanel, panel => {
  if (panel === 'browser' && environmentOpen.value) void refreshBrowserPanel()
  if (panel === 'architecture' && environmentOpen.value) void refreshArchitecturePreview()
  if (['artifacts', 'changes'].includes(panel) && environmentOpen.value) void refreshEnvironment()
})
watch(
  () => [props.ctfSession, props.conversation?.ctfJobId, props.ctfRole, props.running] as const,
  async ([ctfSession, jobId, _role, running]) => {
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
      if (architecturePath.value) await refreshArchitecturePreview()
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="relative flex min-w-0 flex-1 overflow-hidden bg-surface-editor">
  <main class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-editor">
    <WorkspaceModuleTopBar
      :module="topbarModule"
      :subtitle="topbarPresentation.subtitle"
    >
      <template v-if="ctfSession || vulnerabilitySession" #badge>
        <Badge variant="secondary" class="max-w-full truncate">
          {{ ctfSession ? ctfRoleLabel : 'CVE 接力' }}
        </Badge>
      </template>
      <template #actions>
        <Button
          v-if="ctfSession"
          variant="ghost"
          size="sm"
          aria-label="返回 CTF 工作台"
          @click="$emit('returnCtf')"
        >
          <Flag class="size-4" />
          返回工作台
        </Button>
        <Button
          v-if="vulnerabilitySession"
          variant="ghost"
          size="sm"
          aria-label="返回 CVE 工作台"
          @click="$emit('returnVuln')"
        >
          <ShieldCheck class="size-4" />
          返回 CVE
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="environmentOpen ? '关闭右侧栏' : '打开右侧栏'"
          :title="environmentOpen ? '关闭右侧栏' : '打开右侧栏'"
          @click="environmentOpen = !environmentOpen"
        >
          <PanelRightClose v-if="environmentOpen" class="size-4" />
          <PanelRightOpen v-else class="size-4" />
        </Button>
        <WorkspaceSettingsButton label="打开设置" @click="$emit('openSettings')" />
      </template>
    </WorkspaceModuleTopBar>

    <div ref="scrollArea" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!conversation?.messages.length" class="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-16">
        <Bot class="size-6 text-muted-foreground" />
        <h2 class="mt-5 text-body font-medium">{{ topbarPresentation.title }}</h2>
        <p class="mt-2 max-w-lg text-body leading-6 text-muted-foreground">
          {{ ctfSession
            ? '从 CTF 工作台启动 Agent 后，会在这里继续解题、工具协作和复盘。'
            : '选择项目并描述目标。MilkSU 使用 PI，并由当前执行模式和权限策略决定可用工具。' }}
        </p>
        <div class="mt-6 grid grid-cols-3 gap-3">
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <Files class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">理解项目</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">搜索并读取相关代码</p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <FilePenLine class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">修改文件</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">直接完成可审查的改动</p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <Terminal class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">运行命令</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">构建、测试与验证结果</p>
          </div>
        </div>
        <div class="mt-6 flex items-center gap-2">
          <Button v-if="!workspacePath" @click="$emit('chooseWorkspace')">
            <FolderOpen class="size-4" />
            选择项目目录
          </Button>
          <Badge v-else variant="outline" class="max-w-md truncate">
            {{ workspacePath }}
          </Badge>
          <Button v-if="!hasCredential" variant="outline" @click="$emit('openSettings')">
            <KeyRound class="size-4" />
            配置模型
          </Button>
        </div>
      </div>

      <div v-else class="mx-auto max-w-3xl px-8 py-8">
        <template v-for="item in chatTranscript" :key="item.id">
          <ChatActivityGroup
            v-if="item.kind === 'activity'"
            :activity="item"
          />
          <ChatMessageItem
            v-else
            :message="item.message"
            :recoverable="item.message.id === recoverableFailureId"
            :recovery-context="ctfSession ? 'ctf' : 'coding'"
            @respond-approval="(requestId, approved) => $emit('respondApproval', requestId, approved)"
            @retry="resumeAfterFailure"
          />
        </template>
      </div>
    </div>

    <ChatComposer
      :running="running"
      :aborting="aborting"
      :ctf-session="ctfSession"
      :ctf-mode="ctfMode"
      :ctf-role="ctfRole"
      :goal-mode="goalMode"
      :execution-mode="effectiveExecutionMode"
      :approval-policy="effectiveApprovalPolicy"
      :approval-label="approvalMenuLabel"
      :model-key="currentModelKey"
      :automatic-model-label="automaticModelLabel"
      :compact-model-label="compactModelLabel"
      @send="sendComposerMessage"
      @ctf-action="$emit('ctfAction', $event)"
      @abort="$emit('abort')"
      @change-execution-mode="changeExecutionMode"
      @change-approval-policy="changeApprovalPolicy"
      @change-model="changeModel"
      @show-permissions="showCodingPermissions"
      @consume-goal="goalMode = false"
    />
  </main>
  <aside
    v-if="environmentOpen"
    class="context-sidebar flex shrink-0 flex-col border-l border-border bg-card/95 backdrop-blur"
    :class="['architecture', 'artifacts', 'changes', 'terminal', 'collaboration'].includes(contextPanel)
      ? 'w-[min(36rem,36vw)] min-w-[22rem]'
      : 'w-80'"
    :aria-label="contextPanelTitle"
  >
    <header class="app-drag flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <Select
        :model-value="contextPanel"
        @update:model-value="value => changeContextPanel(String(value ?? ''))"
      >
        <SelectTrigger
          size="sm"
          class="app-no-drag min-w-44 border-0 bg-transparent px-0 shadow-none"
          aria-label="选择右侧页面"
        >
          <Activity v-if="contextPanel === 'environment'" class="size-4 text-primary" />
          <FileDiff v-else-if="contextPanel === 'changes'" class="size-4 text-primary" />
          <Terminal v-else-if="contextPanel === 'terminal'" class="size-4 text-primary" />
          <FileImage v-else-if="contextPanel === 'artifacts'" class="size-4 text-primary" />
          <Network v-else-if="contextPanel === 'architecture'" class="size-4 text-primary" />
          <Globe2 v-else-if="contextPanel === 'browser'" class="size-4 text-primary" />
          <Wrench v-else-if="contextPanel === 'collaboration'" class="size-4 text-primary" />
          <CircleDot v-else class="size-4 text-primary" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent size="sm" align="start" class="min-w-56">
          <SelectItem value="environment">{{ ctfSession ? '解题环境' : '环境信息' }}</SelectItem>
          <SelectItem v-if="!ctfSession" value="changes">变更</SelectItem>
          <SelectItem v-if="!ctfSession" value="terminal">终端</SelectItem>
          <SelectItem v-if="!ctfSession" value="artifacts">产物</SelectItem>
          <SelectItem v-if="!ctfSession" value="architecture">架构图</SelectItem>
          <SelectItem value="browser">{{ ctfSession ? '浏览器' : '浏览器与 App' }}</SelectItem>
          <SelectItem v-if="!ctfSession" value="collaboration">Agent 协作</SelectItem>
          <template v-if="ctfSession">
            <SelectSeparator />
            <SelectItem value="collaboration">Agent 协作</SelectItem>
            <SelectItem value="evidence">证据与 Judge</SelectItem>
          </template>
        </SelectContent>
      </Select>
      <div class="app-no-drag flex items-center gap-1">
        <Button
          v-if="contextPanel !== 'terminal'"
          variant="ghost"
          size="icon-sm"
          :disabled="environmentLoading || architecturePreviewLoading"
          :aria-label="`刷新${contextPanelTitle}`"
          @click="refreshContextPanel"
        >
          <RefreshCw
            class="size-4"
            :class="{ 'animate-spin': environmentLoading || architecturePreviewLoading }"
          />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭右侧栏"
          @click="environmentOpen = false"
        >
          <PanelRightClose class="size-4" />
        </Button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="contextPanel === 'environment'">
        <div v-if="environmentError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ environmentError }}
        </div>

        <section class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium text-muted-foreground">工作区</p>
            <Button
              v-if="!ctfSession && !workspaceLocked"
              type="button"
              variant="ghost"
              size="sm"
              @click="$emit('chooseWorkspace')"
            >
              更换
            </Button>
          </div>
          <div class="mt-3 flex items-start gap-3">
            <FolderOpen class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <p class="truncate text-body font-medium">
                {{ codingEnvironment?.workspaceName || workspaceName }}
              </p>
              <p class="mt-1 truncate font-mono text-caption text-muted-foreground" :title="workspacePath">
                {{ workspacePath || '尚未选择项目' }}
              </p>
            </div>
          </div>
        </section>

        <CodingProductLoopPanel
          v-if="!ctfSession"
          :workspace-path="workspacePath"
          :environment="codingEnvironment"
          :message-count="messageCount"
          :tool-message-count="toolMessageCount"
          :running="running"
          :resumed="resumed"
          :compacting="compacting"
          :compacted-at="compactedAt"
          :compaction-error="compactionError"
          :execution-mode="effectiveExecutionMode"
          :approval-policy="effectiveApprovalPolicy"
          :browser-status="codingBrowserStatus"
          :computer-use-status="computerUseStatus"
          :artifact-preview-evidence="artifactPreviewEvidence"
          :browser-evidence="browserEvidence"
          :computer-use-evidence="computerUseEvidence"
          :computer-use-operation-evidence="computerUseOperationEvidence"
          :git-delivery-evidence="gitDeliveryEvidence"
          @open-panel="changeContextPanel"
          @compact-context="$emit('compactContext')"
        />

        <section v-if="!ctfSession" class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">任务操作</p>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-between"
                  :disabled="running"
                  aria-label="Coding 快捷动作"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <Sparkles class="size-3.5 shrink-0" />
                    <span class="truncate">直接完成</span>
                  </span>
                  <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                :side-offset="8"
                class="w-[22rem] max-w-[calc(100vw-2rem)] p-1"
              >
                <DropdownMenuLabel class="px-3 pb-2 pt-2 text-label">
                  直接完成
                </DropdownMenuLabel>
                <DropdownMenuItem
                  v-for="option in codingActionOptions"
                  :key="option.kind"
                  class="coding-action-option"
                  @select="runCodingProductAction(option.kind)"
                >
                  <component :is="option.icon" class="mt-0.5 size-4 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <p class="text-label font-medium">{{ option.label }}</p>
                    <p class="mt-0.5 text-caption leading-5 text-muted-foreground">
                      {{ option.description }}
                    </p>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              :variant="goalMode ? 'secondary' : 'outline'"
              size="sm"
              :disabled="running || hasUnfinishedGoal"
              :title="hasUnfinishedGoal
                ? '当前已有持续目标；可在输入区上方暂停、继续或清除'
                : '把下一条消息设为持续目标；Agent 会跨回合推进并验证完成'"
              @click="goalMode = !goalMode"
            >
              <Target class="size-3.5" />
              {{ goalMode ? '已设为目标' : '设为目标' }}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="mt-2 w-full justify-between"
            :disabled="continuity.compactDisabled"
            :title="continuity.compactTitle"
            @click="$emit('compactContext')"
          >
            <span class="flex min-w-0 items-center gap-2">
              <Shrink class="size-3.5 shrink-0" />
              <span class="truncate">
                {{ continuity.compactLabel }}
              </span>
            </span>
            <LoaderCircle
              v-if="compacting"
              class="size-3.5 shrink-0 animate-spin text-primary"
            />
          </Button>
          <div
            class="mt-2 flex flex-wrap items-center gap-1.5"
            :title="continuity.title"
          >
            <span class="text-caption text-muted-foreground">连续性</span>
            <Badge
              v-for="badge in continuity.badges"
              :key="badge"
              variant="outline"
            >
              {{ badge }}
            </Badge>
          </div>
          <p
            v-if="compactionError"
            class="mt-2 text-caption leading-5 text-destructive"
          >
            整理上下文失败：{{ compactionError }}
          </p>
          <div
            v-if="activeGoal || goalMode"
            class="mt-3 rounded-lg bg-primary/[0.07] p-3"
          >
            <div class="flex min-w-0 items-center gap-2">
              <Target class="size-3.5 shrink-0 text-primary" />
              <Badge variant="secondary">
                {{ goalMode && !activeGoal ? '下一条设为目标' : goalStatusLabel }}
              </Badge>
              <span
                v-if="goalUsageLabel"
                class="ml-auto shrink-0 text-caption text-muted-foreground"
              >
                {{ goalUsageLabel }}
              </span>
            </div>
            <p class="mt-2 break-words text-body leading-5">
              {{ activeGoal?.text || '下一条消息会成为持续目标。' }}
            </p>
            <div class="mt-2 flex justify-end gap-1">
              <Button
                v-if="activeGoal && resumableGoal"
                type="button"
                variant="ghost"
                size="sm"
                :disabled="running"
                @click="$emit('controlGoal', 'resume')"
              >
                继续
              </Button>
              <Button
                v-if="activeGoal && !running"
                type="button"
                variant="ghost"
                size="sm"
                aria-label="清除当前目标"
                @click="$emit('controlGoal', 'clear')"
              >
                清除
              </Button>
              <Button
                v-else-if="goalMode && !activeGoal"
                type="button"
                variant="ghost"
                size="sm"
                aria-label="取消目标模式"
                @click="goalMode = false"
              >
                取消
              </Button>
            </div>
          </div>
        </section>

        <template v-if="!ctfSession">
        <section class="border-b border-border px-4 py-4">
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
              <p class="col-span-2 text-caption leading-5 text-muted-foreground">
                {{ capability.detail }}
              </p>
            </div>
          </div>
          <div class="mt-4 border-t border-border/70 pt-4">
            <p class="text-caption font-medium text-muted-foreground">项目 MCP</p>
            <p v-if="mcpConfigLoading" class="mt-2 text-caption text-muted-foreground">
              正在读取项目的 .mcp.json…
            </p>
            <p
              v-else-if="mcpConfig?.problem"
              class="mt-2 text-caption leading-5 text-destructive"
            >
              {{ mcpConfig.problem }}
            </p>
            <p
              v-else-if="!mcpConfig?.configured || !mcpConfig.servers.length"
              class="mt-2 text-caption leading-5 text-muted-foreground"
            >
              当前项目没有可选择的 .mcp.json 服务器。
            </p>
            <template v-else>
              <div class="mt-2 space-y-2">
                <CodingMCPReviewCard
                  v-for="server in mcpConfig.servers"
                  :key="server.name"
                  :server="server"
                  :selected="selectedMCPServers.includes(server.name)"
                  :running="running"
                  @toggle="toggleMCPServer(server)"
                />
              </div>
              <p class="mt-2 text-caption leading-5 text-muted-foreground">
                只接入来源、固定版本、工具白名单和权限面均已审阅的服务器；选择仅绑定当前任务。
                替我审批自动执行连接与只读调用，修改和外部账户授权仍确认。
              </p>
            </template>
          </div>
        </section>
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

        <section class="border-b border-border px-4 py-4">
        <p class="text-caption font-medium text-muted-foreground">Agent</p>
        <div class="mt-3 space-y-3 text-body">
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">状态</span>
            <span class="flex items-center gap-2">
              <span
                class="size-1.5 rounded-full"
                :class="running ? 'animate-pulse bg-primary' : 'bg-muted-foreground'"
              />
              {{ running ? '执行中' : '空闲' }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">模型</span>
            <span class="text-right text-caption leading-5">{{ activeModelLabel }}</span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">插件</span>
            <span class="text-right text-caption leading-5">
              {{ activeExtensions.length ? activeExtensions.map(extensionLabel).join(' · ') : '启动后显示' }}
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

        <section class="px-4 py-4">
        <p class="text-caption font-medium text-muted-foreground">任务上下文</p>
        <div class="mt-3 space-y-3 text-body">
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">消息</span>
            <span>{{ messageCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">工具记录</span>
            <span>{{ toolMessageCount }}</span>
          </div>
          <div v-if="ctfSession" class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">工具工坊</span>
            <span class="text-right text-caption">{{ workshopSummary }}</span>
          </div>
        </div>
        </section>
      </template>

      <template v-else-if="contextPanel === 'changes'">
        <CodingChangesPanel
          :workspace-path="workspacePath"
          :environment="codingEnvironment"
          :running="running"
          @review="runCodingProductAction('review')"
          @refresh="refreshEnvironment"
          @delivery-evidence="recordGitDeliveryEvidence"
        />
      </template>

      <template v-else-if="contextPanel === 'terminal'">
        <CodingTerminalPanel
          :active="environmentOpen && contextPanel === 'terminal'"
          :conversation-id="conversation?.id ?? ''"
          :workspace-path="workspacePath"
          :execution-mode="effectiveExecutionMode"
          :approval-policy="effectiveApprovalPolicy"
        />
      </template>

      <template v-else-if="contextPanel === 'artifacts'">
        <CodingArtifactPreviewPanel
          ref="artifactPanel"
          :workspace-path="workspacePath"
          :environment="codingEnvironment"
          @previewed="recordArtifactPreview"
        />
      </template>

      <template v-else-if="contextPanel === 'architecture'">
        <section class="flex min-h-full flex-col">
          <div class="border-b border-border px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-body font-medium">
                  {{ architecturePreview?.exists ? '当前架构图' : running ? '正在生成架构图' : '尚未生成' }}
                </p>
                <p
                  class="mt-1 truncate font-mono text-caption text-muted-foreground"
                  :title="architecturePath"
                >
                  {{ architecturePath || '请先选择项目' }}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                :disabled="running"
                @click="generateArchitecture"
              >
                <Network class="size-3.5" />
                {{ architecturePreview?.exists ? '重新生成' : '生成' }}
              </Button>
            </div>
          </div>
          <p
            v-if="architecturePreviewError"
            class="border-b border-border px-4 py-3 text-caption leading-5 text-destructive"
          >
            {{ architecturePreviewError }}
          </p>
          <iframe
            v-if="architecturePreview?.exists && architecturePreviewSource"
            class="min-h-[32rem] flex-1 bg-white"
            :srcdoc="architecturePreviewSource"
            sandbox="allow-scripts"
            title="Archify 架构图预览"
          />
          <div
            v-else
            class="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center"
          >
            <LoaderCircle
              v-if="running || architecturePreviewLoading"
              class="size-6 animate-spin text-primary"
            />
            <Network v-else class="size-6 text-muted-foreground" />
            <p class="mt-4 text-label font-medium">
              {{ running ? 'Agent 正在读取仓库、生成并验证' : '点击一次即可生成' }}
            </p>
            <p class="mt-2 max-w-sm text-body leading-6 text-muted-foreground">
              MilkSU 会自动选择系统架构图、标题和输出目录，并要求 Archify 通过 9 项检查。
            </p>
          </div>
        </section>
      </template>

      <template v-else-if="contextPanel === 'browser'">
        <div v-if="browserPanelError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ browserPanelError }}
        </div>
        <section v-if="!ctfSession" class="px-4 py-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-body font-medium">隔离 Coding 浏览器</p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                Playwright 连接到 MilkSU 专用 Chrome；不会读取你日常 Chrome 的登录状态。
              </p>
            </div>
            <span
              class="mt-1 size-2 shrink-0 rounded-full"
              :class="codingBrowserStatus?.enabled ? 'bg-primary' : 'bg-muted-foreground'"
            />
          </div>
          <div class="mt-4 flex gap-2">
            <Input
              v-model="codingBrowserURL"
              :disabled="codingBrowserLoading || codingBrowserStatus?.enabled"
              class="min-w-0 flex-1 font-mono text-caption"
              aria-label="Coding 浏览器初始地址"
              placeholder="http://127.0.0.1:3000"
              @keydown.enter.prevent="startCodingBrowser"
            />
            <Button
              v-if="codingBrowserStatus?.enabled"
              variant="outline"
              size="sm"
              :disabled="codingBrowserLoading"
              @click="stopCodingBrowser"
            >
              停止
            </Button>
            <Button
              v-else
              variant="brand"
              size="sm"
              :disabled="codingBrowserLoading"
              @click="startCodingBrowser"
            >
              <LoaderCircle v-if="codingBrowserLoading" class="size-3.5 animate-spin" />
              <Globe2 v-else class="size-3.5" />
              启动
            </Button>
          </div>
          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            启用后，Agent 可在 Go 模式中使用浏览器；{{ codingBrowserApprovalDetail }}
          </p>
          <div v-if="codingBrowserStatus?.enabled" class="mt-5 border-t border-border pt-4">
            <div class="flex items-center justify-between gap-3 text-caption">
              <span class="font-medium text-foreground">当前页面</span>
              <span class="text-muted-foreground">
                {{ codingBrowserStatus.browserBinary || 'Chrome' }}
              </span>
            </div>
            <div v-if="codingBrowserStatus.pages?.length" class="mt-3 space-y-2">
              <div
                v-for="page in codingBrowserStatus.pages"
                :key="page.id"
                class="rounded-md bg-muted/45 px-3 py-2"
              >
                <p class="truncate text-body">{{ page.title || '未命名页面' }}</p>
                <p class="mt-1 truncate font-mono text-caption text-muted-foreground">
                  {{ page.url }}
                </p>
              </div>
            </div>
            <p v-else class="mt-3 text-caption text-muted-foreground">
              Chrome 已启动，等待页面就绪。
            </p>
            <div
              v-if="codingBrowserEvidencePath"
              class="mt-4 rounded-md border border-border bg-muted/35 px-3 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="text-caption font-medium text-foreground">浏览器证据</p>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="codingBrowserEvidenceLoading"
                  aria-label="在 Finder 中显示浏览器证据"
                  @click="revealCodingBrowserEvidence"
                >
                  <LoaderCircle
                    v-if="codingBrowserEvidenceLoading"
                    class="size-3.5 animate-spin"
                  />
                  <FolderOpen v-else class="size-3.5" />
                  在 Finder 中显示
                </Button>
              </div>
              <p class="mt-1 break-all font-mono text-caption text-muted-foreground">
                {{ codingBrowserEvidencePath }}
              </p>
              <p class="mt-2 text-caption leading-5 text-muted-foreground">
                页面快照、Console、Network 和截图由 Agent 明确采集；显式证据文件只能写入此目录。
              </p>
              <p
                v-if="codingBrowserEvidenceError"
                class="mt-2 text-caption text-destructive"
              >
                {{ codingBrowserEvidenceError }}
              </p>
              <p
                v-else-if="codingBrowserEvidenceRevealed"
                class="mt-2 text-caption text-foreground"
              >
                已在 Finder 中打开该目录。
              </p>
            </div>
          </div>
          <CodingComputerUsePanel
            v-model:selected-target-key="selectedComputerUseTargetKey"
            :status="computerUseStatus"
            :targets="computerUseTargets"
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
        <template v-else>
          <section class="border-b border-border px-4 py-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-body font-medium">MilkSU Chrome Bridge</p>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{
                    nssctfBrowserStatus?.bridge.connected || ctfshowBrowserStatus?.bridge.connected
                      ? '扩展已连接'
                      : '等待扩展连接'
                  }}
                </p>
              </div>
              <span
                class="size-2 rounded-full"
                :class="nssctfBrowserStatus?.bridge.connected || ctfshowBrowserStatus?.bridge.connected
                  ? 'bg-primary'
                  : 'bg-muted-foreground'"
              />
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" @click="revealBrowserExtension">
                查看扩展
              </Button>
              <Button
                v-if="nssctfBrowserStatus?.bridge.pairingCode"
                variant="ghost"
                size="sm"
                @click="copyPairingCode(nssctfBrowserStatus.bridge.pairingCode)"
              >
                <Copy class="size-3.5" />
                复制配对码
              </Button>
            </div>
          </section>
          <section class="border-b border-border px-4 py-4">
            <p class="text-caption font-medium text-muted-foreground">
              NSSCTF · {{ nssctfBrowserStatus?.pages.length ?? 0 }} 个页面
            </p>
            <div v-if="nssctfBrowserStatus?.pages.length" class="mt-3 space-y-2">
              <button
                v-for="page in nssctfBrowserStatus.pages"
                :key="page.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                @click="openSharedBrowserPage(page.url)"
              >
                <Globe2 class="mt-0.5 size-4 shrink-0 text-primary" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-body">{{ page.title }}</span>
                  <span class="mt-0.5 block truncate text-caption text-muted-foreground">
                    P{{ page.nssctf.problemId }} · {{ page.connected ? '已连接' : '已断开' }}
                  </span>
                </span>
                <ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <p v-else class="mt-3 text-caption text-muted-foreground">没有共享的 NSSCTF 页面。</p>
          </section>
          <section class="px-4 py-4">
            <p class="text-caption font-medium text-muted-foreground">
              CTFshow · {{ ctfshowBrowserStatus?.pages.length ?? 0 }} 个页面
            </p>
            <div v-if="ctfshowBrowserStatus?.pages.length" class="mt-3 space-y-2">
              <button
                v-for="page in ctfshowBrowserStatus.pages"
                :key="page.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                @click="openSharedBrowserPage(page.url)"
              >
                <Globe2 class="mt-0.5 size-4 shrink-0 text-primary" />
                <span class="min-w-0 flex-1 truncate text-body">{{ page.title }}</span>
                <ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <p v-else class="mt-3 text-caption text-muted-foreground">没有共享的 CTFshow 页面。</p>
          </section>
        </template>
      </template>

      <template v-else-if="contextPanel === 'collaboration'">
        <CodingCollaborationPanel
          v-if="!ctfSession"
          ref="collaborationPanel"
          :conversation-id="conversation?.id"
          :workspace-path="workspacePath"
          :running="running"
          :ensure-conversation="ensureConversation"
        />
        <template v-else>
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
  </aside>
  </section>
</template>

<style scoped>
.chat-main {
  container-name: chat-main;
  container-type: inline-size;
}

.coding-action-option {
  display: flex;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
}

@media (max-width: 68.75rem) {
  .context-sidebar {
    width: 20rem;
  }
}

@media (max-width: 56rem) {
  .context-sidebar {
    position: absolute;
    inset-block: 0;
    right: 0;
    width: min(20rem, calc(100% - 3rem));
    z-index: 20;
    box-shadow: -18px 0 40px rgb(0 0 0 / 28%);
  }
}

</style>
