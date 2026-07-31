import {
  DEFAULT_MODEL_ROUTING,
  withAppSettingsDefaults,
  type AppSettings,
  type ModelProbeResult,
} from './types'
import type {
  CTFArtifactPreview,
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFAgentReplay,
  CTFAgentWorkspaceHandoff,
  CTFChallengeRequest,
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
import type { CodingEnvironmentSnapshot } from './codingEnvironmentTypes'
import { createPreviewCTFProjection, summarizePreviewCTF } from './ctfPreview'

type CommandArgs = Record<string, unknown>
type UnlistenFn = () => void
type EventEnvelope<T> = { payload: T }

interface WailsAppBindings {
  GetSettings(): Promise<AppSettings>
  SaveSettingsCmd(settings: AppSettings): Promise<void>
  ListConversations(): Promise<unknown>
  SaveConversation(conversation: unknown): Promise<void>
  DeleteConversation(id: string): Promise<void>
  ChooseAgentWorkspace(): Promise<string>
  ChooseCTFMaterials(): Promise<CTFMaterialRequest[]>
  SendMessage(
    conversationId: string,
    prompt: string,
    workspacePath: string,
    modelMode: string,
    modelProvider: string,
    modelId: string,
  ): Promise<void>
  AbortMessage(conversationId: string): Promise<void>
  GetRuntimeStatus(): Promise<unknown>
  GetCodingEnvironment(workspacePath: string): Promise<CodingEnvironmentSnapshot>
  TestAgentModel(): Promise<ModelProbeResult>
  StartSampleCTF(): Promise<CTFProjection>
  ImportNSSCTFChallenge(rawURL: string): Promise<NSSCTFChallenge>
  SyncNSSCTFCatalog(rawURL: string): Promise<NSSCTFCatalogSyncResult>
  GetNSSCTFTrainingDashboard(): Promise<NSSCTFTrainingDashboard>
  ListNSSCTFCatalog(query: NSSCTFCatalogQuery): Promise<NSSCTFCatalogSearchResult>
  GetCTFTrainingPlatforms(): Promise<CTFTrainingPlatform[]>
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
    { key: 'web', label: 'Web', score: 20, confidence: 0, attempts: 0, solved: 0 },
    { key: 'pwn', label: 'Pwn', score: 20, confidence: 0, attempts: 0, solved: 0 },
    { key: 'reverse', label: 'Reverse', score: 20, confidence: 0, attempts: 0, solved: 0 },
    { key: 'crypto', label: 'Crypto', score: 20, confidence: 0, attempts: 0, solved: 0 },
    { key: 'forensics', label: '取证', score: 20, confidence: 0, attempts: 0, solved: 0 },
    { key: 'misc', label: 'Misc', score: 20, confidence: 0, attempts: 0, solved: 0 },
  ]
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
      case 'send_message':
        return app.SendMessage(
          args?.conversationId as string,
          args?.prompt as string,
          args?.workspacePath as string,
          (args?.modelMode as string) ?? '',
          (args?.modelProvider as string) ?? '',
          (args?.modelId as string) ?? '',
        ) as Promise<T>
      case 'abort_message':
        return app.AbortMessage(args?.conversationId as string) as Promise<T>
      case 'get_runtime_status':
        return app.GetRuntimeStatus() as Promise<T>
      case 'get_coding_environment':
        return app.GetCodingEnvironment(args?.workspacePath as string) as Promise<T>
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
      return undefined as T
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
        },
      } as T
    }
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
          status: 'planned',
          adapter: 'official-labs-api',
          selectable: false,
          capabilities: ['machines', 'starting-point', 'challenges', 'vpn', 'instance-lifecycle', 'progress'],
          requirement: 'HTB Labs API token; real-account verification pending',
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
