import {
  type AccountStatus,
  type AppSettings,
  type CodingAttachment,
  type LocalDataBackupExport,
  type LocalDataBackupRestore,
  type BuildTracking,
  type LocalDataStatus,
  type UserArtifactDirectoryStatus,
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
  VulnAssetVerificationRequest,
  VulnLearningRecordRequest,
  VulnProjection,
  VulnSummary,
  VulnTrackingWorkspaceRequest,
} from './vulnTypes'
import type { NSSCTFChallenge } from './nssctfTypes'
import type { NSSCTFArenaSubmission, NSSCTFArenaWorkspace } from './nssctfArenaTypes'
import type { NSSCTFWebBridgeStatus, NSSCTFWebSubmission } from './nssctfWebTypes'
import type {
  CTFShowCatalogStatus,
  CTFShowChallengeWorkspace,
  CTFShowWebSubmission,
} from './ctfshowTypes'
import type {
  NSSCTFCatalogQuery,
  NSSCTFCatalogSearchResult,
  NSSCTFCatalogSyncResult,
  NSSCTFDailyChallengeSelection,
  NSSCTFTrainingDashboard,
} from './nssctfTrainingTypes'
import type { CTFTrainingPlatform } from './ctfPlatformTypes'
import type {
  CodingArchitecturePreview,
  CodingArtifactPreview,
  CodingBrowserStatus,
  CodingCompactionResult,
  CodingComputerUseStatus,
  CodingComputerUseTarget,
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
  SessionHistoryGraphRequest,
  SessionHistoryGraphResponse,
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

interface DesktopAppBindings {
  GetAccountStatus(): Promise<AccountStatus>
  StartAccountLogin(): Promise<AccountStatus>
  LogoutAccount(): Promise<AccountStatus>
  GetSettings(): Promise<AppSettings>
  SaveSettingsCmd(settings: AppSettings): Promise<void>
  GetLocalDataStatus(): Promise<LocalDataStatus>
  GetUserArtifactDirectoryStatus(): Promise<UserArtifactDirectoryStatus>
  GetBuildTracking(): Promise<BuildTracking>
  ExportLocalDataBackup(): Promise<LocalDataBackupExport>
  ScheduleLocalDataRestore(): Promise<LocalDataBackupRestore>
  ExportLocalDiagnostics(): Promise<LocalDiagnosticExport>
  RevealLocalDataDirectory(): Promise<void>
  RevealUserArtifactDirectory(): Promise<void>
  GetStartupRecoveryStatus(): Promise<StartupRecoveryStatus>
  GetSessionIndexStatus(): Promise<SessionIndexStatus>
  RefreshSessionIndex(): Promise<SessionIndexRefreshResult>
  SearchSessionHistory(request: SessionHistorySearchRequest): Promise<SessionHistorySearchResponse>
  GetSessionHistoryGraph(request: SessionHistoryGraphRequest): Promise<SessionHistoryGraphResponse>
  ListConversations(): Promise<unknown>
  SaveConversation(conversation: unknown): Promise<void>
  EnsureCodingArtifactWorkspace(conversationId: string): Promise<string>
  DeleteConversation(id: string): Promise<void>
  GenerateConversationTitle(
    firstMessage: string,
    modelMode: string,
    modelProvider: string,
    modelId: string,
  ): Promise<string>
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
    modelSourcePreference: string,
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
  GetCodingArchitecturePreview(
    workspacePath: string,
    relativePath: string,
  ): Promise<CodingArchitecturePreview>
  GetCodingArtifactPreview(
    workspacePath: string,
    relativePath: string,
  ): Promise<CodingArtifactPreview>
  StartCodingBrowser(
    conversationId: string,
    initialUrl: string,
  ): Promise<CodingBrowserStatus>
  GetCodingBrowserStatus(conversationId: string): Promise<CodingBrowserStatus>
  SetCodingBrowserViewport(
    conversationId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    visible: boolean,
  ): Promise<void>
  NavigateCodingBrowser(conversationId: string, targetUrl: string): Promise<void>
  CodingBrowserGoBack(conversationId: string): Promise<void>
  CodingBrowserGoForward(conversationId: string): Promise<void>
  ReloadCodingBrowser(conversationId: string): Promise<void>
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
  SteerMessage(conversationId: string, prompt: string): Promise<void>
  TestAgentModel(): Promise<ModelProbeResult>
  ImportNSSCTFChallenge(rawURL: string): Promise<NSSCTFChallenge>
  SyncNSSCTFCatalog(rawURL: string): Promise<NSSCTFCatalogSyncResult>
  GetNSSCTFTrainingDashboard(): Promise<NSSCTFTrainingDashboard>
  RecommendCTFDailyChallenge(
    dateKey: string,
    excludedProblemIds: number[],
  ): Promise<NSSCTFDailyChallengeSelection>
  ListNSSCTFCatalog(query: NSSCTFCatalogQuery): Promise<NSSCTFCatalogSearchResult>
  GetCTFTrainingPlatforms(): Promise<CTFTrainingPlatform[]>
  OpenNSSCTFChallenge(rawURL: string): Promise<void>
  OpenCTFSourceURL(rawURL: string): Promise<void>
  OpenChromeExtensionManager(): Promise<void>
  OpenPlaywrightBrowserExtension(): Promise<void>
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
  EnsureVulnTrackingWorkspace(request: VulnTrackingWorkspaceRequest): Promise<VulnProjection>
  ListVulnJobs(): Promise<VulnSummary[]>
  GetVulnJob(id: string): Promise<VulnProjection>
  FetchCISAKEVFeed(): Promise<VulnerabilityFeedDownload>
  FetchNVDCVE(cveId: string): Promise<VulnerabilityFeedDownload>
  SearchNVDCVEs(query: string): Promise<VulnerabilityFeedDownload>
  FetchFIRSTEPSS(cveId: string): Promise<VulnerabilityFeedDownload>
  FetchOSVCVE(cveId: string): Promise<VulnerabilityFeedDownload>
  FetchGitHubAdvisories(cveId: string): Promise<VulnerabilityFeedDownload>
  FetchVulhubPracticeCatalog(): Promise<VulnerabilityFeedDownload>
  RevealVulnerabilityFeedSnapshot(snapshotPath: string): Promise<void>
  ChooseVulnerabilityPracticeDirectory(): Promise<string>
  StartVulnerabilityPractice(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  GetVulnerabilityPracticeStatus(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  StopVulnerabilityPractice(request: VulnerabilityPracticeRequest): Promise<VulnerabilityPracticeRun>
  RecordVulnLearning(id: string, request: VulnLearningRecordRequest): Promise<VulnProjection>
  RecordVulnAssetVerification(id: string, request: VulnAssetVerificationRequest): Promise<VulnProjection>
  CancelVulnJob(id: string): Promise<void>
}

declare global {
  interface Window {
    milksu?: {
      invoke(method: string, args: unknown[]): Promise<unknown>
      onEvent(event: string, callback: (value: unknown) => void): UnlistenFn
    }
  }
}

function getDesktopApp(): DesktopAppBindings | undefined {
  if (!window.milksu) return undefined
  return new Proxy({} as DesktopAppBindings, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      return (...args: unknown[]) => window.milksu!.invoke(property, args)
    },
  })
}

export function hasDesktopRuntime(): boolean {
  return Boolean(window.milksu)
}

export async function invokeCommand<T = unknown>(command: string, args?: CommandArgs): Promise<T> {
  const app = getDesktopApp()
  if (!app) {
    throw new Error(`MilkSU desktop runtime is unavailable for command: ${command}`)
  }
  switch (command) {
      case 'get_account_status':
        return app.GetAccountStatus() as Promise<T>
      case 'start_account_login':
        return app.StartAccountLogin() as Promise<T>
      case 'logout_account':
        return app.LogoutAccount() as Promise<T>
      case 'get_settings':
        return app.GetSettings() as Promise<T>
      case 'save_settings_cmd':
        return app.SaveSettingsCmd(args?.newSettings as AppSettings) as Promise<T>
      case 'get_local_data_status':
        return app.GetLocalDataStatus() as Promise<T>
      case 'get_user_artifact_directory_status':
        return app.GetUserArtifactDirectoryStatus() as Promise<T>
      case 'get_build_tracking':
        return app.GetBuildTracking() as Promise<T>
      case 'export_local_data_backup':
        return app.ExportLocalDataBackup() as Promise<T>
      case 'schedule_local_data_restore':
        return app.ScheduleLocalDataRestore() as Promise<T>
      case 'export_local_diagnostics':
        return app.ExportLocalDiagnostics() as Promise<T>
      case 'reveal_local_data_directory':
        return app.RevealLocalDataDirectory() as Promise<T>
      case 'reveal_user_artifact_directory':
        return app.RevealUserArtifactDirectory() as Promise<T>
      case 'get_startup_recovery_status':
        return app.GetStartupRecoveryStatus() as Promise<T>
      case 'get_session_index_status':
        return app.GetSessionIndexStatus() as Promise<T>
      case 'refresh_session_index':
        return app.RefreshSessionIndex() as Promise<T>
      case 'search_session_history':
        return app.SearchSessionHistory(args?.request as SessionHistorySearchRequest) as Promise<T>
      case 'get_session_history_graph':
        return app.GetSessionHistoryGraph(args?.request as SessionHistoryGraphRequest) as Promise<T>
      case 'list_conversations':
        return app.ListConversations() as Promise<T>
      case 'save_conversation':
        return app.SaveConversation(args?.conversation) as Promise<T>
      case 'ensure_coding_artifact_workspace':
        return app.EnsureCodingArtifactWorkspace(args?.conversationId as string) as Promise<T>
      case 'delete_conversation':
        return app.DeleteConversation(args?.id as string) as Promise<T>
      case 'generate_conversation_title':
        return app.GenerateConversationTitle(
          args?.firstMessage as string,
          (args?.modelMode as string) ?? '',
          (args?.modelProvider as string) ?? '',
          (args?.modelId as string) ?? '',
        ) as Promise<T>
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
          (args?.modelSourcePreference as string) ?? 'auto',
          (args?.executionMode as string) ?? '',
          (args?.approvalPolicy as string) ?? '',
          (args?.mcpConfigDigest as string) ?? '',
          (args?.mcpServers as string[]) ?? [],
          (args?.attachments as CodingAttachment[]) ?? [],
        ) as Promise<T>
      case 'abort_message':
        return app.AbortMessage(args?.conversationId as string) as Promise<T>
      case 'steer_message':
        return app.SteerMessage(
          args?.conversationId as string,
          args?.prompt as string,
        ) as Promise<T>
      case 'respond_tool_approval':
        return app.RespondToolApproval(
          args?.conversationId as string,
          args?.requestId as string,
          args?.approved as boolean,
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
      case 'start_coding_browser':
        return app.StartCodingBrowser(
          args?.conversationId as string,
          args?.initialUrl as string,
        ) as Promise<T>
      case 'get_coding_browser_status':
        return app.GetCodingBrowserStatus(
          args?.conversationId as string,
        ) as Promise<T>
      case 'set_coding_browser_viewport':
        return app.SetCodingBrowserViewport(
          args?.conversationId as string,
          args?.x as number,
          args?.y as number,
          args?.width as number,
          args?.height as number,
          args?.visible as boolean,
        ) as Promise<T>
      case 'navigate_coding_browser':
        return app.NavigateCodingBrowser(
          args?.conversationId as string,
          args?.targetUrl as string,
        ) as Promise<T>
      case 'coding_browser_go_back':
        return app.CodingBrowserGoBack(
          args?.conversationId as string,
        ) as Promise<T>
      case 'coding_browser_go_forward':
        return app.CodingBrowserGoForward(
          args?.conversationId as string,
        ) as Promise<T>
      case 'reload_coding_browser':
        return app.ReloadCodingBrowser(
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
      case 'import_nssctf_challenge':
        return app.ImportNSSCTFChallenge(args?.url as string) as Promise<T>
      case 'sync_nssctf_catalog':
        return app.SyncNSSCTFCatalog(args?.url as string) as Promise<T>
      case 'get_nssctf_training_dashboard':
        return app.GetNSSCTFTrainingDashboard() as Promise<T>
      case 'recommend_ctf_daily_challenge':
        return app.RecommendCTFDailyChallenge(
          args?.dateKey as string,
          (args?.excludedProblemIds as number[]) ?? [],
        ) as Promise<T>
      case 'list_nssctf_catalog':
        return app.ListNSSCTFCatalog(args?.query as NSSCTFCatalogQuery) as Promise<T>
      case 'get_ctf_training_platforms':
        return app.GetCTFTrainingPlatforms() as Promise<T>
      case 'open_nssctf_challenge':
        return app.OpenNSSCTFChallenge(args?.url as string) as Promise<T>
      case 'open_ctf_source_url':
        return app.OpenCTFSourceURL(args?.url as string) as Promise<T>
      case 'open_chrome_extension_manager':
        return app.OpenChromeExtensionManager() as Promise<T>
      case 'open_playwright_browser_extension':
        return app.OpenPlaywrightBrowserExtension() as Promise<T>
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
      case 'ensure_vuln_tracking_workspace':
        return app.EnsureVulnTrackingWorkspace(args?.request as VulnTrackingWorkspaceRequest) as Promise<T>
      case 'list_vuln_jobs':
        return app.ListVulnJobs() as Promise<T>
      case 'get_vuln_job':
        return app.GetVulnJob(args?.id as string) as Promise<T>
      case 'fetch_cisa_kev_feed':
        return app.FetchCISAKEVFeed() as Promise<T>
      case 'fetch_nvd_cve':
        return app.FetchNVDCVE(args?.cveId as string) as Promise<T>
      case 'search_nvd_cves':
        return app.SearchNVDCVEs(args?.query as string) as Promise<T>
      case 'fetch_first_epss':
        return app.FetchFIRSTEPSS(args?.cveId as string) as Promise<T>
      case 'fetch_osv_cve':
        return app.FetchOSVCVE(args?.cveId as string) as Promise<T>
      case 'fetch_github_advisories':
        return app.FetchGitHubAdvisories(args?.cveId as string) as Promise<T>
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
      case 'record_vuln_learning':
        return app.RecordVulnLearning(args?.id as string, args?.request as VulnLearningRecordRequest) as Promise<T>
      case 'record_vuln_asset_verification':
        return app.RecordVulnAssetVerification(args?.id as string, args?.request as VulnAssetVerificationRequest) as Promise<T>
      case 'cancel_vuln_job':
        return app.CancelVulnJob(args?.id as string) as Promise<T>
      default:
        throw new Error(`Unsupported desktop command: ${command}`)
  }
}

export async function listenEvent<T>(
  event: string,
  handler: (event: EventEnvelope<T>) => void,
): Promise<UnlistenFn> {
  if (!window.milksu) return () => undefined
  return window.milksu.onEvent(event, value => {
    handler({ payload: value as T })
  })
}
