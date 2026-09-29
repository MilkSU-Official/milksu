export interface RendererDiagnosticEvent {
  timestamp: string
  category: string
  level: string
  message: string
}

type DiagnosticValue = string | number | boolean
type RendererDiagnosticAction =
  | 'section-change'
  | 'catalog-load'
  | 'catalog-search'
  | 'full-catalog-load'
  | 'training-progress-refresh'
  | 'catalog-sync'
  | 'dashboard-load'
  | 'rpc'

// 这份白名单与 internal/appdata/diagnostics.go 里的 rendererDiagnosticActions /
// rendererDiagnosticKeys / validRendererDiagnosticValue 是两份手写拷贝，改动时必须两边同步。
const MAX_EVENTS = 200
const events: RendererDiagnosticEvent[] = []
const allowedActions = new Set<RendererDiagnosticAction>([
  'section-change',
  'catalog-load',
  'catalog-search',
  'full-catalog-load',
  'training-progress-refresh',
  'catalog-sync',
  'dashboard-load',
  'rpc',
])
const allowedKeys = new Set([
  'method',
  'section',
  'view',
  'status',
  'count',
  'page',
  'durationMs',
  'errorKind',
])

function safeToken(value: DiagnosticValue): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : null
  if (typeof value === 'boolean') return String(value)
  const token = value.trim()
  return /^[a-z0-9_.:/-]+$/i.test(token) && token.length <= 80 ? token : null
}

function errorKind(reason: unknown): string {
  const message = String(reason ?? '').toLowerCase()
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout'
  if (message.includes('permission') || message.includes('access denied')) return 'permission'
  if (message.includes('network') || message.includes('fetch') || message.includes('connect')) return 'network'
  if (message.includes('invalid') || message.includes('decode')) return 'invalid'
  if (message.includes('unavailable') || message.includes('not ready')) return 'unavailable'
  return 'unknown'
}

export function classifyRendererError(reason: unknown): string {
  return errorKind(reason)
}

export function recordRendererDiagnostic(
  action: RendererDiagnosticAction,
  fields: Record<string, DiagnosticValue> = {},
  durationMs?: number,
): void {
  if (!allowedActions.has(action)) return
  const pairs: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (!allowedKeys.has(key)) continue
    if (key === 'status' && (typeof value !== 'string' || !['ok', 'error', 'cache-hit', 'local-hit', 'pending'].includes(value))) continue
    if (key === 'view' && (typeof value !== 'string' || !['all', 'collection'].includes(value))) continue
    if (key === 'method' && (typeof value !== 'string' || !/^[a-z0-9_]+$/i.test(value))) continue
    if (key === 'section' && (typeof value !== 'string' || !/^(home|coding|ctf|vuln|lab|settings)$/i.test(value))) continue
    if (key === 'errorKind' && (typeof value !== 'string' || !/^(timeout|permission|network|invalid|unavailable|unknown)$/.test(value))) continue
    if ((key === 'count' || key === 'page' || key === 'durationMs') && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) continue
    const token = safeToken(value)
    if (token !== null) pairs.push(`${key}=${token}`)
  }
  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    pairs.push(`durationMs=${Math.max(0, Math.round(durationMs))}`)
  }
  events.push({
    timestamp: new Date().toISOString(),
    category: action === 'rpc' ? 'desktop-rpc' : action.startsWith('catalog') || action.startsWith('full-') || action.startsWith('training-') || action === 'dashboard-load' || action === 'catalog-sync' ? 'nssctf' : 'renderer',
    level: fields.status === 'error' ? 'error' : 'info',
    message: pairs.length > 0 ? `${action} ${pairs.join(' ')}` : action,
  })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

export function recordRendererRpc(method: string): void {
  recordRendererDiagnostic('rpc', { method })
}

export function recordRendererSection(section: string): void {
  recordRendererDiagnostic('section-change', { section })
}

export function recordRendererError(
  action: Exclude<RendererDiagnosticAction, 'rpc' | 'section-change'>,
  reason: unknown,
  fields: Record<string, DiagnosticValue> = {},
  durationMs?: number,
): void {
  recordRendererDiagnostic(action, { ...fields, status: 'error', errorKind: errorKind(reason) }, durationMs)
}

export function rendererDiagnosticSnapshot(): readonly RendererDiagnosticEvent[] {
  return Object.freeze(events.map(event => Object.freeze({ ...event })))
}

export function resetRendererDiagnostics(): void {
  events.length = 0
}
