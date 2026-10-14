import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveWorkspace } from './paths.ts'

const MAX_MCP_CONFIG_BYTES = 1 << 20
const MAX_MCP_SERVERS = 64
const MAX_MCP_REVIEW_TOOLS = 64

export type MCPServerSummary = {
  name: string
  transport: string
  source?: string
  version?: string
  taskScope?: string
  tools: string[]
  fileAccess: string
  networkAccess: string
  credentialAccess: string
  reviewReady: boolean
  reviewProblem?: string
  scope?: string
}

export type MCPConfigSnapshot = {
  workspace: string
  configured: boolean
  path?: string
  digest?: string
  servers: MCPServerSummary[]
  problem?: string
}

function boundedMCPProblem(error: unknown): string {
  const value = String(error instanceof Error ? error.message : error ?? '').trim()
  if (value.length > 180) return `${value.slice(0, 180)}…`
  return value
}

function validMCPReviewText(value: string, limit: number): boolean {
  if (!value || value !== value.trim() || [...value].length > limit) return false
  for (const ch of value) {
    if (ch.charCodeAt(0) < 0x20 || ch === '\u007f') return false
  }
  return true
}

function validMCPServerName(value: string): boolean {
  const name = value.trim()
  if (!name || [...name].length > 80) return false
  for (const ch of name) {
    if (ch.charCodeAt(0) < 0x20 || ch === '\u007f') return false
  }
  return true
}

function validMCPVersion(value: string): boolean {
  if (!validMCPReviewText(value, 80) || /[ \t\r\n*^~<>=|,]/.test(value)) return false
  const lower = value.toLowerCase()
  for (const segment of lower.split(/[._/-]/)) {
    if (segment === 'x') return false
  }
  return !['latest', 'next', 'canary', 'main', 'master', 'head'].includes(lower)
}

function reviewedRemoteOrigin(value: string): string {
  try {
    const parsed = new URL(value.trim())
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) {
      return '远程地址无效'
    }
    return `仅连接 ${parsed.protocol}//${parsed.host}`
  } catch {
    return '远程地址无效'
  }
}

function reviewedToolSurface(values: unknown): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_MCP_REVIEW_TOOLS) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = String(raw ?? '')
    const trimmed = value.trim()
    if (value !== trimmed || !validMCPReviewText(trimmed, 100)) return []
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  result.sort()
  return result
}

function reviewedMCPProblem(source: string, version: string, taskScope: string, tools: string[]): string {
  if (!validMCPReviewText(source, 160)) {
    return '缺少可审阅的来源；请在 milksu.source 中声明固定来源。'
  }
  if (!validMCPVersion(version)) {
    return '缺少固定版本；milksu.version 不能使用 latest、next 或通配符。'
  }
  if (!validMCPReviewText(taskScope, 240)) {
    return '缺少任务范围；请在 milksu.taskScope 中说明用途。'
  }
  if (tools.length === 0) {
    return '缺少工具白名单；请用 includeTools 声明本任务可见工具。'
  }
  return ''
}

export function userMCPTransportLabel(transport: string): string {
  switch (transport) {
    case 'command':
      return '本地进程'
    case 'url':
      return '远程 HTTP'
    case 'socket':
      return '本地 Socket'
    default:
      return transport
  }
}

export function codingServersFromUserMCP(servers: Array<{
  name: string
  enabled: boolean
  transport: string
  envNames?: string[]
  headerNames?: string[]
  hasBearer?: boolean
  fileAccess: string
  networkAccess: string
}>): MCPServerSummary[] {
  const result: MCPServerSummary[] = []
  for (const server of servers) {
    if (!server.enabled) continue
    let credentialAccess = '不注入；Provider Credential 保持隔离'
    if ((server.envNames?.length ?? 0) > 0 || (server.headerNames?.length ?? 0) > 0 || server.hasBearer) {
      credentialAccess = '使用用户设置；Provider Credential 保持隔离'
    }
    result.push({
      name: server.name,
      transport: userMCPTransportLabel(server.transport),
      source: '设置',
      taskScope: '用户级 MCP',
      tools: [],
      fileAccess: server.fileAccess,
      networkAccess: server.networkAccess,
      credentialAccess,
      reviewReady: true,
      scope: 'user',
    })
  }
  return result
}

export async function inspectMCPConfig(workspace: string): Promise<MCPConfigSnapshot> {
  const resolved = await resolveWorkspace(workspace)
  const snapshot: MCPConfigSnapshot = { workspace: resolved, configured: false, servers: [] }
  const path = join(resolved, '.mcp.json')
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return snapshot
    throw new Error(`inspect project MCP config: ${error instanceof Error ? error.message : error}`)
  }
  snapshot.configured = true
  snapshot.path = '.mcp.json'
  if (info.isSymbolicLink() || !info.isFile()) {
    snapshot.problem = '.mcp.json 必须是项目内的普通文件，不能是链接或目录。'
    return snapshot
  }
  if (info.size <= 0 || info.size > MAX_MCP_CONFIG_BYTES) {
    snapshot.problem = '.mcp.json 必须在 1 字节到 1 MiB 之间。'
    return snapshot
  }
  const handle = await open(path, 'r')
  let data: Buffer
  try {
    data = await handle.readFile()
  } finally {
    await handle.close()
  }
  if (data.length > MAX_MCP_CONFIG_BYTES) {
    snapshot.problem = '.mcp.json 超过 1 MiB，MilkSU 不会加载。'
    return snapshot
  }
  snapshot.digest = createHash('sha256').update(data).digest('hex')
  let document: { mcpServers?: Record<string, unknown> }
  try {
    document = JSON.parse(data.toString('utf8')) as { mcpServers?: Record<string, unknown> }
  } catch (error) {
    snapshot.problem = `无法解析 .mcp.json：${boundedMCPProblem(error)}`
    return snapshot
  }
  const servers = document.mcpServers ?? {}
  const names = Object.keys(servers)
  if (names.length === 0) {
    snapshot.problem = '.mcp.json 中没有可用的 mcpServers。'
    return snapshot
  }
  if (names.length > MAX_MCP_SERVERS) {
    snapshot.problem = `.mcp.json 最多支持 ${MAX_MCP_SERVERS} 个服务器。`
    return snapshot
  }
  for (const name of names) {
    if (!validMCPServerName(name)) {
      snapshot.problem = '发现无效的 MCP 服务器名称；名称必须是 1–80 个可见字符。'
      snapshot.servers = []
      return snapshot
    }
    const raw = servers[name]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      snapshot.problem = `MCP 服务器 ${JSON.stringify(name)} 的配置无效。`
      snapshot.servers = []
      return snapshot
    }
    const definition = raw as Record<string, unknown>
    if (definition.disabled) continue
    const command = String(definition.command ?? '').trim()
    const url = String(definition.url ?? '').trim()
    const socket = String(definition.socket ?? '').trim()
    let transport = ''
    let fileAccess = ''
    let networkAccess = ''
    if (command) {
      transport = '本地进程'
      fileAccess = '项目读写 + 私有运行目录'
      networkAccess = '任意出站网络'
    } else if (url) {
      transport = '远程 HTTP'
      fileAccess = '不直接授予本机文件'
      networkAccess = reviewedRemoteOrigin(url)
    } else if (socket) {
      transport = '本地 Socket'
      fileAccess = '由本地 Socket 服务自身权限决定'
      networkAccess = '仅连接配置的本地 Socket'
    } else {
      continue
    }
    const env = definition.env && typeof definition.env === 'object' ? definition.env : {}
    const headers = definition.headers && typeof definition.headers === 'object' ? definition.headers : {}
    let credentialAccess = '不注入；Provider Credential 保持隔离'
    if (Object.keys(env).length > 0 || Object.keys(headers).length > 0 || definition.bearerToken) {
      credentialAccess = '使用项目专用配置；Provider Credential 保持隔离'
    }
    const review = (definition.milksu && typeof definition.milksu === 'object')
      ? definition.milksu as Record<string, unknown>
      : {}
    const source = String(review.source ?? '').trim()
    const version = String(review.version ?? '').trim()
    const taskScope = String(review.taskScope ?? '').trim()
    const tools = reviewedToolSurface(definition.includeTools)
    const reviewProblem = reviewedMCPProblem(source, version, taskScope, tools)
    snapshot.servers.push({
      name,
      transport,
      source,
      version,
      taskScope,
      tools,
      fileAccess,
      networkAccess,
      credentialAccess,
      reviewReady: reviewProblem === '',
      reviewProblem: reviewProblem || undefined,
      scope: 'project',
    })
  }
  snapshot.servers.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  if (snapshot.servers.length === 0 && !snapshot.problem) {
    snapshot.problem = '.mcp.json 中没有已启用且可识别的服务器。'
  }
  return snapshot
}
