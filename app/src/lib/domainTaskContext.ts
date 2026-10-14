/**
 * Shared Coding/Pi session domain-task context for CVE and Lab.
 *
 * Domain modules remain the source of truth. This module only shapes a
 * structured handoff snapshot for the shared ChatPage panel — never a second
 * agent harness, and never by parsing free-form prompt text.
 */

import { t } from '@/lib/uiLocale'

export type DomainTaskKind = 'cve' | 'lab'

export interface DomainTaskFact {
  label: string
  value: string
  kind?: 'id' | 'title' | 'material' | 'scope' | 'evidence' | 'asset' | 'boundary' | 'other'
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

export type DomainTaskContext = CVEDomainTaskContext | LabDomainTaskContext

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
  if (kind === 'lab') return t('实验室', 'Lab')
  return 'CVE'
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
  vulnerabilitySession: boolean,
): DomainTaskKind | 'coding' {
  if (vulnerabilitySession) return 'cve'
  return 'coding'
}

export function isDomainTaskContext(value: unknown): value is DomainTaskContext {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
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
  if (raw.kind !== 'cve') return undefined
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
