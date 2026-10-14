import { PHASE_FINALIZING, publicRun, publicSnapshot, publicSource, publicTask, publicCitation, type Run } from './types.ts'
import type { ResearchService } from './service.ts'

export const RESEARCH_WORKSPACE_ACTIONS = new Set([
  'start_research_run',
  'register_research_task',
  'open_research_browser_tab',
  'list_research_runs',
  'get_research_run',
  'seal_research_batch',
  'begin_research_gap_fill',
  'record_research_source',
  'read_research_source',
  'read_research_report',
  'record_research_citation',
  'complete_research_run',
  'cancel_research_run',
  'resume_research_run',
])

export function isResearchWorkspaceAction(action: string): boolean {
  return RESEARCH_WORKSPACE_ACTIONS.has(String(action ?? '').trim())
}

export type ResearchWorkspaceHost = {
  service: ResearchService
  cancelRun(conversationId: string, runId: string): Promise<Run>
  trackRun(conversationId: string, runId: string, active: boolean): void
}

type WorkspaceRequest = {
  action?: string
  query?: string
  url?: string
  runId?: string
  traceId?: string
  taskPrompt?: string
  title?: string
  extract?: string
  claim?: string
  sourceId?: string
  verdict?: string
  reason?: string
  report?: string
}

function encodeResult(value: unknown): string {
  return JSON.stringify(value)
}

export function researchContinuationPrompt(run: Run, locale: string): string {
  const english = locale === 'en'
  if (run.phase === PHASE_FINALIZING) {
    if (english) {
      return `The gap-fill workers for research run ${run.id} have finished. Call milksu_workspace get_research_run first; if the run is cancelled, stop without synthesizing. Otherwise inspect the saved results, verify important claims, run the final critic, and persist the report with complete_research_run. Do not start another worker batch.`
    }
    return `研究运行 ${run.id} 的 gap-fill 工作者已完成。先调用 milksu_workspace get_research_run；若运行已取消就停止，不要合成。否则读取保存结果，核验重要主张，完成最终 Critic，并用 complete_research_run 持久化报告。不要再启动研究批次。`
  }
  if (english) {
    return `The background workers for research run ${run.id} have finished. Call milksu_workspace get_research_run first; if the run is cancelled, stop without synthesizing. Otherwise inspect saved results and sources, verify important claims in the parent session, synthesize, and run the critic. Start at most one gap-fill batch only if a material gap remains, then persist the report.`
  }
  return `研究运行 ${run.id} 的后台工作者已完成。先调用 milksu_workspace get_research_run；若运行已取消就停止，不要合成。否则读取保存结果和来源，继续同一研究任务：由父会话核验重要主张、合成结果并运行 Critic；只有存在实质缺口时才启动一次 gap-fill 批次，最后持久化报告。`
}

export async function handleResearchWorkspaceAction(
  host: ResearchWorkspaceHost,
  conversationId: string,
  action: string,
  input: string,
): Promise<string> {
  let request: WorkspaceRequest = {}
  const raw = String(input ?? '').trim()
  if (raw) {
    try {
      request = JSON.parse(raw) as WorkspaceRequest
    } catch {
      throw new Error('invalid workspace action input')
    }
  }
  const name = String(action || request.action || '').trim()
  const { service } = host
  switch (name) {
    case 'start_research_run': {
      const run = await service.start(conversationId, String(request.query ?? ''), String(request.traceId ?? ''))
      host.trackRun(conversationId, run.id, true)
      return encodeResult({ run: publicRun(run) })
    }
    case 'register_research_task': {
      const task = await service.registerTask(conversationId, String(request.runId ?? ''), String(request.taskPrompt ?? ''))
      return encodeResult({ task: publicTask(task) })
    }
    case 'open_research_browser_tab': {
      const snapshot = await service.get(conversationId, String(request.runId ?? ''))
      if (snapshot.run.status !== 'running') throw new Error('research run is not running')
      throw new Error('research Browser is unavailable')
    }
    case 'list_research_runs': {
      const runs = await service.list(conversationId)
      return encodeResult({ runs: runs.map((run) => publicRun(run)) })
    }
    case 'get_research_run':
      return encodeResult(publicSnapshot(await service.get(conversationId, String(request.runId ?? ''))))
    case 'seal_research_batch': {
      const run = await service.sealBatch(conversationId, String(request.runId ?? ''))
      return encodeResult({ run: publicRun(run) })
    }
    case 'begin_research_gap_fill': {
      const run = await service.beginGapFill(conversationId, String(request.runId ?? ''))
      return encodeResult({ run: publicRun(run) })
    }
    case 'record_research_source': {
      const source = await service.addSource(
        conversationId,
        String(request.runId ?? ''),
        String(request.url ?? ''),
        String(request.title ?? ''),
        String(request.extract ?? ''),
      )
      return encodeResult({ source: publicSource(source) })
    }
    case 'read_research_source': {
      const { source, extract } = await service.readSource(conversationId, String(request.sourceId ?? ''))
      return encodeResult({ source: publicSource(source), extract })
    }
    case 'read_research_report':
      return await service.readReport(conversationId, String(request.runId ?? ''))
    case 'record_research_citation': {
      const citation = await service.recordCitation(
        conversationId,
        String(request.runId ?? ''),
        String(request.claim ?? ''),
        String(request.sourceId ?? ''),
        String(request.verdict ?? ''),
        String(request.reason ?? ''),
      )
      return encodeResult({ citation: publicCitation(citation) })
    }
    case 'complete_research_run': {
      const run = await service.complete(conversationId, String(request.runId ?? ''), String(request.report ?? ''))
      host.trackRun(conversationId, run.id, false)
      return encodeResult({ runId: run.id, status: run.status })
    }
    case 'cancel_research_run': {
      const run = await host.cancelRun(conversationId, String(request.runId ?? ''))
      return encodeResult({ run: publicRun(run) })
    }
    case 'resume_research_run': {
      const snapshot = await service.resume(conversationId, String(request.runId ?? ''))
      host.trackRun(conversationId, snapshot.run.id, true)
      return encodeResult(publicSnapshot(snapshot))
    }
    default:
      throw new Error('unknown research action')
  }
}
