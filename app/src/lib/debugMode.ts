// Local debug/logging mode for MilkSU. Enabled from the Settings page.
// All diagnostics stay local: ring buffer in memory, optional snapshot
// export to clipboard. No network egress. Fields that could carry
// credentials or real user content are deliberately never collected here.

export const DEBUG_MODE_STORAGE_KEY = 'milksu.debug-mode'

export interface DebugLogEntry {
  time: string
  action: string
  detail: string
  durationMs: number
}

export interface DebugStateSnapshot {
  view: string
  bank: string
  fullCatalogReady: boolean
  fullCatalogProblems: number
  collectionProblems: number
  selectedPlatformId: number | null
  localHits: number
  rpcCalls: number
  cacheHits: number
}

const MAX_LOG_ENTRIES = 200

const log: DebugLogEntry[] = []
const state: DebugStateSnapshot = {
  view: '',
  bank: 'nssctf',
  fullCatalogReady: false,
  fullCatalogProblems: 0,
  collectionProblems: 0,
  selectedPlatformId: null,
  localHits: 0,
  rpcCalls: 0,
  cacheHits: 0,
}

function readDebugMode(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let enabled = readDebugMode()

export function isDebugMode(): boolean {
  return enabled
}

export function setDebugMode(value: boolean): void {
  enabled = value
  try {
    window.localStorage.setItem(DEBUG_MODE_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // storage unavailable; keep in-memory mode for this session
  }
  if (!value) {
    log.length = 0
    state.localHits = 0
    state.rpcCalls = 0
    state.cacheHits = 0
  }
}

export function debugLog(action: string, detail = '', durationMs = -1): void {
  if (!enabled) return
  log.push({
    time: new Date().toISOString(),
    action,
    detail,
    durationMs,
  })
  if (log.length > MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES)
  }
}

export function updateDebugState(patch: Partial<DebugStateSnapshot>): void {
  if (!enabled) return
  Object.assign(state, patch)
}

export function recordLocalHit(): void {
  if (enabled) state.localHits += 1
}

export function recordRpcCall(action = ''): void {
  if (!enabled) return
  state.rpcCalls += 1
  debugLog('rpc', action)
}

export function recordCacheHit(): void {
  if (enabled) state.cacheHits += 1
}

export function debugLogEntries(): DebugLogEntry[] {
  return log
}

export function buildDiagnosticText(): string {
  const lines: string[] = []
  lines.push('MilkSU debug diagnostics')
  lines.push(`mode: ${enabled ? 'on' : 'off'}`)
  lines.push(`view: ${state.view} | bank: ${state.bank}`)
  lines.push(`fullCatalog: ${state.fullCatalogReady ? 'ready' : 'pending'} (${state.fullCatalogProblems} problems)`)
  lines.push(`collection problems: ${state.collectionProblems}`)
  lines.push(`selected platform: ${state.selectedPlatformId ?? 'none'}`)
  lines.push(`local hits: ${state.localHits} | cache hits: ${state.cacheHits} | rpc calls: ${state.rpcCalls}`)
  lines.push('')
  lines.push('-- log --')
  for (const entry of log) {
    const duration = entry.durationMs < 0 ? '' : ` ${entry.durationMs.toFixed(0)}ms`
    lines.push(`${entry.time} [${entry.action}]${duration} ${entry.detail}`)
  }
  return lines.join('\n')
}
