import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secretAccount, type SecretKeeper } from './secrets.ts'

export const CATALOG_SCHEMA = 'milksu-agent-resources/v1'
const CATALOG_FILE = 'catalog.json'
const MAX_CATALOG_BYTES = 1 << 20
const MAX_USER_MCP_SERVERS = 32
const MAX_USER_SKILLS = 64
const MAX_SKILL_FILES = 200
const MAX_SKILL_BYTES = 8 << 20
const MAX_SKILL_FILE_BYTES = 1 << 20
const MAX_COMMAND_RUNES = 256
const MAX_ARG_RUNES = 500
const MAX_ARGS = 32
const MAX_ENV_NAME_RUNES = 64

export const RESERVED_MCP_NAMES = new Set([
  'milksu-playwright',
  'milksu-playwright-user',
  'milksu-computer-use',
  'milksu-ida-pro',
])

export const BUILTIN_MCP_NAMES = ['ida-pro', 'capa', 'codeql', 'burp-suite', 'shannon', 'rea'] as const
export const BUILTIN_SKILL_NAMES = [
  'frontend-visual-qa',
  'product-design',
  'integrate-api',
  'review-security',
  'create-technical-deliverables',
  'release-milksu',
  'archify',
  'ghidra-rpc',
  'jadx',
  'reverse-engineer-anything',
] as const

const OPTIONAL_SKILLS = new Set(['ghidra-rpc', 'jadx', 'reverse-engineer-anything'])

export type MCPTransport = 'command' | 'url' | 'socket'

export type MCPServerSnapshot = {
  name: string
  enabled: boolean
  transport: string
  command?: string
  args?: string[]
  url?: string
  socket?: string
  envNames?: string[]
  headerNames?: string[]
  hasBearer?: boolean
  fileAccess: string
  networkAccess: string
  scope: 'user'
  reviewReady: boolean
}

export type SkillSnapshot = {
  name: string
  label: string
  description: string
  enabled: boolean
  origin: 'user'
  slashOnly?: boolean
}

export type BuiltinMCPSnapshot = {
  name: string
  enabled: boolean
  customized: boolean
  command?: string
  args?: string[]
}

export type BuiltinSkillSnapshot = {
  name: string
  customized: boolean
}

export type CatalogSnapshot = {
  mcpServers: MCPServerSnapshot[]
  skills: SkillSnapshot[]
  builtinMCP: BuiltinMCPSnapshot[]
  builtinSkills: BuiltinSkillSnapshot[]
}

export type MCPServerInput = {
  name: string
  enabled?: boolean
  transport: string
  command?: string
  args?: string[]
  url?: string
  socket?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  bearerToken?: string
  removeEnv?: string[]
  removeHeaders?: string[]
  clearBearer?: boolean
}

export type BuiltinMCPInput = {
  name: string
  enabled?: boolean
  command?: string
  args?: string[]
}

export type BuiltinSkillDocument = {
  name: string
  document: string
  customized: boolean
}

export type ConfigHandoff = {
  kind: string
  name: string
  title: string
  prompt: string
  visibleText: string
  workspacePath: string
  executionMode: string
  approvalPolicy: string
}

export type ResourceRuntime = {
  mcpServers: Record<string, Record<string, unknown>>
  skillPaths: string[]
  hideFactorySkills: string[]
  optionalSkillPaths: string[]
}

type UserMCPRecord = {
  enabled: boolean
  transport: string
  command?: string
  args?: string[]
  url?: string
  socket?: string
  envNames?: string[]
  headerNames?: string[]
  hasBearer?: boolean
}

type UserSkillRecord = {
  enabled: boolean
  description?: string
}

type BuiltinMCPRecord = {
  enabled?: boolean
  customized?: boolean
  command?: string
  args?: string[]
}

type CatalogDocument = {
  schema: string
  mcpServers: Record<string, UserMCPRecord>
  skills: Record<string, UserSkillRecord>
  builtinMCP: Record<string, BuiltinMCPRecord>
}

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

function emptyCatalog(): CatalogDocument {
  return { schema: CATALOG_SCHEMA, mcpServers: {}, skills: {}, builtinMCP: {} }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sanitizeMCPMap(value: unknown): Record<string, UserMCPRecord> {
  const result: Record<string, UserMCPRecord> = {}
  for (const [name, raw] of Object.entries(asRecord(value))) {
    if (!validResourceName(name)) continue
    const record = asRecord(raw)
    const next: UserMCPRecord = {
      enabled: Boolean(record.enabled),
      transport: String(record.transport ?? ''),
    }
    if (typeof record.command === 'string' && record.command.trim()) next.command = record.command
    if (Array.isArray(record.args) && record.args.length) {
      next.args = record.args.map((item) => String(item ?? ''))
    }
    if (typeof record.url === 'string' && record.url.trim()) next.url = record.url
    if (typeof record.socket === 'string' && record.socket.trim()) next.socket = record.socket
    if (Array.isArray(record.envNames) && record.envNames.length) {
      next.envNames = uniqueNames(record.envNames.map((item) => String(item ?? '')))
    }
    if (Array.isArray(record.headerNames) && record.headerNames.length) {
      next.headerNames = uniqueNames(record.headerNames.map((item) => String(item ?? '')))
    }
    if (record.hasBearer) next.hasBearer = true
    result[name] = next
  }
  return result
}

function sanitizeSkillMap(value: unknown): Record<string, UserSkillRecord> {
  const result: Record<string, UserSkillRecord> = {}
  for (const [name, raw] of Object.entries(asRecord(value))) {
    if (!validResourceName(name)) continue
    const record = asRecord(raw)
    const next: UserSkillRecord = { enabled: Boolean(record.enabled) }
    if (typeof record.description === 'string' && record.description.trim()) {
      next.description = record.description
    }
    result[name] = next
  }
  return result
}

function sanitizeBuiltinMCPMap(value: unknown): Record<string, BuiltinMCPRecord> {
  const result: Record<string, BuiltinMCPRecord> = {}
  for (const [name, raw] of Object.entries(asRecord(value))) {
    if (!knownBuiltinMCP(name)) continue
    const record = asRecord(raw)
    const next: BuiltinMCPRecord = {}
    if (record.enabled !== undefined) next.enabled = Boolean(record.enabled)
    if (record.customized) next.customized = true
    if (typeof record.command === 'string' && record.command.trim()) next.command = record.command
    if (Array.isArray(record.args) && record.args.length) {
      next.args = record.args.map((item) => String(item ?? ''))
    }
    result[name] = next
  }
  return result
}

export function emptyCatalogSnapshot(): CatalogSnapshot {
  return { mcpServers: [], skills: [], builtinMCP: [], builtinSkills: [] }
}

export function validResourceName(value: string): boolean {
  const name = value.trim()
  if (!name || name.length > 64) return false
  if (name.startsWith('-') || name.endsWith('-')) return false
  return /^[a-z0-9-]+$/.test(name)
}

export function optionalCodingSkill(name: string): boolean {
  return OPTIONAL_SKILLS.has(name.trim())
}

export function stripOptionalSkillPaths(paths: string[]): string[] {
  return paths.filter((path) => !optionalCodingSkill(basename(path)))
}

export class AgentResourceStore {
  private readonly mutex = new Mutex()
  readonly root: string
  private factorySkills: string

  private readonly secrets: SecretKeeper

  constructor(
    dataDirectory: string,
    secrets: SecretKeeper,
    factorySkills = resolveFactorySkillsDir(),
  ) {
    this.root = join(dataDirectory, 'agent', 'resources')
    this.secrets = secrets
    this.factorySkills = factorySkills
  }

  static async open(
    dataDirectory: string,
    secrets: SecretKeeper,
    factorySkills?: string,
  ): Promise<AgentResourceStore> {
    const store = new AgentResourceStore(dataDirectory, secrets, factorySkills)
    await mkdir(join(store.root, 'skills'), { recursive: true, mode: 0o700 })
    await chmod(store.root, 0o700).catch(() => undefined)
    return store
  }

  setFactorySkillsDir(dir: string): void {
    this.factorySkills = dir.trim()
  }

  snapshot(): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => this.snapshotLocked(await this.loadAndSyncLocked()))
  }

  upsertMCPServer(input: MCPServerInput): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      const record = await this.upsertMCPLocked(document, input)
      document.mcpServers[record.name] = record.value
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  setMCPServerEnabled(name: string, enabled: boolean): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      if (!validResourceName(name)) throw new Error('MCP server name is invalid')
      const record = document.mcpServers[name]
      if (!record) throw new Error(`MCP server ${JSON.stringify(name)} is not configured`)
      record.enabled = enabled
      document.mcpServers[name] = record
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  deleteMCPServer(name: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      if (!validResourceName(name)) throw new Error('MCP server name is invalid')
      const record = document.mcpServers[name]
      if (!record) throw new Error(`MCP server ${JSON.stringify(name)} is not configured`)
      await this.deleteMCPSecretsLocked(name, record)
      delete document.mcpServers[name]
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  importMCPJSON(raw: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const bytes = Buffer.byteLength(raw)
      if (!raw || bytes > MAX_CATALOG_BYTES) throw new Error('MCP JSON is empty or too large')
      const inputs = parseImportedMCPServers(raw)
      const document = await this.loadLocked()
      let added = 0
      for (const input of inputs) {
        if (!document.mcpServers[input.name.trim()]) added += 1
      }
      if (Object.keys(document.mcpServers).length + added > MAX_USER_MCP_SERVERS) {
        throw new Error(`at most ${MAX_USER_MCP_SERVERS} user MCP servers can be saved`)
      }
      for (const input of inputs) {
        const record = await this.upsertMCPLocked(document, input)
        document.mcpServers[record.name] = record.value
      }
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  importSkill(sourceDirectory: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      const inspected = await inspectSkillDirectory(sourceDirectory)
      if (document.skills[inspected.name]) {
        throw new Error(`skill ${JSON.stringify(inspected.name)} is already imported`)
      }
      if (Object.keys(document.skills).length >= MAX_USER_SKILLS) {
        throw new Error(`at most ${MAX_USER_SKILLS} user skills can be imported`)
      }
      const destination = join(this.root, 'skills', inspected.name)
      try {
        await copySkillDirectory(sourceDirectory, destination)
      } catch (error) {
        await rm(destination, { recursive: true, force: true })
        throw error
      }
      document.skills[inspected.name] = { enabled: true, description: inspected.description }
      try {
        await this.saveLocked(document)
      } catch (error) {
        await rm(destination, { recursive: true, force: true })
        throw error
      }
      return this.snapshotLocked(document)
    })
  }

  setSkillEnabled(name: string, enabled: boolean): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      if (!validResourceName(name)) throw new Error('skill name is invalid')
      const record = document.skills[name]
      if (!record) throw new Error(`skill ${JSON.stringify(name)} is not imported`)
      record.enabled = enabled
      document.skills[name] = record
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  deleteSkill(name: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadLocked()
      if (!validResourceName(name)) throw new Error('skill name is invalid')
      if (!document.skills[name]) throw new Error(`skill ${JSON.stringify(name)} is not imported`)
      await rm(join(this.root, 'skills', name), { recursive: true, force: true })
      delete document.skills[name]
      await this.saveLocked(document)
      return this.snapshotLocked(document)
    })
  }

  upsertBuiltinMCP(input: BuiltinMCPInput): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadAndSyncLocked()
      const name = String(input.name ?? '').trim()
      if (!knownBuiltinMCP(name)) throw new Error(`unknown built-in MCP ${JSON.stringify(name)}`)
      const record = { ...document.builtinMCP[name] }
      if (input.enabled !== undefined) record.enabled = Boolean(input.enabled)
      const command = String(input.command ?? '').trim()
      const args = normalizeOverlayArgs(input.args ?? [])
      if (command || args.length) {
        if (command) {
          if ([...command].length > MAX_COMMAND_RUNES) throw new Error('MCP command is too long')
          record.command = command
        }
        record.args = args
        record.customized = true
      }
      document.builtinMCP[name] = record
      await this.saveLocked(document)
      await this.writeWorkspaceLocked(document)
      return this.snapshotLocked(document)
    })
  }

  setBuiltinMCPEnabled(name: string, enabled: boolean): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadAndSyncLocked()
      const id = name.trim()
      if (!knownBuiltinMCP(id)) throw new Error(`unknown built-in MCP ${JSON.stringify(id)}`)
      const record = { ...document.builtinMCP[id] }
      record.enabled = enabled
      document.builtinMCP[id] = record
      await this.saveLocked(document)
      await this.writeWorkspaceLocked(document)
      return this.snapshotLocked(document)
    })
  }

  restoreBuiltinMCP(name: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const document = await this.loadAndSyncLocked()
      const id = name.trim()
      if (!knownBuiltinMCP(id)) throw new Error(`unknown built-in MCP ${JSON.stringify(id)}`)
      delete document.builtinMCP[id]
      await this.saveLocked(document)
      await this.writeWorkspaceLocked(document)
      return this.snapshotLocked(document)
    })
  }

  getBuiltinSkillDocument(name: string): Promise<BuiltinSkillDocument> {
    return this.mutex.run(async () => {
      await this.loadAndSyncLocked()
      const id = name.trim()
      if (!knownBuiltinSkill(id)) throw new Error(`unknown built-in skill ${JSON.stringify(id)}`)
      const { document, customized } = await this.readEffectiveSkillLocked(id)
      return { name: id, document, customized }
    })
  }

  setBuiltinSkillDocument(name: string, body: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const catalog = await this.loadAndSyncLocked()
      const id = name.trim()
      if (!knownBuiltinSkill(id)) throw new Error(`unknown built-in skill ${JSON.stringify(id)}`)
      if (!body.trim()) throw new Error('skill document is empty')
      if (Buffer.byteLength(body) > MAX_SKILL_FILE_BYTES) throw new Error('SKILL.md exceeds 1 MiB')
      const parsed = parseSkillFrontmatter(body)
      if (parsed.name && !validResourceName(parsed.name)) throw new Error('skill name is invalid')
      const destination = this.overlaySkillDir(id)
      await mkdir(destination, { recursive: true, mode: 0o700 })
      await writeFile(join(destination, 'SKILL.md'), body, { mode: 0o600 })
      await this.writeWorkspaceLocked(catalog)
      return this.snapshotLocked(catalog)
    })
  }

  restoreBuiltinSkill(name: string): Promise<CatalogSnapshot> {
    return this.mutex.run(async () => {
      const catalog = await this.loadAndSyncLocked()
      const id = name.trim()
      if (!knownBuiltinSkill(id)) throw new Error(`unknown built-in skill ${JSON.stringify(id)}`)
      await rm(this.overlaySkillDir(id), { recursive: true, force: true })
      await this.writeWorkspaceLocked(catalog)
      return this.snapshotLocked(catalog)
    })
  }

  ensureConfigWorkspace(): Promise<string> {
    return this.mutex.run(async () => {
      const document = await this.loadAndSyncLocked()
      await this.writeWorkspaceLocked(document)
      return this.workspaceDir()
    })
  }

  lookupBuiltinMCP(name: string): { command: string; args: string[]; enabled: boolean; customized: boolean } {
    // sync peek used by tests; prefer snapshot for RPC
    return { command: '', args: [], enabled: true, customized: false, ...this.builtinLookupCache[name] }
  }

  private builtinLookupCache: Record<string, { command: string; args: string[]; enabled: boolean; customized: boolean }> = {}

  runtime(enabledOptional: string[] = []): Promise<ResourceRuntime> {
    return this.mutex.run(async () => {
      const document = await this.loadAndSyncLocked()
      const mcpServers: Record<string, Record<string, unknown>> = {}
      for (const name of Object.keys(document.mcpServers).sort()) {
        const record = document.mcpServers[name]
        if (!record.enabled) continue
        const definition = await this.resolveMCPLocked(name, record)
        if (definition) mcpServers[name] = definition
      }
      const skillPaths: string[] = []
      for (const name of Object.keys(document.skills).sort()) {
        const record = document.skills[name]
        if (!record.enabled) continue
        const path = join(this.root, 'skills', name)
        if (existsSync(join(path, 'SKILL.md'))) skillPaths.push(path)
      }
      const { paths: overlays, hideFactory } = this.overlaySkillPathsLocked()
      skillPaths.push(...overlays)
      return {
        mcpServers,
        skillPaths: stripOptionalSkillPaths(skillPaths),
        hideFactorySkills: hideFactory,
        optionalSkillPaths: this.optionalSkillPathsLocked(enabledOptional),
      }
    })
  }

  optionalSkillPaths(enabled: string[]): Promise<string[]> {
    return this.mutex.run(async () => this.optionalSkillPathsLocked(enabled))
  }

  workspaceDir(): string {
    return join(this.root, 'workspace')
  }

  overlaySkillDir(name: string): string {
    return join(this.root, 'overlays', 'skills', name)
  }

  private optionalSkillPathsLocked(enabled: string[]): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    for (const raw of enabled) {
      const name = raw.trim()
      if (!optionalCodingSkill(name) || seen.has(name)) continue
      seen.add(name)
      const overlay = this.overlaySkillDir(name)
      if (skillDirOK(overlay)) {
        result.push(overlay)
        continue
      }
      const factory = this.factorySkillDir(name)
      if (factory && skillDirOK(factory)) result.push(factory)
    }
    return result
  }

  private factorySkillDir(name: string): string {
    if (name === 'archify') {
      for (const candidate of archifySkillDirs(this.factorySkills)) {
        if (skillDirOK(candidate)) return candidate
      }
    }
    if (!this.factorySkills.trim()) return ''
    return join(this.factorySkills, name)
  }

  private async loadAndSyncLocked(): Promise<CatalogDocument> {
    const document = await this.loadLocked()
    await this.syncWorkspaceLocked(document)
    return document
  }

  private async loadLocked(): Promise<CatalogDocument> {
    const document = emptyCatalog()
    const path = join(this.root, CATALOG_FILE)
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if (isNotFound(error)) return document
      throw new Error(`stat agent resource catalog: ${errorMessage(error)}`)
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error('agent resource catalog must be a regular file')
    }
    if (info.size > MAX_CATALOG_BYTES) throw new Error('agent resource catalog exceeds 1 MiB')
    const data = await readFile(path)
    if (data.length > MAX_CATALOG_BYTES) throw new Error('agent resource catalog exceeds 1 MiB')
    let parsed: Partial<CatalogDocument>
    try {
      parsed = JSON.parse(data.toString('utf8')) as Partial<CatalogDocument>
    } catch {
      throw new Error('parse agent resource catalog: invalid JSON')
    }
    if (parsed.schema && parsed.schema !== CATALOG_SCHEMA) {
      throw new Error(`unsupported agent resource catalog schema ${JSON.stringify(parsed.schema)}`)
    }
    document.mcpServers = sanitizeMCPMap(parsed.mcpServers)
    document.skills = sanitizeSkillMap(parsed.skills)
    document.builtinMCP = sanitizeBuiltinMCPMap(parsed.builtinMCP)
    document.schema = CATALOG_SCHEMA
    return document
  }

  private async saveLocked(document: CatalogDocument): Promise<void> {
    document.schema = CATALOG_SCHEMA
    document.mcpServers = sanitizeMCPMap(document.mcpServers)
    document.skills = sanitizeSkillMap(document.skills)
    document.builtinMCP = sanitizeBuiltinMCPMap(document.builtinMCP)
    const data = `${JSON.stringify(document, null, 2)}\n`
    const path = join(this.root, CATALOG_FILE)
    const temporary = `${path}.tmp`
    await writeFile(temporary, data, { mode: 0o600 })
    try {
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw new Error(`replace agent resource catalog: ${errorMessage(error)}`)
    }
  }

  private snapshotLocked(document: CatalogDocument): CatalogSnapshot {
    this.refreshBuiltinLookup(document)
    return {
      mcpServers: this.mcpSnapshotsLocked(document, false),
      skills: this.skillSnapshotsLocked(document),
      builtinMCP: this.builtinMCPSnapshotsLocked(document),
      builtinSkills: this.builtinSkillSnapshotsLocked(),
    }
  }

  private refreshBuiltinLookup(document: CatalogDocument): void {
    this.builtinLookupCache = {}
    for (const name of BUILTIN_MCP_NAMES) {
      const record = document.builtinMCP[name] ?? {}
      this.builtinLookupCache[name] = {
        command: record.command ?? '',
        args: [...(record.args ?? [])],
        enabled: record.enabled ?? true,
        customized: Boolean(record.customized),
      }
    }
  }

  private mcpSnapshotsLocked(document: CatalogDocument, enabledOnly: boolean): MCPServerSnapshot[] {
    const result: MCPServerSnapshot[] = []
    for (const name of Object.keys(document.mcpServers).sort()) {
      const record = document.mcpServers[name]
      if (enabledOnly && !record.enabled) continue
      const [fileAccess, networkAccess] = accessLabels(record)
      const snapshot: MCPServerSnapshot = {
        name,
        enabled: record.enabled,
        transport: record.transport,
        fileAccess,
        networkAccess,
        scope: 'user',
        reviewReady: true,
      }
      if (record.command) snapshot.command = record.command
      if (record.args?.length) snapshot.args = [...record.args]
      if (record.url) snapshot.url = displayURL(record.url)
      if (record.socket) snapshot.socket = record.socket
      if (record.envNames?.length) snapshot.envNames = [...record.envNames]
      if (record.headerNames?.length) snapshot.headerNames = [...record.headerNames]
      if (record.hasBearer) snapshot.hasBearer = true
      result.push(snapshot)
    }
    return result
  }

  private skillSnapshotsLocked(document: CatalogDocument): SkillSnapshot[] {
    const result: SkillSnapshot[] = []
    for (const name of Object.keys(document.skills).sort()) {
      const record = document.skills[name]
      let description = String(record.description ?? '').trim()
      let slashOnly = false
      try {
        const inspected = inspectSkillDirectorySync(join(this.root, 'skills', name))
        if (!description) description = inspected.description
        slashOnly = inspected.slashOnly
      } catch {
        // keep catalog description
      }
      const snapshot: SkillSnapshot = {
        name,
        label: name,
        description,
        enabled: record.enabled,
        origin: 'user',
      }
      if (slashOnly) snapshot.slashOnly = true
      result.push(snapshot)
    }
    return result
  }

  private builtinMCPSnapshotsLocked(document: CatalogDocument): BuiltinMCPSnapshot[] {
    return BUILTIN_MCP_NAMES.map((name) => {
      const record = document.builtinMCP[name] ?? {}
      const snapshot: BuiltinMCPSnapshot = {
        name,
        enabled: record.enabled ?? true,
        customized: Boolean(record.customized),
      }
      if (record.command) snapshot.command = record.command
      if (record.args?.length) snapshot.args = [...record.args]
      return snapshot
    })
  }

  private builtinSkillSnapshotsLocked(): BuiltinSkillSnapshot[] {
    return BUILTIN_SKILL_NAMES.map((name) => ({
      name,
      customized: existsSync(join(this.overlaySkillDir(name), 'SKILL.md')),
    }))
  }

  private async upsertMCPLocked(
    document: CatalogDocument,
    input: MCPServerInput,
  ): Promise<{ name: string; value: UserMCPRecord }> {
    const name = String(input.name ?? '').trim()
    if (!validResourceName(name)) throw new Error('MCP server name is invalid')
    if (RESERVED_MCP_NAMES.has(name) || name.startsWith('milksu-')) {
      throw new Error(`MCP server name ${JSON.stringify(name)} is reserved`)
    }
    const exists = Boolean(document.mcpServers[name])
    if (!exists && Object.keys(document.mcpServers).length >= MAX_USER_MCP_SERVERS) {
      throw new Error(`at most ${MAX_USER_MCP_SERVERS} user MCP servers can be saved`)
    }
    const record: UserMCPRecord = { ...(document.mcpServers[name] ?? { enabled: true, transport: 'command' }) }
    if (input.enabled !== undefined) record.enabled = Boolean(input.enabled)
    else if (!exists) record.enabled = true
    const normalized = normalizeMCPTransport(input)
    record.transport = normalized.transport
    record.command = normalized.command || undefined
    record.args = normalized.args.length ? normalized.args : undefined
    record.url = normalized.url || undefined
    record.socket = normalized.socket || undefined
    let envNames = uniqueNames(record.envNames ?? [])
    let headerNames = uniqueNames(record.headerNames ?? [])
    for (const key of input.removeEnv ?? []) {
      await this.secrets.delete(secretAccount(name, 'env', key))
      envNames = removeName(envNames, key)
    }
    for (const key of input.removeHeaders ?? []) {
      await this.secrets.delete(secretAccount(name, 'header', key))
      headerNames = removeName(headerNames, key)
    }
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (!validEnvName(key)) throw new Error(`environment name ${JSON.stringify(key)} is invalid`)
      if (!String(value ?? '').trim()) continue
      await this.secrets.put(secretAccount(name, 'env', key), value)
      envNames = appendUnique(envNames, key)
    }
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      if (!validHeaderName(key)) throw new Error(`header name ${JSON.stringify(key)} is invalid`)
      if (!String(value ?? '').trim()) continue
      await this.secrets.put(secretAccount(name, 'header', key), value)
      headerNames = appendUnique(headerNames, key)
    }
    if (input.clearBearer) {
      await this.secrets.delete(secretAccount(name, 'bearer', '_'))
      record.hasBearer = false
    }
    const token = String(input.bearerToken ?? '').trim()
    if (token) {
      await this.secrets.put(secretAccount(name, 'bearer', '_'), token)
      record.hasBearer = true
    }
    record.envNames = uniqueNames(envNames)
    record.headerNames = uniqueNames(headerNames)
    if (!record.envNames.length) delete record.envNames
    if (!record.headerNames.length) delete record.headerNames
    if (!record.hasBearer) delete record.hasBearer
    return { name, value: record }
  }

  private async deleteMCPSecretsLocked(name: string, record: UserMCPRecord): Promise<void> {
    for (const key of record.envNames ?? []) await this.secrets.delete(secretAccount(name, 'env', key))
    for (const key of record.headerNames ?? []) await this.secrets.delete(secretAccount(name, 'header', key))
    if (record.hasBearer) await this.secrets.delete(secretAccount(name, 'bearer', '_'))
  }

  private async resolveMCPLocked(name: string, record: UserMCPRecord): Promise<Record<string, unknown> | null> {
    const definition: Record<string, unknown> = {}
    switch (record.transport) {
      case 'command':
        definition.command = record.command
        if (record.args?.length) definition.args = [...record.args]
        break
      case 'url':
        definition.url = record.url
        break
      case 'socket':
        definition.socket = record.socket
        break
      default:
        return null
    }
    const env = await this.resolveNamedSecrets(name, 'env', record.envNames ?? [])
    if (Object.keys(env).length) definition.env = env
    const headers = await this.resolveNamedSecrets(name, 'header', record.headerNames ?? [])
    if (Object.keys(headers).length) definition.headers = headers
    if (record.hasBearer) {
      const token = await this.secrets.lookup(secretAccount(name, 'bearer', '_'))
      if (token) definition.bearerToken = token
    }
    return definition
  }

  private async resolveNamedSecrets(
    server: string,
    kind: string,
    names: string[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {}
    for (const name of names) {
      const value = await this.secrets.lookup(secretAccount(server, kind, name))
      if (value) result[name] = value
    }
    return result
  }

  private async syncWorkspaceLocked(document: CatalogDocument): Promise<void> {
    const root = this.workspaceDir()
    let info
    try {
      info = await lstat(root)
    } catch (error) {
      if (isNotFound(error)) return
      throw new Error(`stat config workspace: ${errorMessage(error)}`)
    }
    if (!info.isDirectory()) return
    document.builtinMCP ??= {}
    let changed = false
    for (const name of BUILTIN_MCP_NAMES) {
      let data: string
      try {
        data = await readFile(join(root, 'mcp', `${name}.json`), 'utf8')
      } catch {
        continue
      }
      let file: { id?: string; enabled?: boolean; command?: string; args?: string[] }
      try {
        file = JSON.parse(data) as typeof file
      } catch {
        continue
      }
      const id = String(file.id ?? '').trim() || name
      if (id !== name || !knownBuiltinMCP(id)) continue
      const record = { ...document.builtinMCP[name] }
      const command = String(file.command ?? '').trim()
      const args = normalizeOverlayArgs(file.args ?? [])
      if (file.enabled !== undefined) {
        record.enabled = Boolean(file.enabled)
        changed = true
      }
      if (!command && args.length === 0) {
        if (record.customized || record.command || (record.args?.length ?? 0) > 0) {
          record.customized = false
          record.command = ''
          record.args = []
          changed = true
        }
      } else if (record.command !== command || !stringSlicesEqual(record.args ?? [], args)) {
        record.command = command
        record.args = args
        record.customized = true
        changed = true
      }
      document.builtinMCP[name] = record
    }
    for (const name of BUILTIN_SKILL_NAMES) {
      let body: string
      try {
        body = await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8')
      } catch {
        continue
      }
      let factory = ''
      try {
        factory = await this.readFactorySkillLocked(name)
      } catch {
        factory = ''
      }
      const overlayPath = join(this.overlaySkillDir(name), 'SKILL.md')
      if (factory && body === factory) {
        if (existsSync(overlayPath)) await rm(this.overlaySkillDir(name), { recursive: true, force: true })
        continue
      }
      await mkdir(this.overlaySkillDir(name), { recursive: true, mode: 0o700 })
      await writeFile(overlayPath, body, { mode: 0o600 })
    }
    if (changed) await this.saveLocked(document)
  }

  private async writeWorkspaceLocked(document: CatalogDocument): Promise<void> {
    const root = this.workspaceDir()
    await mkdir(join(root, 'mcp'), { recursive: true, mode: 0o700 })
    await mkdir(join(root, 'skills'), { recursive: true, mode: 0o700 })
    await writeFile(join(root, 'AGENTS.md'), configWorkspaceGuidance(), { mode: 0o600 })
    for (const name of BUILTIN_MCP_NAMES) {
      const record = document.builtinMCP[name] ?? {}
      const enabled = record.enabled ?? true
      const payload = `${JSON.stringify({
        id: name,
        enabled,
        command: record.command ?? '',
        args: [...(record.args ?? [])],
      }, null, 2)}\n`
      await writeFile(join(root, 'mcp', `${name}.json`), payload, { mode: 0o600 })
    }
    for (const name of BUILTIN_SKILL_NAMES) {
      let body: string
      try {
        body = (await this.readEffectiveSkillLocked(name)).document
      } catch {
        continue
      }
      const dir = join(root, 'skills', name)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      await writeFile(join(dir, 'SKILL.md'), body, { mode: 0o600 })
    }
  }

  private async readEffectiveSkillLocked(name: string): Promise<{ document: string; customized: boolean }> {
    try {
      const overlay = await readFile(join(this.overlaySkillDir(name), 'SKILL.md'), 'utf8')
      return { document: overlay, customized: true }
    } catch {
      return { document: await this.readFactorySkillLocked(name), customized: false }
    }
  }

  private async readFactorySkillLocked(name: string): Promise<string> {
    const dir = this.factorySkillDir(name)
    if (!dir) throw new Error('factory skills directory is not configured')
    try {
      return await readFile(join(dir, 'SKILL.md'), 'utf8')
    } catch (error) {
      throw new Error(`read factory skill ${name}: ${errorMessage(error)}`)
    }
  }

  private overlaySkillPathsLocked(): { paths: string[]; hideFactory: string[] } {
    const paths: string[] = []
    const hideFactory: string[] = []
    for (const name of BUILTIN_SKILL_NAMES) {
      const path = this.overlaySkillDir(name)
      if (!existsSync(join(path, 'SKILL.md'))) continue
      paths.push(path)
      hideFactory.push(name)
    }
    return { paths, hideFactory }
  }
}

export function knownBuiltinMCP(name: string): boolean {
  return (BUILTIN_MCP_NAMES as readonly string[]).includes(name)
}

export function knownBuiltinSkill(name: string): boolean {
  return (BUILTIN_SKILL_NAMES as readonly string[]).includes(name)
}

export function builtinMCPWorkspacePrompt(name: string): string {
  return ` 当前会话工作区已指向 MilkSU 内置资源配置目录。请直接编辑 mcp/${name}.json：command/args 覆盖本机检测结果，留空则继续用当前版本的检测默认值。不要把密钥写进这些文件。改完后告诉我设置页还需要重新检测什么。`
}

export function builtinSkillWorkspacePrompt(name: string): string {
  return `当前会话工作区已指向 MilkSU 内置资源配置目录。请按我的自然语言要求编辑 skills/${name}/SKILL.md。保持 Pi 名录规则：frontmatter 只放 name 和 when-to-use description；需要仅斜杠调用时写 disable-model-invocation: true；正文留在这个文件里供 read 或 /skill:${name} 加载。不要把 Skill 正文贴进 system prompt，也不要扫描我的其他句子来猜测该改哪个文件。如果我要求恢复默认，把该文件改回当前版本的出厂内容。`
}

function configWorkspaceGuidance(): string {
  return `${`# MilkSU agent resource workspace

Edit the files in this directory to change this machine's built-in MCP and Skill overlays.
MilkSU reloads these files when Settings opens the catalog or a Coding turn starts.

- mcp/<id>.json: built-in MCP overlay. IDs: ida-pro, capa, codeql, burp-suite, shannon.
  Set command/args to override this version's detected adapter. Clear command and args to use detection again.
  Do not put API keys or tokens in these files.
- skills/<name>/SKILL.md: overlay of a shipped first-party Skill. Keep Pi catalog rules:
  name + when-to-use description in frontmatter; body stays in this file for read /skill:name.
  disable-model-invocation: true keeps a skill slash-only.

To restore this app version's factory files, use Settings restore, or delete the overlay and leave an empty command.

Do not scan the user's chat with keywords. Follow natural-language requests and edit these files.`.trim()}\n`
}

function normalizeMCPTransport(input: MCPServerInput): {
  transport: MCPTransport
  command: string
  args: string[]
  url: string
  socket: string
} {
  const transport = String(input.transport ?? '').trim()
  if (transport === 'command') {
    const command = boundedText(String(input.command ?? ''), MAX_COMMAND_RUNES)
    if (!command) throw new Error('MCP command is invalid')
    return { transport, command, args: normalizeArgs(input.args ?? []), url: '', socket: '' }
  }
  if (transport === 'url') {
    return { transport, command: '', args: [], url: normalizeRemoteURL(String(input.url ?? '')), socket: '' }
  }
  if (transport === 'socket') {
    const socket = boundedText(String(input.socket ?? ''), 240)
    if (!socket || socket.includes('..')) throw new Error('MCP socket is invalid')
    return { transport, command: '', args: [], url: '', socket }
  }
  throw new Error('MCP transport must be command, url, or socket')
}

function normalizeArgs(values: string[]): string[] {
  if (values.length > MAX_ARGS) throw new Error(`MCP command accepts at most ${MAX_ARGS} arguments`)
  const result: string[] = []
  for (const raw of values) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    if (!boundedText(value, MAX_ARG_RUNES)) throw new Error('MCP argument is invalid')
    result.push(value)
  }
  return result
}

function normalizeRemoteURL(value: string): string {
  const trimmed = boundedText(value, 500)
  if (!trimmed) throw new Error('MCP URL is invalid')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('MCP URL must be http or https')
  }
  if (!parsed.host || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('MCP URL must be http or https')
  }
  parsed.username = ''
  parsed.password = ''
  return parsed.toString()
}

function normalizeOverlayArgs(values: string[]): string[] {
  const result: string[] = []
  for (const value of values) {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) continue
    if ([...trimmed].length > MAX_ARG_RUNES || result.length >= MAX_ARGS) continue
    result.push(trimmed)
  }
  return result
}

export function parseImportedMCPServers(raw: string): MCPServerInput[] {
  let document: Record<string, unknown>
  try {
    document = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('MCP JSON is invalid')
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('MCP JSON is invalid')
  }
  let payload = document
  if (document.mcpServers && typeof document.mcpServers === 'object' && !Array.isArray(document.mcpServers)) {
    payload = document.mcpServers as Record<string, unknown>
  } else if (document.servers && typeof document.servers === 'object' && !Array.isArray(document.servers)) {
    payload = document.servers as Record<string, unknown>
  }
  if (looksLikeSingleServer(payload)) {
    throw new Error('MCP JSON must map server names to definitions')
  }
  const names = Object.keys(payload)
  if (!names.length) throw new Error('MCP JSON does not contain any servers')
  const seen = new Map<string, string>()
  const result: MCPServerInput[] = []
  for (const rawName of names) {
    const name = normalizeImportedName(rawName)
    if (!validResourceName(name)) throw new Error(`MCP server name ${JSON.stringify(rawName)} is invalid`)
    const previous = seen.get(name)
    if (previous) throw new Error(`MCP server names ${JSON.stringify(previous)} and ${JSON.stringify(rawName)} collide`)
    seen.set(name, rawName)
    const definition = payload[rawName]
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error(`MCP server ${JSON.stringify(rawName)} is invalid`)
    }
    result.push(mcpInputFromImported(name, definition as Record<string, unknown>))
  }
  return result
}

function looksLikeSingleServer(document: Record<string, unknown>): boolean {
  return 'command' in document || 'url' in document || 'serverUrl' in document || 'socket' in document
}

function mcpInputFromImported(name: string, definition: Record<string, unknown>): MCPServerInput {
  let enabled = true
  if (definition.disabled === true) enabled = false
  const command = importedString(definition, 'command')
  const remoteURL = firstImportedString(definition, 'url', 'serverUrl')
  const socket = importedString(definition, 'socket')
  const kind = importedString(definition, 'type').toLowerCase()
  let transport: MCPTransport = 'command'
  if (kind === 'url' || kind === 'http' || kind === 'sse' || kind === 'streamable-http' || remoteURL) {
    transport = 'url'
  } else if (kind === 'socket' || socket) {
    transport = 'socket'
  } else if (kind === 'command' || kind === 'stdio' || command) {
    transport = 'command'
  } else {
    throw new Error(`MCP server ${JSON.stringify(name)} is missing command, url, or socket`)
  }
  const input: MCPServerInput = {
    name,
    enabled,
    transport,
    command,
    args: importedStringList(definition.args),
    url: remoteURL,
    socket,
    env: importedStringMap(definition.env),
    headers: importedStringMap(definition.headers),
  }
  const bearer = importedString(definition, 'bearerToken') || importedString(definition, 'bearer_token')
  if (bearer) input.bearerToken = bearer
  return input
}

function normalizeImportedName(value: string): string {
  const lower = value.toLowerCase().trim()
  let result = ''
  let hyphen = false
  for (const character of lower) {
    if (/[a-z0-9]/.test(character)) {
      result += character
      hyphen = false
      continue
    }
    if (result && !hyphen) {
      result += '-'
      hyphen = true
    }
  }
  return result.replace(/^-+|-+$/g, '')
}

function firstImportedString(definition: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = importedString(definition, key)
    if (value) return value
  }
  return ''
}

function importedString(definition: Record<string, unknown>, key: string): string {
  const value = definition[key]
  return typeof value === 'string' ? value.trim() : ''
}

function importedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function importedStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim()
    if (!name || typeof raw !== 'string') continue
    result[name] = raw
  }
  return Object.keys(result).length ? result : undefined
}

export type InspectedSkill = { name: string; description: string; slashOnly: boolean }

export async function inspectSkillDirectory(sourceDirectory: string): Promise<InspectedSkill> {
  const clean = resolve(sourceDirectory)
  let info
  try {
    info = await lstat(clean)
  } catch (error) {
    throw new Error(`open skill directory: ${errorMessage(error)}`)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('skill import must be a regular directory')
  }
  const skillPath = join(clean, 'SKILL.md')
  let skillInfo
  try {
    skillInfo = await lstat(skillPath)
  } catch {
    throw new Error('skill directory must contain SKILL.md')
  }
  if (skillInfo.isSymbolicLink() || !skillInfo.isFile()) {
    throw new Error('SKILL.md must be a regular file')
  }
  const data = await readFile(skillPath)
  if (!isUtf8(data)) throw new Error('SKILL.md must be UTF-8')
  const parsed = parseSkillFrontmatter(data.toString('utf8'))
  let name = parsed.name
  if (!validResourceName(name)) name = basename(clean)
  if (!validResourceName(name)) throw new Error('skill name is invalid')
  return { name, description: parsed.description, slashOnly: parsed.slashOnly }
}

function inspectSkillDirectorySync(sourceDirectory: string): InspectedSkill {
  const clean = resolve(sourceDirectory)
  const info = statSync(join(clean, 'SKILL.md'))
  if (!info.isFile()) throw new Error('SKILL.md must be a regular file')
  const data = readFileSync(join(clean, 'SKILL.md'))
  const parsed = parseSkillFrontmatter(data.toString('utf8'))
  let name = parsed.name
  if (!validResourceName(name)) name = basename(clean)
  return { name, description: parsed.description, slashOnly: parsed.slashOnly }
}

async function copySkillDirectory(sourceDirectory: string, destination: string): Promise<void> {
  const source = resolve(sourceDirectory)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  let files = 0
  let total = 0
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      const rel = relative(source, path)
      if (!rel || rel === '.') continue
      if (!allowedSkillRelative(rel)) continue
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('skill import cannot include symbolic links')
      const target = join(destination, rel)
      if (info.isDirectory()) {
        await mkdir(target, { recursive: true, mode: 0o700 })
        await walk(path)
        continue
      }
      if (!info.isFile()) continue
      if (info.size > MAX_SKILL_FILE_BYTES) throw new Error(`skill file ${rel} exceeds 1 MiB`)
      files += 1
      total += info.size
      if (files > MAX_SKILL_FILES || total > MAX_SKILL_BYTES) {
        throw new Error('imported skill exceeds the file or size limit')
      }
      const data = await readFile(path)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, data, { mode: 0o600 })
    }
  }
  await walk(source)
}

function allowedSkillRelative(relativePath: string): boolean {
  const normalized = relativePath.split(sep).join('/')
  if (normalized === 'SKILL.md') return true
  for (const name of ['scripts', 'references', 'assets']) {
    if (normalized === name || normalized.startsWith(`${name}/`)) return !normalized.includes('..')
  }
  return false
}

export function parseSkillFrontmatter(content: string): { name: string; description: string; slashOnly: boolean } {
  const text = content.replaceAll('\r\n', '\n')
  if (!text.startsWith('---\n')) return { name: '', description: '', slashOnly: false }
  const rest = text.slice(4)
  const end = rest.indexOf('\n---')
  if (end < 0) return { name: '', description: '', slashOnly: false }
  let name = ''
  let description = ''
  let slashOnly = false
  for (const line of rest.slice(0, end).split('\n')) {
    const cut = line.indexOf(':')
    if (cut < 0) continue
    const key = line.slice(0, cut).trim()
    const value = line.slice(cut + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key === 'name') name = value
    else if (key === 'description') description = value
    else if (key === 'disable-model-invocation') slashOnly = value === 'true'
  }
  const runes = [...description]
  if (runes.length > 1024) description = runes.slice(0, 1024).join('')
  return { name, description, slashOnly }
}

function validEnvName(value: string): boolean {
  const name = value.trim()
  if (!name || [...name].length > MAX_ENV_NAME_RUNES) return false
  return /^[A-Z_][A-Z0-9_]*$/.test(name)
}

function validHeaderName(value: string): boolean {
  const name = value.trim()
  if (!name || [...name].length > MAX_ENV_NAME_RUNES) return false
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(name)
}

function boundedText(value: string, limit: number): string {
  const text = value.trim()
  if (!text || [...text].length > limit) return ''
  if (/\p{Cc}|\p{Cf}/u.test(text)) return ''
  return text
}

function accessLabels(record: UserMCPRecord): [string, string] {
  switch (record.transport) {
    case 'command':
      return ['项目读写 + 私有运行目录', '任意出站网络']
    case 'url':
      return ['不直接授予本机文件', remoteOriginLabel(record.url ?? '')]
    case 'socket':
      return ['由本地 Socket 服务自身权限决定', '仅连接配置的本地 Socket']
    default:
      return ['', '']
  }
}

function remoteOriginLabel(value: string): string {
  try {
    const parsed = new URL(value.trim())
    if (!parsed.host) return '远程地址无效'
    return `仅连接 ${parsed.protocol}//${parsed.host}`
  } catch {
    return '远程地址无效'
  }
}

function displayURL(value: string): string {
  try {
    const parsed = new URL(value.trim())
    if (!parsed.host) return ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  result.sort()
  return result
}

function appendUnique(values: string[], value: string): string[] {
  const next = value.trim()
  return values.includes(next) ? values : [...values, next]
}

function removeName(values: string[], value: string): string[] {
  return uniqueNames(values.filter((existing) => existing !== value.trim()))
}

function stringSlicesEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function isUtf8(data: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data)
    return true
  } catch {
    return false
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'ENOENT')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function skillDirOK(dir: string): boolean {
  try {
    return statSync(join(dir, 'SKILL.md')).isFile()
  } catch {
    return false
  }
}

function factorySkillsOK(dir: string): boolean {
  return skillDirOK(join(dir, 'product-design'))
}

export function resolveFactorySkillsDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const explicit = String(env.MILKSU_FACTORY_SKILLS_DIR ?? '').trim()
  if (explicit && factorySkillsOK(explicit)) return resolve(explicit)
  const candidates: string[] = []
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    candidates.push(
      join(here, '..', '..', '..', 'skills'),
      join(here, '..', '..', 'skills'),
    )
  } catch {
    // bundled CJS may not have import.meta.url
  }
  const resources = String(env.MILKSU_RESOURCES ?? '').trim()
  if (resources) {
    candidates.push(
      join(resources, 'skills'),
      join(resources, 'milksu-sidecar', 'skills'),
    )
  }
  candidates.push(join(cwd, 'skills'), join(cwd, '..', 'skills'))
  for (const candidate of candidates) {
    if (factorySkillsOK(candidate)) return resolve(candidate)
  }
  return ''
}

function archifySkillDirs(factory: string): string[] {
  const dirs: string[] = []
  if (factory.trim()) dirs.push(join(factory, 'archify'))
  const cwd = process.cwd()
  dirs.push(
    join(cwd, 'skills', 'archify'),
    join(cwd, 'third_party', 'archify', 'archify'),
    join(cwd, '..', 'third_party', 'archify', 'archify'),
    join(cwd, 'sidecar', 'pi', 'skills', 'archify'),
    join(cwd, 'sidecar', 'pi', 'third_party', 'archify', 'archify'),
  )
  return dirs
}

