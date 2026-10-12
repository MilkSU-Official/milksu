import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

/**
 * Reverse-artifact view model derived from `milksu-rea` MCP tool traffic.
 *
 * The Pi session exposes one proxy tool named `mcp__milksu-rea`. Each call
 * starts with `{ tool, args }` (tool.started) and ends with the underlying
 * REA tool's JSON result (tool.completed). REA returns two envelopes:
 * evidence tools carry `{ result, evidence_id, evidence }`; session tools
 * carry `{ result }`. Everything below is a pure derivation from the
 * conversation message stream, mirroring how `agentFileDiffChips` derives
 * file-diff chips, so the panel stays a read view of what the agent actually
 * ran instead of a second analysis pipeline.
 */

/**
 * REA calls surface through three proxy spellings, depending on the adapter
 * mode: the global `mcp` tool (single proxy surface, arguments carry the
 * underlying tool name), or a per-server `mcp__milksu_rea` proxy (server
 * namespace formats dashes to underscores). A global `mcp` call only counts
 * when its `tool` argument belongs to the reviewed REA allowlist; calls into
 * other servers keep flowing past this panel.
 */
export const reaProxyToolNames = ['mcp__milksu_rea', 'mcp__milksu-rea']

const reaToolAllowlist = new Set([
  'binary_session',
  'open_binary',
  'close_binary',
  'binary_overview',
  'list_procedures',
  'search_procedures',
  'analyze_function',
  'inspect_analysis_view',
  'analyze_javascript_application',
  'trace_application_feature',
  'trace_feature',
  'trace_call_path',
  'inspect_artifact',
  'inspect_managed_artifact',
  'inspect_android_package',
  'list_unknowns',
  'record_unknown',
  'update_unknown',
  'export_evidence_bundle',
])

function underlyingReaTool(rawTool: string): string | undefined {
  const stripped = rawTool
    .replace(/^milksu[-_]rea_/, '')
    .replace(/^milksu[-_]rea__/, '')
  return reaToolAllowlist.has(rawTool) || reaToolAllowlist.has(stripped)
    ? stripped || rawTool
    : undefined
}

/** True when a tool message belongs to the reviewed milksu-rea surface. */
export function isReaToolMessage(message: Pick<Message, 'role' | 'toolName' | 'content'>): boolean {
  if (message.role !== 'tool') return false
  const toolName = message.toolName ?? ''
  if (reaProxyToolNames.includes(toolName)) return true
  if (toolName !== 'mcp') return false
  const params = parseMaybeJson(message.content) as { tool?: unknown } | undefined
  if (typeof params?.tool !== 'string') return false
  return underlyingReaTool(params.tool) !== undefined
}

export interface ReverseTarget {
  path: string
  name: string
  format?: string
  architecture?: string | null
  sha256?: string
  providerName?: string
  providerVersion?: string
  runId?: string
  procedureCount?: number
  stringCount?: number
  segmentCount?: number
  moduleCount?: number
  ipcChannelCount?: number
  closed: boolean
  updatedAt: number
}

export interface ReverseFunction {
  address: string
  name: string
  via: 'listed' | 'dossier'
}

export interface ReverseReference {
  address: string
  name: string
}

export interface ReverseDossier {
  address: string
  name: string
  signature?: string | null
  pseudocode: string
  assembly: string[]
  callers: ReverseReference[]
  callees: ReverseReference[]
  bodyAvailable: boolean
  bodyReason?: string
  limitations: string[]
  evidenceId?: string
  receivedAt: number
}

export interface ReverseEvidenceEntry {
  toolCallId: string
  operation: string
  evidenceId?: string
  provider?: string
  confidence?: string
  subject?: string
  summary: string
  parametersText?: string
  isError: boolean
  oversized: boolean
  receivedAt: number
}

export interface ReverseUnknownEntry {
  unknownId?: string
  question: string
  status?: string
  severity?: string
  receivedAt: number
}

export interface ReverseTraceStep {
  label: string
  detail?: string
}

export interface ReverseTrace {
  kind: 'application' | 'call-path' | 'feature'
  title: string
  steps: ReverseTraceStep[]
  unknowns: string[]
  receivedAt: number
}

export interface ReverseExportReceipt {
  path: string
  bytes: number
  records: number
  unknowns: number
  receivedAt: number
}

export interface ReverseSession {
  hasTraffic: boolean
  runningTool?: string
  target: ReverseTarget | null
  functions: ReverseFunction[]
  dossiers: ReverseDossier[]
  selectedDossier: ReverseDossier | null
  evidence: ReverseEvidenceEntry[]
  unknowns: ReverseUnknownEntry[]
  traces: ReverseTrace[]
  exports: ReverseExportReceipt[]
}

interface ReaCall {
  toolCallId: string
  tool?: string
  argsText?: string
  resultText?: string
  isError?: boolean
  receivedAt: number
}

function messageTimestamp(message: Message): number {
  return typeof message.timestamp === 'number' ? message.timestamp : 0
}

function parseMaybeJson(text: string | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * MCP output can be truncated or suffixed by the adapter's output guard.
 * A payload only counts as parseable when the JSON round-trips and exposes
 * a `result` object; anything else degrades to a timeline entry.
 */
function parseReaEnvelope(text: string | undefined): { result?: unknown; evidence?: Record<string, unknown>; evidenceId?: string } | undefined {
  const parsed = parseMaybeJson(text)
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const result = record.result
  if (result == null || typeof result !== 'object') return undefined
  const evidence = record.evidence != null && typeof record.evidence === 'object' && !Array.isArray(record.evidence)
    ? record.evidence as Record<string, unknown>
    : undefined
  const evidenceId = typeof record.evidence_id === 'string' ? record.evidence_id : undefined
  return { result, evidence, evidenceId }
}

function collectReaCalls(messages: Message[]): ReaCall[] {
  const calls = new Map<string, ReaCall>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const toolCallId = message.toolCallId ?? ''
    if (!toolCallId) continue
    const existing = calls.get(toolCallId)
    if (message.status === 'running') {
      // Start payloads carry the underlying tool name; only they can prove a
      // global `mcp` call belongs to the reviewed REA surface.
      if (!isReaToolMessage(message)) continue
      const timestamp = messageTimestamp(message)
      const params = parseMaybeJson(message.content) as { tool?: unknown; args?: unknown } | undefined
      const rawTool = typeof params?.tool === 'string' ? params.tool : undefined
      calls.set(toolCallId, {
        toolCallId,
        tool: rawTool ? underlyingReaTool(rawTool) ?? rawTool.replace(/^milksu[-_]rea_?_?/, '') : existing?.tool,
        argsText: params && typeof params.args === 'object' && params.args != null
          ? JSON.stringify(params.args)
          : existing?.argsText ?? message.content,
        resultText: existing?.resultText,
        isError: existing?.isError,
        receivedAt: existing?.receivedAt ?? timestamp,
      })
      continue
    }
    // Results carry no tool name under the global proxy; a call only counts
    // when its verified start (same toolCallId) is already in the ledger.
    if (!existing) continue
    calls.set(toolCallId, {
      toolCallId,
      tool: existing.tool,
      argsText: existing.argsText,
      resultText: message.content,
      isError: existing.isError === true,
      receivedAt: existing.receivedAt,
    })
  }
  return [...calls.values()].sort((left, right) => left.receivedAt - right.receivedAt)
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function identityOf(reference: unknown): ReverseReference | null {
  if (reference == null || typeof reference !== 'object') return null
  const record = reference as Record<string, unknown>
  const address = textOf(record.address)
  const nested = record.procedure != null && typeof record.procedure === 'object'
    ? record.procedure as Record<string, unknown>
    : undefined
  const name = textOf(record.name) ?? textOf(record.value) ?? textOf(nested?.name) ?? textOf(nested?.value)
  if (!address && !name) return null
  return { address: address ?? '', name: name ?? address ?? '' }
}

function applySessionTarget(session: { target: ReverseTarget | null }, result: Record<string, unknown>, receivedAt: number): void {
  const path = textOf(result.path)
  if (!path) return
  const binding = result.analysis_provider_binding != null && typeof result.analysis_provider_binding === 'object'
    ? result.analysis_provider_binding as Record<string, unknown>
    : undefined
  const provider = binding?.provider != null && typeof binding.provider === 'object'
    ? binding.provider as Record<string, unknown>
    : undefined
  const run = result.analysis_run != null && typeof result.analysis_run === 'object'
    ? result.analysis_run as Record<string, unknown>
    : undefined
  session.target = {
    path,
    name: baseName(path),
    format: textOf(result.format) ?? session.target?.format,
    architecture: typeof result.architecture === 'string' ? result.architecture : session.target?.architecture ?? null,
    sha256: textOf(result.sha256) ?? session.target?.sha256,
    providerName: textOf(provider?.name) ?? textOf(provider?.id) ?? session.target?.providerName,
    providerVersion: textOf(provider?.version) ?? session.target?.providerVersion,
    runId: textOf(run?.run_id) ?? session.target?.runId,
    procedureCount: session.target?.procedureCount,
    stringCount: session.target?.stringCount,
    segmentCount: session.target?.segmentCount,
    moduleCount: session.target?.moduleCount,
    ipcChannelCount: session.target?.ipcChannelCount,
    closed: session.target?.closed ?? false,
    updatedAt: receivedAt,
  }
}

function applyOverview(session: ReverseSession, result: Record<string, unknown>, receivedAt: number): void {
  if (!session.target) return
  session.target.procedureCount = countOf(result.procedure_count) ?? session.target.procedureCount
  session.target.stringCount = countOf(result.string_count) ?? session.target.stringCount
  session.target.segmentCount = countOf(result.segment_count) ?? session.target.segmentCount
  session.target.updatedAt = receivedAt
}

function applyJavaScriptAnalysis(session: ReverseSession, result: Record<string, unknown>, receivedAt: number): void {
  const summary = result.summary != null && typeof result.summary === 'object'
    ? result.summary as Record<string, unknown>
    : undefined
  const statistics = result.statistics != null && typeof result.statistics === 'object'
    ? result.statistics as Record<string, unknown>
    : undefined
  const path = textOf(result.input_path)
  if (path && (!session.target || session.target.path !== path)) {
    session.target = {
      path,
      name: baseName(path),
      format: textOf(result.format) ?? 'javascript',
      architecture: null,
      closed: false,
      updatedAt: receivedAt,
    }
  } else if (session.target) {
    session.target.updatedAt = receivedAt
  }
  if (session.target) {
    session.target.moduleCount = countOf(statistics?.modules) ?? session.target.moduleCount
    const ipc = summary?.ipc != null && typeof summary.ipc === 'object'
      ? summary.ipc as Record<string, unknown>
      : undefined
    session.target.ipcChannelCount = countOf(ipc?.literal_channels) ?? countOf(ipc?.operations) ?? session.target.ipcChannelCount
  }
}

function applyDossier(session: ReverseSession, result: Record<string, unknown>, evidenceId: string | undefined, receivedAt: number): void {
  const procedure = result.procedure != null && typeof result.procedure === 'object'
    ? result.procedure as Record<string, unknown>
    : undefined
  const address = textOf(procedure?.address)
  const name = textOf(procedure?.name)
  if (!address && !name) return
  const body = procedure?.body != null && typeof procedure.body === 'object'
    ? procedure.body as Record<string, unknown>
    : undefined
  const references = (key: string): ReverseReference[] => {
    const list = Array.isArray(result[key]) ? result[key] : []
    return list
      .map(identityOf)
      .filter((item): item is ReverseReference => item != null)
  }
  const pseudocode = typeof result.pseudocode === 'string' ? result.pseudocode : ''
  const assembly = Array.isArray(result.assembly)
    ? result.assembly.filter((item): item is string => typeof item === 'string')
    : []
  const limitations = Array.isArray(result.limitations)
    ? result.limitations.filter((item): item is string => typeof item === 'string')
    : []
  const dossier: ReverseDossier = {
    address: address ?? name ?? '',
    name: name ?? address ?? '',
    signature: typeof procedure?.signature === 'string' ? procedure.signature : null,
    pseudocode,
    assembly,
    callers: references('callers'),
    callees: references('callees'),
    bodyAvailable: body == null || body.available !== false,
    bodyReason: textOf(body?.reason),
    limitations,
    evidenceId,
    receivedAt,
  }
  const index = session.dossiers.findIndex(item => item.address === dossier.address)
  if (index >= 0) session.dossiers[index] = dossier
  else session.dossiers.unshift(dossier)
  addFunction(session, dossier.address, dossier.name, 'dossier')
  for (const reference of [...dossier.callers, ...dossier.callees]) {
    addFunction(session, reference.address, reference.name, 'dossier')
  }
}

function addFunction(session: ReverseSession, address: string, name: string, via: ReverseFunction['via']): void {
  if (!address && !name) return
  const key = address || name
  const existing = session.functions.find(item => (item.address || item.name) === key)
  if (existing) {
    if (via === 'listed') existing.via = 'listed'
    return
  }
  session.functions.push({ address, name, via })
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function applyProcedureList(session: ReverseSession, result: unknown): void {
  const list = Array.isArray(result) ? result : undefined
  if (!list) return
  for (const item of list) {
    const identity = identityOf(item)
    if (identity) addFunction(session, identity.address, identity.name, 'listed')
  }
}

function applyUnknowns(session: ReverseSession, result: Record<string, unknown>, receivedAt: number): void {
  const items = result.items != null && Array.isArray(result.items) ? result.items : [result]
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const question = textOf(record.question)
    if (!question) continue
    const unknown: ReverseUnknownEntry = {
      unknownId: textOf(record.unknown_id),
      question,
      status: textOf(record.status),
      severity: textOf(record.severity),
      receivedAt,
    }
    const index = unknown.unknownId
      ? session.unknowns.findIndex(entry => entry.unknownId === unknown.unknownId)
      : session.unknowns.findIndex(entry => entry.question === unknown.question)
    if (index >= 0) session.unknowns[index] = unknown
    else session.unknowns.unshift(unknown)
  }
}

function stepLabel(value: unknown): ReverseTraceStep | null {
  if (value == null) return null
  if (typeof value === 'string') return { label: value }
  if (typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const label = textOf(record.label) ?? textOf(record.name) ?? textOf(record.title) ?? textOf(record.value)
  if (!label) return null
  const detail = textOf(record.detail) ?? textOf(record.reason) ?? textOf(record.channel)
    ?? textOf(record.node_id) ?? textOf(record.address)
  return { label, detail }
}

function applyTrace(session: ReverseSession, tool: string, result: Record<string, unknown>, receivedAt: number): void {
  const steps: ReverseTraceStep[] = []
  const kind: ReverseTrace['kind'] = tool === 'trace_call_path' ? 'call-path' : 'application'
  for (const key of ['steps', 'nodes', 'matches', 'chain', 'path']) {
    const list = Array.isArray(result[key]) ? result[key] : undefined
    if (!list) continue
    for (const item of list) {
      const step = stepLabel(item)
      if (step) steps.push(step)
    }
  }
  const unknowns = Array.isArray(result.residual_unknowns)
    ? result.residual_unknowns.filter((item): item is string => typeof item === 'string')
    : []
  const query = textOf(result.query)
  const title = query ?? steps[0]?.label ?? tool
  session.traces.unshift({ kind, title, steps, unknowns, receivedAt })
  if (session.traces.length > 20) session.traces.length = 20
}

function applyExport(session: ReverseSession, result: Record<string, unknown>, receivedAt: number): void {
  const path = textOf(result.path)
  if (!path) return
  session.exports.unshift({
    path,
    bytes: countOf(result.bytes) ?? 0,
    records: countOf(result.records) ?? 0,
    unknowns: countOf(result.unknowns) ?? 0,
    receivedAt,
  })
}

function evidenceSummary(operation: string, result: unknown, evidence?: Record<string, unknown>): string {
  const resultRecord = asRecord(result)
  const procedure = resultRecord?.procedure != null && typeof resultRecord.procedure === 'object'
    ? resultRecord.procedure as Record<string, unknown>
    : undefined
  switch (operation) {
    case 'analyze_function':
      return t('函数反编译', 'Function decompilation') + ' · ' + (textOf(procedure?.name) ?? textOf(procedure?.address) ?? '')
    case 'binary_overview': {
      const count = countOf(resultRecord?.procedure_count)
      return t('二进制概览', 'Binary overview') + (count != null ? ` · ${count}` : '')
    }
    case 'open_binary':
      return t('打开目标', 'Opened target') + ' · ' + baseName(textOf(resultRecord?.path) ?? '')
    case 'close_binary':
      return t('关闭目标', 'Closed target')
    case 'analyze_javascript_application':
      return t('应用分析', 'Application analysis')
    case 'trace_application_feature':
      return t('功能追踪', 'Feature trace')
    case 'trace_feature':
      return t('字面追踪', 'Literal trace')
    case 'trace_call_path':
      return t('调用路径', 'Call path')
    case 'inspect_artifact':
      return t('制品检查', 'Artifact inspection')
    case 'inspect_managed_artifact':
      return t('.NET 检查', '.NET inspection')
    case 'inspect_android_package':
      return t('APK 检查', 'APK inspection')
    case 'inspect_analysis_view':
      return t('分析视图', 'Analysis view')
    case 'export_evidence_bundle':
      return t('导出证据', 'Exported evidence')
    case 'list_unknowns':
    case 'record_unknown':
    case 'update_unknown':
      return t('未知项', 'Unknowns')
    case 'binary_session':
      return t('会话状态', 'Session status')
    default:
      break
  }
  const subject = evidence?.subject != null && typeof evidence.subject === 'object'
    ? (evidence.subject as Record<string, unknown>)
    : undefined
  const subjectName = textOf(subject?.name)
  return operation + (subjectName ? ` · ${subjectName}` : '')
}

export function deriveReverseSession(messages: Message[]): ReverseSession {
  const session: ReverseSession = {
    hasTraffic: false,
    target: null,
    functions: [],
    dossiers: [],
    selectedDossier: null,
    evidence: [],
    unknowns: [],
    traces: [],
    exports: [],
  }
  const calls = collectReaCalls(messages)
  if (calls.length === 0) return session
  session.hasTraffic = true

  for (const call of calls) {
    if (call.resultText == null) {
      // Started but not finished: the running indicator for the panel header.
      session.runningTool = call.tool
      continue
    }
    const envelope = parseReaEnvelope(call.resultText)
    const operation = call.tool ?? ''
    const receivedAt = call.receivedAt
    const evidence = envelope?.evidence
    const evidenceId = envelope?.evidenceId
      ?? (evidence != null && typeof evidence.evidence_id === 'string' ? evidence.evidence_id : undefined)
    const provider = evidence != null && typeof evidence.provider === 'object' && !Array.isArray(evidence.provider)
      ? (evidence.provider as Record<string, unknown>)
      : undefined
    const subject = evidence != null && typeof evidence.subject === 'object' && !Array.isArray(evidence.subject)
      ? (evidence.subject as Record<string, unknown>)
      : undefined
    const args = parseMaybeJson(call.argsText) as { args?: unknown } | undefined
    const argsRecord = args?.args != null && typeof args.args === 'object' && !Array.isArray(args.args)
      ? args.args as Record<string, unknown>
      : undefined
    session.evidence.push({
      toolCallId: call.toolCallId,
      operation,
      evidenceId,
      provider: textOf(provider?.name),
      confidence: textOf(evidence?.confidence),
      subject: textOf(subject?.name),
      summary: envelope
        ? evidenceSummary(operation, envelope.result, evidence)
        : operation || 'mcp',
      parametersText: argsRecord ? JSON.stringify(argsRecord) : call.argsText,
      isError: call.isError === true,
      oversized: envelope == null,
      receivedAt,
    })

    if (!envelope) continue
    const result = envelope.result
    const resultRecord = asRecord(result)
    switch (operation) {
      case 'open_binary':
      case 'binary_session':
        if (resultRecord) applySessionTarget(session, resultRecord, receivedAt)
        break
      case 'binary_overview':
        if (resultRecord) applyOverview(session, resultRecord, receivedAt)
        break
      case 'analyze_javascript_application':
        if (resultRecord) applyJavaScriptAnalysis(session, resultRecord, receivedAt)
        break
      case 'list_procedures':
      case 'search_procedures':
        applyProcedureList(session, result)
        break
      case 'analyze_function':
        if (resultRecord) applyDossier(session, resultRecord, evidenceId, receivedAt)
        break
      case 'trace_application_feature':
      case 'trace_feature':
      case 'trace_call_path':
        if (resultRecord) applyTrace(session, operation, resultRecord, receivedAt)
        break
      case 'list_unknowns':
      case 'record_unknown':
      case 'update_unknown':
        if (resultRecord) applyUnknowns(session, resultRecord, receivedAt)
        break
      case 'export_evidence_bundle':
        if (resultRecord) applyExport(session, resultRecord, receivedAt)
        break
      case 'close_binary':
        if (session.target) {
          session.target.closed = true
          session.target.updatedAt = receivedAt
        }
        break
      default:
        break
    }
  }
  session.evidence.reverse()
  return session
}

export function selectDossier(session: ReverseSession, address: string): ReverseDossier | null {
  return session.dossiers.find(dossier => dossier.address === address) ?? null
}

export function reaRunningLabel(session: ReverseSession): string | null {
  if (!session.runningTool) return null
  const names: Record<string, string> = {
    analyze_function: t('分析函数', 'Analyzing function'),
    binary_overview: t('读取概览', 'Reading overview'),
    open_binary: t('打开目标', 'Opening target'),
    analyze_javascript_application: t('分析应用', 'Analyzing application'),
    trace_application_feature: t('追踪功能', 'Tracing feature'),
    search_procedures: t('搜索函数', 'Searching functions'),
    list_procedures: t('列出函数', 'Listing functions'),
    export_evidence_bundle: t('导出证据', 'Exporting evidence'),
  }
  return names[session.runningTool] ?? session.runningTool
}
