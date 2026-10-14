import { lstatSync } from 'node:fs'
import { chmod, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { inspectData, secureDestination, type DataStatus } from './backup.ts'
import { cleanDiagnosticLabel, sanitizeDiagnosticText } from './diagnostics-text.ts'
import { type LifespanStart } from './lifespan.ts'
import { writeZipFile } from './zip.ts'

export const DIAGNOSTICS_SCHEMA = 'milksu-diagnostics/v1'

const DIAGNOSTIC_DATABASE_PATHS = [
  join('config', 'credentials.db'),
  join('data', 'runtime', 'events.sqlite3'),
  join('data', 'domain', 'research', 'research.sqlite3'),
]

export type DiagnosticEvent = {
  timestamp: string
  category: string
  level: string
  message: string
}

export class DiagnosticRecorder {
  private readonly limit: number
  private entries: DiagnosticEvent[] = []

  constructor(limit = 256) {
    this.limit = limit > 0 ? limit : 256
  }

  record(category: string, level: string, message: string): void {
    message = sanitizeDiagnosticText(message)
    if (!message) return
    this.entries.push({
      timestamp: new Date().toISOString(),
      category: cleanDiagnosticLabel(category, 'app'),
      level: cleanDiagnosticLabel(level, 'info'),
      message,
    })
    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(this.entries.length - this.limit)
    }
  }

  snapshot(): DiagnosticEvent[] {
    return [...this.entries]
  }
}

export type DiagnosticRuntime = {
  defaultEngine: string
  running: boolean
  sessionCount: number
  protocol: string
  backgroundTaskCount: number
}

export type DiagnosticSettings = {
  activeProvider: string
  activeModel: string
  relayEnabled: boolean
  modelVerified: boolean
  configuredProviders: string[]
  arenaTokenPresent?: boolean
}

export type DiagnosticInput = {
  appVersion: string
  runtime: DiagnosticRuntime
  settings: DiagnosticSettings
  lifespan: LifespanStart
  events?: DiagnosticEvent[]
  rendererEvents?: DiagnosticEvent[]
}

export type DiagnosticDatabase = {
  path: string
  exists: boolean
  bytes?: number
  quickCheck?: string
  error?: string
}

export type DiagnosticPlatform = {
  os: string
  arch: string
  goVersion?: string
  nodeVersion?: string
  goModule?: string
}

export type DiagnosticReport = {
  schema: string
  generatedAt: string
  appVersion: string
  platform: DiagnosticPlatform
  data: DataStatus
  runtime: DiagnosticRuntime
  settings: DiagnosticSettings
  lifespan: LifespanStart
  databases: DiagnosticDatabase[]
  recentEvents?: DiagnosticEvent[]
  privacy: string[]
}

export type DiagnosticExport = {
  path: string
  generatedAt: string
  bytes: number
  eventCount: number
  cancelled?: boolean
}

const RENDERER_ACTIONS = new Set([
  'section-change',
  'catalog-load',
  'catalog-search',
  'full-catalog-load',
  'training-progress-refresh',
  'catalog-sync',
  'dashboard-load',
  'rpc',
])

const RENDERER_KEYS = new Set(['method', 'section', 'view', 'status', 'count', 'page', 'durationMs', 'errorKind'])
const RENDERER_METHOD = /^[a-zA-Z0-9_]{1,80}$/
const RENDERER_NUMBER = /^[0-9]{1,10}$/

export async function exportDiagnostics(
  root: string,
  destination: string,
  input: DiagnosticInput,
): Promise<DiagnosticExport> {
  destination = await secureDestination(root, destination)
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  const status = await inspectData(root)
  status.directory = join('<user-data>', root.split(/[/\\]/u).filter(Boolean).at(-1) ?? 'milksu')
  const report: DiagnosticReport = {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    appVersion: cleanDiagnosticLabel(input.appVersion, 'development'),
    platform: {
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    data: status,
    runtime: input.runtime,
    settings: sanitizeDiagnosticSettings(input.settings),
    lifespan: sanitizeDiagnosticLifespan(input.lifespan),
    databases: inspectDiagnosticDatabases(root),
    recentEvents: sanitizeDiagnosticEvents(mergeDiagnosticEvents(input.events ?? [], sanitizeRendererDiagnosticEvents(input.rendererEvents ?? []))),
    privacy: [
      '不包含 API Key、Arena Token、浏览器配对令牌或 PI 认证文件',
      '不包含会话正文、附件内容、模型回复或工具输入输出',
      '数据库只执行只读 quick_check，不复制数据库内容',
    ],
  }
  const payload = Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
  const temporary = join(dirname(destination), `.milksu-diagnostics-${process.pid}-${Date.now()}.zip`)
  await writeZipFile(temporary, [{ name: 'diagnostics.json', data: payload, mode: 0o600 }])
  await chmod(temporary, 0o600)
  await rename(temporary, destination)
  await chmod(destination, 0o600)
  const info = await stat(destination)
  return {
    path: destination,
    generatedAt: report.generatedAt,
    bytes: info.size,
    eventCount: report.recentEvents?.length ?? 0,
  }
}

function inspectDiagnosticDatabases(root: string): DiagnosticDatabase[] {
  return DIAGNOSTIC_DATABASE_PATHS.map((relativePath) => inspectDiagnosticDatabase(root, relativePath))
}

function inspectDiagnosticDatabase(root: string, relativePath: string): DiagnosticDatabase {
  const result: DiagnosticDatabase = { path: relativePath.replaceAll('\\', '/'), exists: false }
  const path = join(root, relativePath)
  try {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      result.error = 'database path is not a regular file'
      return result
    }
    result.exists = true
    result.bytes = info.size
    const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 })
    try {
      const row = db.prepare('PRAGMA quick_check(1)').get() as Record<string, string> | undefined
      const value = row ? String(Object.values(row)[0] ?? '') : ''
      result.quickCheck = cleanDiagnosticLabel(value, 'unknown')
    } finally {
      db.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      result.quickCheck = 'missing'
      return result
    }
    result.error = sanitizeDiagnosticText(String(error instanceof Error ? error.message : error).replaceAll(root, '<data>'))
  }
  return result
}

function sanitizeDiagnosticLifespan(lifespan: LifespanStart): LifespanStart {
  return {
    previousExit: cleanDiagnosticLabel(lifespan.previousExit, 'none') as LifespanStart['previousExit'],
    previousStartedAt: lifespan.previousStartedAt ? cleanDiagnosticLabel(lifespan.previousStartedAt, '') : undefined,
    lastCleanExitAt: lifespan.lastCleanExitAt ? cleanDiagnosticLabel(lifespan.lastCleanExitAt, '') : undefined,
    consecutiveAbnormalExits: Math.max(0, lifespan.consecutiveAbnormalExits),
    previousPid: lifespan.previousPid,
    startedAt: cleanDiagnosticLabel(lifespan.startedAt, ''),
  }
}

function sanitizeDiagnosticSettings(settings: DiagnosticSettings): DiagnosticSettings {
  const providers = [...new Set(
    (settings.configuredProviders ?? [])
      .map((provider) => cleanDiagnosticLabel(provider, ''))
      .filter(Boolean),
  )].sort()
  return {
    activeProvider: cleanDiagnosticLabel(settings.activeProvider, 'unknown'),
    activeModel: cleanDiagnosticLabel(settings.activeModel, 'unknown'),
    relayEnabled: Boolean(settings.relayEnabled),
    modelVerified: Boolean(settings.modelVerified),
    configuredProviders: providers,
    arenaTokenPresent: Boolean(settings.arenaTokenPresent),
  }
}

function sanitizeRendererDiagnosticEvents(events: DiagnosticEvent[]): DiagnosticEvent[] {
  if (events.length > 200) events = events.slice(events.length - 200)
  const result: DiagnosticEvent[] = []
  for (const event of events) {
    const timestamp = Date.parse(String(event.timestamp ?? '').trim())
    if (Number.isNaN(timestamp)) continue
    const parts = String(event.message ?? '').split(/\s+/u).filter(Boolean)
    if (!parts.length || !RENDERER_ACTIONS.has(parts[0]!)) continue
    let level = 'info'
    let valid = true
    for (const part of parts.slice(1)) {
      const cut = part.indexOf('=')
      if (cut <= 0) {
        valid = false
        break
      }
      const key = part.slice(0, cut)
      const value = part.slice(cut + 1)
      if (!value || !RENDERER_KEYS.has(key) || !validRendererDiagnosticValue(key, value)) {
        valid = false
        break
      }
      if (key === 'status' && value === 'error') level = 'error'
    }
    if (!valid) continue
    let category = 'renderer'
    if (parts[0] === 'rpc') category = 'desktop-rpc'
    else if (parts[0] !== 'section-change') category = 'nssctf'
    result.push({
      timestamp: new Date(timestamp).toISOString(),
      category,
      level,
      message: parts.join(' '),
    })
  }
  return result
}

function validRendererDiagnosticValue(key: string, value: string): boolean {
  switch (key) {
    case 'method':
      return RENDERER_METHOD.test(value)
    case 'section':
      return value === 'home' || value === 'coding' || value === 'vuln' || value === 'lab' || value === 'settings'
    case 'view':
      return value === 'all' || value === 'collection'
    case 'status':
      return value === 'ok' || value === 'error' || value === 'cache-hit' || value === 'local-hit' || value === 'pending'
    case 'errorKind':
      return value === 'timeout' || value === 'permission' || value === 'network' || value === 'invalid' || value === 'unavailable' || value === 'unknown'
    case 'count':
    case 'page':
    case 'durationMs':
      return RENDERER_NUMBER.test(value)
    default:
      return false
  }
}

function mergeDiagnosticEvents(backend: DiagnosticEvent[], renderer: DiagnosticEvent[]): DiagnosticEvent[] {
  const merged = [...backend, ...renderer]
  merged.sort((left, right) => diagnosticEventTimestamp(left.timestamp) - diagnosticEventTimestamp(right.timestamp))
  return merged
}

function diagnosticEventTimestamp(value: string): number {
  const parsed = Date.parse(String(value ?? '').trim())
  return Number.isNaN(parsed) ? 0 : parsed
}

function sanitizeDiagnosticEvents(events: DiagnosticEvent[]): DiagnosticEvent[] {
  if (events.length > 256) events = events.slice(events.length - 256)
  return events.flatMap((event) => {
    const message = sanitizeDiagnosticText(event.message)
    if (!message) return []
    return [{
      timestamp: cleanDiagnosticLabel(event.timestamp, ''),
      category: cleanDiagnosticLabel(event.category, 'app'),
      level: cleanDiagnosticLabel(event.level, 'info'),
      message,
    }]
  })
}


