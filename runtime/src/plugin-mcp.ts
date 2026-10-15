import { createHash } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { moduleDirectory } from './module-path.ts'
import { findProjectRoot } from './sidecar.ts'
import { dataDirectory, resolveHomeRoot } from './home.ts'
import { findOfficialSource, materializeOfficial } from './plugin/official.ts'
import { PluginRegistry } from './plugin/registry.ts'
import {
  DEVELOPMENT_HOST_VERSION,
  type PluginMCPConfig,
  type PluginOptions,
  type ToolCallDescriptor,
} from './plugin/types.ts'

const PLUGIN_MCP_VERSION = '0.1.0'
const LIST_TOOL = 'milksu_plugins_list'
const MAX_PLUGIN_MCP_METADATA_BYTES = 8 << 20
const NON_MCP_TOOL_NAME = /[^A-Za-z0-9_-]+/g

const LIST_INPUT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }
const LIST_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['plugins'],
  properties: {
    plugins: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'version', 'digest', 'enabled', 'status', 'external_read_tools'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          digest: { type: 'string' },
          enabled: { type: 'boolean' },
          status: { type: 'string' },
          external_read_tools: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
}

type PluginMCPToolRegistration = {
  fingerprint: string
  descriptor: ToolCallDescriptor
}

function regularFile(path: string): boolean {
  try {
    const info = lstatSync(path)
    return !info.isSymbolicLink() && info.isFile()
  } catch {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }
}

function packagedSidecarDir(): string {
  const resources = String(process.env.MILKSU_RESOURCES ?? '').trim()
  return resources ? join(resources, 'milksu-sidecar') : ''
}

function resolveTypeScriptWorker(): { node: string; worker: string } {
  const sidecarDir = String(process.env.MILKSU_SIDECAR_DIR ?? '').trim() || packagedSidecarDir()
  if (sidecarDir) {
    const node = join(sidecarDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const worker = join(sidecarDir, 'plugin-worker.mjs')
    if (regularFile(node) && regularFile(worker)) return { node, worker }
  }
  try {
    const root = findProjectRoot()
    const worker = join(root, 'sidecar', 'plugin-runtime', 'worker.mjs')
    if (regularFile(worker)) return { node: process.execPath, worker }
  } catch {
    // packaged runtime without a checkout
  }
  return { node: '', worker: '' }
}

function developmentDirectory(): string {
  if (String(process.env.MILKSU_PLUGIN_DEV ?? '').trim() !== '1') return ''
  try {
    const root = findProjectRoot()
    const directory = join(root, 'plugins', 'dev')
    if (existsSync(directory)) return directory
  } catch {
    // packaged runtime without a checkout
  }
  return ''
}

function hostVersion(): string {
  return String(process.env.MILKSU_APP_VERSION ?? '').trim() || DEVELOPMENT_HOST_VERSION
}

export function pluginMcpArgv(): { command: string; args: string[] } {
  const command = process.execPath
  const bundled = join(moduleDirectory(), 'plugin-mcp.cjs')
  if (regularFile(bundled)) return { command, args: [bundled] }
  try {
    const source = fileURLToPath(import.meta.url)
    if (source.endsWith('.ts') && regularFile(source)) {
      return { command, args: ['--experimental-strip-types', source] }
    }
  } catch {
    // bundled CJS without import.meta
  }
  return { command, args: [bundled] }
}

export function buildPluginMcpConfig(home: string): PluginMCPConfig {
  const { command, args } = pluginMcpArgv()
  const script = args[args.length - 1] ?? ''
  if (!script || !regularFile(script)) {
    return { available: false, args: [], configuration: {} }
  }
  const env: Record<string, string> = {
    MILKSU_HOME: home,
    MILKSU_APPDATA_DIR: home,
    MILKSU_APP_VERSION: hostVersion(),
  }
  const resources = String(process.env.MILKSU_RESOURCES ?? '').trim()
  if (resources) env.MILKSU_RESOURCES = resources
  const binary = command.replace(/\\/g, '/').split('/').pop() ?? ''
  if (binary.replace(/\.exe$/i, '').toLowerCase() !== 'node') {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return {
    available: true,
    command,
    args,
    configuration: {
      mcpServers: {
        'milksu-plugins': {
          command,
          args,
          env,
        },
      },
    },
  }
}

export function externalMCPToolName(pluginID: string, toolName: string): string {
  let prefix = pluginID.replace(NON_MCP_TOOL_NAME, '_').replace(/^_+|_+$/g, '')
  if (!prefix) prefix = 'plugin'
  const name = `${prefix}__${toolName}`
  if (name.length <= 120) return name
  const digest = createHash('sha256').update(pluginID).digest()
  const suffix = `_${digest.subarray(0, 6).toString('hex')}`
  const prefixBudget = 120 - '__'.length - toolName.length
  let keep = prefixBudget - suffix.length
  if (keep < 1) keep = 1
  if (keep > prefix.length) keep = prefix.length
  return `${prefix.slice(0, keep)}${suffix}__${toolName}`
}

function pluginMCPSuccess(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function pluginMCPError(error: unknown) {
  let message = trimError(error)
  if (message.length > 2048) message = message.slice(0, 2048)
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

function trimError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim()
}

function toolInput(raw: unknown): unknown {
  if (raw == null) return {}
  if (typeof raw === 'string') {
    if (!raw.trim()) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const text = Buffer.from(raw).toString('utf8')
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return {}
    }
  }
  return raw
}

async function pluginMCPToolCatalog(registry: PluginRegistry): Promise<Map<string, PluginMCPToolRegistration>> {
  const result = new Map<string, PluginMCPToolRegistration>()
  for (const descriptor of await registry.externalToolCatalog()) {
    const name = externalMCPToolName(descriptor.plugin_id, descriptor.tool.name)
    if (name === LIST_TOOL) {
      throw new Error(`external plugin tool name collides with the host catalog "${name}"`)
    }
    if (result.has(name)) throw new Error(`external plugin tool name collision "${name}"`)
    const fingerprint = createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')
    result.set(name, { fingerprint, descriptor })
  }
  return result
}

async function pluginMCPMetadataRevision(dataDir: string): Promise<string> {
  const hash = createHash('sha256')
  const root = join(dataDir, 'services', 'plugins')
  for (const name of ['state.json', 'installed.json', 'publishers.json']) {
    hash.update(`${name}\0`)
    const path = join(root, name)
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PLUGIN_MCP_METADATA_BYTES) {
        hash.update('unsafe\0')
        continue
      }
      try {
        hash.update(await readFile(path))
      } catch {
        hash.update('read-error\0')
      }
      hash.update('\0')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') hash.update('missing\0')
      else hash.update('unsafe\0')
    }
  }
  return hash.digest('hex')
}

async function loadInvokeLua(): Promise<NonNullable<PluginOptions['invokeLua']>> {
  try {
    const mod = await import('./plugin/lua.ts')
    return mod.invokeLua
  } catch {
    return async () => {
      throw new Error('Lua plugin runtime is unavailable')
    }
  }
}

async function openPluginRegistry(): Promise<{ registry: PluginRegistry; dataDir: string }> {
  const home = resolveHomeRoot()
  const dataDir = dataDirectory(home)
  const official = await materializeOfficial(dataDir, findOfficialSource())
  const worker = resolveTypeScriptWorker()
  const options: PluginOptions = {
    officialDirectory: official,
    installedDirectory: join(dataDir, 'services', 'plugins', 'installed'),
    developmentDirectory: developmentDirectory(),
    dataDirectory: dataDir,
    developmentMode: String(process.env.MILKSU_PLUGIN_DEV ?? '').trim() === '1',
    hostVersion: hostVersion(),
    nodeExecutable: worker.node,
    typeScriptWorker: worker.worker,
    invokeLua: await loadInvokeLua(),
  }
  const registry = await PluginRegistry.open(options)
  return { registry, dataDir }
}

type ToolHandler = (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown; isError?: boolean }>

type ToolSurface = {
  add(name: string, config: {
    title?: string
    description: string
    inputSchema: unknown
    outputSchema?: unknown
    handler: ToolHandler
  }): void
  remove(name: string): void
  connect(): Promise<void>
  notifyListChanged(): Promise<void>
}

async function createToolSurface(): Promise<ToolSurface> {
  const stdio = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const StdioServerTransport = stdio.StdioServerTransport as new () => { start?: () => Promise<void> }
  try {
    const mcp = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const McpServer = mcp.McpServer as new (info: { name: string; version: string }, options?: unknown) => {
      registerTool?: (name: string, config: unknown, handler: (args: unknown) => unknown) => void
      tool?: (...args: unknown[]) => void
      removeTool?: (name: string) => void
      connect: (transport: unknown) => Promise<void>
      sendToolListChanged?: () => Promise<void>
    }
    const server = new McpServer(
      { name: 'milksu-plugins', version: PLUGIN_MCP_VERSION },
      { capabilities: { tools: { listChanged: true } } },
    )
    return {
      add(name, config) {
        const handler = async (args: unknown) => config.handler(toolInput(args))
        const registered = {
          title: config.title,
          description: config.description,
          inputSchema: config.inputSchema,
          outputSchema: config.outputSchema,
          annotations: READ_ANNOTATIONS,
        }
        if (typeof server.removeTool === 'function') {
          try { server.removeTool(name) } catch { /* not yet registered */ }
        }
        if (typeof server.registerTool === 'function') {
          server.registerTool(name, registered, handler)
          return
        }
        if (typeof server.tool === 'function') {
          server.tool(name, config.description, config.inputSchema, handler)
        }
      },
      remove(name) {
        if (typeof server.removeTool === 'function') {
          try { server.removeTool(name) } catch { /* already gone */ }
        }
      },
      async connect() {
        const transport = new StdioServerTransport()
        await server.connect(transport)
      },
      async notifyListChanged() {
        if (typeof server.sendToolListChanged === 'function') await server.sendToolListChanged()
      },
    }
  } catch {
    const index = await import('@modelcontextprotocol/sdk/server/index.js')
    const types = await import('@modelcontextprotocol/sdk/types.js')
    const Server = index.Server as new (info: { name: string; version: string }, options?: unknown) => {
      setRequestHandler: (schema: unknown, handler: (request: { params?: { name?: string; arguments?: unknown } }) => unknown) => void
      connect: (transport: unknown) => Promise<void>
      sendToolListChanged?: () => Promise<void>
    }
    const tools = new Map<string, {
      definition: Record<string, unknown>
      handler: ToolHandler
    }>()
    const server = new Server(
      { name: 'milksu-plugins', version: PLUGIN_MCP_VERSION },
      { capabilities: { tools: { listChanged: true } } },
    )
    server.setRequestHandler(types.ListToolsRequestSchema, async () => ({
      tools: [...tools.values()].map((item) => item.definition),
    }))
    server.setRequestHandler(types.CallToolRequestSchema, async (request) => {
      const name = String(request.params?.name ?? '')
      const entry = tools.get(name)
      if (!entry) return pluginMCPError(new Error(`unknown tool "${name}"`))
      return entry.handler(toolInput(request.params?.arguments))
    })
    return {
      add(name, config) {
        tools.set(name, {
          definition: {
            name,
            title: config.title,
            description: config.description,
            inputSchema: config.inputSchema,
            outputSchema: config.outputSchema,
            annotations: READ_ANNOTATIONS,
          },
          handler: config.handler,
        })
      },
      remove(name) {
        tools.delete(name)
      },
      async connect() {
        const transport = new StdioServerTransport()
        await server.connect(transport)
      },
      async notifyListChanged() {
        if (typeof server.sendToolListChanged === 'function') await server.sendToolListChanged()
      },
    }
  }
}

function registerPluginListTool(surface: ToolSurface, registry: PluginRegistry): void {
  surface.add(LIST_TOOL, {
    title: 'List MilkSU plugins',
    description: 'List enabled MilkSU plugins whose reviewed read-only tools are currently exposed to external MCP clients.',
    inputSchema: LIST_INPUT_SCHEMA,
    outputSchema: LIST_OUTPUT_SCHEMA,
    handler: async () => {
      const exposed = new Map<string, string[]>()
      for (const descriptor of await registry.externalToolCatalog()) {
        const names = exposed.get(descriptor.plugin_id) ?? []
        names.push(externalMCPToolName(descriptor.plugin_id, descriptor.tool.name))
        exposed.set(descriptor.plugin_id, names)
      }
      const plugins = []
      for (const descriptor of await registry.list()) {
        const tools = exposed.get(descriptor.id)
        if (!tools?.length) continue
        plugins.push({
          id: descriptor.id,
          name: descriptor.name,
          version: descriptor.version,
          digest: descriptor.digest,
          enabled: descriptor.enabled,
          status: descriptor.status,
          external_read_tools: tools,
        })
      }
      return pluginMCPSuccess({ plugins })
    },
  })
}

function addPluginMCPTool(surface: ToolSurface, name: string, descriptor: ToolCallDescriptor, registry: PluginRegistry): void {
  const pluginID = descriptor.plugin_id
  const tool = descriptor.tool
  surface.add(name, {
    title: tool.name,
    description: `MilkSU plugin ${pluginID}: ${tool.description}`,
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    outputSchema: tool.outputSchema,
    handler: async (input) => {
      try {
        const result = await registry.callTool(pluginID, tool.name, input ?? {}, true)
        return pluginMCPSuccess(result.content)
      } catch (error) {
        return pluginMCPError(error)
      }
    },
  })
}

async function reconcilePluginMCPTools(
  surface: ToolSurface,
  registry: PluginRegistry,
  current: Map<string, PluginMCPToolRegistration>,
): Promise<Map<string, PluginMCPToolRegistration>> {
  const next = await pluginMCPToolCatalog(registry)
  for (const [name, existing] of current) {
    const candidate = next.get(name)
    if (!candidate || candidate.fingerprint !== existing.fingerprint) {
      surface.remove(name)
    }
  }
  for (const [name, candidate] of next) {
    const existing = current.get(name)
    if (!existing || candidate.fingerprint !== existing.fingerprint) {
      addPluginMCPTool(surface, name, candidate.descriptor, registry)
    }
  }
  return next
}

async function watchPluginMCPRegistry(
  dataDir: string,
  surface: ToolSurface,
  registry: PluginRegistry,
  current: Map<string, PluginMCPToolRegistration>,
): Promise<void> {
  let revision = await pluginMCPMetadataRevision(dataDir)
  let registrations = current
  let busy = false
  const tick = async () => {
    if (busy) return
    const nextRevision = await pluginMCPMetadataRevision(dataDir)
    if (nextRevision === revision) return
    busy = true
    revision = nextRevision
    try {
      await registry.reload()
      registrations = await reconcilePluginMCPTools(surface, registry, registrations)
      await surface.notifyListChanged()
    } catch {
      for (const name of registrations.keys()) surface.remove(name)
      registrations = new Map()
      await surface.notifyListChanged()
    } finally {
      busy = false
    }
  }
  setInterval(() => {
    void tick()
  }, 1000).unref()
}

export async function main(): Promise<void> {
  const { registry, dataDir } = await openPluginRegistry()
  const surface = await createToolSurface()
  registerPluginListTool(surface, registry)
  const registrations = await reconcilePluginMCPTools(surface, registry, new Map())
  await watchPluginMCPRegistry(dataDir, surface, registry, registrations)
  await surface.connect()
}

function isPluginMcpEntry(): boolean {
  const argv1 = process.argv[1] ? resolve(process.argv[1]) : ''
  if (!argv1) return false
  const base = argv1.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'plugin-mcp.ts' || base === 'plugin-mcp.cjs' || base === 'plugin-mcp.js'
}

if (isPluginMcpEntry()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`)
    process.exit(1)
  })
}
