import { statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDirectory } from '../home.ts'
import { CVE_ID_PATTERN, formatRFC3339, newId, runeCount } from './ids.ts'
import { newGrant, normalizeTarget } from './policy.ts'
import {
  FACT_ASSET_VERIFICATION_RECORDED,
  FACT_LEARNING_FORGOTTEN,
  FACT_LEARNING_RECORDED,
  FACT_TARGET_ADMITTED,
  PACKAGE_ID,
  SCHEMA_VERSION,
  type AssetVerification,
  type AssetVerificationRequest,
  type ExperimentView,
  type HumanOutcomeView,
  type JobProjection,
  type LearningRecord,
  type LearningRecordRequest,
  type Target,
  type TrackingWorkspaceRequest,
  type VulnProjection,
  type VulnSummary,
} from './types.ts'
import { JobRuntime, jobIsTerminal, latestState } from './runtime.ts'
import { runtimeRoot } from './event-store.ts'
import { writeLearningContext } from './learning.ts'

export { CVE_ID_PATTERN } from './ids.ts'

export class VulnService {
  readonly runtime: JobRuntime
  readonly dataDir: string
  readonly artifactDirectory: string

  constructor(runtime: JobRuntime, dataDir: string, artifactDirectory = '') {
    this.runtime = runtime
    this.dataDir = dataDir
    this.artifactDirectory = artifactDirectory
  }

  static open(home: string, artifactDirectory = ''): VulnService {
    const dataDir = dataDirectory(home)
    const runtime = JobRuntime.open(runtimeRoot(dataDir))
    return new VulnService(runtime, dataDir, artifactDirectory)
  }

  close(): void {
    this.runtime.close()
  }

  async recover(): Promise<void> {
    const jobs = await this.runtime.listJobs()
    for (const core of jobs) {
      if (core.job.role !== PACKAGE_ID || jobIsTerminal(core)) continue
      const state = latestState(core)
      const scope = {
        jobId: core.job.id,
        attemptId: state.attempt?.id,
        stepId: state.step?.id,
      }
      if (state.action && state.action.status !== 'completed' && state.step && state.attempt) {
        await this.runtime.setActionStatus(
          scope,
          state.action.id,
          'failed',
          'application stopped during evidence recording',
        )
      }
      if (state.step && state.step.status === 'running' && state.attempt) {
        await this.runtime.finishStep(scope, 'failed', 'application stopped during evidence recording')
      }
      if (state.attempt && state.attempt.status === 'running') {
        await this.runtime.finishAttempt(
          core.job.id,
          state.attempt.id,
          'interrupted',
          'application stopped; research facts remain recoverable',
        )
        await this.runtime.recordRecovery(core.job.id, state.attempt.id)
      }
    }
  }

  async ensureTrackingWorkspace(request: TrackingWorkspaceRequest): Promise<VulnProjection> {
    const cveId = String(request.cveId ?? '').trim().toUpperCase()
    if (!CVE_ID_PATTERN.test(cveId)) {
      throw new Error('CVE tracking workspace requires a CVE-YYYY-NNNN id')
    }
    let title = String(request.title ?? '').trim()
    if (!title) title = `${cveId} vulnerability learning`
    if (runeCount(title) > 180) {
      throw new Error('CVE tracking title must stay within 180 characters')
    }
    const summary = String(request.summary ?? '').trim()
    if (runeCount(summary) > 1200) {
      throw new Error('CVE tracking summary must stay within 1200 characters')
    }
    const referenceHref = String(request.referenceHref ?? '').trim()
    let scopeTarget = { kind: 'lab' as const, value: `cve-tracking:${cveId}` }
    if (referenceHref) {
      scopeTarget = normalizeTarget({ kind: 'origin', value: referenceHref })
    } else {
      scopeTarget = normalizeTarget(scopeTarget)
    }

    const existing = await this.findTrackingJob(cveId)
    if (existing) return existing

    const now = formatRFC3339()
    const job = {
      id: newId('job'),
      title: `${cveId} · tracking`,
      role: PACKAGE_ID,
      collaborationMode: 'copilot',
      status: 'queued' as const,
      createdAt: now,
      updatedAt: now,
    }
    await this.runtime.createJob(job)
    const grant = newGrant(
      'user-confirmed:cve-tracking',
      'authorized CVE learning note tracking',
      [scopeTarget],
      30 * 24 * 60 * 60 * 1000,
    )
    const target: Target = {
      id: newId('target'),
      name: cveId,
      version: 'tracking',
      component: summary ? `${title} · ${firstLineLocal(summary, 160)}` : title,
      fixture: 'cve-tracking',
      collaborationMode: 'copilot',
      scope: grant,
      sourceArtifactId: '',
      readmeArtifactId: '',
      admittedAt: now,
    }
    await this.runtime.commitRoleFact(
      { jobId: job.id },
      marshalFact(FACT_TARGET_ADMITTED, target),
    )
    return this.getJob(job.id)
  }

  async recordLearning(jobId: string, request: LearningRecordRequest): Promise<VulnProjection> {
    const core = await this.requireVulnJob(jobId)
    const kind = String(request.kind ?? '').trim().toLowerCase()
    if (kind !== 'reflection' && kind !== 'independent_step' && kind !== 'variant') {
      throw new Error('unsupported vulnerability learning record kind')
    }
    const content = String(request.content ?? '').trim()
    const concept = String(request.concept ?? '').trim()
    if (!content || runeCount(content) > 4000 || runeCount(concept) > 160) {
      throw new Error('learning content is required and must stay within the local record limits')
    }
    const record: LearningRecord = {
      id: newId('learning'),
      kind,
      content,
      createdAt: formatRFC3339(),
    }
    if (concept) record.concept = concept
    await this.runtime.commitRoleFact({ jobId: core.job.id }, marshalFact(FACT_LEARNING_RECORDED, record))
    const projection = await this.getJob(core.job.id)
    await this.refreshLearningFile(projection.target.name)
    return projection
  }

  async forgetLearning(jobId: string, learningId: string): Promise<VulnProjection> {
    const id = String(learningId ?? '').trim()
    if (!id) throw new Error('learning record id is required')
    const core = await this.requireVulnJob(jobId)
    const current = projectVuln(core)
    if (!current.learning.some((record) => record.id === id)) {
      throw new Error('learning record was not found')
    }
    await this.runtime.commitRoleFact(
      { jobId: core.job.id },
      marshalFact(FACT_LEARNING_FORGOTTEN, { id }),
    )
    const projection = await this.getJob(core.job.id)
    await this.refreshLearningFile(projection.target.name)
    return projection
  }

  async recordAssetVerification(jobId: string, request: AssetVerificationRequest): Promise<VulnProjection> {
    const core = await this.requireVulnJob(jobId)
    const normalized = normalizeAssetVerification(request)
    const record: AssetVerification = {
      id: newId('asset'),
      name: normalized.name,
      address: normalized.address,
      environment: normalized.environment,
      status: normalized.status,
      recordedAt: formatRFC3339(),
    }
    if (normalized.summary) record.summary = normalized.summary
    await this.runtime.commitRoleFact(
      { jobId: core.job.id },
      marshalFact(FACT_ASSET_VERIFICATION_RECORDED, record),
    )
    return this.getJob(core.job.id)
  }

  async listJobs(): Promise<VulnSummary[]> {
    const jobs = await this.runtime.listJobs()
    const result: VulnSummary[] = []
    for (const core of jobs) {
      if (core.job.role !== PACKAGE_ID) continue
      result.push(summaryFrom(projectVuln(core)))
    }
    result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return result
  }

  async getJob(jobId: string): Promise<VulnProjection> {
    return projectVuln(await this.requireVulnJob(jobId))
  }

  async learningByCve(cveId: string): Promise<LearningRecord[] | null> {
    const id = String(cveId ?? '').trim().toUpperCase()
    if (!CVE_ID_PATTERN.test(id)) return null
    const found = await this.findTrackingJob(id)
    return found ? found.learning : null
  }

  async cancelJob(jobId: string): Promise<void> {
    const core = await this.requireVulnJob(jobId)
    if (jobIsTerminal(core) || core.outcome) return
    await this.runtime.requestCancellation(core.job.id, 'vulnerability research cancelled by user')
    await this.runtime.decideOutcome(
      { jobId: core.job.id },
      { status: 'cancelled', summary: '漏洞研究任务已由用户取消。' },
    )
    await this.runtime.finishJob(core.job.id, 'cancelled', '漏洞研究任务已由用户取消。')
  }

  private async requireVulnJob(jobId: string): Promise<JobProjection> {
    const core = await this.runtime.getJob(jobId)
    if (core.job.role !== PACKAGE_ID) {
      throw new Error('job is not a vulnerability research workspace')
    }
    return core
  }

  private async findTrackingJob(cveId: string): Promise<VulnProjection | undefined> {
    const jobs = await this.runtime.listJobs()
    for (const core of jobs) {
      if (core.job.role !== PACKAGE_ID) continue
      const projection = projectVuln(core)
      if (projection.target.name.toUpperCase() === cveId && projection.target.fixture === 'cve-tracking') {
        return projection
      }
    }
    return undefined
  }

  private async refreshLearningFile(cveId: string): Promise<void> {
    if (!this.artifactDirectory.trim()) return
    const id = cveId.trim().toUpperCase()
    const workspace = join(this.artifactDirectory, 'CVE', id)
    try {
      if (!statSync(workspace).isDirectory()) return
    } catch {
      return
    }
    const records = await this.learningByCve(id)
    await writeLearningContext(workspace, id, records ?? [])
  }
}

function marshalFact(kind: string, value: unknown) {
  return {
    id: newId('fact'),
    packageId: PACKAGE_ID,
    schemaVersion: SCHEMA_VERSION,
    kind,
    data: value,
  }
}

export function projectVuln(core: JobProjection): VulnProjection {
  if (core.job.role !== PACKAGE_ID) {
    throw new Error('job is not a vulnerability research workspace')
  }
  let target: Target | undefined
  let attackSurface: VulnProjection['attackSurface']
  let reproduction: unknown
  let rootCause: VulnProjection['rootCause']
  const hypotheses: VulnProjection['hypotheses'] = []
  const learning: LearningRecord[] = []
  const forgotten = new Set<string>()
  const assetVerifications: AssetVerification[] = []
  for (const fact of core.roleFacts) {
    if (fact.packageId !== PACKAGE_ID || fact.schemaVersion !== SCHEMA_VERSION) continue
    switch (fact.kind) {
      case FACT_TARGET_ADMITTED: {
        const value = fact.data as Target
        if (target?.id) throw new Error('job has more than one admitted target')
        if (!value?.id || !value.scope?.id) throw new Error('invalid admitted vulnerability target')
        target = value
        break
      }
      case FACT_LEARNING_RECORDED: {
        const value = fact.data as LearningRecord
        if (!value?.id || !value.kind || !value.content) throw new Error('invalid vulnerability learning fact')
        learning.push(value)
        break
      }
      case FACT_LEARNING_FORGOTTEN: {
        const value = fact.data as { id?: string }
        const id = String(value?.id ?? '').trim()
        if (!id) throw new Error('invalid forgotten vulnerability learning fact')
        forgotten.add(id)
        break
      }
      case FACT_ASSET_VERIFICATION_RECORDED: {
        const value = fact.data as AssetVerification
        if (!value?.id || !value.status) throw new Error('invalid vulnerability asset verification fact')
        assetVerifications.push(value)
        break
      }
      default: {
        if (fact.kind === 'attack_surface.recorded') attackSurface = fact.data as VulnProjection['attackSurface']
        if (fact.kind === 'hypothesis.recorded') {
          const value = fact.data as VulnProjection['hypotheses'][number]
          if (!value?.id || !value.statement) throw new Error('invalid hypothesis fact')
          const index = hypotheses.findIndex((item) => item.id === value.id)
          if (index >= 0) hypotheses[index] = value
          else hypotheses.push(value)
        }
        if (fact.kind === 'reproduction.recorded') reproduction = fact.data
        if (fact.kind === 'root_cause.recorded') rootCause = fact.data as VulnProjection['rootCause']
      }
    }
  }
  if (!target?.id) throw new Error('job has no admitted vulnerability target')

  const actionsByStep = new Map(core.actions.map((action) => [action.stepId, action]))
  const observationsByAction = new Map<string, JobProjection['observations']>()
  for (const observation of core.observations) {
    const list = observationsByAction.get(observation.actionId) ?? []
    list.push(observation)
    observationsByAction.set(observation.actionId, list)
  }
  const artifactIdsByAction = new Map<string, string[]>()
  for (const effect of core.effects) {
    if (!effect.artifactId) continue
    const list = artifactIdsByAction.get(effect.actionId) ?? []
    if (!list.includes(effect.artifactId)) list.push(effect.artifactId)
    artifactIdsByAction.set(effect.actionId, list)
  }
  const experiments: ExperimentView[] = core.steps.map((step, index) => {
    const experiment: ExperimentView = {
      id: step.id,
      number: index + 1,
      name: step.name,
      description: step.description,
      status: step.status,
      observations: [],
      artifactIds: [],
    }
    const action = actionsByStep.get(step.id)
    if (action) {
      experiment.action = action
      experiment.observations = [...(observationsByAction.get(action.id) ?? [])]
      experiment.artifactIds = [...(artifactIdsByAction.get(action.id) ?? [])]
    }
    return experiment
  })

  const kept = forgotten.size > 0 ? learning.filter((record) => !forgotten.has(record.id)) : learning
  const humanOutcome: HumanOutcomeView = {
    goal: '能解释长度字段为什么越过目标缓冲区，并独立完成一个变体实验。',
    reflectionCount: 0,
    independentSteps: 0,
    variantCount: 0,
    summary: '尚未记录学习复盘。',
  }
  for (const record of kept) {
    if (record.kind === 'reflection') humanOutcome.reflectionCount += 1
    else if (record.kind === 'independent_step') humanOutcome.independentSteps += 1
    else if (record.kind === 'variant') humanOutcome.variantCount += 1
  }
  if (kept.length > 0) {
    humanOutcome.summary = `已记录 ${humanOutcome.reflectionCount} 次复盘、${humanOutcome.independentSteps} 个独立步骤和 ${humanOutcome.variantCount} 个变体实验。`
  }

  const projection: VulnProjection = {
    contractVersion: SCHEMA_VERSION,
    job: core.job,
    target,
    hypotheses,
    experiments,
    artifacts: [...core.artifacts],
    evidence: [...core.evidence],
    evaluations: [...core.evaluations],
    learning: kept,
    assetVerifications,
    humanOutcome,
    events: [...core.events],
  }
  if (attackSurface) projection.attackSurface = attackSurface
  if (reproduction) projection.reproduction = reproduction
  if (rootCause) projection.rootCause = rootCause
  if (core.outcome) projection.outcome = core.outcome
  return projection
}

function summaryFrom(projection: VulnProjection): VulnSummary {
  const last = projection.evaluations[projection.evaluations.length - 1]
  const summary: VulnSummary = {
    id: projection.job.id,
    title: projection.job.title,
    version: projection.target.version,
    status: projection.job.status,
    hypothesisCount: projection.hypotheses.length,
    reproductionState: projection.reproduction
      ? `${(projection.reproduction as { stableRuns?: number; totalRuns?: number }).stableRuns ?? 0}/${(projection.reproduction as { totalRuns?: number }).totalRuns ?? 0}`
      : 'awaiting_evidence',
    updatedAt: projection.job.updatedAt,
  }
  if (last?.verdict) summary.verdict = last.verdict
  return summary
}

function normalizeAssetVerification(request: AssetVerificationRequest): Required<AssetVerificationRequest> {
  const normalized = {
    name: String(request.name ?? '').trim(),
    address: String(request.address ?? '').trim(),
    environment: String(request.environment ?? '').trim(),
    status: String(request.status ?? '').trim().toLowerCase(),
    summary: String(request.summary ?? '').trim(),
  }
  if (!normalized.name && !normalized.address) {
    throw new Error('asset name or address is required')
  }
  if (!normalized.name) normalized.name = normalized.address
  if (!normalized.address) normalized.address = 'unspecified'
  if (!normalized.environment) normalized.environment = 'unspecified'
  if (!normalized.status) normalized.status = 'needs_review'
  if (!['needs_review', 'affected', 'not_affected', 'mitigated'].includes(normalized.status)) {
    throw new Error('unsupported asset verification status')
  }
  if (
    runeCount(normalized.name) > 240
    || runeCount(normalized.address) > 320
    || runeCount(normalized.environment) > 160
    || runeCount(normalized.summary) > 1200
  ) {
    throw new Error('asset verification record exceeds local archive limits')
  }
  return normalized
}

function firstLineLocal(value: string, maxRunes: number): string {
  let text = value.trim()
  for (const delimiter of ['\r\n', '\n', '\r']) {
    const cut = text.indexOf(delimiter)
    if (cut >= 0) {
      text = text.slice(0, cut).trim()
      break
    }
  }
  const runes = [...text]
  if (runes.length <= maxRunes) return text
  return `${runes.slice(0, maxRunes).join('')}…`
}
