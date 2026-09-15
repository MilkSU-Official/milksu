import { useStoreRuntime } from '@/lib/reactStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
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
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import {
  ArrowLeft,
  Cable,
  Check,
  Circle,
  Clock3,
  ExternalLink,
  FileSearch,
  Flag,
  Library,
  LoaderCircle,
  Target,
} from 'lucide-react'
import CTFArtifacts from '@/components/CTFArtifacts'
import CTFChallengeDesk from '@/components/CTFChallengeDesk'
import CTFDebrief from '@/components/CTFDebrief'
import CTFEndpointAuthorization from '@/components/CTFEndpointAuthorization'
import CTFManualIntake, { type CTFManualIntakeHandle } from '@/components/CTFManualIntake'
import CTFMemoryRecall from '@/components/CTFMemoryRecall'
import CTFSubmissionGate from '@/components/CTFSubmissionGate'
import CTFTrainingArchive from '@/components/CTFTrainingArchive'
import CTFTrajectory from '@/components/CTFTrajectory'
import CTFWorkspaceHeader from '@/components/CTFWorkspaceHeader'
import CollectionViewFilter from '@/components/CollectionViewFilter'
import ConnectionLiveStatus from '@/components/ConnectionLiveStatus'
import ConversationDock from '@/components/ConversationDock'
import MarkdownContent from '@/components/MarkdownContent'
import WorkspaceCatalogActions, { type WorkspaceCatalogActionsHandle } from '@/components/WorkspaceCatalogActions'
import WorkspaceCatalogHistoryItem from '@/components/WorkspaceCatalogHistoryItem'
import WorkspaceImportDialog from '@/components/WorkspaceImportDialog'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
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
import { debugLog, updateDebugState } from '@/lib/debugMode'
import {
  ctfManualStatusFromJobStatus,
  ctfManualStatusLabel,
  type CTFManualStatus,
} from '@/lib/ctfManualStatus'
import { deriveCTFWorkspacePresentation } from '@/lib/ctfWorkspacePresentation'
import { useT } from '@/hooks/useUiLocale'
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
import type { NSSCTFCatalogProblem, NSSCTFDailyChallengeSelection } from '@/nssctfTrainingTypes'
import type { Conversation } from '@/types'
import type { CodingAgentSendArgs, CodingAgentSurfaceBind } from '@/lib/codingAgentSurface'

type Screen = 'challenge' | 'detail' | 'workspace'
type QuestionBank = Extract<CTFTrainingPlatform['id'], 'nssctf' | 'ctfshow'>
type TrainingSource = CTFTrainingPlatform['id']

function catalogDifficultyLabel(value: number, t: (zh: string, en: string) => string) {
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

export default function CTFPage({
  modelReady,
  modelVerified,
  arenaReady,
  initialJobId,
  catalogEpoch = 0,
  ctfSection,
  conversations = [],
  conversation = null,
  running = false,
  aborting = false,
  abortStalled = false,
  settings = null,
  workspacePath = '',
  messageQueue,
  sessionReady = false,
  resumed = false,
  compacting = false,
  compactedAt,
  compactionError,
  turnStatus,
  ctfSession = false,
  vulnerabilitySession = false,
  ctfMode,
  ctfRole,
  modelMode,
  modelProvider,
  modelId,
  modelSourcePreference,
  executionMode,
  approvalPolicy,
  mcpServers = [],
  mcpConfigDigest,
  pendingComposerDraft = null,
  ensureConversation = () => '',
  chatMaximized = false,
  chatDockOpen = true,
  onOpenSettings,
  onStartCodingAgent,
  onOpenCodingConversation,
  onSend,
  onAbort,
  onSelectConversation,
  onCreateConversation: _onCreateConversation,
  onExpand,
  onCloseDock,
  onConsumePendingDraft,
  onCtfAction,
  onCompactContext,
  onRewindContext,
  onHandoffContext,
  onControlGoal,
  onRespondApproval,
  onChangeModel,
  onChangeModelSource,
  onChangeCodingPolicy,
  onChangeMcpServers,
  onChooseWorkspace,
  onChooseWorkspaceForNewTask,
  onSelectWorkspace,
  onForgetWorkspace,
  onClearWorkspace,
  onCancelQueuedGuidance,
  onEditQueuedGuidance,
}: CodingAgentSurfaceBind & {
  modelReady: boolean
  modelVerified: boolean
  arenaReady: boolean
  initialJobId?: string | null
  catalogEpoch?: number
  ctfSection: CTFWorkspaceSection
  conversations?: Conversation[]
  conversation?: Conversation | null
  ensureConversation?: (title?: string) => string
  chatMaximized?: boolean
  chatDockOpen?: boolean
  onOpenSettings?: (category?: 'apikeys' | 'browser') => void
  onStartCodingAgent?: (handoff: CTFAgentWorkspaceHandoff) => void
  onOpenCodingConversation?: (id: string) => void
  onSend?: (...args: CodingAgentSendArgs) => void
  onAbort?: () => void
  onSelectConversation?: (id: string) => void
  onCreateConversation?: () => void
  onExpand?: () => void
  onCloseDock?: () => void
  onConsumePendingDraft?: () => void
  onCtfAction?: (action: import('@/types').CTFChatAction) => void
  onCompactContext?: () => void
  onRewindContext?: () => void
  onHandoffContext?: () => void
  onControlGoal?: (action: 'pause' | 'resume' | 'clear') => void
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onChangeModel?: (mode: 'auto' | 'manual', provider?: string, model?: string) => void
  onChangeModelSource?: (preference: 'auto' | 'account' | 'personal') => void
  onChangeCodingPolicy?: (
    executionMode: NonNullable<CodingAgentSurfaceBind['executionMode']>,
    approvalPolicy: NonNullable<CodingAgentSurfaceBind['approvalPolicy']>,
  ) => void
  onChangeMcpServers?: (servers: string[], configDigest: string) => void
  onChooseWorkspace?: () => void
  onChooseWorkspaceForNewTask?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
  onCancelQueuedGuidance?: (index: number) => void
  onEditQueuedGuidance?: (index: number) => void
}) {
  const t = useT()
  const backend = useStoreRuntime(() => useCTFWorkspace())
  const platformRegistry = useStoreRuntime(() => useCTFTrainingPlatforms())
  const publicProblems = useStoreRuntime(() => useNSSCTFChallenges())
  const arena = useStoreRuntime(() => useNSSCTFArena())
  const webBridge = useStoreRuntime(() => useNSSCTFWebBridge())
  const training = useStoreRuntime(() => useNSSCTFTraining())
  const publicCatalog = useStoreRuntime(() => useNSSCTFCatalog())
  const ctfshow = useStoreRuntime(() => useCTFShowCatalog())
  const ctfCollections = useStoreRuntime(() => createItemCollectionStore('milksu.ctf.collections.v1'))

  const jobs = backend.jobs
  const projection = backend.projection
  const agentBudget = backend.agentBudget
  const agentRun = backend.agentRun
  const backendLoading = backend.loading
  const backendError = backend.error
  const platforms = platformRegistry.platforms
  const publicProblemsError = publicProblems.error
  const arenaError = arena.error
  const arenaWorkspace = arena.workspace
  const webBridgeStatus = webBridge.status
  const webBridgeError = webBridge.error
  const trainingDashboard = training.dashboard
  const trainingError = training.error
  const trainingSyncing = training.syncing
  const catalogResult = publicCatalog.result
  const catalogLoading = publicCatalog.loading
  const catalogError = publicCatalog.error
  const ctfshowStatus = ctfshow.status
  const ctfshowLoading = ctfshow.loading
  const ctfshowError = ctfshow.error
  const collectionRevision = ctfCollections.revision

  const storedTrainingSource = window.localStorage.getItem('milksu.ctf.question-bank')
  const storedCollaborationMode = window.localStorage.getItem('milksu.ctf.collaboration-mode')
  const [screen, setScreen] = useState<Screen>('challenge')
  const [activeBank, setActiveBank] = useState<TrainingSource>(
    storedTrainingSource === 'ctfshow' || storedTrainingSource === 'hackthebox' || storedTrainingSource === 'tryhackme'
      ? storedTrainingSource
      : 'nssctf',
  )
  const [collaborationMode, setCollaborationMode] = useState<CTFCollaborationMode>(
    storedCollaborationMode === 'coach' || storedCollaborationMode === 'copilot' || storedCollaborationMode === 'delegate'
      ? storedCollaborationMode
      : 'copilot',
  )
  const [flagCandidate, setFlagCandidate] = useState('')
  const [platformReview, setPlatformReview] = useState(false)
  const [outcomeNotice, setOutcomeNotice] = useState('')
  const [catalogNotice, setCatalogNotice] = useState('')
  const [catalogBootstrapAttempted, setCatalogBootstrapAttempted] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [localMaterials, setLocalMaterials] = useState<CTFMaterialRequest[]>([])
  const [working, setWorking] = useState(false)
  const [manualCreating, setManualCreating] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState('all')
  const [catalogPage, setCatalogPage] = useState(1)
  const [ctfshowQuery, setCtfshowQuery] = useState('')
  const [ctfshowCategory, setCtfshowCategory] = useState('all')
  const [ctfshowPage, setCtfshowPage] = useState(1)
  const [recalledMemories, setRecalledMemories] = useState<CTFTrainingMemory[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [collectionView, setCollectionView] = useState(ALL_COLLECTIONS_ID)
  const [manualStatuses, setManualStatuses] = useState<Record<string, CTFManualStatus>>(() => {
    try {
      const value = JSON.parse(window.localStorage.getItem('milksu.ctf.manual-statuses') || '{}')
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  })
  const [dailyChallenge, setDailyChallenge] = useState<NSSCTFCatalogProblem | null>(null)
  const [dailyChallengeReason, setDailyChallengeReason] = useState('')
  const [selectedProblem, setSelectedProblem] = useState<NSSCTFChallenge | null>(null)
  const [selectedCTFShowProblemID, setSelectedCTFShowProblemID] = useState<number | null>(null)
  const catalogPageSize = 20
  const ctfshowPageSize = 20
  const catalogActions = useRef<WorkspaceCatalogActionsHandle | null>(null)
  const conversationDock = useRef<{ revealAndFocus: () => Promise<void> } | null>(null)
  const manualIntake = useRef<CTFManualIntakeHandle | null>(null)
  const workspaceScrollArea = useRef<HTMLDivElement | null>(null)
  const catalogSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dailyChallengeLoading = useRef(false)
  const mountedRef = useRef(false)

  const activeProjection = projection
  const isArenaWorkspace = activeProjection?.challenge.externalPlatform === 'nssctf-agent-arena'
  const isWebWorkspace = activeProjection?.challenge.externalPlatform === 'nssctf-web'
  const isCTFShowWorkspace = activeProjection?.challenge.externalPlatform === 'ctfshow-web'
  const externalJudgeLabel = (() => {
    switch (activeProjection?.challenge.source.kind) {
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
  })()
  const arenaAttempt = arenaWorkspace?.arena.attempt
  const selectedBrowserPage = webBridgeStatus?.pages.find(page => page.nssctf.problemId === selectedProblem?.platformId)
  const activeBrowserPage = webBridgeStatus?.pages.find(page => page.nssctf.problemId === activeProjection?.challenge.externalAttemptId)
  const selectedBrowserReady = Boolean(selectedBrowserPage?.connected)
  const activeBrowserReady = Boolean(activeBrowserPage?.connected)
  const selectedBrowserCanSubmit = Boolean(selectedBrowserPage?.connected && selectedBrowserPage.nssctf.canSubmit && !selectedBrowserPage.nssctf.needsStart)
  const activeBrowserCanSubmit = Boolean(activeBrowserPage?.connected && activeBrowserPage.nssctf.canSubmit && !activeBrowserPage.nssctf.needsStart)
  const ctfshowBridgeReady = Boolean(ctfshowStatus?.pages.some(page => page.connected))
  const browserBridge = webBridgeStatus?.bridge ?? ctfshowStatus?.bridge ?? null
  const browserBridgeConnected = Boolean(browserBridge?.connected)
  const selectedCatalogReady = activeBank === 'nssctf'
    ? Boolean(trainingDashboard?.catalogTotal)
    : Boolean(ctfshowStatus?.catalog.total)
  const selectedJudgeReady = activeBank === 'nssctf' ? selectedBrowserCanSubmit : ctfshowBridgeReady
  const selectedActiveJob = (() => {
    const selectedID = activeBank === 'nssctf' ? selectedProblem?.platformId : selectedCTFShowProblemID
    const platform = activeBank === 'nssctf' ? 'nssctf-web' : 'ctfshow-web'
    if (!selectedID) return null
    return jobs.find(job => job.externalPlatform === platform && job.externalAttemptId === selectedID && !['succeeded', 'failed', 'cancelled'].includes(job.status)) ?? null
  })()
  const selectedCatalogJob = (() => {
    const selectedID = activeBank === 'nssctf' ? selectedProblem?.platformId : selectedCTFShowProblemID
    const platform = activeBank === 'nssctf' ? 'nssctf-web' : 'ctfshow-web'
    if (!selectedID) return null
    return jobs.find(job => job.externalPlatform === platform && job.externalAttemptId === selectedID) ?? null
  })()

  function updateManualStatus(key: string, status: CTFManualStatus) {
    const next = { ...manualStatuses, [key]: status }
    setManualStatuses(next)
    window.localStorage.setItem('milksu.ctf.manual-statuses', JSON.stringify(next))
  }

  function manualStatusForJob(job: Pick<CTFSummary, 'id' | 'status'>): CTFManualStatus {
    return manualStatuses[`job:${job.id}`] ?? ctfManualStatusFromJobStatus(job.status)
  }

  const activeStartCost = activeBrowserPage?.nssctf.needsStart ? activeBrowserPage.nssctf.startCost ?? 0 : 0
  const canContinue = Boolean(activeProjection && !['succeeded', 'failed', 'cancelled'].includes(activeProjection.job.status ?? ''))
  const hasAgentRecoveryPoint = Boolean(agentRun && (
    agentRun.status !== 'ready' || agentRun.metrics.eventCount > 0 || agentRun.candidateCount > 0 || agentRun.lastAssistantSummary
  ))
  const agentActionLabel = t('开始解题', 'Start solving')
  const agentBudgetStopMessage = (() => {
    if (!agentBudget?.exhausted) return ''
    switch (agentBudget.reason) {
      case 'turn-budget-exhausted':
        return t(`已用完 ${agentBudget.budget.maxTurns} 个 PI 回合。先复盘当前轨迹，再从题库建立一次新的受控训练。`, `${agentBudget.budget.maxTurns} PI turns used. Debrief the current trajectory, then start a new controlled session from the catalog.`)
      case 'time-budget-exhausted':
        return t(`本次训练已达到 ${agentBudget.budget.maxWallMinutes} 分钟。先记录关键转折，再决定是否重新开始。`, `This session reached ${agentBudget.budget.maxWallMinutes} minutes. Record the key turns, then decide whether to start again.`)
      case 'wrong-submission-budget-exhausted':
        return t(`已经出现 ${agentBudget.budget.maxWrongSubmissions} 次平台 Rejected。MilkSU 已停止继续盲试。`, `${agentBudget.budget.maxWrongSubmissions} platform Rejected results already. MilkSU has stopped further blind attempts.`)
      default:
        return t('本次 PI 训练预算已停止；请先复盘，再由你决定下一次尝试。', 'This PI training budget has stopped. Debrief first, then decide the next attempt.')
    }
  })()
  const workspacePresentation = activeProjection
    ? deriveCTFWorkspacePresentation({
        terminal: !canContinue,
        hasAgentRecoveryPoint,
        experimentCount: activeProjection.experiments.length,
        evidenceCount: activeProjection.evidence.length,
        artifactCount: activeProjection.artifacts.length,
        agentRunCount: activeProjection.agentRuns.length,
        agentCandidateCount: activeProjection.agentCandidates.length,
        submissionCount: activeProjection.submissions.length,
        judgeReceiptCount: activeProjection.judgeReceipts.length,
        evaluationCount: activeProjection.evaluations.length,
        learningCount: activeProjection.learning.length,
        hintCount: activeProjection.humanOutcome.hintCount,
        reflectionCount: activeProjection.humanOutcome.reflectionCount,
        independentStepCount: activeProjection.humanOutcome.independentSteps,
        endpointRequestStatuses: activeProjection.endpointRequests.map(request => request.status),
        candidate: flagCandidate,
        platformReview,
      })
    : null
  const remainingAgentTurns = agentBudget?.remainingTurns ?? activeProjection?.challenge.agentPolicy.budget.maxTurns ?? 0
  const remainingAgentMinutes = Math.ceil((agentBudget?.remainingWallSeconds ?? (activeProjection?.challenge.agentPolicy.budget.maxWallMinutes ?? 0) * 60) / 60)
  const remainingWrongSubmissions = agentBudget?.remainingWrongSubmissions ?? activeProjection?.challenge.agentPolicy.budget.maxWrongSubmissions ?? 0
  const activeQuestionBank: QuestionBank | null = activeBank === 'nssctf' || activeBank === 'ctfshow' ? activeBank : null
  const visibleTrainingPlatforms = platforms.filter(platform => platform.selectable && platform.status === 'ready')
  const activeCatalogBank: QuestionBank = activeBank === 'ctfshow' ? 'ctfshow' : 'nssctf'
  const activeExternalPlatform = platforms.find(platform => platform.id === activeBank) ?? null
  const activeSourceName = activeExternalPlatform?.name ?? t('选择训练平台', 'Choose a training platform')
  const externalPlatformStatusLabel = activeExternalPlatform?.status === 'planned'
    ? t('接入中', 'Connecting')
    : activeExternalPlatform?.status === 'restricted'
      ? t('受官方接口限制', 'Limited by official API')
      : t('可用', 'Available')
  const externalPlatformSummary = activeExternalPlatform?.id === 'hackthebox'
    ? t('HTB Labs 目前仅支持人工训练入口。', 'HTB Labs currently supports a human training entry only.')
    : activeExternalPlatform?.id === 'tryhackme'
      ? t('TryHackMe 个人版暂无完整 API，需 Business / Classroom。', 'The TryHackMe personal plan has no complete API; Business / Classroom is required.')
      : t('该平台正在接入统一题库与 Judge。', 'This platform is being connected to the shared catalog and Judge.')
  const capabilityLabels: Record<string, string> = {
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
  const externalPlatformCapabilities = (activeExternalPlatform?.capabilities ?? []).map(value => capabilityLabels[value] ?? value)
  const ctfshowProblems = ctfshowStatus?.catalog.problems ?? []
  const selectedCTFShowProblem = ctfshowProblems.find(problem => problem.platformId === selectedCTFShowProblemID) ?? null
  const ctfshowCategories = [...new Set(ctfshowProblems.map(problem => problem.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const filteredCTFShowProblems = useMemo(() => {
    const query = ctfshowQuery.trim().toLowerCase()
    const normalizedID = query.replace(/^#/i, '')
    const allowed = collectionView === ALL_COLLECTIONS_ID ? null : new Set(ctfCollections.itemKeysFor(collectionView))
    return ctfshowProblems.filter(problem => {
      if (allowed && !allowed.has(`ctfshow:${problem.platformId}`)) return false
      if (ctfshowCategory !== 'all' && problem.category !== ctfshowCategory) return false
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
  }, [ctfshowProblems, ctfshowQuery, ctfshowCategory, collectionView, collectionRevision, ctfCollections])
  const ctfshowPageCount = Math.max(1, Math.ceil(filteredCTFShowProblems.length / ctfshowPageSize))
  const visibleCTFShowProblems = filteredCTFShowProblems.slice((ctfshowPage - 1) * ctfshowPageSize, ctfshowPage * ctfshowPageSize)
  const deskQuery = activeBank === 'ctfshow' ? ctfshowQuery : catalogQuery
  const deskCategory = activeBank === 'ctfshow' ? ctfshowCategory : catalogCategory
  const deskCategories = activeBank === 'ctfshow' ? ctfshowCategories : catalogResult?.categories ?? []
  const deskProblemTotal = activeBank === 'ctfshow' ? filteredCTFShowProblems.length : catalogResult?.total ?? trainingDashboard?.catalogTotal ?? 0
  const deskPage = activeBank === 'ctfshow' ? ctfshowPage : catalogPage
  const deskPageCount = activeBank === 'ctfshow' ? ctfshowPageCount : Math.max(catalogResult?.pageCount ?? 0, 1)
  const deskLoading = working || (activeBank === 'ctfshow' ? ctfshowLoading : catalogLoading)
  const deskLoadingTitle = activeBank === 'ctfshow'
    ? t('正在检查 CTFshow 连接', 'Checking CTFshow connection')
    : trainingSyncing
      ? t('正在首次同步 NSSCTF 公开题库', 'First sync of the NSSCTF public catalog')
      : t('正在读取 NSSCTF 本地题库', 'Reading the local NSSCTF catalog')
  const deskLoadingDetail = activeBank === 'ctfshow'
    ? t('在 CTFshow 题库页打开 MilkSU 扩展以同步题目。', 'Open the MilkSU extension on a CTFshow catalog page to sync challenges.')
    : trainingSyncing
      ? t('正在同步 NSSCTF 公开题库', 'Syncing the NSSCTF public catalog')
      : ''
  const deskEmptyTitle = (deskQuery.trim() || deskCategory !== 'all') ? t('没有匹配题目', 'No matching challenges') : ''
  const catalogErrorMessage = (activeBank === 'nssctf' ? catalogError ?? trainingError : ctfshowError)
    ? t('题库暂时没有同步成功，请稍后重试。', 'The catalog did not sync. Try again later.')
    : ''
  const dailyChallengeVisible = activeBank === 'nssctf' && catalogQuery.trim() === '' && catalogCategory === 'all' && collectionView === ALL_COLLECTIONS_ID
    ? dailyChallenge
    : null
  const visibleSelectedNssctf = selectedProblem
    ? collectionView === ALL_COLLECTIONS_ID || ctfCollections.has(`nssctf:${selectedProblem.platformId}`, collectionView)
      ? selectedProblem
      : null
    : null

  async function loadPublicCatalog(page = catalogPage) {
    const problemIds = collectionView === ALL_COLLECTIONS_ID
      ? undefined
      : ctfCollections.itemKeysFor(collectionView)
          .filter(key => key.startsWith('nssctf:'))
          .map(key => Number(key.slice('nssctf:'.length)))
          .filter(Number.isFinite)
    const started = Date.now()
    const result = await publicCatalog.search({
      query: catalogQuery,
      category: catalogCategory,
      page,
      pageSize: catalogPageSize,
      problemIds,
    })
    debugLog('load-catalog', `page=${page} view=${collectionView}`, Date.now() - started)
    updateDebugState({
      view: collectionView,
      selectedPlatformId: selectedProblem?.platformId ?? null,
      collectionProblems: problemIds ? problemIds.length : 0,
    })
    if (result) setCatalogPage(result.page)
  }

  async function syncCatalog() {
    setCatalogNotice('')
    const result = await training.sync()
    if (result) {
      setCatalogNotice(t(`已把 ${result.total} 道公开题目更新到本地题库。`, `Updated ${result.total} public challenges into the local catalog.`))
      if (screen === 'challenge' && !selectedProblem) await loadPublicCatalog(1)
    }
  }

  async function bootstrapNSSCTFCatalog() {
    if (!shouldBootstrapNSSCTFCatalog({
      activeBank,
      catalogTotal: trainingDashboard?.catalogTotal ?? 0,
      syncing: trainingSyncing,
      attempted: catalogBootstrapAttempted,
    })) return
    setCatalogBootstrapAttempted(true)
    await syncCatalog()
  }

  function dailyChallengeCandidates() {
    const candidates = [
      ...(trainingDashboard?.recommendations.map(item => item.problem) ?? []),
      ...(catalogResult?.problems ?? []),
    ]
    return [...new Map(candidates.map(problem => [problem.platformId, problem])).values()]
  }

  async function refreshDailyChallenge(change = false) {
    if (dailyChallengeLoading.current) return
    const dateKey = localCTFDateKey()
    const completedIds = catalogResult?.completedProblemIds ?? []
    const stored = parseCTFDailyChallengeRecord(window.localStorage.getItem(CTF_DAILY_CHALLENGE_STORAGE_KEY))
    if (!change && stored?.dateKey === dateKey && !completedIds.includes(stored.problem.platformId)) {
      setDailyChallenge(stored.problem)
      setDailyChallengeReason(stored.reason ?? t('根据今天的训练记录推荐。', 'Recommended from today’s training record.'))
      return
    }
    const excludedProblemIds = change && dailyChallenge
      ? [...completedIds, dailyChallenge.platformId]
      : completedIds
    let selection: NSSCTFDailyChallengeSelection | null = null
    dailyChallengeLoading.current = true
    try {
      selection = await invokeCommand<NSSCTFDailyChallengeSelection>('recommend_ctf_daily_challenge', {
        dateKey,
        excludedProblemIds,
      })
    } catch {
      const problem = chooseCTFDailyChallenge(dateKey, dailyChallengeCandidates(), completedIds, change ? dailyChallenge?.platformId : undefined)
      if (!problem) return
      const recommendation = trainingDashboard?.recommendations.find(item => item.problem.platformId === problem.platformId)
      selection = {
        dateKey,
        problem,
        reason: recommendation?.reason || t('根据当前训练记录，从未完成题目中优先选择。', 'Chosen from unfinished challenges based on the current training record.'),
        source: 'rules',
      }
    } finally {
      dailyChallengeLoading.current = false
    }
    setDailyChallenge(selection.problem)
    setDailyChallengeReason(selection.reason)
    window.localStorage.setItem(CTF_DAILY_CHALLENGE_STORAGE_KEY, JSON.stringify(selection))
  }

  async function loadMemoryContext(jobId: string) {
    setMemoryLoading(true)
    try {
      setRecalledMemories(await invokeCommand<CTFTrainingMemory[]>('get_ctf_memory_context', { id: jobId }))
    } catch {
      setRecalledMemories([])
    } finally {
      setMemoryLoading(false)
    }
  }

  async function resumeJob(id: string) {
    await backend.selectJob(id)
    setScreen('workspace')
  }

  async function resumeInitialJobIfNeeded(id: string | null | undefined) {
    if (!id) return
    if (screen === 'workspace' && activeProjection?.job.id === id) return
    await resumeJob(id)
  }

  function closeImport() {
    setShowImport(false)
    manualIntake.current?.reset()
  }

  function showProblems() {
    setSelectedProblem(null)
    setSelectedCTFShowProblemID(null)
    setLocalMaterials([])
    setAttachmentError('')
    setScreen('challenge')
    setOutcomeNotice('')
    if (activeBank === 'ctfshow') void ctfshow.refresh()
    else void loadPublicCatalog(1)
  }

  async function openCodingContext() {
    if (!activeProjection) return
    await backend.loadAgentState(activeProjection.job.id)
    setWorking(true)
    setOutcomeNotice('')
    try {
      const handoff = await invokeCommand<CTFAgentWorkspaceHandoff>('prepare_ctf_agent_workspace', {
        id: activeProjection.job.id,
      })
      backend.agentRun = handoff.run
      onStartCodingAgent?.(handoff)
    } catch (reason) {
      setOutcomeNotice(t(`无法打开 Coding 上下文：${String(reason)}`, `Could not open the Coding context: ${String(reason)}`))
    } finally {
      setWorking(false)
    }
  }

  async function revealConversationComposer() {
    await conversationDock.current?.revealAndFocus()
  }

  async function openCodingAgent() {
    if (!activeProjection) return
    await backend.loadAgentState(activeProjection.job.id)
    if (!modelReady) {
      await openCodingContext()
      setOutcomeNotice(t('已打开本题对话。配置模型后再发送。', 'Opened this challenge conversation. Configure a model before sending.'))
      await revealConversationComposer()
      return
    }
    await openCodingContext()
    await revealConversationComposer()
  }

  async function startPublicWorkspace() {
    if (!selectedProblem) return
    setWorking(true)
    setAttachmentError('')
    try {
      if (selectedActiveJob) {
        await resumeJob(selectedActiveJob.id)
        await openCodingAgent()
        return
      }
      const challenge = selectedProblem
      const materials: CTFMaterialRequest[] = [...localMaterials]
      let materialWarning = ''
      if (selectedBrowserReady) {
        try {
          materials.push(await invokeCommand<CTFMaterialRequest>('import_nssctf_web_page_material', { problemId: challenge.platformId }))
        } catch (reason) {
          materialWarning = reason instanceof Error ? reason.message : String(reason)
        }
      }
      if (challenge.hasAttachment) {
        if (!selectedBrowserReady && materials.length === 0) {
          materialWarning = t(`P${challenge.platformId} 的附件尚未导入；Coding 将先使用公开题面继续`, `The attachment for P${challenge.platformId} is not imported yet; Coding will continue with the public statement first`)
        }
        if (selectedBrowserReady) {
          try {
            materials.push(await invokeCommand<CTFMaterialRequest>('import_nssctf_web_attachment', { problemId: challenge.platformId }))
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
        collaborationMode,
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
        setAttachmentError(backend.error ?? t('无法建立 CTF 工作台。', 'Could not create the CTF workspace.'))
        return
      }
      if (materialWarning) {
        setOutcomeNotice(t(`${materialWarning}。工作台已使用公开题面和现有材料继续建立。`, `${materialWarning}. The workspace continued with the public statement and existing materials.`))
      }
      setScreen('workspace')
      await openCodingAgent()
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setWorking(false)
    }
  }

  async function chooseCTFShowProblem(problemId: number) {
    const activeJob = jobs.find(job => (
      job.externalPlatform === 'ctfshow-web'
      && job.externalAttemptId === problemId
      && !['succeeded', 'failed', 'cancelled'].includes(job.status)
    ))
    if (activeJob) {
      await resumeJob(activeJob.id)
      await openCodingAgent()
      return
    }
    setWorking(true)
    setOutcomeNotice('')
    try {
      const workspace = await ctfshow.importChallenge(problemId, collaborationMode, localMaterials)
      if (!workspace) return
      await backend.adoptProjection(workspace.ctf)
      setScreen('workspace')
      if (workspace.challenge.warnings.length) {
        setOutcomeNotice(t(`题目已建立工作区；导入提示：${workspace.challenge.warnings.join('；')}`, `Workspace created for the challenge; import notes: ${workspace.challenge.warnings.join('; ')}`))
      }
      await openCodingAgent()
    } finally {
      setWorking(false)
    }
  }

  async function openSelectedInCoding() {
    if (activeBank === 'ctfshow' && selectedCTFShowProblemID) {
      await chooseCTFShowProblem(selectedCTFShowProblemID)
      return
    }
    if (activeBank === 'nssctf') await startPublicWorkspace()
  }

  async function chooseSeriesProblem(platformId: number) {
    setLocalMaterials([])
    setAttachmentError('')
    const challenge = await publicProblems.importChallenge(String(platformId))
    if (challenge) setSelectedProblem(challenge)
  }

  async function chooseCatalogProblem(platformId: number) {
    setSelectedCTFShowProblemID(null)
    await chooseSeriesProblem(platformId)
    setScreen('detail')
  }

  function previewCTFShowProblem(problemId: number) {
    setSelectedProblem(null)
    setSelectedCTFShowProblemID(problemId)
    setLocalMaterials([])
    setAttachmentError('')
    setScreen('detail')
  }

  async function openProblem() {
    if (!selectedProblem) return
    await invokeCommand('open_nssctf_challenge', { url: selectedProblem.sourceUrl })
  }

  async function openActiveChallenge() {
    const sourceURI = activeProjection?.challenge.source.uri
    if (!activeProjection || !sourceURI) return
    if (activeProjection.challenge.externalPlatform === 'nssctf-web') {
      await invokeCommand('open_nssctf_challenge', { url: sourceURI })
      return
    }
    await invokeCommand('open_ctf_source_url', { url: sourceURI })
  }

  async function openExternalPlatform() {
    if (!activeExternalPlatform) return
    const sourceUrl = activeExternalPlatform.id === 'hackthebox'
      ? 'https://app.hackthebox.com/machines'
      : activeExternalPlatform.id === 'tryhackme'
        ? 'https://tryhackme.com/hacktivities'
        : activeExternalPlatform.sourceUrl
    await invokeCommand('open_ctf_source_url', { url: sourceUrl })
  }

  async function refreshCTFShow() {
    setCatalogNotice('')
    const result = await ctfshow.refresh()
    if (result?.catalog.total) {
      setCatalogNotice(t(`CTFshow 本地题库：${result.catalog.total} 题`, `CTFshow local catalog: ${result.catalog.total} challenges`))
    }
  }

  async function startManualChallenge(request: CTFChallengeRequest) {
    setManualCreating(true)
    setOutcomeNotice('')
    try {
      const started = await backend.startChallenge(request)
      if (!started) return
      closeImport()
      setScreen('workspace')
    } finally {
      setManualCreating(false)
    }
  }

  async function requestEndpoint(request: CTFEndpointRequestInput) {
    if (!activeProjection) return
    setWorking(true)
    setOutcomeNotice('')
    try {
      const next = await invokeCommand<CTFProjection>('request_ctf_endpoint', { id: activeProjection.job.id, request })
      await backend.adoptProjection(next)
      setOutcomeNotice(t('已记录申请', 'Request recorded'))
    } catch (reason) {
      setOutcomeNotice(t(`无法记录 Endpoint 申请：${String(reason)}`, `Could not record the Endpoint request: ${String(reason)}`))
    } finally {
      setWorking(false)
    }
  }

  async function approveEndpoint(requestId: string) {
    if (!activeProjection) return
    setWorking(true)
    setOutcomeNotice('')
    try {
      const next = await invokeCommand<CTFProjection>('approve_ctf_endpoint', { id: activeProjection.job.id, requestId })
      await backend.adoptProjection(next)
      setOutcomeNotice(t('已为这一项生成独立 Scope。旧的 Agent 工具会话已关闭；恢复 Agent 后只加载新的精确协议权限，Shell 仍然禁网。', 'Created an independent Scope for this item. The previous Agent tool session is closed; resume the Agent to load only the new exact-protocol permission. Shell stays offline.'))
    } catch (reason) {
      setOutcomeNotice(t(`无法批准 Endpoint：${String(reason)}`, `Could not approve the Endpoint: ${String(reason)}`))
      await backend.selectJob(activeProjection.job.id)
    } finally {
      setWorking(false)
    }
  }

  async function denyEndpoint(requestId: string) {
    if (!activeProjection) return
    setWorking(true)
    setOutcomeNotice('')
    try {
      const next = await invokeCommand<CTFProjection>('deny_ctf_endpoint', { id: activeProjection.job.id, requestId })
      await backend.adoptProjection(next)
      setOutcomeNotice(t('已拒绝这一项；没有创建 Scope，也没有启用网络工具。', 'Denied this item; no Scope was created and network tools stay disabled.'))
    } catch (reason) {
      setOutcomeNotice(t(`无法拒绝 Endpoint：${String(reason)}`, `Could not deny the Endpoint: ${String(reason)}`))
    } finally {
      setWorking(false)
    }
  }

  async function sendDebriefReflection(content: string) {
    if (!activeProjection || !content.trim()) return
    setWorking(true)
    const recorded = await backend.recordLearning(activeProjection.job.id, {
      kind: 'reflection',
      content: content.trim(),
      concept: t('CTF 解题复盘', 'CTF solving debrief'),
    })
    if (recorded) setOutcomeNotice(t('复盘已保存；现在可以沉淀为可复用技法。', 'Debrief saved; you can now save it as a reusable technique.'))
    setWorking(false)
  }

  async function sendIndependentStep(content: string) {
    if (!activeProjection || !content.trim()) return
    setWorking(true)
    const recorded = await backend.recordLearning(activeProjection.job.id, {
      kind: 'independent_step',
      content: content.trim(),
      concept: t('用户确认的解题步骤', 'User-confirmed solving step'),
    })
    if (recorded) {
      setOutcomeNotice(activeProjection?.humanOutcome.contribution.assistance === 'none'
        ? t('已记录为有明确用户证据的独立步骤。', 'Recorded as an independent step with explicit user evidence.')
        : t('已记录用户实际完成的步骤，并保留本次协助方式。', 'Recorded the step you actually completed, keeping this assistance mode.'))
    }
    setWorking(false)
  }

  async function refreshTrainingProgress() {
    await training.load()
    if (activeBank === 'nssctf') {
      await publicCatalog.refreshProgress()
      await loadPublicCatalog(catalogPage)
    }
  }

  async function saveTrainingMemory() {
    if (!activeProjection) return
    setWorking(true)
    try {
      await invokeCommand('save_ctf_training_memory', { id: activeProjection.job.id })
      await loadMemoryContext(activeProjection.job.id)
      setOutcomeNotice(t('已保存为本机可复用技法；以后同分类题会把它作为待验证先验交给 Agent。', 'Saved as a local reusable technique. Future challenges in the same category will pass it to the Agent as a prior pending verification.'))
    } catch (reason) {
      setOutcomeNotice(t(`无法保存训练记忆：${String(reason)}`, `Could not save training memory: ${String(reason)}`))
    } finally {
      setWorking(false)
    }
  }

  async function archiveTrainingMemory(memory: CTFTrainingMemory) {
    if (!activeProjection) return
    setWorking(true)
    try {
      await invokeCommand('archive_ctf_memory', {
        id: memory.id,
        reason: t(`用户在 ${activeProjection.challenge.title} 的记忆上下文中停用`, `Disabled by the user in the memory context of ${activeProjection.challenge.title}`),
      })
      await loadMemoryContext(activeProjection.job.id)
      setOutcomeNotice(t('这条综合记忆已停用；原始训练轨迹和证据仍保留。', 'This synthesized memory is disabled; the original training trajectory and evidence remain.'))
    } catch (reason) {
      setOutcomeNotice(t(`无法停用训练记忆：${String(reason)}`, `Could not disable training memory: ${String(reason)}`))
    } finally {
      setWorking(false)
    }
  }

  function inspectTrainingMemoryEvidence(evidence: CTFTrainingMemoryEvidenceLink) {
    setOutcomeNotice(t(`正在核对记忆证据 ${evidence.kind}:${evidence.id}。请以当前题目证据、Judge 回执、提示和步骤记录为准，不把旧题记忆直接当作用户能力事实。`, `Checking memory evidence ${evidence.kind}:${evidence.id}. Treat current challenge evidence, Judge receipts, hints, and step records as authoritative; do not take prior-challenge memory as a user-skill fact.`))
  }

  async function submitCandidate() {
    if (!activeProjection || !flagCandidate.trim()) return
    setOutcomeNotice('')
    const candidate = flagCandidate.trim()
    const previousSubmission = activeProjection.submissions.find(submission => submission.candidate === candidate)
    if (previousSubmission?.verdict === 'pass') {
      setOutcomeNotice(t('这个候选已经被平台确认 Accepted，无需再次提交。', 'This candidate has already been Accepted by the platform; no need to submit again.'))
      return
    }
    if (previousSubmission?.verdict === 'fail') {
      setOutcomeNotice(t('这个候选已被平台拒绝，请修改后再提交。', 'This candidate was Rejected by the platform; change it before submitting again.'))
      return
    }
    if (previousSubmission?.verdict === 'needs_review') {
      setOutcomeNotice(t('这个候选正在等待平台判题，不能并发重复提交。', 'This candidate is waiting for a platform verdict; do not submit it again in parallel.'))
      return
    }
    if (isArenaWorkspace && arenaAttempt) {
      setWorking(true)
      const result = await arena.submit(activeProjection.job.id, arenaAttempt.id, flagCandidate.trim())
      if (result) {
        await backend.adoptProjection(result.ctf)
        await refreshTrainingProgress()
        setOutcomeNotice(result.arena.correct
          ? t('NSSCTF Agent Arena 已确认 Accepted，平台回执已经写入证据链。', 'NSSCTF Agent Arena confirmed Accepted. The platform receipt is written into the evidence chain.')
          : t(`NSSCTF Agent Arena 返回 Rejected，剩余错误次数 ${result.arena.remaining_wrong_attempts ?? t('以平台为准', 'per the platform')}。`, `NSSCTF Agent Arena returned Rejected. Remaining wrong attempts: ${result.arena.remaining_wrong_attempts ?? t('以平台为准', 'per the platform')}.`))
      }
      setWorking(false)
      return
    }
    if (isCTFShowWorkspace) {
      setWorking(true)
      const result = await ctfshow.submitFlag(activeProjection.job.id, flagCandidate.trim())
      if (result) {
        await backend.adoptProjection(result.ctf)
        await refreshTrainingProgress()
        setOutcomeNotice(result.receipt.correct ? `CTFshow #${result.receipt.problemId} Accepted。` : `CTFshow #${result.receipt.problemId} Rejected。`)
      } else {
        setOutcomeNotice(ctfshow.error ?? t('CTFshow Judge 没有返回可确认结果。', 'CTFshow Judge did not return a confirmable result.'))
        await backend.loadJobs()
      }
      setWorking(false)
      return
    }
    if (isWebWorkspace) {
      setWorking(true)
      const result = await webBridge.submit(activeProjection.job.id, flagCandidate.trim())
      if (result) {
        await backend.adoptProjection(result.ctf)
        await refreshTrainingProgress()
        setOutcomeNotice(result.receipt.correct ? `NSSCTF P${result.receipt.problemId} Accepted。` : `NSSCTF P${result.receipt.problemId} Rejected。`)
      } else {
        await backend.loadJobs()
        setPlatformReview(backend.projection?.evaluations.at(-1)?.verdict === 'inconclusive')
      }
      setWorking(false)
      return
    }
    setWorking(true)
    const prepared = await backend.prepareExternalSubmission(
      activeProjection.job.id,
      flagCandidate.trim(),
      t('用户确认该候选已有可复核依据，并准备交给已授权的外部 Judge。', 'The user confirmed this candidate has reviewable evidence and is ready for the authorized external Judge.'),
    )
    if (prepared) {
      await navigator.clipboard.writeText(flagCandidate.trim())
      const sourceURI = activeProjection.challenge.source.uri
      let notice = ''
      if (activeProjection.challenge.source.kind === 'url' && sourceURI) {
        try {
          await invokeCommand('open_ctf_source_url', { url: sourceURI })
        } catch (reason) {
          notice = t(`候选已复制并进入 Judge 闸门，但无法打开题目 URL：${String(reason)}`, `Candidate copied and entered the Judge gate, but the challenge URL could not be opened: ${String(reason)}`)
        }
      }
      setPlatformReview(true)
      setOutcomeNotice(notice || (sourceURI
        ? t(`候选已复制并打开${externalJudgeLabel}；提交后回来记录结果。`, `Candidate copied and ${externalJudgeLabel} opened; come back to record the result after submitting.`)
        : t(`候选已复制；在${externalJudgeLabel}提交后回来记录结果。`, `Candidate copied; submit on ${externalJudgeLabel}, then come back to record the result.`)))
    } else {
      setOutcomeNotice(backend.error ?? t('候选没有进入外部 Judge 闸门。', 'The candidate did not enter the external Judge gate.'))
    }
    setWorking(false)
  }

  async function recordPlatformResult(accepted: boolean) {
    if (!activeProjection) return
    const latest = activeProjection.evaluations.at(-1)
    const recorded = latest?.verdict === 'needs_review' || latest?.verdict === 'inconclusive'
      ? await backend.recordExternalVerdict(
          activeProjection.job.id,
          accepted,
          accepted
            ? t(`用户根据${externalJudgeLabel}确认 Accepted。`, `The user confirmed Accepted from ${externalJudgeLabel}.`)
            : t(`用户根据${externalJudgeLabel}确认 Rejected。`, `The user confirmed Rejected from ${externalJudgeLabel}.`),
        )
      : await backend.recordLearning(activeProjection.job.id, {
          kind: 'judge_observation',
          content: accepted
            ? t(`${externalJudgeLabel}显示 Accepted。`, `${externalJudgeLabel} showed Accepted.`)
            : t(`${externalJudgeLabel}显示 Rejected。`, `${externalJudgeLabel} showed Rejected.`),
          concept: t('外部平台 Judge', 'External platform Judge'),
        })
    if (recorded) {
      await refreshTrainingProgress()
      setPlatformReview(false)
      setOutcomeNotice(accepted
        ? t(`已记录${externalJudgeLabel} Accepted。`, `Recorded ${externalJudgeLabel} Accepted.`)
        : t(`已记录${externalJudgeLabel} Rejected。`, `Recorded ${externalJudgeLabel} Rejected.`))
    }
  }

  useEffect(() => {
    window.localStorage.setItem('milksu.ctf.question-bank', activeBank)
    setSelectedProblem(null)
    setSelectedCTFShowProblemID(null)
    setLocalMaterials([])
    setAttachmentError('')
    if (!mountedRef.current) return
    if (activeBank === 'ctfshow') void ctfshow.refresh()
    else if (activeBank === 'nssctf') {
      void loadPublicCatalog(1).then(async () => {
        await bootstrapNSSCTFCatalog()
      })
    }
  }, [activeBank])

  useEffect(() => {
    window.localStorage.setItem('milksu.ctf.collaboration-mode', collaborationMode)
  }, [collaborationMode])

  useEffect(() => { setCtfshowPage(1) }, [ctfshowQuery, ctfshowCategory, collectionView, collectionRevision])
  useEffect(() => { if (ctfshowPage > ctfshowPageCount) setCtfshowPage(ctfshowPageCount) }, [ctfshowPage, ctfshowPageCount])

  useEffect(() => {
    if (activeBank !== 'nssctf' || screen !== 'challenge') return
    if (catalogSearchTimer.current) clearTimeout(catalogSearchTimer.current)
    catalogSearchTimer.current = setTimeout(() => { void loadPublicCatalog(1) }, 220)
    return () => { if (catalogSearchTimer.current) clearTimeout(catalogSearchTimer.current) }
  }, [catalogQuery, catalogCategory])

  useEffect(() => {
    if (activeBank !== 'nssctf' || screen !== 'challenge' || !mountedRef.current) return
    setSelectedProblem(null)
    debugLog('switch-collection', `view=${collectionView}`)
    updateDebugState({ view: collectionView, selectedPlatformId: null })
    void loadPublicCatalog(1)
  }, [collectionView])

  useEffect(() => {
    if (activeBank !== 'nssctf' || screen !== 'challenge') return
    if (selectedProblem && collectionView !== ALL_COLLECTIONS_ID && !ctfCollections.has(`nssctf:${selectedProblem.platformId}`, collectionView)) {
      setSelectedProblem(null)
    }
    if (collectionView !== ALL_COLLECTIONS_ID) void loadPublicCatalog(1)
  }, [collectionRevision])

  useEffect(() => { void refreshDailyChallenge() }, [
    trainingDashboard?.recommendations.map(item => item.problem.platformId).join(',') ?? '',
    catalogResult?.problems.map(item => item.platformId).join(',') ?? '',
    catalogResult?.completedProblemIds.join(',') ?? '',
  ])

  useEffect(() => {
    if (activeProjection?.challenge.externalPlatform === 'ctfshow-web') void ctfshow.refresh()
    if (activeProjection?.challenge.externalPlatform === 'nssctf-web') void webBridge.refresh()
  }, [activeProjection?.challenge.externalPlatform])

  useEffect(() => {
    setPlatformReview(false)
    setOutcomeNotice('')
    setRecalledMemories([])
    if (activeProjection?.job.id) void loadMemoryContext(activeProjection.job.id)
  }, [activeProjection?.job.id])

  useEffect(() => {
    if (screen !== 'workspace') return
    const area = workspaceScrollArea.current
    if (area) area.scrollTop = 0
  }, [screen, activeProjection?.job.id])

  useEffect(() => {
    setFlagCandidate(activeProjection?.submissions.at(-1)?.candidate ?? activeProjection?.agentCandidates.at(-1)?.candidate ?? '')
  }, [activeProjection?.job.id, activeProjection?.submissions.at(-1)?.candidate, activeProjection?.agentCandidates.at(-1)?.candidate])

  useEffect(() => {
    mountedRef.current = true
    void publicCatalog.ensureLoaded()
    void Promise.all([
      webBridge.refresh(),
      training.load(),
      platformRegistry.load(),
      activeBank === 'ctfshow' ? ctfshow.refresh() : Promise.resolve(null),
      activeBank === 'nssctf' ? loadPublicCatalog(1) : Promise.resolve(null),
    ]).then(async () => {
      await bootstrapNSSCTFCatalog()
      await resumeInitialJobIfNeeded(initialJobId)
      if (arenaReady) await arena.refresh()
    })
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (activeBank === 'ctfshow') void ctfshow.refresh()
      else if (activeBank === 'nssctf') void webBridge.refresh()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (initialJobId) void resumeInitialJobIfNeeded(initialJobId)
  }, [initialJobId])

  useEffect(() => {
    if (catalogEpoch) showProblems()
  }, [catalogEpoch])

  const dock = !chatMaximized && chatDockOpen ? (
    <ConversationDock
      ref={conversationDock}
      conversation={conversation ?? null}
      running={running}
      aborting={aborting}
      abortStalled={abortStalled}
      settings={settings}
      workspacePath={workspacePath}
      messageQueue={messageQueue}
      sessionReady={sessionReady}
      resumed={resumed}
      compacting={compacting}
      compactedAt={compactedAt}
      compactionError={compactionError}
      turnStatus={turnStatus}
      ctfSession={ctfSession}
      vulnerabilitySession={vulnerabilitySession}
      ctfMode={ctfMode}
      ctfRole={ctfRole}
      modelMode={modelMode}
      modelProvider={modelProvider}
      modelId={modelId}
      modelSourcePreference={modelSourcePreference}
      executionMode={executionMode}
      approvalPolicy={approvalPolicy}
      mcpServers={mcpServers}
      mcpConfigDigest={mcpConfigDigest}
      ensureConversation={ensureConversation}
      pendingComposerDraft={pendingComposerDraft}
      onSend={(...args: CodingAgentSendArgs) => onSend?.(...args)}
      onAbort={onAbort}
      onSelect={onSelectConversation}
      onClose={onCloseDock}
      onExpand={onExpand}
      onConsumePendingDraft={onConsumePendingDraft}
      onCtfAction={onCtfAction}
      onCompactContext={onCompactContext}
      onRewindContext={onRewindContext}
      onHandoffContext={onHandoffContext}
      onControlGoal={onControlGoal}
      onRespondApproval={onRespondApproval}
      onChangeModel={onChangeModel}
      onChangeModelSource={onChangeModelSource}
      onChangeCodingPolicy={onChangeCodingPolicy}
      onChangeMcpServers={onChangeMcpServers}
      onChooseWorkspace={onChooseWorkspace}
      onChooseWorkspaceForNewTask={onChooseWorkspaceForNewTask}
      onSelectWorkspace={onSelectWorkspace}
      onForgetWorkspace={onForgetWorkspace}
      onClearWorkspace={onClearWorkspace}
      onCancelQueuedGuidance={onCancelQueuedGuidance}
      onEditQueuedGuidance={onEditQueuedGuidance}
      onOpenSettings={onOpenSettings}
    />
  ) : null

  return (
    <main className="ctf-page flex min-w-0 flex-1 flex-col bg-background">
      {screen === 'workspace' ? (
        <CTFWorkspaceHeader
          challengeTitle={activeProjection?.challenge.title}
          browserStatus={isWebWorkspace ? (activeBrowserReady ? 'live' : 'off') : ''}
          onReturnCatalog={showProblems}
          onOpenBrowserSettings={() => onOpenSettings?.('browser')}
          onRefreshBridge={() => { void webBridge.refresh() }}
        />
      ) : (
        <WorkspaceModuleTopBar
          module="ctf"
          title={screen === 'detail' ? (selectedProblem?.title || selectedCTFShowProblem?.title || t('题目', 'Challenge')) : t('挑战', 'Challenges')}
          leading={screen === 'detail' ? (
            <Button variant="ghost" size="icon-sm" aria-label={t('返回题库', 'Back to catalog')} onClick={() => setScreen('challenge')}>
              <ArrowLeft className="size-4" />
            </Button>
          ) : undefined}
          actions={ctfSection === 'catalog' ? (
            <WorkspaceCatalogActions
              ref={catalogActions}
              historyCount={jobs.length}
              historyAriaLabel={t('打开训练历史', 'Open training history')}
              historyMenuLabel={t('训练历史', 'Training history')}
              actionAriaLabel={t('导入题目', 'Import challenge')}
              onAction={() => { catalogActions.current?.closeHistoryMenu(); setShowImport(true) }}
              history={jobs.map(job => (
                <WorkspaceCatalogHistoryItem
                  key={job.id}
                  title={job.title}
                  subtitle={t(`${formatCategory(job.category)} · ${job.experimentCount} 次实验`, `${formatCategory(job.category)} · ${job.experimentCount} experiments`)}
                  time={job.updatedAt}
                  current={activeProjection?.job.id === job.id}
                  onSelect={() => { catalogActions.current?.closeHistoryMenu(); void resumeJob(job.id) }}
                  leading={(
                    <span className="mt-0.5 inline-flex w-16 shrink-0 justify-center rounded-md bg-muted px-1.5 py-1 text-caption font-medium">
                      {ctfManualStatusLabel(manualStatusForJob(job))}
                    </span>
                  )}
                />
              ))}
            />
          ) : undefined}
          filters={ctfSection === 'catalog' && activeQuestionBank ? (
            <div className="flex w-full flex-col gap-3">
              <CollectionViewFilter modelValue={collectionView} store={ctfCollections} onModelValueChange={setCollectionView} />
              <div className="flex w-full flex-wrap items-center gap-3">
                <Select value={activeBank} onValueChange={value => setActiveBank(value as TrainingSource)}>
                  <SelectTrigger className="app-no-drag min-w-44 shrink-0" aria-label={t('选择训练平台', 'Choose a training platform')}>
                    <Library className="size-4 text-muted-foreground" />
                    <SelectValue placeholder={t('选择训练平台', 'Choose a training platform')}>{activeSourceName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-64">
                    <SelectGroup>
                      <SelectLabel>{t('训练平台', 'Training platforms')}</SelectLabel>
                      {visibleTrainingPlatforms.map(platform => (
                        <SelectItem key={platform.id} value={platform.id}>
                          <span className="flex min-w-44 items-center justify-between gap-4">
                            <span>{platform.name}</span>
                            <span className="text-caption text-muted-foreground">
                              {platform.status === 'ready' ? t('可用', 'Available') : platform.status === 'planned' ? t('接入中', 'Connecting') : t('受限', 'Restricted')}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>{t('本地', 'Local')}</SelectLabel>
                      <SelectItem value="custom">
                        <span className="flex min-w-44 items-center justify-between gap-4">
                          <span>{t('自定义题目', 'Custom challenge')}</span>
                          <span className="text-caption text-muted-foreground">{t('本地工作区', 'Local workspace')}</span>
                        </span>
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <label className="app-no-drag relative min-w-52 flex-1">
                  <FileSearch className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={deskQuery}
                    onChange={event => activeBank === 'ctfshow' ? setCtfshowQuery(event.target.value) : setCatalogQuery(event.target.value)}
                    className="pl-9"
                    placeholder={t('搜索题号或题名', 'Search by id or title')}
                    aria-label={t('搜索题库', 'Search catalog')}
                  />
                </label>
                <NativeSelect
                  value={deskCategory}
                  className="app-no-drag w-36"
                  aria-label={t('按题型筛选', 'Filter by category')}
                  onChange={event => activeBank === 'ctfshow' ? setCtfshowCategory(event.target.value) : setCatalogCategory(event.target.value)}
                >
                  <NativeSelectOption value="all">{t('全部分类', 'All categories')}</NativeSelectOption>
                  {deskCategories.map(category => (
                    <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  variant="outline"
                  size="sm"
                  className="app-no-drag shrink-0"
                  data-connection-live-action
                  aria-label={t('浏览器连接设置', 'Browser connection settings')}
                  onClick={() => onOpenSettings?.('browser')}
                >
                  <span className="connection-live-action__label">
                    <Cable className="size-4" />
                    {browserBridgeConnected ? t('浏览器已连接', 'Browser connected') : t('连接浏览器', 'Connect browser')}
                  </span>
                  <ConnectionLiveStatus live={browserBridgeConnected} decorative />
                </Button>
              </div>
            </div>
          ) : undefined}
        />
      )}

      <div
        ref={workspaceScrollArea}
        className={`min-h-0 flex-1 ${screen === 'challenge' ? 'overflow-hidden' : 'page-scroll'}`}
      >
        <div className={`w-full ${screen === 'challenge' ? 'h-full' : 'page-column'}`}>
          {ctfSection === 'catalog' && screen === 'challenge' && (activeBank === 'hackthebox' || activeBank === 'tryhackme') ? (
            <section className="page-scroll h-full" aria-labelledby={`${activeBank}-platform-title`}>
              {activeExternalPlatform ? (
                <div className="page-column">
                  <SettingsSection>
                    <div className="px-5 py-6 sm:px-6 sm:py-7">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary"><Cable className="size-5" /></span>
                        <Badge variant="outline">{externalPlatformStatusLabel}</Badge>
                      </div>
                      <h2 id={`${activeBank}-platform-title`} className="mt-5 text-2xl font-semibold tracking-[-0.035em]">{activeExternalPlatform.name}</h2>
                      <p className="mt-2 max-w-2xl text-body leading-6 text-muted-foreground">{externalPlatformSummary}</p>
                      <div className="mt-6 flex flex-wrap gap-2">
                        {externalPlatformCapabilities.map(capability => (
                          <Badge key={capability} variant="secondary">{capability}</Badge>
                        ))}
                      </div>
                      <div className="mt-7 flex flex-wrap gap-3">
                        <Button variant="outline" onClick={() => { void openExternalPlatform() }}>
                          <ExternalLink className="size-4" />
                          {t('查看官方入口', 'View official entry')}
                        </Button>
                      </div>
                    </div>
                  </SettingsSection>
                </div>
              ) : null}
            </section>
          ) : ctfSection === 'catalog' && screen === 'detail' ? (
            <section className="page-stack" aria-label={t('题目详情', 'Challenge details')}>
              {selectedProblem ? (
                <SettingsSection
                  title={t('题目', 'Challenge')}
                  footer={(
                    <>
                      {dailyChallengeVisible?.platformId === selectedProblem.platformId ? (
                        <Button variant="outline" size="sm" onClick={() => { void refreshDailyChallenge(true) }}>{t('换一道', 'Try another')}</Button>
                      ) : null}
                      <Button variant="brand" size="sm" disabled={working} onClick={() => { void openSelectedInCoding() }}>
                        {working ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {t('开始解题', 'Start solving')}
                      </Button>
                    </>
                  )}
                >
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{formatCategory(selectedProblem.category)}</Badge>
                      {selectedProblem.difficulty ? <Badge variant="outline">{catalogDifficultyLabel(selectedProblem.difficulty, t)}</Badge> : null}
                    </div>
                    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{selectedProblem.title}</h1>
                    <p className="mt-2 font-mono text-caption text-muted-foreground">P{selectedProblem.platformId}</p>
                    {dailyChallengeVisible?.platformId === selectedProblem.platformId && dailyChallengeReason ? (
                      <p className="mt-3 border-l-2 border-primary pl-3 text-caption leading-5">{dailyChallengeReason}</p>
                    ) : null}
                    {selectedProblem.statement ? <MarkdownContent className="mt-3 text-body leading-6" content={selectedProblem.statement} /> : null}
                  </div>
                  {selectedProblem.sourceUrl ? (
                    <SettingsRow label={t('原文', 'Original')} trailing={(
                      <Button variant="link" size="text" onClick={() => { void openProblem() }}>
                        {t('打开原文', 'Open original')}
                        <ExternalLink className="size-3" />
                      </Button>
                    )} />
                  ) : null}
                  <SettingsRow label={t('状态', 'Status')} trailing={(
                    <NativeSelect
                      value={manualStatuses[`nssctf:${selectedProblem.platformId}`] ?? 'not_started'}
                      className="w-32"
                      aria-label={t(`${selectedProblem.title} 状态`, `${selectedProblem.title} status`)}
                      onChange={event => updateManualStatus(`nssctf:${selectedProblem.platformId}`, event.target.value as CTFManualStatus)}
                    >
                      <NativeSelectOption value="not_started">{t('未开始', 'Not started')}</NativeSelectOption>
                      <NativeSelectOption value="in_progress">{t('进行中', 'In progress')}</NativeSelectOption>
                      <NativeSelectOption value="paused">{t('稍后继续', 'Resume later')}</NativeSelectOption>
                      <NativeSelectOption value="completed">{t('已完成', 'Completed')}</NativeSelectOption>
                    </NativeSelect>
                  )} />
                </SettingsSection>
              ) : selectedCTFShowProblem ? (
                <SettingsSection
                  title={t('题目', 'Challenge')}
                  footer={(
                    <Button variant="brand" size="sm" disabled={working} onClick={() => { void openSelectedInCoding() }}>
                      {working ? <LoaderCircle className="size-4 animate-spin" /> : null}
                      {t('开始解题', 'Start solving')}
                    </Button>
                  )}
                >
                  <div className="px-4 py-3">
                    <Badge variant="outline">{selectedCTFShowProblem.category}</Badge>
                    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{selectedCTFShowProblem.title}</h1>
                    <p className="mt-2 text-caption text-muted-foreground">{t(`#${selectedCTFShowProblem.platformId} · ${selectedCTFShowProblem.points} 分`, `#${selectedCTFShowProblem.platformId} · ${selectedCTFShowProblem.points} pts`)}</p>
                  </div>
                </SettingsSection>
              ) : null}
            </section>
          ) : ctfSection === 'catalog' && screen === 'challenge' ? (
            <CTFChallengeDesk
              activeBank={activeCatalogBank}
              nssctfProblems={catalogResult?.problems ?? []}
              ctfshowProblems={visibleCTFShowProblems}
              selectedNssctf={visibleSelectedNssctf}
              dailyProblem={dailyChallengeVisible}
              dailyReason={dailyChallengeReason}
              selectedCtfshow={selectedCTFShowProblem}
              dashboard={trainingDashboard}
              nssctfAttemptedIds={catalogResult?.attemptedProblemIds ?? []}
              nssctfCompletedIds={catalogResult?.completedProblemIds ?? []}
              ctfshowAttemptedIds={ctfshowStatus?.attemptedProblemIds ?? []}
              ctfshowCompletedIds={ctfshowStatus?.completedProblemIds ?? []}
              page={deskPage}
              pageCount={deskPageCount}
              total={deskProblemTotal}
              loading={deskLoading || (activeBank === 'nssctf' && trainingSyncing)}
              loadingTitle={deskLoadingTitle}
              loadingDetail={deskLoadingDetail}
              emptyTitle={deskEmptyTitle}
              emptyDetail=""
              actionLoading={working}
              collaborationMode={collaborationMode}
              selectedBrowserReady={selectedBrowserReady}
              ctfshowBridgeReady={ctfshowBridgeReady}
              attachmentError={attachmentError || publicProblemsError || ''}
              localMaterials={localMaterials}
              catalogError={catalogErrorMessage}
              modelVerified={modelVerified}
              catalogReady={selectedCatalogReady}
              judgeReady={selectedJudgeReady}
              hasActiveTraining={Boolean(selectedActiveJob)}
              manualStatuses={manualStatuses}
              conversations={conversations ?? []}
              relatedJobId={selectedCatalogJob?.id}
              collectionStore={ctfCollections}
              onSelectNssctf={id => { void chooseCatalogProblem(id) }}
              onSelectCtfshow={previewCTFShowProblem}
              onClearSelection={() => { setSelectedProblem(null); setSelectedCTFShowProblemID(null) }}
              onPreviousPage={() => { if (deskPage > 1) activeBank === 'ctfshow' ? setCtfshowPage(value => value - 1) : void loadPublicCatalog(catalogPage - 1) }}
              onNextPage={() => { if (deskPage < deskPageCount) activeBank === 'ctfshow' ? setCtfshowPage(value => value + 1) : void loadPublicCatalog(catalogPage + 1) }}
              onGoPage={page => { if (activeBank === 'ctfshow') setCtfshowPage(page); else void loadPublicCatalog(page) }}
              onStartNssctf={() => { void startPublicWorkspace() }}
              onChooseLocalMaterials={async () => {
                setAttachmentError('')
                try {
                  const selected = await invokeCommand<CTFMaterialRequest[]>('choose_ctf_materials')
                  if (!selected.length) return
                  setLocalMaterials(selected)
                  setOutcomeNotice(t(`已补充 ${selected.length} 项本地材料。`, `Added ${selected.length} local materials.`))
                } catch (reason) {
                  setAttachmentError(reason instanceof Error ? reason.message : String(reason))
                }
              }}
              onStartCtfshow={id => { void chooseCTFShowProblem(id) }}
              onOpenProblem={() => { void openProblem() }}
              onOpenCtfshow={() => { void ctfshow.open() }}
              onSyncNssctf={() => { void syncCatalog() }}
              onRefreshJudge={() => { activeBank === 'ctfshow' ? void ctfshow.open() : void webBridge.refresh() }}
              onOpenSettings={() => onOpenSettings?.()}
              onOpenBrowserSettings={() => onOpenSettings?.('browser')}
              onOpenConversation={onOpenCodingConversation}
              onUpdateManualStatus={updateManualStatus}
              onChangeDaily={() => { void refreshDailyChallenge(true) }}
              onCollaborationModeChange={setCollaborationMode}
            />
          ) : screen === 'workspace' ? (
            <section aria-labelledby="workspace-title">
              {backendError || arenaError || webBridgeError ? (
                <Alert variant="destructive" className="mb-5">
                  <Circle className="size-4" />
                  <AlertDescription>{backendError || arenaError || webBridgeError}</AlertDescription>
                </Alert>
              ) : null}
              {activeProjection ? (
                <div className="page-stack">
                  <SettingsSection
                    className="ctf-problem-surface"
                    title={t('题目', 'Challenge')}
                    footer={(
                      <Button disabled={working} variant="brand" size="sm" onClick={() => { void openCodingAgent() }}>
                        {working ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {agentActionLabel}
                      </Button>
                    )}
                  >
                    <div className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{formatCategory(activeProjection.challenge.category)}</Badge>
                        {isArenaWorkspace ? <Badge variant="secondary">Agent Arena</Badge> : null}
                        {isWebWorkspace ? <Badge variant="secondary">Chrome Judge</Badge> : null}
                      </div>
                      <h1 id="workspace-title" className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{activeProjection.challenge.title}</h1>
                      <p className="mt-2 text-body text-muted-foreground">
                        {t(`${activeProjection.challenge.trackName} · ${activeProjection.challenge.agentPolicy.label}模式`, `${activeProjection.challenge.trackName} · ${activeProjection.challenge.agentPolicy.label} mode`)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Target className="size-3.5" />{t(`${remainingAgentTurns} 回合`, `${remainingAgentTurns} turns`)}</span>
                        <span className="flex items-center gap-1.5">
                          <Clock3 className="size-3.5" />
                          {t(`${remainingAgentMinutes} 分钟`, `${remainingAgentMinutes} min`)}
                          {agentBudget?.firstTurnStartedAt ? t('剩余', 'remaining') : t('（启动后计时）', '(starts with first turn)')}
                        </span>
                        <span className="flex items-center gap-1.5"><Flag className="size-3.5" />{t(`${remainingWrongSubmissions} 次错误提交额度`, `${remainingWrongSubmissions} wrong-submission budget`)}</span>
                        {activeProjection.challenge.materials.length ? (
                          <span className="flex items-center gap-1.5"><FileSearch className="size-3.5" />{t(`${activeProjection.challenge.materials.length} 个附件`, `${activeProjection.challenge.materials.length} attachments`)}</span>
                        ) : null}
                      </div>
                      {activeProjection.challenge.statement ? (
                        <MarkdownContent className="mt-4 text-body leading-6" content={activeProjection.challenge.statement} />
                      ) : null}
                    </div>
                    {activeProjection.challenge.source.uri ? (
                      <SettingsRow label={t('原文', 'Original')} trailing={(
                        <Button variant="link" size="text" onClick={() => { void openActiveChallenge() }}>
                          {t('打开原文', 'Open original')}
                          <ExternalLink className="size-3" />
                        </Button>
                      )} />
                    ) : null}
                    <SettingsRow label={t('状态', 'Status')} divider={false} trailing={(
                      <NativeSelect
                        value={manualStatusForJob(activeProjection.job)}
                        className="w-32"
                        aria-label={t(`${activeProjection.challenge.title} 状态`, `${activeProjection.challenge.title} status`)}
                        onChange={event => updateManualStatus(`job:${activeProjection.job.id}`, event.target.value as CTFManualStatus)}
                      >
                        <NativeSelectOption value="not_started">{t('未开始', 'Not started')}</NativeSelectOption>
                        <NativeSelectOption value="in_progress">{t('进行中', 'In progress')}</NativeSelectOption>
                        <NativeSelectOption value="paused">{t('稍后继续', 'Resume later')}</NativeSelectOption>
                        <NativeSelectOption value="completed">{t('已完成', 'Completed')}</NativeSelectOption>
                      </NativeSelect>
                    )} />
                  </SettingsSection>
                  {agentBudgetStopMessage ? (
                    <Alert variant="destructive">
                      <Circle className="size-4" />
                      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span>{agentBudgetStopMessage}</span>
                        <Button variant="outline" size="sm" onClick={showProblems}>{t('返回题库', 'Back to catalog')}</Button>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className={`grid gap-5 ${workspacePresentation?.showActionRail ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]' : ''}`}>
                    <div className="space-y-5">
                      {workspacePresentation?.showTrajectory ? <CTFTrajectory projection={activeProjection} /> : null}
                      {activeProjection.artifacts.length ? <CTFArtifacts projection={activeProjection} /> : null}
                      {workspacePresentation?.showDebrief ? (
                        <CTFDebrief
                          debrief={activeProjection.debrief}
                          humanOutcome={activeProjection.humanOutcome}
                          submitting={working}
                          onSubmitIndependentStep={content => { void sendIndependentStep(content) }}
                          onSubmitReflection={content => { void sendDebriefReflection(content) }}
                          onSaveMemory={() => { void saveTrainingMemory() }}
                        />
                      ) : null}
                      {activeProjection.agentRuns.length || activeProjection.agentCandidates.length ? (
                        <CTFTrainingArchive jobId={activeProjection.job.id} replayAvailable />
                      ) : null}
                    </div>
                    {workspacePresentation?.showActionRail ? (
                      <div className="space-y-5">
                        {workspacePresentation.showEndpointAction ? (
                          <CTFEndpointAuthorization
                            sourceScope={activeProjection.challenge.source.scope}
                            networkScopes={activeProjection.networkScopes}
                            requests={activeProjection.endpointRequests}
                            working={working}
                            terminal={Boolean(activeProjection.outcome)}
                            pendingOnly
                            onRequest={request => { void requestEndpoint(request) }}
                            onApprove={id => { void approveEndpoint(id) }}
                            onDeny={id => { void denyEndpoint(id) }}
                          />
                        ) : null}
                        {workspacePresentation.showSubmissionAction ? (
                          <CTFSubmissionGate
                            candidate={flagCandidate}
                            onCandidateChange={setFlagCandidate}
                            projection={activeProjection}
                            working={working}
                            canContinue={canContinue}
                            activeStartCost={activeStartCost}
                            activeBrowserCanSubmit={activeBrowserCanSubmit}
                            ctfshowBridgeReady={ctfshowBridgeReady}
                            platformReview={platformReview}
                            externalJudgeLabel={externalJudgeLabel}
                            onSubmit={() => { void submitCandidate() }}
                            onRecordPlatformResult={accepted => { void recordPlatformResult(accepted) }}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {memoryLoading || recalledMemories.length ? (
                    <CTFMemoryRecall
                      memories={recalledMemories}
                      loading={memoryLoading}
                      onArchive={memory => { void archiveTrainingMemory(memory) }}
                      onInspectEvidence={inspectTrainingMemoryEvidence}
                    />
                  ) : null}
                  {outcomeNotice ? (
                    <Alert>
                      <Check className="size-4" />
                      <AlertDescription>{outcomeNotice}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : (
                <SettingsSection title={t('工作区', 'Workspace')}>
                  <SettingsRow stack="always" divider={false}>
                    {backendLoading ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : <Button onClick={showProblems}>{t('选择一道题', 'Choose a challenge')}</Button>}
                  </SettingsRow>
                </SettingsSection>
              )}
            </section>
          ) : null}
        </div>
      </div>
      {dock}
      <WorkspaceImportDialog
        open={showImport}
        onOpenChange={value => { setShowImport(value); if (!value) manualIntake.current?.reset() }}
        description={t('同步 NSSCTF 或 CTFshow 题库，或导入自定义题目。', 'Sync the NSSCTF or CTFshow catalog, or import a custom challenge.')}
      >
        <SettingsSection title={t('同步题库', 'Sync catalog')}>
          <SettingsRow
            label="NSSCTF"
            description={t('把公开题库更新到本机。', 'Update the public catalog on this machine.')}
            trailing={(
              <Button
                variant="outline"
                size="sm"
                disabled={trainingSyncing}
                aria-label={t('同步 NSSCTF 题库', 'Sync NSSCTF catalog')}
                onClick={() => { void syncCatalog() }}
              >
                {trainingSyncing ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t('同步', 'Sync')}
              </Button>
            )}
          />
          <SettingsRow
            label="CTFshow"
            description={t('从已打开的 CTFshow 题库页同步。', 'Sync from an open CTFshow catalog page.')}
            divider={false}
            trailing={(
              <Button
                variant="outline"
                size="sm"
                disabled={ctfshowLoading}
                aria-label={t('同步 CTFshow 题库', 'Sync CTFshow catalog')}
                onClick={() => { void refreshCTFShow() }}
              >
                {ctfshowLoading ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t('同步', 'Sync')}
              </Button>
            )}
          />
          {catalogNotice ? <p className="px-4 pb-3 text-caption text-muted-foreground">{catalogNotice}</p> : null}
        </SettingsSection>
        <SettingsSection title={t('自定义题目', 'Custom challenge')}>
          <div className="px-4 py-4">
            <CTFManualIntake
              ref={manualIntake}
              loading={manualCreating}
              error={backendError ?? ''}
              onSubmit={request => { void startManualChallenge(request) }}
              onCancel={() => { setShowImport(false); manualIntake.current?.reset() }}
            />
          </div>
        </SettingsSection>
      </WorkspaceImportDialog>
    </main>
  )
}