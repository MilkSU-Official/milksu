import {
  DEFAULT_MODEL_ROUTING,
  withAppSettingsDefaults,
  type AppSettings,
  type CodingAttachment,
  type LocalDataBackupExport,
  type LocalDataBackupRestore,
  type LocalDataStatus,
  type LocalDiagnosticExport,
  type ModelProbeResult,
  type StartupRecoveryStatus,
} from './types'
import type {
  CTFArtifactPreview,
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFAgentReplay,
  CTFAgentWorkspaceHandoff,
  CTFChallengeRequest,
  CTFEndpointRequestInput,
  CTFLearningRecordRequest,
  CTFMaterialRequest,
  CTFProjection,
  CTFSummary,
  CTFToolWorkshopState,
  CTFTrainingReportExport,
  CTFTrainingMemory,
} from './ctfTypes'
import type {
  VulnLearningRecordRequest,
  VulnProjection,
  VulnReproductionRequest,
  VulnSummary,
} from './vulnTypes'
import { challengeFromNSSCTFAPI, normalizeNSSCTFProblemURL, type NSSCTFChallenge } from './nssctfTypes'
import { createDemoVulnProjection, summarizeDemoVuln } from './vulnDemo'
import type { NSSCTFArenaSubmission, NSSCTFArenaWorkspace } from './nssctfArenaTypes'
import type { NSSCTFWebBridgeStatus, NSSCTFWebSubmission } from './nssctfWebTypes'
import type {
  CTFShowCatalogStatus,
  CTFShowChallengeWorkspace,
  CTFShowWebSubmission,
} from './ctfshowTypes'
import type {
  CTFAbilityDimension,
  NSSCTFCatalogProblem,
  NSSCTFCatalogQuery,
  NSSCTFCatalogSearchResult,
  NSSCTFCatalogSyncResult,
  NSSCTFRecommendation,
  NSSCTFTrainingDashboard,
  NSSCTFTrainingSeries,
} from './nssctfTrainingTypes'
import type { CTFTrainingPlatform } from './ctfPlatformTypes'
import type {
  CodingArchitecturePreview,
  CodingArtifactPreview,
  CodingBrowserStatus,
  CodingCompactionResult,
  CodingComputerUseStatus,
  CodingComputerUseTarget,
  CodingCollaborationStatus,
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitAction,
  CodingGitActionResult,
  CodingGitHunkAction,
  CodingMCPConfigSnapshot,
  CodingPullRequestPreview,
  CodingPullRequestPublishResult,
  CodingRuntimeStatus,
  CodingTerminalSession,
} from './codingEnvironmentTypes'
import type {
  ManagedLabAccess,
  ManagedLabInstance,
  ManagedLabJudgeResponse,
  ManagedLabPackage,
  ManagedLabTrainingWorkspace,
} from './ctfLabTypes'
import { createPreviewCTFProjection, summarizePreviewCTF } from './ctfPreview'
import type {
  ExternalSessionHistoryImportRequest,
  ExternalSessionHistoryImportResult,
  SessionHistorySearchRequest,
  SessionHistorySearchResponse,
  SessionIndexRefreshResult,
  SessionIndexStatus,
} from './sessionIndexTypes'

type CommandArgs = Record<string, unknown>
type UnlistenFn = () => void
type EventEnvelope<T> = { payload: T }

export interface VulnerabilityFeedDownload {
  sourceName: string
  sourceUrl: string
  retrievedAt: string
  lastModified: string
  httpStatus: number
  contentType: string
  body: string
  snapshotPath?: string
  snapshotSha256?: string
  snapshotSizeBytes?: number
}

export interface VulnerabilityPracticeRequest {
  cveId: string
  environmentId: string
  directory: string
  sourceRevision?: string
  projectName?: string
  cleanupVolumes?: boolean
}

export interface VulnerabilityPracticeContainer {
  name?: string
  service?: string
  state?: string
  health?: string
}

export interface VulnerabilityPracticeRun {
  schema: string
  action: string
  state: string
  cveId: string
  environmentId: string
  directory: string
  composeFile: string
  projectName: string
  sourceRevision?: string
  observedAt: string
  evidencePath?: string
  composeSha256?: string
  containerCount: number
  containers?: VulnerabilityPracticeContainer[]
  gates: {
    dockerAvailable: boolean
    composeFileValidated: boolean
    started: boolean
    statusObserved: boolean
    stopped: boolean
    noCredentialLeak: boolean
  }
  limitations?: string[]
  error?: string
}

interface WailsAppBindings {
  GetSettings(): Promise<AppSettings>
  SaveSettingsCmd(settings: AppSettings): Promise<void>
  GetLocalDataStatus(): Promise<LocalDataStatus>
  ExportLocalDataBackup(): Promise<LocalDataBackupExport>
  ScheduleLocalDataRestore(): Promise<LocalDataBackupRestore>
  ExportLocalDiagnostics(): Promise<LocalDiagnosticExport>
  RevealLocalDataDirectory(): Promise<void>
  GetStartupRecoveryStatus(): Promise<StartupRecoveryStatus>
  GetSessionIndexStatus(): Promise<SessionIndexStatus>
  RefreshSessionIndex(): Promise<SessionIndexRefreshResult>
  SearchSessionHistory(request: SessionHistorySearchRequest): Promise<SessionHistorySearchResponse>
  ImportExternalSessionHistory(request: ExternalSessionHistoryImportRequest): Promise<ExternalSessionHistoryImportResult>
  ListConversations(): Promise<unknown>
  SaveConversation(conversation: unknown): Promise<void>
  DeleteConversation(id: string): Promise<void>
  ChooseAgentWorkspace(): Promise<string>
  ChooseCTFMaterials(): Promise<CTFMaterialRequest[]>
  ChooseCodingAttachments(): Promise<CodingAttachment[]>
  SendMessage(
    conversationId: string,
    prompt: string,
    workspacePath: string,
    modelMode: string,
    modelProvider: string,
    modelId: string,
    executionMode: string,
    approvalPolicy: string,
    mcpConfigDigest: string,
    mcpServers: string[],
    attachments: CodingAttachment[],
  ): Promise<void>
  AbortMessage(conversationId: string): Promise<void>
  RespondToolApproval(
    conversationId: string,
    requestId: string,
    approved: boolean,
  ): Promise<void>
  GetRuntimeStatus(conversationId: string): Promise<CodingRuntimeStatus>
  RefreshCodingBackgroundTasks(
    conversationId: string,
    workspacePath: string,
    executionMode: string,
    approvalPolicy: string,
  ): Promise<CodingRuntimeStatus>
  StartCodingBackgroundTask(
    conversationId: string,
    workspacePath: string,
    command: string,
    name: string,
    executionMode: string,
    approvalPolicy: string,
  ): Promise<CodingRuntimeStatus>
  StopCodingBackgroundTask(
    conversationId: string,
    taskId: string,
  ): Promise<CodingRuntimeStatus>
  CompactCodingSession(
    conversationId: string,
  ): Promise<CodingCompactionResult>
  ListCodingTerminals(
    conversationId: string,
  ): Promise<CodingTerminalSession[]>
  StartCodingTerminal(
    conversationId: string,
    workspacePath: string,
    columns: number,
    rows: number,
  ): Promise<CodingTerminalSession>
  WriteCodingTerminal(
    conversationId: string,
    terminalId: string,
    data: string,
  ): Promise<void>
  ResizeCodingTerminal(
    conversationId: string,
    terminalId: string,
    columns: number,
    rows: number,
  ): Promise<CodingTerminalSession>
  StopCodingTerminal(
    conversationId: string,
    terminalId: string,
  ): Promise<CodingTerminalSession>
  GetCodingEnvironment(workspacePath: string): Promise<CodingEnvironmentSnapshot>
  GetCodingMCPConfig(workspacePath: string): Promise<CodingMCPConfigSnapshot>
  GetCodingDiff(workspacePath: string, relativePath: string): Promise<CodingDiffSnapshot>
  ApplyCodingGitAction(
    workspacePath: string,
    action: CodingGitAction,
    relativePath: string,
    message: string,
  ): Promise<CodingGitActionResult>
  ApplyCodingGitHunkAction(
    workspacePath: string,
    action: CodingGitHunkAction,
    relativePath: string,
    patch: string,
  ): Promise<CodingGitActionResult>
  PrepareCodingPullRequest(
    workspacePath: string,
  ): Promise<CodingPullRequestPreview>
  PublishCodingPullRequest(
    workspacePath: string,
    confirmationToken: string,
    title: string,
    body: string,
  ): Promise<CodingPullRequestPublishResult>
  PrepareCodingCollaboration(
    conversationId: string,
    workspacePath: string,
    writers: number,
  ): Promise<CodingCollaborationStatus>
  GetCodingCollaboration(
    conversationId: string,
    workspacePath: string,
  ): Promise<CodingCollaborationStatus>
  FinishCodingCollaboration(
    conversationId: string,
    workspacePath: string,
  ): Promise<CodingCollaborationStatus>
  GetCodingArchitecturePreview(
    workspacePath: string,
    relativePath: string,
  ): Promise<CodingArchitecturePreview>
  GetCodingArtifactPreview(
    workspacePath: string,
    relativePath: string,
  ): Promise<CodingArtifactPreview>
  GetCodingArtifactPreviewWebViewSmokeRequest(): Promise<Record<string, unknown>>
  CompleteCodingArtifactPreviewWebViewSmoke(report: Record<string, unknown>): Promise<void>
  StartCodingBrowser(
    conversationId: string,
    initialUrl: string,
  ): Promise<CodingBrowserStatus>
  GetCodingBrowserStatus(conversationId: string): Promise<CodingBrowserStatus>
  StopCodingBrowser(conversationId: string): Promise<CodingBrowserStatus>
  RevealCodingBrowserEvidence(conversationId: string): Promise<void>
  ListCodingComputerUseTargets(): Promise<CodingComputerUseTarget[]>
  GetCodingComputerUseStatus(): Promise<CodingComputerUseStatus>
  RequestCodingComputerUsePermissions(): Promise<CodingComputerUseStatus>
  StartCodingComputerUse(
    conversationId: string,
    targetPid: number,
    targetWindowId: number,
  ): Promise<CodingComputerUseStatus>
  StopCodingComputerUse(conversationId: string): Promise<CodingComputerUseStatus>
  TestAgentModel(): Promise<ModelProbeResult>
  StartSampleCTF(): Promise<CTFProjection>
  ImportNSSCTFChallenge(rawURL: string): Promise<NSSCTFChallenge>
  SyncNSSCTFCatalog(rawURL: string): Promise<NSSCTFCatalogSyncResult>
  GetNSSCTFTrainingDashboard(): Promise<NSSCTFTrainingDashboard>
  ListNSSCTFCatalog(query: NSSCTFCatalogQuery): Promise<NSSCTFCatalogSearchResult>
  GetCTFTrainingPlatforms(): Promise<CTFTrainingPlatform[]>
  ListManagedLabPackages(): Promise<ManagedLabPackage[]>
  ListManagedLabInstances(): Promise<ManagedLabInstance[]>
  GetManagedLabInstance(instanceId: string): Promise<ManagedLabInstance>
  StartManagedLab(packageId: string): Promise<ManagedLabInstance>
  ResetManagedLab(instanceId: string): Promise<ManagedLabInstance>
  StopManagedLab(instanceId: string): Promise<ManagedLabInstance>
  DestroyManagedLab(instanceId: string): Promise<ManagedLabInstance>
  OpenManagedLab(instanceId: string): Promise<void>
  GetManagedLabAccess(instanceId: string): Promise<ManagedLabAccess>
  StartManagedLabTraining(instanceId: string, collaborationMode: string): Promise<ManagedLabTrainingWorkspace>
  CheckManagedLabTraining(instanceId: string, jobId: string): Promise<ManagedLabJudgeResponse>
  OpenNSSCTFChallenge(rawURL: string): Promise<void>
  OpenCTFSourceURL(rawURL: string): Promise<void>
  OpenChromeExtensionManager(): Promise<void>
  RevealBrowserExtension(): Promise<void>
  GetCTFShowCatalogStatus(): Promise<CTFShowCatalogStatus>
  OpenCTFShowChallenges(rawURL: string): Promise<void>
  ImportCTFShowChallenge(
    problemId: number,
    collaborationMode: string,
    localMaterials: CTFMaterialRequest[],
  ): Promise<CTFShowChallengeWorkspace>
  SubmitCTFShowWebFlag(jobId: string, candidate: string): Promise<CTFShowWebSubmission>
  GetNSSCTFWebBridgeStatus(): Promise<NSSCTFWebBridgeStatus>
  ImportNSSCTFWebPageMaterial(problemId: number): Promise<CTFMaterialRequest>
  ImportNSSCTFWebAttachment(problemId: number): Promise<CTFMaterialRequest>
  SubmitNSSCTFWebFlag(jobId: string, candidate: string): Promise<NSSCTFWebSubmission>
  GetNSSCTFArenaCurrent(): Promise<NSSCTFArenaWorkspace>
  StartNSSCTFArena(): Promise<NSSCTFArenaWorkspace>
  SubmitNSSCTFArenaFlag(jobId: string, attemptId: number, candidate: string): Promise<NSSCTFArenaSubmission>
  AbandonNSSCTFArena(jobId: string, attemptId: number): Promise<NSSCTFArenaWorkspace>
  OpenNSSCTFArena(): Promise<void>
  StartCTFChallenge(request: CTFChallengeRequest): Promise<CTFProjection>
  ListCTFJobs(): Promise<CTFSummary[]>
  GetCTFJob(id: string): Promise<CTFProjection>
  GetCTFArtifactPreview(id: string, artifactId: string): Promise<CTFArtifactPreview>
  RequestCTFEndpoint(id: string, request: CTFEndpointRequestInput): Promise<CTFProjection>
  ApproveCTFEndpoint(id: string, requestId: string): Promise<CTFProjection>
  DenyCTFEndpoint(id: string, requestId: string): Promise<CTFProjection>
  PrepareCTFAgentWorkspace(id: string): Promise<CTFAgentWorkspaceHandoff>
  PrepareCTFToolBuilderWorkspace(id: string): Promise<CTFAgentWorkspaceHandoff>
  PrepareCTFStrategistWorkspace(id: string): Promise<CTFAgentWorkspaceHandoff>
  SaveCTFTrainingMemory(id: string): Promise<CTFTrainingMemory>
  ListCTFMemories(category: string, query: string): Promise<CTFTrainingMemory[]>
  GetCTFMemoryContext(id: string): Promise<CTFTrainingMemory[]>
  ArchiveCTFMemory(id: string, reason: string): Promise<void>
  GetCTFToolWorkshopState(id: string): Promise<CTFToolWorkshopState>
  GetCTFAgentBudgetStatus(id: string): Promise<CTFAgentBudgetStatus>
  GetCTFAgentRunCheckpoint(id: string): Promise<CTFAgentRunCheckpoint | null>
  GetCTFAgentReplay(id: string): Promise<CTFAgentReplay>
  GenerateCTFTrainingReport(id: string): Promise<CTFTrainingReportExport>
  CancelCTFJob(id: string): Promise<void>
  RecordCTFLearning(id: string, request: CTFLearningRecordRequest): Promise<CTFProjection>
  ContinueCTFJob(id: string): Promise<CTFProjection>
  ReviewCTFSubmission(id: string, accepted: boolean, summary: string): Promise<CTFProjection>
  PrepareCTFExternalSubmission(
    id: string,
    candidate: string,
    explanation: string,
  ): Promise<CTFProjection>
  RecordCTFExternalVerdict(
    id: string,
    accepted: boolean,
    summary: string,
  ): Promise<CTFProjection>
  StartPacketParserResearch(): Promise<VulnProjection>
  ListVulnJobs(): Promise<VulnSummary[]>
  GetVulnJob(id: string): Promise<VulnProjection>
  FetchCISAKEVFeed(): Promise<VulnerabilityFeedDownload>
  FetchNVDCVE(cveId: string): Promise<VulnerabilityFeedDownload>
  FetchFIRSTEPSS(cveId: string): Promise<VulnerabilityFeedDownload>
  FetchVulhubPracticeCatalog(): Promise<VulnerabilityFeedDownload>
  RevealVulnerabilityFeedSnapshot(snapshotPath: string): Promise<void>
  ChooseVulnerabilityPracticeDirectory(): Promise<string>
  StartVulnerabilityPractice(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  GetVulnerabilityPracticeStatus(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  StopVulnerabilityPractice(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  SubmitVulnReproduction(id: string, request: VulnReproductionRequest): Promise<VulnProjection>
  RecordVulnLearning(id: string, request: VulnLearningRecordRequest): Promise<VulnProjection>
  CancelVulnJob(id: string): Promise<void>
}

declare global {
  interface Window {
    go?: { main?: { App?: WailsAppBindings } }
    runtime?: {
      EventsOn(event: string, callback: (...data: unknown[]) => void): UnlistenFn
    }
  }
}

const SETTINGS_KEY = 'milksu.dev.settings'
const CONVERSATIONS_KEY = 'milksu.dev.conversations'
const VULN_PROJECTIONS_KEY = 'milksu.dev.vuln-projections'
const CTF_PROJECTIONS_KEY = 'milksu.dev.ctf-projections'
const NSSCTF_CATALOG_KEY = 'milksu.dev.nssctf-catalog'
const CISA_KEV_FEED_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'
const NVD_CVE_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
const FIRST_EPSS_API_URL = 'https://api.first.org/data/v1/epss'
const VULHUB_REPO_API_URL = 'https://api.github.com/repos/vulhub/vulhub'
const VULHUB_REPO_WEB_URL = 'https://github.com/vulhub/vulhub'

const DEFAULT_SETTINGS: AppSettings = {
  active_provider: 'deepseek',
  active_model: 'deepseek-v4-flash',
  model_routing: DEFAULT_MODEL_ROUTING,
  providers: {},
}

function withoutCredentials(settings: AppSettings): AppSettings {
  const providers = Object.fromEntries(Object.entries(settings.providers).map(([name, provider]) => [
    name,
    {
      ...provider,
      api_key: '',
      has_api_key: provider.has_api_key || !!provider.api_key,
      remove_api_key: false,
    },
  ]))
  const relay = settings.relay
    ? {
        ...settings.relay,
        key: '',
        has_key: settings.relay.has_key || !!settings.relay.key,
        remove_key: false,
      }
    : undefined
  const nssctfArena = settings.nssctf_arena
    ? {
        ...settings.nssctf_arena,
        token: '',
        has_token: settings.nssctf_arena.has_token || !!settings.nssctf_arena.token,
        remove_token: false,
      }
    : undefined
  return {
    ...settings,
    providers,
    model_verification: settings.model_verification,
    relay,
    nssctf_arena: nssctfArena,
  }
}

function getWailsApp() {
  return window.go?.main?.App
}

export function hasDesktopRuntime(): boolean {
  return Boolean(getWailsApp())
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Browser preview persistence is best-effort only.
  }
}

async function fetchCISAKEVFeedInBrowser(): Promise<VulnerabilityFeedDownload> {
  const response = await fetch(CISA_KEV_FEED_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`CISA KEV Feed returned HTTP ${response.status}`)
  }
  return {
    sourceName: 'CISA KEV',
    sourceUrl: CISA_KEV_FEED_URL,
    retrievedAt: response.headers.get('last-modified')
      || response.headers.get('date')
      || new Date().toISOString(),
    lastModified: response.headers.get('last-modified') || '',
    httpStatus: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text(),
  }
}

function normalizeFeedCveId(cveId: unknown, sourceName: string) {
  const normalized = String(cveId ?? '').trim().toUpperCase()
  if (!/^CVE-\d{4}-\d{4,}$/.test(normalized)) {
    throw new Error(`${sourceName} sync requires a CVE-YYYY-NNNN id`)
  }
  return normalized
}

async function fetchNVDCVEInBrowser(cveId: unknown): Promise<VulnerabilityFeedDownload> {
  const normalized = normalizeFeedCveId(cveId, 'NVD CVE')
  const url = new URL(NVD_CVE_API_URL)
  url.searchParams.set('cveId', normalized)
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`NVD CVE returned HTTP ${response.status}`)
  }
  return {
    sourceName: 'NVD',
    sourceUrl: url.toString(),
    retrievedAt: response.headers.get('last-modified')
      || response.headers.get('date')
      || new Date().toISOString(),
    lastModified: response.headers.get('last-modified') || '',
    httpStatus: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text(),
  }
}

async function fetchFIRSTEPSSInBrowser(cveId: unknown): Promise<VulnerabilityFeedDownload> {
  const normalized = normalizeFeedCveId(cveId, 'FIRST EPSS')
  const url = new URL(FIRST_EPSS_API_URL)
  url.searchParams.set('cve', normalized)
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`FIRST EPSS returned HTTP ${response.status}`)
  }
  return {
    sourceName: 'FIRST EPSS',
    sourceUrl: url.toString(),
    retrievedAt: response.headers.get('last-modified')
      || response.headers.get('date')
      || new Date().toISOString(),
    lastModified: response.headers.get('last-modified') || '',
    httpStatus: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text(),
  }
}

function pathDirectory(path: string) {
  return path
    .replace(/\/docker-compose\.ya?ml$/i, '')
    .replace(/\/compose\.ya?ml$/i, '')
}

function githubTreePath(path: string) {
  return path.split('/').map(part => encodeURIComponent(part)).join('/')
}

function buildVulhubPracticeCatalogBody(tree: {
  sha?: string
  truncated?: boolean
  tree?: Array<{ path?: string; type?: string }>
}, commitSHA: string, retrievedAt: string) {
  if (tree.truncated) {
    throw new Error('Vulhub catalog GitHub tree response was truncated')
  }
  const composeDirs = new Set<string>()
  for (const entry of tree.tree ?? []) {
    if (entry.type !== 'blob' || !entry.path) continue
    if (!/\/(?:docker-)?compose\.ya?ml$/i.test(entry.path)) continue
    const directory = pathDirectory(entry.path)
    if (directory && directory !== entry.path) composeDirs.add(directory)
  }
  const shortSHA = commitSHA.slice(0, 12) || 'unknown'
  const revision = `vulhub/vulhub master ${shortSHA} · GitHub tree ${tree.sha || 'unknown'} · ${retrievedAt}`
  const items = [...composeDirs]
    .flatMap(directory => {
      const matches = directory.match(/CVE-\d{4}-\d{4,}/ig) ?? []
      return matches.map(cveId => {
        const normalizedCveId = cveId.toUpperCase()
        const component = directory.split('/')[0] || 'Vulhub'
        return {
          cveId: normalizedCveId,
          title: `Vulhub · ${component} · ${normalizedCveId} Docker Compose`,
          directory,
          sourceLabel: `vulhub/${directory}`,
          sourceHref: `${VULHUB_REPO_WEB_URL}/tree/${encodeURIComponent(commitSHA)}/${githubTreePath(directory)}`,
          revision,
          ports: ['待确认端口（需读取 docker-compose.yml）'],
          resources: '待确认镜像缓存、CPU、内存和磁盘占用；启动前由用户确认。',
          network: '默认仅允许本机 loopback；不继承平台 Cookie、Token、浏览器会话或 Provider Credential。',
          cleanup: '停止 compose project，清理临时容器/卷；保留用户笔记和学习证据。',
          safety: [
            '只读 GitHub catalog 同步只绑定目录，不拉取镜像、不启动容器。',
            '开放端口、运行触发输入或访问外部目标都需要用户逐次确认。',
            '练习成功只代表本地学习完成，不证明任何真实资产可被利用。',
          ],
          matchReason: `GitHub 只读目录树发现 ${directory} 含 Docker Compose 与 ${normalizedCveId}；仅作为本地隔离练习候选。`,
          environmentId: `vulhub-${normalizedCveId.toLowerCase()}`,
        }
      })
    })
    .sort((left, right) =>
      left.cveId === right.cveId
        ? left.directory.localeCompare(right.directory)
        : left.cveId.localeCompare(right.cveId),
    )
  return JSON.stringify({
    sourceName: 'Vulhub Practice Catalog',
    sourceUrl: VULHUB_REPO_WEB_URL,
    retrievedAt,
    revision,
    commit: commitSHA,
    itemCount: items.length,
    items,
  }, null, 2)
}

async function fetchVulhubPracticeCatalogInBrowser(): Promise<VulnerabilityFeedDownload> {
  const branchResponse = await fetch(`${VULHUB_REPO_API_URL}/branches/master`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!branchResponse.ok) {
    throw new Error(`Vulhub branch returned HTTP ${branchResponse.status}`)
  }
  const branch = await branchResponse.json() as { commit?: { sha?: string } }
  const commitSHA = branch.commit?.sha?.trim()
  if (!commitSHA) {
    throw new Error('Vulhub branch response did not include commit sha')
  }
  const treeResponse = await fetch(`${VULHUB_REPO_API_URL}/git/trees/${encodeURIComponent(commitSHA)}?recursive=1`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (!treeResponse.ok) {
    throw new Error(`Vulhub tree returned HTTP ${treeResponse.status}`)
  }
  const retrievedAt = treeResponse.headers.get('last-modified')
    || treeResponse.headers.get('date')
    || branchResponse.headers.get('last-modified')
    || branchResponse.headers.get('date')
    || new Date().toISOString()
  return {
    sourceName: 'Vulhub Practice Catalog',
    sourceUrl: VULHUB_REPO_WEB_URL,
    retrievedAt,
    lastModified: treeResponse.headers.get('last-modified') || branchResponse.headers.get('last-modified') || '',
    httpStatus: treeResponse.status,
    contentType: treeResponse.headers.get('content-type') || '',
    body: buildVulhubPracticeCatalogBody(await treeResponse.json(), commitSHA, retrievedAt),
  }
}

function inferCatalogCategory(tags: string[]) {
  const value = tags.join(' ').toLowerCase()
  if (/(php|sql|rce|http|xss|web)/i.test(value)) return 'Web'
  if (/(pwn|栈|堆|格式化字符串|glibc)/i.test(value)) return 'Pwn'
  if (/(逆向|reverse|android|ida)/i.test(value)) return 'Reverse'
  if (/(rsa|aes|密码|crypto|编码分析)/i.test(value)) return 'Crypto'
  if (/(取证|流量|日志|隐写|压缩包|pcap)/i.test(value)) return 'Forensics'
  return 'Misc'
}

function defaultAbilityDimensions(): CTFAbilityDimension[] {
  return [
    ['web', 'Web'],
    ['pwn', 'Pwn'],
    ['reverse', 'Reverse'],
    ['crypto', 'Crypto'],
    ['forensics', '取证'],
    ['misc', 'Misc'],
  ].map(([key, label]) => ({
    key,
    label,
    score: 20,
    confidence: 0,
    attempts: 0,
    profileAttempts: 0,
    solved: 0,
    judgeVerifiedSolved: 0,
    userConfirmedSolved: 0,
    independentSolved: 0,
    hintAssistedSolved: 0,
    copilotSolved: 0,
    delegatedSolved: 0,
    importedSolved: 0,
  }))
}

function previewTrainingSeries(problems: NSSCTFCatalogProblem[]): NSSCTFTrainingSeries[] {
  const groups = new Map<string, NSSCTFCatalogProblem[]>()
  for (const problem of problems) {
    const name = /^\[([^\]]{3,80})\]|^【([^】]{3,80})】/.exec(problem.title)?.slice(1).find(Boolean)
    if (!name) continue
    groups.set(name, [...(groups.get(name) ?? []), problem])
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length >= 3)
    .map(([name, values]) => {
      const sorted = [...values].sort((left, right) => (
        (left.difficulty <= 0 ? 1 : 0) - (right.difficulty <= 0 ? 1 : 0)
          || left.difficulty - right.difficulty
          || left.platformId - right.platformId
      ))
      const knownDifficulties = values.filter(problem => problem.difficulty > 0)
      return {
        name,
        derivedFrom: 'title-prefix' as const,
        problemCount: values.length,
        attemptedCount: 0,
        completedCount: 0,
        attemptedProblemIds: [],
        completedProblemIds: [],
        nextProblemId: sorted[0]?.platformId,
        averageDifficulty: knownDifficulties.length
          ? Math.round(
              knownDifficulties.reduce((total, problem) => total + problem.difficulty, 0)
                / knownDifficulties.length * 10,
            ) / 10
          : 0,
        categories: [...new Set(values.map(problem => problem.category))].sort(),
        problems: sorted,
      }
    })
    .sort((left, right) => right.problemCount - left.problemCount || left.name.localeCompare(right.name))
    .slice(0, 8)
}

export async function invokeCommand<T = unknown>(command: string, args?: CommandArgs): Promise<T> {
  const app = getWailsApp()
  if (app) {
    switch (command) {
      case 'get_settings':
        return app.GetSettings() as Promise<T>
      case 'save_settings_cmd':
        return app.SaveSettingsCmd(args?.newSettings as AppSettings) as Promise<T>
      case 'get_local_data_status':
        return app.GetLocalDataStatus() as Promise<T>
      case 'export_local_data_backup':
        return app.ExportLocalDataBackup() as Promise<T>
      case 'schedule_local_data_restore':
        return app.ScheduleLocalDataRestore() as Promise<T>
      case 'export_local_diagnostics':
        return app.ExportLocalDiagnostics() as Promise<T>
      case 'reveal_local_data_directory':
        return app.RevealLocalDataDirectory() as Promise<T>
      case 'get_startup_recovery_status':
        return app.GetStartupRecoveryStatus() as Promise<T>
      case 'get_session_index_status':
        return app.GetSessionIndexStatus() as Promise<T>
      case 'refresh_session_index':
        return app.RefreshSessionIndex() as Promise<T>
      case 'search_session_history':
        return app.SearchSessionHistory(args?.request as SessionHistorySearchRequest) as Promise<T>
      case 'import_external_session_history':
        return app.ImportExternalSessionHistory(args?.request as ExternalSessionHistoryImportRequest) as Promise<T>
      case 'list_conversations':
        return app.ListConversations() as Promise<T>
      case 'save_conversation':
        return app.SaveConversation(args?.conversation) as Promise<T>
      case 'delete_conversation':
        return app.DeleteConversation(args?.id as string) as Promise<T>
      case 'choose_agent_workspace':
        return app.ChooseAgentWorkspace() as Promise<T>
      case 'choose_ctf_materials':
        return app.ChooseCTFMaterials() as Promise<T>
      case 'choose_coding_attachments':
        return app.ChooseCodingAttachments() as Promise<T>
      case 'send_message':
        return app.SendMessage(
          args?.conversationId as string,
          args?.prompt as string,
          args?.workspacePath as string,
          (args?.modelMode as string) ?? '',
          (args?.modelProvider as string) ?? '',
          (args?.modelId as string) ?? '',
          (args?.executionMode as string) ?? '',
          (args?.approvalPolicy as string) ?? '',
          (args?.mcpConfigDigest as string) ?? '',
          (args?.mcpServers as string[]) ?? [],
          (args?.attachments as CodingAttachment[]) ?? [],
        ) as Promise<T>
      case 'abort_message':
        return app.AbortMessage(args?.conversationId as string) as Promise<T>
      case 'respond_tool_approval':
        return app.RespondToolApproval(
          args?.conversationId as string,
          args?.requestId as string,
          args?.approved as boolean,
        ) as Promise<T>
      case 'get_runtime_status':
        return app.GetRuntimeStatus(
          (args?.conversationId as string) ?? '',
        ) as Promise<T>
      case 'refresh_coding_background_tasks':
        return app.RefreshCodingBackgroundTasks(
          args?.conversationId as string,
          args?.workspacePath as string,
          (args?.executionMode as string) ?? 'go',
          (args?.approvalPolicy as string) ?? 'workspace-auto',
        ) as Promise<T>
      case 'start_coding_background_task':
        return app.StartCodingBackgroundTask(
          args?.conversationId as string,
          args?.workspacePath as string,
          args?.command as string,
          (args?.name as string) ?? '',
          (args?.executionMode as string) ?? 'go',
          (args?.approvalPolicy as string) ?? 'workspace-auto',
        ) as Promise<T>
      case 'stop_coding_background_task':
        return app.StopCodingBackgroundTask(
          args?.conversationId as string,
          args?.taskId as string,
        ) as Promise<T>
      case 'compact_coding_session':
        return app.CompactCodingSession(
          args?.conversationId as string,
        ) as Promise<T>
      case 'list_coding_terminals':
        return app.ListCodingTerminals(
          args?.conversationId as string,
        ) as Promise<T>
      case 'start_coding_terminal':
        return app.StartCodingTerminal(
          args?.conversationId as string,
          args?.workspacePath as string,
          Number(args?.columns ?? 100),
          Number(args?.rows ?? 28),
        ) as Promise<T>
      case 'write_coding_terminal':
        return app.WriteCodingTerminal(
          args?.conversationId as string,
          args?.terminalId as string,
          args?.data as string,
        ) as Promise<T>
      case 'resize_coding_terminal':
        return app.ResizeCodingTerminal(
          args?.conversationId as string,
          args?.terminalId as string,
          Number(args?.columns ?? 100),
          Number(args?.rows ?? 28),
        ) as Promise<T>
      case 'stop_coding_terminal':
        return app.StopCodingTerminal(
          args?.conversationId as string,
          args?.terminalId as string,
        ) as Promise<T>
      case 'get_coding_environment':
        return app.GetCodingEnvironment(args?.workspacePath as string) as Promise<T>
      case 'get_coding_mcp_config':
        return app.GetCodingMCPConfig(args?.workspacePath as string) as Promise<T>
      case 'get_coding_diff':
        return app.GetCodingDiff(
          args?.workspacePath as string,
          args?.relativePath as string,
        ) as Promise<T>
      case 'apply_coding_git_action':
        return app.ApplyCodingGitAction(
          args?.workspacePath as string,
          args?.action as CodingGitAction,
          (args?.relativePath as string) ?? '',
          (args?.message as string) ?? '',
        ) as Promise<T>
      case 'apply_coding_git_hunk_action':
        return app.ApplyCodingGitHunkAction(
          args?.workspacePath as string,
          args?.action as CodingGitHunkAction,
          (args?.relativePath as string) ?? '',
          (args?.patch as string) ?? '',
        ) as Promise<T>
      case 'prepare_coding_pull_request':
        return app.PrepareCodingPullRequest(
          args?.workspacePath as string,
        ) as Promise<T>
      case 'publish_coding_pull_request':
        return app.PublishCodingPullRequest(
          args?.workspacePath as string,
          args?.confirmationToken as string,
          (args?.title as string) ?? '',
          (args?.body as string) ?? '',
        ) as Promise<T>
      case 'prepare_coding_collaboration':
        return app.PrepareCodingCollaboration(
          args?.conversationId as string,
          args?.workspacePath as string,
          Number(args?.writers ?? 1),
        ) as Promise<T>
      case 'get_coding_collaboration':
        return app.GetCodingCollaboration(
          args?.conversationId as string,
          args?.workspacePath as string,
        ) as Promise<T>
      case 'finish_coding_collaboration':
        return app.FinishCodingCollaboration(
          args?.conversationId as string,
          args?.workspacePath as string,
        ) as Promise<T>
      case 'get_coding_architecture_preview':
        return app.GetCodingArchitecturePreview(
          args?.workspacePath as string,
          args?.relativePath as string,
        ) as Promise<T>
      case 'get_coding_artifact_preview':
        return app.GetCodingArtifactPreview(
          args?.workspacePath as string,
          args?.relativePath as string,
        ) as Promise<T>
      case 'get_coding_artifact_preview_webview_smoke_request':
        return app.GetCodingArtifactPreviewWebViewSmokeRequest() as Promise<T>
      case 'complete_coding_artifact_preview_webview_smoke':
        return app.CompleteCodingArtifactPreviewWebViewSmoke(
          (args?.report as Record<string, unknown>) ?? {},
        ) as Promise<T>
      case 'start_coding_browser':
        return app.StartCodingBrowser(
          args?.conversationId as string,
          args?.initialUrl as string,
        ) as Promise<T>
      case 'get_coding_browser_status':
        return app.GetCodingBrowserStatus(
          args?.conversationId as string,
        ) as Promise<T>
      case 'stop_coding_browser':
        return app.StopCodingBrowser(
          args?.conversationId as string,
        ) as Promise<T>
      case 'reveal_coding_browser_evidence':
        return app.RevealCodingBrowserEvidence(
          args?.conversationId as string,
        ) as Promise<T>
      case 'get_coding_computer_use_status':
        return app.GetCodingComputerUseStatus() as Promise<T>
      case 'list_coding_computer_use_targets':
        return app.ListCodingComputerUseTargets() as Promise<T>
      case 'request_coding_computer_use_permissions':
        return app.RequestCodingComputerUsePermissions() as Promise<T>
      case 'start_coding_computer_use':
        return app.StartCodingComputerUse(
          args?.conversationId as string,
          args?.targetPid as number,
          args?.targetWindowId as number,
        ) as Promise<T>
      case 'stop_coding_computer_use':
        return app.StopCodingComputerUse(
          args?.conversationId as string,
        ) as Promise<T>
      case 'test_agent_model':
        return app.TestAgentModel() as Promise<T>
      case 'start_sample_ctf':
        return app.StartSampleCTF() as Promise<T>
      case 'import_nssctf_challenge':
        return app.ImportNSSCTFChallenge(args?.url as string) as Promise<T>
      case 'sync_nssctf_catalog':
        return app.SyncNSSCTFCatalog(args?.url as string) as Promise<T>
      case 'get_nssctf_training_dashboard':
        return app.GetNSSCTFTrainingDashboard() as Promise<T>
      case 'list_nssctf_catalog':
        return app.ListNSSCTFCatalog(args?.query as NSSCTFCatalogQuery) as Promise<T>
      case 'get_ctf_training_platforms':
        return app.GetCTFTrainingPlatforms() as Promise<T>
      case 'list_managed_lab_packages':
        return app.ListManagedLabPackages() as Promise<T>
      case 'list_managed_lab_instances':
        return app.ListManagedLabInstances() as Promise<T>
      case 'get_managed_lab_instance':
        return app.GetManagedLabInstance(args?.instanceId as string) as Promise<T>
      case 'start_managed_lab':
        return app.StartManagedLab(args?.packageId as string) as Promise<T>
      case 'reset_managed_lab':
        return app.ResetManagedLab(args?.instanceId as string) as Promise<T>
      case 'stop_managed_lab':
        return app.StopManagedLab(args?.instanceId as string) as Promise<T>
      case 'destroy_managed_lab':
        return app.DestroyManagedLab(args?.instanceId as string) as Promise<T>
      case 'open_managed_lab':
        return app.OpenManagedLab(args?.instanceId as string) as Promise<T>
      case 'get_managed_lab_access':
        return app.GetManagedLabAccess(args?.instanceId as string) as Promise<T>
      case 'start_managed_lab_training':
        return app.StartManagedLabTraining(
          args?.instanceId as string,
          args?.collaborationMode as string,
        ) as Promise<T>
      case 'check_managed_lab_training':
        return app.CheckManagedLabTraining(
          args?.instanceId as string,
          args?.jobId as string,
        ) as Promise<T>
      case 'open_nssctf_challenge':
        return app.OpenNSSCTFChallenge(args?.url as string) as Promise<T>
      case 'open_ctf_source_url':
        return app.OpenCTFSourceURL(args?.url as string) as Promise<T>
      case 'open_chrome_extension_manager':
        return app.OpenChromeExtensionManager() as Promise<T>
      case 'reveal_browser_extension':
        return app.RevealBrowserExtension() as Promise<T>
      case 'get_ctfshow_catalog_status':
        return app.GetCTFShowCatalogStatus() as Promise<T>
      case 'open_ctfshow_challenges':
        return app.OpenCTFShowChallenges((args?.url as string) ?? '') as Promise<T>
      case 'import_ctfshow_challenge':
        return app.ImportCTFShowChallenge(
          args?.problemId as number,
          args?.collaborationMode as string,
          (args?.localMaterials as CTFMaterialRequest[]) ?? [],
        ) as Promise<T>
      case 'submit_ctfshow_web_flag':
        return app.SubmitCTFShowWebFlag(
          args?.jobId as string,
          args?.candidate as string,
        ) as Promise<T>
      case 'get_nssctf_web_bridge_status':
        return app.GetNSSCTFWebBridgeStatus() as Promise<T>
      case 'import_nssctf_web_page_material':
        return app.ImportNSSCTFWebPageMaterial(args?.problemId as number) as Promise<T>
      case 'import_nssctf_web_attachment':
        return app.ImportNSSCTFWebAttachment(args?.problemId as number) as Promise<T>
      case 'submit_nssctf_web_flag':
        return app.SubmitNSSCTFWebFlag(
          args?.jobId as string,
          args?.candidate as string,
        ) as Promise<T>
      case 'get_nssctf_arena_current':
        return app.GetNSSCTFArenaCurrent() as Promise<T>
      case 'start_nssctf_arena':
        return app.StartNSSCTFArena() as Promise<T>
      case 'submit_nssctf_arena_flag':
        return app.SubmitNSSCTFArenaFlag(
          args?.jobId as string,
          args?.attemptId as number,
          args?.candidate as string,
        ) as Promise<T>
      case 'abandon_nssctf_arena':
        return app.AbandonNSSCTFArena(args?.jobId as string, args?.attemptId as number) as Promise<T>
      case 'open_nssctf_arena':
        return app.OpenNSSCTFArena() as Promise<T>
      case 'start_ctf_challenge':
        return app.StartCTFChallenge(args?.request as CTFChallengeRequest) as Promise<T>
      case 'list_ctf_jobs':
        return app.ListCTFJobs() as Promise<T>
      case 'get_ctf_job':
        return app.GetCTFJob(args?.id as string) as Promise<T>
      case 'get_ctf_artifact_preview':
        return app.GetCTFArtifactPreview(
          args?.id as string,
          args?.artifactId as string,
        ) as Promise<T>
      case 'request_ctf_endpoint':
        return app.RequestCTFEndpoint(
          args?.id as string,
          args?.request as CTFEndpointRequestInput,
        ) as Promise<T>
      case 'approve_ctf_endpoint':
        return app.ApproveCTFEndpoint(
          args?.id as string,
          args?.requestId as string,
        ) as Promise<T>
      case 'deny_ctf_endpoint':
        return app.DenyCTFEndpoint(
          args?.id as string,
          args?.requestId as string,
        ) as Promise<T>
      case 'prepare_ctf_agent_workspace':
        return app.PrepareCTFAgentWorkspace(args?.id as string) as Promise<T>
      case 'prepare_ctf_tool_builder_workspace':
        return app.PrepareCTFToolBuilderWorkspace(args?.id as string) as Promise<T>
      case 'prepare_ctf_strategist_workspace':
        return app.PrepareCTFStrategistWorkspace(args?.id as string) as Promise<T>
      case 'get_ctf_tool_workshop_state':
        return app.GetCTFToolWorkshopState(args?.id as string) as Promise<T>
      case 'save_ctf_training_memory':
        return app.SaveCTFTrainingMemory(args?.id as string) as Promise<T>
      case 'list_ctf_memories':
        return app.ListCTFMemories(
          (args?.category as string) ?? '',
          (args?.query as string) ?? '',
        ) as Promise<T>
      case 'get_ctf_memory_context':
        return app.GetCTFMemoryContext(args?.id as string) as Promise<T>
      case 'archive_ctf_memory':
        return app.ArchiveCTFMemory(
          args?.id as string,
          args?.reason as string,
        ) as Promise<T>
      case 'get_ctf_agent_budget_status':
        return app.GetCTFAgentBudgetStatus(args?.id as string) as Promise<T>
      case 'get_ctf_agent_run_checkpoint':
        return app.GetCTFAgentRunCheckpoint(args?.id as string) as Promise<T>
      case 'get_ctf_agent_replay':
        return app.GetCTFAgentReplay(args?.id as string) as Promise<T>
      case 'generate_ctf_training_report':
        return app.GenerateCTFTrainingReport(args?.id as string) as Promise<T>
      case 'cancel_ctf_job':
        return app.CancelCTFJob(args?.id as string) as Promise<T>
      case 'record_ctf_learning':
        return app.RecordCTFLearning(args?.id as string, args?.request as CTFLearningRecordRequest) as Promise<T>
      case 'continue_ctf_job':
        return app.ContinueCTFJob(args?.id as string) as Promise<T>
      case 'review_ctf_submission':
        return app.ReviewCTFSubmission(args?.id as string, args?.accepted as boolean, args?.summary as string) as Promise<T>
      case 'prepare_ctf_external_submission':
        return app.PrepareCTFExternalSubmission(
          args?.id as string,
          args?.candidate as string,
          args?.explanation as string,
        ) as Promise<T>
      case 'record_ctf_external_verdict':
        return app.RecordCTFExternalVerdict(
          args?.id as string,
          args?.accepted as boolean,
          args?.summary as string,
        ) as Promise<T>
      case 'start_packet_parser_research':
        return app.StartPacketParserResearch() as Promise<T>
      case 'list_vuln_jobs':
        return app.ListVulnJobs() as Promise<T>
      case 'get_vuln_job':
        return app.GetVulnJob(args?.id as string) as Promise<T>
      case 'fetch_cisa_kev_feed':
        return app.FetchCISAKEVFeed() as Promise<T>
      case 'fetch_nvd_cve':
        return app.FetchNVDCVE(args?.cveId as string) as Promise<T>
      case 'fetch_first_epss':
        return app.FetchFIRSTEPSS(args?.cveId as string) as Promise<T>
      case 'fetch_vulhub_practice_catalog':
        return app.FetchVulhubPracticeCatalog() as Promise<T>
      case 'reveal_vulnerability_feed_snapshot':
        return app.RevealVulnerabilityFeedSnapshot(args?.snapshotPath as string) as Promise<T>
      case 'choose_vulnerability_practice_directory':
        return app.ChooseVulnerabilityPracticeDirectory() as Promise<T>
      case 'start_vulnerability_practice':
        return app.StartVulnerabilityPractice(args?.request as VulnerabilityPracticeRequest) as Promise<T>
      case 'get_vulnerability_practice_status':
        return app.GetVulnerabilityPracticeStatus(args?.request as VulnerabilityPracticeRequest) as Promise<T>
      case 'stop_vulnerability_practice':
        return app.StopVulnerabilityPractice(args?.request as VulnerabilityPracticeRequest) as Promise<T>
      case 'submit_vuln_reproduction':
        return app.SubmitVulnReproduction(args?.id as string, args?.request as VulnReproductionRequest) as Promise<T>
      case 'record_vuln_learning':
        return app.RecordVulnLearning(args?.id as string, args?.request as VulnLearningRecordRequest) as Promise<T>
      case 'cancel_vuln_job':
        return app.CancelVulnJob(args?.id as string) as Promise<T>
      default:
        throw new Error(`Unsupported desktop command: ${command}`)
    }
  }

  switch (command) {
    case 'get_settings':
      return withAppSettingsDefaults(readJson(SETTINGS_KEY, DEFAULT_SETTINGS)) as T
    case 'save_settings_cmd':
      writeJson(SETTINGS_KEY, withoutCredentials((args?.newSettings as AppSettings | undefined) ?? DEFAULT_SETTINGS))
      return undefined as T
    case 'get_local_data_status':
      return {
        directory: 'MilkSU 用户数据目录',
        fileCount: 0,
        bytes: 0,
      } as T
    case 'export_local_data_backup':
    case 'schedule_local_data_restore':
    case 'export_local_diagnostics':
    case 'reveal_local_data_directory':
      throw new Error('本地数据管理需要 MilkSU 桌面运行时。')
    case 'get_startup_recovery_status':
      return {
        previousExit: 'none',
        consecutiveAbnormalExits: 0,
        startedAt: new Date().toISOString(),
      } as T
    case 'get_session_index_status':
      return {
        available: false,
        mode: 'browser-preview',
        indexPath: '',
        checkedAt: new Date().toISOString(),
        readOnly: true,
        reason: '打包 App 中会自动维护本机历史。',
        sessionCount: 0,
        messageCount: 0,
        toolCallCount: 0,
        memoryCount: 0,
        sources: [],
      } as T
    case 'refresh_session_index':
      return {
        indexedAt: new Date().toISOString(),
        indexPath: '',
        source: 'browser-preview',
        sessionCount: 0,
        messageCount: 0,
        toolCallCount: 0,
      } as T
    case 'search_session_history':
      return {
        query: String((args?.request as SessionHistorySearchRequest | undefined)?.query ?? ''),
        searchedAt: new Date().toISOString(),
        status: {
          available: false,
          mode: 'browser-preview',
          indexPath: '',
          checkedAt: new Date().toISOString(),
          readOnly: true,
          sessionCount: 0,
          messageCount: 0,
          toolCallCount: 0,
          memoryCount: 0,
          sources: [],
        },
        results: [],
      } as T
    case 'import_external_session_history':
      throw new Error('请在 MilkSU 桌面应用中导入外部历史。')
    case 'list_conversations':
      return readJson(CONVERSATIONS_KEY, []) as T
    case 'save_conversation': {
      const conversation = args?.conversation as { id?: string } | undefined
      if (!conversation?.id) return undefined as T
      const conversations = readJson<Array<{ id: string }>>(CONVERSATIONS_KEY, [])
      writeJson(CONVERSATIONS_KEY, [
        conversation,
        ...conversations.filter(item => item.id !== conversation.id),
      ])
      return undefined as T
    }
    case 'delete_conversation': {
      const id = args?.id
      if (typeof id !== 'string') return undefined as T
      const conversations = readJson<Array<{ id: string }>>(CONVERSATIONS_KEY, [])
      writeJson(CONVERSATIONS_KEY, conversations.filter(item => item.id !== id))
      return undefined as T
    }
    case 'choose_agent_workspace':
      throw new Error('请在 MilkSU 桌面应用中选择项目目录。')
    case 'choose_coding_attachments':
      throw new Error('请在 MilkSU 桌面应用中选择文件或图片。')
    case 'list_managed_lab_packages':
    case 'list_managed_lab_instances':
      return [] as T
    case 'get_managed_lab_instance':
    case 'start_managed_lab':
    case 'reset_managed_lab':
    case 'stop_managed_lab':
    case 'destroy_managed_lab':
    case 'open_managed_lab':
    case 'get_managed_lab_access':
    case 'start_managed_lab_training':
    case 'check_managed_lab_training':
      throw new Error('请在 MilkSU 桌面应用中管理本地靶场。')
    case 'send_message':
      throw new Error('Agent bridge requires the Wails desktop runtime.')
    case 'prepare_ctf_tool_builder_workspace':
    case 'prepare_ctf_strategist_workspace':
    case 'get_ctf_tool_workshop_state':
      throw new Error('CTF 多 Agent 协作需要 MilkSU 桌面运行时。')
    case 'save_ctf_training_memory':
    case 'list_ctf_memories':
    case 'get_ctf_memory_context':
    case 'archive_ctf_memory':
      throw new Error('CTF 记忆层需要 MilkSU 桌面运行时。')
    case 'test_agent_model':
      throw new Error('模型验证需要 MilkSU 桌面运行时。')
    case 'import_ctfshow_challenge':
    case 'submit_ctfshow_web_flag':
      throw new Error('CTFshow browser bridge requires the MilkSU desktop runtime.')
    case 'abort_message':
    case 'respond_tool_approval':
      return undefined as T
    case 'get_runtime_status':
      return {
        defaultEngine: 'pi',
        running: false,
        sessionCount: 0,
        protocol: 'browser-preview',
        backgroundTasks: [],
      } as T
    case 'stop_coding_background_task':
    case 'start_coding_background_task':
      throw new Error('后台任务控制需要 MilkSU 桌面运行时。')
    case 'start_coding_terminal':
    case 'write_coding_terminal':
    case 'resize_coding_terminal':
    case 'stop_coding_terminal':
      throw new Error('交互式项目终端需要 MilkSU 桌面运行时。')
    case 'list_coding_terminals':
      return [] as T
    case 'refresh_coding_background_tasks':
      return {
        defaultEngine: 'pi',
        running: false,
        sessionCount: 0,
        protocol: 'browser-preview',
        backgroundTasks: [],
      } as T
    case 'get_coding_environment': {
      const workspace = String(args?.workspacePath ?? '')
      const name = workspace.replace(/\/+$/, '').split('/').at(-1) || 'workspace'
      return {
        workspace,
        workspaceName: name,
        capturedAt: new Date().toISOString(),
        git: {
          available: false,
          isRepository: false,
          ahead: 0,
          behind: 0,
          changedFiles: 0,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          additions: 0,
          deletions: 0,
          dirty: false,
          problem: 'Git 状态只在 MilkSU 桌面运行时读取。',
          changes: [],
        },
      } as T
    }
    case 'get_coding_mcp_config':
      return {
        workspace: String(args?.workspacePath ?? ''),
        configured: false,
        servers: [],
        problem: 'MCP 服务器只在 MilkSU 桌面运行时读取。',
      } as T
    case 'get_coding_diff':
      throw new Error('Git Diff 只在 MilkSU 桌面运行时读取。')
    case 'prepare_coding_collaboration':
    case 'finish_coding_collaboration':
      throw new Error('Git worktree 协作需要 MilkSU 桌面运行时。')
    case 'get_coding_collaboration':
      return {
        schemaVersion: 1,
        conversationId: String(args?.conversationId ?? ''),
        workspace: String(args?.workspacePath ?? ''),
        phase: 'completed',
        active: false,
        canFinish: false,
        worktrees: [],
        problem: 'Git worktree 协作只在 MilkSU 桌面运行时可用。',
      } as T
    case 'get_coding_artifact_preview':
      throw new Error('工作区产物预览需要 MilkSU 桌面运行时。')
    case 'get_coding_artifact_preview_webview_smoke_request':
      return { enabled: false } as T
    case 'complete_coding_artifact_preview_webview_smoke':
      throw new Error('HTML 产物 WebView smoke 只在 MilkSU 桌面运行时可用。')
    case 'start_coding_browser':
    case 'stop_coding_browser':
      throw new Error('隔离 Coding 浏览器需要 MilkSU 桌面运行时。')
    case 'reveal_coding_browser_evidence':
      throw new Error('在 Finder 中显示浏览器证据需要 MilkSU 桌面运行时。')
    case 'get_coding_browser_status':
      return {
        enabled: false,
        conversationId: String(args?.conversationId ?? ''),
        phase: 'disabled',
        pages: [],
      } as T
    case 'get_coding_computer_use_status':
    case 'request_coding_computer_use_permissions':
      return {
        available: false,
        enabled: false,
        phase: 'unavailable',
        driverVersion: '0.14.2',
        permissions: {
          accessibility: false,
          screenRecording: false,
        },
        problem: 'Computer Use 需要 MilkSU 桌面运行时；浏览器预览只能验证 UI 文案和入口。',
      } as T
    case 'list_coding_computer_use_targets':
      return [] as T
    case 'start_coding_computer_use':
    case 'stop_coding_computer_use':
      throw new Error('Computer Use 可见 App 会话需要 MilkSU 桌面运行时。')
    case 'list_ctf_jobs': {
      const projections = readJson<Record<string, CTFProjection>>(CTF_PROJECTIONS_KEY, {})
      return Object.values(projections)
        .map(summarizePreviewCTF)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) as T
    }
    case 'start_ctf_challenge': {
      const request = args?.request as CTFChallengeRequest
      const projection = createPreviewCTFProjection(request)
      const projections = readJson<Record<string, CTFProjection>>(CTF_PROJECTIONS_KEY, {})
      writeJson(CTF_PROJECTIONS_KEY, { ...projections, [projection.job.id]: projection })
      return projection as T
    }
    case 'get_ctf_job': {
      const id = args?.id as string
      const projections = readJson<Record<string, CTFProjection>>(CTF_PROJECTIONS_KEY, {})
      const projection = projections[id]
      if (!projection) throw new Error(`CTF preview job not found: ${id}`)
      return projection as T
    }
    case 'list_vuln_jobs': {
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      return Object.values(projections)
        .map(summarizeDemoVuln)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) as T
    }
    case 'start_packet_parser_research': {
      const projection = createDemoVulnProjection(false)
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      writeJson(VULN_PROJECTIONS_KEY, { ...projections, [projection.job.id]: projection })
      return projection as T
    }
    case 'fetch_cisa_kev_feed':
      return await fetchCISAKEVFeedInBrowser() as T
    case 'fetch_nvd_cve':
      return await fetchNVDCVEInBrowser(args?.cveId) as T
    case 'fetch_first_epss':
      return await fetchFIRSTEPSSInBrowser(args?.cveId) as T
    case 'fetch_vulhub_practice_catalog':
      return await fetchVulhubPracticeCatalogInBrowser() as T
    case 'reveal_vulnerability_feed_snapshot':
      throw new Error('在 Finder 中显示 CVE Feed 快照需要 MilkSU 桌面运行时。')
    case 'choose_vulnerability_practice_directory':
    case 'start_vulnerability_practice':
    case 'get_vulnerability_practice_status':
    case 'stop_vulnerability_practice':
      throw new Error('CVE 本地练习环境生命周期需要 MilkSU 桌面运行时。')
    case 'import_nssctf_challenge': {
      const normalized = normalizeNSSCTFProblemURL(args?.url as string)
      const response = await fetch(`/nssctf-api/problem/v2/${normalized.id}/`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`NSSCTF 返回 HTTP ${response.status}`)
      return challengeFromNSSCTFAPI(await response.json(), normalized.id) as T
    }
    case 'sync_nssctf_catalog': {
      const response = await fetch('/nssctf-api/problem/v3/list/1/20/', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 0,
          contest: '',
          year: '',
          source: 0,
          name: '',
          username: '',
          type: 0,
          docker: 0,
          tag: [],
          tagType: 0,
          point: [1, 1000],
          rate: [0, 5],
          date: '',
          state: '',
          unknownFlag: 0,
          order: 'point',
          orderType: 0,
        }),
      })
      if (!response.ok) throw new Error(`NSSCTF 返回 HTTP ${response.status}`)
      const payload = await response.json() as {
        code: number
        data?: {
          problems?: Array<{
            id: number
            title: string
            tag: string[]
            wp: boolean
            point: number
            info: { solved: number; wrong: number; no: number }
            level: number
            open: boolean
          }>
        }
      }
      if (payload.code !== 200 || !Array.isArray(payload.data?.problems)) {
        throw new Error('NSSCTF 没有返回有效题库列表')
      }
      const syncedAt = new Date().toISOString()
      const problems: NSSCTFCatalogProblem[] = payload.data.problems.map(problem => ({
        platformId: problem.id,
        sourceUrl: `https://www.nssctf.cn/problem/${problem.id}`,
        title: problem.title,
        category: inferCatalogCategory(problem.tag),
        points: problem.point,
        difficulty: problem.level,
        tags: problem.tag,
        hasWriteup: problem.wp,
        solvedCount: problem.info.solved,
        wrongAnswerCount: problem.info.wrong,
        noAnswerCount: problem.info.no,
        open: problem.open,
        syncedAt,
      }))
      writeJson(NSSCTF_CATALOG_KEY, { syncedAt, problems })
      return {
        sourceUrl: 'https://www.nssctf.cn/problem',
        total: problems.length,
        pages: 1,
        syncedAt,
      } as T
    }
    case 'get_nssctf_training_dashboard': {
      const cached = readJson<{ syncedAt?: string; problems?: NSSCTFCatalogProblem[] }>(
        NSSCTF_CATALOG_KEY,
        {},
      )
      const dimensions = defaultAbilityDimensions()
      const recommendations: NSSCTFRecommendation[] = (cached.problems ?? [])
        .filter(problem => problem.open)
        .slice(0, 6)
        .map(problem => ({
          problem,
          kind: '校准',
          reason: `${problem.category} 当前为冷启动画像；难度 ${problem.difficulty.toFixed(1)}，适合作为第一批校准题。`,
          score: 70,
        }))
      return {
        catalogTotal: cached.problems?.length ?? 0,
        lastSyncedAt: cached.syncedAt ?? '',
        overallScore: 0,
        overallConfidence: 0,
        realAttemptCount: 0,
        realSolvedCount: 0,
        judgeVerifiedSolvedCount: 0,
        userConfirmedSolvedCount: 0,
        acceptance: {
          requiredTracks: dimensions.length,
          judgeVerifiedTracks: 0,
          ready: false,
          tracks: dimensions.map(dimension => ({
            key: dimension.key,
            label: dimension.label,
            status: 'missing',
            attempts: 0,
            judgeVerifiedSolved: 0,
            userConfirmedSolved: 0,
          })),
        },
        sources: [],
        dimensions,
        recommendations,
        series: previewTrainingSeries(cached.problems ?? []),
      } as T
    }
    case 'list_nssctf_catalog': {
      const cached = readJson<{ problems?: NSSCTFCatalogProblem[] }>(NSSCTF_CATALOG_KEY, {})
      const request = args?.query as NSSCTFCatalogQuery | undefined
      const query = request?.query.trim().toLowerCase() ?? ''
      const idQuery = query.replace(/^p/, '')
      const category = request?.category ?? 'all'
      const pageSize = [10, 20, 40].includes(request?.pageSize ?? 0) ? request!.pageSize : 20
      const matching = (cached.problems ?? [])
        .filter(problem => {
          if (category !== 'all' && problem.category !== category) return false
          if (!query) return true
          return String(problem.platformId).includes(idQuery)
            || problem.title.toLowerCase().includes(query)
            || problem.tags.some(tag => tag.toLowerCase().includes(query))
        })
        .sort((left, right) => right.platformId - left.platformId)
      const pageCount = matching.length ? Math.ceil(matching.length / pageSize) : 0
      const page = pageCount
        ? Math.min(Math.max(request?.page ?? 1, 1), pageCount)
        : 1
      return {
        problems: matching.slice((page - 1) * pageSize, page * pageSize),
        categories: [...new Set((cached.problems ?? []).map(problem => problem.category))]
          .filter(Boolean)
          .sort(),
        attemptedProblemIds: [],
        completedProblemIds: [],
        total: matching.length,
        page,
        pageSize,
        pageCount,
      } as T
    }
    case 'get_ctf_training_platforms':
      return [
        {
          id: 'nssctf',
          name: 'NSSCTF',
          experience: 'competition-and-challenge-library',
          status: 'ready',
          adapter: 'public-api-and-browser-bridge',
          selectable: true,
          capabilities: ['catalog', 'challenge', 'materials', 'judge', 'agent-arena'],
          sourceUrl: 'https://www.nssctf.cn/problem',
        },
        {
          id: 'ctfshow',
          name: 'CTFshow',
          experience: 'challenge-library',
          status: 'ready',
          adapter: 'browser-bridge',
          selectable: true,
          capabilities: ['catalog', 'challenge', 'materials', 'judge'],
          sourceUrl: 'https://ctf.show/challenges',
        },
        {
          id: 'hackthebox',
          name: 'HTB Labs',
          experience: 'interactive-lab',
          status: 'restricted',
          adapter: 'permission-gated-official-labs',
          selectable: false,
          capabilities: ['machines', 'starting-point', 'challenges', 'human-only', 'written-permission'],
          requirement: 'HTB written permission or an AI Range entitlement is required before Agent use',
          sourceUrl: 'https://app.hackthebox.com/machines',
        },
        {
          id: 'tryhackme',
          name: 'TryHackMe',
          experience: 'guided-room-and-interactive-lab',
          status: 'restricted',
          adapter: 'official-enterprise-rest-api',
          selectable: false,
          capabilities: ['room-catalog', 'room-questions', 'scoreboard', 'time-report'],
          requirement: 'Business or Classroom plan with THM-API-KEY',
          sourceUrl: 'https://help.tryhackme.com/en/articles/6498330-enterprise-api',
        },
      ] as T
    case 'open_nssctf_challenge': {
      const normalized = normalizeNSSCTFProblemURL(args?.url as string)
      window.open(normalized.url, '_blank', 'noopener,noreferrer')
      return undefined as T
    }
    case 'open_ctf_source_url': {
      const raw = new URL(args?.url as string)
      if (!['http:', 'https:'].includes(raw.protocol) || raw.username || raw.password) {
        throw new Error('CTF source must be an http(s) URL without credentials')
      }
      window.open(raw.toString(), '_blank', 'noopener,noreferrer')
      return undefined as T
    }
    case 'open_chrome_extension_manager':
    case 'reveal_browser_extension':
      throw new Error('Chrome 扩展安装引导需要 MilkSU 桌面应用。')
    case 'get_ctfshow_catalog_status':
      return {
        bridge: {
          endpoint: '',
          pairingCode: '',
          extensionPath: '',
          active: false,
          connected: false,
        },
        pages: [],
        catalog: { total: 0, lastSyncedAt: '', problems: [] },
        attemptedProblemIds: [],
        completedProblemIds: [],
      } as T
    case 'open_ctfshow_challenges':
      window.open(
        (args?.url as string) || 'https://ctf.show/challenges',
        '_blank',
        'noopener,noreferrer',
      )
      return undefined as T
    case 'get_nssctf_web_bridge_status':
      return {
        bridge: {
          endpoint: '',
          token: '',
          pairingCode: '',
          extensionPath: '',
          active: false,
          connected: false,
        },
        pages: [],
      } as T
    case 'import_nssctf_web_attachment':
      throw new Error('NSSCTF 附件导入需要 MilkSU 桌面运行时与已连接的 Chrome 扩展。')
    case 'choose_ctf_materials':
      throw new Error('请在 MilkSU 桌面应用中选择图片或附件。')
    case 'submit_nssctf_web_flag':
      throw new Error('NSSCTF 浏览器 Judge 需要 MilkSU 桌面运行时与 Chrome 扩展。')
    case 'open_nssctf_arena':
      window.open('https://www.nssctf.cn/ai/agents', '_blank', 'noopener,noreferrer')
      return undefined as T
    case 'get_nssctf_arena_current':
    case 'start_nssctf_arena':
    case 'submit_nssctf_arena_flag':
    case 'abandon_nssctf_arena':
      throw new Error('NSSCTF Agent Arena 需要 MilkSU 桌面运行时与本地凭据配置。')
    case 'get_vuln_job': {
      const id = args?.id as string
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      const projection = projections[id]
      if (!projection) throw new Error('Vulnerability research workspace not found.')
      return projection as T
    }
    case 'submit_vuln_reproduction': {
      const id = args?.id as string
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      if (!projections[id]) throw new Error('Vulnerability research workspace not found.')
      const projection = createDemoVulnProjection(true, id)
      writeJson(VULN_PROJECTIONS_KEY, { ...projections, [id]: projection })
      return projection as T
    }
    case 'record_vuln_learning': {
      const id = args?.id as string
      const request = args?.request as VulnLearningRecordRequest
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      const projection = projections[id]
      if (!projection) throw new Error('Vulnerability research workspace not found.')
      const updated: VulnProjection = {
        ...projection,
        learning: [...projection.learning, {
          id: crypto.randomUUID(),
          kind: request.kind,
          content: request.content,
          concept: request.concept,
          createdAt: new Date().toISOString(),
        }],
        humanOutcome: {
          ...projection.humanOutcome,
          reflectionCount: projection.humanOutcome.reflectionCount + (request.kind === 'reflection' ? 1 : 0),
          independentSteps: projection.humanOutcome.independentSteps + (request.kind === 'independent_step' ? 1 : 0),
          variantCount: projection.humanOutcome.variantCount + (request.kind === 'variant' ? 1 : 0),
        },
      }
      writeJson(VULN_PROJECTIONS_KEY, { ...projections, [id]: updated })
      return updated as T
    }
    case 'cancel_vuln_job': {
      const id = args?.id as string
      const projections = readJson<Record<string, VulnProjection>>(VULN_PROJECTIONS_KEY, {})
      const projection = projections[id]
      if (!projection) return undefined as T
      const updated: VulnProjection = {
        ...projection,
        job: { ...projection.job, status: 'cancelled', updatedAt: new Date().toISOString() },
        outcome: { status: 'cancelled', summary: '漏洞研究任务已由用户取消。' },
      }
      writeJson(VULN_PROJECTIONS_KEY, { ...projections, [id]: updated })
      return undefined as T
    }
    case 'start_sample_ctf':
    case 'get_ctf_artifact_preview':
    case 'request_ctf_endpoint':
    case 'approve_ctf_endpoint':
    case 'deny_ctf_endpoint':
    case 'prepare_ctf_agent_workspace':
    case 'get_ctf_agent_budget_status':
    case 'get_ctf_agent_replay':
    case 'generate_ctf_training_report':
    case 'cancel_ctf_job':
    case 'record_ctf_learning':
    case 'continue_ctf_job':
    case 'review_ctf_submission':
    case 'prepare_ctf_external_submission':
    case 'record_ctf_external_verdict':
      throw new Error('CTF Agent 工作台需要 MilkSU 桌面运行时。')
    case 'get_ctf_agent_run_checkpoint':
      return null as T
    default:
      throw new Error(`Unsupported browser-preview command: ${command}`)
  }
}

export async function listenEvent<T>(
  event: string,
  handler: (event: EventEnvelope<T>) => void,
): Promise<UnlistenFn> {
  if (!window.runtime) return () => undefined
  return window.runtime.EventsOn(event, (...data) => {
    handler({ payload: data[0] as T })
  })
}
