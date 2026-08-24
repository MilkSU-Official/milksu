/**
 * Shared Coding/Pi session domain-task context for CTF and CVE.
 *
 * Domain modules remain the source of truth. This module only shapes a
 * structured handoff snapshot for the shared ChatPage panel — never a second
 * agent harness, and never by parsing free-form prompt text.
 */

import { t } from '@/lib/uiLocale'

export type DomainTaskKind = 'ctf' | 'cve' | 'lab'

export interface DomainTaskFact {
  label: string
  value: string
  kind?: 'id' | 'title' | 'material' | 'scope' | 'evidence' | 'judge' | 'asset' | 'boundary' | 'role' | 'other'
}

/** Structured CTF snapshot carried on the conversation / handoff. */
export interface CTFDomainTaskContext {
  kind: 'ctf'
  jobId: string
  challengeId: string
  challengeTitle: string
  statement?: string
  category?: string
  objective?: string
  originLabel?: string
  materialNames?: string[]
  role: 'solver' | 'tool-builder' | 'strategist'
  roleLabel: string
  materialStatus: string
  materialCount: number
  authorizedScope: string
  evidenceCount: number
  artifactCount: number
  judgeState: string
  /** When set, panel prefers live projection over this snapshot for counts/judge. */
  liveProjection?: boolean
}

/** Structured CVE snapshot carried on the conversation / handoff. */
export interface CVEDomainTaskContext {
  kind: 'cve'
  cveId: string
  title: string
  summary?: string
  vendor?: string
  product?: string
  affected?: string
  sourceEvidenceState: string
  sourceEvidenceCount: number
  assetMatchState: string
  assetCount: number
  researchScope: string
  safetyBoundary: string
  roleLabel: string
}

export interface LabDomainTaskContext {
  kind: 'lab'
  jobId: string
  title: string
  scope: 'local' | 'remote'
  request: string
}

export type DomainTaskContext = CTFDomainTaskContext | CVEDomainTaskContext | LabDomainTaskContext

export interface DomainTaskContextPresentation {
  kind: DomainTaskKind
  moduleLabel: string
  title: string
  subtitle: string
  ownership: string
  returnLabel: string
  returnAriaLabel: string
  collapsedLabel: string
  objectiveLabel: string
  objective: string
  briefLabel: string
  brief: string
  meta: string[]
  materials: string[]
  detailsLabel: string
  facts: DomainTaskFact[]
}

export function domainTaskModuleLabel(kind: DomainTaskKind): string {
  if (kind === 'ctf') return 'CTF'
  if (kind === 'lab') return t('实验室', 'Lab')
  return 'CVE'
}

export function ctfRoleLabel(role: CTFDomainTaskContext['role'] | undefined): string {
  if (role === 'tool-builder') return t('Coding Agent 工具工坊', 'Coding Agent tool workshop')
  if (role === 'strategist') return t('策略 Agent 复盘', 'Strategy Agent review')
  return t('解题 Agent', 'Solver Agent')
}

export type DomainScopeGrant = {
  id?: string
  purpose?: string
  revokedAt?: string
  targets?: Array<{ kind?: string; value?: string }>
}

function domainScopeKey(scope: DomainScopeGrant): string {
  const id = String(scope.id ?? '').trim()
  if (id) return `id:${id}`
  const targets = (scope.targets ?? [])
    .map(target => `${String(target.kind ?? '').trim()}:${String(target.value ?? '').trim()}`)
    .filter(Boolean)
    .sort()
    .join(',')
  return `t:${targets}|p:${String(scope.purpose ?? '').trim()}`
}

/**
 * Merge challenge.source.scope (base grant) with approved live.networkScopes.
 * Deduplicate by id/targets; never include revoked grants (do not weaken safety).
 */
export function mergeAuthorizedScopes(
  sourceScope?: DomainScopeGrant | null,
  networkScopes?: DomainScopeGrant[] | null,
): DomainScopeGrant[] {
  const merged: DomainScopeGrant[] = []
  const seen = new Set<string>()
  const push = (scope?: DomainScopeGrant | null) => {
    if (!scope || typeof scope !== 'object') return
    if (scope.revokedAt) return
    const key = domainScopeKey(scope)
    if (!key || key === 't:|p:' || seen.has(key)) return
    seen.add(key)
    merged.push(scope)
  }
  push(sourceScope)
  for (const scope of networkScopes ?? []) push(scope)
  return merged
}

export function formatAuthorizedScope(scopes: DomainScopeGrant[] | null | undefined): string {
  const active = (scopes ?? []).filter(scope => !scope.revokedAt)
  if (!active.length) return t('未授权 Scope', 'Unauthorized scope')
  return active.map(scope => {
    const targets = (scope.targets ?? [])
      .map(target => `${target.kind || 'target'}:${target.value || '?'}`)
      .join(', ')
    const purpose = String(scope.purpose ?? '').trim()
    const id = String(scope.id ?? '').trim()
    const head = [id, purpose].filter(Boolean).join(' · ')
    return targets ? `${head || 'scope'} → ${targets}` : (head || 'scope')
  }).join(' | ')
}

export function formatMaterialStatus(
  materials: Array<{ name?: string }> | null | undefined,
  options: { attachmentExpected?: boolean; attachmentReady?: boolean } = {},
): { status: string; count: number } {
  const list = materials ?? []
  const count = list.length
  if (count > 0) {
    const names = list.map(item => String(item.name ?? '').trim()).filter(Boolean).slice(0, 3)
    const suffix = names.length
      ? t(`：${names.join('、')}${count > 3 ? '…' : ''}`, `: ${names.join(', ')}${count > 3 ? '…' : ''}`)
      : ''
    return { status: t(`已挂载 ${count} 份材料${suffix}`, `Mounted ${count} materials${suffix}`), count }
  }
  if (options.attachmentExpected && !options.attachmentReady) {
    return { status: t('题目有附件，但本机会话尚未挂载材料', 'This challenge has attachments, but they are not mounted in this local session'), count: 0 }
  }
  if (options.attachmentExpected && options.attachmentReady) {
    return { status: t('附件已就绪', 'Attachments ready'), count: 0 }
  }
  return { status: t('无已挂载附件 / 无本地材料', 'No mounted attachments / no local materials'), count: 0 }
}

export function formatJudgeState(receipts: Array<{
  platform?: string
  status?: string
  correct?: boolean
  summary?: string
}> | null | undefined): string {
  const list = receipts ?? []
  if (!list.length) return t('尚无 Judge 回执', 'No Judge receipt yet')
  const latest = list[list.length - 1]
  const platform = String(latest.platform ?? 'Judge').trim() || 'Judge'
  const status = String(latest.status ?? '').trim() || (latest.correct ? 'correct' : 'pending')
  const mark = latest.correct ? t('已验证正确', 'Verified correct') : t('未通过 / 未确认', 'Failed / unconfirmed')
  return `${platform} · ${status} · ${mark}`
}

export function buildCTFDomainTaskContext(input: {
  jobId: string
  challengeId: string
  challengeTitle: string
  statement?: string
  category?: string
  objective?: string
  originLabel?: string
  role?: CTFDomainTaskContext['role']
  materials?: Array<{ name?: string }>
  /** Base grant from challenge.source.scope */
  sourceScope?: DomainScopeGrant | null
  /** Approved live network scopes (endpoint authorizations, etc.) */
  networkScopes?: DomainScopeGrant[] | null
  evidenceCount?: number
  artifactCount?: number
  judgeReceipts?: Array<{
    platform?: string
    status?: string
    correct?: boolean
    summary?: string
  }>
  attachmentExpected?: boolean
  attachmentReady?: boolean
}): CTFDomainTaskContext {
  const role = input.role ?? 'solver'
  const material = formatMaterialStatus(input.materials, {
    attachmentExpected: input.attachmentExpected,
    attachmentReady: input.attachmentReady,
  })
  return {
    kind: 'ctf',
    jobId: String(input.jobId ?? '').trim(),
    challengeId: String(input.challengeId ?? '').trim() || String(input.jobId ?? '').trim(),
    challengeTitle: String(input.challengeTitle ?? '').trim() || t('未命名题目', 'Untitled challenge'),
    statement: String(input.statement ?? '').trim(),
    category: String(input.category ?? '').trim(),
    objective: String(input.objective ?? '').trim() || t('分析题目并形成可验证的候选答案', 'Analyze the challenge and form a verifiable candidate answer'),
    originLabel: String(input.originLabel ?? '').trim(),
    materialNames: (input.materials ?? [])
      .map(item => String(item.name ?? '').trim())
      .filter(Boolean),
    role,
    roleLabel: ctfRoleLabel(role),
    materialStatus: material.status,
    materialCount: material.count,
    authorizedScope: formatAuthorizedScope(
      mergeAuthorizedScopes(input.sourceScope, input.networkScopes),
    ),
    evidenceCount: Number(input.evidenceCount ?? 0) || 0,
    artifactCount: Number(input.artifactCount ?? 0) || 0,
    judgeState: formatJudgeState(input.judgeReceipts),
    liveProjection: true,
  }
}

export function buildCVEDomainTaskContext(input: {
  cveId: string
  title?: string
  summary?: string
  vendor?: string
  product?: string
  affected?: string
  sourceEvidence?: Array<{ sourceName?: string; cacheState?: string; digest?: string }>
  assets?: Array<{ name?: string; status?: string; environment?: string; address?: string }>
  researchScope?: string
  safetyBoundary?: string
  practiceScope?: string
}): CVEDomainTaskContext {
  const cveId = String(input.cveId ?? '').trim()
  const sources = input.sourceEvidence ?? []
  const assets = input.assets ?? []
  const sourceEvidenceState = sources.length
    ? sources.slice(0, 3).map(item => {
        const name = String(item.sourceName ?? 'source').trim()
        const state = String(item.cacheState ?? '').trim()
        return state ? t(`${name}（${state}）`, `${name} (${state})`) : name
      }).join(t('；', '; ')) + (sources.length > 3 ? '…' : '')
    : t('尚无用户导入 Feed / 来源证据', 'No user-imported feed / source evidence yet')
  const assetMatchState = assets.length
    ? assets.slice(0, 3).map(item => {
        const name = String(item.name ?? 'asset').trim()
        const status = String(item.status ?? 'unknown').trim()
        const env = String(item.environment ?? '').trim()
        return env ? `${name} · ${status} · ${env}` : `${name} · ${status}`
      }).join(t('；', '; ')) + (assets.length > 3 ? '…' : '')
    : t('尚无用户确认资产匹配', 'No user-confirmed asset match yet')
  const researchScope = String(input.researchScope ?? '').trim()
    || t('当前会话与用户所选项目/材料', 'Current session and the project/materials the user selected')
  const safetyBoundary = String(input.safetyBoundary ?? '').trim()
    || t('沿用 Coding Agent 当前权限档与既有外部效果确认', 'Follow the current Coding Agent permission profile and existing external-effect confirmation')
  return {
    kind: 'cve',
    cveId,
    title: String(input.title ?? '').trim() || t(`${cveId} 研究接力`, `${cveId} research handoff`),
    summary: String(input.summary ?? '').trim(),
    vendor: String(input.vendor ?? '').trim(),
    product: String(input.product ?? '').trim(),
    affected: String(input.affected ?? '').trim(),
    sourceEvidenceState,
    sourceEvidenceCount: sources.length,
    assetMatchState,
    assetCount: assets.length,
    researchScope: input.practiceScope
      ? t(`${researchScope} · 练习：${input.practiceScope}`, `${researchScope} · Practice: ${input.practiceScope}`)
      : researchScope,
    safetyBoundary,
    roleLabel: t('CVE 研究接力', 'CVE research handoff'),
  }
}

/** Merge live CTF projection facts into a handoff snapshot without inventing domain ownership. */
export function refreshCTFDomainTaskContext(
  base: CTFDomainTaskContext | null | undefined,
  live?: {
    challengeId?: string
    challengeTitle?: string
    materials?: Array<{ name?: string }>
    /** challenge.source.scope from live projection */
    sourceScope?: DomainScopeGrant | null
    networkScopes?: DomainScopeGrant[] | null
    evidenceCount?: number
    artifactCount?: number
    judgeReceipts?: Array<{
      platform?: string
      status?: string
      correct?: boolean
    }>
  } | null,
): CTFDomainTaskContext | null {
  if (!base || base.kind !== 'ctf') return base ?? null
  if (!live) return base
  const material = live.materials
    ? formatMaterialStatus(live.materials)
    : { status: base.materialStatus, count: base.materialCount }
  const hasLiveScopes = live.sourceScope !== undefined || live.networkScopes !== undefined
  return {
    ...base,
    challengeId: String(live.challengeId ?? base.challengeId).trim() || base.challengeId,
    challengeTitle: String(live.challengeTitle ?? base.challengeTitle).trim() || base.challengeTitle,
    materialStatus: material.status,
    materialCount: material.count,
    materialNames: live.materials
      ? live.materials.map(item => String(item.name ?? '').trim()).filter(Boolean)
      : (base.materialNames ?? []),
    authorizedScope: hasLiveScopes
      ? formatAuthorizedScope(mergeAuthorizedScopes(
          live.sourceScope ?? null,
          live.networkScopes ?? [],
        ))
      : base.authorizedScope,
    evidenceCount: typeof live.evidenceCount === 'number' ? live.evidenceCount : base.evidenceCount,
    artifactCount: typeof live.artifactCount === 'number' ? live.artifactCount : base.artifactCount,
    judgeState: live.judgeReceipts ? formatJudgeState(live.judgeReceipts) : base.judgeState,
    liveProjection: true,
  }
}

export function presentDomainTaskContext(
  context: DomainTaskContext,
): DomainTaskContextPresentation {
  if (context.kind === 'lab') {
    const title = context.title || context.request || t('实验室作业', 'Lab job')
    const scopeLabel = context.scope === 'local' ? t('本地', 'Local') : t('远程', 'Remote')
    return {
      kind: 'lab',
      moduleLabel: t('实验室', 'Lab'),
      title,
      subtitle: scopeLabel,
      ownership: '',
      returnLabel: t('返回实验室', 'Back to Lab'),
      returnAriaLabel: t('返回实验室', 'Back to Lab'),
      collapsedLabel: t(`实验室 · ${title}`, `Lab · ${title}`),
      objectiveLabel: t('范围', 'Scope'),
      objective: scopeLabel,
      briefLabel: t('作业', 'Job'),
      brief: context.request || title,
      meta: [scopeLabel],
      materials: [],
      detailsLabel: t('报告', 'Report'),
      facts: [
        { label: t('范围', 'Scope'), value: scopeLabel, kind: 'scope' },
        { label: t('要求', 'Request'), value: context.request || title, kind: 'other' },
      ],
    }
  }

  if (context.kind === 'ctf') {
    const title = context.challengeTitle
    const idLabel = context.challengeId || context.jobId
    return {
      kind: 'ctf',
      moduleLabel: 'CTF',
      title,
      subtitle: idLabel,
      ownership: '',
      returnLabel: t('返回 CTF', 'Back to CTF'),
      returnAriaLabel: t('返回 CTF 工作台', 'Back to CTF workspace'),
      collapsedLabel: `CTF · ${title}`,
      objectiveLabel: t('当前目标', 'Current goal'),
      objective: context.objective || t('分析题目并形成可验证的候选答案', 'Analyze the challenge and form a verifiable candidate answer'),
      briefLabel: t('任务简报', 'Task briefing'),
      brief: context.statement || t('题面暂未带入，可返回 CTF 查看完整内容。', 'Challenge text was not brought in. Return to CTF for the full statement.'),
      meta: [context.category, context.originLabel || idLabel]
        .filter((value): value is string => Boolean(value)),
      materials: context.materialNames ?? [],
      detailsLabel: t('权限与来源', 'Permissions and sources'),
      facts: [
        { label: t('本次权限', 'This session’s permissions'), value: context.authorizedScope, kind: 'scope' },
      ],
    }
  }

  return {
    kind: 'cve',
    moduleLabel: 'CVE',
    title: context.title,
    subtitle: context.cveId,
    ownership: '',
    returnLabel: t('返回 CVE', 'Back to CVE'),
    returnAriaLabel: t('返回 CVE 工作台', 'Back to CVE workspace'),
    collapsedLabel: `CVE · ${context.cveId}`,
    objectiveLabel: t('当前目标', 'Current goal'),
    objective: t('整理影响范围、版本证据与后续安全验证方向', 'Organize impact scope, version evidence, and next security verification steps'),
    briefLabel: t('漏洞摘要', 'Vulnerability summary'),
    brief: context.summary || t('暂无摘要，可返回 CVE 查看公开来源与完整信息。', 'No summary yet. Return to CVE for public sources and full details.'),
    meta: [context.cveId, [context.vendor, context.product].filter(Boolean).join(' / '), context.affected]
      .filter((value): value is string => Boolean(value)),
    materials: [],
    detailsLabel: t('研究边界与来源', 'Research boundary and sources'),
    facts: [
      { label: t('来源', 'Source'), value: context.sourceEvidenceState, kind: 'evidence' },
      { label: t('研究范围', 'Research scope'), value: context.researchScope, kind: 'scope' },
      { label: t('安全边界', 'Safety boundary'), value: context.safetyBoundary, kind: 'boundary' },
    ],
  }
}

export function sharedCodingSessionKind(
  ctfSession: boolean,
  vulnerabilitySession: boolean,
): DomainTaskKind | 'coding' {
  if (ctfSession) return 'ctf'
  if (vulnerabilitySession) return 'cve'
  return 'coding'
}

export function isDomainTaskContext(value: unknown): value is DomainTaskContext {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'ctf') {
    return typeof record.jobId === 'string' && typeof record.challengeTitle === 'string'
  }
  if (record.kind === 'cve') {
    return typeof record.cveId === 'string' && typeof record.researchScope === 'string'
  }
  if (record.kind === 'lab') {
    return typeof record.jobId === 'string' && typeof record.title === 'string'
  }
  return false
}

export function normalizeDomainTaskContext(raw: unknown): DomainTaskContext | undefined {
  if (!isDomainTaskContext(raw)) return undefined
  if (raw.kind === 'ctf') {
    return {
      kind: 'ctf',
      jobId: String(raw.jobId ?? '').trim(),
      challengeId: String(raw.challengeId ?? '').trim() || String(raw.jobId ?? '').trim(),
      challengeTitle: String(raw.challengeTitle ?? '').trim() || t('未命名题目', 'Untitled challenge'),
      statement: String(raw.statement ?? '').trim(),
      category: String(raw.category ?? '').trim(),
      objective: String(raw.objective ?? '').trim() || t('分析题目并形成可验证的候选答案', 'Analyze the challenge and form a verifiable candidate answer'),
      originLabel: String(raw.originLabel ?? '').trim(),
      materialNames: Array.isArray(raw.materialNames)
        ? raw.materialNames.map(item => String(item).trim()).filter(Boolean)
        : [],
      role: ['solver', 'tool-builder', 'strategist'].includes(String(raw.role))
        ? raw.role as CTFDomainTaskContext['role']
        : 'solver',
      roleLabel: String(raw.roleLabel ?? '').trim() || ctfRoleLabel(
        ['solver', 'tool-builder', 'strategist'].includes(String(raw.role))
          ? raw.role as CTFDomainTaskContext['role']
          : 'solver',
      ),
      materialStatus: String(raw.materialStatus ?? '').trim() || t('无已挂载附件 / 无本地材料', 'No mounted attachments / no local materials'),
      materialCount: Number(raw.materialCount ?? 0) || 0,
      authorizedScope: String(raw.authorizedScope ?? '').trim() || t('未授权 Scope', 'Unauthorized scope'),
      evidenceCount: Number(raw.evidenceCount ?? 0) || 0,
      artifactCount: Number(raw.artifactCount ?? 0) || 0,
      judgeState: String(raw.judgeState ?? '').trim() || t('尚无 Judge 回执', 'No Judge receipt yet'),
      liveProjection: raw.liveProjection !== false,
    }
  }
  if (raw.kind === 'lab') {
    const legacy = raw as LabDomainTaskContext & { protocol?: string; address?: string }
    const request = String(legacy.request ?? '').trim()
      || [legacy.protocol, legacy.address].map(value => String(value ?? '').trim()).filter(Boolean).join(' ')
    return {
      kind: 'lab',
      jobId: String(raw.jobId ?? '').trim(),
      title: String(raw.title ?? '').trim() || t('实验室作业', 'Lab job'),
      scope: raw.scope === 'local' ? 'local' : 'remote',
      request,
    }
  }
  return {
    kind: 'cve',
    cveId: String(raw.cveId ?? '').trim(),
    title: String(raw.title ?? '').trim() || t('CVE 研究接力', 'CVE research handoff'),
    summary: String(raw.summary ?? '').trim(),
    vendor: String(raw.vendor ?? '').trim(),
    product: String(raw.product ?? '').trim(),
    affected: String(raw.affected ?? '').trim(),
    sourceEvidenceState: String(raw.sourceEvidenceState ?? '').trim() || t('尚无用户导入 Feed / 来源证据', 'No user-imported feed / source evidence yet'),
    sourceEvidenceCount: Number(raw.sourceEvidenceCount ?? 0) || 0,
    assetMatchState: String(raw.assetMatchState ?? '').trim() || t('尚无用户确认资产匹配', 'No user-confirmed asset match yet'),
    assetCount: Number(raw.assetCount ?? 0) || 0,
    researchScope: String(raw.researchScope ?? '').trim()
      || t('当前会话与用户所选项目/材料', 'Current session and the project/materials the user selected'),
    safetyBoundary: String(raw.safetyBoundary ?? '').trim()
      || t('沿用 Coding Agent 当前权限档与既有外部效果确认', 'Follow the current Coding Agent permission profile and existing external-effect confirmation'),
    roleLabel: String(raw.roleLabel ?? '').trim() || t('CVE 研究接力', 'CVE research handoff'),
  }
}
