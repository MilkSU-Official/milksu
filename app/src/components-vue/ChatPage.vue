<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@felinic/ui'
import {
  Activity,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleDot,
  Compass,
  Copy,
  ExternalLink,
  FileDiff,
  FilePenLine,
  FileText,
  Files,
  Flag,
  FolderOpen,
  GitBranch,
  Globe2,
  Hand,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Network,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Puzzle,
  RefreshCw,
  Route,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  StickyNote,
  Target,
  Terminal,
  Wrench,
  X,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import ChatActivityGroup from '@/components-vue/ChatActivityGroup.vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import CodingChangesPanel from '@/components-vue/CodingChangesPanel.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import type {
  CodingArchitecturePreview,
  CodingBackgroundTask,
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingMCPConfigSnapshot,
  CodingRuntimeStatus,
} from '@/codingEnvironmentTypes'
import type { CTFShowCatalogStatus } from '@/ctfshowTypes'
import { buildChatTranscript } from '@/lib/chatActivity'
import { buildCodingArchitectureAction } from '@/lib/codingArchitecture'
import {
  codingProductAction,
  codingProductActions,
  codingReviewPrompt,
  type CodingProductActionKind,
} from '@/lib/codingProductActions'
import {
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
} from '@/lib/codingPolicy'
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
import { PROVIDER_GROUPS, providerModelLabel } from '@/types'

const props = defineProps<{
  conversation: Conversation | null
  settings: AppSettings | null
  workspacePath: string
  running: boolean
  ctfSession: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
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
  controlGoal: [action: 'resume' | 'clear']
  openSettings: []
  returnCtf: []
  switchCtfAgent: [role: 'solver' | 'tool-builder' | 'strategist']
}>()

const draft = ref('')
const goalMode = ref(false)
const pendingAttachments = ref<CodingAttachment[]>([])
const attachmentError = ref('')
const scrollArea = ref<HTMLElement | null>(null)
const workshopState = ref<CTFToolWorkshopState | null>(null)
const environmentOpen = ref(!props.ctfSession)
const contextPanel = ref<
  'environment' | 'changes' | 'architecture' | 'browser' | 'collaboration' | 'evidence'
>('environment')
const environmentLoading = ref(false)
const environmentError = ref('')
const architecturePreview = ref<CodingArchitecturePreview | null>(null)
const architecturePreviewLoading = ref(false)
const architecturePreviewError = ref('')
const requestedArchitecturePath = ref('')
const browserPanelError = ref('')
const nssctfBrowserStatus = ref<NSSCTFWebBridgeStatus | null>(null)
const ctfshowBrowserStatus = ref<CTFShowCatalogStatus | null>(null)
const codingEnvironment = ref<CodingEnvironmentSnapshot | null>(null)
const codingRuntime = ref<CodingRuntimeStatus | null>(null)
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
const capabilityCount = computed(() => new Set([
  ...activeExtensions.value,
  ...(selectedMCPServers.value.length ? ['pi-mcp-adapter'] : []),
]).size)
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
const effectiveExecutionMode = computed(() => (
  normalizeCodingExecutionMode(props.executionMode)
))
const effectiveApprovalPolicy = computed(() => (
  normalizeCodingApprovalPolicy(props.approvalPolicy)
))
const codingCapabilities = computed(() => (
  props.conversation?.agentCapabilities?.length
    ? props.conversation.agentCapabilities
    : previewCodingCapabilities(
        effectiveExecutionMode.value,
        effectiveApprovalPolicy.value,
      )
))
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
  return effectiveModelMode.value === 'auto' ? `自动 · ${modelName}` : modelName
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
        : value
)
const extensionDescription = (value: string) => (
  value === 'milksu-workflow'
    ? '计划可见、角色工作流与结果验证'
    : value === 'pi-lsp'
      ? '固定 Go / Vue / TypeScript 路由；需本机安装对应语言服务器'
      : value === 'pi-goal'
        ? '持续推进用户目标，跨回合恢复，并要求完成或受阻证据'
        : value === 'pi-background-tasks'
          ? '复用社区持久任务、条件等待和日志管理；进程仍受 MilkSU 权限策略约束'
          : value === 'pi-mcp-adapter'
            ? '复用社区 MCP 适配器；仅加载当前任务明确勾选的服务器'
        : '已由 MilkSU 白名单加载'
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
const backgroundTasks = computed(() => {
  const runtime = codingRuntime.value
  if (!runtime?.backgroundTasks?.length) return []
  const resolvedWorkspace = codingEnvironment.value?.workspace || props.workspacePath
  if (runtime.workspace && resolvedWorkspace && runtime.workspace !== resolvedWorkspace) return []
  return runtime.backgroundTasks
})
const backgroundTaskLabel = (task: CodingBackgroundTask) => (
  task.name || task.command || task.id
)
const backgroundTaskStatusLabel = (status: CodingBackgroundTask['status']) => {
  if (status === 'running') return '运行中'
  if (status === 'succeeded') return '已完成'
  if (status === 'cancelled') return '已停止'
  if (status === 'timed_out') return '超时'
  return '失败'
}
const backgroundTaskElapsed = (task: CodingBackgroundTask) => {
  const elapsed = Math.max(0, (task.endedAt ?? Date.now()) - task.startedAt)
  const seconds = Math.round(elapsed / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
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
const chatTranscript = computed(() => (
  buildChatTranscript(props.conversation?.messages ?? [], props.running)
))
const latestJudge = computed(() => ctfProjection.value?.judgeReceipts.at(-1))
const contextPanelTitle = computed(() => ({
  environment: props.ctfSession ? '解题环境' : '环境信息',
  changes: '变更',
  architecture: '架构图',
  browser: '浏览器',
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
const ctfActionOptions = computed(() => {
  const mode = props.ctfMode ?? 'copilot'
  const modeRule = mode === 'coach'
    ? '保持教练模式，不要直接给完整解法或候选 Flag。'
    : mode === 'delegate'
      ? '保持代理模式，可以自主检查工作区，但不要向外部平台提交。'
      : '保持搭档模式，每次只推进一个可复核实验。'
  return [
    {
      label: '梳理题面',
      icon: markRaw(Compass),
      action: {
        kind: 'orient',
        prompt: `先暂停执行。结合 TASK.md、题面和材料，用三点说明目标、现有证据和最合理的第一步。${modeRule}`,
      } satisfies CTFChatAction,
    },
    {
      label: '提示 1',
      icon: markRaw(Lightbulb),
      action: {
        kind: 'hint',
        level: 1,
        prompt: '我需要一级提示。只指出一个应该关注的证据、概念或材料，不给命令、完整解法或候选 Flag；最后问我一个检查理解的问题。',
      } satisfies CTFChatAction,
    },
    {
      label: '提示 2',
      icon: markRaw(Route),
      action: {
        kind: 'hint',
        level: 2,
        prompt: '我需要二级提示。基于当前轨迹给出一个可执行且可验证的下一步实验，说明预期观察，但不要透露候选 Flag。',
      } satisfies CTFChatAction,
    },
    {
      label: '重新规划',
      icon: markRaw(StickyNote),
      action: {
        kind: 'replan',
        prompt: '暂停当前路线，读取 notes.md 和已有轨迹，列出已证伪假设、仍成立的证据和最多三个下一步；选择信息增益最高的一步再继续。',
      } satisfies CTFChatAction,
    },
  ]
})

function submit() {
  const attachments = [...pendingAttachments.value]
  const text = draft.value.trim()
    || (attachments.length ? '请检查这些附件并完成我接下来需要处理的任务。' : '')
  if (!text || props.running) return
  const prompt = !props.ctfSession && goalMode.value
    ? `/goal ${text}`
    : text
  draft.value = ''
  pendingAttachments.value = []
  attachmentError.value = ''
  goalMode.value = false
  emit('send', prompt, text, attachments)
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

async function chooseCodingAttachments() {
  if (props.running || props.ctfSession) return
  attachmentError.value = ''
  try {
    const selected = await invokeCommand<CodingAttachment[]>('choose_coding_attachments')
    const merged = new Map(
      pendingAttachments.value.map(value => [`${value.id}:${value.name}`, value]),
    )
    for (const attachment of selected) {
      merged.set(`${attachment.id}:${attachment.name}`, attachment)
    }
    if (merged.size > 8) {
      attachmentError.value = '每条消息最多添加 8 个附件。'
      return
    }
    pendingAttachments.value = [...merged.values()]
  } catch (reason) {
    attachmentError.value = reason instanceof Error
      ? reason.message
      : '暂时无法添加附件。'
  }
}

function removeCodingAttachment(attachment: CodingAttachment) {
  pendingAttachments.value = pendingAttachments.value.filter(value => (
    value.id !== attachment.id || value.name !== attachment.name
  ))
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

function toggleMCPServer(name: string) {
  if (props.running || !mcpConfig.value?.digest) return
  const selection = new Set(selectedMCPServers.value)
  if (selection.has(name)) selection.delete(name)
  else selection.add(name)
  emit(
    'changeMcpServers',
    [...selection].sort((left, right) => left.localeCompare(right)),
    mcpConfig.value.digest,
  )
}

function selectMCPServer(event: Event, name: string) {
  event.preventDefault()
  toggleMCPServer(name)
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
    codingRuntime.value = null
    return
  }
  environmentLoading.value = true
  try {
    codingEnvironment.value = await invokeCommand<CodingEnvironmentSnapshot>(
      'get_coding_environment',
      { workspacePath: props.workspacePath },
    )
    try {
      codingRuntime.value = await invokeCommand<CodingRuntimeStatus>('get_runtime_status')
    } catch {
      codingRuntime.value = null
    }
  } catch (reason) {
    codingEnvironment.value = null
    codingRuntime.value = null
    environmentError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取项目环境。'
  } finally {
    environmentLoading.value = false
  }
}

async function refreshRuntimeStatus() {
  if (props.ctfSession || !props.workspacePath) {
    codingRuntime.value = null
    return
  }
  try {
    codingRuntime.value = await invokeCommand<CodingRuntimeStatus>('get_runtime_status')
  } catch {
    codingRuntime.value = null
  }
}

async function refreshBrowserPanel() {
  browserPanelError.value = ''
  if (!props.ctfSession) {
    nssctfBrowserStatus.value = null
    ctfshowBrowserStatus.value = null
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

async function refreshContextPanel() {
  if (contextPanel.value === 'architecture') {
    await refreshArchitecturePreview()
    return
  }
  if (contextPanel.value === 'browser') {
    await refreshBrowserPanel()
    return
  }
  await Promise.all([refreshEnvironment(), loadWorkshopState()])
}

function changeContextPanel(value: string) {
  if (!['environment', 'changes', 'architecture', 'browser', 'collaboration', 'evidence'].includes(value)) return
  contextPanel.value = value as typeof contextPanel.value
  environmentOpen.value = true
  void refreshContextPanel()
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

watch(() => props.conversation?.messages.length, async () => {
  await nextTick()
  if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
  if (!props.ctfSession && environmentOpen.value && contextPanel.value === 'environment') {
    await refreshRuntimeStatus()
  }
})
watch(() => props.ctfSession, (current, previous) => {
  if (current !== previous) {
    environmentOpen.value = !current
    contextPanel.value = 'environment'
  }
})
watch(() => props.conversation?.id, () => {
  goalMode.value = false
})
watch(
  () => [props.ctfSession, props.workspacePath] as const,
  () => void refreshMCPConfig(),
  { immediate: true },
)
watch(contextPanel, panel => {
  if (panel === 'browser' && environmentOpen.value) void refreshBrowserPanel()
  if (panel === 'architecture' && environmentOpen.value) void refreshArchitecturePreview()
  if (panel === 'changes' && environmentOpen.value) void refreshEnvironment()
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
    <header
      class="chat-toolbar app-drag shrink-0"
      :class="{ 'chat-toolbar--ctf': ctfSession }"
    >
      <div class="chat-toolbar__summary min-w-0">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <p class="truncate text-control font-medium">Coding</p>
          <Badge v-if="ctfSession" variant="secondary" class="max-w-full truncate">
            {{ ctfRoleLabel }}
          </Badge>
        </div>
        <p class="truncate text-caption text-muted-foreground">
          {{ conversation?.title ?? '新编码任务' }}
          · {{ workspacePath || `临时工作区 · ${codingPolicyLabel}` }}
        </p>
      </div>
      <div class="chat-toolbar__actions app-no-drag flex min-w-0 items-center gap-2">
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
      </div>
    </header>

    <div ref="scrollArea" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!conversation?.messages.length" class="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-16">
        <Bot class="size-6 text-muted-foreground" />
        <h1 class="mt-5 text-3xl font-semibold tracking-[-0.04em]">Coding</h1>
        <p class="mt-2 max-w-lg text-body leading-6 text-muted-foreground">
          选择项目并描述目标。MilkSU 使用 PI，并由当前执行模式和权限策略决定可用工具。
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
            @respond-approval="(requestId, approved) => $emit('respondApproval', requestId, approved)"
          />
        </template>
      </div>
    </div>

    <div class="chat-composer shrink-0 bg-surface-editor px-5 pb-4 pt-2">
      <div class="mx-auto max-w-3xl">
        <div
          v-if="!ctfSession && (activeGoal || goalMode)"
          class="chat-goal-strip mb-2 flex min-w-0 items-center gap-2 px-2"
        >
          <Target class="size-3.5 shrink-0 text-primary" />
          <Badge variant="secondary">
            {{ goalMode && !activeGoal ? '下一条设为目标' : goalStatusLabel }}
          </Badge>
          <span class="min-w-0 flex-1 truncate text-control">
            {{ activeGoal?.text || 'Agent 会持续推进，直到验证完成、暂停或确认受阻。' }}
          </span>
          <span v-if="goalUsageLabel" class="shrink-0 text-caption text-muted-foreground">
            {{ goalUsageLabel }}
          </span>
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
            size="icon-sm"
            aria-label="清除当前目标"
            title="清除当前目标"
            @click="$emit('controlGoal', 'clear')"
          >
            <X class="size-3.5" />
          </Button>
          <Button
            v-else-if="goalMode && !activeGoal"
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="取消目标模式"
            title="取消目标模式"
            @click="goalMode = false"
          >
            <X class="size-3.5" />
          </Button>
        </div>
        <div class="chat-composer__controls app-no-drag mb-2 flex min-w-0 items-center gap-1.5 px-1">
          <Button
            variant="ghost"
            size="sm"
            class="chat-composer__control chat-composer__workspace min-w-0"
            :disabled="workspaceLocked"
            :title="workspaceLocked ? '项目目录在任务开始后锁定；请新建任务来切换项目' : '选择项目目录'"
            @click="$emit('chooseWorkspace')"
          >
            <FolderOpen class="size-3.5 shrink-0" />
            <span class="truncate">{{ workspacePath ? workspaceName : '项目' }}</span>
          </Button>
          <DropdownMenu v-if="!ctfSession">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="chat-composer__control"
                :disabled="running"
                aria-label="Coding 快捷动作"
              >
                <Sparkles class="size-3.5 shrink-0" />
                动作
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
            v-if="!ctfSession"
            :variant="goalMode ? 'secondary' : 'ghost'"
            size="sm"
            class="chat-composer__control"
            :disabled="running || hasUnfinishedGoal"
            :title="hasUnfinishedGoal
              ? '当前已有持续目标；可在上方暂停、继续或清除'
              : '把下一条消息设为持续目标；Agent 会跨回合推进并验证完成'"
            @click="goalMode = !goalMode"
          >
            <Target class="size-3.5" />
            目标
          </Button>
          <Button
            v-if="!ctfSession"
            variant="ghost"
            size="sm"
            class="chat-composer__control"
            :disabled="running"
            title="自动读取当前仓库，使用 Archify 生成、验证并在右侧预览"
            @click="generateArchitecture"
          >
            <Network class="size-3.5" />
            架构图
          </Button>
          <Select
            v-if="!ctfSession"
            :model-value="effectiveExecutionMode"
            :disabled="running"
            @update:model-value="value => changeExecutionMode(String(value ?? ''))"
          >
            <SelectTrigger
              size="sm"
              class="chat-composer__control w-16 border-0 bg-transparent shadow-none"
              aria-label="Coding 执行模式"
              title="Plan 只分析和规划；Go 按右侧权限策略使用工具。"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent size="sm" align="start">
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="go">Go</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu v-if="!ctfSession">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="chat-composer__control chat-composer__permission min-w-32 justify-start"
                :class="{ 'chat-composer__permission--full': effectiveApprovalPolicy === 'full-auto' }"
                :disabled="running"
                aria-label="Coding 权限策略"
              >
                <ShieldAlert
                  v-if="effectiveApprovalPolicy === 'full-auto'"
                  class="size-3.5 shrink-0 text-warning"
                />
                <LockKeyhole v-else class="size-3.5 shrink-0" />
                {{ approvalMenuLabel }}
                <ChevronDown class="ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              :side-offset="8"
              class="w-[25rem] max-w-[calc(100vw-2rem)] p-0"
            >
              <div class="flex items-center justify-between gap-4 px-4 pb-2 pt-3">
                <p class="text-label font-medium text-muted-foreground">
                  应如何批准 MilkSU 操作？
                </p>
                <button
                  type="button"
                  class="shrink-0 text-label font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  @click.stop="showCodingPermissions"
                >
                  了解更多
                </button>
              </div>
              <DropdownMenuItem
                class="approval-option"
                @select="changeApprovalPolicy('ask')"
              >
                <Hand class="approval-option__icon" />
                <div class="min-w-0 flex-1">
                  <p class="approval-option__title">请求批准</p>
                  <p class="approval-option__description">
                    编辑文件、运行命令或使用互联网前始终询问
                  </p>
                </div>
                <Check
                  v-if="effectiveApprovalPolicy === 'ask' || effectiveApprovalPolicy === 'read-only'"
                  class="approval-option__check"
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                class="approval-option"
                @select="changeApprovalPolicy('workspace-auto')"
              >
                <ShieldCheck class="approval-option__icon" />
                <div class="min-w-0 flex-1">
                  <p class="approval-option__title">替我审批</p>
                  <p class="approval-option__description">
                    项目内自动执行；越过项目边界或高风险操作时拦截
                  </p>
                </div>
                <Check
                  v-if="effectiveApprovalPolicy === 'workspace-auto'"
                  class="approval-option__check"
                />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="approval-option approval-option--full"
                @select="changeApprovalPolicy('full-auto')"
              >
                <ShieldAlert class="approval-option__icon" />
                <div class="min-w-0 flex-1">
                  <p class="approval-option__title">完全访问权限</p>
                  <p class="approval-option__description">
                    可不受限制地访问互联网和当前用户可访问的任何文件
                  </p>
                </div>
                <Check
                  v-if="effectiveApprovalPolicy === 'full-auto'"
                  class="approval-option__check"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                class="chat-composer__control"
                :aria-label="`查看本任务能力，${capabilityCount} 个扩展`"
              >
                <Puzzle class="size-3.5" />
                能力
                <Badge v-if="capabilityCount" variant="secondary">
                  {{ capabilityCount }}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-80">
              <DropdownMenuLabel>本任务已启用</DropdownMenuLabel>
              <div v-if="activeExtensions.length" class="space-y-2 px-2 py-2">
                <div
                  v-for="extension in activeExtensions"
                  :key="extension"
                  class="flex items-start gap-2"
                >
                  <Check class="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div>
                    <p class="text-body font-medium">{{ extensionLabel(extension) }}</p>
                    <p class="text-caption text-muted-foreground">
                      {{ extensionDescription(extension) }}
                    </p>
                  </div>
                </div>
              </div>
              <p v-else class="px-2 py-3 text-caption text-muted-foreground">
                启动一次 Agent 任务后显示实际加载结果。
              </p>
              <template v-if="activeSkills.length">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>技能</DropdownMenuLabel>
                <div class="flex flex-wrap gap-1.5 px-2 py-2">
                  <Badge v-for="skill in activeSkills" :key="skill" variant="outline">
                    {{ skill }}
                  </Badge>
                </div>
              </template>
              <template v-if="activeTools.length">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>工具 · {{ activeTools.length }}</DropdownMenuLabel>
                <p class="px-2 pb-2 text-caption leading-5 text-muted-foreground">
                  {{ activeTools.join(' · ') }}
                </p>
              </template>
              <template v-if="!ctfSession">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>项目 MCP</DropdownMenuLabel>
                <p v-if="mcpConfigLoading" class="px-2 py-3 text-caption text-muted-foreground">
                  正在读取项目的 .mcp.json…
                </p>
                <p
                  v-else-if="mcpConfig?.problem"
                  class="px-2 py-3 text-caption leading-5 text-destructive"
                >
                  {{ mcpConfig.problem }}
                </p>
                <p
                  v-else-if="!mcpConfig?.configured || !mcpConfig.servers.length"
                  class="px-2 py-3 text-caption leading-5 text-muted-foreground"
                >
                  当前项目没有可选择的 .mcp.json 服务器。
                </p>
                <template v-else>
                  <DropdownMenuItem
                    v-for="server in mcpConfig.servers"
                    :key="server.name"
                    class="gap-2"
                    :disabled="running"
                    @select="selectMCPServer($event, server.name)"
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Check
                        v-if="selectedMCPServers.includes(server.name)"
                        class="size-3.5 text-primary"
                      />
                    </span>
                    <span class="min-w-0 flex-1 truncate">{{ server.name }}</span>
                    <Badge variant="outline">{{ server.transport }}</Badge>
                  </DropdownMenuItem>
                  <p class="px-2 pb-2 pt-1 text-caption leading-5 text-muted-foreground">
                    只接入本任务勾选的服务器；连接、认证与工具调用仍逐次批准。
                  </p>
                </template>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>权限能力 · {{ codingPolicyLabel }}</DropdownMenuLabel>
                <div class="space-y-2 px-2 py-2">
                  <div
                    v-for="capability in codingCapabilities"
                    :key="capability.id"
                    class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5"
                  >
                    <p class="text-body font-medium">{{ capability.label }}</p>
                    <Badge
                      :variant="capability.status === 'allowed' ? 'secondary' : 'outline'"
                    >
                      {{ capabilityStatusLabel(capability.status) }}
                    </Badge>
                    <p class="col-span-2 text-caption leading-5 text-muted-foreground">
                      {{ capability.detail }}
                    </p>
                  </div>
                </div>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select
            :model-value="currentModelKey"
            :disabled="running"
            @update:model-value="value => changeModel(String(value ?? ''))"
          >
            <SelectTrigger
              size="sm"
              class="chat-composer__control chat-composer__model min-w-0 border-0 bg-transparent shadow-none"
              aria-label="选择本任务模型"
              :title="effectiveModelMode === 'auto'
                ? 'MilkSU 按任务角色自动选择模型；你可以仅为当前对话覆盖'
                : '当前对话固定使用所选模型'"
            >
              <SelectValue>{{ compactModelLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent size="sm" align="start" :align-offset="0" class="min-w-96">
              <SelectGroup>
                <SelectLabel>自动</SelectLabel>
                <SelectItem value="auto">
                  {{ automaticModelLabel }}
                </SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <template
                v-for="(group, groupIndex) in PROVIDER_GROUPS"
                :key="group.kind"
              >
                <SelectSeparator v-if="groupIndex > 0" />
                <SelectGroup>
                  <SelectLabel>{{ group.label }}</SelectLabel>
                  <template v-for="provider in group.providers" :key="provider.id">
                    <SelectItem
                      v-for="model in provider.models"
                      :key="`${provider.id}:${model}`"
                      :value="`manual:${provider.id}:${model}`"
                    >
                      {{ providerModelLabel(provider.id, model) }}
                    </SelectItem>
                  </template>
                </SelectGroup>
              </template>
            </SelectContent>
          </Select>
        </div>

        <div
          v-if="ctfSession && ctfRole === 'solver'"
          class="mb-2 flex flex-wrap items-center gap-2 px-1"
          aria-label="CTF 快捷协作"
        >
          <span class="mr-1 text-caption text-muted-foreground">快捷协作</span>
          <Button
            v-for="option in ctfActionOptions"
            :key="option.label"
            type="button"
            variant="outline"
            size="sm"
            :disabled="running"
            @click="$emit('ctfAction', option.action)"
          >
            <component :is="option.icon" class="size-3.5" />
            {{ option.label }}
          </Button>
        </div>

        <form class="chat-composer__island flex flex-col gap-1" @submit.prevent="submit">
          <div
            v-if="pendingAttachments.length"
            class="flex flex-wrap gap-2 px-1 pb-1"
            aria-label="待发送附件"
          >
            <span
              v-for="attachment in pendingAttachments"
              :key="`${attachment.id}:${attachment.name}`"
              class="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-caption"
              :title="`${attachment.mediaType} · ${formatAttachmentSize(attachment.size)}`"
            >
              <FileText class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="max-w-52 truncate">{{ attachment.name }}</span>
              <button
                type="button"
                class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="`移除 ${attachment.name}`"
                @click="removeCodingAttachment(attachment)"
              >
                <X class="size-3.5" />
              </button>
            </span>
          </div>
          <div class="flex items-end gap-2">
            <Button
              v-if="!ctfSession"
              type="button"
              variant="ghost"
              size="icon"
              :disabled="running"
              aria-label="添加文件或图片"
              title="添加文件或图片；文件会安全复制到 MilkSU 用户数据目录"
              @click="chooseCodingAttachments"
            >
              <Paperclip class="size-4" />
            </Button>
            <Textarea
              v-model="draft"
              class="chat-composer__input max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              :placeholder="ctfSession
                ? ctfRole === 'strategist'
                  ? '补充你希望独立复盘的卡点或失败路线…'
                  : ctfRole === 'tool-builder'
                    ? '告诉 Coding Agent 要实现或修正的本题工具…'
                    : '告诉 Agent 你的观察、假设，或直接使用上面的快捷协作…'
                : goalMode
                  ? '描述要持续推进并验证完成的目标…'
                  : workspacePath
                    ? `让 Agent 在 ${workspaceName} 中完成任务…`
                    : '在临时沙盒中开始，或先选择一个项目…'"
              aria-label="消息"
              @keydown.enter.exact.prevent="submit"
            />
            <Button
              v-if="running"
              type="button"
              variant="destructive"
              size="icon"
              aria-label="停止 Agent"
              @click="$emit('abort')"
            >
              <Square class="size-3.5 fill-current" />
            </Button>
            <Button
              v-else
              type="submit"
              variant="brand"
              size="icon"
              :disabled="!draft.trim() && !pendingAttachments.length"
              aria-label="发送"
            >
              <ArrowUp class="size-4" />
            </Button>
          </div>
        </form>
        <p v-if="attachmentError" class="px-2 pt-1.5 text-caption text-destructive">
          {{ attachmentError }}
        </p>
      </div>
    </div>
  </main>
  <aside
    v-if="environmentOpen"
    class="context-sidebar flex shrink-0 flex-col border-l border-border bg-card/95 backdrop-blur"
    :class="['architecture', 'changes'].includes(contextPanel) ? 'w-[36rem]' : 'w-80'"
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
          <Network v-else-if="contextPanel === 'architecture'" class="size-4 text-primary" />
          <Globe2 v-else-if="contextPanel === 'browser'" class="size-4 text-primary" />
          <Wrench v-else-if="contextPanel === 'collaboration'" class="size-4 text-primary" />
          <CircleDot v-else class="size-4 text-primary" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent size="sm" align="start" class="min-w-56">
          <SelectItem value="environment">{{ ctfSession ? '解题环境' : '环境信息' }}</SelectItem>
          <SelectItem v-if="!ctfSession" value="changes">变更</SelectItem>
          <SelectItem v-if="!ctfSession" value="architecture">架构图</SelectItem>
          <SelectItem value="browser">浏览器</SelectItem>
          <template v-if="ctfSession">
            <SelectSeparator />
            <SelectItem value="collaboration">Agent 协作</SelectItem>
            <SelectItem value="evidence">证据与 Judge</SelectItem>
          </template>
        </SelectContent>
      </Select>
      <div class="app-no-drag flex items-center gap-1">
        <Button
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
          <p class="text-caption font-medium text-muted-foreground">工作区</p>
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

        <section v-if="!ctfSession && backgroundTasks.length" class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium text-muted-foreground">后台进程</p>
            <Badge variant="outline">
              {{ backgroundTasks.filter(task => task.status === 'running').length }} 运行中
            </Badge>
          </div>
          <div class="mt-2">
            <details
              v-for="task in backgroundTasks"
              :key="task.id"
              class="group border-b border-border/70 last:border-b-0"
            >
              <summary
                class="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden"
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  :class="task.status === 'running'
                    ? 'animate-pulse bg-primary'
                    : task.status === 'succeeded'
                      ? 'bg-primary'
                      : task.status === 'failed' || task.status === 'timed_out'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground'"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-body font-medium" :title="backgroundTaskLabel(task)">
                    {{ backgroundTaskLabel(task) }}
                  </span>
                  <span class="mt-0.5 block truncate text-caption text-muted-foreground">
                    {{ backgroundTaskStatusLabel(task.status) }} · {{ backgroundTaskElapsed(task) }}
                    <template v-if="task.pid"> · PID {{ task.pid }}</template>
                  </span>
                </span>
                <ChevronDown
                  class="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div class="space-y-2 pb-3 pl-3 text-caption leading-5">
                <p v-if="task.command" class="break-words font-mono text-foreground">
                  {{ task.command }}
                </p>
                <p v-if="task.cwd" class="break-all text-muted-foreground">
                  {{ task.cwd }}
                </p>
                <p v-if="task.lastExitCode !== undefined" class="text-muted-foreground">
                  退出码 {{ task.lastExitCode }}
                </p>
                <p v-if="task.error" class="break-words text-destructive">
                  {{ task.error }}
                </p>
                <p v-if="task.logPath" class="break-all text-muted-foreground">
                  日志 {{ task.logPath }}
                </p>
              </div>
            </details>
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
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">工具</span>
            <span class="text-right text-caption leading-5">
              {{ activeTools.length }} 个
            </span>
          </div>
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
          <p class="text-body font-medium">Coding 浏览器能力尚未启用</p>
          <p class="mt-2 text-caption leading-5 text-muted-foreground">
            MCP 浏览器与 Computer Use 会走独立权限授权；当前任务不会静默继承浏览器会话。
          </p>
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
  </aside>
  </section>
</template>

<style scoped>
.chat-main {
  container-name: chat-main;
  container-type: inline-size;
}

.chat-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.5rem;
  padding: 0.5rem 1.5rem;
}

.chat-toolbar__summary {
  overflow: hidden;
}

.chat-toolbar__actions {
  max-width: 100%;
}

.chat-toolbar--ctf {
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  padding-inline: 1rem;
}

.chat-toolbar--ctf .chat-toolbar__actions {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.chat-composer {
  position: relative;
  z-index: 2;
}

.chat-composer__workspace {
  max-width: 9rem;
}

.chat-goal-strip {
  min-height: 2rem;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--primary) 7%, transparent);
}

.chat-composer__control {
  font-size: var(--text-control, 0.875rem);
  line-height: var(--text-control--line-height, 1.25rem);
}

.chat-composer__control[data-slot='select-trigger'] {
  font-size: var(--text-control, 0.875rem) !important;
  line-height: var(--text-control--line-height, 1.25rem) !important;
}

.coding-action-option {
  display: flex;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
}

.chat-composer__permission--full {
  color: var(--warning);
}

.chat-composer__permission--full:hover {
  color: var(--warning);
}

.approval-option {
  display: flex;
  min-height: 4.5rem;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}

.approval-option__icon {
  width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.15rem;
  flex: none;
}

.approval-option__title {
  font-size: var(--text-label, 0.875rem);
  line-height: 1.25rem;
  font-weight: 600;
}

.approval-option__description {
  margin-top: 0.1rem;
  color: var(--muted-foreground);
  font-size: var(--text-control, 0.875rem);
  line-height: 1.25rem;
}

.approval-option__check {
  width: 1rem;
  height: 1rem;
  margin-top: 0.15rem;
  flex: none;
}

.approval-option--full,
.approval-option--full .approval-option__description {
  color: var(--warning);
}

.approval-option--full .approval-option__icon,
.approval-option--full .approval-option__check {
  color: var(--warning);
}

.chat-composer__model {
  width: clamp(10rem, 15vw, 18rem);
}

.chat-composer__island {
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--card);
  padding: 0.5rem 0.55rem 0.5rem 0.8rem;
  box-shadow:
    0 14px 34px rgb(0 0 0 / 18%),
    0 2px 8px rgb(0 0 0 / 10%);
}

.chat-composer__input {
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}

@media (max-width: 68.75rem) {
  .context-sidebar {
    position: absolute;
    inset-block: 0;
    right: 0;
    z-index: 20;
    box-shadow: -18px 0 40px rgb(0 0 0 / 28%);
  }
}

@container chat-main (max-width: 52rem) {
  .chat-composer__controls {
    flex-wrap: nowrap;
  }

  .chat-composer__workspace {
    max-width: 9rem;
  }

  .chat-composer__model {
    min-width: 9rem;
    flex: 1 1 10rem;
    width: auto;
  }
}
</style>
