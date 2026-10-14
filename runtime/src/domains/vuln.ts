import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { dataDirectory } from '../home.ts'
import {
  fetchCISAKEVFeed,
  fetchFIRSTEPSS,
  fetchGitHubAdvisories,
  fetchNVDCVE,
  fetchOSVCVE,
  fetchVulhubPracticeCatalog,
  persistFeedSnapshot,
  resolveFeedSnapshotPath,
  searchNVDCVEs,
  type FeedSnapshotDownload,
} from '../vuln/feed.ts'
import {
  getPracticeEnvironmentStatus,
  startPracticeEnvironment,
  stopPracticeEnvironment,
  type PracticeRequest,
} from '../vuln/practice.ts'
import type { AssetVerificationRequest, LearningRecordRequest, TrackingWorkspaceRequest } from '../vuln/types.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function requireVuln(ctx: HandlerContext) {
  if (!ctx.vuln) throw new Error('vulnerability research service is not ready')
  return ctx.vuln
}

async function hostCall(ctx: HandlerContext, method: string, payload: unknown): Promise<unknown> {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
  return ctx.hostCall(method, payload)
}

async function fetchAndPersist(
  ctx: HandlerContext,
  fetchFn: () => Promise<FeedSnapshotDownload>,
): Promise<FeedSnapshotDownload> {
  const download = await fetchFn()
  return persistFeedSnapshot(dataDirectory(ctx.home), download)
}

registerOwnedHandlers({
  ListVulnJobs: (ctx) => requireVuln(ctx).listJobs(),
  GetVulnJob: (ctx, args) => requireVuln(ctx).getJob(arg(args, 0, '')),
  EnsureVulnTrackingWorkspace: (ctx, args) =>
    requireVuln(ctx).ensureTrackingWorkspace(arg<TrackingWorkspaceRequest>(args, 0, { cveId: '', title: '' })),
  FetchCISAKEVFeed: (ctx) => fetchAndPersist(ctx, () => fetchCISAKEVFeed()),
  FetchNVDCVE: (ctx, args) => fetchAndPersist(ctx, () => fetchNVDCVE(arg(args, 0, ''))),
  SearchNVDCVEs: (_ctx, args) => searchNVDCVEs(arg(args, 0, '')),
  FetchFIRSTEPSS: (ctx, args) => fetchAndPersist(ctx, () => fetchFIRSTEPSS(arg(args, 0, ''))),
  FetchOSVCVE: (ctx, args) => fetchAndPersist(ctx, () => fetchOSVCVE(arg(args, 0, ''))),
  FetchGitHubAdvisories: (ctx, args) => fetchAndPersist(ctx, () => fetchGitHubAdvisories(arg(args, 0, ''))),
  FetchVulhubPracticeCatalog: (ctx) => fetchAndPersist(ctx, () => fetchVulhubPracticeCatalog()),
  async RevealVulnerabilityFeedSnapshot(ctx, args) {
    const snapshotPath = arg(args, 0, '')
    const resolved = await resolveFeedSnapshotPath(dataDirectory(ctx.home), snapshotPath)
    try {
      await hostCall(ctx, 'shell.showItemInFolder', { path: resolved })
    } catch (error) {
      throw new Error(`打开 CVE Feed 快照: ${error instanceof Error ? error.message : error}`)
    }
    return null
  },
  async ChooseVulnerabilityPracticeDirectory(ctx) {
    const path = await hostCall(ctx, 'dialog.openDirectory', {
      title: '选择 CVE 本地练习 Docker Compose 目录',
    })
    return typeof path === 'string' ? path : ''
  },
  StartVulnerabilityPractice: (ctx, args) =>
    startPracticeEnvironment(dataDirectory(ctx.home), arg<PracticeRequest>(args, 0, { cveId: '', environmentId: '', directory: '' })),
  GetVulnerabilityPracticeStatus: (ctx, args) =>
    getPracticeEnvironmentStatus(dataDirectory(ctx.home), arg<PracticeRequest>(args, 0, { cveId: '', environmentId: '', directory: '' })),
  StopVulnerabilityPractice: (ctx, args) =>
    stopPracticeEnvironment(dataDirectory(ctx.home), arg<PracticeRequest>(args, 0, { cveId: '', environmentId: '', directory: '' })),
  RecordVulnLearning: (ctx, args) =>
    requireVuln(ctx).recordLearning(arg(args, 0, ''), arg<LearningRecordRequest>(args, 1, { kind: '', content: '' })),
  ForgetVulnLearning: (ctx, args) => requireVuln(ctx).forgetLearning(arg(args, 0, ''), arg(args, 1, '')),
  RecordVulnAssetVerification: (ctx, args) =>
    requireVuln(ctx).recordAssetVerification(
      arg(args, 0, ''),
      arg<AssetVerificationRequest>(args, 1, { name: '', address: '', environment: '' }),
    ),
  CancelVulnJob: async (ctx, args) => {
    await requireVuln(ctx).cancelJob(arg(args, 0, ''))
    return null
  },
})
