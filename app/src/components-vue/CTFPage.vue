<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  SegmentedControl,
  Textarea,
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
  BrainCircuit,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Clock3,
  ExternalLink,
  FilePlus2,
  FileSearch,
  Flag,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Library,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-vue-next'
import CTFArtifacts from '@/components-vue/CTFArtifacts.vue'
import CTFChallengeDesk from '@/components-vue/CTFChallengeDesk.vue'
import CTFDebrief from '@/components-vue/CTFDebrief.vue'
import CTFManualIntake from '@/components-vue/CTFManualIntake.vue'
import CTFTrainingArchive from '@/components-vue/CTFTrainingArchive.vue'
import CTFTrajectory from '@/components-vue/CTFTrajectory.vue'
import ManagedLabCatalog from '@/components-vue/ManagedLabCatalog.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { useCTFTrainingPlatforms } from '@/composables/useCTFTrainingPlatforms'
import { useCTFWorkspace } from '@/composables/useCTFWorkspace'
import { useManagedLabs } from '@/composables/useManagedLabs'
import { useCTFShowCatalog } from '@/composables/useCTFShow'
import { useNSSCTFArena, useNSSCTFChallenges, useNSSCTFWebBridge } from '@/composables/useNSSCTF'
import { useNSSCTFCatalog, useNSSCTFTraining } from '@/composables/useNSSCTFTraining'
import { invokeCommand } from '@/desktop'
import { shouldBootstrapNSSCTFCatalog } from '@/lib/ctfCatalogBootstrap'
import type {
  CTFAgentWorkspaceHandoff,
  CTFChallengeRequest,
  CTFCollaborationMode,
  CTFMaterialRequest,
  CTFSummary,
  CTFTrainingMemory,
} from '@/ctfTypes'
import type { CTFTrainingPlatform } from '@/ctfPlatformTypes'
import type { ManagedLabAccess } from '@/ctfLabTypes'
import type { CTFWorkspaceSection } from '@/lib/workspaceNavigation'
import type { NSSCTFChallenge } from '@/nssctfTypes'
import type { NSSCTFRecommendation, NSSCTFTrainingSeries } from '@/nssctfTrainingTypes'

type Screen = 'source' | 'challenge' | 'workspace'
type QuestionBank = Extract<CTFTrainingPlatform['id'], 'nssctf' | 'ctfshow'>
type TrainingSource = CTFTrainingPlatform['id'] | 'custom'

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

function memoryVerificationLabel(memory: CTFTrainingMemory) {
  if (memory.verification === 'judge-verified') return 'Judge 验证'
  if (memory.verification === 'user-confirmed') return '用户确认'
  if (memory.verification === 'failure-observed') return '失败观察'
  return '旧记录 · 未分级'
}

const props = defineProps<{
  modelReady: boolean
  modelVerified: boolean
  arenaReady: boolean
  initialJobId?: string | null
  ctfSection: CTFWorkspaceSection
}>()

const emit = defineEmits<{
  openSettings: []
  startCodingAgent: [handoff: CTFAgentWorkspaceHandoff]
}>()

const backend = useCTFWorkspace()
const platformRegistry = useCTFTrainingPlatforms()
const publicProblems = useNSSCTFChallenges()
const arena = useNSSCTFArena()
const webBridge = useNSSCTFWebBridge()
const training = useNSSCTFTraining()
const publicCatalog = useNSSCTFCatalog()
const ctfshow = useCTFShowCatalog()
const managedLabs = useManagedLabs()
const screen = ref<Screen>('challenge')
const ctfSection = computed(() => props.ctfSection)
const selectedLabId = ref('')
const labNotice = ref('')
const managedLabAccess = ref<ManagedLabAccess | null>(null)
const labTrainingJobIds = ref<Record<string, string>>({})
const storedTrainingSource = window.localStorage.getItem('milksu.ctf.question-bank')
const activeBank = ref<TrainingSource>(
  storedTrainingSource === 'ctfshow'
  || storedTrainingSource === 'hackthebox'
  || storedTrainingSource === 'tryhackme'
  || storedTrainingSource === 'custom'
    ? storedTrainingSource
    : 'nssctf',
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
const observation = ref('')
const flagCandidate = ref('')
const platformReview = ref(false)
const outcomeNotice = ref('')
const catalogNotice = ref('')
const catalogBootstrapAttempted = ref(false)
const attachmentError = ref('')
const localMaterials = ref<CTFMaterialRequest[]>([])
const working = ref(false)
const browserSetupBusy = ref(false)
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
const bridgeMenu = ref<HTMLDetailsElement | null>(null)
const manualIntake = ref<InstanceType<typeof CTFManualIntake> | null>(null)
let catalogSearchTimer: ReturnType<typeof setTimeout> | undefined

const step = computed(() => screen.value === 'source' ? 1 : screen.value === 'challenge' ? 2 : 3)
const activeProjection = computed(() => backend.projection.value)
const activeAgentCandidate = computed(() => {
  const candidate = activeProjection.value?.agentCandidates.at(-1)
  if (!candidate || candidate.candidate !== flagCandidate.value.trim()) return null
  return candidate
})
const matchingSubmission = computed(() => {
  const candidate = flagCandidate.value.trim()
  if (!candidate) return null
  return activeProjection.value?.submissions.find(submission => submission.candidate === candidate) ?? null
})
const matchingSubmissionMessage = computed(() => {
  switch (matchingSubmission.value?.verdict) {
    case 'pass':
      return '这个候选已经被平台确认 Accepted，无需再次提交。'
    case 'fail':
      return '这个候选已经被平台拒绝。请先根据证据修改候选，MilkSU 不会重复盲试。'
    case 'needs_review':
      return '这个候选正在等待平台判题，不能并发重复提交。'
    case 'inconclusive':
      return '上次没有得到明确回执。你可以安全重试同一候选，或在平台页面核对后手动记录结果。'
    default:
      return ''
  }
})
const matchingSubmissionBlocks = computed(() => (
  matchingSubmission.value?.verdict === 'pass'
  || matchingSubmission.value?.verdict === 'fail'
  || matchingSubmission.value?.verdict === 'needs_review'
))
const authorizedTargets = computed(() => (
  activeProjection.value?.challenge.source.scope.targets ?? []
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
      return '外部平台'
    case 'socket':
      return 'TCP 题目'
    case 'ssh':
      return 'SSH 题目'
    default:
      return '外部 Judge'
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
const browserPairingCode = computed(() => browserBridge.value?.pairingCode ?? '')
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
const readinessCount = computed(() => (
  Number(props.modelVerified)
  + Number(selectedCatalogReady.value)
  + Number(selectedJudgeReady.value)
))
const canStartSelectedChallenge = computed(() => {
  if (selectedActiveJob.value) return true
  if (activeBank.value === 'nssctf') {
    if (!selectedProblem.value) return false
    return !selectedProblem.value.hasAttachment
      || selectedBrowserReady.value
      || localMaterials.value.length > 0
  }
  return activeBank.value === 'ctfshow'
    && Boolean(selectedCTFShowProblemID.value)
    && ctfshowBridgeReady.value
})
const readinessAction = computed(() => {
  if (!props.modelVerified) {
    return { label: props.modelReady ? '验证模型' : '配置模型', action: 'model' as const }
  }
  if (!selectedCatalogReady.value) {
    return { label: '同步题库', action: 'catalog' as const }
  }
  if (canStartSelectedChallenge.value) {
    return {
      label: selectedActiveJob.value ? '继续训练' : '用 Agent 开始',
      action: 'start' as const,
    }
  }
  if (!selectedJudgeReady.value) {
    return { label: '连接 Judge', action: 'judge' as const }
  }
  return null
})
const activeStartCost = computed(() => (
  activeBrowserPage.value?.nssctf.needsStart
    ? activeBrowserPage.value.nssctf.startCost ?? 0
    : 0
))
const canContinue = computed(() => {
  const status = activeProjection.value?.job.status
  return Boolean(activeProjection.value && !['succeeded', 'failed', 'cancelled'].includes(status ?? ''))
})
const canStartAgentTurn = computed(() => (
  canContinue.value && !backend.agentBudget.value?.exhausted
))
const agentCheckpoint = computed(() => backend.agentRun.value)
const agentProgress = computed(() => agentCheckpoint.value?.progress)
const hasAgentRoute = computed(() => {
  const progress = agentProgress.value
  return Boolean(progress && (
    progress.lastVerifiedFact
    || progress.currentHypothesis
    || progress.nextAction
    || progress.needsReplan
  ))
})
const hasAgentRecoveryPoint = computed(() => {
  const run = agentCheckpoint.value
  return Boolean(run && (
    run.status !== 'ready'
    || run.metrics.eventCount > 0
    || run.candidateCount > 0
    || run.lastAssistantSummary
  ))
})
const agentCheckpointStatus = computed(() => {
  switch (agentCheckpoint.value?.status) {
    case 'running': return '上次运行未正常结束'
    case 'awaiting-user': return '等待你继续'
    case 'paused': return '已保存并暂停'
    case 'failed': return '失败后已保存'
    default: return '可以开始'
  }
})
const agentCheckpointSummary = computed(() => {
  const run = agentCheckpoint.value
  if (!run) return ''
  if (run.lastAssistantSummary?.trim()) return run.lastAssistantSummary.trim()
  if (run.notesExcerpt?.trim()) return run.notesExcerpt.trim()
  switch (run.exitReason) {
    case 'same-tool-call-repeated':
      return '检测到连续重复的工具调用；恢复后应先更换假设或实验方法。'
    case 'same-tool-failure-repeated':
      return '同一工具连续失败，MilkSU 已停止无效重试；恢复后先检查失败原因。'
    case 'engine-error':
      return '模型运行发生错误；已有笔记和工作文件仍保留在固定工作区。'
    case 'session-destroyed':
      return '上次会话中断；已有轨迹、笔记和工作文件可以继续使用。'
    default:
      return '已有固定工作区与运行检查点，可以从上次进度继续。'
  }
})
const agentActionLabel = computed(() => {
  if (!props.modelReady) return '配置模型后启动 Agent'
  return hasAgentRecoveryPoint.value ? '恢复 CTF Agent' : '启动 CTF Agent'
})
const agentCapabilityLabels = computed(() => {
  const tools = new Set(activeProjection.value?.challenge.agentPolicy.allowedTools ?? [])
  return [
    tools.has('ctf_triage') || tools.has('ctf_decode') ? '材料与解码' : '',
    tools.has('ctf_http') ? 'HTTP 基线' : '',
    tools.has('ctf_socket') ? 'TCP 交互' : '',
    tools.has('bash') ? '沙箱 Shell' : '',
  ].filter(Boolean)
})
const agentBudgetStopMessage = computed(() => {
  const status = backend.agentBudget.value
  if (!status?.exhausted) return ''
  switch (status.reason) {
    case 'turn-budget-exhausted':
      return `已用完 ${status.budget.maxTurns} 个 PI 回合。先复盘当前轨迹，再从题库建立一次新的受控训练。`
    case 'time-budget-exhausted':
      return `本次训练已达到 ${status.budget.maxWallMinutes} 分钟。先记录关键转折，再决定是否重新开始。`
    case 'wrong-submission-budget-exhausted':
      return `已经出现 ${status.budget.maxWrongSubmissions} 次平台 Rejected。MilkSU 已停止继续盲试。`
    default:
      return '本次 PI 训练预算已停止；请先复盘，再由你决定下一次尝试。'
  }
})
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
    ? '自定义题目'
    : activeExternalPlatform.value?.name ?? '选择训练平台'
))
const externalPlatformStatusLabel = computed(() => {
  switch (activeExternalPlatform.value?.status) {
    case 'planned': return '接入中'
    case 'restricted': return '受官方接口限制'
    default: return '可用'
  }
})
const externalPlatformSummary = computed(() => {
  switch (activeExternalPlatform.value?.id) {
    case 'hackthebox':
      return 'HTB Labs 当前只提供人工训练入口。HTB 规则禁止把 Labs 内容或目标用于 AI 训练、评测、测试或开发；获得 HTB 书面许可或 AI Range 授权前，MilkSU 不会把题面、附件或靶机交给 Agent。'
    case 'tryhackme':
      return 'TryHackMe 目前只向 Business / Classroom 提供官方 API；个人版没有可依赖的完整题库与靶机接口。'
    default:
      return '该平台正在接入 MilkSU 的统一题库、工作区与 Judge 流程。'
  }
})
const externalPlatformCapabilities = computed(() => {
  const labels: Record<string, string> = {
    machines: 'Machines',
    'starting-point': 'Starting Point',
    challenges: 'Challenges',
    vpn: 'VPN',
    'instance-lifecycle': '靶机生命周期',
    progress: '训练进度',
    'human-only': '仅人工训练',
    'written-permission': '需书面许可',
    'room-catalog': '房间目录',
    'room-questions': '房间题目',
    scoreboard: '积分榜',
    'time-report': '训练时长',
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
  return ctfshowProblems.value.filter(problem => {
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

const modeItems = [
  { value: 'coach' as const, label: '教练' },
  { value: 'copilot' as const, label: '搭档' },
  { value: 'delegate' as const, label: '代理' },
]
const dailyMission = computed(() => {
  if (resumableJob.value) {
    return {
      kind: 'resume' as const,
      eyebrow: '继续上次训练',
      title: resumableJob.value.title,
      meta: `${resumableJob.value.category} · ${jobSummaryLabel(resumableJob.value)}`,
      action: '继续解题',
    }
  }
  const recommendation = training.dashboard.value?.recommendations[0]
  if (recommendation) {
    return {
      kind: 'recommendation' as const,
      eyebrow: '推荐训练',
      title: recommendation.problem.title,
      meta: `${recommendation.problem.category} · 难度 ${recommendation.problem.difficulty.toFixed(1)} · ${recommendation.kind}`,
      action: '开始训练',
    }
  }
  return {
    kind: 'sync' as const,
    eyebrow: '本地题库',
    title: '同步 NSSCTF 公开题库',
    meta: '0 题',
    action: '同步题库',
  }
})

function jobStatusLabel(status: string) {
  switch (status) {
    case 'queued': return '待开始'
    case 'running': return '进行中'
    case 'cancelling': return '正在停止'
    case 'recovering': return '正在恢复'
    case 'succeeded': return '已完成'
    case 'failed': return '未完成'
    case 'cancelled': return '已中断'
    default: return status
  }
}

function jobSummaryLabel(job: CTFSummary) {
  if (job.pendingJudge) return '判题中'
  if (job.pendingSubmission) return '待提交'
  return jobStatusLabel(job.status)
}

function verdictLabel(verdict?: string) {
  switch (verdict) {
    case 'pass': return 'Accepted'
    case 'fail': return 'Rejected'
    case 'needs_review': return '等待平台判题'
    case 'inconclusive': return '证据不足'
    default: return '等待提交'
  }
}

function targetKindLabel(kind: string) {
  return ({
    origin: 'Web',
    socket: 'Socket',
    directory: '目录',
    lab: 'Lab',
    browser_tab: '浏览器',
  } as Record<string, string>)[kind] ?? kind
}

async function runReadinessAction() {
  const action = readinessAction.value?.action
  if (action === 'model') {
    emit('openSettings')
    return
  }
  if (action === 'catalog') {
    if (activeBank.value === 'nssctf') await syncCatalog()
    else await refreshCTFShow()
    return
  }
  if (action === 'judge') {
    if (activeBank.value === 'ctfshow') await ctfshow.open()
    else showProblems()
    return
  }
  if (action === 'start') {
    if (activeBank.value === 'ctfshow' && selectedCTFShowProblemID.value) {
      await chooseCTFShowProblem(selectedCTFShowProblemID.value)
    } else if (activeBank.value === 'nssctf') {
      await startPublicWorkspace()
    }
  }
}

function seriesProgress(series: NSSCTFTrainingSeries) {
  if (!series.problemCount) return 0
  return Math.round(series.completedCount / series.problemCount * 100)
}

function difficultyLabel(difficulty: number) {
  return difficulty > 0 ? difficulty.toFixed(1) : '待定'
}

function ctfshowProblemStatus(problemId: number) {
  if (ctfshow.status.value?.completedProblemIds.includes(problemId)) return 'completed'
  if (ctfshow.status.value?.attemptedProblemIds.includes(problemId)) return 'attempted'
  return 'new'
}

function ctfshowProblemStatusLabel(problemId: number) {
  switch (ctfshowProblemStatus(problemId)) {
    case 'completed': return '已完成'
    case 'attempted': return '再挑战'
    default: return '未开始'
  }
}

watch(activeBank, bank => {
  window.localStorage.setItem('milksu.ctf.question-bank', bank)
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
  labNotice.value = ''
  managedLabAccess.value = null
  if (section === 'labs') {
    screen.value = 'challenge'
    closeHistoryMenu()
    closeBridgeMenu()
    void managedLabs.refresh()
    return
  }
  void selectDefaultDeskProblem()
})

watch(managedLabs.labs, labs => {
  if (!labs.length) {
    selectedLabId.value = ''
    return
  }
  if (!labs.some(lab => lab.id === selectedLabId.value)) {
    selectedLabId.value = labs[0].id
  }
})

watch(collaborationMode, mode => {
  window.localStorage.setItem('milksu.ctf.collaboration-mode', mode)
})

watch([ctfshowQuery, ctfshowCategory], () => {
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
    if (jobId) await loadMemoryContext(jobId)
    else recalledMemories.value = []
  },
  { immediate: true },
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

function showSource() {
  screen.value = 'challenge'
  selectedSeries.value = null
  outcomeNotice.value = ''
  if (activeBank.value === 'ctfshow') void ctfshow.refresh()
  else void loadPublicCatalog(catalogPage.value)
}

function showProblems() {
  source.value = 'public'
  selectedSeries.value = null
  selectedProblem.value = null
  localMaterials.value = []
  attachmentError.value = ''
  screen.value = 'challenge'
  outcomeNotice.value = ''
  void loadPublicCatalog(1)
}

async function syncCatalog() {
  catalogNotice.value = ''
  const result = await training.sync()
  if (result) {
    catalogNotice.value = `已把 ${result.total} 道公开题目更新到本地题库。`
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
  const result = await publicCatalog.search({
    query: catalogQuery.value,
    category: catalogCategory.value,
    page,
    pageSize: catalogPageSize,
  })
  if (result) catalogPage.value = result.page
}

async function selectDefaultDeskProblem() {
  if (screen.value !== 'challenge') return
  if (activeBank.value === 'ctfshow') {
    if (selectedCTFShowProblemID.value !== null) return
    const problem = visibleCTFShowProblems.value[0]
    if (problem) previewCTFShowProblem(problem.platformId)
    return
  }
  if (selectedProblem.value) return
  const recommendation = catalogQuery.value.trim() === '' && catalogCategory.value === 'all'
    ? training.dashboard.value?.recommendations[0]
    : null
  const platformId = recommendation?.problem.platformId
    ?? publicCatalog.result.value?.problems[0]?.platformId
  if (platformId) await chooseCatalogProblem(platformId)
}

async function runDailyMission() {
  if (dailyMission.value.kind === 'resume' && resumableJob.value) {
    await resumeJob(resumableJob.value.id)
    if (props.modelReady) await openCodingAgent()
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
  working.value = true
  outcomeNotice.value = ''
  try {
    const started = await backend.startChallenge(request)
    if (!started) return
    manualIntake.value?.resetAndClose()
    screen.value = 'workspace'
  } finally {
    working.value = false
  }
}

function closeHistoryMenuOnOutsidePointer(event: PointerEvent) {
  if (!(event.target instanceof Node)) return
  for (const menu of [historyMenu.value, bridgeMenu.value]) {
    if (menu?.open && !menu.contains(event.target)) menu.open = false
  }
}

function closeHistoryMenu() {
  if (historyMenu.value) historyMenu.value.open = false
}

function closeBridgeMenu() {
  if (bridgeMenu.value) bridgeMenu.value.open = false
}

async function copyBrowserPairingCode() {
  await copyBridgeValue(browserPairingCode.value, '配对码')
  closeBridgeMenu()
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
}

async function openProblem() {
  if (!selectedProblem.value) return
  await invokeCommand('open_nssctf_challenge', { url: selectedProblem.value.sourceUrl })
}

async function refreshCTFShow() {
  catalogNotice.value = ''
  const result = await ctfshow.refresh()
  if (result?.catalog.total) {
    catalogNotice.value = `CTFshow 本地题库：${result.catalog.total} 题`
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
      outcomeNotice.value = `题目已建立工作区；导入提示：${workspace.challenge.warnings.join('；')}`
    }
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

async function copyBridgeValue(value: string, label: string) {
  if (!value) return
  attachmentError.value = ''
  try {
    await navigator.clipboard.writeText(value)
    outcomeNotice.value = `${label}已复制。`
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function prepareBrowserExtension() {
  browserSetupBusy.value = true
  attachmentError.value = ''
  try {
    let pairingCodeCopied = false
    if (browserPairingCode.value) {
      try {
        await navigator.clipboard.writeText(browserPairingCode.value)
        pairingCodeCopied = true
      } catch {
        // Installation remains usable; the adjacent copy action is the fallback.
      }
    }
    await invokeCommand('open_chrome_extension_manager')
    await invokeCommand('reveal_browser_extension')
    outcomeNotice.value = pairingCodeCopied
      ? 'Chrome 扩展页和安装目录已打开，配对码也已复制。加载扩展后，在题目页点击 MilkSU 并粘贴。'
      : 'Chrome 扩展页和安装目录已打开。加载扩展后，回到这里复制配对码。'
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    browserSetupBusy.value = false
  }
}

async function chooseLocalMaterials() {
  attachmentError.value = ''
  try {
    const selected = await invokeCommand<CTFMaterialRequest[]>('choose_ctf_materials')
    if (!selected.length) return
    localMaterials.value = selected
    outcomeNotice.value = `已补充 ${selected.length} 项本地材料。`
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function startPublicWorkspace() {
  if (!selectedProblem.value) return
  if (selectedActiveJob.value) {
    await resumeJob(selectedActiveJob.value.id)
    if (props.modelReady) await openCodingAgent()
    return
  }
  working.value = true
  attachmentError.value = ''
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
      attachmentError.value = `P${challenge.platformId} 有附件；请先连接已登录的 Chrome 题目页。`
      working.value = false
      return
    }
    if (selectedBrowserReady.value) {
      try {
        materials.push(await invokeCommand<CTFMaterialRequest>('import_nssctf_web_attachment', {
          problemId: challenge.platformId,
        }))
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason)
        if (localMaterials.value.length === 0) {
          attachmentError.value = message
          working.value = false
          return
        }
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
    trackName: 'NSSCTF 真实题库训练',
    humanGoal: '完成一道真实 NSSCTF 题目，并能复述假设、关键观察与最终证据。',
    sourceKind: 'url',
    sourceUri: challenge.sourceUrl,
    externalPlatform: 'nssctf-web',
    externalAttemptId: challenge.platformId,
    expectedFlag: '',
    knowledgePoints: challenge.tags,
    materials,
  })
  working.value = false
  if (started) {
    if (materialWarning) {
      outcomeNotice.value = `${materialWarning}。工作台已使用公开题面和现有材料继续建立。`
    }
    screen.value = 'workspace'
    if (props.modelReady) await openCodingAgent()
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

async function openCodingAgent() {
  if (!activeProjection.value) return
  await backend.loadAgentState(activeProjection.value.job.id)
  if (backend.agentBudget.value?.exhausted) {
    outcomeNotice.value = agentBudgetStopMessage.value
    return
  }
  if (!props.modelReady) {
    emit('openSettings')
    return
  }
  working.value = true
  outcomeNotice.value = ''
  try {
    const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>('prepare_ctf_agent_workspace', {
      id: activeProjection.value.job.id,
    })
    backend.agentRun.value = handoff.run
    emit('startCodingAgent', handoff)
  } catch (reason) {
    outcomeNotice.value = `无法建立 Agent 工作区：${String(reason)}`
  } finally {
    working.value = false
  }
}

async function openStrategistAgent() {
  if (!activeProjection.value) return
  if (!props.modelReady) {
    emit('openSettings')
    return
  }
  working.value = true
  outcomeNotice.value = ''
  try {
    const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>(
      'prepare_ctf_strategist_workspace',
      { id: activeProjection.value.job.id },
    )
    emit('startCodingAgent', handoff)
  } catch (reason) {
    outcomeNotice.value = `无法建立策略复盘：${String(reason)}`
  } finally {
    working.value = false
  }
}

async function sendObservation() {
  if (!activeProjection.value || !observation.value.trim()) return
  working.value = true
  const recorded = await backend.recordLearning(activeProjection.value.job.id, {
    kind: 'reflection',
    content: observation.value.trim(),
    concept: 'NSSCTF 平台观察',
  })
  if (recorded) {
    observation.value = ''
    outcomeNotice.value = '观察已写入训练记录；打开 PI Agent 后可把它作为下一步线索。'
  }
  working.value = false
}

async function sendDebriefReflection(content: string) {
  if (!activeProjection.value || !content.trim()) return
  working.value = true
  const recorded = await backend.recordLearning(activeProjection.value.job.id, {
    kind: 'reflection',
    content: content.trim(),
    concept: 'CTF 解题复盘',
  })
  if (recorded) outcomeNotice.value = '复盘已保存；现在可以沉淀为可复用技法。'
  working.value = false
}

async function refreshTrainingProgress() {
  await training.load()
  if (activeBank.value === 'nssctf') {
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
    outcomeNotice.value = '已保存为本机可复用技法；以后同分类题会把它作为待验证先验交给 Agent。'
  } catch (reason) {
    outcomeNotice.value = `无法保存训练记忆：${String(reason)}`
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
      reason: `用户在 ${activeProjection.value.challenge.title} 的记忆上下文中停用`,
    })
    await loadMemoryContext(activeProjection.value.job.id)
    outcomeNotice.value = '这条综合记忆已停用；原始训练轨迹和证据仍保留。'
  } catch (reason) {
    outcomeNotice.value = `无法停用训练记忆：${String(reason)}`
  } finally {
    working.value = false
  }
}

async function submitCandidate() {
  if (!activeProjection.value || !flagCandidate.value.trim()) return
  outcomeNotice.value = ''
  if (matchingSubmissionBlocks.value) {
    outcomeNotice.value = matchingSubmissionMessage.value
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
        ? 'NSSCTF Agent Arena 已确认 Accepted，平台回执已经写入证据链。'
        : `NSSCTF Agent Arena 返回 Rejected，剩余错误次数 ${result.arena.remaining_wrong_attempts ?? '以平台为准'}。`
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
        ? `CTFshow #${result.receipt.problemId} 已确认 Accepted，Judge 回执已进入证据链。`
        : `CTFshow #${result.receipt.problemId} 返回 Rejected；该候选不会被记为完成。`
    } else {
      outcomeNotice.value = ctfshow.error.value ?? 'CTFshow Judge 没有返回可确认结果。'
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
        ? `NSSCTF P${result.receipt.problemId} 已确认 Accepted，Judge 回执已进入证据链。`
        : `NSSCTF P${result.receipt.problemId} 返回 Rejected；该候选不会被记为完成。`
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
    '用户确认该候选已有可复核依据，并准备交给已授权的外部 Judge。',
  )
  if (prepared) {
    await navigator.clipboard.writeText(flagCandidate.value.trim())
    const sourceURI = activeProjection.value?.challenge.source.uri
    if (activeProjection.value?.challenge.source.kind === 'url' && sourceURI) {
      try {
        await invokeCommand('open_ctf_source_url', { url: sourceURI })
      } catch (reason) {
        outcomeNotice.value = `候选已复制并进入 Judge 闸门，但无法打开题目 URL：${String(reason)}`
      }
    }
    platformReview.value = true
    if (!outcomeNotice.value) {
      outcomeNotice.value = sourceURI
        ? `候选已复制并打开${externalJudgeLabel.value}；提交后回来记录结果。`
        : `候选已复制；在${externalJudgeLabel.value}提交后回来记录结果。`
    }
  } else {
    outcomeNotice.value = backend.error.value ?? '候选没有进入外部 Judge 闸门。'
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
          ? `用户根据${externalJudgeLabel.value}确认 Accepted。`
          : `用户根据${externalJudgeLabel.value}确认 Rejected。`,
      )
    : await backend.recordLearning(activeProjection.value.job.id, {
        kind: 'independent_step',
        content: accepted
          ? `${externalJudgeLabel.value}显示 Accepted。`
          : `${externalJudgeLabel.value}显示 Rejected。`,
        concept: '外部平台 Judge',
      })
  if (recorded) {
    await refreshTrainingProgress()
    platformReview.value = false
    outcomeNotice.value = accepted
      ? `已记录${externalJudgeLabel.value} Accepted；成功来自真实判题，不是 Agent 自报。`
      : `已记录${externalJudgeLabel.value} Rejected；不会伪造成解题成功。`
  }
}

async function resumeJob(id: string) {
  await backend.selectJob(id)
  screen.value = 'workspace'
}

let bridgeStatusTimer: number | undefined

function refreshBridgePresence() {
  if (document.visibilityState !== 'visible') return
  if (activeBank.value === 'ctfshow') void ctfshow.refresh()
  else if (activeBank.value === 'nssctf') void webBridge.refresh()
}

function selectManagedLab(labId: string) {
  selectedLabId.value = labId
  labNotice.value = ''
  managedLabAccess.value = null
}

function selectedManagedLab(labId: string) {
  return managedLabs.labs.value.find(lab => lab.id === labId)
}

async function startManagedLab(labId: string) {
  selectedLabId.value = labId
  labNotice.value = ''
  managedLabAccess.value = null
  await managedLabs.start(labId).catch(() => undefined)
}

async function openManagedLab(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return
  await managedLabs.open(instanceId).catch(cause => {
    labNotice.value = cause instanceof Error ? cause.message : String(cause)
  })
}

async function resetManagedLab(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return
  labNotice.value = ''
  managedLabAccess.value = null
  await managedLabs.reset(instanceId).catch(() => undefined)
}

async function stopManagedLab(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return
  labNotice.value = ''
  await managedLabs.stop(instanceId).catch(() => undefined)
}

async function destroyManagedLab(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return
  labNotice.value = ''
  managedLabAccess.value = null
  await managedLabs.destroy(instanceId).catch(() => undefined)
}

async function revealManagedLabAccess(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return
  labNotice.value = ''
  managedLabAccess.value = await managedLabs.access(instanceId).catch(cause => {
    labNotice.value = cause instanceof Error ? cause.message : String(cause)
    return null
  })
}

async function ensureManagedLabTraining(labId: string) {
  const instanceId = selectedManagedLab(labId)?.instanceId
  if (!instanceId) return null
  const workspace = await managedLabs.startTraining(
    instanceId,
    collaborationMode.value,
  ).catch(() => null)
  if (!workspace) return null
  labTrainingJobIds.value[instanceId] = workspace.ctf.job.id
  await backend.adoptProjection(workspace.ctf)
  return workspace
}

async function startManagedLabAgent(labId: string) {
  labNotice.value = ''
  const workspace = await ensureManagedLabTraining(labId)
  if (!workspace) return
  emit('startCodingAgent', workspace.handoff)
}

async function checkManagedLabTraining(labId: string) {
  labNotice.value = ''
  const lab = selectedManagedLab(labId)
  const instanceId = lab?.instanceId
  if (!instanceId) return
  let jobId = labTrainingJobIds.value[instanceId]
  if (!jobId) {
    const workspace = await ensureManagedLabTraining(labId)
    jobId = workspace?.ctf.job.id ?? ''
  }
  if (!jobId) return
  const response = await managedLabs.checkTraining(instanceId, jobId).catch(() => null)
  if (!response) return
  await backend.adoptProjection(response.ctf)
  labNotice.value = response.result.solved
    ? `${response.result.challenge} 已由应用内 Judge 确认完成。`
    : `${response.result.challenge} 尚未完成；保留本次检查证据，可以继续练习。`
}

onMounted(async () => {
  document.addEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
  await Promise.all([
    webBridge.refresh(),
    training.load(),
    platformRegistry.load(),
    activeBank.value === 'ctfshow' ? ctfshow.refresh() : Promise.resolve(null),
    activeBank.value === 'nssctf' ? loadPublicCatalog(1) : Promise.resolve(null),
  ])
  if (ctfSection.value === 'labs') {
    await managedLabs.refresh()
  }
  await bootstrapNSSCTFCatalog()
  if (props.initialJobId) await resumeJob(props.initialJobId)
  await selectDefaultDeskProblem()
  if (props.arenaReady) await arena.refresh()
  bridgeStatusTimer = window.setInterval(refreshBridgePresence, 2500)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeHistoryMenuOnOutsidePointer)
  if (bridgeStatusTimer !== undefined) window.clearInterval(bridgeStatusTimer)
})
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-background">
    <header
      v-if="screen === 'workspace'"
      class="app-drag flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6"
    >
      <p class="text-control font-medium">CTF</p>
      <Button variant="ghost" size="sm" class="app-no-drag" @click="$emit('openSettings')">
        <ShieldCheck class="size-4" />
        授权与模型
      </Button>
    </header>

    <header
      v-else
      class="app-drag flex shrink-0 flex-col gap-3 border-b border-border bg-background px-6 py-4"
    >
      <div class="flex w-full items-center gap-3">
        <h1 class="mr-2 shrink-0 text-xl font-semibold tracking-[-0.03em]">CTF</h1>
        <Select v-if="ctfSection === 'catalog'" v-model="activeBank">
        <SelectTrigger
          class="app-no-drag min-w-48 shrink-0"
          aria-label="选择训练平台"
        >
          <Library class="size-4 text-muted-foreground" />
          <SelectValue placeholder="选择训练平台">{{ activeSourceName }}</SelectValue>
        </SelectTrigger>
        <SelectContent class="min-w-64">
          <SelectGroup>
            <SelectLabel>训练平台</SelectLabel>
            <SelectItem
              v-for="platform in visibleTrainingPlatforms"
              :key="platform.id"
              :value="platform.id"
            >
              <span class="flex min-w-44 items-center justify-between gap-4">
                <span>{{ platform.name }}</span>
                <span class="text-caption text-muted-foreground">
                  {{ platform.status === 'ready'
                    ? '可用'
                    : platform.status === 'planned'
                      ? '接入中'
                      : '受限' }}
                </span>
              </span>
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>本地</SelectLabel>
            <SelectItem value="custom">
              <span class="flex min-w-44 items-center justify-between gap-4">
                <span>自定义题目</span>
                <span class="text-caption text-muted-foreground">本地工作区</span>
              </span>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
        </Select>
        <details
        v-if="ctfSection === 'catalog' && backend.jobs.value.length"
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
          aria-label="打开训练历史"
        >
          <Clock3 class="size-4" />
          历史
          <span class="font-mono text-caption text-muted-foreground">
            {{ backend.jobs.value.length }}
          </span>
        </summary>
        <div
          data-state="open"
          data-side="bottom"
          :class="[menuContentClass, menuViewportClass]"
          class="absolute left-0 top-[calc(100%+4px)] max-h-[min(480px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] overflow-y-auto"
          role="menu"
          aria-label="训练历史"
        >
          <div :class="menuLabelClass" class="flex items-center justify-between gap-3 px-2.5 py-2">
            <span>训练历史</span>
            <span class="font-normal text-muted-foreground">仅保存在本机</span>
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
                {{ formatCategory(job.category) }} · {{ job.experimentCount }} 次实验
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
        <details
        v-if="ctfSection === 'catalog' && activeQuestionBank"
        ref="bridgeMenu"
        class="app-no-drag relative shrink-0"
        @keydown.esc.stop.prevent="closeBridgeMenu"
      >
        <summary
          data-button=""
          data-variant="outline"
          data-size="sm"
          :class="buttonVariants({ variant: 'outline', size: 'sm' })"
          class="list-none [&::-webkit-details-marker]:hidden"
          aria-label="连接浏览器"
        >
          <Cable class="size-4" />
          {{ browserBridgeConnected ? '浏览器已连接' : '连接浏览器' }}
          <Circle
            class="size-2.5"
            :class="browserBridgeConnected ? 'fill-primary text-primary' : 'fill-muted-foreground text-muted-foreground'"
          />
        </summary>
        <div
          data-state="open"
          data-side="bottom"
          :class="[menuContentClass, menuViewportClass]"
          class="absolute left-0 top-[calc(100%+4px)] w-[min(360px,calc(100vw-2rem))] p-3"
          aria-label="浏览器连接"
        >
          <p class="text-control font-medium">连接 MilkSU 浏览器扩展</p>
          <p class="mt-1 text-caption leading-5 text-muted-foreground">
            第一次使用：安装扩展，复制下方配对码，再到 NSSCTF 或 CTFshow 页面点击 MilkSU 扩展并粘贴。
          </p>
          <div
            v-if="browserPairingCode"
            class="mt-3 rounded-md border border-border bg-background px-3 py-2"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-caption font-medium">本机配对码已就绪</span>
              <span class="text-caption text-muted-foreground">仅连接本机 MilkSU</span>
            </div>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              为避免被截图或辅助功能意外读取，此处不显示明文；请用下方按钮复制。
            </p>
          </div>
          <p v-else class="mt-3 text-caption text-muted-foreground">
            正在启动本机 Bridge，稍后会在这里显示配对码。
          </p>
          <div class="mt-3 grid gap-2">
            <Button
              variant="outline"
              size="sm"
              :loading="browserSetupBusy"
              @click="prepareBrowserExtension"
            >
              <FolderOpen class="size-4" />
              安装本地扩展
            </Button>
            <Button
              variant="default"
              size="sm"
              :disabled="!browserPairingCode"
              @click="copyBrowserPairingCode"
            >
              <Copy class="size-4" />
              复制配对码
            </Button>
          </div>
          <p class="mt-3 text-caption" :class="browserBridgeConnected ? 'text-primary' : 'text-muted-foreground'">
            {{ browserBridgeConnected ? '扩展已与本机 MilkSU 建立连接' : '等待首次配对' }}
          </p>
        </div>
        </details>
        <span class="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          class="app-no-drag"
          aria-label="授权与模型设置"
          @click="$emit('openSettings')"
        >
          <ShieldCheck class="size-4" />
        </Button>
      </div>
      <div v-if="ctfSection === 'catalog' && activeQuestionBank" class="flex w-full items-center gap-3">
        <label class="app-no-drag relative min-w-52 flex-1">
        <FileSearch class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="deskQuery"
          class="pl-9"
          placeholder="搜索题号或题名"
          aria-label="搜索题库"
        />
        </label>
        <NativeSelect
        v-model="deskCategory"
        class="app-no-drag w-36"
        aria-label="按题型筛选"
      >
        <NativeSelectOption value="all">全部分类</NativeSelectOption>
        <NativeSelectOption
          v-for="category in deskCategories"
          :key="category"
          :value="category"
        >
          {{ category }}
        </NativeSelectOption>
        </NativeSelect>
        <Button
        variant="ghost"
        size="icon"
        class="app-no-drag"
        :loading="activeBank === 'nssctf' ? training.syncing.value : ctfshow.loading.value"
        aria-label="刷新当前题库"
        @click="activeBank === 'nssctf' ? syncCatalog() : refreshCTFShow()"
      >
        <RefreshCw class="size-4" />
        </Button>
      </div>
    </header>

    <div
      class="min-h-0 flex-1"
      :class="screen === 'challenge' ? 'overflow-hidden' : 'overflow-y-auto px-6 py-9'"
    >
      <div
        class="w-full"
        :class="screen === 'challenge' ? 'h-full' : screen === 'source' ? 'mx-auto max-w-5xl' : 'mx-auto max-w-5xl'"
      >
        <ManagedLabCatalog
          v-if="screen === 'challenge' && ctfSection === 'labs'"
          :labs="managedLabs.labs.value"
          :selected-lab-id="selectedLabId"
          :busy="managedLabs.loading.value || managedLabs.busy.value"
          :notice="labNotice || managedLabs.error.value"
          :access="managedLabAccess"
          @select="selectManagedLab"
          @request-start="startManagedLab"
          @open-workspace="openManagedLab"
          @request-reset="resetManagedLab"
          @request-stop="stopManagedLab"
          @request-destroy="destroyManagedLab"
          @start-training="startManagedLabAgent"
          @check-training="checkManagedLabTraining"
          @request-access="revealManagedLabAccess"
        />

        <ol v-if="ctfSection === 'catalog' && screen === 'source'" class="mx-auto mb-10 grid max-w-3xl grid-cols-3" aria-label="训练步骤">
          <li
            v-for="item in [
              { index: 1, label: '选择入口' },
              { index: 2, label: '选择题目' },
              { index: 3, label: 'Agent 工作台' },
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
              aria-label="选择题库"
            >
              <NativeSelectOption
                v-for="platform in visibleTrainingPlatforms"
                :key="platform.id"
                :value="platform.id"
              >
                {{ platform.name }}
              </NativeSelectOption>
              <NativeSelectOption value="custom">自定义题目</NativeSelectOption>
            </NativeSelect>
            <span class="text-caption text-muted-foreground">
              {{ activeBank === 'nssctf'
                ? `${training.dashboard.value?.catalogTotal ?? 0} 题`
                : activeBank === 'ctfshow'
                  ? `${ctfshow.status.value?.catalog.total ?? 0} 题`
                  : '统一训练工作区' }}
            </span>
          </div>

          <section
            class="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border bg-card px-4 py-3"
            aria-label="训练准备"
          >
            <div class="flex items-center gap-2">
              <span class="text-control font-medium">训练准备</span>
              <Badge variant="outline">{{ readinessCount }}/3</Badge>
            </div>
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-caption">
              <span
                class="flex items-center gap-1.5"
                :class="modelVerified ? 'text-foreground' : 'text-muted-foreground'"
              >
                <Check v-if="modelVerified" class="size-3.5 text-primary" />
                <Circle v-else class="size-3.5" />
                模型{{ modelVerified ? '已验证' : modelReady ? '待验证' : '未配置' }}
              </span>
              <span
                class="flex items-center gap-1.5"
                :class="selectedCatalogReady ? 'text-foreground' : 'text-muted-foreground'"
              >
                <Check v-if="selectedCatalogReady" class="size-3.5 text-primary" />
                <Circle v-else class="size-3.5" />
                题库{{ selectedCatalogReady ? '可用' : '未同步' }}
              </span>
              <span
                class="flex items-center gap-1.5"
                :class="selectedJudgeReady ? 'text-foreground' : 'text-muted-foreground'"
              >
                <Check v-if="selectedJudgeReady" class="size-3.5 text-primary" />
                <Circle v-else class="size-3.5" />
                Judge{{ selectedJudgeReady ? '已连接' : '待连接' }}
              </span>
            </div>
            <Button
              v-if="readinessAction"
              variant="ghost"
              size="sm"
              @click="runReadinessAction"
            >
              {{ readinessAction.label }}
              <ArrowRight class="size-4" />
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
                  重试同步
                </Button>
              </AlertDescription>
            </Alert>

            <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="ctfshow-title" class="text-xl font-semibold tracking-[-0.025em]">CTFshow 题库</h2>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{ ctfshow.status.value?.catalog.lastSyncedAt
                    ? `更新于 ${new Date(ctfshow.status.value.catalog.lastSyncedAt).toLocaleString()}`
                    : '尚未同步' }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <SegmentedControl
                  v-model="collaborationMode"
                  aria-label="CTFshow 协作模式"
                  :items="modeItems"
                />
                <Button variant="outline" @click="ctfshow.open()">
                  <ExternalLink class="size-4" />
                  打开 CTFshow
                </Button>
                <Button :loading="ctfshow.loading.value" @click="refreshCTFShow">
                  <RefreshCw class="size-4" />
                  刷新
                </Button>
              </div>
            </div>

            <div
              v-if="!ctfshowProblems.length"
              class="rounded-xl border border-border bg-card px-6 py-12 text-center"
            >
              <Library class="mx-auto size-6 text-muted-foreground" />
              <p class="mt-3 text-control font-medium">在 CTFshow 页点击 MilkSU 扩展</p>
              <Button
                class="mt-4"
                variant="outline"
                :disabled="!ctfshow.status.value?.bridge.pairingCode"
                @click="copyBridgeValue(ctfshow.status.value?.bridge.pairingCode ?? '', '配对码')"
              >
                <Copy class="size-4" />
                复制配对码
              </Button>
            </div>

            <template v-else>
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <Input v-model="ctfshowQuery" placeholder="搜索题号、题名或标签" />
                <NativeSelect v-model="ctfshowCategory" aria-label="题型">
                  <NativeSelectOption value="all">全部题型</NativeSelectOption>
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
                  <span>题目</span>
                  <span>题型</span>
                  <span>分值</span>
                  <span>解出</span>
                  <span>进度</span>
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
                  没有匹配题目
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>{{ filteredCTFShowProblems.length }} 题</span>
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ctfshowPage <= 1"
                    @click="ctfshowPage -= 1"
                  >
                    <ChevronLeft class="size-4" />
                    上一页
                  </Button>
                  <span class="min-w-14 text-center font-mono">{{ ctfshowPage }} / {{ ctfshowPageCount }}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="ctfshowPage >= ctfshowPageCount"
                    @click="ctfshowPage += 1"
                  >
                    下一页
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
                重试同步
              </Button>
            </AlertDescription>
          </Alert>

          <Alert v-if="activeBank === 'nssctf' && training.syncing.value" class="mb-5">
            <RefreshCw class="size-4 animate-spin" />
            <AlertDescription>
              正在限速同步 NSSCTF 公开题库；遇到平台限流会自动退避重试，完成前仍保留上一次完整快照。
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
                    variant="brand"
                    size="lg"
                    :loading="working || training.syncing.value"
                    @click="runDailyMission"
                  >
                    <Play class="size-4" />
                    {{ dailyMission.action }}
                    <ArrowRight class="size-4" />
                  </Button>
                  <span class="text-caption text-muted-foreground">{{ dailyMission.meta }}</span>
                </div>
              </div>
              <div class="grid grid-cols-3 border-t border-border bg-muted/30 lg:grid-cols-1 lg:border-l lg:border-t-0">
                <div class="px-5 py-4 lg:border-b lg:border-border">
                  <p class="text-caption text-muted-foreground">已完成</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ solvedJobCount }} 题</p>
                </div>
                <div class="border-x border-border px-5 py-4 lg:border-x-0 lg:border-b">
                  <p class="text-caption text-muted-foreground">已实验</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ totalExperimentCount }} 次</p>
                </div>
                <div class="px-5 py-4">
                  <p class="text-caption text-muted-foreground">本地题库</p>
                  <p class="mt-1 font-mono text-xl font-semibold">{{ training.dashboard.value?.catalogTotal ?? 0 }} 题</p>
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="activeBank === 'nssctf' && training.dashboard.value"
            class="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div class="p-5 sm:p-6">
              <div class="flex items-center justify-between gap-4">
                <h3 class="text-label font-medium">推荐下一道 NSSCTF 题</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  :loading="training.syncing.value"
                  @click="syncCatalog"
                >
                  <RefreshCw class="size-4" />
                  更新题库
                </Button>
              </div>

              <div v-if="training.dashboard.value.recommendations.length" class="mt-3 grid gap-x-6 md:grid-cols-2">
                <button
                  v-for="recommendation in training.dashboard.value.recommendations.slice(0, 4)"
                  :key="recommendation.problem.platformId"
                  type="button"
                  class="group flex min-w-0 items-start gap-3 border-b border-border py-3 text-left"
                  @click="chooseRecommendation(recommendation)"
                >
                  <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-caption font-semibold text-primary">
                    {{ recommendation.problem.difficulty.toFixed(1) }}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2 text-caption text-muted-foreground">
                      <Badge variant="secondary">{{ recommendation.kind }}</Badge>
                      <span class="font-mono">P{{ recommendation.problem.platformId }}</span>
                    </span>
                    <span class="mt-1 block truncate text-control font-medium group-hover:text-primary">
                      {{ recommendation.problem.title }}
                    </span>
                  </span>
                  <ChevronRight class="mt-3 size-4 shrink-0 text-muted-foreground" />
                </button>
              </div>

              <div v-else class="mt-4 rounded-lg bg-muted/50 px-5 py-7 text-center">
                <Button variant="brand" :loading="training.syncing.value" @click="syncCatalog">
                  同步题库
                </Button>
              </div>
            </div>
          </section>

          <section v-if="activeBank === 'nssctf' && training.dashboard.value?.series.length" class="mt-6">
            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
              <h2 class="text-label font-medium">赛事题单</h2>
              <Badge variant="outline">{{ training.dashboard.value.series.length }} 个系列</Badge>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <button
                v-for="series in training.dashboard.value.series.slice(0, 4)"
                :key="series.name"
                type="button"
                class="group rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40"
                @click="chooseSeries(series)"
              >
                <span class="flex items-start justify-between gap-4">
                  <span class="min-w-0">
                    <span class="block truncate text-control font-medium group-hover:text-primary">{{ series.name }}</span>
                    <span class="mt-1 block text-caption text-muted-foreground">
                      {{ series.problemCount }} 题 · 平均难度 {{ difficultyLabel(series.averageDifficulty) }}
                    </span>
                  </span>
                  <ChevronRight class="mt-1 size-4 shrink-0 text-muted-foreground" />
                </span>
                <span class="mt-3 flex flex-wrap gap-1.5">
                  <Badge v-for="category in series.categories.slice(0, 4)" :key="category" variant="secondary">
                    {{ category }}
                  </Badge>
                  <Badge variant="outline">
                    {{ series.attemptedCount ? `已尝试 ${series.attemptedCount}` : '未开始' }}
                  </Badge>
                </span>
                <span v-if="series.attemptedCount" class="mt-4 block">
                  <span class="flex items-center justify-between text-caption text-muted-foreground">
                    <span>完成 {{ series.completedCount }} / {{ series.problemCount }}</span>
                    <span class="font-mono">{{ seriesProgress(series) }}%</span>
                  </span>
                  <span class="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      class="block h-full rounded-full bg-primary"
                      :style="{ width: `${seriesProgress(series)}%` }"
                    />
                  </span>
                </span>
              </button>
            </div>
          </section>

          <div v-if="activeBank === 'nssctf'" class="mt-6 grid gap-3 md:grid-cols-2">
            <ActionCard
              title="NSSCTF 公开题库"
              @click="showProblems"
            >
              <template #icon><Library /></template>
              <template #trailing>
                <span class="flex items-center gap-2 text-body font-medium">
                  {{ training.dashboard.value?.catalogTotal ?? 0 }} 题
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
                <Badge v-else-if="arenaReady" variant="outline">已连接</Badge>
                <span v-else class="flex items-center gap-2 text-body text-muted-foreground">
                  <KeyRound class="size-4" />
                  配置 Token
                </span>
              </template>
            </ActionCard>
          </div>

          <section v-if="activeBank === 'nssctf' && backend.jobs.value.length" class="mt-9 border-t border-border pt-6">
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-label font-medium">最近训练</h2>
              <div class="flex items-center gap-3">
                <span class="text-caption text-muted-foreground">{{ backend.jobs.value.length }} 个任务</span>
                <Button
                  v-if="backend.jobs.value.length > 3"
                  variant="link"
                  size="text"
                  @click="historyExpanded = !historyExpanded"
                >
                  {{ historyExpanded ? '收起' : '查看全部' }}
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
                  {{ formatCategory(job.category) }} · {{ job.experimentCount }} 次实验
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
            <div class="rounded-xl border border-border bg-card p-7 sm:p-9">
              <span class="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <FilePlus2 class="size-5" />
              </span>
              <h2 id="custom-challenge-title" class="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                自定义题目
              </h2>
              <p class="mt-2 max-w-2xl text-body leading-6 text-muted-foreground">
                适合线下比赛、未接入平台或你自己整理的题目。导入后只会在 MilkSU 建立本地工作区，不会上传到任何 CTF 网站。
              </p>

              <div class="mt-7 grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <Archive class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">本地保存</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">题面、截图和附件进入本题工作区。</p>
                </div>
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <Bot class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">Agent 可读</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">沿用同一套 Coding、证据与复盘能力。</p>
                </div>
                <div class="rounded-lg border border-border bg-background px-4 py-4">
                  <ShieldCheck class="size-4 text-muted-foreground" />
                  <p class="mt-3 text-control font-medium">不代替判题</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">外部平台结果仍由你确认并记录。</p>
                </div>
              </div>

              <Button class="mt-7" size="lg" @click="manualIntake?.open()">
                <FilePlus2 class="size-4" />
                新建自定义题目
              </Button>
            </div>
          </div>
        </section>

        <section
          v-else-if="ctfSection === 'catalog' && screen === 'challenge' && (activeBank === 'hackthebox' || activeBank === 'tryhackme')"
          class="h-full overflow-y-auto px-6 py-8"
          :aria-labelledby="`${activeBank}-platform-title`"
        >
          <div v-if="activeExternalPlatform" class="mx-auto max-w-4xl">
            <div class="rounded-xl border border-border bg-card p-7 sm:p-9">
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
                  查看官方入口
                </Button>
              </div>
            </div>
          </div>
        </section>

        <CTFChallengeDesk
          v-else-if="ctfSection === 'catalog' && screen === 'challenge'"
          :active-bank="activeCatalogBank"
          :nssctf-problems="publicCatalog.result.value?.problems ?? []"
          :ctfshow-problems="visibleCTFShowProblems"
          :selected-nssctf="selectedProblem"
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
          :collaboration-mode="collaborationMode"
          :selected-browser-ready="selectedBrowserReady"
          :ctfshow-bridge-ready="ctfshowBridgeReady"
          :attachment-error="attachmentError || publicProblems.error.value || ''"
          :local-materials="localMaterials"
          :catalog-error="activeBank === 'nssctf'
            ? publicCatalog.error.value ?? training.error.value ?? ''
            : ctfshow.error.value ?? ''"
          :model-verified="modelVerified"
          :catalog-ready="selectedCatalogReady"
          :judge-ready="selectedJudgeReady"
          :has-active-training="Boolean(selectedActiveJob)"
          :browser-extension-ready="Boolean(webBridge.status.value?.bridge.extensionPath)"
          :pairing-code="webBridge.status.value?.bridge.pairingCode ?? ''"
          :browser-setup-busy="browserSetupBusy"
          @select-nssctf="chooseCatalogProblem"
          @select-ctfshow="previewCTFShowProblem"
          @previous-page="previousDeskPage"
          @next-page="nextDeskPage"
          @go-page="goDeskPage"
          @start-nssctf="startPublicWorkspace"
          @choose-local-materials="chooseLocalMaterials"
          @start-ctfshow="chooseCTFShowProblem"
          @open-problem="openProblem"
          @prepare-browser-extension="prepareBrowserExtension"
          @copy-pairing-code="copyBridgeValue(webBridge.status.value?.bridge.pairingCode ?? '', '配对码')"
          @open-ctfshow="ctfshow.open()"
          @sync-nssctf="syncCatalog"
          @refresh-judge="activeBank === 'ctfshow' ? ctfshow.open() : webBridge.refresh()"
          @open-settings="$emit('openSettings')"
          @update:collaboration-mode="collaborationMode = $event"
        />

        <!--
        <section v-else-if="false" aria-labelledby="challenge-title">
          <Button variant="ghost" size="sm" class="mb-6" @click="showSource">
            <ArrowLeft class="size-4" />
            返回
          </Button>
          <div>
            <h1 id="challenge-title" class="text-3xl font-semibold tracking-[-0.04em]">
              {{ selectedProblem ? '题目详情' : selectedSeries ? selectedSeries.name : 'NSSCTF 公开题库' }}
            </h1>
            <p v-if="!selectedProblem" class="mt-2 text-body leading-6 text-muted-foreground">
              {{
                selectedSeries
                  ? `完成 ${selectedSeries.completedCount} / ${selectedSeries.problemCount} · 已尝试 ${selectedSeries.attemptedCount}`
                  : `${publicCatalog.result.value?.total ?? training.dashboard.value?.catalogTotal ?? 0} 道本地题目`
              }}
            </p>
          </div>

          <section v-if="selectedSeries && !selectedProblem" class="mt-7 overflow-hidden rounded-xl border border-border bg-card">
            <div class="border-b border-border bg-muted/20 p-5">
              <div class="flex flex-wrap items-start justify-between gap-5">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{{ selectedSeries.problemCount }} 题</Badge>
                    <Badge variant="outline">平均难度 {{ difficultyLabel(selectedSeries.averageDifficulty) }}</Badge>
                    <Badge v-if="selectedSeries.completedCount === selectedSeries.problemCount" variant="secondary">
                      系列已完成
                    </Badge>
                  </div>
                  <div class="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <p class="text-caption text-muted-foreground">训练进度</p>
                      <p class="mt-1 font-mono text-2xl font-semibold">
                        {{ selectedSeries.completedCount }} / {{ selectedSeries.problemCount }}
                      </p>
                    </div>
                    <p class="text-right text-caption leading-5 text-muted-foreground">
                      已尝试 {{ selectedSeries.attemptedCount }} 题<br>
                      完成度 {{ seriesProgress(selectedSeries) }}%
                    </p>
                  </div>
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: `${seriesProgress(selectedSeries)}%` }"
                    />
                  </div>
                </div>
                <Button
                  v-if="selectedSeries.nextProblemId"
                  variant="brand"
                  :loading="publicProblems.importing.value"
                  @click="chooseNextSeriesProblem"
                >
                  <Play class="size-4" />
                  {{ selectedSeries.attemptedCount ? '继续训练' : '从第一题开始' }}
                </Button>
              </div>
            </div>
            <div class="border-b border-border p-4">
              <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_10rem]">
                <Input
                  v-model="seriesQuery"
                  size="sm"
                  placeholder="搜索题名、标签或 P316"
                  aria-label="搜索赛事题目"
                />
                <NativeSelect v-model="seriesCategory" size="sm" aria-label="按题型筛选">
                  <NativeSelectOption value="all">全部题型</NativeSelectOption>
                  <NativeSelectOption
                    v-for="category in selectedSeries.categories"
                    :key="category"
                    :value="category"
                  >
                    {{ category }}
                  </NativeSelectOption>
                </NativeSelect>
                <NativeSelect v-model="seriesStatus" size="sm" aria-label="按训练状态筛选">
                  <NativeSelectOption value="all">全部状态</NativeSelectOption>
                  <NativeSelectOption value="new">未开始</NativeSelectOption>
                  <NativeSelectOption value="attempted">再挑战</NativeSelectOption>
                  <NativeSelectOption value="completed">已完成</NativeSelectOption>
                </NativeSelect>
              </div>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>
                  找到 {{ filteredSeriesProblems.length }} 题
                  <template v-if="filteredSeriesProblems.length">
                    · 当前 {{ seriesResultStart }}–{{ seriesResultEnd }}
                  </template>
                </span>
                <Button variant="link" size="text" @click="selectedSeries = null; selectedProblem = null">
                  查看完整题库
                </Button>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[640px] border-collapse xl:min-w-[820px]">
                <thead class="bg-muted/20 text-left text-caption text-muted-foreground">
                  <tr>
                    <th class="w-24 px-5 py-3 font-medium">题号</th>
                    <th class="px-3 py-3 font-medium">题目</th>
                    <th class="w-28 px-3 py-3 font-medium">题型</th>
                    <th class="w-24 px-3 py-3 text-right font-medium">难度</th>
                    <th class="hidden w-24 px-3 py-3 text-right font-medium xl:table-cell">解出</th>
                    <th class="w-28 px-3 py-3 text-right font-medium">进度</th>
                    <th class="w-12 px-3 py-3" aria-label="打开题目" />
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="problem in visibleSeriesProblems"
                    :key="problem.platformId"
                    role="button"
                    tabindex="0"
                    class="group cursor-pointer border-t border-border bg-background text-control transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    @click="chooseSeriesProblem(problem.platformId)"
                    @keydown.enter.prevent="chooseSeriesProblem(problem.platformId)"
                    @keydown.space.prevent="chooseSeriesProblem(problem.platformId)"
                  >
                    <td class="px-5 py-3 font-mono text-caption text-muted-foreground">
                      P{{ problem.platformId }}
                    </td>
                    <td class="px-3 py-3">
                      <span class="block font-medium">{{ seriesProblemTitle(selectedSeries, problem.title) }}</span>
                      <span v-if="problem.tags.length" class="mt-0.5 block truncate text-caption text-muted-foreground">
                        {{ problem.tags.slice(0, 3).join(' · ') }}
                      </span>
                    </td>
                    <td class="px-3 py-3">
                      <Badge variant="outline">{{ problem.category }}</Badge>
                    </td>
                    <td class="px-3 py-3 text-right font-mono text-caption">
                      {{ difficultyLabel(problem.difficulty) }}
                    </td>
                    <td class="hidden px-3 py-3 text-right font-mono text-caption text-muted-foreground xl:table-cell">
                      {{ problem.solvedCount.toLocaleString() }}
                    </td>
                    <td class="px-3 py-3 text-right">
                      <Badge
                        :variant="seriesProblemStatus(selectedSeries, problem.platformId) === 'completed' ? 'secondary' : 'outline'"
                      >
                        {{ seriesProblemStatusLabel(selectedSeries, problem.platformId) }}
                      </Badge>
                    </td>
                    <td class="px-3 py-3 text-right">
                      <ChevronRight class="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </td>
                  </tr>
                  <tr v-if="!visibleSeriesProblems.length">
                    <td colspan="7" class="px-5 py-12 text-center">
                      <p class="text-control font-medium">没有符合条件的题目</p>
                      <p class="mt-1 text-caption text-muted-foreground">换个关键词、题型或训练状态试试。</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <span class="text-caption text-muted-foreground">每页 {{ seriesPageSize }} 题</span>
              <div class="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一页"
                  :disabled="seriesPage <= 1"
                  @click="seriesPage--"
                >
                  <ChevronLeft class="size-4" />
                </Button>
                <span class="min-w-20 text-center font-mono text-caption">
                  {{ seriesPage }} / {{ seriesPageCount }}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一页"
                  :disabled="seriesPage >= seriesPageCount"
                  @click="seriesPage++"
                >
                  <ChevronRight class="size-4" />
                </Button>
              </div>
            </div>
          </section>

          <section
            v-else-if="!selectedProblem"
            class="mt-7 overflow-hidden rounded-xl border border-border bg-card"
          >
            <form
              class="border-b border-border bg-muted/20 p-4"
              @submit.prevent="submitCatalogSearch"
            >
              <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_11rem_auto]">
                <Input
                  v-model="catalogQuery"
                  size="sm"
                  placeholder="搜索题号、题名或标签"
                  aria-label="搜索 NSSCTF 题库"
                  autofocus
                />
                <NativeSelect v-model="catalogCategory" size="sm" aria-label="按题型筛选">
                  <NativeSelectOption value="all">全部题型</NativeSelectOption>
                  <NativeSelectOption
                    v-for="category in publicCatalog.result.value?.categories ?? []"
                    :key="category"
                    :value="category"
                  >
                    {{ category }}
                  </NativeSelectOption>
                </NativeSelect>
                <div class="flex gap-2">
                  <Button
                    type="submit"
                    variant="brand"
                    size="sm"
                    :loading="publicCatalog.loading.value"
                  >
                    <FileSearch class="size-4" />
                    搜索
                  </Button>
                  <Button
                    v-if="catalogQuery || catalogCategory !== 'all'"
                    type="button"
                    variant="ghost"
                    size="sm"
                    @click="clearCatalogSearch"
                  >
                    清除
                  </Button>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>{{ publicCatalog.result.value?.total ?? 0 }} 题</span>
                <span v-if="training.dashboard.value?.lastSyncedAt">
                  更新于 {{ new Date(training.dashboard.value.lastSyncedAt).toLocaleString() }}
                </span>
              </div>
            </form>

            <Alert v-if="publicCatalog.error.value" variant="destructive" class="m-4">
              <Circle class="size-4" />
              <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
                <span>{{ publicCatalog.error.value }}</span>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="publicCatalog.loading.value"
                  @click="loadPublicCatalog(catalogPage)"
                >
                  <RefreshCw class="size-4" />
                  重试
                </Button>
              </AlertDescription>
            </Alert>

            <div v-if="publicCatalog.result.value?.problems.length" class="overflow-x-auto">
              <table class="w-full min-w-[640px] border-collapse xl:min-w-[820px]">
                <thead class="bg-muted/20 text-left text-caption text-muted-foreground">
                  <tr>
                    <th class="w-24 px-5 py-3 font-medium">题号</th>
                    <th class="px-3 py-3 font-medium">题目</th>
                    <th class="w-28 px-3 py-3 font-medium">题型</th>
                    <th class="hidden w-24 px-3 py-3 text-right font-medium xl:table-cell">分值</th>
                    <th class="w-24 px-3 py-3 text-right font-medium">难度</th>
                    <th class="hidden w-24 px-3 py-3 text-right font-medium xl:table-cell">解出</th>
                    <th class="w-24 px-3 py-3 text-right font-medium">进度</th>
                    <th class="w-12 px-3 py-3" aria-label="选择题目" />
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="problem in publicCatalog.result.value.problems"
                    :key="problem.platformId"
                    role="button"
                    tabindex="0"
                    class="group cursor-pointer border-t border-border bg-background text-control transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    @click="chooseCatalogProblem(problem.platformId)"
                    @keydown.enter.prevent="chooseCatalogProblem(problem.platformId)"
                    @keydown.space.prevent="chooseCatalogProblem(problem.platformId)"
                  >
                    <td class="px-5 py-3 font-mono text-caption text-muted-foreground">
                      P{{ problem.platformId }}
                    </td>
                    <td class="px-3 py-3">
                      <span class="block font-medium">{{ problem.title }}</span>
                      <span v-if="problem.tags.length" class="mt-0.5 block truncate text-caption text-muted-foreground">
                        {{ problem.tags.slice(0, 3).join(' · ') }}
                      </span>
                    </td>
                    <td class="px-3 py-3">
                      <Badge variant="outline">{{ problem.category }}</Badge>
                    </td>
                    <td class="hidden px-3 py-3 text-right font-mono text-caption xl:table-cell">
                      {{ problem.points }}
                    </td>
                    <td class="px-3 py-3 text-right font-mono text-caption">
                      {{ difficultyLabel(problem.difficulty) }}
                    </td>
                    <td class="hidden px-3 py-3 text-right font-mono text-caption text-muted-foreground xl:table-cell">
                      {{ problem.solvedCount.toLocaleString() }}
                    </td>
                    <td class="px-3 py-3 text-right">
                      <Badge
                        :variant="catalogProblemStatus(problem.platformId) === 'completed' ? 'secondary' : 'outline'"
                      >
                        {{ catalogProblemStatusLabel(problem.platformId) }}
                      </Badge>
                    </td>
                    <td class="px-3 py-3 text-right">
                      <ChevronRight class="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              v-else-if="!publicCatalog.loading.value && !publicCatalog.error.value"
              class="px-5 py-12 text-center"
            >
              <p class="text-control font-medium">
                {{ training.dashboard.value?.catalogTotal ? '没有匹配题目' : '本地题库为空' }}
              </p>
              <Button
                v-if="!training.dashboard.value?.catalogTotal"
                variant="brand"
                size="sm"
                class="mt-4"
                :loading="training.syncing.value"
                @click="syncCatalog"
              >
                同步题库
              </Button>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <span class="text-caption text-muted-foreground">每页 {{ catalogPageSize }} 题</span>
              <div class="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一页"
                  :disabled="catalogPage <= 1 || publicCatalog.loading.value"
                  @click="loadPublicCatalog(catalogPage - 1)"
                >
                  <ChevronLeft class="size-4" />
                </Button>
                <span class="min-w-20 text-center font-mono text-caption">
                  {{ catalogPage }} / {{ Math.max(publicCatalog.result.value?.pageCount ?? 0, 1) }}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一页"
                  :disabled="catalogPage >= (publicCatalog.result.value?.pageCount ?? 0) || publicCatalog.loading.value"
                  @click="loadPublicCatalog(catalogPage + 1)"
                >
                  <ChevronRight class="size-4" />
                </Button>
              </div>
            </div>
          </section>

          <Alert v-if="publicProblems.error.value" variant="destructive" class="mt-4">
            <Circle class="size-4" />
            <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
              <span>{{ publicProblems.error.value }}</span>
              <Button
                variant="outline"
                size="sm"
                :loading="publicProblems.importing.value"
                :disabled="!problemInput.trim()"
                @click="importProblem"
              >
                <RefreshCw class="size-4" />
                重新读取
              </Button>
            </AlertDescription>
          </Alert>

          <section v-if="selectedProblem" class="mt-7 rounded-xl border border-border bg-card p-6">
            <div class="flex flex-wrap items-start gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" class="font-mono">P{{ selectedProblem.platformId }}</Badge>
                  <Badge variant="outline">{{ selectedProblem.category }}</Badge>
                  <Badge v-if="selectedProblem.hasAttachment" variant="secondary">有附件</Badge>
                  <span class="text-caption text-muted-foreground">{{ selectedProblem.points }} pts</span>
                </div>
                <h2 class="mt-3 text-xl font-semibold tracking-[-0.025em]">{{ selectedProblem.title }}</h2>
                <MarkdownContent
                  class="mt-2 line-clamp-3 text-body leading-6 text-muted-foreground"
                  :content="selectedProblem.statement"
                  compact
                />
              </div>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="returnToProblemList">
                  <ArrowLeft class="size-4" />
                  返回列表
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="在 NSSCTF 打开" @click="openProblem">
                  <ExternalLink class="size-4" />
                </Button>
              </div>
            </div>
            <div v-if="selectedProblem.tags.length" class="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <Badge v-for="tag in selectedProblem.tags" :key="tag" variant="secondary">{{ tag }}</Badge>
            </div>
          </section>

          <section v-if="selectedProblem" class="mt-5 rounded-xl border border-border bg-card p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h2 class="flex items-center gap-2 text-label font-medium">
                  <Cable class="size-4" />
                  连接已登录 Chrome
                </h2>
                <p class="mt-1 text-caption leading-5 text-muted-foreground">
                  扩展只绑定 P{{ selectedProblem.platformId }}，不读取 Cookie、密码或浏览历史。
                </p>
              </div>
              <Button variant="ghost" size="sm" :loading="webBridge.loading.value" @click="webBridge.refresh">
                <RefreshCw class="size-4" />
                检测连接
              </Button>
            </div>

            <Alert v-if="selectedBrowserReady" class="mt-4">
              <Check class="size-4" />
              <AlertDescription>
                <span v-if="selectedBrowserCanSubmit">
                  Chrome 已连接 P{{ selectedBrowserPage?.nssctf.problemId }}；MilkSU 可以提交候选并读取 Judge 回执。
                </span>
                <span v-else-if="selectedBrowserPage?.nssctf.needsStart">
                  Chrome 已连接 P{{ selectedBrowserPage.nssctf.problemId }}。请先在 NSSCTF 页面亲自点击“开启环境”
                  <template v-if="selectedBrowserPage.nssctf.startCost">
                    （{{ selectedBrowserPage.nssctf.startCost }} 金币）
                  </template>
                  ；MilkSU 不会自动扣币。开启后再检测连接。
                </span>
                <span v-else>
                  Chrome 已连接 P{{ selectedBrowserPage?.nssctf.problemId }}，但当前页面没有可用的提交入口；请刷新题目页后再检测连接。
                </span>
                <span v-if="selectedProblem.hasAttachment">
                  建立工作台时会校验并导入附件。
                </span>
              </AlertDescription>
            </Alert>

            <div v-else class="mt-4 rounded-lg bg-muted/50 p-4">
              <ol class="space-y-2 text-caption leading-5 text-muted-foreground">
                <li>1. 在 Chrome 扩展页“加载已解压的扩展程序”。</li>
                <li>2. 选择下方扩展目录，再把配对码粘进扩展。</li>
                <li>3. 打开 P{{ selectedProblem.platformId }}，点击扩展里的“连接这个题目”。</li>
              </ol>
              <p v-if="webBridge.status.value?.bridge.extensionPath" class="mt-3 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-caption">
                {{ webBridge.status.value.bridge.extensionPath }}
              </p>
              <p v-else class="mt-3 text-caption text-muted-foreground">请在 MilkSU 桌面应用中完成浏览器连接。</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!webBridge.status.value?.bridge.extensionPath"
                  @click="copyBridgeValue(webBridge.status.value?.bridge.extensionPath ?? '', '扩展目录')"
                >
                  <Copy class="size-4" />
                  复制扩展目录
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="!webBridge.status.value?.bridge.pairingCode"
                  @click="copyBridgeValue(webBridge.status.value?.bridge.pairingCode ?? '', '配对码')"
                >
                  <Copy class="size-4" />
                  复制配对码
                </Button>
              </div>
            </div>

            <Alert v-if="selectedProblem.hasAttachment" class="mt-4">
              <ShieldCheck class="size-4" />
              <AlertDescription>
                附件只从当前绑定的 P{{ selectedProblem.platformId }} 页面导入，限制 4 MiB，并在后端复核 SHA-256。
                若尚未解锁，请先在 NSSCTF 由你本人确认开启；MilkSU 不会自动花金币。
              </AlertDescription>
            </Alert>

            <Alert v-if="attachmentError" variant="destructive" class="mt-4">
              <Circle class="size-4" />
              <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
                <span>{{ attachmentError }}</span>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="working"
                  :disabled="selectedProblem.hasAttachment && !selectedBrowserReady"
                  @click="startPublicWorkspace"
                >
                  <RefreshCw class="size-4" />
                  重新导入
                </Button>
              </AlertDescription>
            </Alert>
          </section>

          <div
            v-if="selectedProblem"
            class="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5"
          >
            <div class="max-w-lg">
              <SegmentedControl
                v-model="collaborationMode"
                aria-label="协作模式"
                :items="modeItems"
              />
              <p class="mt-2 text-caption leading-5 text-muted-foreground">{{ modePreview }}</p>
            </div>
            <Button
              variant="brand"
              size="lg"
              :loading="working"
              :disabled="!selectedProblem || (selectedProblem.hasAttachment && !selectedBrowserReady)"
              @click="startPublicWorkspace"
            >
              <Play class="size-4" />
              建立工作台
              <ArrowRight class="size-4" />
            </Button>
          </div>
        </section>
        -->

        <section v-else-if="screen === 'workspace'" aria-labelledby="workspace-title">
          <div class="mb-6 flex items-center justify-between gap-4">
            <Button variant="ghost" size="sm" @click="showSource">
              <ArrowLeft class="size-4" />
              训练场
            </Button>
            <Button variant="ghost" size="sm" :loading="backend.loading.value" @click="backend.loadJobs">
              <RefreshCw class="size-4" />
              刷新记录
            </Button>
          </div>

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
            <div class="flex flex-wrap items-start justify-between gap-5">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{{ formatCategory(activeProjection.challenge.category) }}</Badge>
                  <Badge variant="outline">{{ jobStatusLabel(activeProjection.job.status) }}</Badge>
                  <Badge v-if="isArenaWorkspace" variant="secondary">Agent Arena</Badge>
                  <Badge v-if="isWebWorkspace" variant="secondary">Chrome Judge</Badge>
                </div>
                <h1 id="workspace-title" class="mt-3 text-3xl font-semibold tracking-[-0.04em]">
                  {{ activeProjection.challenge.title }}
                </h1>
                <p class="mt-2 text-body text-muted-foreground">
                  {{ activeProjection.challenge.trackName }} · {{ activeProjection.challenge.agentPolicy.label }}模式
                </p>
              </div>
              <Button
                v-if="activeProjection.challenge.source.uri"
                variant="outline"
                @click="openActiveChallenge"
              >
                <ExternalLink class="size-4" />
                打开题目
              </Button>
            </div>

            <Alert v-if="isWebWorkspace" class="mt-5">
              <Cable class="size-4" />
              <AlertDescription>
                <div v-if="activeBrowserReady" class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p v-if="activeBrowserCanSubmit">
                      已连接 NSSCTF P{{ activeBrowserPage?.nssctf.problemId }}；提交结果将由平台回执决定。
                    </p>
                    <p v-else-if="activeBrowserPage?.nssctf.needsStart">
                      已连接 P{{ activeBrowserPage.nssctf.problemId }}，但题目尚未开启。请先在 NSSCTF 页面亲自开启；
                      MilkSU 不会自动扣币。
                    </p>
                    <p v-else>
                      已连接 P{{ activeBrowserPage?.nssctf.problemId }}，但尚未检测到提交入口。
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" :loading="webBridge.loading.value" @click="webBridge.refresh">
                    <RefreshCw class="size-4" />
                    检测连接
                  </Button>
                </div>
                <div v-else>
                  <p class="text-control font-medium">连接当前 NSSCTF 题目</p>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">
                    安装扩展，复制本机配对码，再到题目页点击 MilkSU；不必返回训练场。
                  </p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      :loading="browserSetupBusy"
                      @click="prepareBrowserExtension"
                    >
                      <FolderOpen class="size-4" />
                      安装扩展
                    </Button>
                    <Button
                      size="sm"
                      :disabled="!browserPairingCode"
                      @click="copyBridgeValue(browserPairingCode, '配对码')"
                    >
                      <Copy class="size-4" />
                      复制配对码
                    </Button>
                    <Button variant="ghost" size="sm" :loading="webBridge.loading.value" @click="webBridge.refresh">
                      <RefreshCw class="size-4" />
                      检测连接
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div class="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]">
              <div class="space-y-5">
                <section class="rounded-xl border border-border bg-card p-6">
                  <div class="flex items-center gap-2">
                    <Trophy class="size-4 text-muted-foreground" />
                    <h2 class="text-label font-medium">题面</h2>
                  </div>
                  <MarkdownContent
                    class="mt-4 max-h-52 overflow-y-auto text-body leading-6"
                    :content="activeProjection.challenge.statement"
                  />
                </section>

                <section class="rounded-xl border border-border bg-card p-6">
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <h2 class="flex items-center gap-2 text-label font-medium">
                        <Bot class="size-4" />
                        与 Agent 协作
                      </h2>
                      <p class="mt-1 text-caption text-muted-foreground">
                        {{ activeProjection.challenge.agentPolicy.startBehavior }}
                      </p>
                      <div class="mt-2 flex flex-wrap items-center gap-1.5">
                        <span class="mr-1 text-caption text-muted-foreground">本题可用</span>
                        <Badge
                          v-for="capability in agentCapabilityLabels"
                          :key="capability"
                          variant="outline"
                        >
                          {{ capability }}
                        </Badge>
                      </div>
                    </div>
                    <Button :loading="working" :disabled="!canStartAgentTurn" @click="openCodingAgent">
                      <Sparkles class="size-4" />
                      {{ agentActionLabel }}
                    </Button>
                  </div>

                  <div
                    v-if="hasAgentRecoveryPoint && agentCheckpoint"
                    class="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3"
                  >
                    <div class="flex items-start gap-3">
                      <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-background text-muted-foreground">
                        <Target class="size-4" />
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-control font-medium">
                            {{ hasAgentRoute ? '当前路线' : '最近一次 Agent 记录' }}
                          </p>
                          <Badge variant="outline">
                            {{ agentProgress?.phase || agentCheckpointStatus }}
                          </Badge>
                        </div>
                        <div
                          v-if="hasAgentRoute && agentProgress"
                          class="mt-3 grid gap-2 leading-5"
                        >
                          <div
                            v-if="agentProgress.lastVerifiedFact"
                            class="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
                          >
                            <span class="text-muted-foreground">已确认</span>
                            <p class="text-control">{{ agentProgress.lastVerifiedFact }}</p>
                          </div>
                          <div
                            v-if="agentProgress.currentHypothesis"
                            class="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
                          >
                            <span class="text-muted-foreground">当前假设</span>
                            <p class="text-control">{{ agentProgress.currentHypothesis }}</p>
                          </div>
                          <div
                            v-if="agentProgress.nextAction"
                            class="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]"
                          >
                            <span class="text-muted-foreground">下一步</span>
                            <p class="text-control">{{ agentProgress.nextAction }}</p>
                          </div>
                        </div>
                        <p
                          v-else
                          class="mt-1 line-clamp-2 text-caption leading-5 text-muted-foreground"
                        >
                          {{ agentCheckpointSummary }}
                        </p>
                        <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                          <span>{{ agentCheckpoint.metrics.completedTurns }} 回合</span>
                          <span>· {{ agentCheckpoint.metrics.toolCalls }} 次工具调用</span>
                          <span>· {{ agentCheckpoint.candidateCount }} 个候选</span>
                          <span v-if="agentProgress?.deadEnds.length">
                            · 避开 {{ agentProgress.deadEnds.length }} 条失败路线
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="agentProgress?.needsReplan"
                      class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
                    >
                      <p class="text-caption text-muted-foreground">
                        {{ agentProgress.replanReason }}，先让独立策略 Agent 换一条路线。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        :loading="working"
                        @click="openStrategistAgent"
                      >
                        <BrainCircuit class="size-4" />
                        策略复盘
                      </Button>
                    </div>
                  </div>

                  <div class="mt-4 grid grid-cols-3 gap-2">
                    <div class="rounded-lg bg-muted/50 px-3 py-2">
                      <p class="text-caption text-muted-foreground">剩余回合</p>
                      <p class="mt-1 font-mono text-control">
                        {{
                          backend.agentBudget.value?.remainingTurns
                            ?? activeProjection.challenge.agentPolicy.budget.maxTurns
                        }}
                        / {{ activeProjection.challenge.agentPolicy.budget.maxTurns }}
                      </p>
                      <p class="mt-0.5 text-caption text-muted-foreground">
                        已用 {{ backend.agentBudget.value?.usedTurns ?? 0 }} 回合
                      </p>
                    </div>
                    <div class="rounded-lg bg-muted/50 px-3 py-2">
                      <p class="text-caption text-muted-foreground">剩余时间</p>
                      <p class="mt-1 font-mono text-control">
                        {{
                          Math.ceil(
                            (backend.agentBudget.value?.remainingWallSeconds
                              ?? activeProjection.challenge.agentPolicy.budget.maxWallMinutes * 60)
                            / 60,
                          )
                        }}
                        min
                      </p>
                      <p class="mt-0.5 text-caption text-muted-foreground">
                        {{
                          backend.agentBudget.value?.firstTurnStartedAt
                            ? `已用 ${Math.floor(backend.agentBudget.value.elapsedWallSeconds / 60)} min`
                            : '首回合后计时'
                        }}
                      </p>
                    </div>
                    <div class="rounded-lg bg-muted/50 px-3 py-2">
                      <p class="text-caption text-muted-foreground">提交余额</p>
                      <p class="mt-1 font-mono text-control">
                        {{
                          backend.agentBudget.value?.remainingWrongSubmissions
                            ?? activeProjection.challenge.agentPolicy.budget.maxWrongSubmissions
                        }}
                        次
                      </p>
                      <p class="mt-0.5 text-caption text-muted-foreground">
                        已拒绝 {{ backend.agentBudget.value?.wrongSubmissions ?? 0 }} 次
                      </p>
                    </div>
                  </div>

                  <Alert v-if="agentBudgetStopMessage" variant="destructive" class="mt-4">
                    <Circle class="size-4" />
                    <AlertDescription class="flex flex-wrap items-center justify-between gap-3">
                      <span>{{ agentBudgetStopMessage }}</span>
                      <Button variant="outline" size="sm" @click="showSource">
                        返回题库
                      </Button>
                    </AlertDescription>
                  </Alert>

                  <div v-if="activeProjection.learning.length" class="mt-5 border-t border-border pt-4">
                    <p class="text-caption font-medium text-muted-foreground">最近记录</p>
                    <MarkdownContent
                      class="mt-2 text-body leading-6"
                      :content="activeProjection.learning.at(-1)?.content ?? ''"
                    />
                  </div>

                  <form class="mt-5 flex items-end gap-2" @submit.prevent="sendObservation">
                    <Textarea v-model="observation" placeholder="告诉 Agent：我在页面、附件或环境里观察到了什么…" />
                    <Button type="submit" variant="brand" :disabled="!observation.trim()">
                      <Send class="size-4" />
                      发给 Agent
                    </Button>
                  </form>
                </section>

                <CTFTrajectory :projection="activeProjection" />

                <CTFArtifacts
                  v-if="activeProjection.artifacts.length"
                  :projection="activeProjection"
                />

                <CTFDebrief
                  v-if="activeProjection.experiments.length || activeProjection.outcome"
                  :debrief="activeProjection.debrief"
                  :submitting="working"
                  @submit-reflection="sendDebriefReflection"
                  @save-memory="saveTrainingMemory"
                />

                <CTFTrainingArchive
                  :job-id="activeProjection.job.id"
                  :replay-available="Boolean(
                    activeProjection.agentRuns.length || activeProjection.agentCandidates.length
                  )"
                />
              </div>

              <div class="space-y-5">
                <details class="group rounded-xl border border-border bg-card">
                  <summary class="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
                    <span class="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <BrainCircuit class="size-4" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">解题记忆</span>
                      <span class="block truncate text-caption text-muted-foreground">
                        {{
                          memoryLoading
                            ? '正在匹配'
                            : recalledMemories.length
                              ? `${recalledMemories.length} 条待验证先验`
                              : '没有匹配的旧题技法'
                        }}
                      </span>
                    </span>
                    <Badge v-if="recalledMemories.length" variant="outline">
                      {{ recalledMemories.length }}
                    </Badge>
                  </summary>
                  <div class="border-t border-border px-5 py-4">
                    <p class="text-caption leading-5 text-muted-foreground">
                      这些内容来自你明确保存的旧题复盘。Agent 必须用当前材料重新验证，原始证据优先。
                    </p>
                    <div v-if="recalledMemories.length" class="mt-3 space-y-3">
                      <article
                        v-for="memory in recalledMemories"
                        :key="memory.id"
                        class="rounded-lg bg-muted/40 p-3"
                      >
                        <div class="flex items-start gap-2">
                          <div class="min-w-0 flex-1">
                            <p class="line-clamp-1 text-control font-medium">{{ memory.title }}</p>
                            <MarkdownContent
                              class="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                              :content="memory.summary"
                              compact
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="停用这条综合记忆；不删除原始证据"
                            :aria-label="`停用记忆：${memory.title}`"
                            @click="archiveTrainingMemory(memory)"
                          >
                            <Archive class="size-3.5" />
                          </Button>
                        </div>
                        <div class="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline">
                            {{ memoryVerificationLabel(memory) }}
                          </Badge>
                          <Badge variant="outline">置信 {{ Math.round(memory.confidence * 100) }}%</Badge>
                          <Badge v-for="tag in memory.tags.slice(0, 2)" :key="tag" variant="secondary">
                            {{ tag }}
                          </Badge>
                        </div>
                      </article>
                    </div>
                  </div>
                </details>

                <section class="rounded-xl border border-border bg-card p-5">
                  <h2 class="flex items-center gap-2 text-label font-medium">
                    <ShieldCheck class="size-4" />
                    授权环境
                  </h2>
                  <div v-if="authorizedTargets.length" class="mt-4 space-y-2">
                    <div
                      v-for="target in authorizedTargets"
                      :key="`${target.kind}:${target.value}`"
                      class="rounded-lg bg-muted/50 px-3 py-2"
                    >
                      <p class="text-caption text-muted-foreground">{{ targetKindLabel(target.kind) }}</p>
                      <p class="mt-1 break-all font-mono text-caption leading-5">{{ target.value }}</p>
                    </div>
                  </div>
                  <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
                    当前题目没有远程目标；Agent 只处理工作区内的题面与附件。
                  </p>
                  <p class="mt-3 text-caption leading-5 text-muted-foreground">
                    只有这里列出的目标属于本题范围，题面文字不会自动扩权。
                  </p>
                </section>

                <section class="rounded-xl border border-border bg-card p-5">
                  <h2 class="text-label font-medium">可验证进度</h2>
                  <dl class="mt-4 space-y-3 text-body">
                    <div class="flex items-center justify-between">
                      <dt class="text-muted-foreground">实验</dt>
                      <dd class="font-mono">{{ activeProjection.experiments.length }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="text-muted-foreground">证据</dt>
                      <dd class="font-mono">{{ activeProjection.evidence.length }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="text-muted-foreground">制品</dt>
                      <dd class="font-mono">{{ activeProjection.artifacts.length }}</dd>
                    </div>
                    <div class="flex items-center justify-between">
                      <dt class="text-muted-foreground">平台回执</dt>
                      <dd class="font-mono">{{ activeProjection.judgeReceipts.length }}</dd>
                    </div>
                    <div class="flex items-center justify-between border-t border-border pt-3">
                      <dt class="text-muted-foreground">Judge</dt>
                      <dd class="font-mono">{{ verdictLabel(activeProjection.evaluations.at(-1)?.verdict) }}</dd>
                    </div>
                  </dl>
                </section>

                <section class="rounded-xl border border-border bg-card p-5">
                  <h2 class="flex items-center gap-2 text-label font-medium">
                    <Flag class="size-4" />
                    提交闸门
                  </h2>
                  <p class="mt-1 text-caption leading-5 text-muted-foreground">
                    {{
                      isArenaWorkspace
                        ? '由 Arena API 判题；错误次数受平台限制。'
                        : isCTFShowWorkspace
                          ? '通过已绑定的 CTFshow 标签页提交；只有平台回执能完成任务。'
                        : isWebWorkspace
                          ? '通过已绑定的 Chrome 标签页提交；只有 NSSCTF 回执能完成任务。'
                          : '复制到外部平台提交，再回来记录结果。'
                    }}
                  </p>
                  <p v-if="activeStartCost" class="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-caption leading-5">
                    NSSCTF 仍显示“开启环境”（{{ activeStartCost }} 金币）。请先在平台页面亲自开启；
                    MilkSU 不会自动扣币。开启后点击上方“检测连接”。
                  </p>
                  <Input v-model="flagCandidate" class="mt-4 font-mono" placeholder="flag{...}" />
                  <Alert v-if="matchingSubmissionMessage" class="mt-3">
                    <RotateCcw class="size-4" />
                    <AlertDescription>{{ matchingSubmissionMessage }}</AlertDescription>
                  </Alert>
                  <div
                    v-if="activeAgentCandidate && !activeProjection.submissions.length"
                    class="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-caption leading-5"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium">PI 候选已载入</span>
                      <Badge
                        :variant="activeAgentCandidate.assessment.status === 'unusual' ? 'destructive' : 'secondary'"
                      >
                        {{ activeAgentCandidate.assessment.status === 'unusual' ? '格式需要确认' : '格式正常' }}
                      </Badge>
                    </div>
                    <p class="mt-1 line-clamp-4 text-muted-foreground">
                      {{ activeAgentCandidate.explanation }}
                    </p>
                    <ul
                      v-if="activeAgentCandidate.assessment.warnings.length"
                      class="mt-2 space-y-1 border-t border-border pt-2 text-destructive"
                    >
                      <li
                        v-for="warning in activeAgentCandidate.assessment.warnings"
                        :key="warning"
                        class="flex items-start gap-1.5"
                      >
                        <Circle class="mt-1 size-2 shrink-0 fill-current" />
                        <span>{{ warning }}</span>
                      </li>
                    </ul>
                    <p class="mt-2 text-muted-foreground">
                      {{
                        activeStartCost
                          ? '这只是格式检查；请先亲自开启题目，平台提交入口可用后才能进入 Judge 闸门。'
                          : '这只是格式检查；点击提交后才会进入平台 Judge 闸门。'
                      }}
                    </p>
                  </div>
                  <Button
                    block
                    class="mt-2"
                    :loading="working"
                    :disabled="!flagCandidate.trim()
                      || !canContinue
                      || matchingSubmissionBlocks
                      || (isWebWorkspace && !activeBrowserCanSubmit)
                      || (isCTFShowWorkspace && !ctfshowBridgeReady)"
                    @click="submitCandidate"
                  >
                    <Send class="size-4" />
                    {{
                      isWebWorkspace && activeStartCost
                        ? '等待你在 NSSCTF 开启题目'
                        : isCTFShowWorkspace
                          ? '提交到 CTFshow'
                        : isWebWorkspace
                          ? '提交到 NSSCTF'
                          : '提交候选'
                    }}
                  </Button>

                  <div v-if="activeProjection.judgeReceipts.length" class="mt-4 rounded-lg bg-muted/50 p-3">
                    <div class="flex items-center justify-between gap-3 text-caption">
                      <span class="font-medium">最新 Judge 回执</span>
                      <Badge variant="outline">{{ activeProjection.judgeReceipts.at(-1)?.status }}</Badge>
                    </div>
                    <MarkdownContent
                      class="mt-2 line-clamp-3 text-caption leading-5 text-muted-foreground"
                      :content="activeProjection.judgeReceipts.at(-1)?.summary ?? ''"
                      compact
                    />
                  </div>

                  <div
                    v-if="platformReview && (!isWebWorkspace || activeProjection.evaluations.at(-1)?.verdict === 'inconclusive')"
                    class="mt-4 border-t border-border pt-4"
                  >
                    <p class="text-caption font-medium">{{ externalJudgeLabel }}的结果是？</p>
                    <div class="mt-3 flex gap-2">
                      <Button variant="outline" class="flex-1" @click="recordPlatformResult(false)">
                        <RotateCcw class="size-4" />
                        Rejected
                      </Button>
                      <Button class="flex-1" @click="recordPlatformResult(true)">
                        <Check class="size-4" />
                        Accepted
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <Alert v-if="outcomeNotice" class="mt-5">
              <Check class="size-4" />
              <AlertDescription>{{ outcomeNotice }}</AlertDescription>
            </Alert>

            <section class="mt-8 border-t border-border pt-5">
              <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-caption text-muted-foreground">
                <span class="flex items-center gap-1.5"><GraduationCap class="size-3.5" />提示 {{ activeProjection.humanOutcome.hintCount }}</span>
                <span class="flex items-center gap-1.5"><Users class="size-3.5" />独立步骤 {{ activeProjection.humanOutcome.independentSteps }}</span>
                <span class="flex items-center gap-1.5"><ShieldCheck class="size-3.5" />证据只保存在本机</span>
              </div>
            </section>
          </template>

          <div v-else class="rounded-xl border border-border bg-card px-6 py-16 text-center">
            <LoaderCircle v-if="backend.loading.value" class="mx-auto size-5 animate-spin text-muted-foreground" />
            <template v-else>
              <Bot class="mx-auto size-6 text-muted-foreground" />
              <p class="mt-4 text-label font-medium">工作台还没有任务</p>
              <Button class="mt-5" @click="showSource">选择一道题</Button>
            </template>
          </div>
        </section>
      </div>
    </div>
    <CTFManualIntake
      ref="manualIntake"
      :loading="working"
      :error="backend.error.value ?? ''"
      @submit="startManualChallenge"
    />
  </main>
</template>
