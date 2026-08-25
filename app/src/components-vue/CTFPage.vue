<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import {
  ActionCard,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  ModelListRow,
  SegmentedControl,
  SettingsRow,
  SettingsSection,
  buttonVariants,
  menuContentClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuViewportClass,
} from '@felinic/ui'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FilePlus2,
  FileSearch,
  Flag,
  KeyRound,
  Library,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  Zap,
} from 'lucide-vue-next'
import CTFArtifacts from '@/components-vue/CTFArtifacts.vue'
import CTFChallengeDesk from '@/components-vue/CTFChallengeDesk.vue'
import CTFDebrief from '@/components-vue/CTFDebrief.vue'
import CTFEndpointAuthorization from '@/components-vue/CTFEndpointAuthorization.vue'
import CTFManualIntake from '@/components-vue/CTFManualIntake.vue'
import CTFMemoryRecall from '@/components-vue/CTFMemoryRecall.vue'
import CTFSubmissionGate from '@/components-vue/CTFSubmissionGate.vue'
import CTFTrainingArchive from '@/components-vue/CTFTrainingArchive.vue'
import CTFTrajectory from '@/components-vue/CTFTrajectory.vue'
import CTFWorkspaceHeader from '@/components-vue/CTFWorkspaceHeader.vue'
import CollectionViewFilter from '@/components-vue/CollectionViewFilter.vue'
import ConversationDock from '@/components-vue/ConversationDock.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import { useCTFTrainingPlatforms } from '@/composables/useCTFTrainingPlatforms'
import { useCTFWorkspace } from '@/composables/useCTFWorkspace'
import { useCTFShowCatalog } from '@/composables/useCTFShow'
import { useNSSCTFArena, useNSSCTFChallenges, useNSSCTFWebBridge } from '@/composables/useNSSCTF'
import { useNSSCTFCatalog, useNSSCTFTraining } from '@/composables/useNSSCTFTraining'
import { invokeCommand } from '@/desktop'
import { shouldBootstrapNSSCTFCatalog } from '@/lib/ctfCatalogBootstrap'
import {
  chooseCTFDailyChallenge,
  CTF_DAILY_CHALLENGE_STORAGE_KEY,
  localCTFDateKey,
  parseCTFDailyChallengeRecord,
} from '@/lib/ctfDailyChallenge'
import { ALL_COLLECTIONS_ID, createItemCollectionStore } from '@/lib/itemCollections'
import { relatedDomainConversations } from '@/lib/workspaceSessionRouting'
import { debugLog, updateDebugState } from '@/lib/debugMode'
import {
  ctfManualStatusFromJobStatus,
  ctfManualStatusLabel,
  type CTFManualStatus,
} from '@/lib/ctfManualStatus'
import { deriveCTFWorkspacePresentation } from '@/lib/ctfWorkspacePresentation'
import { t } from '@/lib/uiLocale'
import type {
  CTFAgentWorkspaceHandoff,
  CTFChallengeRequest,
  CTFCollaborationMode,
  CTFEndpointRequestInput,
  CTFMaterialRequest,
  CTFProjection,
  CTFSummary,
  CTFTrainingMemory,
  CTFTrainingMemoryEvidenceLink,
} from '@/ctfTypes'
import type { CTFTrainingPlatform } from '@/ctfPlatformTypes'
import type { CTFWorkspaceSection } from '@/lib/workspaceNavigation'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type {
  NSSCTFCatalogProblem,
  NSSCTFDailyChallengeSelection,
  NSSCTFRecommendation,
  NSSCTFTrainingSeries,
} from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'

type Screen = 'source' | 'challenge' | 'detail' | 'workspace'
type QuestionBank = Extract<CTFTrainingPlatform['id'], 'nssctf' | 'ctfshow'>
type TrainingSource = CTFTrainingPlatform['id'] | 'custom'
defineOptions({ name: 'CTFPage' })

function catalogDifficultyLabel(value: number) {
  if (!value || value <= 1.4) return t('入门', 'Intro')
  if (value <= 2.4) return t('简单', 'Easy')
  if (value <= 3.2) return t('中等', 'Medium')
  return t('困难', 'Hard')
}

function formatCategory(value: string) {
  const normalized = value.trim().toLowerCase()
  const labels: Record<string, string> = {
    web: 'Web',
    pwn: 'Pwn',
    reverse: 'Reverse',
    crypto: 'Crypto',
    forensics: 'Forensics',
    misc: 'Misc',
  }
  return labels[normalized] ?? value
}

const props = withDefaults(defineProps<{
  modelReady: boolean
  modelVerified: boolean
  arenaReady: boolean
  initialJobId?: string | null
  ctfSection: CTFWorkspaceSection
  conversations?: Conversation[]
  conversation?: Conversation | null
  running?: boolean
  aborting?: boolean
  settings?: CodingAgentSurfaceBind['settings']
  workspacePath?: string
  messageQueue?: CodingAgentSurfaceBind['messageQueue']
  sessionReady?: boolean
  resumed?: boolean
  compacting?: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: CodingAgentSurfaceBind['turnStatus']
  ctfSession?: boolean
  vulnerabilitySession?: boolean
  ctfMode?: Conversation['ctfMode']
  ctfRole?: Conversation['ctfRole']
  modelMode?: Conversation['modelMode']
  modelProvider?: string
  modelId?: string
  modelSourcePreference?: CodingAgentSurfaceBind['modelSourcePreference']
  executionMode?: CodingAgentSurfaceBind['executionMode']
  approvalPolicy?: CodingAgentSurfaceBind['approvalPolicy']
  mcpServers?: string[]
  mcpConfigDigest?: string
  pendingComposerDraft?: CodingAgentSurfaceBind['pendingComposerDraft']
  ensureConversation?: (title?: string) => string
}>(), {
  conversations: () => [],
  conversation: null,
  running: false,
  aborting: false,
  settings: null,
  workspacePath: '',
  sessionReady: false,
  resumed: false,
  compacting: false,
  ctfSession: false,
  vulnerabilitySession: false,
  mcpServers: () => [],
  pendingComposerDraft: null,
  ensureConversation: () => '',
})

const emit = defineEmits<{
  openSettings: [category?: 'apikeys' | 'browser']
  startCodingAgent: [handoff: CTFAgentWorkspaceHandoff]
  openCodingConversation: [id: string]
  send: CodingAgentSendArgs
  abort: []
  selectConversation: [id: string]
  createConversation: []
  expand: []
  consumePendingDraft: []
  ctfAction: [action: import('@/types').CTFChatAction]
  compactContext: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeModelSource: [preference: 'auto' | 'account' | 'personal']
  changeCodingPolicy: [
    executionMode: NonNullable<CodingAgentSurfaceBind['executionMode']>,
    approvalPolicy: NonNullable<CodingAgentSurfaceBind['approvalPolicy']>,
  ]
  changeMcpServers: [servers: string[], configDigest: string]
  chooseWorkspace: []
  chooseWorkspaceForNewTask: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
}>()

const backend = useCTFWorkspace()
const platformRegistry = useCTFTrainingPlatforms()
const publicProblems = useNSSCTFChallenges()
const arena = useNSSCTFArena()
const webBridge = useNSSCTFWebBridge()
const training = useNSSCTFTraining()
const publicCatalog = useNSSCTFCatalog()
const ctfshow = useCTFShowCatalog()
const screen = ref<Screen>('challenge')
const deactivatedFromWorkspace = ref(false)
const ctfSection = computed(() => props.ctfSection)
const workspaceScrollArea = ref<HTMLElement | null>(null)
const storedTrainingSource = window.localStorage.getItem('milksu.ctf.question-bank')
const activeBank = ref<TrainingSource>(
  storedTrainingSource === 'ctfshow'
  || storedTrainingSource === 'hackthebox'
  || storedTrainingSource === 'tryhackme'
    ? storedTrainingSource
    : 'nssctf',
)
const lastNonCustomBank = ref<Exclude<TrainingSource, 'custom'>>(
  activeBank.value as Exclude<TrainingSource, 'custom'>,
)
const source = ref<'public' | 'arena'>('public')
const problemInput = ref('')
const selectedProblem = ref<NSSCTFChallenge | null>(null)
const selectedCTFShowProblemID = ref<number | null>(null)
const selectedSeries = ref<NSSCTFTrainingSeries | null>(null)
const storedCollaborationMode = window.localStorage.getItem('milksu.ctf.collaboration-mode')
const collaborationMode = ref<CTFCollaborationMode>(
  storedCollaborationMode === 'coach'
  || storedCollaborationMode === 'copilot'
  || storedCollaborationMode === 'delegate'
    ? storedCollaborationMode
    : 'copilot',
)

const flagCandidate = ref('')
const platformReview = ref(false)
const outcomeNotice = ref('')
const catalogNotice = ref('')
const catalogBootstrapAttempted = ref(false)
const attachmentError = ref('')
const localMaterials = ref<CTFMaterialRequest[]>([])
const working = ref(false)
const conversationDock = ref<{ revealAndFocus: () => Promise<void> } | null>(null)
const manualCreating = ref(false)
const seriesQuery = ref('')
const seriesCategory = ref('all')
const seriesStatus = ref<'all' | 'new' | 'attempted' | 'completed'>('all')
const seriesPage = ref(1)
const catalogQuery = ref('')
const catalogCategory = ref('all')
const catalogPage = ref(1)
const catalogPageSize = 20 as const
const ctfshowQuery = ref('')
const ctfshowCategory = ref('all')
const ctfshowPage = ref(1)
const ctfshowPageSize = 20
const historyExpanded = ref(false)
const recalledMemories = ref<CTFTrainingMemory[]>([])
const memoryLoading = ref(false)
const historyMenu = ref<HTMLDetailsElement | null>(null)
const ctfCollections = createItemCollectionStore('milksu.ctf.collections.v1')
const collectionView = ref(ALL_COLLECTIONS_ID)
const manualStatuses = ref<Record<string, CTFManualStatus>>((() => {
  try {
    const value = JSON.parse(window.localStorage.getItem('milksu.ctf.manual-statuses') || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
})())
const dailyChallenge = ref<NSSCTFCatalogProblem | null>(null)
const dailyChallengeReason = ref('')
const dailyChallengeVisible = computed(() => (
  activeBank.value === 'nssctf'
  && catalogQuery.value.trim() === ''
  && catalogCategory.value === 'all'
  && collectionView.value === ALL_COLLECTIONS_ID
    ? dailyChallenge.value
    : null
))

// A selected problem only belongs to a filtered collection view when it is
// actually in that collection; otherwise the daily challenge or a stale
// recommendation could keep showing in an unrelated (even empty) view.
const visibleSelectedNssctf = computed(() => {
  const selected = selectedProblem.value
  if (!selected) return null
  if (collectionView.value === ALL_COLLECTIONS_ID) return selected
  return ctfCollections.has(`nssctf:${selected.platformId}`, collectionView.value)
    ? selected
    : null
})
const catalogErrorMessage = computed(() => {
  const error = activeBank.value === 'nssctf'
    ? publicCatalog.error.value ?? training.error.value
    : ctfshow.error.value
  return error ? t('题库暂时没有同步成功，请稍后重试。', 'The catalog did not sync. Try again later.') : ''
})
const manualIntake = ref<InstanceType<typeof CTFManualIntake> | null>(null)
let catalogSearchTimer: ReturnType<typeof setTimeout> | undefined
let dailyChallengeLoading = false

const step = computed(() => screen.value === 'source' ? 1 : screen.value === 'challenge' ? 2 : 3)
const activeProjection = computed(() => backend.projection.value)
const dossierConversations = computed(() => relatedDomainConversations(
  props.conversations ?? [],
  props.conversation ?? null,
))
const isArenaWorkspace = computed(() => (
  activeProjection.value?.challenge.externalPlatform === 'nssctf-agent-arena'
))
const isWebWorkspace = computed(() => (
  activeProjection.value?.challenge.externalPlatform === 'nssctf-web'
))
const isCTFShowWorkspace = computed(() => (
  activeProjection.value?.challenge.externalPlatform === 'ctfshow-web'
))
const externalJudgeLabel = computed(() => {
  switch (activeProjection.value?.challenge.source.kind) {
    case 'url':
    case 'managed-browser':
    case 'user-browser':
      return t('外部平台', 'External platform')
    case 'socket':
      return t('TCP 题目', 'TCP challenge')
    case 'ssh':
      return t('SSH 题目', 'SSH challenge')
    default:
      return t('外部 Judge', 'External Judge')
  }
})
const arenaAttempt = computed(() => arena.workspace.value?.arena.attempt)
const selectedBrowserPage = computed(() => (
  webBridge.status.value?.pages.find(page => page.nssctf.problemId === selectedProblem.value?.platformId)
))
const activeBrowserPage = computed(() => (
  webBridge.status.value?.pages.find(page => (
    page.nssctf.problemId === activeProjection.value?.challenge.externalAttemptId
  ))
))
const selectedBrowserReady = computed(() => Boolean(
  selectedBrowserPage.value?.connected,
))
const activeBrowserReady = computed(() => Boolean(
  activeBrowserPage.value?.connected,
))
const selectedBrowserCanSubmit = computed(() => Boolean(
  selectedBrowserPage.value?.connected
  && selectedBrowserPage.value.nssctf.canSubmit
  && !selectedBrowserPage.value.nssctf.needsStart,
))
const activeBrowserCanSubmit = computed(() => Boolean(
  activeBrowserPage.value?.connected
  && activeBrowserPage.value.nssctf.canSubmit
  && !activeBrowserPage.value.nssctf.needsStart,
))
const ctfshowBridgeReady = computed(() => Boolean(
  ctfshow.status.value?.pages.some(page => page.connected),
))
const browserBridge = computed(() => (
  webBridge.status.value?.bridge ?? ctfshow.status.value?.bridge ?? null
))
const browserBridgeConnected = computed(() => Boolean(browserBridge.value?.connected))
const selectedCatalogReady = computed(() => (
  activeBank.value === 'nssctf'
    ? Boolean(training.dashboard.value?.catalogTotal)
    : Boolean(ctfshow.status.value?.catalog.total)
))
const selectedJudgeReady = computed(() => (
  activeBank.value === 'nssctf'
    ? selectedBrowserCanSubmit.value
    : ctfshowBridgeReady.value
))
const selectedActiveJob = computed(() => {
  const selectedID = activeBank.value === 'nssctf'
    ? selectedProblem.value?.platformId
    : selectedCTFShowProblemID.value
  const platform = activeBank.value === 'nssctf' ? 'nssctf-web' : 'ctfshow-web'
  if (!selectedID) return null
  return backend.jobs.value.find(job => (
    job.externalPlatform === platform
    && job.externalAttemptId === selectedID
    && !['succeeded', 'failed', 'cancelled'].includes(job.status)
  )) ?? null
})
const selectedCatalogJob = computed(() => {
  const selectedID = activeBank.value === 'nssctf'
    ? selectedProblem.value?.platformId
    : selectedCTFShowProblemID.value
  const platform = activeBank.value === 'nssctf' ? 'nssctf-web' : 'ctfshow-web'
  if (!selectedID) return null
  return backend.jobs.value.find(job => (
    job.externalPlatform === platform && job.externalAttemptId === selectedID
  )) ?? null
})

function updateManualStatus(key: string, status: CTFManualStatus) {
  manualStatuses.value = { ...manualStatuses.value, [key]: status }
  window.localStorage.setItem('milksu.ctf.manual-statuses', JSON.stringify(manualStatuses.value))
}

function manualStatusForJob(job: Pick<CTFSummary, 'id' | 'status'>): CTFManualStatus {
  return manualStatuses.value[`job:${job.id}`] ?? ctfManualStatusFromJobStatus(job.status)
}

function updateCatalogProblemStatus(event: Event) {
  const problem = selectedProblem.value
  const status = (event.target as HTMLSelectElement | null)?.value as CTFManualStatus | undefined
  if (!problem || !status || !['not_started', 'in_progress', 'paused', 'completed'].includes(status)) return
  updateManualStatus(`nssctf:${problem.platformId}`, status)
}

function updateActiveJobManualStatus(event: Event) {
  const job = activeProjection.value?.job
  const status = (event.target as HTMLSelectElement | null)?.value as CTFManualStatus | undefined
  if (!job || !status || !['not_started', 'in_progress', 'paused', 'completed'].includes(status)) return
  updateManualStatus(`job:${job.id}`, status)
}
// Presentation-only readiness strips removed. Inline blockers only at the
// action they gate: model gates Agent start, Judge gates submit, neither gates
// opening Coding context.
const catalogAction = computed(() => (
  selectedCatalogReady.value
    ? null
    : { label: t('同步题库', 'Sync catalog'), action: 'catalog' as const }
))
const activeStartCost = computed(() => (
  activeBrowserPage.value?.nssctf.needsStart
    ? activeBrowserPage.value.nssctf.startCost ?? 0
    : 0
))
const canContinue = computed(() => {
  const status = activeProjection.value?.job.status
  return Boolean(activeProjection.value && !['succeeded', 'failed', 'cancelled'].includes(status ?? ''))
})
const agentCheckpoint = computed(() => backend.agentRun.value)
const hasAgentRecoveryPoint = computed(() => {
  const run = agentCheckpoint.value
  return Boolean(run && (
    run.status !== 'ready'
    || run.metrics.eventCount > 0
    || run.candidateCount > 0
    || run.lastAssistantSummary
  ))
})
const agentActionLabel = computed(() => t('开始解题', 'Start solving'))
const agentBudgetStopMessage = computed(() => {
  const status = backend.agentBudget.value
  if (!status?.exhausted) return ''
  switch (status.reason) {
    case 'turn-budget-exhausted':
      return t(`已用完 ${status.budget.maxTurns} 个 PI 回合。先复盘当前轨迹，再从题库建立一次新的受控训练。`, `${status.budget.maxTurns} PI turns used. Debrief the current trajectory, then start a new controlled session from the catalog.`)
    case 'time-budget-exhausted':
      return t(`本次训练已达到 ${status.budget.maxWallMinutes} 分钟。先记录关键转折，再决定是否重新开始。`, `This session reached ${status.budget.maxWallMinutes} minutes. Record the key turns, then decide whether to start again.`)
    case 'wrong-submission-budget-exhausted':
      return t(`已经出现 ${status.budget.maxWrongSubmissions} 次平台 Rejected。MilkSU 已停止继续盲试。`, `${status.budget.maxWrongSubmissions} platform Rejected results already. MilkSU has stopped further blind attempts.`)
    default:
      return t('本次 PI 训练预算已停止；请先复盘，再由你决定下一次尝试。', 'This PI training budget has stopped. Debrief first, then decide the next attempt.')
  }
})
const workspacePresentation = computed(() => {
  const projection = activeProjection.value
  if (!projection) return null
  return deriveCTFWorkspacePresentation({
    terminal: !canContinue.value,
    hasAgentRecoveryPoint: hasAgentRecoveryPoint.value,
    experimentCount: projection.experiments.length,
    evidenceCount: projection.evidence.length,
    artifactCount: projection.artifacts.length,
    agentRunCount: projection.agentRuns.length,
    agentCandidateCount: projection.agentCandidates.length,
    submissionCount: projection.submissions.length,
    judgeReceiptCount: projection.judgeReceipts.length,
    evaluationCount: projection.evaluations.length,
    learningCount: projection.learning.length,
    hintCount: projection.humanOutcome.hintCount,
    reflectionCount: projection.humanOutcome.reflectionCount,
    independentStepCount: projection.humanOutcome.independentSteps,
    endpointRequestStatuses: projection.endpointRequests.map(request => request.status),
    candidate: flagCandidate.value,
    platformReview: platformReview.value,
  })
})
const remainingAgentTurns = computed(() => (
  backend.agentBudget.value?.remainingTurns
  ?? activeProjection.value?.challenge.agentPolicy.budget.maxTurns
  ?? 0
))
const remainingAgentMinutes = computed(() => Math.ceil(
  (backend.agentBudget.value?.remainingWallSeconds
    ?? (activeProjection.value?.challenge.agentPolicy.budget.maxWallMinutes ?? 0) * 60)
  / 60,
))
const remainingWrongSubmissions = computed(() => (
  backend.agentBudget.value?.remainingWrongSubmissions
  ?? activeProjection.value?.challenge.agentPolicy.budget.maxWrongSubmissions
  ?? 0
))
const resumableJob = computed(() => (
  backend.jobs.value.find(job => !['succeeded', 'failed', 'cancelled'].includes(job.status))
))
const solvedJobCount = computed(() => (
  backend.jobs.value.filter(job => job.status === 'succeeded').length
))
const totalExperimentCount = computed(() => (
  backend.jobs.value.reduce((total, job) => total + job.experimentCount, 0)
))
const visibleHistoryJobs = computed(() => (
  historyExpanded.value ? backend.jobs.value : backend.jobs.value.slice(0, 3)
))
const activeQuestionBank = computed<QuestionBank | null>(() => (
  activeBank.value === 'nssctf' || activeBank.value === 'ctfshow'
    ? activeBank.value
    : null
))
const visibleTrainingPlatforms = computed(() => (
  platformRegistry.platforms.value.filter(platform => (
    platform.selectable && platform.status === 'ready'
  ))
))
const activeCatalogBank = computed<QuestionBank>(() => (
  activeBank.value === 'ctfshow' ? 'ctfshow' : 'nssctf'
))
const activeExternalPlatform = computed(() => (
  platformRegistry.platforms.value.find(platform => platform.id === activeBank.value) ?? null
))
const activeSourceName = computed(() => (
  activeBank.value === 'custom'
    ? t('自定义题目', 'Custom challenge')
    : activeExternalPlatform.value?.name ?? t('选择训练平台', 'Choose a training platform')
))
const externalPlatformStatusLabel = computed(() => {
  switch (activeExternalPlatform.value?.status) {
    case 'planned': return t('接入中', 'Connecting')
    case 'restricted': return t('受官方接口限制', 'Limited by official API')
    default: return t('可用', 'Available')
  }
})
const externalPlatformSummary = computed(() => {
  switch (activeExternalPlatform.value?.id) {
    case 'hackthebox':
      return t('HTB Labs 目前仅支持人工训练入口。', 'HTB Labs currently supports a human training entry only.')
    case 'tryhackme':
      return t('TryHackMe 个人版暂无完整 API，需 Business / Classroom。', 'The TryHackMe personal plan has no complete API; Business / Classroom is required.')
    default:
      return t('该平台正在接入统一题库与 Judge。', 'This platform is being connected to the shared catalog and Judge.')
  }
})
const externalPlatformCapabilities = computed(() => {
  const labels: Record<string, string> = {
    machines: 'Machines',
    'starting-point': 'Starting Point',
    challenges: 'Challenges',
    vpn: 'VPN',
    'instance-lifecycle': t('靶机生命周期', 'Machine lifecycle'),
    progress: t('训练进度', 'Training progress'),
    'human-only': t('仅人工训练', 'Human training only'),
    'written-permission': t('需书面许可', 'Written permission required'),
    'room-catalog': t('房间目录', 'Room catalog'),
    'room-questions': t('房间题目', 'Room challenges'),
    scoreboard: t('积分榜', 'Scoreboard'),
    'time-report': t('训练时长', 'Training time'),
  }
  return (activeExternalPlatform.value?.capabilities ?? []).map(value => labels[value] ?? value)
})
const ctfshowProblems = computed(() => ctfshow.status.value?.catalog.problems ?? [])
const selectedCTFShowProblem = computed(() => (
  ctfshowProblems.value.find(problem => problem.platformId === selectedCTFShowProblemID.value) ?? null
))
const ctfshowCategories = computed(() => [...new Set(
  ctfshowProblems.value.map(problem => problem.category).filter(Boolean),
)].sort((left, right) => left.localeCompare(right, 'zh-CN')))
const filteredCTFShowProblems = computed(() => {
  const query = ctfshowQuery.value.trim().toLowerCase()
  const normalizedID = query.replace(/^#/i, '')
  const allowed = collectionView.value === ALL_COLLECTIONS_ID
    ? null
    : new Set(ctfCollections.itemKeysFor(collectionView.value))
  return ctfshowProblems.value.filter(problem => {
    if (allowed && !allowed.has(`ctfshow:${problem.platformId}`)) return false
    if (ctfshowCategory.value !== 'all' && problem.category !== ctfshowCategory.value) return false
    if (!query) return true
    return String(problem.platformId).includes(normalizedID)
      || problem.title.toLowerCase().includes(query)
      || problem.category.toLowerCase().includes(query)
      || problem.tags.some(tag => tag.toLowerCase().includes(query))
  }).sort((left, right) => {
    if (!query) return 0
    const leftID = String(left.platformId)
    const rightID = String(right.platformId)
    if (leftID === normalizedID && rightID !== normalizedID) return -1
    if (rightID === normalizedID && leftID !== normalizedID) return 1
    const leftTitle = left.title.toLowerCase()
    const rightTitle = right.title.toLowerCase()
    if (leftTitle === query && rightTitle !== query) return -1
    if (rightTitle === query && leftTitle !== query) return 1
    if (leftTitle.startsWith(query) && !rightTitle.startsWith(query)) return -1
    if (rightTitle.startsWith(query) && !leftTitle.startsWith(query)) return 1
    return right.platformId - left.platformId
  })
})
const ctfshowPageCount = computed(() => Math.max(
  1,
  Math.ceil(filteredCTFShowProblems.value.length / ctfshowPageSize),
))
const visibleCTFShowProblems = computed(() => {
  const offset = (ctfshowPage.value - 1) * ctfshowPageSize
  return filteredCTFShowProblems.value.slice(offset, offset + ctfshowPageSize)
})
const deskQuery = computed({
  get: () => activeBank.value === 'ctfshow' ? ctfshowQuery.value : catalogQuery.value,
  set: (value: string) => {
    if (activeBank.value === 'ctfshow') ctfshowQuery.value = value
    else catalogQuery.value = value
  },
})
const deskCategory = computed({
  get: () => activeBank.value === 'ctfshow' ? ctfshowCategory.value : catalogCategory.value,
  set: (value: string) => {
    if (activeBank.value === 'ctfshow') ctfshowCategory.value = value
    else catalogCategory.value = value
  },
})
const deskCategories = computed(() => (
  activeBank.value === 'ctfshow'
    ? ctfshowCategories.value
    : publicCatalog.result.value?.categories ?? []
))
const deskProblemTotal = computed(() => (
  activeBank.value === 'ctfshow'
    ? filteredCTFShowProblems.value.length
    : publicCatalog.result.value?.total ?? training.dashboard.value?.catalogTotal ?? 0
))
const deskPage = computed(() => activeBank.value === 'ctfshow' ? ctfshowPage.value : catalogPage.value)
const deskPageCount = computed(() => (
  activeBank.value === 'ctfshow'
    ? ctfshowPageCount.value
    : Math.max(publicCatalog.result.value?.pageCount ?? 0, 1)
))
const deskLoading = computed(() => (
  working.value
  || (activeBank.value === 'ctfshow' ? ctfshow.loading.value : publicCatalog.loading.value)
))
const deskLoadingTitle = computed(() => {
  if (activeBank.value === 'ctfshow') return t('正在检查 CTFshow 连接', 'Checking CTFshow connection')
  if (training.syncing.value) return t('正在首次同步 NSSCTF 公开题库', 'First sync of the NSSCTF public catalog')
  return t('正在读取 NSSCTF 本地题库', 'Reading the local NSSCTF catalog')
})
const deskLoadingDetail = computed(() => {
  if (activeBank.value === 'ctfshow') {
    return t('在 CTFshow 题库页打开 MilkSU 扩展以同步题目。', 'Open the MilkSU extension on a CTFshow catalog page to sync challenges.')
  }
  if (training.syncing.value) return t('正在同步 NSSCTF 公开题库', 'Syncing the NSSCTF public catalog')
  return ''
})
const deskEmptyTitle = computed(() => {
  if (deskQuery.value.trim() || deskCategory.value !== 'all') return t('没有匹配题目', 'No matching challenges')
  return ''
})
const deskEmptyDetail = computed(() => '')

const modeItems = computed(() => [
  { value: 'coach' as const, label: t('教练', 'Coach') },
  { value: 'copilot' as const, label: t('搭档', 'Copilot') },
  { value: 'delegate' as const, label: t('代理', 'Delegate') },
])
const dailyMission = computed(() => {
  if (resumableJob.value) {
    return {
      kind: 'resume' as const,
      eyebrow: t('继续上次训练', 'Continue last session'),
      title: resumableJob.value.title,
      meta: `${resumableJob.value.category} · ${jobSummaryLabel(resumableJob.value)}`,
      action: t('历史恢复', 'Resume from history'),
    }
  }
  const recommendation = training.dashboard.value?.recommendations[0]
  if (recommendation) {
    return {
      kind: 'recommendation' as const,
      eyebrow: t('推荐训练', 'Recommended training'),
      title: recommendation.problem.title,
      meta: t(`${recommendation.problem.category} · 难度 ${recommendation.problem.difficulty.toFixed(1)} · ${recommendation.kind}`, `${recommendation.problem.category} · difficulty ${recommendation.problem.difficulty.toFixed(1)} · ${recommendation.kind}`),
      action: t('开始训练', 'Start training'),
    }
  }
  return {
    kind: 'sync' as const,
    eyebrow: t('本地题库', 'Local catalog'),
    title: t('同步 NSSCTF 公开题库', 'Sync NSSCTF public catalog'),
    meta: t('0 题', '0 challenges'),
    action: t('同步题库', 'Sync catalog'),
  }
})

function jobSummaryLabel(job: CTFSummary) {
  return ctfManualStatusLabel(manualStatusForJob(job))
}

async function runCatalogAction() {
  if (activeBank.value === 'nssctf') await syncCatalog()
  else await refreshCTFShow()
}

function openCustomImport() {
  if (activeBank.value !== 'custom') {
    lastNonCustomBank.value = activeBank.value
  }
  activeBank.value = 'custom'
  screen.value = 'challenge'
}

function cancelCustomImport() {
  activeBank.value = lastNonCustomBank.value
  screen.value = 'challenge'
}

async function openSelectedInCoding() {
  if (activeBank.value === 'ctfshow' && selectedCTFShowProblemID.value) {
    await chooseCTFShowProblem(selectedCTFShowProblemID.value)
    return
  }
  if (activeBank.value === 'nssctf') {
    await startPublicWorkspace()
  }
}

function difficultyLabel(difficulty: number) {
  return difficulty > 0 ? difficulty.toFixed(1) : t('待定', 'Pending')
}

function ctfshowProblemStatus(problemId: number) {
  if (ctfshow.status.value?.completedProblemIds.includes(problemId)) return 'completed'
  if (ctfshow.status.value?.attemptedProblemIds.includes(problemId)) return 'attempted'
  return 'new'
}

function ctfshowProblemStatusLabel(problemId: number) {
  switch (ctfshowProblemStatus(problemId)) {
    case 'completed': return t('已完成', 'Completed')
    case 'attempted': return t('再挑战', 'Retry')
    default: return t('未开始', 'Not started')
  }
}

watch(activeBank, bank => {
  if (bank !== 'custom') {
    lastNonCustomBank.value = bank
    window.localStorage.setItem('milksu.ctf.question-bank', bank)
  }
  selectedProblem.value = null
  selectedCTFShowProblemID.value = null
  localMaterials.value = []
  attachmentError.value = ''
  if (bank === 'ctfshow') {
    void ctfshow.refresh().then(() => selectDefaultDeskProblem())
  } else if (bank === 'nssctf') {
    void loadPublicCatalog(1).then(async () => {
      await bootstrapNSSCTFCatalog()
      await selectDefaultDeskProblem()
    })
  }
})

watch(ctfSection, section => {
  if (section === 'catalog') void selectDefaultDeskProblem()
})

watch(collaborationMode, mode => {
  window.localStorage.setItem('milksu.ctf.collaboration-mode', mode)
})

watch([ctfshowQuery, ctfshowCategory, collectionView, ctfCollections.revision], () => {
  ctfshowPage.value = 1
})

watch(ctfshowPageCount, pageCount => {
  if (ctfshowPage.value > pageCount) ctfshowPage.value = pageCount
})

watch([catalogQuery, catalogCategory], () => {
  if (activeBank.value !== 'nssctf' || screen.value !== 'challenge') return
  if (catalogSearchTimer) clearTimeout(catalogSearchTimer)
  catalogSearchTimer = setTimeout(() => {
    void loadPublicCatalog(1)
  }, 220)
})

watch(collectionView, () => {
  if (activeBank.value !== 'nssctf' || screen.value !== 'challenge') return
  selectedProblem.value = null
  debugLog('switch-collection', `view=${collectionView.value}`)
  updateDebugState({
    view: collectionView.value,
    selectedPlatformId: null,
  })
  void loadPublicCatalog(1).then(() => selectDefaultDeskProblem())
})

watch(ctfCollections.revision, () => {
  if (activeBank.value !== 'nssctf' || screen.value !== 'challenge') return
  const selected = selectedProblem.value
  if (
    selected
    && collectionView.value !== ALL_COLLECTIONS_ID
    && !ctfCollections.has(`nssctf:${selected.platformId}`, collectionView.value)
  ) {
    selectedProblem.value = null
  }
  if (collectionView.value !== ALL_COLLECTIONS_ID) {
    void loadPublicCatalog(1)
  }
})

watch(
  () => ({
    recommendations: training.dashboard.value?.recommendations.map(item => item.problem.platformId).join(',') ?? '',
    catalog: publicCatalog.result.value?.problems.map(item => item.platformId).join(',') ?? '',
    completed: publicCatalog.result.value?.completedProblemIds.join(',') ?? '',
  }),
  () => { void refreshDailyChallenge() },
  { immediate: true },
)

watch(
  () => activeProjection.value?.challenge.externalPlatform,
  platform => {
    if (platform === 'ctfshow-web') void ctfshow.refresh()
    if (platform === 'nssctf-web') void webBridge.refresh()
  },
)

watch(
  () => activeProjection.value?.job.id,
  async jobId => {
    platformReview.value = false
    outcomeNotice.value = ''
    recalledMemories.value = []
    if (jobId) await loadMemoryContext(jobId)
  },
  { immediate: true },
)

watch(
  () => [screen.value, activeProjection.value?.job.id] as const,
  () => { void resetWorkspaceViewport() },
  { flush: 'post' },
)

watch(
  () => ({
    jobId: activeProjection.value?.job.id ?? '',
    candidate: activeProjection.value?.submissions.at(-1)?.candidate
      ?? activeProjection.value?.agentCandidates.at(-1)?.candidate
      ?? '',
  }),
  ({ candidate }) => {
    flagCandidate.value = candidate
  },
  { immediate: true },
)

async function resetWorkspaceViewport() {
  if (screen.value !== 'workspace') return
  await nextTick()
  const area = workspaceScrollArea.value
  if (!area) return
  area.scrollTop = 0
}

function showProblems() {
  source.value = 'public'
  selectedSeries.value = null
  selectedProblem.value = null
  selectedCTFShowProblemID.value = null
  localMaterials.value = []
  attachmentError.value = ''
  screen.value = 'challenge'
  outcomeNotice.value = ''
  if (activeBank.value === 'ctfshow') void ctfshow.refresh()
  else void loadPublicCatalog(1)
}

async function syncCatalog() {
  catalogNotice.value = ''
  const result = await training.sync()
  if (result) {
    catalogNotice.value = t(`已把 ${result.total} 道公开题目更新到本地题库。`, `Updated ${result.total} public challenges into the local catalog.`)
    if (screen.value === 'challenge' && !selectedSeries.value && !selectedProblem.value) {
      await loadPublicCatalog(1)
    }
  }
}

async function bootstrapNSSCTFCatalog() {
  if (!shouldBootstrapNSSCTFCatalog({
    activeBank: activeBank.value,
    catalogTotal: training.dashboard.value?.catalogTotal ?? 0,
    syncing: training.syncing.value,
    attempted: catalogBootstrapAttempted.value,
  })) return
  catalogBootstrapAttempted.value = true
  await syncCatalog()
}

async function loadPublicCatalog(page = catalogPage.value) {
  const problemIds = collectionView.value === ALL_COLLECTIONS_ID
    ? undefined
    : ctfCollections.itemKeysFor(collectionView.value)
        .filter(key => key.startsWith('nssctf:'))
        .map(key => Number(key.slice('nssctf:'.length)))
        .filter(Number.isFinite)
  const started = Date.now()
  const result = await publicCatalog.search({
    query: catalogQuery.value,
    category: catalogCategory.value,
    page,
    pageSize: catalogPageSize,
    problemIds,
  })
  debugLog('load-catalog', `page=${page} view=${collectionView.value}`, Date.now() - started)
  updateDebugState({
    view: collectionView.value,
    selectedPlatformId: selectedProblem.value?.platformId ?? null,
    collectionProblems: problemIds ? problemIds.length : 0,
  })
  if (result) catalogPage.value = result.page
}

function clearDeskSelection() {
  selectedProblem.value = null
  selectedCTFShowProblemID.value = null
}

async function selectDefaultDeskProblem() {
  return
}

function dailyChallengeCandidates() {
  const candidates = [
    ...(training.dashboard.value?.recommendations.map(item => item.problem) ?? []),
    ...(publicCatalog.result.value?.problems ?? []),
  ]
  return [...new Map(candidates.map(problem => [problem.platformId, problem])).values()]
}

async function refreshDailyChallenge(change = false) {
  if (dailyChallengeLoading) return
  const dateKey = localCTFDateKey()
  const completedIds = publicCatalog.result.value?.completedProblemIds ?? []
  const stored = parseCTFDailyChallengeRecord(window.localStorage.getItem(CTF_DAILY_CHALLENGE_STORAGE_KEY))
  if (!change && stored?.dateKey === dateKey && !completedIds.includes(stored.problem.platformId)) {
    dailyChallenge.value = stored.problem
    dailyChallengeReason.value = stored.reason ?? t('根据今天的训练记录推荐。', 'Recommended from today’s training record.')
    return
  }
  const excludedProblemIds = change && dailyChallenge.value
    ? [...completedIds, dailyChallenge.value.platformId]
    : completedIds
  let selection: NSSCTFDailyChallengeSelection | null = null
  dailyChallengeLoading = true
  try {
    selection = await invokeCommand<NSSCTFDailyChallengeSelection>('recommend_ctf_daily_challenge', {
      dateKey,
      excludedProblemIds,
    })
  } catch {
    const problem = chooseCTFDailyChallenge(
      dateKey,
      dailyChallengeCandidates(),
      completedIds,
      change ? dailyChallenge.value?.platformId : undefined,
    )
    if (!problem) return
    const recommendation = training.dashboard.value?.recommendations.find(item => (
      item.problem.platformId === problem.platformId
    ))
    selection = {
      dateKey,
      problem,
      reason: recommendation?.reason || t('根据当前训练记录，从未完成题目中优先选择。', 'Chosen from unfinished challenges based on the current training record.'),
      source: 'rules',
    }
  } finally {
    dailyChallengeLoading = false
  }
  dailyChallenge.value = selection.problem
  dailyChallengeReason.value = selection.reason
  window.localStorage.setItem(CTF_DAILY_CHALLENGE_STORAGE_KEY, JSON.stringify(selection))
}

async function changeDailyChallenge() {
  await refreshDailyChallenge(true)
}

async function runDailyMission() {
  if (dailyMission.value.kind === 'resume' && resumableJob.value) {
    await resumeJob(resumableJob.value.id)
    await openCodingAgent()
    return
  }
  if (dailyMission.value.kind === 'recommendation') {
    const recommendation = training.dashboard.value?.recommendations[0]
    if (recommendation) await chooseRecommendation(recommendation)
    return
  }
  await syncCatalog()
}

async function chooseRecommendation(recommendation: NSSCTFRecommendation) {
  source.value = 'public'
  problemInput.value = String(recommendation.problem.platformId)
  localMaterials.value = []
  attachmentError.value = ''
  working.value = true
  try {
    const challenge = await publicProblems.importChallenge(problemInput.value)
    if (!challenge) return
    selectedProblem.value = challenge
    screen.value = 'challenge'
  } finally {
    working.value = false
  }
}

async function startManualChallenge(request: CTFChallengeRequest) {
  manualCreating.value = true
  outcomeNotice.value = ''
  try {
    const started = await backend.startChallenge(request)
    if (!started) return
    manualIntake.value?.resetAndClose()
    screen.value = 'workspace'
  } finally {
    manualCreating.value = false
  }
}

function closeHistoryMenuOnOutsidePointer(event: PointerEvent) {
  if (!(event.target instanceof Node)) return
  for (const menu of [historyMenu.value]) {
    if (menu?.open && !menu.contains(event.target)) menu.open = false
  }
}

function closeHistoryMenu() {
  if (historyMenu.value) historyMenu.value.open = false
}

async function resumeFromHistory(id: string) {
  closeHistoryMenu()
  await resumeJob(id)
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function openExternalPlatform() {
  if (!activeExternalPlatform.value) return
  const sourceUrl = activeExternalPlatform.value.id === 'hackthebox'
    ? 'https://app.hackthebox.com/machines'
    : activeExternalPlatform.value.id === 'tryhackme'
      ? 'https://tryhackme.com/hacktivities'
      : activeExternalPlatform.value.sourceUrl
  await invokeCommand('open_ctf_source_url', { url: sourceUrl })
}

function chooseSeries(series: NSSCTFTrainingSeries) {
  source.value = 'public'
  selectedSeries.value = series
  selectedProblem.value = null
  seriesQuery.value = ''
  seriesCategory.value = 'all'
  seriesStatus.value = 'all'
  seriesPage.value = 1
  attachmentError.value = ''
  localMaterials.value = []
  screen.value = 'challenge'
}

async function chooseSeriesProblem(platformId: number) {
  localMaterials.value = []
  attachmentError.value = ''
  problemInput.value = String(platformId)
  const challenge = await publicProblems.importChallenge(problemInput.value)
  if (challenge) selectedProblem.value = challenge
}

async function chooseCatalogProblem(platformId: number) {
  selectedCTFShowProblemID.value = null
  await chooseSeriesProblem(platformId)
  if (selectedProblem.value) screen.value = 'detail'
}

async function openProblem() {
  if (!selectedProblem.value) return
  await invokeCommand('open_nssctf_challenge', { url: selectedProblem.value.sourceUrl })
}

async function refreshCTFShow() {
  catalogNotice.value = ''
  const result = await ctfshow.refresh()
  if (result?.catalog.total) {
    catalogNotice.value = t(`CTFshow 本地题库：${result.catalog.total} 题`, `CTFshow local catalog: ${result.catalog.total} challenges`)
  }
}

async function chooseCTFShowProblem(problemId: number) {
  const activeJob = backend.jobs.value.find(job => (
    job.externalPlatform === 'ctfshow-web'
    && job.externalAttemptId === problemId
    && !['succeeded', 'failed', 'cancelled'].includes(job.status)
  ))
  if (activeJob) {
    await resumeJob(activeJob.id)
    await openCodingAgent()
    return
  }
  working.value = true
  outcomeNotice.value = ''
  try {
    const workspace = await ctfshow.importChallenge(
      problemId,
      collaborationMode.value,
      localMaterials.value,
    )
    if (!workspace) return
    await backend.adoptProjection(workspace.ctf)
    screen.value = 'workspace'
    if (workspace.challenge.warnings.length) {
      outcomeNotice.value = t(`题目已建立工作区；导入提示：${workspace.challenge.warnings.join('；')}`, `Workspace created for the challenge; import notes: ${workspace.challenge.warnings.join('; ')}`)
    }
    await openCodingAgent()
  } finally {
    working.value = false
  }
}

async function openActiveChallenge() {
  const projection = activeProjection.value
  const sourceURI = projection?.challenge.source.uri
  if (!projection || !sourceURI) return
  if (projection.challenge.externalPlatform === 'nssctf-web') {
    await invokeCommand('open_nssctf_challenge', { url: sourceURI })
    return
  }
  await invokeCommand('open_ctf_source_url', { url: sourceURI })
}

function previewCTFShowProblem(problemId: number) {
  selectedProblem.value = null
  selectedCTFShowProblemID.value = problemId
  localMaterials.value = []
  attachmentError.value = ''
  screen.value = 'detail'
}

function returnToCatalog() {
  screen.value = 'challenge'
}

async function previousDeskPage() {
  if (deskPage.value <= 1) return
  if (activeBank.value === 'ctfshow') ctfshowPage.value -= 1
  else await loadPublicCatalog(catalogPage.value - 1)
}

async function nextDeskPage() {
  if (deskPage.value >= deskPageCount.value) return
  if (activeBank.value === 'ctfshow') ctfshowPage.value += 1
  else await loadPublicCatalog(catalogPage.value + 1)
}

async function goDeskPage(page: number) {
  const nextPage = Math.min(Math.max(page, 1), deskPageCount.value)
  if (nextPage === deskPage.value) return
  if (activeBank.value === 'ctfshow') ctfshowPage.value = nextPage
  else await loadPublicCatalog(nextPage)
}

async function chooseLocalMaterials() {
  attachmentError.value = ''
  try {
    const selected = await invokeCommand<CTFMaterialRequest[]>('choose_ctf_materials')
    if (!selected.length) return
    localMaterials.value = selected
    outcomeNotice.value = t(`已补充 ${selected.length} 项本地材料。`, `Added ${selected.length} local materials.`)
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function startPublicWorkspace() {
  if (!selectedProblem.value) return
  working.value = true
  attachmentError.value = ''
  try {
    if (selectedActiveJob.value) {
      await resumeJob(selectedActiveJob.value.id)
      await openCodingAgent()
      return
    }
    const challenge = selectedProblem.value
    const materials: CTFMaterialRequest[] = [...localMaterials.value]
    let materialWarning = ''
    if (selectedBrowserReady.value) {
      try {
        materials.push(await invokeCommand<CTFMaterialRequest>('import_nssctf_web_page_material', {
          problemId: challenge.platformId,
        }))
      } catch (reason) {
        materialWarning = reason instanceof Error ? reason.message : String(reason)
      }
    }
    if (challenge.hasAttachment) {
      if (!selectedBrowserReady.value && materials.length === 0) {
        materialWarning = t(`P${challenge.platformId} 的附件尚未导入；Coding 将先使用公开题面继续`, `The attachment for P${challenge.platformId} is not imported yet; Coding will continue with the public statement first`)
      }
      if (selectedBrowserReady.value) {
        try {
          materials.push(await invokeCommand<CTFMaterialRequest>('import_nssctf_web_attachment', {
            problemId: challenge.platformId,
          }))
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          materialWarning = materialWarning ? `${materialWarning}；${message}` : message
        }
      }
    }
    const started = await backend.startChallenge({
      title: challenge.title,
      statement: challenge.statement,
      category: challenge.category.toLowerCase(),
      collaborationMode: collaborationMode.value,
      deferAgent: true,
      trackName: t('NSSCTF 真实题库训练', 'NSSCTF live catalog training'),
      humanGoal: t('完成一道真实 NSSCTF 题目，并能复述假设、关键观察与最终证据。', 'Complete a real NSSCTF challenge and be able to recount the hypothesis, key observations, and final evidence.'),
      sourceKind: 'url',
      sourceUri: challenge.sourceUrl,
      externalPlatform: 'nssctf-web',
      externalAttemptId: challenge.platformId,
      expectedFlag: '',
      knowledgePoints: challenge.tags,
      materials,
    })
    if (!started) {
      attachmentError.value = backend.error.value ?? t('无法建立 CTF 工作台。', 'Could not create the CTF workspace.')
      return
    }
    if (materialWarning) {
      outcomeNotice.value = t(`${materialWarning}。工作台已使用公开题面和现有材料继续建立。`, `${materialWarning}. The workspace continued with the public statement and existing materials.`)
    }
    screen.value = 'workspace'
    await openCodingAgent()
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    working.value = false
  }
}

async function startArenaWorkspace() {
  source.value = 'arena'
  if (!props.arenaReady) {
    emit('openSettings')
    return
  }
  working.value = true
  const started = await arena.start()
  if (started?.ctf) {
    await backend.adoptProjection(started.ctf)
    screen.value = 'workspace'
  }
  working.value = false
}

/**
 * Open/reuse deferred CTF Coding session + mount domain context without sending.
 * Does not require model credentials; Start Agent remains a separate explicit action.
 */
async function openCodingContext() {
  if (!activeProjection.value) return
  await backend.loadAgentState(activeProjection.value.job.id)
  working.value = true
  outcomeNotice.value = ''
  try {
    const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>('prepare_ctf_agent_workspace', {
      id: activeProjection.value.job.id,
    })
    backend.agentRun.value = handoff.run
    emit('startCodingAgent', handoff)
  } catch (reason) {
    outcomeNotice.value = t(`无法打开 Coding 上下文：${String(reason)}`, `Could not open the Coding context: ${String(reason)}`)
  } finally {
    working.value = false
  }
}

async function revealConversationComposer() {
  await nextTick()
  await conversationDock.value?.revealAndFocus()
}

async function openCodingAgent() {
  if (!activeProjection.value) return
  await backend.loadAgentState(activeProjection.value.job.id)
  if (!props.modelReady) {
    // Opening Coding context is allowed; only the Agent turn needs the model.
    await openCodingContext()
    outcomeNotice.value = t('已打开本题对话。配置模型后再发送。', 'Opened this challenge conversation. Configure a model before sending.')
    await revealConversationComposer()
    return
  }
  await openCodingContext()
  await revealConversationComposer()
}

async function requestEndpoint(request: CTFEndpointRequestInput) {
  if (!activeProjection.value) return
  working.value = true
  outcomeNotice.value = ''
  try {
    const projection = await invokeCommand<CTFProjection>('request_ctf_endpoint', {
      id: activeProjection.value.job.id,
      request,
    })
    await backend.adoptProjection(projection)
    outcomeNotice.value = t('已记录申请', 'Request recorded')
  } catch (reason) {
    outcomeNotice.value = t(`无法记录 Endpoint 申请：${String(reason)}`, `Could not record the Endpoint request: ${String(reason)}`)
  } finally {
    working.value = false
  }
}

async function approveEndpoint(requestId: string) {
  if (!activeProjection.value) return
  working.value = true
  outcomeNotice.value = ''
  try {
    const projection = await invokeCommand<CTFProjection>('approve_ctf_endpoint', {
      id: activeProjection.value.job.id,
      requestId,
    })
    await backend.adoptProjection(projection)
    outcomeNotice.value = t('已为这一项生成独立 Scope。旧的 Agent 工具会话已关闭；恢复 Agent 后只加载新的精确协议权限，Shell 仍然禁网。', 'Created an independent Scope for this item. The previous Agent tool session is closed; resume the Agent to load only the new exact-protocol permission. Shell stays offline.')
  } catch (reason) {
    outcomeNotice.value = t(`无法批准 Endpoint：${String(reason)}`, `Could not approve the Endpoint: ${String(reason)}`)
    await backend.selectJob(activeProjection.value.job.id)
  } finally {
    working.value = false
  }
}

async function denyEndpoint(requestId: string) {
  if (!activeProjection.value) return
  working.value = true
  outcomeNotice.value = ''
  try {
    const projection = await invokeCommand<CTFProjection>('deny_ctf_endpoint', {
      id: activeProjection.value.job.id,
      requestId,
    })
    await backend.adoptProjection(projection)
    outcomeNotice.value = t('已拒绝这一项；没有创建 Scope，也没有启用网络工具。', 'Denied this item; no Scope was created and network tools stay disabled.')
  } catch (reason) {
    outcomeNotice.value = t(`无法拒绝 Endpoint：${String(reason)}`, `Could not deny the Endpoint: ${String(reason)}`)
  } finally {
    working.value = false
  }
}

async function sendDebriefReflection(content: string) {
  if (!activeProjection.value || !content.trim()) return
  working.value = true
  const recorded = await backend.recordLearning(activeProjection.value.job.id, {
    kind: 'reflection',
    content: content.trim(),
    concept: t('CTF 解题复盘', 'CTF solving debrief'),
  })
  if (recorded) outcomeNotice.value = t('复盘已保存；现在可以沉淀为可复用技法。', 'Debrief saved; you can now save it as a reusable technique.')
  working.value = false
}

async function sendIndependentStep(content: string) {
  if (!activeProjection.value || !content.trim()) return
  working.value = true
  const recorded = await backend.recordLearning(activeProjection.value.job.id, {
    kind: 'independent_step',
    content: content.trim(),
    concept: t('用户确认的解题步骤', 'User-confirmed solving step'),
  })
  if (recorded) {
    outcomeNotice.value = activeProjection.value?.humanOutcome.contribution.assistance === 'none'
      ? t('已记录为有明确用户证据的独立步骤。', 'Recorded as an independent step with explicit user evidence.')
      : t('已记录用户实际完成的步骤，并保留本次协助方式。', 'Recorded the step you actually completed, keeping this assistance mode.')
  }
  working.value = false
}

async function refreshTrainingProgress() {
  await training.load()
  if (activeBank.value === 'nssctf') {
    await publicCatalog.refreshProgress()
    await loadPublicCatalog(catalogPage.value)
  }
}

async function saveTrainingMemory() {
  if (!activeProjection.value) return
  working.value = true
  try {
    await invokeCommand('save_ctf_training_memory', {
      id: activeProjection.value.job.id,
    })
    await loadMemoryContext(activeProjection.value.job.id)
    outcomeNotice.value = t('已保存为本机可复用技法；以后同分类题会把它作为待验证先验交给 Agent。', 'Saved as a local reusable technique. Future challenges in the same category will pass it to the Agent as a prior pending verification.')
  } catch (reason) {
    outcomeNotice.value = t(`无法保存训练记忆：${String(reason)}`, `Could not save training memory: ${String(reason)}`)
  } finally {
    working.value = false
  }
}

async function loadMemoryContext(jobId: string) {
  memoryLoading.value = true
  try {
    recalledMemories.value = await invokeCommand<CTFTrainingMemory[]>(
      'get_ctf_memory_context',
      { id: jobId },
    )
  } catch {
    recalledMemories.value = []
  } finally {
    memoryLoading.value = false
  }
}

async function archiveTrainingMemory(memory: CTFTrainingMemory) {
  if (!activeProjection.value) return
  working.value = true
  try {
    await invokeCommand('archive_ctf_memory', {
      id: memory.id,
      reason: t(`用户在 ${activeProjection.value.challenge.title} 的记忆上下文中停用`, `Disabled by the user in the memory context of ${activeProjection.value.challenge.title}`),
    })
    await loadMemoryContext(activeProjection.value.job.id)
    outcomeNotice.value = t('这条综合记忆已停用；原始训练轨迹和证据仍保留。', 'This synthesized memory is disabled; the original training trajectory and evidence remain.')
  } catch (reason) {
    outcomeNotice.value = t(`无法停用训练记忆：${String(reason)}`, `Could not disable training memory: ${String(reason)}`)
  } finally {
    working.value = false
  }
}

function inspectTrainingMemoryEvidence(evidence: CTFTrainingMemoryEvidenceLink) {
  outcomeNotice.value = t(`正在核对记忆证据 ${evidence.kind}:${evidence.id}。请以当前题目证据、Judge 回执、提示和步骤记录为准，不把旧题记忆直接当作用户能力事实。`, `Checking memory evidence ${evidence.kind}:${evidence.id}. Treat current challenge evidence, Judge receipts, hints, and step records as authoritative; do not take prior-challenge memory as a user-skill fact.`)
}

async function submitCandidate() {
  if (!activeProjection.value || !flagCandidate.value.trim()) return
  outcomeNotice.value = ''
  const candidate = flagCandidate.value.trim()
  const previousSubmission = activeProjection.value.submissions.find(
    submission => submission.candidate === candidate,
  )
  if (previousSubmission?.verdict === 'pass') {
    outcomeNotice.value = t('这个候选已经被平台确认 Accepted，无需再次提交。', 'This candidate has already been Accepted by the platform; no need to submit again.')
    return
  }
  if (previousSubmission?.verdict === 'fail') {
    outcomeNotice.value = t('这个候选已被平台拒绝，请修改后再提交。', 'This candidate was Rejected by the platform; change it before submitting again.')
    return
  }
  if (previousSubmission?.verdict === 'needs_review') {
    outcomeNotice.value = t('这个候选正在等待平台判题，不能并发重复提交。', 'This candidate is waiting for a platform verdict; do not submit it again in parallel.')
    return
  }
  if (isArenaWorkspace.value && arenaAttempt.value) {
    working.value = true
    const result = await arena.submit(
      activeProjection.value.job.id,
      arenaAttempt.value.id,
      flagCandidate.value.trim(),
    )
    if (result) {
      await backend.adoptProjection(result.ctf)
      await refreshTrainingProgress()
      outcomeNotice.value = result.arena.correct
        ? t('NSSCTF Agent Arena 已确认 Accepted，平台回执已经写入证据链。', 'NSSCTF Agent Arena confirmed Accepted. The platform receipt is written into the evidence chain.')
        : t(`NSSCTF Agent Arena 返回 Rejected，剩余错误次数 ${result.arena.remaining_wrong_attempts ?? t('以平台为准', 'per the platform')}。`, `NSSCTF Agent Arena returned Rejected. Remaining wrong attempts: ${result.arena.remaining_wrong_attempts ?? t('以平台为准', 'per the platform')}.`)
    }
    working.value = false
    return
  }

  if (isCTFShowWorkspace.value) {
    working.value = true
    const result = await ctfshow.submitFlag(
      activeProjection.value.job.id,
      flagCandidate.value.trim(),
    )
    if (result) {
      await backend.adoptProjection(result.ctf)
      await refreshTrainingProgress()
      outcomeNotice.value = result.receipt.correct
        ? `CTFshow #${result.receipt.problemId} Accepted。`
        : `CTFshow #${result.receipt.problemId} Rejected。`
    } else {
      outcomeNotice.value = ctfshow.error.value ?? t('CTFshow Judge 没有返回可确认结果。', 'CTFshow Judge did not return a confirmable result.')
      await backend.loadJobs()
    }
    working.value = false
    return
  }

  if (isWebWorkspace.value) {
    working.value = true
    const result = await webBridge.submit(
      activeProjection.value.job.id,
      flagCandidate.value.trim(),
    )
    if (result) {
      await backend.adoptProjection(result.ctf)
      await refreshTrainingProgress()
      outcomeNotice.value = result.receipt.correct
        ? `NSSCTF P${result.receipt.problemId} Accepted。`
        : `NSSCTF P${result.receipt.problemId} Rejected。`
    } else {
      // An ambiguous or timed-out platform response is still persisted as a
      // receipt. Reload the projection so the user sees that evidence and can
      // decide whether to retry instead of losing the platform observation.
      await backend.loadJobs()
      platformReview.value = activeProjection.value?.evaluations.at(-1)?.verdict === 'inconclusive'
    }
    working.value = false
    return
  }

  working.value = true
  const prepared = await backend.prepareExternalSubmission(
    activeProjection.value.job.id,
    flagCandidate.value.trim(),
    t('用户确认该候选已有可复核依据，并准备交给已授权的外部 Judge。', 'The user confirmed this candidate has reviewable evidence and is ready for the authorized external Judge.'),
  )
  if (prepared) {
    await navigator.clipboard.writeText(flagCandidate.value.trim())
    const sourceURI = activeProjection.value?.challenge.source.uri
    if (activeProjection.value?.challenge.source.kind === 'url' && sourceURI) {
      try {
        await invokeCommand('open_ctf_source_url', { url: sourceURI })
      } catch (reason) {
        outcomeNotice.value = t(`候选已复制并进入 Judge 闸门，但无法打开题目 URL：${String(reason)}`, `Candidate copied and entered the Judge gate, but the challenge URL could not be opened: ${String(reason)}`)
      }
    }
    platformReview.value = true
    if (!outcomeNotice.value) {
      outcomeNotice.value = sourceURI
        ? t(`候选已复制并打开${externalJudgeLabel.value}；提交后回来记录结果。`, `Candidate copied and ${externalJudgeLabel.value} opened; come back to record the result after submitting.`)
        : t(`候选已复制；在${externalJudgeLabel.value}提交后回来记录结果。`, `Candidate copied; submit on ${externalJudgeLabel.value}, then come back to record the result.`)
    }
  } else {
    outcomeNotice.value = backend.error.value ?? t('候选没有进入外部 Judge 闸门。', 'The candidate did not enter the external Judge gate.')
  }
  working.value = false
}

async function recordPlatformResult(accepted: boolean) {
  if (!activeProjection.value) return
  const latest = activeProjection.value.evaluations.at(-1)
  const recorded = latest?.verdict === 'needs_review' || latest?.verdict === 'inconclusive'
    ? await backend.recordExternalVerdict(
        activeProjection.value.job.id,
        accepted,
        accepted
          ? t(`用户根据${externalJudgeLabel.value}确认 Accepted。`, `The user confirmed Accepted from ${externalJudgeLabel.value}.`)
          : t(`用户根据${externalJudgeLabel.value}确认 Rejected。`, `The user confirmed Rejected from ${externalJudgeLabel.value}.`),
      )
    : await backend.recordLearning(activeProjection.value.job.id, {
        kind: 'judge_observation',
        content: accepted
          ? t(`${externalJudgeLabel.value}显示 Accepted。`, `${externalJudgeLabel.value} showed Accepted.`)
          : t(`${externalJudgeLabel.value}显示 Rejected。`, `${externalJudgeLabel.value} showed Rejected.`),
        concept: t('外部平台 Judge', 'External platform Judge'),
      })
  if (recorded) {
    await refreshTrainingProgress()
    platformReview.value = false
    outcomeNotice.value = accepted
      ? t(`已记录${externalJudgeLabel.value} Accepted。`, `Recorded ${externalJudgeLabel.value} Accepted.`)
      : t(`已记录${externalJudgeLabel.value} Rejected。`, `Recorded ${externalJudgeLabel.value} Rejected.`)
  }
}

async function resumeJob(id: string) {
  await backend.selectJob(id)
  screen.value = 'workspace'
}

async function resumeInitialJobIfNeeded(id: string | null | undefined) {
  if (!id) return
  if (screen.value === 'workspace' && activeProjection.value?.job.id === id) return
  await resumeJob(id)
}

let bridgeStatusTimer: number | undefined

function refreshBridgePresence() {
  if (document.visibilityState !== 'visible') return
  if (activeBank.value === 'ctfshow') void ctfshow.refresh()
  else if (activeBank.value === 'nssctf') void webBridge.refresh()
}

onMounted(async () => {
  document.addEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
  void publicCatalog.ensureLoaded()
  await Promise.all([
    webBridge.refresh(),
    training.load(),
    platformRegistry.load(),
    activeBank.value === 'ctfshow' ? ctfshow.refresh() : Promise.resolve(null),
    activeBank.value === 'nssctf' ? loadPublicCatalog(1) : Promise.resolve(null),
  ])
  await bootstrapNSSCTFCatalog()
  await resumeInitialJobIfNeeded(props.initialJobId)
  await selectDefaultDeskProblem()
  if (props.arenaReady) await arena.refresh()
  bridgeStatusTimer = window.setInterval(refreshBridgePresence, 2500)
})

onActivated(() => {
  if (deactivatedFromWorkspace.value) void resumeInitialJobIfNeeded(props.initialJobId)
  void resetWorkspaceViewport()
})

onDeactivated(() => {
  deactivatedFromWorkspace.value = screen.value === 'workspace'
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
  if (bridgeStatusTimer !== undefined) window.clearInterval(bridgeStatusTimer)
})
</script>

<template>
  <main class="tactical-page flex min-w-0 flex-1 flex-col bg-background">
    <CTFWorkspaceHeader
      v-if="screen === 'workspace'"
      :challenge-title="activeProjection?.challenge.title"
      :browser-status="isWebWorkspace ? (activeBrowserReady ? 'live' : 'off') : ''"
      @return-catalog="showProblems"
      @open-browser-settings="$emit('openSettings', 'browser')"
      @refresh-bridge="webBridge.refresh"
    />

    <WorkspaceModuleTopBar
      module="ctf"
      v-else
      :title="screen === 'detail' ? (selectedProblem?.title || selectedCTFShowProblem?.title || t('题目', 'Challenge')) : t('挑战', 'Challenges')"
    >
      <template v-if="screen === 'detail'" #leading>
        <Button variant="ghost" size="icon-sm" :aria-label="t('返回题库', 'Back to catalog')" @click="returnToCatalog">
          <ArrowLeft class="size-4" />
        </Button>
      </template>
      <template #actions>
        <details
        v-if="ctfSection === 'catalog'"
        ref="historyMenu"
        class="app-no-drag relative shrink-0"
        @keydown.esc.stop.prevent="closeHistoryMenu"
      >
        <summary
          data-button=""
          data-variant="outline"
          data-size="sm"
          :class="buttonVariants({ variant: 'outline', size: 'sm' })"
          class="list-none [&::-webkit-details-marker]:hidden"
          :aria-label="t('打开训练历史', 'Open training history')"
        >
          <Clock3 class="size-4" />
          {{ t('历史', 'History') }}
          <span class="font-mono text-caption text-muted-foreground">
            {{ backend.jobs.value.length }}
          </span>
        </summary>
        <div
          data-state="open"
          data-side="bottom"
          :class="[menuContentClass, menuViewportClass]"
          class="tactical-floating-surface absolute right-0 top-[calc(100%+4px)] z-[var(--z-overlay)] max-h-[min(480px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] overflow-y-auto"
          role="menu"
          :aria-label="t('训练历史', 'Training history')"
        >
          <div :class="menuLabelClass" class="flex items-center justify-between gap-3 px-2.5 py-2">
            <span>{{ t('训练历史', 'Training history') }}</span>
            <span class="font-normal text-muted-foreground">{{ t('仅保存在本机', 'Stored on this machine only') }}</span>
          </div>
          <div :class="menuSeparatorClass" />
          <button
            v-for="job in backend.jobs.value"
            :key="job.id"
            type="button"
            role="menuitem"
            :class="menuItemClass"
            class="items-start gap-3 px-2.5 py-2.5 text-left hover:bg-[color:var(--ui-selected)] focus-visible:bg-[color:var(--ui-selected)]"
            :aria-current="activeProjection?.job.id === job.id ? 'true' : undefined"
            @click="resumeFromHistory(job.id)"
          >
            <span
              class="mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-md bg-muted px-1.5 py-1 text-caption font-medium"
            >
              {{ jobSummaryLabel(job) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-control font-medium">
                {{ job.title }}
              </span>
              <span class="mt-0.5 block truncate text-caption text-muted-foreground">
                {{ t(`${formatCategory(job.category)} · ${job.experimentCount} 次实验`, `${formatCategory(job.category)} · ${job.experimentCount} experiments`) }}
              </span>
            </span>
            <span class="mt-1 shrink-0 text-caption text-muted-foreground">
              {{ formatHistoryTime(job.updatedAt) }}
            </span>
            <Check
              v-if="activeProjection?.job.id === job.id"
              class="mt-1 size-4 shrink-0 text-brand"
            />
          </button>
        </div>
        </details>
        <Button
          v-if="ctfSection === 'catalog'"
          variant="ghost"
          size="sm"
          class="app-no-drag shrink-0"
          @click="openCustomImport"
        >
          <FilePlus2 class="size-4" />
          {{ t('导入', 'Import') }}
        </Button>
      </template>
      <template v-if="ctfSection === 'catalog' && activeQuestionBank" #filters>
      <div class="flex w-full flex-col gap-3">
        <CollectionViewFilter v-model="collectionView" :store="ctfCollections" />
        <div class="flex w-full flex-wrap items-center gap-3">
        <Select v-model="activeBank">
        <SelectTrigger
          size="sm"
          class="app-no-drag min-w-44 shrink-0"
          :aria-label="t('选择训练平台', 'Choose a training platform')"
        >
          <Library class="size-4 text-muted-foreground" />
          <SelectValue :placeholder="t('选择训练平台', 'Choose a training platform')">{{ activeSourceName }}</SelectValue>
        </SelectTrigger>
        <SelectContent size="sm" class="min-w-64">
          <SelectGroup>
            <SelectLabel>{{ t('训练平台', 'Training platforms') }}</SelectLabel>
            <SelectItem
              v-for="platform in visibleTrainingPlatforms"
              :key="platform.id"
              :value="platform.id"
            >
              <span class="flex min-w-44 items-center justify-between gap-4">
                <span>{{ platform.name }}</span>
                <span class="text-caption text-muted-foreground">
                  {{ platform.status === 'ready'
                    ? t('可用', 'Available')
                    : platform.status === 'planned'
                      ? t('接入中', 'Connecting')
                      : t('受限', 'Restricted') }}
                </span>
              </span>
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>{{ t('本地', 'Local') }}</SelectLabel>
            <SelectItem value="custom">
              <span class="flex min-w-44 items-center justify-between gap-4">
                <span>{{ t('自定义题目', 'Custom challenge') }}</span>
                <span class="text-caption text-muted-foreground">{{ t('本地工作区', 'Local workspace') }}</span>
              </span>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
        </Select>
        <label class="app-no-drag relative min-w-52 flex-1">
        <FileSearch class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="deskQuery"
          size="sm"
          class="pl-9"
          :placeholder="t('搜索题号或题名', 'Search by id or title')"
          :aria-label="t('搜索题库', 'Search catalog')"
        />
        </label>
        <NativeSelect
        v-model="deskCategory"
        size="sm"
        class="app-no-drag w-36"
        :aria-label="t('按题型筛选', 'Filter by category')"
      >
        <NativeSelectOption value="all">{{ t('全部分类', 'All categories') }}</NativeSelectOption>
        <NativeSelectOption
          v-for="category in deskCategories"
          :key="category"
          :value="category"
        >
          {{ category }}
        </NativeSelectOption>
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          class="app-no-drag shrink-0"
          :aria-label="t('浏览器连接设置', 'Browser connection settings')"
          @click="$emit('openSettings', 'browser')"
        >
          <Cable class="size-4" />
          {{ browserBridgeConnected ? t('浏览器已连接', 'Browser connected') : t('连接浏览器', 'Connect browser') }}
          <span
            class="ak-status ak-status--compact"
            :class="browserBridgeConnected ? '' : 'ak-status--offline'"
          >
            <span class="ak-status__signal" />
            <span class="ak-status__label">{{ browserBridgeConnected ? 'LIVE' : 'OFF' }}</span>
          </span>
        </Button>
        <Button
        variant="ghost"
        size="icon-sm"
        class="app-no-drag"
        :loading="activeBank === 'nssctf' ? training.syncing.value : ctfshow.loading.value"
        :aria-label="t('刷新当前题库', 'Refresh current catalog')"
        @click="activeBank === 'nssctf' ? syncCatalog() : refreshCTFShow()"
      >
          <RefreshCw class="size-4" />
        </Button>
        </div>
      </div>
      </template>
    </WorkspaceModuleTopBar>

    <div
      ref="workspaceScrollArea"
      class="min-h-0 flex-1"
      :class="screen === 'challenge' ? 'overflow-hidden' : 'overflow-y-auto px-6 py-7'"
    >
      <div
        class="w-full"
        :class="screen === 'challenge' ? 'h-full' : screen === 'source' ? 'mx-auto max-w-5xl' : 'mx-auto max-w-5xl'"
      >
        <ol v-if="ctfSection === 'catalog' && screen === 'source'" class="tactical-paper mx-auto mb-8 grid max-w-3xl grid-cols-3 p-4" :aria-label="t('训练步骤', 'Training steps')">
          <li
            v-for="item in [
              { index: 1, label: t('选择入口', 'Choose a source') },
              { index: 2, label: t('选择题目', 'Choose a challenge') },
              { index: 3, label: t('Agent 工作台', 'Agent workspace') },
            ]"
            :key="item.index"
            class="relative flex flex-col items-center gap-2 text-center"
          >
            <span
              v-if="item.index > 1"
              class="absolute right-1/2 top-3 h-px w-full bg-border"
              aria-hidden="true"
            />
            <span
              class="relative z-10 grid size-6 place-items-center rounded-full border text-caption font-medium"
              :class="item.index <= step ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground'"
            >
              <Check v-if="item.index < step" class="size-3.5" />
              <span v-else>{{ item.index }}</span>
            </span>
            <span class="relative text-caption" :class="item.index === step ? 'font-medium text-foreground' : 'text-muted-foreground'">
              {{ item.label }}
            </span>
          </li>
        </ol>

        <section v-if="ctfSection === 'catalog' && screen === 'source'" aria-labelledby="source-title">
          <h1 id="source-title" class="sr-only">CTF</h1>

          <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
            <NativeSelect
              v-model="activeBank"
              size="sm"
              :aria-label="t('选择题库', 'Choose a catalog')"
            >
              <NativeSelectOption
                v-for="platform in visibleTrainingPlatforms"
                :key="platform.id"
                :value="platform.id"
              >
                {{ platform.name }}
              </NativeSelectOption>
              <NativeSelectOption value="custom">{{ t('自定义题目', 'Custom challenge') }}</NativeSelectOption>
            </NativeSelect>
            <span class="text-caption text-muted-foreground">
              {{ activeBank === 'nssctf'
                ? t(`${training.dashboard.value?.catalogTotal ?? 0} 题`, `${training.dashboard.value?.catalogTotal ?? 0} challenges`)
                : activeBank === 'ctfshow'
                  ? t(`${ctfshow.status.value?.catalog.total ?? 0} 题`, `${ctfshow.status.value?.catalog.total ?? 0} challenges`)
                  : t('统一训练工作区', 'Shared training workspace') }}
            </span>
          </div>

          <section
            v-if="catalogAction"
            class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            :aria-label="t('当前操作', 'Current action')"
          >
            <Button
              variant="outline"
              size="sm"
              @click="runCatalogAction"
            >
              {{ catalogAction.label }}
            </Button>
          </section>

          <section v-if="activeBank === 'ctfshow'" aria-labelledby="ctfshow-title">
            <Alert v-if="ctfshow.error.value" variant="destructive" class="mb-5">
              <Circle class="size-4" />
              <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
                <span>{{ ctfshow.error.value }}</span>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="ctfshow.loading.value"
                  @click="refreshCTFShow"
                >
                  <RefreshCw class="size-4" />
                  {{ t('重试同步', 'Retry sync') }}
                </Button>
              </AlertDescription>
            </Alert>

            <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="ctfshow-title" class="text-xl font-semibold tracking-[-0.025em]">{{ t('CTFshow 题库', 'CTFshow catalog') }}</h2>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{ ctfshow.status.value?.catalog.lastSyncedAt
                    ? t(`更新于 ${new Date(ctfshow.status.value.catalog.lastSyncedAt).toLocaleString()}`, `Updated ${new Date(ctfshow.status.value.catalog.lastSyncedAt).toLocaleString()}`)
                    : t('尚未同步', 'Not synced yet') }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <SegmentedControl
                  v-model="collaborationMode"
                  :aria-label="t('CTFshow 协作模式', 'CTFshow collaboration mode')"
                  :items="modeItems"
                />
                <Button variant="outline" @click="ctfshow.open()">
                  <ExternalLink class="size-4" />
                  {{ t('打开 CTFshow', 'Open CTFshow') }}
                </Button>
                <Button :loading="ctfshow.loading.value" @click="refreshCTFShow">
                  <RefreshCw class="size-4" />
                  {{ t('刷新', 'Refresh') }}
                </Button>
              </div>
            </div>

            <SettingsSection v-if="!ctfshowProblems.length" title="CTFshow">
              <SettingsRow stack="always" :label="t('在 CTFshow 页点击 MilkSU 扩展', 'Click the MilkSU extension on a CTFshow page')" :divider="false">
                <Button
                  variant="outline"
                  size="sm"
                  @click="$emit('openSettings', 'browser')"
                >
                  <Cable class="size-4" />
                  {{ t('前往浏览器设置', 'Open browser settings') }}
                </Button>
              </SettingsRow>
            </SettingsSection>

            <template v-else>
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <Input v-model="ctfshowQuery" size="sm" :placeholder="t('搜索题号、题名或标签', 'Search by id, title, or tag')" />
                <NativeSelect v-model="ctfshowCategory" size="sm" :aria-label="t('题型', 'Category')">
                  <NativeSelectOption value="all">{{ t('全部题型', 'All categories') }}</NativeSelectOption>
                  <NativeSelectOption
                    v-for="category in ctfshowCategories"
                    :key="category"
                    :value="category"
                  >
                    {{ category }}
                  </NativeSelectOption>
                </NativeSelect>
              </div>

              <div class="mt-4 overflow-hidden rounded-xl border border-border bg-card">
                <div class="hidden grid-cols-[76px_minmax(0,1fr)_110px_90px_90px_96px_32px] gap-3 border-b border-border bg-muted/30 px-4 py-2.5 text-caption text-muted-foreground md:grid">
                  <span>ID</span>
                  <span>{{ t('题目', 'Challenge') }}</span>
                  <span>{{ t('题型', 'Category') }}</span>
                  <span>{{ t('分值', 'Points') }}</span>
                  <span>{{ t('解出', 'Solves') }}</span>
                  <span>{{ t('进度', 'Progress') }}</span>
                  <span />
                </div>
                <button
                  v-for="problem in visibleCTFShowProblems"
                  :key="problem.platformId"
                  type="button"
                  :disabled="working || ctfshow.loading.value"
                  class="group grid w-full grid-cols-[60px_minmax(0,1fr)_24px] items-center gap-3 border-b border-border px-4 py-3 text-left last:border-0 md:grid-cols-[76px_minmax(0,1fr)_110px_90px_90px_96px_32px]"
                  @click="chooseCTFShowProblem(problem.platformId)"
                >
                  <span class="font-mono text-caption text-muted-foreground">#{{ problem.platformId }}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-control font-medium group-hover:text-primary">{{ problem.title }}</span>
                    <span v-if="problem.tags.length" class="mt-0.5 block truncate text-caption text-muted-foreground">
                      {{ problem.tags.slice(0, 4).join(' · ') }}
                    </span>
                  </span>
                  <span class="hidden text-caption md:block">{{ problem.category }}</span>
                  <span class="hidden font-mono text-caption md:block">{{ problem.points }}</span>
                  <span class="hidden font-mono text-caption text-muted-foreground md:block">{{ problem.solvedCount }}</span>
                  <span class="hidden md:block">
                    <Badge
                      :variant="ctfshowProblemStatus(problem.platformId) === 'completed' ? 'secondary' : 'outline'"
                    >
                      {{ ctfshowProblemStatusLabel(problem.platformId) }}
                    </Badge>
                  </span>
                  <ChevronRight class="size-4 text-muted-foreground" />
                </button>
                <div v-if="!visibleCTFShowProblems.length" class="px-5 py-12 text-center text-control text-muted-foreground">
                  {{ t('没有匹配题目', 'No matching challenges') }}
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>{{ t(`${filteredCTFShowProblems.length} 题`, `${filteredCTFShowProblems.length} challenges`) }}</span>
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ctfshowPage <= 1"
                    @click="ctfshowPage -= 1"
                  >
                    <ChevronLeft class="size-4" />
                    {{ t('上一页', 'Previous') }}
                  </Button>
                  <span class="min-w-14 text-center font-mono">{{ ctfshowPage }} / {{ ctfshowPageCount }}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ctfshowPage >= ctfshowPageCount"
                    @click="ctfshowPage += 1"
                  >
                    {{ t('下一页', 'Next') }}
                    <ChevronRight class="size-4" />
                  </Button>
                </div>
              </div>
            </template>
          </section>

          <Alert v-if="activeBank === 'nssctf' && training.error.value" variant="destructive" class="mb-5">
            <Circle class="size-4" />
            <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
              <span>{{ training.error.value }}</span>
              <Button
                variant="outline"
                size="sm"
                :loading="training.syncing.value"
                @click="syncCatalog"
              >
                <RefreshCw class="size-4" />
                {{ t('重试同步', 'Retry sync') }}
              </Button>
            </AlertDescription>
          </Alert>

          <Alert v-if="activeBank === 'nssctf' && training.syncing.value" class="mb-5">
            <RefreshCw class="size-4 animate-spin" />
            <AlertDescription>
              {{ t('正在限速同步 NSSCTF 公开题库；遇到平台限流会自动退避重试，完成前仍保留上一次完整快照。', 'Syncing the NSSCTF public catalog at a limited rate. Rate limits trigger automatic backoff; the last complete snapshot is kept until this finishes.') }}
            </AlertDescription>
          </Alert>

          <Alert v-if="activeBank === 'nssctf' && catalogNotice" class="mb-5">
            <Check class="size-4" />
            <AlertDescription>{{ catalogNotice }}</AlertDescription>
          </Alert>

          <section v-if="activeBank === 'nssctf'" class="mb-6 overflow-hidden rounded-xl border border-primary/20 bg-card">
            <div class="grid lg:grid-cols-[minmax(0,1fr)_220px]">
              <div class="p-6 sm:p-8">
                <p class="flex items-center gap-2 text-caption font-medium text-primary">
                  <Target class="size-4" />
                  {{ dailyMission.eyebrow }}
                </p>
                <h2 class="mt-3 max-w-2xl text-2xl font-semibold tracking-[-0.035em]">
                  {{ dailyMission.title }}
                </h2>
                <div class="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    v-if="dailyMission.kind !== 'resume'"
                    variant="brand"
                    size="lg"
                    :loading="working || training.syncing.value"
                    @click="runDailyMission"
                  >
                    <Play class="size-4" />
                    {{ dailyMission.action }}
                    <ArrowRight class="size-4" />
                  </Button>
                  <span
                    v-else
                    class="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-caption text-muted-foreground"
                  >
                    <Clock3 class="size-4" />
                    {{ t('从右上角历史恢复', 'Resume from History in the top-right') }}
                  </span>
                  <span class="text-caption text-muted-foreground">{{ dailyMission.meta }}</span>
                </div>
              </div>
              <div class="grid grid-cols-3 border-t border-border bg-muted/30 lg:grid-cols-1 lg:border-l lg:border-t-0">
                <div class="px-5 py-4 lg:border-b lg:border-border">
                  <p class="text-caption text-muted-foreground">{{ t('已完成', 'Completed') }}</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ t(`${solvedJobCount} 题`, `${solvedJobCount} challenges`) }}</p>
                </div>
                <div class="border-x border-border px-5 py-4 lg:border-x-0 lg:border-b">
                  <p class="text-caption text-muted-foreground">{{ t('已实验', 'Experiments') }}</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ t(`${totalExperimentCount} 次`, `${totalExperimentCount} runs`) }}</p>
                </div>
                <div class="px-5 py-4">
                  <p class="text-caption text-muted-foreground">{{ t('本地题库', 'Local catalog') }}</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ t(`${training.dashboard.value?.catalogTotal ?? 0} 题`, `${training.dashboard.value?.catalogTotal ?? 0} challenges`) }}</p>
                </div>
              </div>
            </div>
          </section>

          <SettingsSection
            v-if="activeBank === 'nssctf' && training.dashboard.value"
            :title="t('推荐下一道 NSSCTF 题', 'Recommended next NSSCTF challenge')"
          >
            <template #actions>
              <Button
                variant="ghost"
                size="sm"
                :loading="training.syncing.value"
                @click="syncCatalog"
              >
                <RefreshCw class="size-4" />
                {{ t('更新题库', 'Update catalog') }}
              </Button>
            </template>
            <div
              v-for="(recommendation, index) in training.dashboard.value.recommendations.slice(0, 4)"
              :key="recommendation.problem.platformId"
              class="contents"
            >
              <ModelListRow
                :label="recommendation.problem.title"
                :meta="`${recommendation.kind} · P${recommendation.problem.platformId} · ${recommendation.problem.difficulty.toFixed(1)}`"
                :last="index === Math.min(3, training.dashboard.value.recommendations.length - 1)"
                @click="chooseRecommendation(recommendation)"
              >
                <template #trailing>
                  <ChevronRight class="size-4 text-muted-foreground" />
                </template>
              </ModelListRow>
            </div>
            <SettingsRow
              v-if="!training.dashboard.value.recommendations.length"
              stack="always"
              :divider="false"
            >
              <Button variant="brand" :loading="training.syncing.value" @click="syncCatalog">
                {{ t('同步题库', 'Sync catalog') }}
              </Button>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection v-if="activeBank === 'nssctf' && training.dashboard.value?.series.length" class="mt-6" :title="t('赛事题单', 'Event playlists')">
            <template #actions>
              <Badge variant="outline">{{ t(`${training.dashboard.value.series.length} 个系列`, `${training.dashboard.value.series.length} series`) }}</Badge>
            </template>
            <div
              v-for="(series, index) in training.dashboard.value.series.slice(0, 4)"
              :key="series.name"
              class="contents"
            >
              <ModelListRow
                :label="series.name"
                :meta="series.attemptedCount
                  ? t(`${series.problemCount} 题 · ${difficultyLabel(series.averageDifficulty)} · 完成 ${series.completedCount}/${series.problemCount}`, `${series.problemCount} challenges · ${difficultyLabel(series.averageDifficulty)} · completed ${series.completedCount}/${series.problemCount}`)
                  : t(`${series.problemCount} 题 · ${difficultyLabel(series.averageDifficulty)} · 未开始`, `${series.problemCount} challenges · ${difficultyLabel(series.averageDifficulty)} · not started`)"
                :last="index === Math.min(3, training.dashboard.value.series.length - 1)"
                @click="chooseSeries(series)"
              >
                <template #trailing>
                  <ChevronRight class="size-4 text-muted-foreground" />
                </template>
              </ModelListRow>
            </div>
          </SettingsSection>

          <div v-if="activeBank === 'nssctf'" class="mt-6 grid gap-3 md:grid-cols-2">
            <ActionCard
              :title="t('NSSCTF 公开题库', 'NSSCTF public catalog')"
              @click="showProblems"
            >
              <template #icon><Library /></template>
              <template #trailing>
                <span class="flex items-center gap-2 text-body font-medium">
                  {{ t(`${training.dashboard.value?.catalogTotal ?? 0} 题`, `${training.dashboard.value?.catalogTotal ?? 0} challenges`) }}
                  <ChevronRight class="size-4" />
                </span>
              </template>
            </ActionCard>

            <ActionCard
              title="NSSCTF Agent Arena"
              @click="startArenaWorkspace"
            >
              <template #icon><Zap /></template>
              <template #trailing>
                <LoaderCircle v-if="working" class="size-4 animate-spin" />
                <Badge v-else-if="arenaReady" variant="outline">{{ t('已连接', 'Connected') }}</Badge>
                <span v-else class="flex items-center gap-2 text-body text-muted-foreground">
                  <KeyRound class="size-4" />
                  {{ t('配置 Token', 'Configure Token') }}
                </span>
              </template>
            </ActionCard>
          </div>

          <section v-if="activeBank === 'nssctf' && backend.jobs.value.length" class="mt-9 border-t border-border pt-6">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-label font-medium">{{ t('最近训练', 'Recent training') }}</h2>
              <div class="flex items-center gap-3">
                <span class="text-caption text-muted-foreground">{{ t(`${backend.jobs.value.length} 个任务`, `${backend.jobs.value.length} tasks`) }}</span>
                <Button
                  v-if="backend.jobs.value.length > 3"
                  variant="link"
                  size="text"
                  @click="historyExpanded = !historyExpanded"
                >
                  {{ historyExpanded ? t('收起', 'Collapse') : t('查看全部', 'View all') }}
                </Button>
              </div>
            </div>
            <button
              v-for="job in visibleHistoryJobs"
              :key="job.id"
              type="button"
              class="flex w-full items-center gap-4 border-b border-border px-1 py-3 text-left last:border-b-0"
              @click="resumeJob(job.id)"
            >
              <Clock3 class="size-4 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-control font-medium">{{ job.title }}</span>
                <span class="mt-0.5 block text-caption text-muted-foreground">
                  {{ t(`${formatCategory(job.category)} · ${job.experimentCount} 次实验`, `${formatCategory(job.category)} · ${job.experimentCount} experiments`) }}
                </span>
              </span>
              <Badge variant="outline">{{ jobSummaryLabel(job) }}</Badge>
              <ChevronRight class="size-4 text-muted-foreground" />
            </button>
          </section>

        </section>

        <section
          v-else-if="ctfSection === 'catalog' && screen === 'challenge' && activeBank === 'custom'"
          class="h-full overflow-y-auto px-6 py-8"
          aria-labelledby="custom-challenge-title"
        >
          <div class="mx-auto max-w-4xl">
            <Button variant="ghost" size="sm" class="mb-4" @click="cancelCustomImport">
              <ArrowLeft class="size-4" />
              {{ t('取消导入并返回题库', 'Cancel import and return to catalog') }}
            </Button>
            <SettingsSection>
              <div class="px-5 py-6 sm:px-6 sm:py-7">
              <span class="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <FilePlus2 class="size-5" />
              </span>
              <h2 id="custom-challenge-title" class="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                {{ t('自定义题目', 'Custom challenge') }}
              </h2>
              <p class="mt-2 max-w-2xl text-body leading-6 text-muted-foreground">
                {{ t('线下赛或自备题目，导入后在本机建立工作区。', 'Offline or self-hosted challenges. Import them to create a workspace on this machine.') }}
              </p>

              <div class="mt-7 grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <Archive class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">{{ t('本地保存', 'Saved locally') }}</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ t('题面、截图和附件进入本题工作区。', 'Statement, screenshots, and attachments go into this challenge workspace.') }}</p>
                </div>
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <Bot class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">{{ t('Agent 可读', 'Readable by Agent') }}</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ t('沿用同一套 Coding、证据与复盘能力。', 'Uses the same Coding, evidence, and debrief capabilities.') }}</p>
                </div>
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <ShieldCheck class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">{{ t('不代替判题', 'Does not replace judging') }}</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">{{ t('外部平台结果仍由你确认并记录。', 'You still confirm and record the external platform result.') }}</p>
                </div>
              </div>

              <Button class="mt-7" size="lg" @click="manualIntake?.open()">
                <FilePlus2 class="size-4" />
                {{ t('新建自定义题目', 'New custom challenge') }}
              </Button>
              </div>
            </SettingsSection>
          </div>
        </section>

        <section
          v-else-if="ctfSection === 'catalog' && screen === 'challenge' && (activeBank === 'hackthebox' || activeBank === 'tryhackme')"
          class="h-full overflow-y-auto px-6 py-8"
          :aria-labelledby="`${activeBank}-platform-title`"
        >
          <div v-if="activeExternalPlatform" class="mx-auto max-w-4xl">
            <SettingsSection>
              <div class="px-5 py-6 sm:px-6 sm:py-7">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <span class="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Cable class="size-5" />
                </span>
                <Badge variant="outline">{{ externalPlatformStatusLabel }}</Badge>
              </div>
              <h2
                :id="`${activeBank}-platform-title`"
                class="mt-5 text-2xl font-semibold tracking-[-0.035em]"
              >
                {{ activeExternalPlatform.name }}
              </h2>
              <p class="mt-2 max-w-2xl text-body leading-6 text-muted-foreground">
                {{ externalPlatformSummary }}
              </p>

              <div class="mt-6 flex flex-wrap gap-2">
                <Badge
                  v-for="capability in externalPlatformCapabilities"
                  :key="capability"
                  variant="secondary"
                >
                  {{ capability }}
                </Badge>
              </div>

              <div class="mt-7 flex flex-wrap gap-3">
                <Button variant="outline" @click="openExternalPlatform">
                  <ExternalLink class="size-4" />
                  {{ t('查看官方入口', 'View official entry') }}
                </Button>
              </div>
              </div>
            </SettingsSection>
          </div>
        </section>

        <section
          v-else-if="ctfSection === 'catalog' && screen === 'detail'"
          class="flex min-h-0 flex-1 flex-col overflow-auto"
          :aria-label="t('题目详情', 'Challenge details')"
        >
          <div class="mx-auto w-full max-w-5xl space-y-5 px-6 py-6">
          <SettingsSection v-if="selectedProblem" :title="t('题目', 'Challenge')">
            <div class="px-4 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{{ formatCategory(selectedProblem.category) }}</Badge>
                <Badge v-if="selectedProblem.difficulty" variant="outline">{{ catalogDifficultyLabel(selectedProblem.difficulty) }}</Badge>
              </div>
              <h1 class="mt-3 text-3xl font-semibold tracking-[-0.04em]">{{ selectedProblem.title }}</h1>
              <p class="mt-2 font-mono text-caption text-muted-foreground">P{{ selectedProblem.platformId }}</p>
              <p
                v-if="dailyChallengeVisible?.platformId === selectedProblem.platformId && dailyChallengeReason"
                class="mt-3 border-l-2 border-primary pl-3 text-caption leading-5"
              >
                {{ dailyChallengeReason }}
              </p>
              <MarkdownContent
                v-if="selectedProblem.statement"
                class="mt-3 text-body leading-6"
                :content="selectedProblem.statement"
              />
            </div>
            <SettingsRow v-if="selectedProblem.sourceUrl" :label="t('原文', 'Original')">
              <Button variant="link" size="text" @click="openProblem">
                {{ t('打开原文', 'Open original') }}
                <ExternalLink class="size-3" />
              </Button>
            </SettingsRow>
            <SettingsRow :label="t('状态', 'Status')">
              <NativeSelect
                :model-value="manualStatuses[`nssctf:${selectedProblem.platformId}`] ?? 'not_started'"
                size="sm"
                class="w-32"
                :aria-label="t(`${selectedProblem.title} 状态`, `${selectedProblem.title} status`)"
                @change="updateCatalogProblemStatus"
              >
                <NativeSelectOption value="not_started">{{ t('未开始', 'Not started') }}</NativeSelectOption>
                <NativeSelectOption value="in_progress">{{ t('进行中', 'In progress') }}</NativeSelectOption>
                <NativeSelectOption value="paused">{{ t('稍后继续', 'Resume later') }}</NativeSelectOption>
                <NativeSelectOption value="completed">{{ t('已完成', 'Completed') }}</NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
            <template #footer>
              <Button
                v-if="dailyChallengeVisible?.platformId === selectedProblem.platformId"
                variant="outline"
                size="sm"
                @click="changeDailyChallenge"
              >
                {{ t('换一道', 'Try another') }}
              </Button>
              <Button variant="brand" size="sm" :loading="working" @click="openSelectedInCoding">
                {{ t('开始解题', 'Start solving') }}
              </Button>
            </template>
          </SettingsSection>
          <SettingsSection v-else-if="selectedCTFShowProblem" :title="t('题目', 'Challenge')">
            <div class="px-4 py-3">
              <Badge variant="outline">{{ selectedCTFShowProblem.category }}</Badge>
              <h1 class="mt-3 text-3xl font-semibold tracking-[-0.04em]">{{ selectedCTFShowProblem.title }}</h1>
              <p class="mt-2 text-caption text-muted-foreground">{{ t(`#${selectedCTFShowProblem.platformId} · ${selectedCTFShowProblem.points} 分`, `#${selectedCTFShowProblem.platformId} · ${selectedCTFShowProblem.points} pts`) }}</p>
            </div>
            <template #footer>
              <Button variant="brand" size="sm" :loading="working" @click="openSelectedInCoding">
                {{ t('开始解题', 'Start solving') }}
              </Button>
            </template>
          </SettingsSection>
          </div>
        </section>

        <CTFChallengeDesk
          v-else-if="ctfSection === 'catalog' && screen === 'challenge'"
          :active-bank="activeCatalogBank"
          :nssctf-problems="publicCatalog.result.value?.problems ?? []"
          :ctfshow-problems="visibleCTFShowProblems"
          :selected-nssctf="visibleSelectedNssctf"
          :daily-problem="dailyChallengeVisible"
          :daily-reason="dailyChallengeReason"
          :selected-ctfshow="selectedCTFShowProblem"
          :dashboard="training.dashboard.value"
          :nssctf-attempted-ids="publicCatalog.result.value?.attemptedProblemIds ?? []"
          :nssctf-completed-ids="publicCatalog.result.value?.completedProblemIds ?? []"
          :ctfshow-attempted-ids="ctfshow.status.value?.attemptedProblemIds ?? []"
          :ctfshow-completed-ids="ctfshow.status.value?.completedProblemIds ?? []"
          :page="deskPage"
          :page-count="deskPageCount"
          :total="deskProblemTotal"
          :loading="deskLoading || (activeBank === 'nssctf' && training.syncing.value)"
          :loading-title="deskLoadingTitle"
          :loading-detail="deskLoadingDetail"
          :empty-title="deskEmptyTitle"
          :empty-detail="deskEmptyDetail"
          :action-loading="working"
          :collaboration-mode="collaborationMode"
          :selected-browser-ready="selectedBrowserReady"
          :ctfshow-bridge-ready="ctfshowBridgeReady"
          :attachment-error="attachmentError || publicProblems.error.value || ''"
          :local-materials="localMaterials"
          :catalog-error="catalogErrorMessage"
          :model-verified="modelVerified"
          :catalog-ready="selectedCatalogReady"
          :judge-ready="selectedJudgeReady"
          :has-active-training="Boolean(selectedActiveJob)"
          :manual-statuses="manualStatuses"
          :conversations="conversations ?? []"
          :related-job-id="selectedCatalogJob?.id"
          :collection-store="ctfCollections"
          @select-nssctf="chooseCatalogProblem"
          @select-ctfshow="previewCTFShowProblem"
          @clear-selection="clearDeskSelection"
          @previous-page="previousDeskPage"
          @next-page="nextDeskPage"
          @go-page="goDeskPage"
          @start-nssctf="startPublicWorkspace"
          @choose-local-materials="chooseLocalMaterials"
          @start-ctfshow="chooseCTFShowProblem"
          @open-problem="openProblem"
          @open-ctfshow="ctfshow.open()"
          @sync-nssctf="syncCatalog"
          @refresh-judge="activeBank === 'ctfshow' ? ctfshow.open() : webBridge.refresh()"
          @open-settings="$emit('openSettings')"
          @open-browser-settings="$emit('openSettings', 'browser')"
          @open-conversation="$emit('openCodingConversation', $event)"
          @update-manual-status="updateManualStatus"
          @change-daily="changeDailyChallenge"
          @update:collaboration-mode="collaborationMode = $event"
        />


        <section v-else-if="screen === 'workspace'" aria-labelledby="workspace-title">
          <Alert
            v-if="backend.error.value || arena.error.value || webBridge.error.value"
            variant="destructive"
            class="mb-5"
          >
            <Circle class="size-4" />
            <AlertDescription>
              {{ backend.error.value || arena.error.value || webBridge.error.value }}
            </AlertDescription>
          </Alert>

          <template v-if="activeProjection">
            <div class="mx-auto max-w-5xl space-y-5">
            <SettingsSection :title="t('题目', 'Challenge')">
              <div class="px-4 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{{ formatCategory(activeProjection.challenge.category) }}</Badge>
                  <Badge v-if="isArenaWorkspace" variant="secondary">Agent Arena</Badge>
                  <Badge v-if="isWebWorkspace" variant="secondary">Chrome Judge</Badge>
                </div>
                <h1 id="workspace-title" class="mt-3 text-3xl font-semibold tracking-[-0.04em]">
                  {{ activeProjection.challenge.title }}
                </h1>
                <p class="mt-2 text-body text-muted-foreground">
                  {{ t(`${activeProjection.challenge.trackName} · ${activeProjection.challenge.agentPolicy.label}模式`, `${activeProjection.challenge.trackName} · ${activeProjection.challenge.agentPolicy.label} mode`) }}
                </p>
                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
                  <span class="flex items-center gap-1.5">
                    <Target class="size-3.5" />
                    {{ t(`${remainingAgentTurns} 回合`, `${remainingAgentTurns} turns`) }}
                  </span>
                  <span class="flex items-center gap-1.5">
                    <Clock3 class="size-3.5" />
                    {{ t(`${remainingAgentMinutes} 分钟`, `${remainingAgentMinutes} min`) }}
                    {{ backend.agentBudget.value?.firstTurnStartedAt ? t('剩余', 'remaining') : t('（启动后计时）', '(starts with first turn)') }}
                  </span>
                  <span class="flex items-center gap-1.5">
                    <Flag class="size-3.5" />
                    {{ t(`${remainingWrongSubmissions} 次错误提交额度`, `${remainingWrongSubmissions} wrong-submission budget`) }}
                  </span>
                  <span v-if="activeProjection.challenge.materials.length" class="flex items-center gap-1.5">
                    <FileSearch class="size-3.5" />
                    {{ t(`${activeProjection.challenge.materials.length} 个附件`, `${activeProjection.challenge.materials.length} attachments`) }}
                  </span>
                </div>
                <MarkdownContent
                  v-if="activeProjection.challenge.statement"
                  class="mt-4 text-body leading-6"
                  :content="activeProjection.challenge.statement"
                />
              </div>
              <SettingsRow v-if="activeProjection.challenge.source.uri" :label="t('原文', 'Original')">
                <Button variant="link" size="text" @click="openActiveChallenge">
                  {{ t('打开原文', 'Open original') }}
                  <ExternalLink class="size-3" />
                </Button>
              </SettingsRow>
              <SettingsRow :label="t('状态', 'Status')" :divider="false">
                <NativeSelect
                  :model-value="manualStatusForJob(activeProjection.job)"
                  size="sm"
                  class="w-32"
                  :aria-label="t(`${activeProjection.challenge.title} 状态`, `${activeProjection.challenge.title} status`)"
                  @change="updateActiveJobManualStatus"
                >
                  <NativeSelectOption value="not_started">{{ t('未开始', 'Not started') }}</NativeSelectOption>
                  <NativeSelectOption value="in_progress">{{ t('进行中', 'In progress') }}</NativeSelectOption>
                  <NativeSelectOption value="paused">{{ t('稍后继续', 'Resume later') }}</NativeSelectOption>
                  <NativeSelectOption value="completed">{{ t('已完成', 'Completed') }}</NativeSelectOption>
                </NativeSelect>
              </SettingsRow>
              <template #footer>
                <Button :loading="working" :disabled="working" variant="brand" size="sm" @click="openCodingAgent">
                  {{ agentActionLabel }}
                </Button>
              </template>
            </SettingsSection>

            <Alert v-if="agentBudgetStopMessage" variant="destructive">
              <Circle class="size-4" />
              <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
                <span>{{ agentBudgetStopMessage }}</span>
                <Button variant="outline" size="sm" @click="showProblems">
                  {{ t('返回题库', 'Back to catalog') }}
                </Button>
              </AlertDescription>
            </Alert>

            <div
              class="grid gap-5"
              :class="workspacePresentation?.showActionRail
                ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]'
                : ''"
            >
              <div class="space-y-5">
                <CTFTrajectory
                  v-if="workspacePresentation?.showTrajectory"
                  :projection="activeProjection"
                />

                <CTFArtifacts
                  v-if="activeProjection.artifacts.length"
                  :projection="activeProjection"
                />

                <CTFDebrief
                  v-if="workspacePresentation?.showDebrief"
                  :debrief="activeProjection.debrief"
                  :human-outcome="activeProjection.humanOutcome"
                  :submitting="working"
                  @submit-independent-step="sendIndependentStep"
                  @submit-reflection="sendDebriefReflection"
                  @save-memory="saveTrainingMemory"
                />

                <CTFTrainingArchive
                  v-if="activeProjection.agentRuns.length || activeProjection.agentCandidates.length"
                  :job-id="activeProjection.job.id"
                  :replay-available="true"
                />
              </div>

              <div v-if="workspacePresentation?.showActionRail" class="space-y-5">
                <CTFEndpointAuthorization
                  v-if="workspacePresentation?.showEndpointAction"
                  :source-scope="activeProjection.challenge.source.scope"
                  :network-scopes="activeProjection.networkScopes"
                  :requests="activeProjection.endpointRequests"
                  :working="working"
                  :terminal="Boolean(activeProjection.outcome)"
                  pending-only
                  @request="requestEndpoint"
                  @approve="approveEndpoint"
                  @deny="denyEndpoint"
                />

                <CTFSubmissionGate
                  v-if="workspacePresentation?.showSubmissionAction"
                  v-model="flagCandidate"
                  :projection="activeProjection"
                  :working="working"
                  :can-continue="canContinue"
                  :active-start-cost="activeStartCost"
                  :active-browser-can-submit="activeBrowserCanSubmit"
                  :ctfshow-bridge-ready="ctfshowBridgeReady"
                  :platform-review="platformReview"
                  :external-judge-label="externalJudgeLabel"
                  @submit="submitCandidate"
                  @record-platform-result="recordPlatformResult"
                />
              </div>
            </div>

            <CTFMemoryRecall
              v-if="memoryLoading || recalledMemories.length"
              :memories="recalledMemories"
              :loading="memoryLoading"
              @archive="archiveTrainingMemory"
              @inspect-evidence="inspectTrainingMemoryEvidence"
            />

            <Alert v-if="outcomeNotice">
              <Check class="size-4" />
              <AlertDescription>{{ outcomeNotice }}</AlertDescription>
            </Alert>
            </div>
            <ConversationDock
              ref="conversationDock"
              :conversation="conversation ?? null"
              :conversations="dossierConversations"
              :running="running"
              :aborting="aborting"
              :settings="settings"
              :workspace-path="workspacePath"
              :message-queue="messageQueue"
              :session-ready="sessionReady"
              :resumed="resumed"
              :compacting="compacting"
              :compacted-at="compactedAt"
              :compaction-error="compactionError"
              :turn-status="turnStatus"
              :ctf-session="ctfSession"
              :vulnerability-session="vulnerabilitySession"
              :ctf-mode="ctfMode"
              :ctf-role="ctfRole"
              :model-mode="modelMode"
              :model-provider="modelProvider"
              :model-id="modelId"
              :model-source-preference="modelSourcePreference"
              :execution-mode="executionMode"
              :approval-policy="approvalPolicy"
              :mcp-servers="mcpServers"
              :mcp-config-digest="mcpConfigDigest"
              :ensure-conversation="ensureConversation"
              :pending-composer-draft="pendingComposerDraft"
              @send="(...args) => $emit('send', ...args)"
              @abort="$emit('abort')"
              @select="$emit('selectConversation', $event)"
              @create="$emit('createConversation')"
              @expand="$emit('expand')"
              @consume-pending-draft="$emit('consumePendingDraft')"
              @ctf-action="$emit('ctfAction', $event)"
              @compact-context="$emit('compactContext')"
              @control-goal="$emit('controlGoal', $event)"
              @respond-approval="(requestId, approved, scope) => $emit('respondApproval', requestId, approved, scope)"
              @change-model="(mode, provider, model) => $emit('changeModel', mode, provider, model)"
              @change-model-source="$emit('changeModelSource', $event)"
              @change-coding-policy="(mode, policy) => $emit('changeCodingPolicy', mode, policy)"
              @change-mcp-servers="(servers, digest) => $emit('changeMcpServers', servers, digest)"
              @choose-workspace="$emit('chooseWorkspace')"
              @choose-workspace-for-new-task="$emit('chooseWorkspaceForNewTask')"
              @select-workspace="$emit('selectWorkspace', $event)"
              @forget-workspace="$emit('forgetWorkspace', $event)"
              @clear-workspace="$emit('clearWorkspace')"
              @cancel-queued-guidance="$emit('cancelQueuedGuidance', $event)"
              @edit-queued-guidance="$emit('editQueuedGuidance', $event)"
              @open-settings="$emit('openSettings')"
            />
          </template>

          <SettingsSection v-else :title="t('工作区', 'Workspace')">
            <SettingsRow stack="always" :divider="false">
              <LoaderCircle v-if="backend.loading.value" class="size-5 animate-spin text-muted-foreground" />
              <Button v-else @click="showProblems">{{ t('选择一道题', 'Choose a challenge') }}</Button>
            </SettingsRow>
          </SettingsSection>
        </section>
      </div>
    </div>
    <CTFManualIntake
      ref="manualIntake"
      :loading="manualCreating"
      :error="backend.error.value ?? ''"
      @submit="startManualChallenge"
    />
  </main>
</template>
