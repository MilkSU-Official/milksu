/**
 * Shared Coding/Pi session domain-task context for CTF and CVE.
 *
 * Domain modules remain the source of truth. This module only shapes a
 * structured handoff snapshot for the shared ChatPage panel — never a second
 * agent harness, and never by parsing free-form prompt text.
 */

export type DomainTaskKind = 'ctf' | 'cve'

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

export type DomainTaskContext = CTFDomainTaskContext | CVEDomainTaskContext

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
  return kind === 'ctf' ? 'CTF' : 'CVE'
}

export function ctfRoleLabel(role: CTFDomainTaskContext['role'] | undefined): string {
  if (role === 'tool-builder') return 'Coding Agent 工具工坊'
  if (role === 'strategist') return '策略 Agent 复盘'
  return '解题 Agent'
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
  if (!active.length) return '未授权 Scope'
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
    const suffix = names.length ? `：${names.join('、')}${count > 3 ? '…' : ''}` : ''
    return { status: `已挂载 ${count} 份材料${suffix}`, count }
  }
  if (options.attachmentExpected && !options.attachmentReady) {
    return { status: '题目有附件，但本机会话尚未挂载材料', count: 0 }
  }
  if (options.attachmentExpected && options.attachmentReady) {
    return { status: '附件已就绪', count: 0 }
  }
  return { status: '无已挂载附件 / 无本地材料', count: 0 }
}

export function formatJudgeState(receipts: Array<{
  platform?: string
  status?: string
  correct?: boolean
  summary?: string
}> | null | undefined): string {
  const list = receipts ?? []
  if (!list.length) return '尚无 Judge 回执'
  const latest = list[list.length - 1]
  const platform = String(latest.platform ?? 'Judge').trim() || 'Judge'
  const status = String(latest.status ?? '').trim() || (latest.correct ? 'correct' : 'pending')
  const mark = latest.correct ? '已验证正确' : '未通过 / 未确认'
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
    challengeTitle: String(input.challengeTitle ?? '').trim() || '未命名题目',
    statement: String(input.statement ?? '').trim(),
    category: String(input.category ?? '').trim(),
    objective: String(input.objective ?? '').trim() || '分析题目并形成可验证的候选答案',
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
        return state ? `${name}（${state}）` : name
      }).join('；') + (sources.length > 3 ? '…' : '')
    : '尚无用户导入 Feed / 来源证据'
  const assetMatchState = assets.length
    ? assets.slice(0, 3).map(item => {
        const name = String(item.name ?? 'asset').trim()
        const status = String(item.status ?? 'unknown').trim()
        const env = String(item.environment ?? '').trim()
        return env ? `${name} · ${status} · ${env}` : `${name} · ${status}`
      }).join('；') + (assets.length > 3 ? '…' : '')
    : '尚无用户确认资产匹配'
  const researchScope = String(input.researchScope ?? '').trim()
    || '仅授权仓库/材料只读检查；禁止 PoC、exploit、外部扫描'
  const safetyBoundary = String(input.safetyBoundary ?? '').trim()
    || '学习与追踪 only：不自动拉镜像/启容器/开端口/触发漏洞输入/访问外部目标'
  return {
    kind: 'cve',
    cveId,
    title: String(input.title ?? '').trim() || `${cveId} 研究接力`,
    summary: String(input.summary ?? '').trim(),
    vendor: String(input.vendor ?? '').trim(),
    product: String(input.product ?? '').trim(),
    affected: String(input.affected ?? '').trim(),
    sourceEvidenceState,
    sourceEvidenceCount: sources.length,
    assetMatchState,
    assetCount: assets.length,
    researchScope: input.practiceScope
      ? `${researchScope} · 练习：${input.practiceScope}`
      : researchScope,
    safetyBoundary,
    roleLabel: 'CVE 只读/研究接力',
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
  if (context.kind === 'ctf') {
    const title = context.challengeTitle
    const idLabel = context.challengeId || context.jobId
    return {
      kind: 'ctf',
      moduleLabel: 'CTF',
      title,
      subtitle: idLabel,
      ownership: '',
      returnLabel: '返回 CTF',
      returnAriaLabel: '返回 CTF 工作台',
      collapsedLabel: `CTF · ${title}`,
      objectiveLabel: '当前目标',
      objective: context.objective || '分析题目并形成可验证的候选答案',
      briefLabel: '任务简报',
      brief: context.statement || '题面暂未带入，可返回 CTF 查看完整内容。',
      meta: [context.category, context.originLabel || idLabel]
        .filter((value): value is string => Boolean(value)),
      materials: context.materialNames ?? [],
      detailsLabel: '权限与来源',
      facts: [
        { label: '本次权限', value: context.authorizedScope, kind: 'scope' },
      ],
    }
  }

  return {
    kind: 'cve',
    moduleLabel: 'CVE',
    title: context.title,
    subtitle: context.cveId,
    ownership: '',
    returnLabel: '返回 CVE',
    returnAriaLabel: '返回 CVE 工作台',
    collapsedLabel: `CVE · ${context.cveId}`,
    objectiveLabel: '当前目标',
    objective: '整理影响范围、版本证据与后续安全验证方向',
    briefLabel: '漏洞摘要',
    brief: context.summary || '暂无摘要，可返回 CVE 查看公开来源与完整信息。',
    meta: [context.cveId, [context.vendor, context.product].filter(Boolean).join(' / '), context.affected]
      .filter((value): value is string => Boolean(value)),
    materials: [],
    detailsLabel: '研究边界与来源',
    facts: [
      { label: '来源', value: context.sourceEvidenceState, kind: 'evidence' },
      { label: '研究范围', value: context.researchScope, kind: 'scope' },
      { label: '安全边界', value: context.safetyBoundary, kind: 'boundary' },
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
  return false
}

export function normalizeDomainTaskContext(raw: unknown): DomainTaskContext | undefined {
  if (!isDomainTaskContext(raw)) return undefined
  if (raw.kind === 'ctf') {
    return {
      kind: 'ctf',
      jobId: String(raw.jobId ?? '').trim(),
      challengeId: String(raw.challengeId ?? '').trim() || String(raw.jobId ?? '').trim(),
      challengeTitle: String(raw.challengeTitle ?? '').trim() || '未命名题目',
      statement: String(raw.statement ?? '').trim(),
      category: String(raw.category ?? '').trim(),
      objective: String(raw.objective ?? '').trim() || '分析题目并形成可验证的候选答案',
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
      materialStatus: String(raw.materialStatus ?? '').trim() || '无已挂载附件 / 无本地材料',
      materialCount: Number(raw.materialCount ?? 0) || 0,
      authorizedScope: String(raw.authorizedScope ?? '').trim() || '未授权 Scope',
      evidenceCount: Number(raw.evidenceCount ?? 0) || 0,
      artifactCount: Number(raw.artifactCount ?? 0) || 0,
      judgeState: String(raw.judgeState ?? '').trim() || '尚无 Judge 回执',
      liveProjection: raw.liveProjection !== false,
    }
  }
  return {
    kind: 'cve',
    cveId: String(raw.cveId ?? '').trim(),
    title: String(raw.title ?? '').trim() || 'CVE 研究接力',
    summary: String(raw.summary ?? '').trim(),
    vendor: String(raw.vendor ?? '').trim(),
    product: String(raw.product ?? '').trim(),
    affected: String(raw.affected ?? '').trim(),
    sourceEvidenceState: String(raw.sourceEvidenceState ?? '').trim() || '尚无用户导入 Feed / 来源证据',
    sourceEvidenceCount: Number(raw.sourceEvidenceCount ?? 0) || 0,
    assetMatchState: String(raw.assetMatchState ?? '').trim() || '尚无用户确认资产匹配',
    assetCount: Number(raw.assetCount ?? 0) || 0,
    researchScope: String(raw.researchScope ?? '').trim()
      || '仅授权仓库/材料只读检查；禁止 PoC、exploit、外部扫描',
    safetyBoundary: String(raw.safetyBoundary ?? '').trim()
      || '学习与追踪 only：不自动拉镜像/启容器/开端口/触发漏洞输入/访问外部目标',
    roleLabel: String(raw.roleLabel ?? '').trim() || 'CVE 只读/研究接力',
  }
}
